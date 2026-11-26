using System.Collections.Concurrent;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace PokeVault.Core;

/// <summary>
/// 3D models from github.com/Pokemon-3D-api/assets (MIT). Each model is downloaded once and kept
/// in data/models-cache, so the meadow works fast (and offline) afterwards.
/// </summary>
public sealed partial class ModelService
{
    private const string Repo = "Pokemon-3D-api/assets";
    private const string RawBase = $"https://raw.githubusercontent.com/{Repo}/main/models/opt/";
    private const long MaxModelBytes = 32 * 1024 * 1024;
    private static readonly TimeSpan IndexMaxAge = TimeSpan.FromDays(3);

    private static readonly HttpClient Http = CreateClient();
    private readonly string _dir;
    private readonly string _indexFile;
    private readonly ConcurrentDictionary<string, SemaphoreSlim> _locks = new();

    public ModelService(AppPaths paths)
    {
        _dir = Path.Combine(paths.DataDir, "models-cache");
        _indexFile = Path.Combine(_dir, "index.json");
        Directory.CreateDirectory(_dir);
    }

    private static HttpClient CreateClient()
    {
        var c = new HttpClient { Timeout = TimeSpan.FromSeconds(60) };
        c.DefaultRequestHeaders.UserAgent.ParseAdd("PokeVault/1.0");
        return c;
    }

    [GeneratedRegex("^[A-Za-z]{1,24}$")] private static partial Regex CategoryRx();
    [GeneratedRegex("^[A-Za-z0-9_-]{1,40}$")] private static partial Regex NameRx();

    /// <summary>Which models exist, as { category: [names] }. Cached for a few days.</summary>
    public async Task<Dictionary<string, List<string>>> GetIndexAsync()
    {
        var fi = new FileInfo(_indexFile);
        if (fi.Exists && DateTime.UtcNow - fi.LastWriteTimeUtc < IndexMaxAge)
            return ReadIndex() ?? [];
        try
        {
            using var res = await Http.GetAsync($"https://api.github.com/repos/{Repo}/git/trees/main?recursive=1");
            res.EnsureSuccessStatusCode();
            using var doc = JsonDocument.Parse(await res.Content.ReadAsStringAsync());
            var index = new Dictionary<string, List<string>>();
            foreach (var e in doc.RootElement.GetProperty("tree").EnumerateArray())
            {
                var path = e.GetProperty("path").GetString() ?? "";
                if (!path.StartsWith("models/opt/") || !path.EndsWith(".glb")) continue;
                var parts = path["models/opt/".Length..^4].Split('/');
                if (parts.Length != 2) continue;
                if (!index.TryGetValue(parts[0], out var list)) index[parts[0]] = list = [];
                list.Add(parts[1]);
            }
            await File.WriteAllTextAsync(_indexFile, JsonSerializer.Serialize(index));
            return index;
        }
        catch
        {
            return ReadIndex() ?? []; // offline: use whatever we had
        }
    }

    private Dictionary<string, List<string>>? ReadIndex()
    {
        try { return JsonSerializer.Deserialize<Dictionary<string, List<string>>>(File.ReadAllText(_indexFile)); }
        catch { return null; }
    }

    private readonly ConcurrentDictionary<string, string[]> _clips = new();

    /// <summary>
    /// Animation clip names inside a model (read from the GLB's JSON header), so the meadow only
    /// downloads models that can actually move. Null if the model doesn't exist.
    /// </summary>
    public async Task<string[]?> GetClipsAsync(string category, string name)
    {
        var key = $"{category}/{name}";
        if (_clips.TryGetValue(key, out var known)) return known;
        var file = await GetModelAsync(category, name);
        if (file is null) return null;
        try
        {
            await using var fs = File.OpenRead(file);
            var head = new byte[20];
            if (await fs.ReadAsync(head) != 20 || BitConverter.ToUInt32(head, 0) != 0x46546C67) return [];
            var jsonLen = BitConverter.ToInt32(head, 12);
            if (jsonLen <= 0 || jsonLen > 16 * 1024 * 1024) return [];
            var json = new byte[jsonLen];
            await fs.ReadExactlyAsync(json);
            using var doc = JsonDocument.Parse(json);
            var clips = doc.RootElement.TryGetProperty("animations", out var a)
                ? a.EnumerateArray().Select(x => x.TryGetProperty("name", out var n) ? n.GetString() ?? "" : "").ToArray()
                : [];
            _clips[key] = clips;
            return clips;
        }
        catch { return []; }
    }

    /// <summary>Path to the cached model, downloading it first if needed. Null if it doesn't exist.</summary>
    public async Task<string?> GetModelAsync(string category, string name)
    {
        if (!CategoryRx().IsMatch(category) || !NameRx().IsMatch(name)) return null;
        var file = Path.Combine(_dir, category, name + ".glb");
        if (File.Exists(file)) return file;

        var gate = _locks.GetOrAdd(file, _ => new SemaphoreSlim(1, 1));
        await gate.WaitAsync();
        try
        {
            if (File.Exists(file)) return file;
            using var res = await Http.GetAsync($"{RawBase}{category}/{name}.glb", HttpCompletionOption.ResponseHeadersRead);
            if (!res.IsSuccessStatusCode) return null;
            if (res.Content.Headers.ContentLength > MaxModelBytes) return null;
            Directory.CreateDirectory(Path.GetDirectoryName(file)!);
            var tmp = file + ".part";
            await using (var src = await res.Content.ReadAsStreamAsync())
            await using (var dst = File.Create(tmp))
            {
                var buf = new byte[81920];
                long total = 0;
                int n;
                while ((n = await src.ReadAsync(buf)) > 0)
                {
                    total += n;
                    if (total > MaxModelBytes) { dst.Close(); File.Delete(tmp); return null; }
                    await dst.WriteAsync(buf.AsMemory(0, n));
                }
            }
            File.Move(tmp, file, overwrite: true);
            return file;
        }
        catch (HttpRequestException) { return null; }
        catch (TaskCanceledException) { return null; }
        finally { gate.Release(); }
    }
}
