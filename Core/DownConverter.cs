using System.Reflection;
using System.Text.Json;
using PKHeX.Core;

namespace PokeVault.Core;

/// <summary>A move that had to change on the way down, for the message and the journey.</summary>
public sealed record MoveSwap(string From, string To);

/// <summary>
/// What PokeVault remembers while a Vault Pokémon visits an older game: where it went, the copy it wrote
/// (by identity), and the moves, nickname, item and species it sent, so the original can take the copy's
/// progress back when it returns.
/// </summary>
public sealed class AwayTrip
{
    public string GameId { get; set; } = "";
    public string Game { get; set; } = "";
    public int Gen { get; set; }
    public string CopyUid { get; set; } = "";
    public ushort SentSpecies { get; set; }
    /// <summary>Each move as [move sent, original move]. 0 sent = dropped (nothing fit); 0 original = a filler PokeVault added.</summary>
    public List<ushort[]> Moves { get; set; } = [];
    public string SentNickname { get; set; } = "";
    public int SentItem { get; set; }
    public DateTime Time { get; set; }
}

/// <summary>
/// Smart conversion to an older generation (Gen 3 to 7), which PKHeX can't do. The real games never move
/// Pokémon backwards, so this builds a fresh Pokémon of the older format by hand: same species, shininess,
/// nature, gender, IVs, EVs, level, nickname and trainer, with a PID rebuilt to fit the older rules,
/// the closest legal moves for any the older game doesn't have, its normal ability, a ball and item that
/// exist there. The full original stays in the Vault and takes the copy's progress back on return.
/// </summary>
public static class DownConverter
{
    /// <summary>Would moving this Pokémon into this save mean going to an older generation?</summary>
    public static bool IsDown(PKM pk, SaveFile sav) =>
        pk.GetType() != sav.PKMType && pk.Format > sav.Generation && sav.Generation < 8 && !(pk.Format <= 2 && sav.Generation <= 2);

    public static bool CanConvert(PKM pk, SaveFile sav, out string why)
    {
        why = "";
        var game = GameService.GameName(sav);
        if (sav.Generation < 3) { why = $"PokeVault can send Pokémon back as far as Gen 3, not to {game}."; return false; }
        if (pk.IsEgg) { why = $"Eggs can't be sent back to {game}. Hatch it first."; return false; }
        if (pk.Species > sav.MaxSpeciesID) { why = $"It doesn't exist in {game}."; return false; }
        if (!sav.Personal.IsPresentInGame(pk.Species, pk.Form))
        {
            why = pk.Form != 0 && sav.Personal.IsPresentInGame(pk.Species, 0)
                ? $"That form doesn't exist in {game}." : $"It doesn't exist in {game}.";
            return false;
        }
        return true;
    }

    public static (PKM Pk, List<MoveSwap> Swaps, List<ushort[]> Pairs) Convert(PKM src, SaveFile sav, Dictionary<string, object[]>? moveData)
    {
        var pk = sav.BlankPKM;
        int gen = sav.Generation;
        pk.Species = src.Species;
        pk.Form = src.Form;

        // trainer
        pk.TID16 = src.TID16;
        pk.SID16 = src.SID16;
        pk.OriginalTrainerName = Trim(src.OriginalTrainerName, pk.MaxStringLengthTrainer);
        pk.OriginalTrainerGender = src.OriginalTrainerGender;
        pk.Language = LanguageFor(src.Language, gen);

        // where it came from: its own old game if that's this generation or older, otherwise "a link trade" here
        bool oldOrigin = src.Generation is var og && og >= 3 && og <= gen && src.Version <= sav.MaxGameID;
        pk.Version = oldOrigin ? src.Version : sav.Version <= sav.MaxGameID ? sav.Version : FirstVersion(gen);
        pk.MetLocation = gen switch { 3 => Locations.LinkTrade3NPC, 4 => Locations.LinkTrade4, 5 => Locations.LinkTrade5, _ => Locations.LinkTrade6 };
        if (gen >= 4) { var d = DateTime.Today; pk.MetYear = (byte)(d.Year - 2000); pk.MetMonth = (byte)d.Month; pk.MetDay = (byte)d.Day; }

        // level, stats, friendship
        pk.EXP = Math.Min(src.EXP, Experience.GetEXP(100, pk.PersonalInfo.EXPGrowth));
        pk.IV_HP = src.IV_HP; pk.IV_ATK = src.IV_ATK; pk.IV_DEF = src.IV_DEF; pk.IV_SPA = src.IV_SPA; pk.IV_SPD = src.IV_SPD; pk.IV_SPE = src.IV_SPE;
        pk.EV_HP = src.EV_HP; pk.EV_ATK = src.EV_ATK; pk.EV_DEF = src.EV_DEF; pk.EV_SPA = src.EV_SPA; pk.EV_SPD = src.EV_SPD; pk.EV_SPE = src.EV_SPE;
        pk.CurrentFriendship = src.CurrentFriendship;
        pk.OriginalTrainerFriendship = src.CurrentFriendship;
        if (src.PokerusStrain > 0) { pk.PokerusStrain = src.PokerusStrain; pk.PokerusDays = src.PokerusDays; }

        // ability: the same one if this game has it, otherwise the one in the same slot (no hidden abilities before Gen 5)
        var pi = sav.Personal.GetFormEntry(pk.Species, pk.Form);
        int abilityIndex = pi.GetIndexOfAbility(src.Ability);
        if (abilityIndex < 0 || abilityIndex >= pi.AbilityCount || (gen < 5 && abilityIndex > 1))
            abilityIndex = Math.Clamp(src.AbilityNumber >> 1, 0, Math.Min(pi.AbilityCount, gen < 5 ? 2 : 3) - 1);
        bool twoAbilities = pi.AbilityCount > 1 && pi.GetAbilityAtIndex(0) != pi.GetAbilityAtIndex(1);

        // PID: Gen 3-5 work out shininess, gender, nature (3-4) and the ability slot (3-5) from it
        var nature = src.Nature;
        if (gen <= 5)
            pk.PID = FindPid(src, pk, gen, nature, abilityIndex & 1, twoAbilities && abilityIndex < 2);
        else
        {
            pk.PID = src.PID;
            pk.EncryptionConstant = src.EncryptionConstant;
        }
        if (gen >= 5) pk.Nature = nature;
        if (gen >= 4) pk.Gender = src.Gender;
        // (PKHeX's SetAbilityIndex rerolls the PID in Gen 3-5, which would lose the shininess worked out above)
        if (gen >= 6) CommonEdits.SetAbilityIndex(pk, abilityIndex);
        else
        {
            if (pk is PK3 p3) p3.AbilityBit = twoAbilities && abilityIndex == 1;
            else pk.Ability = pi.GetAbilityAtIndex(abilityIndex);
            if (pk is PK5 p5) p5.HiddenAbility = abilityIndex == 2;
        }

        // ball and item that exist here
        pk.Ball = src.Ball <= sav.MaxBallID && src.Ball != 0 ? src.Ball : (byte)Ball.Poke;
        int item = src.HeldItem == 0 ? 0 : ItemConverter.GetItemForFormat(src.HeldItem, src.Context, pk.Context);
        pk.HeldItem = item > 0 && item <= sav.MaxItemID ? item : 0;

        // nickname
        if (src.IsNicknamed)
        {
            pk.IsNicknamed = true;
            pk.Nickname = Trim(src.Nickname, pk.MaxStringLengthNickname);
        }
        else CommonEdits.ClearNickname(pk);

        // moves
        var swaps = new List<MoveSwap>();
        var pairs = new List<ushort[]>();
        var moves = PickMoves(src, pk, sav, moveData, swaps, pairs);
        SetMoves(pk, moves, i => moves[i] == Moves(src)[i] ? PpUps(src, i) : 0);

        CopyRibbonsAndContest(src, pk, merge: false);
        pk.ResetPartyStats();
        pk.RefreshChecksum();
        return (pk, swaps, pairs);
    }

    /// <summary>
    /// The original takes back what happened in the older game: level and EXP, evolution, nickname,
    /// friendship, EVs, Pokérus, ribbons and contest stats, a new held item, and new moves. Slots that
    /// still hold a move PokeVault swapped in get the original move back.
    /// </summary>
    public static PKM MergeBack(PKM original, PKM copy, AwayTrip trip)
    {
        var pk = original.Clone();
        var origMoves = Moves(original);

        if (copy.Species != trip.SentSpecies && copy.Species <= pk.MaxSpeciesID)
        {
            int slot = pk.AbilityNumber >> 1;
            pk.Species = copy.Species;

            slot = Math.Clamp(slot, 0, pk.PersonalInfo.AbilityCount - 1);
            if (pk.Format >= 6) CommonEdits.SetAbilityIndex(pk, slot);   // in Gen 3-5 that would reroll the PID
            else if (pk is not PK3) pk.Ability = pk.PersonalInfo.GetAbilityAtIndex(slot);
            if (!pk.IsNicknamed) CommonEdits.ClearNickname(pk);
        }
        if (copy.EXP > pk.EXP) pk.EXP = Math.Min(copy.EXP, Experience.GetEXP(100, pk.PersonalInfo.EXPGrowth));
        if (copy.Nickname != trip.SentNickname)
        {
            if (copy.IsNicknamed) { pk.IsNicknamed = true; pk.Nickname = copy.Nickname; }
            else CommonEdits.ClearNickname(pk);
        }
        pk.CurrentFriendship = copy.CurrentFriendship;
        pk.EV_HP = copy.EV_HP; pk.EV_ATK = copy.EV_ATK; pk.EV_DEF = copy.EV_DEF; pk.EV_SPA = copy.EV_SPA; pk.EV_SPD = copy.EV_SPD; pk.EV_SPE = copy.EV_SPE;
        if (copy.PokerusStrain > 0) { pk.PokerusStrain = copy.PokerusStrain; pk.PokerusDays = copy.PokerusDays; }
        if (copy.HeldItem != trip.SentItem)
        {
            int item = copy.HeldItem == 0 ? 0 : ItemConverter.GetItemForFormat(copy.HeldItem, copy.Context, pk.Context);
            pk.HeldItem = item > 0 && item <= pk.MaxItemID ? item : 0;
        }

        // moves, in the order the copy has them: a move PokeVault swapped in gets the original back, a move
        // learned there stays (if newer games have it), and moves that had to be dropped fill the gaps
        var copyMoves = Moves(copy);
        var pairs = trip.Moves.Select(x => (Sent: x.ElementAtOrDefault(0), Orig: x.ElementAtOrDefault(1), Used: false)).ToList();
        var dropped = new Queue<ushort>(pairs.Where(x => x.Sent == 0 && x.Orig != 0).Select(x => x.Orig));
        var result = new List<(ushort Move, int Ups)>();
        for (int j = 0; j < 4; j++)
        {
            var m = copyMoves[j];
            if (m == 0) continue;
            int k = pairs.FindIndex(x => !x.Used && x.Sent == m);
            if (k >= 0)
            {
                pairs[k] = pairs[k] with { Used = true };
                var orig = pairs[k].Orig;
                if (orig == 0 && dropped.Count > 0) orig = dropped.Dequeue();   // a filler: give back what it replaced
                if (orig != 0) result.Add((orig, PpUps(original, Array.IndexOf(origMoves, orig))));
            }
            else if (m <= pk.MaxMoveID && !MoveInfo.IsDummiedMove(pk, m)) result.Add((m, PpUps(copy, j)));
        }
        while (result.Count < 4 && dropped.Count > 0) { var o = dropped.Dequeue(); result.Add((o, PpUps(original, Array.IndexOf(origMoves, o)))); }
        result = result.Where(x => x.Move != 0).DistinctBy(x => x.Move).Take(4).ToList();
        if (result.Count == 0) result = origMoves.Select((m, i) => (m, PpUps(original, i))).Where(x => x.m != 0).ToList();
        var final = result.Select(x => x.Move).ToArray();
        SetMoves(pk, final, i => result[i].Ups);

        CopyRibbonsAndContest(copy, pk, merge: true);
        pk.ResetPartyStats();
        pk.RefreshChecksum();
        return pk;
    }

    // ---------- moves ----------

    private static ushort[] PickMoves(PKM src, PKM pk, SaveFile sav, Dictionary<string, object[]>? data, List<MoveSwap> swaps, List<ushort[]> pairs)
    {
        var learn = Learnable(pk, sav);
        var orig = Moves(src);
        var chosen = new ushort[4];
        bool Ok(ushort m) => m != 0 && m <= sav.MaxMoveID && m < learn.Length && learn[m] && !MoveInfo.IsDummiedMove(pk, m);
        for (int i = 0; i < 4; i++) if (Ok(orig[i]) && !chosen.Contains(orig[i])) chosen[i] = orig[i];

        var names = GameInfo.Strings.movelist;
        for (int i = 0; i < 4; i++)
        {
            if (orig[i] == 0 || chosen[i] != 0) continue;
            var want = Info(orig[i], src.Context, data);
            ushort best = 0; double bestScore = double.MinValue;
            for (int c = 1; c < learn.Length; c++)
            {
                var m = (ushort)c;
                if (!Ok(m) || chosen.Contains(m) || orig.Contains(m)) continue;
                var have = Info(m, pk.Context, data);
                double score = 0;
                if (have.Type == want.Type) score += 100;
                if (have.Category == want.Category) score += 50;
                if (want.Power > 0 && have.Power > 0) score -= Math.Abs(have.Power - want.Power) / 2.0;
                else if (want.Power > 0 != have.Power > 0) score -= 60;
                score += have.Power / 100.0;   // tie-break: the stronger one
                if (score > bestScore) { bestScore = score; best = m; }
            }
            if (best == 0) continue;
            chosen[i] = best;
            swaps.Add(new(names[orig[i]], names[best]));
        }
        if (chosen.All(m => m == 0))
        {
            // nothing fits at all: the highest level-up moves it knows by now
            var ls = GameData.GetLearnSource(LearnVersion(sav)).GetLearnset(pk.Species, pk.Form);
            var lv = ls.GetMoveRange(pk.CurrentLevel, 1).ToArray().Where(m => m <= sav.MaxMoveID).Distinct().TakeLast(4).ToArray();
            for (int i = 0; i < lv.Length; i++) { chosen[i] = lv[i]; pairs.Add([lv[i], 0]); }
            foreach (var o in orig) if (o != 0) pairs.Add([0, o]);
            return Dedupe(chosen);
        }
        for (int i = 0; i < 4; i++) if (orig[i] != 0) pairs.Add([chosen[i], orig[i]]);
        return Dedupe(chosen);
    }

    /// <summary>Every move this species (or what it evolved from) can learn in this game, egg moves included.</summary>
    private static bool[] Learnable(PKM pk, SaveFile sav)
    {
        var result = new bool[Math.Max(sav.MaxMoveID + 1, 1000)];
        var source = GameData.GetLearnSource(LearnVersion(sav));
        var chain = new List<(ushort Species, byte Form)> { (pk.Species, pk.Form) };
        try
        {
            foreach (var p in EvolutionTree.GetEvolutionTree(pk.Context).Reverse.GetPreEvolutions(pk.Species, pk.Form))
                chain.Add((p.Species, p.Form));
        }
        catch { /* no evolution data: this species only */ }
        foreach (var (s, f) in chain)
        {
            if (!sav.Personal.IsPresentInGame(s, f)) continue;
            try
            {
                source.GetAllMoves(result, pk, new EvoCriteria { Species = s, Form = f, LevelMax = 100, LevelMin = 1 }, MoveSourceType.All);
                foreach (var m in source.GetEggMoves(s, f)) if (m < result.Length) result[m] = true;
            }
            catch { /* skip this stage */ }
        }
        return result;
    }

    private static GameVersion LearnVersion(SaveFile sav) => sav.Version <= sav.MaxGameID ? sav.Version : FirstVersion(sav.Generation);

    private static GameVersion FirstVersion(int gen) => gen switch
    {
        3 => GameVersion.E, 4 => GameVersion.Pt, 5 => GameVersion.B2, 6 => GameVersion.OR, _ => GameVersion.US,
    };

    private readonly record struct MoveFacts(string Type, string Category, int Power);

    /// <summary>Type, category and power: from the cached move table when there is one, otherwise PKHeX's type only.</summary>
    private static MoveFacts Info(ushort move, EntityContext ctx, Dictionary<string, object[]>? data)
    {
        var name = GameInfo.Strings.movelist[move];
        var id = new string(name.ToLowerInvariant().Where(char.IsLetterOrDigit).ToArray());
        if (data is not null && data.TryGetValue(id, out var v) && v.Length >= 7)
            return new(Str(v[6]), Str(v[0]), Num(v[1]));
        var type = ((PKHeX.Core.MoveType)MoveInfo.GetType(move, ctx)).ToString();
        return new(type, "", 0);
    }

    private static string Str(object o) => o is JsonElement e ? e.ToString() : o?.ToString() ?? "";
    private static int Num(object o) => o is JsonElement e && e.ValueKind == JsonValueKind.Number ? e.GetInt32() : o is int i ? i : 0;

    private static ushort[] Moves(PKM pk) => [pk.Move1, pk.Move2, pk.Move3, pk.Move4];

    private static int PpUps(PKM pk, int i) => i < 0 ? 0 : i switch { 0 => pk.Move1_PPUps, 1 => pk.Move2_PPUps, 2 => pk.Move3_PPUps, _ => pk.Move4_PPUps };

    private static ushort[] Dedupe(ushort[] moves)
    {
        var seen = new HashSet<ushort>();
        var r = moves.Where(m => m != 0 && seen.Add(m)).ToList();
        while (r.Count < 4) r.Add(0);
        return [.. r];
    }

    private static void SetMoves(PKM pk, ushort[] moves, Func<int, int> ppUps)
    {
        // keep PP Ups lined up with the moves after empty slots are squeezed out
        var list = moves.Select((m, i) => (m, ups: ppUps(i))).Where(x => x.m != 0).ToList();
        while (list.Count < 4) list.Add((0, 0));
        pk.Move1 = list[0].m; pk.Move2 = list[1].m; pk.Move3 = list[2].m; pk.Move4 = list[3].m;
        pk.Move1_PPUps = list[0].m == 0 ? 0 : list[0].ups; pk.Move2_PPUps = list[1].m == 0 ? 0 : list[1].ups;
        pk.Move3_PPUps = list[2].m == 0 ? 0 : list[2].ups; pk.Move4_PPUps = list[3].m == 0 ? 0 : list[3].ups;
        pk.HealPP();
    }

    // ---------- PID ----------

    private static uint FindPid(PKM src, PKM pk, int gen, Nature nature, int abilityBit, bool abilityMatters)
    {
        bool shiny = src.IsShiny;
        var pi = pk.PersonalInfo;
        byte ratio = pi.Gender;
        bool genderMatters = ratio is not (PersonalInfo.RatioMagicGenderless or PersonalInfo.RatioMagicFemale or PersonalInfo.RatioMagicMale);
        uint tsv = (uint)(src.TID16 ^ src.SID16);

        bool Fits(uint pid)
        {
            if ((((pid >> 16) ^ (pid & 0xFFFF) ^ tsv) < 8) != shiny) return false;
            if (genderMatters && ((pid & 0xFF) < ratio ? 1 : 0) != src.Gender) return false;
            if (gen <= 4 && (Nature)(pid % 25) != nature) return false;
            if (abilityMatters && (gen == 5 ? (int)((pid >> 16) & 1) : (int)(pid & 1)) != abilityBit) return false;
            if (gen == 3 && pk.Species == (ushort)Species.Unown && EntityPID.GetUnownForm3(pid) != src.Form) return false;
            return true;
        }

        if (Fits(src.PID)) return src.PID;   // e.g. it came from this generation in the first place
        var rnd = new Random();
        for (int n = 0; n < 5_000_000; n++)
        {
            uint low = (uint)rnd.Next(0x10000);
            uint high = shiny ? (low ^ tsv ^ (uint)rnd.Next(8)) & 0xFFFF : (uint)rnd.Next(0x10000);
            uint pid = (high << 16) | low;
            if (Fits(pid)) return pid;
        }
        return src.PID;
    }

    // ---------- small helpers ----------

    private static int LanguageFor(int lang, int gen)
    {
        if (lang is <= 0 or 6) return (int)LanguageID.English;
        if (lang == (int)LanguageID.Korean && gen < 4) return (int)LanguageID.English;
        if (lang >= (int)LanguageID.ChineseS && gen < 7) return (int)LanguageID.English;
        return lang;
    }

    private static string Trim(string s, int max) => s.Length <= max ? s : s[..max];

    private static readonly string[] ContestStats = ["ContestCool", "ContestBeauty", "ContestCute", "ContestSmart", "ContestTough", "ContestSheen"];

    /// <summary>Ribbons (and Gen 3 contest ribbon counts) and contest stats that both formats have, by name.</summary>
    private static void CopyRibbonsAndContest(PKM from, PKM to, bool merge)
    {
        foreach (var p in to.GetType().GetProperties(BindingFlags.Public | BindingFlags.Instance))
        {
            if (!p.CanWrite || !(p.Name.StartsWith("Ribbon") || ContestStats.Contains(p.Name))) continue;
            var q = from.GetType().GetProperty(p.Name, BindingFlags.Public | BindingFlags.Instance);
            if (q is null || !q.CanRead || q.PropertyType != p.PropertyType) continue;
            try
            {
                var v = q.GetValue(from);
                if (p.PropertyType == typeof(bool)) { if ((bool)v! || !merge) p.SetValue(to, merge ? true : v); }
                else if (p.PropertyType == typeof(byte)) { var b = (byte)v!; if (!merge || b > (byte)p.GetValue(to)!) p.SetValue(to, b); }
            }
            catch { /* a ribbon this format can't hold */ }
        }
    }
}
