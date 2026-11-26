using System.Text.Json;

namespace PokeVault.Core;

/// <summary>One stop on a Pokémon's journey: when, what kind ("caught", "vault", "game", "import", "release") and a sentence.</summary>
public sealed record JourneyStep(DateTime Time, string Kind, string Text);

/// <summary>
/// The log of everything PokeVault did with each Pokémon, keyed by its permanent identity
/// (<see cref="CatchWatcher.Identity"/>), so the story follows it in and out of games. Kept in
/// PokeVault's own data/journey.json; the Pokémon's own data is never touched.
/// </summary>
public sealed class JourneyService
{
    private const int MaxStepsPerMon = 60;
    private readonly string _file;
    private readonly object _lock = new();
    private readonly Dictionary<string, List<JourneyStep>> _log;

    public JourneyService(AppPaths paths)
    {
        _file = Path.Combine(paths.DataDir, "journey.json");
        try { _log = JsonSerializer.Deserialize<Dictionary<string, List<JourneyStep>>>(File.ReadAllText(_file)) ?? []; }
        catch { _log = []; }
    }

    public IReadOnlyList<JourneyStep> For(string uid)
    {
        lock (_lock) return _log.TryGetValue(uid, out var l) ? l.ToArray() : [];
    }

    public void Add(string uid, string kind, string text) => AddMany([(uid, kind, text)]);

    public void AddMany(IEnumerable<(string Uid, string Kind, string Text)> steps)
    {
        lock (_lock)
        {
            var now = DateTime.Now;
            foreach (var (uid, kind, text) in steps)
            {
                if (string.IsNullOrEmpty(uid)) continue;
                var l = _log.TryGetValue(uid, out var x) ? x : _log[uid] = [];
                l.Add(new JourneyStep(now, kind, text));
                if (l.Count > MaxStepsPerMon) l.RemoveRange(0, l.Count - MaxStepsPerMon);
            }
            try
            {
                var tmp = _file + ".tmp";
                File.WriteAllText(tmp, JsonSerializer.Serialize(_log));
                File.Move(tmp, _file, overwrite: true);
            }
            catch { /* the story is a nicety; never fail a transfer over it */ }
        }
    }
}
