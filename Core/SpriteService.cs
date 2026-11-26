using System.Collections.Concurrent;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace PokeVault.Core;

/// <summary>
/// Animated sprites from play.pokemonshowdown.com/sprites (ani / ani-shiny). Their server doesn't
/// allow other pages to read the images, so PokeVault fetches each one once and serves it from
/// data/sprites-cache.
/// </summary>
public sealed partial class SpriteService
{
    private const string Base = "https://play.pokemonshowdown.com/sprites/";
    private static readonly string[] Sets = ["ani", "ani-shiny"];
    // Still pictures: pixel box icons (gen5) and HOME-style renders, with their shiny versions.
    private static readonly Dictionary<string, string> Kinds = new()
    {
        ["ani"] = "gif", ["ani-shiny"] = "gif",
        ["gen5"] = "png", ["gen5-shiny"] = "png", ["gen5-back"] = "png", ["gen5-back-shiny"] = "png",
        ["home-centered"] = "png", ["home-centered-shiny"] = "png",
    };
    private const long MaxBytes = 4 * 1024 * 1024;
    private static readonly TimeSpan IndexMaxAge = TimeSpan.FromDays(7);

    private static readonly HttpClient Http = CreateClient();
    private readonly string _dir;
    private readonly string _indexFile;
    private readonly ConcurrentDictionary<string, SemaphoreSlim> _locks = new();

    public SpriteService(AppPaths paths)
    {
        _dir = Path.Combine(paths.DataDir, "sprites-cache");
        _indexFile = Path.Combine(_dir, "index.json");
        Directory.CreateDirectory(_dir);
    }

    private static HttpClient CreateClient()
    {
        var c = new HttpClient { Timeout = TimeSpan.FromSeconds(30) };
        c.DefaultRequestHeaders.UserAgent.ParseAdd("PokeVault/1.0");
        return c;
    }

    [GeneratedRegex("^[a-z0-9-]{1,48}$")] private static partial Regex NameRx();
    [GeneratedRegex("href=\"(?:\\./)?([a-z0-9-]+)\\.gif\"")] private static partial Regex HrefRx();

    /// <summary>Which sprites exist, as { "ani": [names], "ani-shiny": [names] }.</summary>
    public async Task<Dictionary<string, List<string>>> GetIndexAsync()
    {
        var fi = new FileInfo(_indexFile);
        if (fi.Exists && DateTime.UtcNow - fi.LastWriteTimeUtc < IndexMaxAge && ReadIndex() is { Count: > 0 } fresh)
            return fresh;
        try
        {
            var index = new Dictionary<string, List<string>>();
            foreach (var set in Sets)
            {
                var html = await Http.GetStringAsync($"{Base}{set}/");
                index[set] = HrefRx().Matches(html).Select(m => m.Groups[1].Value).Distinct().ToList();
            }
            if (index.Values.Sum(v => v.Count) > 0)
                await File.WriteAllTextAsync(_indexFile, JsonSerializer.Serialize(index));
            return index;
        }
        catch
        {
            return ReadIndex() ?? [];
        }
    }

    private Dictionary<string, List<string>>? ReadIndex()
    {
        try { return JsonSerializer.Deserialize<Dictionary<string, List<string>>>(File.ReadAllText(_indexFile)); }
        catch { return null; }
    }

    /* ---------- high-resolution (512 px) HOME-style pictures from PokeAPI ---------- */

    private const string PokeApiArt = "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/home/";
    private static readonly Dictionary<string, int> SpeciesByName = BuildSpeciesNames();
    private readonly ConcurrentDictionary<string, int> _pokeApiIds = new();

    private static Dictionary<string, int> BuildSpeciesNames()
    {
        var d = new Dictionary<string, int>();
        foreach (var e in DexData.All) d.TryAdd(DexData.ShowdownId(e.N), e.N);
        return d;
    }

    /// <summary>
    /// The 512 px picture for a Showdown-style name ("garchomp", "arcanine-hisui"…), cached in
    /// data/sprites-cache/hires(-shiny). Forms get their PokeAPI number by name (cached too).
    /// </summary>
    public async Task<string?> GetHiResAsync(string name, bool shiny)
    {
        if (!NameRx().IsMatch(name)) return null;
        var file = Path.Combine(_dir, shiny ? "hires-shiny" : "hires", name + ".png");
        if (File.Exists(file)) return file;
        var id = await ResolvePokeApiIdAsync(name);
        if (id <= 0) return null;

        var gate = _locks.GetOrAdd(file, _ => new SemaphoreSlim(1, 1));
        await gate.WaitAsync();
        try
        {
            if (File.Exists(file)) return file;
            using var res = await Http.GetAsync($"{PokeApiArt}{(shiny ? "shiny/" : "")}{id}.png");
            if (!res.IsSuccessStatusCode) return null;
            var bytes = await res.Content.ReadAsByteArrayAsync();
            if (bytes.Length is 0 or > (int)MaxBytes || bytes[0] != 0x89) return null;
            Directory.CreateDirectory(Path.GetDirectoryName(file)!);
            await File.WriteAllBytesAsync(file + ".part", bytes);
            File.Move(file + ".part", file, overwrite: true);
            return file;
        }
        catch (HttpRequestException) { return null; }
        catch (TaskCanceledException) { return null; }
        finally { gate.Release(); }
    }

    /* ---------- cries from PokeAPI (github.com/PokeAPI/cries) ---------- */

    private const string PokeApiCries = "https://raw.githubusercontent.com/PokeAPI/cries/main/cries/pokemon/latest/";

    /// <summary>
    /// The cry for a Showdown-style name ("pikachu", "arcanine-hisui"), cached in data/sprites-cache/cries.
    /// Forms use their own cry when PokeAPI has one, else the species' cry. Returns the file and its media type
    /// (the files are named .ogg but some are really MP3; browsers decode either).
    /// </summary>
    public async Task<(string Path, string Type)?> GetCryAsync(string name)
    {
        if (!NameRx().IsMatch(name)) return null;
        var ids = new List<int>();
        var id = await ResolvePokeApiIdAsync(name);
        if (id > 0) ids.Add(id);
        if (name.Contains('-') && SpeciesByName.TryGetValue(name[..name.IndexOf('-')], out var baseId) && !ids.Contains(baseId)) ids.Add(baseId);
        foreach (var n in ids)
        {
            var file = Path.Combine(_dir, "cries", $"{n}.cry");
            if (!File.Exists(file))
            {
                var gate = _locks.GetOrAdd(file, _ => new SemaphoreSlim(1, 1));
                await gate.WaitAsync();
                try
                {
                    if (!File.Exists(file))
                    {
                        using var res = await Http.GetAsync($"{PokeApiCries}{n}.ogg");
                        if (!res.IsSuccessStatusCode) continue;
                        var bytes = await res.Content.ReadAsByteArrayAsync();
                        if (bytes.Length is < 4 or > 2 * 1024 * 1024 || CryType(bytes) is null) continue;
                        Directory.CreateDirectory(Path.GetDirectoryName(file)!);
                        await File.WriteAllBytesAsync(file + ".part", bytes);
                        File.Move(file + ".part", file, overwrite: true);
                    }
                }
                catch (HttpRequestException) { continue; }
                catch (TaskCanceledException) { continue; }
                finally { gate.Release(); }
            }
            var head = new byte[4];
            await using (var fs = File.OpenRead(file)) _ = await fs.ReadAsync(head);
            if (CryType(head) is { } type) return (file, type);
        }
        return null;
    }

    private static string? CryType(byte[] b) =>
        b.Length < 4 ? null
        : b[0] == 'O' && b[1] == 'g' && b[2] == 'g' && b[3] == 'S' ? "audio/ogg"
        : (b[0] == 'I' && b[1] == 'D' && b[2] == '3') || (b[0] == 0xFF && (b[1] & 0xE0) == 0xE0) ? "audio/mpeg"
        : b[0] == 'R' && b[1] == 'I' && b[2] == 'F' && b[3] == 'F' ? "audio/wav"
        : null;

    private async Task<int> ResolvePokeApiIdAsync(string name)
    {
        if (SpeciesByName.TryGetValue(name, out var species)) return species; // base forms: number = species
        if (_pokeApiIds.TryGetValue(name, out var known)) return known;
        var idsFile = Path.Combine(_dir, "pokeapi-ids.json");
        if (_pokeApiIds.IsEmpty && File.Exists(idsFile))
        {
            try
            {
                foreach (var (k, v) in JsonSerializer.Deserialize<Dictionary<string, int>>(await File.ReadAllTextAsync(idsFile)) ?? [])
                    _pokeApiIds.TryAdd(k, v);
                if (_pokeApiIds.TryGetValue(name, out known)) return known;
            }
            catch { /* rebuild */ }
        }
        int id = 0;
        try
        {
            using var res = await Http.GetAsync($"https://pokeapi.co/api/v2/pokemon/{name}");
            if (res.IsSuccessStatusCode)
            {
                using var doc = JsonDocument.Parse(await res.Content.ReadAsStringAsync());
                id = doc.RootElement.GetProperty("id").GetInt32();
            }
            else if (res.StatusCode != System.Net.HttpStatusCode.NotFound) return 0; // try again later
        }
        catch { return 0; } // offline: try again later
        _pokeApiIds[name] = id; // 0 = PokeAPI has no such form; the app falls back to the 192 px picture
        try { await File.WriteAllTextAsync(idsFile, JsonSerializer.Serialize(_pokeApiIds)); } catch { /* not important */ }
        return id;
    }

    /// <summary>The berries you can feed in the Meadow (PokeAPI's item sprites, fetched once and cached).</summary>
    public static readonly HashSet<string> Berries = ["oran-berry", "cheri-berry", "chesto-berry", "pecha-berry", "rawst-berry", "aspear-berry"];

    public async Task<string?> GetItemAsync(string name)
    {
        if (!Berries.Contains(name)) return null;
        var file = Path.Combine(_dir, "items", $"{name}.png");
        if (File.Exists(file)) return file;
        var gate = _locks.GetOrAdd(file, _ => new SemaphoreSlim(1, 1));
        await gate.WaitAsync();
        try
        {
            if (File.Exists(file)) return file;
            using var res = await Http.GetAsync($"https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/{name}.png");
            if (!res.IsSuccessStatusCode) return null;
            var bytes = await res.Content.ReadAsByteArrayAsync();
            if (bytes.Length is 0 or > (int)MaxBytes || bytes[0] != 0x89) return null;
            Directory.CreateDirectory(Path.GetDirectoryName(file)!);
            await File.WriteAllBytesAsync(file + ".part", bytes);
            File.Move(file + ".part", file, overwrite: true);
            return file;
        }
        catch (HttpRequestException) { return null; }
        catch (TaskCanceledException) { return null; }
        finally { gate.Release(); }
    }

    public async Task<string?> GetSpriteAsync(string set, string name, string ext = "gif")
    {
        if (!Kinds.TryGetValue(set, out var want) || want != ext || !NameRx().IsMatch(name)) return null;
        var file = Path.Combine(_dir, set, $"{name}.{ext}");
        if (File.Exists(file)) return file;

        var gate = _locks.GetOrAdd(file, _ => new SemaphoreSlim(1, 1));
        await gate.WaitAsync();
        try
        {
            if (File.Exists(file)) return file;
            using var res = await Http.GetAsync($"{Base}{set}/{name}.{ext}");
            if (!res.IsSuccessStatusCode) return null;
            var bytes = await res.Content.ReadAsByteArrayAsync();
            if (bytes.Length is 0 or > (int)MaxBytes || bytes[0] != (ext == "gif" ? 'G' : 0x89)) return null;
            Directory.CreateDirectory(Path.GetDirectoryName(file)!);
            await File.WriteAllBytesAsync(file + ".part", bytes);
            File.Move(file + ".part", file, overwrite: true);
            return file;
        }
        catch (HttpRequestException) { return null; }
        catch (TaskCanceledException) { return null; }
        finally { gate.Release(); }
    }
}
