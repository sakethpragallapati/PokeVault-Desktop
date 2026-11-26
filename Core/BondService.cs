using System.Text.Json;

namespace PokeVault.Core;

/// <summary>How close you and a Pokémon are in the Meadow: 0–250 points, shown as 0–5 hearts.</summary>
public sealed record Bond(int Points, int Pets, int Treats, DateTime? Last)
{
    public int Hearts => Math.Min(5, Points / 50);
}

/// <summary>
/// Meadow friendship, kept in PokeVault's own data/meadow-bond.json by the Pokémon's permanent identity.
/// The Pokémon's own data (its in-game friendship) is never touched.
/// </summary>
public sealed class BondService
{
    public const int Max = 250;
    private readonly string _file;
    private readonly object _lock = new();
    private readonly Dictionary<string, Bond> _bonds;

    public BondService(AppPaths paths)
    {
        _file = Path.Combine(paths.DataDir, "meadow-bond.json");
        try { _bonds = JsonSerializer.Deserialize<Dictionary<string, Bond>>(File.ReadAllText(_file)) ?? []; }
        catch { _bonds = []; }
    }

    public Bond Get(string uid)
    {
        lock (_lock) return _bonds.TryGetValue(uid, out var b) ? b : new Bond(0, 0, 0, null);
    }

    /// <summary>A pet (+1) or a treat (−2 to +5, depending on whether it liked the flavour).</summary>
    public Bond Add(string uid, string kind, int delta)
    {
        if (string.IsNullOrEmpty(uid) || uid.Length > 64) throw new VaultException("Unknown Pokémon.");
        delta = kind == "pet" ? 1 : Math.Clamp(delta, -2, 5);
        lock (_lock)
        {
            var b = _bonds.TryGetValue(uid, out var x) ? x : new Bond(0, 0, 0, null);
            b = new Bond(Math.Clamp(b.Points + delta, 0, Max), b.Pets + (kind == "pet" ? 1 : 0), b.Treats + (kind == "treat" ? 1 : 0), DateTime.Now);
            _bonds[uid] = b;
            try
            {
                var tmp = _file + ".tmp";
                File.WriteAllText(tmp, JsonSerializer.Serialize(_bonds));
                File.Move(tmp, _file, overwrite: true);
            }
            catch { /* a nicety; never fail over it */ }
            return b;
        }
    }
}
