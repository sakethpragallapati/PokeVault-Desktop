using System.Collections.Concurrent;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace PokeVault.Core;

/// <summary>
/// Walking sprites for the Meadow from the PMD Sprite Collab (github.com/PMDCollab/SpriteCollab,
/// CC BY-NC 4.0, credited per artist). Like the Showdown sprites, nothing is bundled: files are
/// downloaded the first time they're needed and kept in data/pmd-cache.
/// Sprite folders: sprite/&lt;dex 4 digits&gt;[/&lt;form&gt;][/&lt;shiny 0001&gt;][/&lt;female 0002&gt;]/Walk-Anim.png etc.
/// Sheets have 8 rows, one per direction: down, down-right, right, up-right, up, up-left, left, down-left.
/// </summary>
public sealed partial class PmdService
{
    private const string Root = "https://raw.githubusercontent.com/PMDCollab/SpriteCollab/master/";
    private static readonly TimeSpan MissingRetry = TimeSpan.FromDays(7);
    private static readonly TimeSpan IndexMaxAge = TimeSpan.FromDays(14);
    private static readonly HttpClient Http = CreateClient();

    private readonly string _dir;
    private readonly ConcurrentDictionary<string, SemaphoreSlim> _locks = new();
    private Task<Dictionary<string, object[]>?>? _indexTask;

    public PmdService(AppPaths paths)
    {
        _dir = Path.Combine(paths.DataDir, "pmd-cache");
        Directory.CreateDirectory(_dir);
    }

    private static HttpClient CreateClient()
    {
        var c = new HttpClient { Timeout = TimeSpan.FromSeconds(60) };
        c.DefaultRequestHeaders.UserAgent.ParseAdd("PokeVault/1.0");
        return c;
    }

    // Only sprite sheets, animation data, portraits and credits; never anything else from the repo.
    [GeneratedRegex(@"^(?:(?:sprite|portrait)/\d{4}(?:/\d{4}){0,3}/(?:[A-Za-z]{1,24}-(?:Anim|Shadow)\.png|AnimData\.xml|credits\.txt|[A-Za-z-]{1,24}\.png)|credit_names\.txt)$")]
    private static partial Regex PathRx();

    public static string ContentType(string path) => Path.GetExtension(path) switch
    {
        ".png" => "image/png",
        ".xml" => "application/xml",
        _ => "text/plain; charset=utf-8",
    };

    /// <summary>Local copy of one SpriteCollab file, downloading it once; null if it doesn't exist upstream.</summary>
    public async Task<string?> GetFileAsync(string path)
    {
        if (!PathRx().IsMatch(path)) return null;
        var file = Path.Combine(_dir, path.Replace('/', Path.DirectorySeparatorChar));
        if (File.Exists(file)) return file;
        var missing = file + ".missing";
        if (File.Exists(missing) && DateTime.UtcNow - File.GetLastWriteTimeUtc(missing) < MissingRetry) return null;

        var gate = _locks.GetOrAdd(file, _ => new SemaphoreSlim(1, 1));
        await gate.WaitAsync();
        try
        {
            if (File.Exists(file)) return file;
            using var res = await Http.GetAsync(Root + path);
            Directory.CreateDirectory(Path.GetDirectoryName(file)!);
            if (res.StatusCode == System.Net.HttpStatusCode.NotFound)
            {
                await File.WriteAllTextAsync(missing, "");
                return null;
            }
            if (!res.IsSuccessStatusCode) return null;
            var bytes = await res.Content.ReadAsByteArrayAsync();
            var max = path.EndsWith(".png") ? 4 << 20 : 1 << 20;
            if (bytes.Length == 0 || bytes.Length > max) return null;
            if (path.EndsWith(".png") && bytes[0] != 0x89) return null;
            await File.WriteAllBytesAsync(file + ".part", bytes);
            File.Move(file + ".part", file, overwrite: true);
            File.Delete(missing);
            return file;
        }
        catch (HttpRequestException) { return null; }
        catch (TaskCanceledException) { return null; }
        finally { gate.Release(); }
    }

    /// <summary>
    /// Which folders have a walking sprite or portraits, from SpriteCollab's tracker.json (about 10 MB, so it's
    /// boiled down to { "0059/0001": [flags, "Hisui"], ... } once and refreshed every two weeks).
    /// flags: 1 = has a Walk sprite, 2 = has portraits.
    /// </summary>
    public Task<Dictionary<string, object[]>?> GetIndexAsync()
    {
        var file = Path.Combine(_dir, "index.json");
        var fi = new FileInfo(file);
        if (fi.Exists && DateTime.UtcNow - fi.LastWriteTimeUtc < IndexMaxAge && ReadIndex(file) is { } fresh)
            return Task.FromResult<Dictionary<string, object[]>?>(fresh);
        lock (_locks)
        {
            if (_indexTask is null || _indexTask.IsCompleted && _indexTask.Result is null)
                _indexTask = BuildIndexAsync(file);
            return _indexTask;
        }
    }

    private static Dictionary<string, object[]>? ReadIndex(string file)
    {
        try { return JsonSerializer.Deserialize<Dictionary<string, object[]>>(File.ReadAllText(file)); }
        catch { return null; }
    }

    private async Task<Dictionary<string, object[]>?> BuildIndexAsync(string file)
    {
        try
        {
            await using var stream = await Http.GetStreamAsync(Root + "tracker.json");
            using var doc = await JsonDocument.ParseAsync(stream);
            var index = new Dictionary<string, object[]>();
            void Walk(string key, JsonElement node)
            {
                var flags = 0;
                if (node.TryGetProperty("sprite_files", out var sf) && sf.ValueKind == JsonValueKind.Object && sf.TryGetProperty("Walk", out _)) flags |= 1;
                if (node.TryGetProperty("portrait_files", out var pf) && pf.ValueKind == JsonValueKind.Object && pf.TryGetProperty("Normal", out _)) flags |= 2;
                var name = node.TryGetProperty("name", out var n) && n.ValueKind == JsonValueKind.String ? n.GetString() ?? "" : "";
                index[key] = [flags, name];
                if (node.TryGetProperty("subgroups", out var subs) && subs.ValueKind == JsonValueKind.Object)
                    foreach (var s in subs.EnumerateObject()) Walk($"{key}/{s.Name}", s.Value);
            }
            foreach (var species in doc.RootElement.EnumerateObject()) Walk(species.Name, species.Value);
            await File.WriteAllTextAsync(file + ".part", JsonSerializer.Serialize(index));
            File.Move(file + ".part", file, overwrite: true);
            return index;
        }
        catch
        {
            // offline: use an old index if there is one
            return File.Exists(file) ? ReadIndex(file) : null;
        }
    }

    /// <summary>Artist names for one sprite folder and its portraits (CC BY-NC asks for credit).</summary>
    public async Task<object> GetCreditsAsync(string key)
    {
        var names = await ReadNamesAsync();
        async Task<string[]> Credits(string kind)
        {
            var f = await GetFileAsync($"{kind}/{key}/credits.txt");
            if (f is null) return [];
            var authors = new List<string>();
            foreach (var line in await File.ReadAllLinesAsync(f))
            {
                var cols = line.Split('\t');
                if (cols.Length < 3 || cols[2] != "CUR") continue;
                var who = names.TryGetValue(cols[1], out var nm) ? nm : cols[1].StartsWith("<@") ? "unnamed artist" : cols[1];
                if (!authors.Contains(who)) authors.Add(who);
            }
            return authors.ToArray();
        }
        return new { sprite = await Credits("sprite"), portrait = await Credits("portrait") };
    }

    private async Task<Dictionary<string, string>> ReadNamesAsync()
    {
        var map = new Dictionary<string, string>();
        var f = await GetFileAsync("credit_names.txt");
        if (f is null) return map;
        foreach (var line in (await File.ReadAllLinesAsync(f)).Skip(1))
        {
            var cols = line.Split('\t');
            if (cols.Length >= 2 && cols[0].Length > 0) map[cols[1]] = cols[0];
        }
        return map;
    }
}
