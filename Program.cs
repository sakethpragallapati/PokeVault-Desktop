using System.Net.NetworkInformation;
using System.Net.Sockets;
using PKHeX.Core;
using PokeVault;
using PokeVault.Core;

// Desktop app by default (its own window, only reachable from this PC).
// "--server" runs the old way: a web server for browsers/phones on the network.
var desktop = !args.Contains("--server", StringComparer.OrdinalIgnoreCase);
using var singleInstance = new Mutex(false, @"Local\PokeVault.Desktop");
if (desktop && !singleInstance.WaitOne(0))
{
    MessageBox.Show("PokeVault is already open.", "PokeVault", MessageBoxButtons.OK, MessageBoxIcon.Information);
    return;
}

var builder = WebApplication.CreateBuilder(new WebApplicationOptions
{
    Args = args.Where(a => !a.Equals("--server", StringComparison.OrdinalIgnoreCase)).ToArray(),
    ContentRootPath = FindAppRoot(),
});
var port = int.TryParse(builder.Configuration["port"], out var p) ? p : desktop ? FreeLoopbackPort() : 5080;
builder.WebHost.UseUrls(desktop ? $"http://127.0.0.1:{port}" : $"http://0.0.0.0:{port}");
builder.WebHost.ConfigureKestrel(k => k.Limits.MaxRequestBodySize = 64 * 1024 * 1024);
builder.Logging.SetMinimumLevel(LogLevel.Warning);

builder.Services.AddSingleton<AppPaths>();
builder.Services.AddSingleton<JourneyService>();
builder.Services.AddSingleton<CatchWatcher>();
builder.Services.AddSingleton<GameService>();
builder.Services.AddSingleton<VaultService>();
builder.Services.AddSingleton<TransferService>();
builder.Services.AddSingleton<ModelService>();
builder.Services.AddSingleton<SpriteService>();
builder.Services.AddSingleton<PmdService>();
builder.Services.AddSingleton<MoveDataService>();
builder.Services.AddSingleton<EmulatorService>();
builder.Services.AddSingleton<RibbonImageService>();
builder.Services.AddSingleton<EncounterService>();

var app = builder.Build();

// Health check for Docker/Kubernetes probes (no password needed).
app.MapGet("/healthz", (AppPaths paths) =>
{
    try
    {
        var probe = Path.Combine(paths.DataDir, ".healthz");
        File.WriteAllText(probe, DateTime.UtcNow.ToString("O"));
        return Results.Ok(new { status = "ok" });
    }
    catch (Exception ex) { return Results.Problem("data folder not writable: " + ex.Message, statusCode: 503); }
});

// Optional password (POKEVAULT_PASSWORD). Strongly recommended whenever PokeVault is reachable
// by anyone else, e.g. on a server or Kubernetes cluster. Any username works.
var password = builder.Configuration["POKEVAULT_PASSWORD"];
if (!string.IsNullOrEmpty(password))
{
    var expected = System.Text.Encoding.UTF8.GetBytes(password);
    app.Use(async (ctx, next) =>
    {
        if (ctx.Request.Path.StartsWithSegments("/healthz")) { await next(); return; }
        var header = ctx.Request.Headers.Authorization.ToString();
        if (header.StartsWith("Basic ", StringComparison.OrdinalIgnoreCase))
        {
            try
            {
                var decoded = System.Text.Encoding.UTF8.GetString(Convert.FromBase64String(header[6..].Trim()));
                var given = System.Text.Encoding.UTF8.GetBytes(decoded[(decoded.IndexOf(':') + 1)..]);
                if (System.Security.Cryptography.CryptographicOperations.FixedTimeEquals(given, expected)) { await next(); return; }
            }
            catch (FormatException) { /* fall through to 401 */ }
        }
        ctx.Response.StatusCode = 401;
        ctx.Response.Headers.WWWAuthenticate = "Basic realm=\"PokeVault\", charset=\"UTF-8\"";
    });
}

app.UseDefaultFiles();
app.UseStaticFiles(new StaticFileOptions
{
    OnPrepareResponse = c => c.Context.Response.Headers.CacheControl = "no-cache",
});

var games = app.Services.GetRequiredService<GameService>();
var vault = app.Services.GetRequiredService<VaultService>();
var transfer = app.Services.GetRequiredService<TransferService>();
var models = app.Services.GetRequiredService<ModelService>();
var sprites = app.Services.GetRequiredService<SpriteService>();
var pmd = app.Services.GetRequiredService<PmdService>();
var moveData = app.Services.GetRequiredService<MoveDataService>();
var emulators = app.Services.GetRequiredService<EmulatorService>();   // created now: it tells GameService which saves are in use
emulators.AwayNames = id => vault.All.Where(e => e.Away?.GameId == id).Select(e => vault.Info(e)?.SpeciesName ?? "A Pokémon").ToArray();
var ribbonImages = app.Services.GetRequiredService<RibbonImageService>();
var catches = app.Services.GetRequiredService<CatchWatcher>();
var journey = app.Services.GetRequiredService<JourneyService>();
// Behind Docker/Kubernetes the container's own IP is useless to a phone, so allow the real address.
var lanUrls = desktop ? []
    : builder.Configuration["PUBLIC_URL"] is { Length: > 0 } publicUrl ? [publicUrl] : GetLanUrls(port);

// Runs an action under the shared lock and turns VaultExceptions into friendly 400 errors.
IResult Run(Func<object?> action)
{
    try
    {
        object? result;
        lock (TransferService.Gate) result = action();
        return result as IResult ?? Results.Ok(result);
    }
    catch (VaultException ex) { return Results.BadRequest(new { error = ex.Message }); }
    catch (IOException ex) { return Results.BadRequest(new { error = "Couldn't access a file: " + ex.Message }); }
    catch (UnauthorizedAccessException ex) { return Results.BadRequest(new { error = "Windows blocked access to a file: " + ex.Message }); }
}

object VaultBoxes() => vault.Boxes.Select((b, i) => new { name = b.Name, wallpaper = b.Wallpaper, count = vault.CountInBox(i) }).ToArray();

/* ---------- status & games ---------- */

app.MapGet("/api/status", () => Run(() =>
{
    var list = games.List();
    var last = list.FirstOrDefault(g => g.Id == games.LastGame && g.Supported && !g.Hidden) ?? list.FirstOrDefault(g => g.Supported && !g.Hidden);
    return new
    {
        emulatorRunning = GameService.EmulatorRunning,
        playing = emulators.Now(),   // a game being played: PokeVault pauses, then refreshes when it closes
        desktop,
        games = list,
        defaultGame = last?.Id,
        vaultBoxes = VaultBoxes(),
        vaultTotal = vault.Count,
        dexRegistered = vault.Dex.Count,
        dexTotal = DexData.All.Count,
        boxSize = VaultService.BoxSize,
        lanUrls,
        catchRun = catches.RunId,
        catchSeq = catches.LastId,
    };
}));

/* ---------- play: emulators, game files, real saves ---------- */

app.MapGet("/api/play", () => Run(() => new { emulators = emulators.Emulators(), games = emulators.Games() }));
app.MapPost("/api/play/emulator", (EmulatorRequest r) => Run(() => { emulators.SetExe(r.Kind, r.Path); return new { ok = true }; }));
app.MapPost("/api/play/{id}/rom", (string id, PathRequest r) => Run(() => { emulators.SetRom(id, r.Path); return new { ok = true }; }));
app.MapPost("/api/play/{id}/emulator", (string id, EmulatorRequest r) => Run(() => { emulators.SetEmulator(id, r.Kind); return new { ok = true }; }));
app.MapPost("/api/play/{id}/start", (string id) => Run(() => new { emulator = emulators.Start(id) }));
app.MapPost("/api/play/{id}/place-citra", (string id) => Run(() => new { path = emulators.PlaceInCitra(id) }));
app.MapPost("/api/play/{id}/link-save", (string id, LinkSaveRequest r) => Run(() =>
{
    var g = games.Get(id);
    // the emulator may be open on that file even though PokeVault doesn't use it yet: it would overwrite the change
    if (emulators.RunningFor(g) is { } who)
        throw new VaultException($"{who} is open. Save in the game and close {who} first, then link the save.");
    var back = new List<string>();
    if (!r.KeepPokeVault)
    {
        var path = Path.GetFullPath(r.Path.Trim().Trim('"'));
        if (GameService.Inspect(path).Blank)
            throw new VaultException("That save is empty (the game was never saved in it), so there's nothing to use yet. Keep PokeVault's version instead.");
        // Pokémon visiting from the Vault only exist in PokeVault's version: bring them home first, with what they did here
        lock (TransferService.Gate)
        {
            var sav = games.LoadForReading(id);
            foreach (var e in vault.All.Where(e => e.Away?.GameId == id).ToList())
            {
                var name = vault.Info(e)?.SpeciesName ?? "A Pokémon";
                SlotRef? at = null;
                for (int b = 0; b < sav.BoxCount && at is null; b++)
                    for (int s = 0; s < sav.BoxSlotCount && at is null; s++)
                        if (sav.GetBoxSlotAtIndex(b, s) is { Species: > 0 } pk && CatchWatcher.Identity(pk) == e.Away!.CopyUid) at = new(b, s);
                if (at is null && sav.HasParty)
                    for (int i = 0; i < sav.PartyCount && at is null; i++)
                        if (CatchWatcher.Identity(sav.GetPartySlotAtIndex(i)) == e.Away!.CopyUid) at = new(TransferService.Party, i);
                if (at is not null) { transfer.Deposit(id, [at], copy: false, null, null); back.Add(name); }
                else { e.Away = null; vault.Touch(e); vault.Persist(); back.Add(name); }   // its copy isn't there any more: just unlock it
            }
        }
    }
    var linked = games.Relink(id, r.Path, r.KeepPokeVault);
    return new { game = linked, back };
}));
// When a file was last written (to compare a real save with PokeVault's copy before linking).
app.MapGet("/api/pick-info", (string path) => Run(() =>
{
    if (!File.Exists(path)) return new { time = (DateTime?)null, blank = false, game = (string?)null, trainer = (string?)null, problem = (string?)"No file at that path." };
    var (blank, game, trainer, problem) = GameService.Inspect(path);
    return new { time = (DateTime?)File.GetLastWriteTime(path), blank, game, trainer, problem };
}));
// A Windows file picker (PokeVault runs on this PC, so it can show one and hand back the full path).
app.MapPost("/api/pick", (PickRequest r) => Run(() => new { path = FilePicker.Pick(r.Title, r.Filter, r.Start) }));

// Live catch alerts: Pokémon that turned up in a save since the page last asked.
app.MapGet("/api/catches", (long? after) => Run(() => catches.Since(after ?? 0)));

app.MapGet("/api/games/{id}/boxes", (string id, bool? peek) => Run(() =>
{
    var sav = games.LoadForReading(id);
    if (peek != true) games.LastGame = id;   // the Meadow just looks; it doesn't change which game the Boxes show
    return Enumerable.Range(0, sav.BoxCount).Select(b => new
    {
        name = GameService.BoxName(sav, b),
        count = Enumerable.Range(0, sav.BoxSlotCount).Count(s => sav.GetBoxSlotAtIndex(b, s).Species != 0),
    }).ToArray();
}));

app.MapGet("/api/games/{id}/box/{box:int}", (string id, int box) => Run(() =>
{
    var sav = games.LoadForReading(id);
    if (box < 0 || box >= sav.BoxCount) throw new VaultException("No such box.");
    var slots = Enumerable.Range(0, sav.BoxSlotCount).Select(s =>
    {
        var pk = sav.GetBoxSlotAtIndex(box, s);
        var locked = sav.IsBoxSlotLocked(box, s) || sav.IsBoxSlotOverwriteProtected(box, s);
        return pk.Species == 0 ? null : MonDescriber.Describe(pk, box, s, locked: locked);
    }).ToArray();
    return new { box, name = GameService.BoxName(sav, box), slots };
}));

// The party (box -1 in moves): up to six, in order; empty when the save has no party.
app.MapGet("/api/games/{id}/party", (string id) => Run(() =>
{
    var sav = games.LoadForReading(id);
    if (!sav.HasParty) return new { has = false, slots = Array.Empty<MonInfo?>() };
    var slots = Enumerable.Range(0, 6).Select(i =>
    {
        if (i >= sav.PartyCount) return null;
        var pk = sav.GetPartySlotAtIndex(i);
        return pk.Species == 0 ? null : MonDescriber.Describe(pk, -1, i);
    }).ToArray();
    return new { has = true, slots };
}));

app.MapGet("/api/games/{id}/overview", (string id) => Run(() =>
{
    var sav = games.LoadForReading(id);
    return Enumerable.Range(0, sav.BoxCount).Select(b => new
    {
        name = GameService.BoxName(sav, b),
        slots = Enumerable.Range(0, sav.BoxSlotCount).Select(s => (int)sav.GetBoxSlotAtIndex(b, s).Species).ToArray(),
    }).ToArray();
}));

app.MapPost("/api/games/{id}/boxes/{box:int}/rename", (string id, int box, RenameRequest r) => Run(() => { games.RenameBox(id, box, r.Name); return new { ok = true }; }));
app.MapPost("/api/games/add-path", (PathRequest r) => Run(() => games.AddPath(r.Path)));
app.MapPost("/api/games/{id}/hide", (string id, HideRequest r) => Run(() => { games.SetHidden(id, r.Hidden); return new { ok = true }; }));
app.MapPost("/api/games/{id}/remove", (string id) => Run(() => { games.Remove(id); return new { ok = true }; }));

app.MapPost("/api/games/upload", async (HttpRequest req) =>
{
    if (!req.HasFormContentType) return Results.BadRequest(new { error = "Send the save as a file upload." });
    var form = await req.ReadFormAsync();
    var f = form.Files.FirstOrDefault();
    if (f is null || f.Length == 0) return Results.BadRequest(new { error = "No file received." });
    using var ms = new MemoryStream();
    await f.CopyToAsync(ms);
    var data = ms.ToArray();
    return Run(() => games.AddUpload(f.FileName, data));
});

// Save backups: list them, and put one back (the current save is backed up first).
app.MapGet("/api/games/{id}/backups", (string id) => Run(() => games.ListBackups(id)));
app.MapPost("/api/games/{id}/restore", (string id, RestoreRequest r) => Run(() => { games.Restore(id, r.File); return new { ok = true }; }));

app.MapGet("/api/games/{id}/download", (string id) => Run(() =>
{
    var g = games.Get(id);
    return Results.File(File.ReadAllBytes(g.Path), "application/octet-stream", g.FileName);
}));

/* ---------- transfers ---------- */

// Can these vault Pokémon go into this game? For the green / grey glow while dragging one.
app.MapGet("/api/games/{id}/accepts", (string id, string ids) => Run(() =>
{
    var g = games.Get(id);
    string? blocked = !g.Supported ? g.Problem ?? "This save can't be read."
        : !g.CanMove ? $"PokeVault can't put Pokémon into {g.Game} saves."
        : g.Kind == "ryujinx" && GameService.EmulatorRunning ? "Close Ryujinx first, then you can move Pokémon into this game."
        : null;
    var sav = blocked is null ? games.LoadForReading(id) : null;
    return ids.Split(',', StringSplitOptions.RemoveEmptyEntries).Take(60).ToDictionary(x => x, x =>
    {
        if (blocked is not null) return new { ok = false, why = blocked };
        var e = vault.Find(x);
        if (e is null) return new { ok = false, why = "That Pokémon isn't in the vault any more." };
        try { return TransferService.CanGoInto(vault.Read(e), sav!, out var why) ? new { ok = true, why = "" } : new { ok = false, why }; }
        catch (VaultException ex) { return new { ok = false, why = ex.Message }; }
    });
}));

app.MapPost("/api/deposit", (DepositRequest r) => Run(() => transfer.Deposit(r.GameId, r.Slots, r.Copy, r.VaultBox, r.VaultSlot)));
app.MapPost("/api/withdraw", (WithdrawRequest r) => Run(() => transfer.Withdraw(r.GameId, r.Ids, r.Box, r.Slot)));
app.MapPost("/api/games/{id}/move", (string id, GameMoveRequest r) => Run(() =>
{
    transfer.MoveInGame(id, r.FromBox, r.FromSlot, r.ToBox, r.ToSlot);
    return new { ok = true };
}));

/* ---------- vault ---------- */

app.MapGet("/api/vault/box/{box:int}", (int box) => Run(() =>
{
    vault.CheckSlot(box, 0);
    var slots = Enumerable.Range(0, VaultService.BoxSize)
        .Select(s => vault.At(box, s) is { } e ? vault.Info(e) : null).ToArray();
    var b = vault.Boxes[box];
    return new { box, name = b.Name, wallpaper = b.Wallpaper, slots };
}));

app.MapGet("/api/vault/overview", () => Run(() => vault.Boxes.Select((b, i) => new
{
    name = b.Name,
    wallpaper = b.Wallpaper,
    slots = Enumerable.Range(0, VaultService.BoxSize).Select(s => vault.At(i, s) is { } e ? vault.Info(e)?.Species ?? 0 : 0).ToArray(),
}).ToArray()));

app.MapGet("/api/vault/search", (string? q, string? type, bool? shiny, int? species, string? game, int? gen, bool? perfect) => Run(() =>
{
    q = q?.Trim() ?? "";
    var list = vault.All.Select(vault.Info).Where(m => m is not null).Select(m => m!);
    if (q.Length > 0)
        list = list.Where(m => m.SpeciesName.Contains(q, StringComparison.OrdinalIgnoreCase)
                            || m.Nickname.Contains(q, StringComparison.OrdinalIgnoreCase)
                            || m.OT.Contains(q, StringComparison.OrdinalIgnoreCase));
    if (!string.IsNullOrEmpty(type)) list = list.Where(m => m.Types.Contains(type, StringComparer.OrdinalIgnoreCase));
    if (shiny == true) list = list.Where(m => m.Shiny);
    if (species is int sp) list = list.Where(m => m.Species == sp);
    if (!string.IsNullOrEmpty(game)) list = list.Where(m => m.Origin.Equals(game, StringComparison.OrdinalIgnoreCase));
    if (gen is int gn and > 0) list = list.Where(m => m.Generation == gn);                 // the generation it came from
    if (perfect == true) list = list.Where(m => !m.IsEgg && m.Ivs.All(v => v >= 31));     // 6 perfect IVs
    return list.OrderBy(m => m.Box).ThenBy(m => m.Slot).Take(200).ToArray();
}));

// Smart boxes: saved searches (data/smart-boxes.json) whose results are worked out fresh every time.
var smartFile = Path.Combine(app.Services.GetRequiredService<AppPaths>().DataDir, "smart-boxes.json");
List<SmartBox> ReadSmart()
{
    try { return System.Text.Json.JsonSerializer.Deserialize<List<SmartBox>>(File.ReadAllText(smartFile)) ?? []; }
    catch { return []; }
}
void WriteSmart(List<SmartBox> l) => File.WriteAllText(smartFile, System.Text.Json.JsonSerializer.Serialize(l));
app.MapGet("/api/smart", () => Run(() => ReadSmart()));
app.MapPost("/api/smart", (SmartBox s) => Run(() =>
{
    var name = (s.Name ?? "").Trim();
    if (name.Length is 0 or > 24) throw new VaultException("Smart box names must be 1–24 characters.");
    var l = ReadSmart();
    if (l.Count >= 30) throw new VaultException("That's the most smart boxes you can keep (30). Delete one first.");
    var box = s with { Id = Guid.NewGuid().ToString("N")[..8], Name = name };
    l.Add(box);
    WriteSmart(l);
    return box;
}));
app.MapPost("/api/smart/{id}/delete", (string id) => Run(() => { var l = ReadSmart(); l.RemoveAll(x => x.Id == id); WriteSmart(l); return new { ok = true }; }));

app.MapPost("/api/vault/move", (MoveRequest r) => Run(() => { vault.Move(r.Id, r.Box, r.Slot); return new { ok = true }; }));
app.MapPost("/api/vault/move-many", (MoveManyRequest r) => Run(() => new { moved = vault.MoveToBox(r.Ids, r.Box) }));
app.MapPost("/api/vault/release", (IdsRequest r) => Run(() =>
{
    int n = 0;
    var steps = new List<(string, string, string, string?, int)>();
    foreach (var id in r.Ids)
        if (vault.Find(id) is { } e && e.Away is null)   // one that's away in an older game has to come back first
        {
            if (vault.Info(e) is { } info) steps.Add((info.Uid, "release", "Released from the Vault", null, 0));
            vault.Remove(e, released: true); n++;
        }
    vault.Persist();
    journey.AddMany(steps);
    return new { released = n };
}));
app.MapPost("/api/vault/boxes", () => Run(() => new { box = vault.AddBox() }));

// Duplicate finder: exact copies (the same Pokémon more than once) and species you have several of.
app.MapGet("/api/vault/duplicates", () => Run(() =>
{
    var mons = vault.All.Select(e => (E: e, I: vault.Info(e))).Where(x => x.I is not null).ToList();
    var copies = mons.Where(x => !x.I!.IsEgg).GroupBy(x => x.I!.Uid).Where(g => g.Count() > 1)
        .Select(g => g.OrderBy(x => x.E.Added).Select(x => x.I!).ToArray()).ToArray();
    var species = mons.Where(x => !x.I!.IsEgg).GroupBy(x => x.I!.Species).Where(g => g.Count() > 1)
        .OrderByDescending(g => g.Count()).ThenBy(g => g.Key)
        .Select(g => new { species = g.Key, name = g.First().I!.SpeciesName, count = g.Count(), mons = g.OrderByDescending(x => x.I!.Shiny).ThenByDescending(x => x.I!.Level).Select(x => x.I!).ToArray() })
        .ToArray();
    return new { copies, species };
}));

// Auto-sort and Living Dex (each saves the layout first), and undoing the last one.
var organize = new OrganizeService(vault);
app.MapPost("/api/vault/sort", (SortRequest r) => Run(() => new { moved = organize.Sort(r.Scope, r.Box, r.By) }));
app.MapPost("/api/vault/living-dex", () => Run(() =>
{
    var (placed, species, boxes) = organize.LivingDex();
    return new { placed, species, boxes, total = DexData.All.Count };
}));
app.MapGet("/api/vault/undo", () => Run(() => vault.Snapshot() is { } s ? new { label = s.Label, time = s.Time } : null));
app.MapPost("/api/vault/undo", () => Run(() => new { restored = vault.UndoLayout() }));
app.MapPost("/api/vault/boxes/{box:int}", (int box, BoxRequest r) => Run(() => { vault.UpdateBox(box, r.Name, r.Wallpaper); return new { ok = true }; }));

app.MapGet("/api/vault/{id}/download", (string id) => Run(() =>
{
    var e = vault.Find(id) ?? throw new VaultException("Not found.");
    var pk = vault.Read(e);
    return Results.File(VaultService.ToBytes(pk), "application/octet-stream", $"{MonDescriber.SpeciesName(pk.Species)} - {e.Id}.{pk.Extension}");
}));

// Import single Pokémon files (.pk9, .pk8, .pk3, …) exported from PKHeX.
app.MapPost("/api/vault/import", async (HttpRequest req) =>
{
    if (!req.HasFormContentType) return Results.BadRequest(new { error = "Send the files as a form upload." });
    var form = await req.ReadFormAsync();
    var files = new List<(string Name, byte[] Data)>();
    foreach (var f in form.Files)
    {
        if (f.Length is 0 or > 4096) { files.Add((f.FileName, [])); continue; }
        using var ms = new MemoryStream();
        await f.CopyToAsync(ms);
        files.Add((f.FileName, ms.ToArray()));
    }
    return Run(() =>
    {
        int added = 0;
        var skipped = new List<string>();
        foreach (var (name, data) in files)
        {
            var pk = data.Length == 0 ? null : VaultService.Parse(data, name);
            if (pk is null || pk.Species == 0 || !pk.ChecksumValid) { skipped.Add(name); continue; }
            var (b, s) = vault.FirstEmpty();
            vault.Add(pk, b, s, "Imported file");
            journey.Add(CatchWatcher.Identity(pk), "import", "Imported into the Vault", null, pk.Format);
            added++;
        }
        vault.Persist();
        return new { added, skipped };
    });
});

/* ---------- 3D models (meadow) ---------- */

app.MapGet("/api/models/index", async () => Results.Ok(await models.GetIndexAsync()));
app.MapGet("/api/models/clips/{category}/{name}", async (string category, string name) =>
    await models.GetClipsAsync(category, name) is { } clips ? Results.Ok(clips) : Results.NotFound());
app.MapGet("/models/{category}/{name}.glb", async (string category, string name, HttpContext ctx) =>
{
    var file = await models.GetModelAsync(category, name);
    if (file is null) return Results.NotFound();
    ctx.Response.Headers.CacheControl = "public, max-age=604800";
    return Results.File(file, "model/gltf-binary");
});

app.MapGet("/api/sprites/index", async () => Results.Ok(await sprites.GetIndexAsync()));
app.MapGet("/ribbons/{key}.png", async (string key, HttpContext ctx) =>
{
    var file = await ribbonImages.GetAsync(key);
    if (file is null) return Results.NotFound();
    ctx.Response.Headers.CacheControl = "public, max-age=604800";
    return Results.File(file, "image/png");
});
app.MapGet("/cries/{name}", async (string name, HttpContext ctx) =>
{
    var cry = await sprites.GetCryAsync(Path.GetFileNameWithoutExtension(name));
    if (cry is not { } c) return Results.NotFound();
    ctx.Response.Headers.CacheControl = "public, max-age=604800";
    return Results.File(c.Path, c.Type);
});
app.MapGet("/sprites/{set}/{file}", async (string set, string file, HttpContext ctx) =>
{
    var ext = Path.GetExtension(file).TrimStart('.').ToLowerInvariant();
    var path = set is "hires" or "hires-shiny"
        ? (ext == "png" ? await sprites.GetHiResAsync(Path.GetFileNameWithoutExtension(file), set == "hires-shiny") : null)
        : await sprites.GetSpriteAsync(set, Path.GetFileNameWithoutExtension(file), ext);
    if (path is null) return Results.NotFound();
    ctx.Response.Headers.CacheControl = "public, max-age=604800";
    return Results.File(path, ext == "png" ? "image/png" : "image/gif");
});

// Walking sprites and portraits for the Meadow (PMD Sprite Collab, fetched once and cached).
app.MapGet("/api/pmd/index", async () => await pmd.GetIndexAsync() is { } index ? Results.Ok(index) : Results.StatusCode(503));
app.MapGet("/api/pmd/credits", async (string key) =>
    System.Text.RegularExpressions.Regex.IsMatch(key, @"^\d{4}(/\d{4}){0,3}$") ? Results.Ok(await pmd.GetCreditsAsync(key)) : Results.BadRequest());
app.MapGet("/api/moves", async () => await moveData.GetAsync() is { } m ? Results.Ok(m) : Results.StatusCode(503));
app.MapGet("/pmd/{**path}", async (string path, HttpContext ctx) =>
{
    var file = await pmd.GetFileAsync(path);
    if (file is null) return Results.NotFound();
    ctx.Response.Headers.CacheControl = "public, max-age=604800";
    return Results.File(file, PmdService.ContentType(path));
});

/* ---------- Pokédex ---------- */

app.MapGet("/api/dex", () => Run(() =>
{
    var counts = vault.All.Select(vault.Info).Where(m => m is { IsEgg: false })
        .GroupBy(m => m!.Species).ToDictionary(g => g.Key, g => g.Count());
    return DexData.All.Select(d => new
    {
        n = d.N, name = d.Name, types = d.Types,
        reg = vault.Dex.TryGetValue(d.N, out var f) ? f : 0,
        have = counts.GetValueOrDefault(d.N),
    }).ToArray();
}));

// Numbers for the shareable Trainer card, worked out from the vault.
app.MapGet("/api/trainer", () => Run(() =>
{
    var mons = vault.All.Select(vault.Info).Where(m => m is { IsEgg: false }).Select(m => m!).ToList();
    object Pic(MonInfo m) => new { m.Species, m.SpriteId, m.Shiny, m.SpeciesName, name = m.IsNicknamed ? m.Nickname : m.SpeciesName, m.Level, m.MetDate, m.Origin };
    var top = mons.GroupBy(m => m.Species).OrderByDescending(g => g.Count()).ThenBy(g => g.Key).FirstOrDefault();
    return new
    {
        total = mons.Count,
        shinies = mons.Count(m => m.Shiny),
        dexRegistered = vault.Dex.Count,
        dexShiny = vault.Dex.Count(d => (d.Value & 2) != 0),
        dexTotal = DexData.All.Count,
        games = games.List().Count(g => g.Supported && !g.Hidden),
        originGames = mons.Select(m => m.Origin).Where(o => o.Length > 0).Distinct().Count(),
        generations = mons.Select(m => m.Generation).Where(g => g > 0).Distinct().Count(),
        trainer = mons.GroupBy(m => m.OT).OrderByDescending(g => g.Count()).FirstOrDefault()?.Key ?? "",
        // the ID No. that trainer's Pokémon carry most, and when the Vault got its first Pokémon
        tid = mons.GroupBy(m => m.OT).OrderByDescending(g => g.Count()).FirstOrDefault()?
            .GroupBy(m => m.TID).OrderByDescending(g => g.Count()).First().Key ?? "",
        started = vault.All.Select(e => e.Added).Where(d => d > DateTime.MinValue).DefaultIfEmpty().Min(),
        living = mons.Select(m => m.Species).Distinct().Count(),
        types = mons.SelectMany(m => m.Types).GroupBy(t => t).OrderByDescending(g => g.Count()).Take(3).Select(g => new { type = g.Key, count = g.Count() }).ToArray(),
        top = top is null ? null : new { mon = Pic(top.First()), count = top.Count() },
        oldest = mons.Where(m => m.MetDate is not null).OrderBy(m => m.MetDate).Select(Pic).FirstOrDefault(),
        showcase = mons.OrderByDescending(m => m.Shiny).ThenByDescending(m => m.Level).ThenBy(m => m.Species).Take(6).Select(Pic).ToArray(),
    };
}));

// Meadow: berry pictures and friendship (kept by PokeVault, never in the Pokémon itself).
var bonds = new BondService(app.Services.GetRequiredService<AppPaths>());
app.MapGet("/items/{name}.png", async (string name, HttpContext ctx) =>
{
    var file = await sprites.GetItemAsync(name);
    if (file is null) return Results.NotFound();
    ctx.Response.Headers.CacheControl = "public, max-age=604800";
    return Results.File(file, "image/png");
});
app.MapGet("/api/bond/{uid}", (string uid) => Run(() => { var b = bonds.Get(uid); return new { b.Points, b.Hearts, b.Pets, b.Treats }; }));
app.MapPost("/api/bond/{uid}", (string uid, BondRequest r) => Run(() => { var b = bonds.Add(uid, r.Kind, r.Delta); return new { b.Points, b.Hearts, b.Pets, b.Treats }; }));

// A Pokémon's journey: what PokeVault has done with it (by its permanent identity).
// A copy visiting an older game shares the original's story (and its real "met" details).
app.MapGet("/api/journey/{uid}", (string uid) => Run(() =>
{
    var home = vault.All.FirstOrDefault(e => e.Away?.CopyUid == uid);
    var original = home is null ? null : vault.Info(home);
    return new { steps = journey.For(original?.Uid ?? uid), original };
}));

// Stop waiting for a Pokémon that's away: the original is unlocked and the copy in the older game becomes its own Pokémon.
app.MapPost("/api/vault/{id}/end-trip", (string id) => Run(() =>
{
    var e = vault.Find(id) ?? throw new VaultException("That Pokémon isn't in the vault any more.");
    e.Away = null;
    vault.Touch(e);
    vault.Persist();
    return new { ok = true };
}));

// Where to catch a species in each connected game (PKHeX's encounter tables).
var encounters = app.Services.GetRequiredService<EncounterService>();
app.MapGet("/api/dex/{n:int}/where", (int n) => Run(() =>
{
    if (n < 1 || n > DexData.All.Count) throw new VaultException("No such Pokémon.");
    return encounters.Where(n);
}));

if (desktop)
{
    await app.StartAsync();
    var paths = app.Services.GetRequiredService<AppPaths>();
    DesktopWindow.Run($"http://127.0.0.1:{port}/", Path.Combine(paths.DataDir, "window"));
    await app.StopAsync();
    return;
}

Console.WriteLine();
Console.WriteLine("  PokeVault is running.");
Console.WriteLine($"  On this PC:    http://localhost:{port}");
foreach (var u in lanUrls) Console.WriteLine($"  On your phone: {u}   (same Wi-Fi)");
Console.WriteLine(string.IsNullOrEmpty(password)
    ? "  No password set (fine at home; set POKEVAULT_PASSWORD on a server)."
    : "  Password protection is on.");
Console.WriteLine("  Close this window to stop it.");
Console.WriteLine();
app.Run();

static int FreeLoopbackPort()
{
    var l = new TcpListener(System.Net.IPAddress.Loopback, 0);
    l.Start();
    var free = ((System.Net.IPEndPoint)l.LocalEndpoint).Port;
    l.Stop();
    return free;
}

// The project folder (holds wwwroot and data) no matter where the app is started from.
static string FindAppRoot()
{
    for (var dir = new DirectoryInfo(AppContext.BaseDirectory); dir is not null; dir = dir.Parent)
        if (File.Exists(Path.Combine(dir.FullName, "PokeVault.csproj")))
            return dir.FullName;
    return AppContext.BaseDirectory;
}

static string[] GetLanUrls(int port) => NetworkInterface.GetAllNetworkInterfaces()
    .Where(n => n.OperationalStatus == OperationalStatus.Up
             && n.NetworkInterfaceType is NetworkInterfaceType.Wireless80211 or NetworkInterfaceType.Ethernet
             && !n.Description.Contains("Virtual", StringComparison.OrdinalIgnoreCase)
             && !n.Description.Contains("Hyper-V", StringComparison.OrdinalIgnoreCase))
    .SelectMany(n => n.GetIPProperties().UnicastAddresses)
    .Where(a => a.Address.AddressFamily == AddressFamily.InterNetwork && !a.Address.ToString().StartsWith("169.254."))
    .Select(a => $"http://{a.Address}:{port}")
    .Distinct().ToArray();

record DepositRequest(string GameId, List<SlotRef> Slots, bool Copy, int? VaultBox, int? VaultSlot);
record WithdrawRequest(string GameId, List<string> Ids, int? Box, int? Slot);
record MoveRequest(string Id, int Box, int Slot);
record MoveManyRequest(List<string> Ids, int Box);
record IdsRequest(List<string> Ids);
record BoxRequest(string? Name, int? Wallpaper);
record PathRequest(string Path);
record HideRequest(bool Hidden);
record RenameRequest(string Name);
record RestoreRequest(string File);
record SortRequest(string Scope, int Box, string By);
record BondRequest(string Kind, int Delta);
record SmartBox(string? Id, string? Name, string? Q, string? Type, bool Shiny, int Gen, bool Perfect);

record GameMoveRequest(int FromBox, int FromSlot, int ToBox, int ToSlot);
record EmulatorRequest(string Kind, string? Path);
record LinkSaveRequest(string Path, bool KeepPokeVault);
record PickRequest(string? Title, string? Filter, string? Start);
