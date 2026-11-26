using System.Collections.Concurrent;
using PKHeX.Core;

namespace PokeVault.Core;

/// <summary>One way to get a Pokémon in a game: where, how and at which levels.</summary>
public sealed record CatchSpot(string Method, string Place, int LevelMin, int LevelMax, int Species, string SpeciesName, string? Note);
/// <summary>The ways to get a Pokémon in one of your connected games.</summary>
public sealed record GameSpots(string GameId, string Game, string Version, CatchSpot[] Spots, string? Note);

/// <summary>
/// "Where to catch it": PKHeX's own encounter tables, asked for each game you have connected. Only things
/// you can still do in that game are listed: event gifts, Colosseum/XD and long-closed online features are left out.
/// </summary>
public sealed class EncounterService(GameService games)
{
    private const int MaxSpots = 14;
    private readonly ConcurrentDictionary<(GameVersion, int), (CatchSpot[] Spots, string? Note)> _cache = new();

    public GameSpots[] Where(int species)
    {
        var list = new List<GameSpots>();
        foreach (var g in games.List().Where(g => g.Supported && !g.Hidden))
        {
            SaveFile sav;
            try { sav = games.LoadForReading(g.Id); } catch { continue; }
            var (spots, note) = _cache.GetOrAdd((sav.Version, species), _ => Find(sav, species));
            list.Add(new GameSpots(g.Id, g.Game, g.Version, spots, note));
        }
        // Games where you can get it first.
        return list.OrderByDescending(x => x.Spots.Length > 0).ToArray();
    }

    private static (CatchSpot[], string?) Find(SaveFile sav, int species)
    {
        var name = MonDescriber.SpeciesName(species);
        if (species > sav.MaxSpeciesID) return ([], $"{name} isn't in this game.");

        var blank = sav.BlankPKM;
        blank.Species = (ushort)species;
        var spots = new Dictionary<(string Method, string Place, int Species), CatchSpot>();
        try
        {
            foreach (var e in EncounterMovesetGenerator.GenerateEncounters(blank, sav, ReadOnlyMemory<ushort>.Empty, sav.Version).Take(400))
            {
                if (Describe(e, sav) is not (string method, string place)) continue;
                if (!SameGame(sav.Version, e.Version)) continue;
                var k = (method, place, (int)e.Species);
                spots[k] = spots.TryGetValue(k, out var s)
                    ? s with { LevelMin = Math.Min(s.LevelMin, e.LevelMin), LevelMax = Math.Max(s.LevelMax, e.LevelMax) }
                    : new CatchSpot(method, place, e.LevelMin, e.LevelMax, e.Species, MonDescriber.SpeciesName(e.Species), Note(e, species, method));
            }
        }
        catch { /* PKHeX couldn't search this one: report it as not found */ }

        var ordered = spots.Values
            .OrderBy(s => Rank(s.Method)).ThenBy(s => s.Species == species ? 0 : 1).ThenBy(s => s.LevelMin)
            .Take(MaxSpots).ToArray();
        return (ordered, ordered.Length == 0 ? $"You can't get {name} in this game itself. Trade it in, or bring it from the Vault." : null);
    }

    // What kind of encounter this is and where, or null for ones that can't be done in the game today.
    private static (string, string)? Describe(IEncounterable e, SaveFile sav)
    {
        var type = e.GetType().Name;
        // Event gifts (Mystery Gift, wonder cards…), Colosseum / XD, Dream World and Dream Radar, online distributions.
        if (e is MysteryGift || type.Contains("Colo") || type.Contains("XD") || type.Contains("Shadow")
            || type.Contains("Entree") || type.Contains("Radar") || type.Contains("Dist") || type.Contains("Might")
            || type.StartsWith("EncounterGift3") || type.Contains("Pokewalker") || type.Contains("GO"))
            return null;

        string place = "";
        try
        {
            if (e is ILocation l && l.Location > 0)
                place = GameInfo.GetLocationName(false, l.Location, sav.Generation, e.Generation, e.Version) ?? "";
        }
        catch { /* no name */ }
        if (place.Contains('—') || place.StartsWith('(')) place = "";
        // PKHeX numbers the parts of an area ("Wayward Cave (2)", "Research Lab (-)"): one entry per place is enough.
        place = System.Text.RegularExpressions.Regex.Replace(place, @"(\s\((\d+|-)\))+$", "").Trim();

        if (type.StartsWith("EncounterEgg"))
            return ("Hatch from an Egg", sav.Generation >= 9 ? "Breed it at a picnic" : sav is SAV8SWSH or SAV8BS ? "Breed it at the Pokémon Nursery" : "Breed it at the Day Care");
        if (type.StartsWith("EncounterTrade")) return ("In-game trade", place);
        if (type.Contains("Tera")) return ("Tera Raid", place);
        if (type.StartsWith("EncounterStatic8N") || type.StartsWith("EncounterStatic8U") || type.Contains("8ND") || type.Contains("Max")) return ("Max Raid", place);
        if (type.StartsWith("EncounterSlot"))
        {
            // LongName ends with the slot kind, e.g. "Wild Encounter (BD) Grass" → "Grass".
            var kind = e.LongName is { } ln && ln.LastIndexOf(')') is var i and > 0 && i + 1 < ln.Length ? ln[(i + 1)..].Trim() : "";
            return (kind.Length > 0 ? $"Wild · {Pretty(kind)}" : "Wild", place);
        }
        return ("Special encounter", place);   // gifts, starters, legendaries in their lair…
    }

    private static string Pretty(string kind) => kind switch
    {
        "Standard" => "Grass",
        "SOS" => "SOS call",
        "Swarm" => "Swarm",
        "Super_Rod" or "SuperRod" => "Super Rod",
        "Good_Rod" or "GoodRod" => "Good Rod",
        "Old_Rod" or "OldRod" => "Old Rod",
        "Rock_Smash" or "RockSmash" => "Rock Smash",
        _ => System.Text.RegularExpressions.Regex.Replace(kind.Replace('_', ' '), "(?<=[a-z])(?=[A-Z])", " "),
    };

    private static string? Note(IEncounterable e, int wanted, string method)
    {
        if (e.Species == wanted) return null;
        var from = MonDescriber.SpeciesName(e.Species);
        return method.StartsWith("Hatch") ? $"Hatches as {from}, then evolve it" : $"Get {from}, then evolve it";
    }

    private static int Rank(string method) =>
        method.StartsWith("Wild") ? 0 : method.StartsWith("Special") ? 1 : method.Contains("Raid") ? 2 : method.StartsWith("In-game") ? 3 : 4;

    // Encounters for the paired game (Sapphire in a Ruby save) or a game group the save belongs to.
    private static bool SameGame(GameVersion save, GameVersion enc) =>
        enc == save || save.Contains(enc) || enc.Contains(save);
}
