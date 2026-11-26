using System.Text.Json;
using PKHeX.Core;

namespace PokeVault.Core;

/// <summary>A Pokémon that turned up in a save since PokeVault last looked (a new catch, gift, hatch-from-trade…).</summary>
public sealed record CatchEvent(long Id, DateTime Time, string GameId, string Game, MonInfo Mon, string Where, bool Away);

/// <summary>
/// Live catch alerts. Remembers which Pokémon are in each connected save (party and boxes) and reports
/// the ones that weren't there before. A Pokémon is recognised by values that never change (encryption
/// constant, PID, trainer IDs and IVs), so evolving, hatching or renaming it doesn't count as "new".
/// Saves that PokeVault writes itself are recorded silently. What it last saw is kept on disk, so
/// Pokémon caught while PokeVault was closed are reported once at the next start ("while you were away").
/// </summary>
public sealed class CatchWatcher
{
    private const int KeepEvents = 200;
    private readonly string _file;
    private readonly object _lock = new();
    private readonly Dictionary<string, List<string>> _known;
    private readonly HashSet<string> _seenThisRun = [];
    private readonly List<CatchEvent> _events = [];
    private long _seq;

    private readonly JourneyService _journey;

    public CatchWatcher(AppPaths paths, JourneyService journey)
    {
        _journey = journey;
        _file = Path.Combine(paths.DataDir, "catch-watch.json");
        try { _known = JsonSerializer.Deserialize<Dictionary<string, List<string>>>(File.ReadAllText(_file)) ?? []; }
        catch { _known = []; }
    }

    /// <summary>A different value every time PokeVault starts, so the page knows which alerts it has shown.</summary>
    public string RunId { get; } = Guid.NewGuid().ToString("N")[..8];

    public long LastId { get { lock (_lock) return _seq; } }

    public CatchEvent[] Since(long after)
    {
        lock (_lock) return _events.Where(e => e.Id > after).ToArray();
    }

    /// <summary>The identity of a Pokémon that survives evolving, hatching and renaming.</summary>
    public static string Identity(PKM pk) =>
        $"{pk.EncryptionConstant:X8}{pk.PID:X8}{pk.TID16:X4}{pk.SID16:X4}{pk.IV_HP:X2}{pk.IV_ATK:X2}{pk.IV_DEF:X2}{pk.IV_SPA:X2}{pk.IV_SPD:X2}{pk.IV_SPE:X2}";

    /// <summary>
    /// Compares a freshly read save with what was there last time. With <paramref name="silent"/> (a save
    /// PokeVault wrote itself) the new state is only remembered.
    /// </summary>
    public void Observe(string gameId, string game, SaveFile sav, bool silent = false)
    {
        var now = new List<(string Key, PKM Pk, int Box, int Slot)>();
        try
        {
            if (sav.HasParty)
                for (int i = 0; i < sav.PartyCount; i++)
                    if (sav.GetPartySlotAtIndex(i) is { Species: > 0 } p) now.Add((Identity(p), p, -1, i));
            for (int b = 0; b < sav.BoxCount; b++)
                for (int s = 0; s < sav.BoxSlotCount; s++)
                    if (sav.GetBoxSlotAtIndex(b, s) is { Species: > 0 } p) now.Add((Identity(p), p, b, s));
        }
        catch { return; }   // a save PKHeX can't walk: no alerts rather than wrong ones

        lock (_lock)
        {
            var firstThisRun = _seenThisRun.Add(gameId);
            if (_known.TryGetValue(gameId, out var before) && !silent)
            {
                // Multiset difference: two identical copies count as two.
                var left = before.GroupBy(k => k).ToDictionary(g => g.Key, g => g.Count());
                foreach (var (k, pk, box, slot) in now)
                {
                    if (left.TryGetValue(k, out var n) && n > 0) { left[k] = n - 1; continue; }
                    MonInfo info;
                    try { info = MonDescriber.Describe(pk, box, slot); } catch { continue; }
                    var where = box < 0 ? "party" : GameService.BoxName(sav, box);
                    _events.Add(new CatchEvent(++_seq, DateTime.Now, gameId, game, info, where, firstThisRun));
                    _journey.Add(k, "caught", $"Arrived in {game}", game, sav.Generation);
                }
                if (_events.Count > KeepEvents) _events.RemoveRange(0, _events.Count - KeepEvents);
            }
            _known[gameId] = now.Select(x => x.Key).ToList();
            Save();
        }
    }

    private void Save()
    {
        try
        {
            var tmp = _file + ".tmp";
            File.WriteAllText(tmp, JsonSerializer.Serialize(_known));
            File.Move(tmp, _file, overwrite: true);
        }
        catch { /* alerts are a nicety; never fail a request over them */ }
    }
}
