using System.Collections.Concurrent;
using System.Text.Json;
using System.Text.Json.Nodes;
using PKHeX.Core;

namespace PokeVault.Core;

public sealed class VaultEntry
{
    public string Id { get; set; } = "";
    public int Box { get; set; }
    public int Slot { get; set; }
    public string File { get; set; } = "";
    public DateTime Added { get; set; }
    public string Source { get; set; } = "";
}

public sealed class VaultBox
{
    public string Name { get; set; } = "";
    public int Wallpaper { get; set; }
}

public sealed class VaultIndex
{
    public List<VaultBox> Boxes { get; set; } = [];
    public List<VaultEntry> Mons { get; set; } = [];
    /// <summary>Pokédex: species → 1 = registered, 2 = registered shiny (bit flags). Never cleared, like HOME.</summary>
    public Dictionary<int, int> Dex { get; set; } = [];
    /// <summary>2 = boxes moved to the "Match theme" wallpaper once (wallpapers weren't visible before).</summary>
    public int WallpaperVersion { get; set; }
}

/// <summary>
/// The vault: one PKHeX file per Pokémon in data/mons (kept in its original format, like HOME),
/// plus vault.json with box layout and the Pokédex.
/// </summary>
public sealed class VaultService
{
    public const int BoxSize = 30;
    public const int Wallpapers = 25;   // 12 colours + 12 patterns + "Match theme" (drawn in app.css)
    public const int ThemeWallpaper = 24;   // follows the app's colour theme; the default
    private const int StartBoxes = 10;
    private static readonly JsonSerializerOptions Json = new() { WriteIndented = true };

    private readonly AppPaths _paths;
    private readonly VaultIndex _index;
    private readonly ConcurrentDictionary<string, MonInfo> _info = new();

    public VaultService(AppPaths paths)
    {
        _paths = paths;
        ImportLegacyVault();
        _index = LoadIndex();
        // Box wallpapers used to be handed out automatically while the boxes didn't show them; now that they
        // do, every box starts on "Match theme" once (any wallpaper can still be picked per box).
        if (_index.WallpaperVersion < 2)
        {
            foreach (var b in _index.Boxes) b.Wallpaper = ThemeWallpaper;
            _index.WallpaperVersion = 2;
            Persist();
        }
        RecoverOrphans();
        foreach (var e in _index.Mons) TryRegister(e);
    }

    public IReadOnlyList<VaultBox> Boxes => _index.Boxes;
    public IReadOnlyDictionary<int, int> Dex => _index.Dex;
    public int Count => _index.Mons.Count;
    public int CountInBox(int box) => _index.Mons.Count(m => m.Box == box);
    public VaultEntry? Find(string id) => _index.Mons.FirstOrDefault(m => m.Id == id);
    public VaultEntry? At(int box, int slot) => _index.Mons.FirstOrDefault(m => m.Box == box && m.Slot == slot);
    public IEnumerable<VaultEntry> All => _index.Mons;

    public string FilePath(VaultEntry e) => Path.Combine(_paths.MonDir, e.File);

    public PKM Read(VaultEntry e) => ReadFile(FilePath(e)) ?? throw new VaultException("This Pokémon's file is missing or damaged.");

    /// <summary>Summary for display, cached because vault files never change.</summary>
    public MonInfo? Info(VaultEntry e)
    {
        if (_info.TryGetValue(e.Id, out var cached))
            return cached with { Box = e.Box, Slot = e.Slot };
        try
        {
            var info = MonDescriber.Describe(Read(e), e.Box, e.Slot, e);
            _info[e.Id] = info;
            return info;
        }
        catch (VaultException) { return null; }
    }

    public static PKM? ReadFile(string path) =>
        File.Exists(path) ? Parse(File.ReadAllBytes(path), Path.GetFileName(path)) : null;

    /// <summary>
    /// Reads a Pokémon file. The extension (.pk5, .pb8, .pk9, …) decides the exact format: PKHeX's
    /// size-based guessing mixes up some generations (e.g. a .pk5 is read as a Gen 4 BK4).
    /// </summary>
    public static PKM? Parse(byte[] data, string fileName)
    {
        var ext = Path.GetExtension(fileName).TrimStart('.').ToUpperInvariant();
        if (ext.Length is >= 3 and <= 4 && ext.All(char.IsLetterOrDigit)
            && typeof(PKM).Assembly.GetType($"PKHeX.Core.{ext}") is { IsAbstract: false } t && typeof(PKM).IsAssignableFrom(t)
            && t.GetConstructor([typeof(Memory<byte>)]) is { } ctor)
        {
            try
            {
                if (ctor.Invoke([new Memory<byte>(data.ToArray())]) is PKM exact && exact.Species > 0 && exact.ChecksumValid)
                    return exact;
            }
            catch { /* wrong size for this format; fall back to guessing */ }
        }
        var ctx = EntityFileExtension.GetContextFromExtension("." + ext, EntityContext.Gen9);
        var pk = EntityFormat.GetFromBytes(new Memory<byte>(data), ctx);
        return pk is { Species: > 0 } ? pk : null;
    }

    public static byte[] ToBytes(PKM pk)
    {
        var buf = new byte[pk.SIZE_PARTY];
        pk.WriteDecryptedDataParty(buf);
        return buf;
    }

    public void CheckSlot(int box, int slot)
    {
        if (box < 0 || box >= _index.Boxes.Count || slot < 0 || slot >= BoxSize)
            throw new VaultException("That vault slot doesn't exist.");
    }

    public (int Box, int Slot) FirstEmpty(int preferBox = 0)
    {
        if (preferBox < 0 || preferBox >= _index.Boxes.Count) preferBox = 0;
        for (int i = 0; i < _index.Boxes.Count; i++)
        {
            int b = (preferBox + i) % _index.Boxes.Count;
            for (int s = 0; s < BoxSize; s++)
                if (At(b, s) is null)
                    return (b, s);
        }
        return (AddBox(), 0);
    }

    /// <summary>Writes the Pokémon file and adds it to the index (in memory). Call <see cref="Persist"/> after.</summary>
    public VaultEntry Add(PKM pk, int box, int slot, string source)
    {
        CheckSlot(box, slot);
        if (At(box, slot) is not null)
            throw new VaultException("That vault slot is already taken. Pick an empty one.");
        var id = Guid.NewGuid().ToString("N")[..12];
        var file = $"{id}.{pk.Extension}";
        File.WriteAllBytes(Path.Combine(_paths.MonDir, file), ToBytes(pk));
        var e = new VaultEntry { Id = id, Box = box, Slot = slot, File = file, Added = DateTime.Now, Source = source };
        _index.Mons.Add(e);
        Register(pk);
        return e;
    }

    /// <summary>Undo an <see cref="Add"/> that never got committed.</summary>
    public void Discard(VaultEntry e)
    {
        _index.Mons.Remove(e);
        _info.TryRemove(e.Id, out _);
        try { File.Delete(FilePath(e)); } catch { /* recovered on next start */ }
    }

    /// <summary>Takes a Pokémon out of the vault. The file is kept in data/withdrawn or data/released.</summary>
    public void Remove(VaultEntry e, bool released = false)
    {
        _index.Mons.Remove(e);
        _info.TryRemove(e.Id, out _);
        var src = FilePath(e);
        var dir = released ? _paths.ReleasedDir : _paths.WithdrawnDir;
        if (File.Exists(src))
            File.Move(src, Path.Combine(dir, $"{DateTime.Now:yyyyMMdd_HHmmss}_{e.File}"), overwrite: true);
    }

    public void Move(string id, int box, int slot)
    {
        var e = Find(id) ?? throw new VaultException("That Pokémon isn't in the vault any more.");
        CheckSlot(box, slot);
        var other = At(box, slot);
        if (other is not null && other != e)
        {
            other.Box = e.Box;
            other.Slot = e.Slot;
        }
        e.Box = box;
        e.Slot = slot;
        Persist();
    }

    /// <summary>Moves several Pokémon into the empty slots of one box. Returns how many fit.</summary>
    public int MoveToBox(IEnumerable<string> ids, int box)
    {
        CheckSlot(box, 0);
        int moved = 0;
        foreach (var id in ids)
        {
            var e = Find(id);
            if (e is null || e.Box == box) continue;
            int slot = Enumerable.Range(0, BoxSize).FirstOrDefault(s => At(box, s) is null, -1);
            if (slot < 0) break;
            e.Box = box;
            e.Slot = slot;
            moved++;
        }
        Persist();
        return moved;
    }

    public int AddBox()
    {
        _index.Boxes.Add(new VaultBox { Name = $"Box {_index.Boxes.Count + 1}", Wallpaper = ThemeWallpaper });
        Persist();
        return _index.Boxes.Count - 1;
    }

    public void UpdateBox(int box, string? name, int? wallpaper)
    {
        CheckSlot(box, 0);
        if (name is not null)
        {
            name = name.Trim();
            if (name.Length is 0 or > 24) throw new VaultException("Box names must be 1–24 characters.");
            _index.Boxes[box].Name = name;
        }
        if (wallpaper is int w)
            _index.Boxes[box].Wallpaper = Math.Clamp(w, 0, Wallpapers - 1);
        Persist();
    }

    /* ---------------- big rearrangements (sort, Living Dex) and their undo ---------------- */

    public sealed record SlotPos(string Id, int Box, int Slot);
    public sealed record LayoutSnapshot(DateTime Time, string Label, List<string> BoxNames, List<int> Wallpapers, List<SlotPos> Slots);

    private string UndoFile => Path.Combine(_paths.DataDir, "layout-undo.json");

    /// <summary>Where every Pokémon is (and the boxes) right now, to keep as the undo point if a rearrangement changes anything.</summary>
    public LayoutSnapshot Capture(string label) => new(DateTime.Now, label,
        _index.Boxes.Select(b => b.Name).ToList(), _index.Boxes.Select(b => b.Wallpaper).ToList(),
        _index.Mons.Select(m => new SlotPos(m.Id, m.Box, m.Slot)).ToList());

    /// <summary>Keeps this as the layout that "Undo" goes back to.</summary>
    public void Keep(LayoutSnapshot snap)
    {
        var tmp = UndoFile + ".tmp";
        File.WriteAllText(tmp, JsonSerializer.Serialize(snap));
        File.Move(tmp, UndoFile, overwrite: true);
    }

    public LayoutSnapshot? Snapshot()
    {
        try { return File.Exists(UndoFile) ? JsonSerializer.Deserialize<LayoutSnapshot>(File.ReadAllText(UndoFile)) : null; }
        catch { return null; }
    }

    /// <summary>
    /// Puts every Pokémon back where it was before the last rearrangement. Pokémon added since then keep
    /// their place if it's free, or go to the first empty slot. Boxes added by the rearrangement are removed when empty.
    /// </summary>
    public int UndoLayout()
    {
        var snap = Snapshot() ?? throw new VaultException("There's nothing to undo.");
        var byId = snap.Slots.ToDictionary(s => s.Id);
        // Old box list back (names and wallpapers), keeping any extra box that still holds Pokémon.
        for (int i = 0; i < snap.BoxNames.Count; i++)
        {
            if (i >= _index.Boxes.Count) _index.Boxes.Add(new VaultBox());
            _index.Boxes[i].Name = snap.BoxNames[i];
            _index.Boxes[i].Wallpaper = i < snap.Wallpapers.Count ? snap.Wallpapers[i] : ThemeWallpaper;
        }
        int restored = 0;
        var newcomers = new List<VaultEntry>();
        foreach (var m in _index.Mons)
        {
            if (byId.TryGetValue(m.Id, out var p)) { m.Box = p.Box; m.Slot = p.Slot; restored++; }
            else newcomers.Add(m);
        }
        foreach (var m in newcomers)
        {
            if (_index.Mons.Any(o => o != m && o.Box == m.Box && o.Slot == m.Slot) || m.Box >= _index.Boxes.Count)
            {
                m.Box = -1;
                var (b, s) = FirstEmpty();
                m.Box = b; m.Slot = s;
            }
        }
        while (_index.Boxes.Count > snap.BoxNames.Count && !_index.Mons.Any(m => m.Box == _index.Boxes.Count - 1))
            _index.Boxes.RemoveAt(_index.Boxes.Count - 1);
        Persist();
        File.Delete(UndoFile);
        return restored;
    }

    /// <summary>Adds a box with this name and returns its number.</summary>
    public int AddBox(string name)
    {
        _index.Boxes.Add(new VaultBox { Name = name.Length > 24 ? name[..24] : name, Wallpaper = ThemeWallpaper });
        return _index.Boxes.Count - 1;
    }

    /// <summary>Gives Pokémon new places all at once (the caller makes sure no two share a slot).</summary>
    public void Place(IEnumerable<(VaultEntry Entry, int Box, int Slot)> moves)
    {
        foreach (var (e, b, s) in moves) { e.Box = b; e.Slot = s; }
        Persist();
    }

    private void Register(PKM pk)
    {
        if (pk.IsEgg || pk.Species == 0) return;
        _index.Dex.TryGetValue(pk.Species, out var flags);
        _index.Dex[pk.Species] = flags | 1 | (pk.IsShiny ? 2 : 0);
    }

    private void TryRegister(VaultEntry e)
    {
        try { Register(Read(e)); } catch { /* ignore */ }
    }

    public void Persist()
    {
        var tmp = _paths.IndexFile + ".tmp";
        File.WriteAllText(tmp, JsonSerializer.Serialize(_index, Json));
        File.Move(tmp, _paths.IndexFile, overwrite: true);
    }

    private VaultIndex LoadIndex()
    {
        var idx = new VaultIndex();
        if (File.Exists(_paths.IndexFile))
        {
            try
            {
                var root = JsonNode.Parse(File.ReadAllText(_paths.IndexFile))!.AsObject();
                // Boxes used to be plain names; accept both.
                foreach (var b in root["Boxes"]?.AsArray() ?? [])
                    idx.Boxes.Add(b is JsonValue v
                        ? new VaultBox { Name = v.GetValue<string>(), Wallpaper = ThemeWallpaper }
                        : b.Deserialize<VaultBox>() ?? new VaultBox { Name = $"Box {idx.Boxes.Count + 1}" });
                idx.Mons = root["Mons"]?.Deserialize<List<VaultEntry>>() ?? [];
                idx.Dex = root["Dex"]?.Deserialize<Dictionary<int, int>>() ?? [];
                idx.WallpaperVersion = root["WallpaperVersion"]?.GetValue<int>() ?? 0;
            }
            catch
            {
                // Keep the broken file for inspection and rebuild from the Pokémon files.
                File.Copy(_paths.IndexFile, _paths.IndexFile + $".broken_{DateTime.Now:yyyyMMdd_HHmmss}", true);
                idx = new VaultIndex();
            }
        }
        while (idx.Boxes.Count < StartBoxes)
            idx.Boxes.Add(new VaultBox { Name = $"Box {idx.Boxes.Count + 1}", Wallpaper = ThemeWallpaper });
        return idx;
    }

    /// <summary>
    /// One-time move from where an earlier PokeVault.exe kept its vault (%LOCALAPPDATA%\PokeVault):
    /// every Pokémon file not already in this vault (same bytes) is copied in, and then gets a free
    /// slot through <see cref="RecoverOrphans"/>. The old folder itself is left untouched.
    /// </summary>
    private void ImportLegacyVault()
    {
        var legacyMons = Path.Combine(_paths.LegacyDataDir, "mons");
        var marker = Path.Combine(_paths.DataDir, "imported-from-old-location.txt");
        if (File.Exists(marker) || !Directory.Exists(legacyMons)
            || string.Equals(Path.GetFullPath(_paths.LegacyDataDir), Path.GetFullPath(_paths.DataDir), StringComparison.OrdinalIgnoreCase))
            return;

        static string Hash(string file) => Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(File.ReadAllBytes(file)));
        var have = Directory.EnumerateFiles(_paths.MonDir).Select(Hash).ToHashSet();
        int copied = 0;
        foreach (var f in Directory.EnumerateFiles(legacyMons))
        {
            if (ReadFile(f) is null || !have.Add(Hash(f))) continue;
            var dest = Path.Combine(_paths.MonDir, Path.GetFileName(f));
            if (File.Exists(dest)) dest = Path.Combine(_paths.MonDir, $"{Guid.NewGuid():N}"[..12] + Path.GetExtension(f));
            File.Copy(f, dest);
            copied++;
        }
        File.WriteAllText(marker, $"{DateTime.Now:O}: copied {copied} Pokémon from {_paths.LegacyDataDir}{Environment.NewLine}");
    }

    /// <summary>Any Pokémon file in data/mons that the index doesn't know about gets a slot again.</summary>
    private void RecoverOrphans()
    {
        var known = _index.Mons.Select(m => m.File).ToHashSet(StringComparer.OrdinalIgnoreCase);
        bool changed = false;
        foreach (var f in Directory.EnumerateFiles(_paths.MonDir))
        {
            var name = Path.GetFileName(f);
            if (known.Contains(name) || ReadFile(f) is null) continue;
            var (b, s) = FirstEmpty();
            _index.Mons.Add(new VaultEntry
            {
                Id = Path.GetFileNameWithoutExtension(name), Box = b, Slot = s, File = name,
                Added = File.GetCreationTime(f), Source = "Recovered",
            });
            changed = true;
        }
        // Drop index entries whose file vanished.
        changed |= _index.Mons.RemoveAll(m => !File.Exists(FilePath(m))) > 0;
        if (changed || !File.Exists(_paths.IndexFile))
            Persist();
    }
}
