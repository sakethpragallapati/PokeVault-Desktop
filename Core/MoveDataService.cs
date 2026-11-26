using System.Text.Json;

namespace PokeVault.Core;

/// <summary>
/// Move categories and base power for the Meadow's friendly battles, from Pokémon Showdown's public move table
/// (play.pokemonshowdown.com/data/moves.json). Fetched once, boiled down to
/// { "aurasphere": ["Special", 80, 0, 100, 20, 0, "Fighting", "desc"], … } (category, base power, makes contact,
/// accuracy (0 = never misses), PP, priority, type, English in-game description from PokeAPI's public data) and cached for 30 days.
/// </summary>
public sealed class MoveDataService(AppPaths paths)
{
    private const string Url = "https://play.pokemonshowdown.com/data/moves.json";
    private const string TextUrl = "https://raw.githubusercontent.com/PokeAPI/pokeapi/master/data/v2/csv/move_flavor_text.csv";
    // User-Agent set once at creation (changing headers after a request has been sent throws).
    private static readonly HttpClient Http = MakeClient();
    private static HttpClient MakeClient()
    {
        var c = new HttpClient { Timeout = TimeSpan.FromSeconds(60) };
        c.DefaultRequestHeaders.UserAgent.ParseAdd("PokeVault/1.0");
        return c;
    }
    private readonly string _file = Path.Combine(paths.DataDir, "moves-cache2.json");
    private readonly SemaphoreSlim _gate = new(1, 1);

    public async Task<Dictionary<string, object[]>?> GetAsync()
    {
        var fi = new FileInfo(_file);
        if (fi.Exists && DateTime.UtcNow - fi.LastWriteTimeUtc < TimeSpan.FromDays(30) && Read() is { } fresh) return fresh;
        await _gate.WaitAsync();
        try
        {
            fi.Refresh();
            if (fi.Exists && DateTime.UtcNow - fi.LastWriteTimeUtc < TimeSpan.FromDays(30) && Read() is { } again) return again;
            using var doc = JsonDocument.Parse(await Http.GetStringAsync(Url));
            var text = await DescriptionsAsync();
            var map = new Dictionary<string, object[]>();
            foreach (var m in doc.RootElement.EnumerateObject())
            {
                var v = m.Value;
                if (!v.TryGetProperty("category", out var cat) || cat.ValueKind != JsonValueKind.String) continue;
                var power = v.TryGetProperty("basePower", out var bp) && bp.ValueKind == JsonValueKind.Number ? bp.GetInt32() : 0;
                var contact = v.TryGetProperty("flags", out var fl) && fl.ValueKind == JsonValueKind.Object && fl.TryGetProperty("contact", out _) ? 1 : 0;
                var acc = v.TryGetProperty("accuracy", out var ac) && ac.ValueKind == JsonValueKind.Number ? ac.GetInt32() : 0;
                var pp = v.TryGetProperty("pp", out var p) && p.ValueKind == JsonValueKind.Number ? p.GetInt32() : 0;
                var pri = v.TryGetProperty("priority", out var pr) && pr.ValueKind == JsonValueKind.Number ? pr.GetInt32() : 0;
                var type = v.TryGetProperty("type", out var ty) && ty.ValueKind == JsonValueKind.String ? ty.GetString()! : "";
                var num = v.TryGetProperty("num", out var nm) && nm.ValueKind == JsonValueKind.Number ? nm.GetInt32() : 0;
                map[m.Name] = [cat.GetString()!, power, contact, acc, pp, pri, type, num > 0 && text.TryGetValue(num, out var d) ? d : ""];
            }
            await File.WriteAllTextAsync(_file + ".part", JsonSerializer.Serialize(map));
            File.Move(_file + ".part", _file, overwrite: true);
            return map;
        }
        catch { return File.Exists(_file) ? Read() : null; }   // offline: keep the old copy
        finally { _gate.Release(); }
    }

    // The newest English in-game description of each move, by move number.
    private static async Task<Dictionary<int, string>> DescriptionsAsync()
    {
        var best = new Dictionary<int, (int Ver, string Text)>();
        try
        {
            using var reader = new StringReader(await Http.GetStringAsync(TextUrl));
            var csv = reader.ReadToEnd();
            // move_id,version_group_id,language_id,"flavor_text" — the text may hold quoted line breaks
            foreach (System.Text.RegularExpressions.Match r in System.Text.RegularExpressions.Regex.Matches(csv,
                         @"^(\d+),(\d+),9,(?:""((?:[^""]|"""")*)""|([^\r\n]*))", System.Text.RegularExpressions.RegexOptions.Multiline))
            {
                int id = int.Parse(r.Groups[1].Value), ver = int.Parse(r.Groups[2].Value);
                var t = r.Groups[3].Success ? r.Groups[3].Value.Replace("\"\"", "\"") : r.Groups[4].Value;
                t = System.Text.RegularExpressions.Regex.Replace(System.Text.RegularExpressions.Regex.Replace(t, "\u00ad" + @"\s*", ""), @"\s+", " ").Trim();
                if (!best.TryGetValue(id, out var b) || ver > b.Ver) best[id] = (ver, t);
            }
        }
        catch { /* descriptions are optional */ }
        return best.ToDictionary(x => x.Key, x => x.Value.Text);
    }

    /// <summary>The move table if it has been fetched before; never goes online.</summary>
    public Dictionary<string, object[]>? Cached() => File.Exists(_file) ? Read() : null;

    private Dictionary<string, object[]>? Read()
    {
        try { return JsonSerializer.Deserialize<Dictionary<string, object[]>>(File.ReadAllText(_file)); }
        catch { return null; }
    }
}
