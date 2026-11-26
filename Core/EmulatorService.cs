using System.Diagnostics;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace PokeVault.Core;

/// <summary>An emulator PokeVault can start games in.</summary>
public sealed record EmulatorInfo(string Kind, string Name, string Systems, string? Exe, bool Found, bool Running, string GetFrom);

/// <summary>How one connected game is played: which emulator, which game file, and where its save lives.</summary>
public sealed record PlayGame(
    string Id, string Game, string Version, int Generation, string? Trainer, string? PlayTime,
    string? Emulator, string? EmulatorName, string? Rom, bool RomFound,
    string SaveKind, string SavePath, DateTime SaveTime,
    string? RealSave, DateTime? RealSaveTime, bool CanPlaceSave, string? Running, string? Note, string[] Away, string[] Choices);

/// <summary>
/// The Play section: finds the emulators already on this PC (Ryujinx, Citra and its successors, mGBA,
/// melonDS), remembers the game file chosen for each connected game, starts it, and tells PokeVault
/// which saves are in use so nothing writes to a save while its emulator could overwrite it.
/// Nothing is downloaded: emulators and games are the ones you already have.
/// </summary>
public sealed class EmulatorService
{
    private sealed record Def(string Kind, string Name, string Systems, string[] Exes, string GetFrom);

    private static readonly Def[] Defs =
    [
        new("ryujinx", "Ryujinx", "Switch", ["Ryujinx.exe", "Ryujinx.Ava.exe"], "ryujinx.app"),
        new("sudachi", "Sudachi", "Switch", ["sudachi.exe"], "the Sudachi project"),
        new("citra", "Citra", "3DS", ["citra-qt.exe", "azahar.exe", "lime3ds-gui.exe", "lime3ds.exe", "mandarine-qt.exe", "citra.exe"], "azahar-emu.org"),
        new("melonds", "melonDS", "DS", ["melonDS.exe"], "melonds.kuribo64.net"),
        new("mgba", "mGBA", "GBA · Game Boy", ["mGBA.exe"], "mgba.io"),
    ];

    private readonly GameService _games;
    private readonly string _file;
    private readonly object _lock = new();
    private Store _store;
    private Dictionary<string, string?>? _found;   // detected emulator paths (null = not found)

    private sealed class Store
    {
        public Dictionary<string, string> Exes { get; set; } = [];   // kind → exe chosen by hand
        public Dictionary<string, string> Roms { get; set; } = [];   // game id → game file
        public Dictionary<string, string> Emus { get; set; } = [];   // game id → the emulator chosen for it (e.g. Sudachi instead of Ryujinx)
    }

    public EmulatorService(AppPaths paths, GameService games)
    {
        _games = games;
        _file = Path.Combine(paths.DataDir, "emulators.json");
        try { _store = JsonSerializer.Deserialize<Store>(File.ReadAllText(_file)) ?? new(); } catch { _store = new(); }
        // A game's real save can't be written while the emulator playing it is open.
        games.InUse = g => KindOf(g) is { } k && g.Kind != "upload" && IsRunning(k) ? Defs.First(d => d.Kind == k).Name : null;
    }

    /* ---------------- emulators ---------------- */

    public List<EmulatorInfo> Emulators()
    {
        var found = Detect();
        return Defs.Select(d =>
        {
            var exe = _store.Exes.TryGetValue(d.Kind, out var chosen) && File.Exists(chosen) ? chosen : found.GetValueOrDefault(d.Kind);
            return new EmulatorInfo(d.Kind, d.Name, d.Systems, exe, exe is not null, IsRunning(d.Kind), d.GetFrom);
        }).ToList();
    }

    public void SetExe(string kind, string? path)
    {
        var d = Defs.FirstOrDefault(x => x.Kind == kind) ?? throw new VaultException("Unknown emulator.");
        lock (_lock)
        {
            if (path is null) { _store.Exes.Remove(kind); _found = null; }
            else
            {
                path = Path.GetFullPath(path.Trim().Trim('"'));
                if (!File.Exists(path) || !path.EndsWith(".exe", StringComparison.OrdinalIgnoreCase))
                    throw new VaultException($"Pick the {d.Name} program (an .exe file).");
                _store.Exes[kind] = path;
            }
            Save();
        }
    }

    // Which programs are running, looked up at most every 1.5 s (game lists ask often).
    private static HashSet<string> _procs = [];
    private static DateTime _procsAt;
    private static readonly object ProcLock = new();
    private bool IsRunning(string kind)
    {
        // its usual program names, plus the program you chose for it (it may be renamed)
        var names = Defs.First(d => d.Kind == kind).Exes.Select(Path.GetFileNameWithoutExtension).ToList();
        if (_store.Exes.TryGetValue(kind, out var chosen)) names.Add(Path.GetFileNameWithoutExtension(chosen));
        lock (ProcLock)
        {
            if (DateTime.UtcNow - _procsAt > TimeSpan.FromSeconds(1.5))
            {
                try { _procs = Process.GetProcesses().Select(p => p.ProcessName).ToHashSet(StringComparer.OrdinalIgnoreCase); } catch { _procs = []; }
                _procsAt = DateTime.UtcNow;
            }
            return names.Any(n => n is not null && _procs.Contains(n));
        }
    }

    private string? ExeFor(string kind) => Emulators().FirstOrDefault(e => e.Kind == kind)?.Exe;

    /// <summary>Looks for each emulator once: running programs, Desktop and Start menu shortcuts, then usual folders.</summary>
    private Dictionary<string, string?> Detect()
    {
        lock (_lock)
        {
            if (_found is not null) return _found;
            var hits = new List<string>();
            try
            {
                foreach (var p in Process.GetProcesses())
                    try { if (p.MainModule?.FileName is { } f) hits.Add(f); } catch { /* not ours to read */ }
            }
            catch { /* ignore */ }
            hits.AddRange(ShortcutTargets());
            hits.AddRange(SearchFolders());
            _found = Defs.ToDictionary(d => d.Kind, d => hits.FirstOrDefault(h =>
                d.Exes.Any(e => string.Equals(Path.GetFileName(h), e, StringComparison.OrdinalIgnoreCase)) && File.Exists(h)));
            return _found;
        }
    }

    private static IEnumerable<string> ShortcutTargets()
    {
        var dirs = new[]
        {
            Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory),
            Environment.GetFolderPath(Environment.SpecialFolder.CommonDesktopDirectory),
            Environment.GetFolderPath(Environment.SpecialFolder.StartMenu),
            Environment.GetFolderPath(Environment.SpecialFolder.CommonStartMenu),
        };
        var lnks = dirs.Where(Directory.Exists).SelectMany(d =>
        {
            try { return Directory.EnumerateFiles(d, "*.lnk", new EnumerationOptions { RecurseSubdirectories = true, MaxRecursionDepth = 3, IgnoreInaccessible = true }); }
            catch { return []; }
        }).Where(f => Regex.IsMatch(Path.GetFileName(f), "ryujinx|citra|azahar|lime|mandarine|melon|mgba", RegexOptions.IgnoreCase)).ToList();
        if (lnks.Count == 0) yield break;
        dynamic? shell = null;
        try { shell = Activator.CreateInstance(Type.GetTypeFromProgID("WScript.Shell")!); } catch { /* no COM */ }
        if (shell is null) yield break;
        foreach (var l in lnks)
        {
            string? target = null;
            try { target = (string)shell.CreateShortcut(l).TargetPath; } catch { /* broken shortcut */ }
            if (!string.IsNullOrEmpty(target)) yield return target;
        }
    }

    private static IEnumerable<string> SearchFolders()
    {
        var home = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
        var roots = new[]
        {
            Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),
            Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs"),
            Path.Combine(home, "Downloads"), Path.Combine(home, "Desktop"), Path.Combine(home, "Documents"),
        };
        var names = Defs.SelectMany(d => d.Exes).ToHashSet(StringComparer.OrdinalIgnoreCase);
        foreach (var r in roots.Where(Directory.Exists))
        {
            IEnumerable<string> files;
            try { files = Directory.EnumerateFiles(r, "*.exe", new EnumerationOptions { RecurseSubdirectories = true, MaxRecursionDepth = 4, IgnoreInaccessible = true }); }
            catch { continue; }
            foreach (var f in files) if (names.Contains(Path.GetFileName(f))) yield return f;
        }
    }

    /* ---------------- games ---------------- */

    /// <summary>Which emulator plays this game: Switch games in Ryujinx, 3DS in Citra, DS in melonDS, GBA and Game Boy in mGBA.</summary>
    public static string? KindFor(GameSource g) => g.Version switch
    {
        "GP" or "GE" => "ryujinx",
        "COLO" or "XD" or "CXD" => null,   // GameCube: not supported
        _ => g.Generation switch { >= 8 => "ryujinx", 6 or 7 => "citra", 4 or 5 => "melonds", >= 1 and <= 3 => "mgba", _ => null },
    };

    public List<PlayGame> Games()
    {
        var emus = Emulators();
        return _games.List().Where(g => g.Supported && !g.Hidden).Select(g =>
        {
            var kind = KindOf(g);
            var emu = emus.FirstOrDefault(e => e.Kind == kind);
            var rom = _store.Roms.GetValueOrDefault(g.Id);
            string? real = null;
            bool canPlace = false;
            string? note = kind is null ? "PokeVault can't start this kind of game." : null;
            if (g.Kind == "upload")
            {
                real = SuggestRealSave(g, kind, rom);
                canPlace = real is null && kind == "citra" && CitraSavePath(g) is not null;
            }
            else if (g.Kind != "ryujinx")
            {
                // already on a real save: point out the game file's own save if it's a different one
                real = SuggestRealSave(g, kind, rom);
                if (real is not null && string.Equals(Path.GetFullPath(real), Path.GetFullPath(g.Path), StringComparison.OrdinalIgnoreCase)) real = null;
            }
            DateTime? realTime = real is not null && File.Exists(real) ? File.GetLastWriteTime(real) : null;
            return new PlayGame(g.Id, g.Game, g.Version, g.Generation, g.Trainer, g.PlayTime,
                kind, emu?.Name, rom, rom is not null && File.Exists(rom),
                g.Kind, g.Path, g.LastWrite, real, realTime, canPlace, g.Running, note, AwayNames?.Invoke(g.Id) ?? [], SameSystem(KindFor(g)));
        }).ToList();
    }

    /// <summary>Set by the Vault: the Vault Pokémon visiting this game.</summary>
    public Func<string, string[]>? AwayNames { get; set; }

    /// <summary>The emulator that plays this game, if it's open (whether or not PokeVault uses its real save yet).</summary>
    public string? RunningFor(GameSource g) => KindOf(g) is { } k && IsRunning(k) ? Defs.First(d => d.Kind == k).Name : null;

    /// <summary>Emulators that play the same system (Switch: Ryujinx or Sudachi).</summary>
    private static string[] SameSystem(string? kind) =>
        kind is null ? [] : Defs.Where(d => d.Systems == Defs.First(x => x.Kind == kind).Systems).Select(d => d.Kind).ToArray();

    /// <summary>The emulator this game is played in: the one chosen for it, or the usual one for its system.</summary>
    public string? KindOf(GameSource g)
    {
        var usual = KindFor(g);
        return _store.Emus.TryGetValue(g.Id, out var k) && SameSystem(usual).Contains(k) ? k : usual;
    }

    public void SetEmulator(string gameId, string kind)
    {
        var g = _games.Get(gameId);
        if (!SameSystem(KindFor(g)).Contains(kind)) throw new VaultException($"{g.Game} can't be played in that emulator.");
        lock (_lock)
        {
            if (kind == KindFor(g)) _store.Emus.Remove(gameId); else _store.Emus[gameId] = kind;
            Save();
        }
    }

    public void SetRom(string gameId, string path)
    {
        var g = _games.Get(gameId);
        path = Path.GetFullPath(path.Trim().Trim('"'));
        if (!File.Exists(path)) throw new VaultException("No file at that path.");
        var ok = KindOf(g) switch
        {
            "ryujinx" or "sudachi" => new[] { ".nsp", ".xci", ".nca", ".nro", ".nso" },
            "citra" => [".3ds", ".cci", ".cia", ".cxi", ".3dsx", ".app", ".elf", ".axf"],
            "melonds" => [".nds", ".srl", ".dsi", ".ids"],
            "mgba" => [".gba", ".gb", ".gbc", ".sgb", ".agb", ".zip", ".7z"],
            _ => throw new VaultException("PokeVault can't start this kind of game."),
        };
        if (!ok.Contains(Path.GetExtension(path), StringComparer.OrdinalIgnoreCase))
            throw new VaultException($"That doesn't look like a game file for {g.Game} ({string.Join(", ", ok)}).");
        lock (_lock) { _store.Roms[gameId] = path; Save(); }
    }

    public string Start(string gameId)
    {
        var g = _games.Get(gameId);
        var kind = KindOf(g) ?? throw new VaultException("PokeVault can't start this kind of game.");
        var exe = ExeFor(kind) ?? throw new VaultException($"PokeVault couldn't find {Defs.First(d => d.Kind == kind).Name}. Choose its program in Play → Emulators.");
        var rom = _store.Roms.GetValueOrDefault(gameId);
        if (rom is null || !File.Exists(rom)) throw new VaultException($"Choose the game file for {g.Game} first.");
        var psi = new ProcessStartInfo(exe) { UseShellExecute = false, WorkingDirectory = Path.GetDirectoryName(exe)! };
        if (kind == "sudachi") psi.ArgumentList.Add("-g");   // Sudachi (like yuzu) takes the game after -g
        psi.ArgumentList.Add(rom);
        var proc = Process.Start(psi);
        lock (_lock) { _launched = proc; _launchedGame = gameId; _launchedKind = kind; }
        _procsAt = DateTime.MinValue;   // look again right away
        return Defs.First(d => d.Kind == kind).Name;
    }

    private Process? _launched;
    private string? _launchedGame, _launchedKind;

    /// <summary>A game being played right now: the one PokeVault started, or any emulator that's open.</summary>
    public sealed record Playing(string Emulator, string? GameId, string? Game);

    public Playing? Now()
    {
        string? gameId = null, kind = null;
        lock (_lock)
        {
            try { if (_launched is { HasExited: false }) { gameId = _launchedGame; kind = _launchedKind; } }
            catch { /* the process went away */ }
        }
        if (kind is not null && IsRunning(kind))
            return new(Defs.First(d => d.Kind == kind).Name, gameId, _games.List().FirstOrDefault(g => g.Id == gameId)?.Game);
        var open = Defs.FirstOrDefault(d => IsRunning(d.Kind));
        return open is null ? null : new(open.Name, null, null);
    }

    /* ---------------- real saves ---------------- */

    /// <summary>Where the emulator keeps this game's save, if PokeVault can tell (and it exists).</summary>
    private string? SuggestRealSave(GameSource g, string? kind, string? rom)
    {
        try
        {
            if (kind == "mgba" && rom is not null)
            {
                var sav = Path.ChangeExtension(rom, ".sav");   // mGBA keeps the save next to the game file
                if (File.Exists(sav)) return sav;
            }
            if (kind == "melonds" && rom is not null)
            {
                var sav = Path.ChangeExtension(rom, ".sav");
                if (File.Exists(sav)) return sav;
            }
            if (kind == "citra" && CitraSavePath(g) is { } c && File.Exists(c)) return c;
        }
        catch { /* no suggestion */ }
        return null;
    }

    private static readonly Dictionary<string, string> Titles3ds = new()
    {
        ["X"] = "00055d00", ["Y"] = "00055e00", ["OR"] = "0011c400", ["AS"] = "0011c500",
        ["SN"] = "00164800", ["MN"] = "00175e00", ["US"] = "001b5000", ["UM"] = "001b5100",
    };

    /// <summary>Citra's save file for a 3DS Pokémon game: sdmc/Nintendo 3DS/0…0/0…0/title/00040000/{id}/data/00000001/main.</summary>
    private string? CitraSavePath(GameSource g)
    {
        if (!Titles3ds.TryGetValue(g.Version, out var low)) return null;
        var sdmc = CitraSdmc();
        if (sdmc is null) return null;
        var zeros = new string('0', 32);
        return Path.Combine(sdmc, "Nintendo 3DS", zeros, zeros, "title", "00040000", low, "data", "00000001", "main");
    }

    private string? CitraSdmc()
    {
        var exe = ExeFor("citra");
        var candidates = new List<string>();
        if (exe is not null) candidates.Add(Path.Combine(Path.GetDirectoryName(exe)!, "user"));   // portable install
        var appData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
        candidates.AddRange(new[] { "Azahar", "Lime3DS", "Citra", "Mandarine" }.Select(n => Path.Combine(appData, n)));
        foreach (var dir in candidates.Where(Directory.Exists))
        {
            var ini = Path.Combine(dir, "config", "qt-config.ini");
            if (File.Exists(ini))
            {
                var text = File.ReadAllText(ini);
                var custom = Regex.Match(text, @"^sdmc_directory=(.+)$", RegexOptions.Multiline);
                if (custom.Success && !Regex.IsMatch(text, @"^sdmc_directory\\default=true", RegexOptions.Multiline))
                {
                    var p = custom.Groups[1].Value.Trim().Replace(@"\\", @"\").Replace('/', '\\');
                    if (Directory.Exists(p)) return p.TrimEnd('\\');
                }
            }
            var sd = Path.Combine(dir, "sdmc");
            if (Directory.Exists(sd)) return sd;
        }
        return null;
    }

    /// <summary>
    /// Puts this uploaded 3DS save where Citra looks for it, so playing in Citra and PokeVault use the same file.
    /// </summary>
    public string PlaceInCitra(string gameId)
    {
        var g = _games.Get(gameId);
        if (g.Kind != "upload") throw new VaultException("This game already uses a real save.");
        var target = CitraSavePath(g) ?? throw new VaultException("PokeVault couldn't find Citra's SD card folder.");
        if (File.Exists(target)) throw new VaultException("Citra already has a save for this game. Use 'Link the real save' instead.");
        Directory.CreateDirectory(Path.GetDirectoryName(target)!);
        File.Copy(g.Path, target);
        _games.Relink(gameId, target, keepPokeVault: false);
        return target;
    }

    private void Save()
    {
        try { File.WriteAllText(_file, JsonSerializer.Serialize(_store, new JsonSerializerOptions { WriteIndented = true })); }
        catch { /* settings are a nicety */ }
    }
}
