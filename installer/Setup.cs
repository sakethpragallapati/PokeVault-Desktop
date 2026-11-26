using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Reflection;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Win32;

namespace PokeVault.Setup;

/// <summary>
/// PokeVault's installer and uninstaller (the same program: with the app packed inside it installs; run as
/// Uninstall.exe it removes PokeVault). Installs for the current user only: no administrator prompt.
/// Your vault (C:\Users\you\PokeVault) is never touched by either.
/// </summary>
internal static class Program
{
    public const string AppName = "PokeVault";
    public const string Publisher = "PokeVault";
    public const string UninstallKey = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\PokeVault";
    public static string Version => Assembly.GetExecutingAssembly().GetName().Version is { } v ? $"{v.Major}.{v.Minor}.{v.Build}" : "1.0.0";
    public static readonly string DefaultDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", AppName);
    public static readonly string DataDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), AppName);

    [STAThread]
    private static void Main(string[] args)
    {
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        var payload = Assembly.GetExecutingAssembly().GetManifestResourceNames().Contains("app.zip");
        bool Has(string f) => args.Any(a => a.Equals(f, StringComparison.OrdinalIgnoreCase));
        if (!payload || Has("/uninstall")) { Uninstaller.Run(args); return; }
        // Silent install: PokeVault-Setup.exe /S [/D=folder] [/portable] (portable: no shortcuts, no Apps & features entry)
        if (Has("/S"))
        {
            var dir = args.FirstOrDefault(a => a.StartsWith("/D=", StringComparison.OrdinalIgnoreCase))?.Substring(3) ?? DefaultDir;
            try { Installer.Install(Path.GetFullPath(dir), desktop: false, register: !Has("/portable"), new Progress<(int, int, string)>()); Environment.ExitCode = 0; }
            catch (Exception ex) { Console.Error.WriteLine(ex.Message); Environment.ExitCode = 1; }
            return;
        }
        Application.Run(new InstallForm());
    }

    /// <summary>PokeVault windows started from this folder, if any are open.</summary>
    public static Process[] RunningFrom(string dir) =>
        Process.GetProcessesByName(AppName).Where(p =>
        {
            try { return p.MainModule?.FileName?.StartsWith(dir, StringComparison.OrdinalIgnoreCase) == true; }
            catch { return false; }
        }).ToArray();

    public static void Shortcut(string lnk, string target, string dir, string description)
    {
        var shellType = Type.GetTypeFromProgID("WScript.Shell") ?? throw new InvalidOperationException("Windows Script Host is unavailable.");
        dynamic shell = Activator.CreateInstance(shellType)!;
        dynamic s = shell.CreateShortcut(lnk);
        s.TargetPath = target;
        s.WorkingDirectory = dir;
        s.IconLocation = target + ",0";
        s.Description = description;
        s.Save();
    }

    public static string StartMenuLink => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), AppName + ".lnk");
    public static string DesktopLink => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), AppName + ".lnk");
}

/// <summary>The installer window: where to install, shortcuts, and a progress bar.</summary>
internal sealed class InstallForm : Form
{
    private readonly TextBox _dir = new() { Text = Program.DefaultDir, Width = 360 };
    private readonly CheckBox _desktop = new() { Text = "Add a desktop shortcut", Checked = true, AutoSize = true };
    private readonly CheckBox _launch = new() { Text = "Open PokeVault when done", Checked = true, AutoSize = true };
    private readonly ProgressBar _bar = new() { Width = 440, Height = 18 };
    private readonly Label _status = new() { AutoSize = true, ForeColor = Color.FromArgb(40, 90, 85) };
    private readonly Button _install = new() { Text = "Install", Width = 110, Height = 34 };
    private readonly Button _browse = new() { Text = "Change…", Width = 80, Height = 26 };

    public InstallForm()
    {
        Text = $"Install {Program.AppName} {Program.Version}";
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        StartPosition = FormStartPosition.CenterScreen;
        ClientSize = new Size(480, 330);
        Font = new Font("Segoe UI", 9.5f);
        BackColor = Color.White;
        try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { /* default icon */ }

        var banner = new Panel { Dock = DockStyle.Top, Height = 74, BackColor = Color.FromArgb(17, 156, 148) };
        banner.Controls.Add(new Label { Text = Program.AppName, ForeColor = Color.White, Font = new Font("Segoe UI", 20, FontStyle.Bold), AutoSize = true, Location = new Point(18, 10) });
        banner.Controls.Add(new Label { Text = "Your own offline Pokémon storage", ForeColor = Color.FromArgb(220, 255, 250), AutoSize = true, Location = new Point(22, 48) });
        Controls.Add(banner);

        var y = 90;
        Controls.Add(new Label { Text = "Install to:", AutoSize = true, Location = new Point(20, y) });
        _dir.Location = new Point(20, y + 22); _browse.Location = new Point(386, y + 20);
        Controls.Add(_dir); Controls.Add(_browse);
        _desktop.Location = new Point(20, y + 60); _launch.Location = new Point(20, y + 86);
        Controls.Add(_desktop); Controls.Add(_launch);
        Controls.Add(new Label
        {
            Text = $"Your vault is kept separately in {Program.DataDir}\nand is never changed by installing, updating or uninstalling.",
            AutoSize = true, ForeColor = Color.DimGray, Location = new Point(20, y + 116),
        });
        _bar.Location = new Point(20, y + 162); _status.Location = new Point(20, y + 186);
        Controls.Add(_bar); Controls.Add(_status);
        _install.Location = new Point(350, 280);
        Controls.Add(_install);
        AcceptButton = _install;

        _browse.Click += (_, _) =>
        {
            using var f = new FolderBrowserDialog { SelectedPath = _dir.Text, Description = "Choose where to install PokeVault" };
            if (f.ShowDialog(this) == DialogResult.OK) _dir.Text = Path.Combine(f.SelectedPath, Program.AppName);
        };
        _install.Click += async (_, _) => await InstallAsync();
    }

    private async Task InstallAsync()
    {
        var dir = _dir.Text.Trim();
        if (dir.Length == 0) return;
        if (Program.RunningFrom(dir).Length > 0)
        {
            MessageBox.Show(this, "PokeVault is open. Close it first, then click Install again.", Text, MessageBoxButtons.OK, MessageBoxIcon.Information);
            return;
        }
        _install.Enabled = _browse.Enabled = _dir.Enabled = _desktop.Enabled = _launch.Enabled = false;
        var desktop = _desktop.Checked;
        var progress = new Progress<(int Done, int Total, string What)>(p =>
        {
            _bar.Maximum = Math.Max(1, p.Total); _bar.Value = Math.Min(p.Total, p.Done); _status.Text = p.What;
        });
        try
        {
            await Task.Run(() => Installer.Install(dir, desktop, register: true, progress));
            _status.Text = "PokeVault is installed.";
            if (_launch.Checked) Process.Start(new ProcessStartInfo(Path.Combine(dir, "PokeVault.exe")) { WorkingDirectory = dir, UseShellExecute = true });
            MessageBox.Show(this, "PokeVault is installed. You'll find it in the Start menu.", Text, MessageBoxButtons.OK, MessageBoxIcon.Information);
            Close();
        }
        catch (Exception ex)
        {
            _status.Text = "Installing didn't finish.";
            MessageBox.Show(this, "PokeVault couldn't be installed:\n\n" + ex.Message, Text, MessageBoxButtons.OK, MessageBoxIcon.Error);
            _install.Enabled = _browse.Enabled = _dir.Enabled = _desktop.Enabled = _launch.Enabled = true;
        }
    }
}

internal static class Installer
{
    private const string Manifest = "install-manifest.txt";

    public static void Install(string dir, bool desktop, bool register, IProgress<(int, int, string)> progress)
    {
        Directory.CreateDirectory(dir);
        var asm = Assembly.GetExecutingAssembly();
        var old = File.Exists(Path.Combine(dir, Manifest)) ? File.ReadAllLines(Path.Combine(dir, Manifest)).ToHashSet(StringComparer.OrdinalIgnoreCase) : [];
        var written = new List<string>();
        using (var zip = new ZipArchive(asm.GetManifestResourceStream("app.zip")!, ZipArchiveMode.Read))
        {
            var files = zip.Entries.Where(e => e.Name.Length > 0).ToList();
            int i = 0;
            foreach (var e in files)
            {
                var rel = e.FullName.Replace('/', '\\');
                var dest = Path.GetFullPath(Path.Combine(dir, rel));
                if (!dest.StartsWith(Path.GetFullPath(dir), StringComparison.OrdinalIgnoreCase)) continue;   // never outside the folder
                Directory.CreateDirectory(Path.GetDirectoryName(dest)!);
                e.ExtractToFile(dest, overwrite: true);
                written.Add(rel);
                if (++i % 10 == 0 || i == files.Count) progress.Report((i, files.Count, $"Copying files… {i}/{files.Count}"));
            }
        }
        // the uninstaller, next to the app
        using (var u = asm.GetManifestResourceStream("uninstall.exe"))
        {
            if (u is not null)
            {
                using var f = File.Create(Path.Combine(dir, "Uninstall.exe"));
                u.CopyTo(f);
                written.Add("Uninstall.exe");
            }
        }
        // files from an older version that this one doesn't have any more
        foreach (var gone in old.Except(written, StringComparer.OrdinalIgnoreCase))
            try { File.Delete(Path.Combine(dir, gone)); } catch { /* in use or already gone */ }
        File.WriteAllLines(Path.Combine(dir, Manifest), written);

        if (!register) return;                     // portable: just the files
        progress.Report((1, 1, "Adding shortcuts…"));
        var exe = Path.Combine(dir, "PokeVault.exe");
        Program.Shortcut(Program.StartMenuLink, exe, dir, "Your own offline Pokémon storage");
        if (desktop) Program.Shortcut(Program.DesktopLink, exe, dir, "Your own offline Pokémon storage");
        else if (File.Exists(Program.DesktopLink)) File.Delete(Program.DesktopLink);

        // "Apps & features" entry, so Windows can uninstall it
        using var key = Registry.CurrentUser.CreateSubKey(Program.UninstallKey);
        key.SetValue("DisplayName", Program.AppName);
        key.SetValue("DisplayVersion", Program.Version);
        key.SetValue("Publisher", Program.Publisher);
        key.SetValue("DisplayIcon", exe + ",0");
        key.SetValue("InstallLocation", dir);
        key.SetValue("UninstallString", $"\"{Path.Combine(dir, "Uninstall.exe")}\" /uninstall");
        key.SetValue("NoModify", 1, RegistryValueKind.DWord);
        key.SetValue("NoRepair", 1, RegistryValueKind.DWord);
        try
        {
            var kb = written.Sum(r => { try { return new FileInfo(Path.Combine(dir, r)).Length; } catch { return 0L; } }) / 1024;
            key.SetValue("EstimatedSize", (int)Math.Min(int.MaxValue, kb), RegistryValueKind.DWord);
        }
        catch { /* size is only for display */ }
    }
}

/// <summary>Removes PokeVault (the program, its shortcuts and its "Apps & features" entry). Your vault stays.</summary>
internal static class Uninstaller
{
    public static void Run(string[] args)
    {
        var here = Path.GetDirectoryName(Application.ExecutablePath)!;
        string? registered;
        using (var key = Registry.CurrentUser.OpenSubKey(Program.UninstallKey)) registered = key?.GetValue("InstallLocation") as string;
        var dir = here;
        // the shortcuts and the Apps & features entry are only removed if they point at this copy
        var ours = registered is not null && Path.GetFullPath(registered).TrimEnd(Path.DirectorySeparatorChar)
            .Equals(Path.GetFullPath(here).TrimEnd(Path.DirectorySeparatorChar), StringComparison.OrdinalIgnoreCase);
        var quiet = args.Any(a => a.Equals("/quiet", StringComparison.OrdinalIgnoreCase));
        if (!quiet && MessageBox.Show($"Remove PokeVault from this PC?\n\nYour vault in {Program.DataDir} is kept.",
                "Uninstall PokeVault", MessageBoxButtons.YesNo, MessageBoxIcon.Question) != DialogResult.Yes) return;
        if (Program.RunningFrom(dir).Length > 0)
        {
            MessageBox.Show("PokeVault is open. Close it first, then uninstall again.", "Uninstall PokeVault", MessageBoxButtons.OK, MessageBoxIcon.Information);
            return;
        }
        var manifest = Path.Combine(dir, "install-manifest.txt");
        var files = File.Exists(manifest) ? File.ReadAllLines(manifest) : [];
        foreach (var rel in files.Where(r => !r.Equals("Uninstall.exe", StringComparison.OrdinalIgnoreCase)))
            try { File.Delete(Path.Combine(dir, rel)); } catch { /* skip */ }
        try { File.Delete(manifest); } catch { /* skip */ }
        if (ours)
        {
            foreach (var lnk in new[] { Program.StartMenuLink, Program.DesktopLink })
                try { if (File.Exists(lnk)) File.Delete(lnk); } catch { /* skip */ }
            Registry.CurrentUser.DeleteSubKeyTree(Program.UninstallKey, throwOnMissingSubKey: false);
        }
        // empty folders left behind, then this uninstaller itself (it can't delete itself while running)
        try
        {
            foreach (var d in Directory.GetDirectories(dir, "*", SearchOption.AllDirectories).OrderByDescending(d => d.Length))
                if (!Directory.EnumerateFileSystemEntries(d).Any()) Directory.Delete(d);
        }
        catch { /* skip */ }
        Process.Start(new ProcessStartInfo("cmd.exe", $"/c timeout /t 2 /nobreak >nul & del /q \"{Path.Combine(dir, "Uninstall.exe")}\" & rmdir \"{dir}\"")
        { CreateNoWindow = true, UseShellExecute = false });
        if (!quiet) MessageBox.Show("PokeVault was removed. Your vault is still in " + Program.DataDir + ".", "Uninstall PokeVault", MessageBoxButtons.OK, MessageBoxIcon.Information);
    }
}
