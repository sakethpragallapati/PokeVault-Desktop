namespace PokeVault.Core;

/// <summary>
/// Auto-sort and Living Dex. Whenever one changes anything, the layout before it is kept (<see cref="VaultService.Keep"/>),
/// so the last rearrangement can always be undone.
/// </summary>
public sealed class OrganizeService(VaultService vault)
{
    public const string LivingPrefix = "Living Dex ";
    private static readonly string[] TypeOrder =
        ["Normal", "Fire", "Water", "Grass", "Electric", "Ice", "Fighting", "Poison", "Ground", "Flying",
         "Psychic", "Bug", "Rock", "Ghost", "Dragon", "Dark", "Steel", "Fairy"];

    public static readonly Dictionary<string, string> SortNames = new()
    {
        ["dex"] = "Pokédex number", ["type"] = "type", ["gen"] = "generation",
        ["level"] = "level", ["shiny"] = "shiny first", ["newest"] = "newest first",
    };

    public static int GenerationOf(int species) => species switch
    {
        <= 151 => 1, <= 251 => 2, <= 386 => 3, <= 493 => 4, <= 649 => 5, <= 721 => 6, <= 809 => 7, <= 905 => 8, _ => 9,
    };

    private bool IsLiving(int box) => box < vault.Boxes.Count && vault.Boxes[box].Name.StartsWith(LivingPrefix, StringComparison.Ordinal);

    private IOrderedEnumerable<(VaultEntry E, MonInfo I)> Order(IEnumerable<(VaultEntry E, MonInfo I)> list, string by)
    {
        int TypeRank(MonInfo i) => i.Types.Length > 0 && Array.IndexOf(TypeOrder, i.Types[0]) is var r and >= 0 ? r : 99;
        var eggsLast = list.OrderBy(x => x.I.IsEgg);
        var o = by switch
        {
            "type" => eggsLast.ThenBy(x => TypeRank(x.I)),
            "gen" => eggsLast.ThenBy(x => GenerationOf(x.I.Species)),
            "level" => eggsLast.ThenByDescending(x => x.I.Level),
            "shiny" => eggsLast.ThenByDescending(x => x.I.Shiny),
            "newest" => eggsLast.ThenByDescending(x => x.E.Added),
            _ => eggsLast,
        };
        return o.ThenBy(x => x.I.Species).ThenBy(x => x.I.Form).ThenByDescending(x => x.I.Shiny).ThenByDescending(x => x.I.Level);
    }

    /// <summary>Sorts one box, or the whole Vault (Living Dex boxes are left alone). Returns how many moved.</summary>
    public int Sort(string scope, int box, string by)
    {
        if (!SortNames.ContainsKey(by)) throw new VaultException("Unknown way to sort.");
        var mons = vault.All.Select(e => (E: e, I: vault.Info(e))).Where(x => x.I is not null).Select(x => (x.E, I: x.I!)).ToList();
        if (scope == "box") vault.CheckSlot(box, 0);
        var before = vault.Capture(scope == "box" ? $"Sort {vault.Boxes[box].Name} by {SortNames[by]}" : $"Sort the Vault by {SortNames[by]}");
        List<int> targets;
        if (scope == "box")
        {
            mons = mons.Where(x => x.E.Box == box).ToList();
            targets = [box];
        }
        else
        {
            mons = mons.Where(x => !IsLiving(x.E.Box)).ToList();
            targets = Enumerable.Range(0, vault.Boxes.Count).Where(b => !IsLiving(b)).ToList();
            while (targets.Count * VaultService.BoxSize < mons.Count) targets.Add(vault.AddBox($"Box {vault.Boxes.Count + 1}"));
        }
        var ordered = Order(mons, by).ToList();
        var moves = ordered.Select((x, i) => (x.E, targets[i / VaultService.BoxSize], i % VaultService.BoxSize)).ToList();
        int moved = moves.Count(m => m.Item1.Box != m.Item2 || m.Item1.Slot != m.Item3);
        if (moved > 0 || vault.Boxes.Count != before.BoxNames.Count) vault.Keep(before);   // nothing changed: keep the older undo point
        vault.Place(moves);
        return moved;
    }

    /// <summary>
    /// One Pokémon of each species you have, in Pokédex order, in Living Dex boxes at the end of the Vault
    /// (#0001–#0030 in the first, and so on). Run again later and it fills in species you've added since.
    /// </summary>
    public (int Placed, int Species, int Boxes) LivingDex()
    {
        int total = DexData.All.Count, need = (total + VaultService.BoxSize - 1) / VaultService.BoxSize;
        var before = vault.Capture("Make the Living Dex");
        var living = Enumerable.Range(0, vault.Boxes.Count).Where(IsLiving).ToList();
        while (living.Count < need)
        {
            int k = living.Count, from = k * VaultService.BoxSize + 1, to = Math.Min(total, from + VaultService.BoxSize - 1);
            living.Add(vault.AddBox($"{LivingPrefix}{from:0000}–{to:0000}"));
        }
        (int Box, int Slot) Home(int species) => (living[(species - 1) / VaultService.BoxSize], (species - 1) % VaultService.BoxSize);

        var mons = vault.All.Select(e => (E: e, I: vault.Info(e))).Where(x => x.I is { IsEgg: false }).Select(x => (x.E, I: x.I!)).ToList();
        // The plan: where each Pokémon will be, and who will be in each slot, kept in step as we go.
        var pos = vault.All.ToDictionary(e => e, e => (e.Box, e.Slot));
        var taken = vault.All.ToDictionary(e => (e.Box, e.Slot));
        void Put(VaultEntry e, (int, int) to) { taken.Remove(pos[e]); pos[e] = to; taken[to] = e; }
        int placed = 0;
        foreach (var group in mons.GroupBy(x => x.I.Species).OrderBy(g => g.Key))
        {
            if (group.Key < 1 || group.Key > total) continue;
            var home = Home(group.Key);
            if (taken.TryGetValue(home, out var there) && group.Any(x => x.E == there)) continue;   // already in place
            // Something of another species sits in this Pokédex slot: move it to the first free ordinary slot.
            if (taken.TryGetValue(home, out var squatter)) Put(squatter, FirstFreeOrdinary(taken));
            // Prefer the everyday one: regular colours, base form, highest level.
            var pick = group.OrderBy(x => x.I.Shiny).ThenBy(x => x.I.Form).ThenByDescending(x => x.I.Level).First();
            Put(pick.E, home);
            placed++;
        }
        var changes = pos.Where(p => p.Value != (p.Key.Box, p.Key.Slot)).Select(p => (p.Key, p.Value.Item1, p.Value.Item2)).ToList();
        if (changes.Count > 0 || vault.Boxes.Count != before.BoxNames.Count) vault.Keep(before);   // nothing changed: keep the older undo point
        vault.Place(changes);
        int species = mons.Select(x => x.I.Species).Distinct().Count();
        return (placed, species, living.Count);
    }

    private (int Box, int Slot) FirstFreeOrdinary(Dictionary<(int, int), VaultEntry> taken)
    {
        for (int b = 0; b < vault.Boxes.Count; b++)
        {
            if (IsLiving(b)) continue;
            for (int s = 0; s < VaultService.BoxSize; s++)
                if (!taken.ContainsKey((b, s))) return (b, s);
        }
        int nb = vault.AddBox($"Box {vault.Boxes.Count + 1}");
        return (nb, 0);
    }
}
