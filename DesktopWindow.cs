using System.Diagnostics;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace PokeVault;

/// <summary>The PokeVault desktop window: the app's own web UI inside an Edge WebView2 control.</summary>
public sealed class DesktopWindow : Form
{
    private readonly WebView2 _web = new() { Dock = DockStyle.Fill, DefaultBackgroundColor = Color.FromArgb(17, 156, 148) };
    private readonly string _url;
    private readonly string _profileDir;

    public DesktopWindow(string url, string profileDir)
    {
        _url = url;
        _profileDir = profileDir;
        Text = "PokeVault";
        BackColor = Color.FromArgb(17, 156, 148);
        StartPosition = FormStartPosition.CenterScreen;
        MinimumSize = new Size(900, 620);
        var area = Screen.PrimaryScreen?.WorkingArea ?? new Rectangle(0, 0, 1600, 900);
        Size = new Size(Math.Min(1440, area.Width - 80), Math.Min(900, area.Height - 60));
        try { Icon = Icon.ExtractAssociatedIcon(Environment.ProcessPath!); } catch { /* default icon */ }
        Controls.Add(_web);
        Load += async (_, _) => await StartAsync();
    }

    private async Task StartAsync()
    {
        try
        {
            var env = await CoreWebView2Environment.CreateAsync(null, _profileDir);
            await _web.EnsureCoreWebView2Async(env);
        }
        catch (WebView2RuntimeNotFoundException)
        {
            MessageBox.Show(this,
                "PokeVault needs the Microsoft Edge WebView2 Runtime, which comes with Windows 11.\n\n" +
                "Install it from https://go.microsoft.com/fwlink/p/?LinkId=2124703 and start PokeVault again.",
                "PokeVault", MessageBoxButtons.OK, MessageBoxIcon.Error);
            Close();
            return;
        }

        var core = _web.CoreWebView2;
        core.Settings.AreDevToolsEnabled = Debugger.IsAttached;
        core.Settings.IsStatusBarEnabled = false;
        core.Settings.IsZoomControlEnabled = true;
        core.DocumentTitleChanged += (_, _) => Text = string.IsNullOrWhiteSpace(core.DocumentTitle) ? "PokeVault" : core.DocumentTitle;
        // F11 in the page asks for full screen: make the whole window borderless over the screen.
        core.ContainsFullScreenElementChanged += (_, _) => SetFullScreen(core.ContainsFullScreenElement);
        // The Meadow's live weather asks where you are; allow that for PokeVault's own page only
        // (Windows' location setting still decides whether a location is given).
        core.PermissionRequested += (_, e) =>
        {
            if (e.PermissionKind == CoreWebView2PermissionKind.Geolocation && e.Uri.StartsWith(_url, StringComparison.OrdinalIgnoreCase))
                e.State = CoreWebView2PermissionState.Allow;
        };
        // Links to other websites open in the normal browser, not inside PokeVault.
        core.NewWindowRequested += (_, e) => { e.Handled = true; OpenExternal(e.Uri); };
        core.NavigationStarting += (_, e) =>
        {
            if (!e.Uri.StartsWith(_url, StringComparison.OrdinalIgnoreCase)) { e.Cancel = true; OpenExternal(e.Uri); }
        };
        _web.Source = new Uri(_url);
    }

    private FormWindowState _savedState;
    private Rectangle _savedBounds;
    private bool _fullScreen;

    private void SetFullScreen(bool on)
    {
        if (on == _fullScreen) return;
        _fullScreen = on;
        if (on)
        {
            _savedState = WindowState;
            _savedBounds = WindowState == FormWindowState.Normal ? Bounds : RestoreBounds;
            FormBorderStyle = FormBorderStyle.None;
            WindowState = FormWindowState.Normal;          // must leave Maximized first
            Bounds = Screen.FromControl(this).Bounds;      // covers the taskbar too
            TopMost = true;
        }
        else
        {
            TopMost = false;
            FormBorderStyle = FormBorderStyle.Sizable;
            Bounds = _savedBounds;
            WindowState = _savedState;
        }
    }

    private static void OpenExternal(string uri)
    {
        if (Uri.TryCreate(uri, UriKind.Absolute, out var u) && (u.Scheme == "https" || u.Scheme == "http"))
            Process.Start(new ProcessStartInfo(u.ToString()) { UseShellExecute = true });
    }

    /// <summary>Runs the window on its own UI thread and blocks until it closes.</summary>
    public static void Run(string url, string profileDir)
    {
        var thread = new Thread(() =>
        {
            Application.SetHighDpiMode(HighDpiMode.PerMonitorV2);
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new DesktopWindow(url, profileDir));
        });
        thread.SetApartmentState(ApartmentState.STA);
        thread.Start();
        thread.Join();
    }
}
