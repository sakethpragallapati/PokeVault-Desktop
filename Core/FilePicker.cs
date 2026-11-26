namespace PokeVault.Core;

/// <summary>
/// The Windows "Open" dialog, shown on its own thread for the page (a browser can't hand back a file's full
/// path, and PokeVault needs it to start a game or link a save). Always on top so it doesn't hide behind PokeVault.
/// </summary>
public static class FilePicker
{
    public static string? Pick(string? title, string? filter, string? start)
    {
        string? result = null;
        Exception? error = null;
        var t = new Thread(() =>
        {
            try
            {
                using var owner = new Form
                {
                    TopMost = true, ShowInTaskbar = false, FormBorderStyle = FormBorderStyle.None,
                    StartPosition = FormStartPosition.CenterScreen, Size = new Size(1, 1), Opacity = 0,
                };
                owner.Show();
                owner.Activate();
                using var d = new OpenFileDialog
                {
                    Title = string.IsNullOrWhiteSpace(title) ? "Choose a file" : title,
                    Filter = string.IsNullOrWhiteSpace(filter) ? "All files (*.*)|*.*" : filter,
                    CheckFileExists = true,
                    RestoreDirectory = true,
                };
                if (!string.IsNullOrWhiteSpace(start))
                {
                    var dir = Directory.Exists(start) ? start : Path.GetDirectoryName(start);
                    if (dir is not null && Directory.Exists(dir)) d.InitialDirectory = dir;
                }
                if (d.ShowDialog(owner) == DialogResult.OK) result = d.FileName;
            }
            catch (Exception ex) { error = ex; }
        });
        t.SetApartmentState(ApartmentState.STA);
        t.IsBackground = true;
        t.Start();
        t.Join();
        if (error is not null) throw new VaultException("The file picker couldn't open: " + error.Message);
        return result;
    }
}
