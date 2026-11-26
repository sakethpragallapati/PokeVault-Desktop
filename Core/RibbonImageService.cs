namespace PokeVault.Core;

/// <summary>
/// Ribbon and mark pictures from PKHeX's public repository (PKHeX.Drawing.Misc/Resources/img/ribbons),
/// downloaded on first use and kept in data/ribbons so they work offline afterwards.
/// </summary>
public sealed class RibbonImageService(AppPaths paths)
{
    private const string Base = "https://raw.githubusercontent.com/kwsch/PKHeX/master/PKHeX.Drawing.Misc/Resources/img/ribbons/";
    // The User-Agent is set once, here: changing a client's headers after it has sent anything throws, which
    // made every ribbon fail whenever several were asked for at the same time.
    private static readonly HttpClient Http = MakeClient();
    private static HttpClient MakeClient()
    {
        var c = new HttpClient { Timeout = TimeSpan.FromSeconds(30) };
        c.DefaultRequestHeaders.UserAgent.ParseAdd("PokeVault/1.0");
        return c;
    }
    private readonly string _dir = Path.Combine(paths.DataDir, "ribbons");
    private readonly SemaphoreSlim _gate = new(4, 4);

    /// <summary>The cached PNG for a ribbon property name such as "RibbonChampionG3", or null.</summary>
    public async Task<string?> GetAsync(string key)
    {
        if (!System.Text.RegularExpressions.Regex.IsMatch(key, "^Ribbon[A-Za-z0-9]{1,48}$")) return null;
        var name = key.ToLowerInvariant();
        Directory.CreateDirectory(_dir);
        var file = Path.Combine(_dir, name + ".png");
        var missing = file + ".missing";
        if (File.Exists(file)) return file;
        if (File.Exists(missing) && DateTime.UtcNow - File.GetLastWriteTimeUtc(missing) < TimeSpan.FromDays(7)) return null;
        await _gate.WaitAsync();
        try
        {
            if (File.Exists(file)) return file;
            using var res = await Http.GetAsync(Base + name + ".png");
            if (!res.IsSuccessStatusCode)
            {
                if (res.StatusCode == System.Net.HttpStatusCode.NotFound) await File.WriteAllTextAsync(missing, "");
                return null;
            }
            var bytes = await res.Content.ReadAsByteArrayAsync();
            if (bytes.Length < 8 || bytes[0] != 0x89 || bytes[1] != (byte)'P') return null;   // PNG only
            await File.WriteAllBytesAsync(file + ".part", bytes);
            File.Move(file + ".part", file, overwrite: true);
            return file;
        }
        catch { return null; }
        finally { _gate.Release(); }
    }
}
