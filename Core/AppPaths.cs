namespace PokeVault.Core;

/// <summary>Where PokeVault keeps its own data and where it looks for Ryujinx saves.</summary>
public sealed class AppPaths
{
    public string DataDir { get; }
    public string MonDir => Path.Combine(DataDir, "mons");
    public string WithdrawnDir => Path.Combine(DataDir, "withdrawn");
    public string BackupDir => Path.Combine(DataDir, "backups");
    public string UploadDir => Path.Combine(DataDir, "uploaded-saves");
    public string ReleasedDir => Path.Combine(DataDir, "released");
    public string IndexFile => Path.Combine(DataDir, "vault.json");
    public string SettingsFile => Path.Combine(DataDir, "settings.json");
    public IReadOnlyList<string> SaveRoots { get; }
    /// <summary>Where an earlier PokeVault.exe kept its vault (%LOCALAPPDATA%\PokeVault).</summary>
    public string LegacyDataDir { get; }

    public AppPaths(IWebHostEnvironment env, IConfiguration config)
    {
        // 1) --dataDir / DATADIR if given; 2) the project's data folder when run from source;
        // 3) otherwise (the installed PokeVault.exe) C:\Users\<you>\PokeVault. Not under AppData on
        //    purpose: Windows silently redirects AppData writes of programs started from packaged apps,
        //    which can split the vault into two copies.
        DataDir = config["dataDir"] is { Length: > 0 } custom
            ? Path.GetFullPath(custom)
            : File.Exists(Path.Combine(env.ContentRootPath, "PokeVault.csproj"))
                ? Path.Combine(env.ContentRootPath, "data")
                : Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "PokeVault");
        LegacyDataDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "PokeVault");

        foreach (var d in new[] { DataDir, MonDir, WithdrawnDir, BackupDir, UploadDir, ReleasedDir })
            Directory.CreateDirectory(d);

        var roots = new List<string>
        {
            // Normal Ryujinx install.
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "Ryujinx", "bis", "user", "save"),
            // Portable Ryujinx (a "portable" folder next to Ryujinx.exe, which is our parent folder).
            Path.GetFullPath(Path.Combine(env.ContentRootPath, "..", "portable", "bis", "user", "save")),
        };
        if (config["ryujinxDir"] is { Length: > 0 } ryu)
            roots = [Path.Combine(Path.GetFullPath(ryu), "bis", "user", "save")]; // only look in this Ryujinx folder
        SaveRoots = roots;
    }
}

/// <summary>An error that is safe to show to the user as-is.</summary>
public sealed class VaultException(string message) : Exception(message);
