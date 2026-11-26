using System.Diagnostics;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using PKHeX.Core;

namespace PokeVault.Core;

/// <summary>A connected game save: found in Ryujinx, added from a path on the PC, or uploaded.</summary>
public sealed record GameSource(
    string Id, string Kind, string Path, string FileName,
    string Game, string Version, int Generation,
    string? Trainer, string? Tid, string? PlayTime, DateTime LastWrite,
    bool Supported, string? Problem,
    int BoxCount, int SlotsPerBox, int Pokemon, bool CanMove, bool CanRename, bool Hidden = false);

/// <summary>Finds, reads and safely writes every kind of save PKHeX understands.</summary>
public sealed class GameService
{
    private const int KeepBackups = 40;

    // Only used to label Ryujinx saves that PKHeX can't read.
    private static readonly Dictionary<ulong, string> Titles = new()
    {
        [0x0100A3D008C5C000] = "Scarlet", [0x01008F6008C5E000] = "Violet",
        [0x0100ABF008968000] = "Sword", [0x01008DB008C2C000] = "Shield",
        [0x0100000011D90000] = "Brilliant Diamond", [0x010018E011D92000] = "Shining Pearl",
        [0x01001F5010DFA000] = "Legends: Arceus", [0x010003F003A34000] = "Let's Go, Pikachu!",
        [0x0100187003A36000] = "Let's Go, Eevee!", [0x0100F43008C44000] = "Legends: Z-A",
    };
    private static readonly string[] PreferredNames = ["main", "SaveData.bin", "savedata.bin"];

    private readonly AppPaths _paths;
    private readonly CatchWatcher _watcher;
    private Settings _settings;
    private readonly Dictionary<string, (DateTime Time, long Len, SaveFile? Sav, GameSource Info)> _cache = new(StringComparer.OrdinalIgnoreCase);
    private readonly Dictionary<string, (DateTime Stamp, string? File)> _ryuDirs = new(StringComparer.OrdinalIgnoreCase);

    public GameService(AppPaths paths, CatchWatcher watcher)
    {
        _paths = paths;
        _watcher = watcher;
        _settings = ReadSettings();
        Directory.CreateDirectory(_paths.UploadDir);
    }

    public static bool EmulatorRunning => Process.GetProcessesByName("Ryujinx").Length > 0;

    public string? LastGame
    {
        get => _settings.LastGame;
        set { if (_settings.LastGame != value) { _settings.LastGame = value; WriteSettings(); } }
    }

    /* ---------------- listing ---------------- */

    public List<GameSource> List()
    {
        var list = new List<GameSource>();
        foreach (var (id, path, title) in DiscoverRyujinx())
            list.Add(Describe(id, "ryujinx", path, title));
        foreach (var p in _settings.Paths)
            list.Add(Describe(p.Id, "path", p.Path, null));
        foreach (var u in _settings.Uploads)
            list.Add(Describe(u.Id, "upload", Path.Combine(_paths.UploadDir, u.Id, u.FileName), null));
        var hidden = _settings.Hidden.ToHashSet();
        return list
            .Select(g => hidden.Contains(g.Id) ? g with { Hidden = true } : g)
            .OrderBy(g => g.Hidden)
            .ThenByDescending(g => g.Supported)
            .ThenBy(g => g.Kind switch { "ryujinx" => 0, "path" => 1, _ => 2 })
            .ThenByDescending(g => g.LastWrite)
            .ToList();
    }

    public GameSource Get(string id) =>
        List().FirstOrDefault(g => g.Id == id) ?? throw new VaultException("That game isn't connected any more.");

    private IEnumerable<(string Id, string Path, string? Title)> DiscoverRyujinx()
    {
        foreach (var root in _paths.SaveRoots.Where(Directory.Exists).Distinct(StringComparer.OrdinalIgnoreCase))
        {
            foreach (var dir in Directory.EnumerateDirectories(root))
            {
                var committed = Path.Combine(dir, "0");
                if (!Directory.Exists(committed)) continue;
                string? title = null;
                try
                {
                    var extra = Path.Combine(dir, "ExtraData0");
                    if (File.Exists(extra))
                    {
                        var b = File.ReadAllBytes(extra);
                        if (b.Length >= 8 && Titles.TryGetValue(BitConverter.ToUInt64(b, 0), out var t)) title = t;
                    }
                }
                catch { /* ignore */ }

                var file = FindSaveFile(committed, title is not null);
                if (file is not null)
                    yield return ($"ryu-{new DirectoryInfo(dir).Name}", file, title);
            }
        }
    }

    // Picks the file inside a Ryujinx save folder that PKHeX can read (remembered until the folder changes).
    private string? FindSaveFile(string committed, bool knownPokemonTitle)
    {
        var stamp = Directory.GetLastWriteTimeUtc(committed);
        var files = Directory.GetFiles(committed);
        if (files.Length > 0) stamp = new[] { stamp }.Concat(files.Select(File.GetLastWriteTimeUtc)).Max();
        if (_ryuDirs.TryGetValue(committed, out var c) && c.Stamp == stamp)
            return c.File;

        string? found = null;
        var ordered = files.OrderBy(f => Array.IndexOf(PreferredNames, Path.GetFileName(f)) is var i && i >= 0 ? i : 99);
        foreach (var f in ordered)
        {
            var len = new FileInfo(f).Length;
            if (!SaveUtil.IsSizeValid(len)) continue;
            try
            {
                if (SaveUtil.GetSaveFile(new Memory<byte>(File.ReadAllBytes(f)), f) is not null) { found = f; break; }
            }
            catch { /* not a save */ }
        }
        // Show known Pokémon titles even when unreadable, so the user knows why.
        if (found is null && knownPokemonTitle)
            found = ordered.FirstOrDefault(f => Path.GetFileName(f) == "main") ?? files.FirstOrDefault();
        _ryuDirs[committed] = (stamp, found);
        return found;
    }

    private GameSource Describe(string id, string kind, string path, string? title)
    {
        DateTime time = default;
        long len = 0;
        try
        {
            var fi = new FileInfo(path);
            if (!fi.Exists) return Unsupported(id, kind, path, title, default, "The file is missing.");
            time = fi.LastWriteTimeUtc;
            len = fi.Length;
            if (_cache.TryGetValue(path, out var c) && c.Time == time && c.Len == len && c.Info.Id == id)
                return c.Info;

            var sav = Parse(File.ReadAllBytes(path), path);
            int count = 0;
            for (int b = 0; b < sav.BoxCount; b++)
                for (int s = 0; s < sav.BoxSlotCount; s++)
                    if (sav.GetBoxSlotAtIndex(b, s).Species != 0) count++;

            var info = new GameSource(id, kind, path, Path.GetFileName(path),
                GameName(sav), sav.Version.ToString(), sav.Generation,
                sav.OT, FormatTid(sav), sav.PlayTimeString.Replace('ː', ':'), fi.LastWriteTime,
                true, null, sav.BoxCount, sav.BoxSlotCount, count, CanMoveOut(sav), CanRenameBoxes(sav));
            _cache[path] = (time, len, sav, info);
            // The save is new or changed on disk: look for Pokémon that weren't there before.
            _watcher.Observe(id, info.Game, sav);
            return info;
        }
        catch (Exception ex)
        {
            var info = Unsupported(id, kind, path, title, time == default ? default : time.ToLocalTime(), ex is VaultException ? ex.Message : "PKHeX couldn't read this file.");
            _cache[path] = (time, len, null, info);
            return info;
        }
    }

    private static GameSource Unsupported(string id, string kind, string path, string? title, DateTime time, string problem) =>
        new(id, kind, path, Path.GetFileName(path), title ?? "Unknown save", "", 0, null, null, null, time,
            false, problem, 0, 0, 0, false, false);

    public static string GameName(SaveFile sav)
    {
        var name = GameInfo.GetVersionName(sav.Version);
        if (!string.IsNullOrWhiteSpace(name) && name != sav.Version.ToString()) return name;
        // Gen 1/2 saves can't tell the paired games apart, so name the pair.
        return sav.Version switch
        {
            GameVersion.RB or GameVersion.RBY => "Red / Blue",
            GameVersion.GS or GameVersion.GSC => "Gold / Silver",
            _ => sav.GetType().Name.Replace("SAV", "Gen "),
        };
    }

    private static string FormatTid(SaveFile sav) =>
        sav.Generation >= 7 ? sav.DisplayTID.ToString("000000") : sav.DisplayTID.ToString("00000");

    // Let's Go keeps its storage as one packed list, so taking Pokémon out of it is left to PKHeX itself.
    public static bool CanMoveOut(SaveFile sav) => sav is not SAV7b;

    public static string BoxName(SaveFile sav, int box)
    {
        try
        {
            if (sav is IBoxDetailNameRead r && r.GetBoxName(box) is { Length: > 0 } s) return s;
        }
        catch { /* some saves have no names */ }
        return $"Box {box + 1}";
    }

    public static bool CanRenameBoxes(SaveFile sav) => sav is IBoxDetailName;

    /// <summary>Renames a box inside the game save itself.</summary>
    public void RenameBox(string id, int box, string name)
    {
        EnsureWritable(id);
        var sav = LoadForEditing(id);
        if (sav is not IBoxDetailName n)
            throw new VaultException($"{GameName(sav)} doesn't support box names.");
        if (box < 0 || box >= sav.BoxCount) throw new VaultException("No such box.");
        name = name.Trim();
        int max = sav.Generation <= 5 ? 8 : 16;
        if (name.Length == 0 || name.Length > max)
            throw new VaultException($"{GameName(sav)} box names must be 1–{max} characters.");
        n.SetBoxName(box, name);
        Write(id, sav);
    }

    /* ---------------- reading & writing ---------------- */

    /// <summary>Cached copy for showing boxes. Never modify it.</summary>
    public SaveFile LoadForReading(string id)
    {
        var g = Get(id);
        if (!g.Supported) throw new VaultException(g.Problem ?? "This save can't be read.");
        if (_cache.TryGetValue(g.Path, out var c) && c.Sav is not null) return c.Sav;
        return Parse(File.ReadAllBytes(g.Path), g.Path);
    }

    /// <summary>A fresh copy from disk, safe to modify and pass to <see cref="Write"/>.</summary>
    public SaveFile LoadForEditing(string id)
    {
        var g = Get(id);
        if (!g.Supported) throw new VaultException(g.Problem ?? "This save can't be read.");
        return Parse(File.ReadAllBytes(g.Path), g.Path);
    }

    public void EnsureWritable(string id)
    {
        var g = Get(id);
        if (IsRyujinx(g) && EmulatorRunning)
            throw new VaultException("Ryujinx is open. Close Ryujinx completely before moving Pokémon in or out of a Ryujinx save, otherwise the game would overwrite the change.");
    }

    private static bool IsRyujinx(GameSource g) =>
        g.Kind == "ryujinx" || g.Path.Contains($"{Path.DirectorySeparatorChar}Ryujinx{Path.DirectorySeparatorChar}", StringComparison.OrdinalIgnoreCase);

    public void Write(string id, SaveFile sav)
    {
        EnsureWritable(id);
        var g = Get(id);
        var bytes = sav.Write(BinaryExportSetting.None).ToArray();

        // Make sure what we are about to write reads back as a save before touching the real file.
        _ = Parse(bytes.ToArray(), g.Path);
        Commit(g, bytes, sav);
    }

    // Backs up and replaces the save file (and Ryujinx's working copy), then forgets the cached copy.
    private void Commit(GameSource g, byte[] bytes, SaveFile sav)
    {
        EnsureOriginalBackup(g);
        var targets = new List<string> { g.Path };
        // Ryujinx keeps the committed save in "<id>\0\" and a working copy in "<id>\1\". Keep them identical.
        var dir = Directory.GetParent(g.Path);
        if (IsRyujinx(g) && dir is { Name: "0", Parent: not null })
        {
            var working = Path.Combine(dir.Parent.FullName, "1", Path.GetFileName(g.Path));
            if (File.Exists(working)) targets.Add(working);
        }
        foreach (var t in targets)
        {
            Backup(g, t);
            WriteAtomic(t, bytes);
        }
        // PokeVault's own change (a withdraw, a box move…) is not a catch: remember it quietly.
        _watcher.Observe(g.Id, g.Game, sav, silent: true);
        _cache.Remove(g.Path);
        PruneBackups();
    }

    private static SaveFile Parse(byte[] data, string path)
    {
        var sav = SaveUtil.GetSaveFile(new Memory<byte>(data), path)
            ?? throw new VaultException("PKHeX couldn't read this file as a Pokémon save.");
        if (!sav.HasBox) throw new VaultException("This save has no Pokémon boxes.");
        return sav;
    }

    /* ---------------- adding / removing ---------------- */

    public GameSource AddPath(string path)
    {
        path = Path.GetFullPath(path.Trim().Trim('"'));
        if (!File.Exists(path)) throw new VaultException("No file at that path.");
        var existing = List().FirstOrDefault(g => string.Equals(g.Path, path, StringComparison.OrdinalIgnoreCase));
        if (existing is not null) return existing;
        _ = Parse(File.ReadAllBytes(path), path);
        var id = "path-" + Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(path.ToLowerInvariant())))[..10].ToLowerInvariant();
        _settings.Paths.Add(new AddedPath { Id = id, Path = path });
        WriteSettings();
        return Get(id);
    }

    public GameSource AddUpload(string fileName, byte[] data)
    {
        fileName = Path.GetFileName(fileName);
        if (fileName.Length == 0 || fileName.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0) fileName = "save.sav";
        var id = "up-" + Guid.NewGuid().ToString("N")[..10];
        var dir = Path.Combine(_paths.UploadDir, id);
        var path = Path.Combine(dir, fileName);
        _ = Parse(data.ToArray(), path);
        Directory.CreateDirectory(dir);
        File.WriteAllBytes(path, data);
        _settings.Uploads.Add(new UploadedSave { Id = id, FileName = fileName });
        WriteSettings();
        return Get(id);
    }

    /// <summary>Hides a game from the lists (e.g. an old Ryujinx save that can't be read). Nothing is deleted.</summary>
    public void SetHidden(string id, bool hidden)
    {
        _settings.Hidden.Remove(id);
        if (hidden) _settings.Hidden.Add(id);
        if (hidden && _settings.LastGame == id) _settings.LastGame = null;
        WriteSettings();
    }

    public void Remove(string id)
    {
        _settings.Hidden.Remove(id);
        if (_settings.Paths.RemoveAll(p => p.Id == id) > 0) { WriteSettings(); return; }
        var up = _settings.Uploads.FirstOrDefault(u => u.Id == id)
            ?? throw new VaultException("Ryujinx saves are found automatically and can't be removed here.");
        _settings.Uploads.Remove(up);
        WriteSettings();
        // Keep the uploaded copy (it may hold Pokémon you sent into it), just out of the way.
        var src = Path.Combine(_paths.UploadDir, id);
        if (Directory.Exists(src))
            Directory.Move(src, Path.Combine(_paths.UploadDir, $"removed_{DateTime.Now:yyyyMMdd_HHmmss}_{id}"));
    }

    /* ---------------- backups ---------------- */

    public sealed record BackupInfo(string File, DateTime Time, bool Original, int Pokemon, string? PlayTime, string? Trainer);

    private static readonly System.Text.RegularExpressions.Regex BackupStamp = new(@"_(\d{8}_\d{6})(?:_\d{3})?_");

    // The backup files of one game: its first-ever copy ("original_…") and the automatic ones made before each write.
    private IEnumerable<FileInfo> BackupFiles(GameSource g)
    {
        var slug = Slug(g);
        var part = Directory.GetParent(g.Path)?.Name ?? "";
        var dir = new DirectoryInfo(_paths.BackupDir);
        return dir.GetFiles($"auto_{slug}_{part}_*").Concat(dir.GetFiles($"original_{slug}_*"));
    }

    private static DateTime BackupTime(FileInfo f) =>
        BackupStamp.Match(f.Name) is { Success: true } m && DateTime.TryParseExact(m.Groups[1].Value, "yyyyMMdd_HHmmss",
            System.Globalization.CultureInfo.InvariantCulture, System.Globalization.DateTimeStyles.None, out var t) ? t : f.CreationTime;

    /// <summary>The newest backups of a game (up to 30) with what's inside each.</summary>
    public List<BackupInfo> ListBackups(string id)
    {
        var g = Get(id);
        var list = new List<BackupInfo>();
        foreach (var f in BackupFiles(g).OrderByDescending(BackupTime).Take(30))
        {
            int count = -1; string? play = null, ot = null;
            try
            {
                var sav = Parse(File.ReadAllBytes(f.FullName), g.Path);
                count = 0;
                for (int b = 0; b < sav.BoxCount; b++)
                    for (int s = 0; s < sav.BoxSlotCount; s++)
                        if (sav.GetBoxSlotAtIndex(b, s).Species != 0) count++;
                play = sav.PlayTimeString.Replace('ː', ':');
                ot = sav.OT;
            }
            catch { /* unreadable backup: still listed, but can't be restored */ }
            list.Add(new BackupInfo(f.Name, BackupTime(f), f.Name.StartsWith("original_"), count, play, ot));
        }
        return list;
    }

    /// <summary>
    /// Puts a backup back as the game's save. The current save is backed up first, so a restore can be undone too.
    /// </summary>
    public void Restore(string id, string file)
    {
        EnsureWritable(id);
        var g = Get(id);
        var f = BackupFiles(g).FirstOrDefault(x => x.Name == file)
            ?? throw new VaultException("That backup isn't one of this game's backups.");
        var bytes = File.ReadAllBytes(f.FullName);
        var sav = Parse(bytes.ToArray(), g.Path);   // only a backup that reads as this kind of save goes back
        Commit(g, bytes, sav);
    }

    private void EnsureOriginalBackup(GameSource g)
    {
        var name = $"original_{Slug(g)}";
        if (Directory.EnumerateFiles(_paths.BackupDir, name + "*").Any()) return;
        File.Copy(g.Path, Path.Combine(_paths.BackupDir, $"{name}_{DateTime.Now:yyyyMMdd_HHmmss}_{g.FileName}"));
    }

    private void Backup(GameSource g, string file)
    {
        var part = Directory.GetParent(file)?.Name ?? "";
        var dest = Path.Combine(_paths.BackupDir, $"auto_{Slug(g)}_{part}_{DateTime.Now:yyyyMMdd_HHmmss_fff}_{Path.GetFileName(file)}");
        File.Copy(file, dest, overwrite: true);
    }

    private static string Slug(GameSource g) =>
        $"{g.Id}_{new string(g.Game.Where(char.IsLetterOrDigit).ToArray())}";

    private void PruneBackups()
    {
        foreach (var f in new DirectoryInfo(_paths.BackupDir).GetFiles("auto_*")
                     .OrderByDescending(f => f.CreationTimeUtc).Skip(KeepBackups * 2))
            try { f.Delete(); } catch { /* not important */ }
    }

    private static void WriteAtomic(string path, byte[] data)
    {
        var tmp = path + ".pokevault.tmp";
        File.WriteAllBytes(tmp, data);
        File.Move(tmp, path, overwrite: true);
    }

    /* ---------------- settings ---------------- */

    private sealed class AddedPath { public string Id { get; set; } = ""; public string Path { get; set; } = ""; }
    private sealed class UploadedSave { public string Id { get; set; } = ""; public string FileName { get; set; } = ""; }
    private sealed class Settings
    {
        public string? LastGame { get; set; }
        public List<string> Hidden { get; set; } = [];
        public List<AddedPath> Paths { get; set; } = [];
        public List<UploadedSave> Uploads { get; set; } = [];
    }

    private Settings ReadSettings()
    {
        try { return JsonSerializer.Deserialize<Settings>(File.ReadAllText(_paths.SettingsFile)) ?? new(); }
        catch { return new(); }
    }

    private void WriteSettings() =>
        File.WriteAllText(_paths.SettingsFile, JsonSerializer.Serialize(_settings, new JsonSerializerOptions { WriteIndented = true }));
}
