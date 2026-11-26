using PKHeX.Core;

namespace PokeVault.Core;

public sealed record MoveView(string Name, string Type, int Id, int PP, int MaxPP, bool Mastered);
/// <summary>A ribbon or mark the Pokémon has (Key is PKHeX's property name, e.g. "RibbonChampionG3").</summary>
public sealed record RibbonView(string Key, string Name, int Count, bool Mark);

public sealed record MonInfo(
    string? Id, int Box, int Slot,
    int Species, int Form, string SpeciesName, string Nickname, bool IsNicknamed,
    int Level, bool Shiny, int Gender, bool IsEgg, string[] Types,
    string Nature, string Ability, string HeldItem, string Ball, string? TeraType,
    MoveView[] Moves, int[] Stats, int[] Ivs, int[] Evs,
    string OT, int OTGender, string TID, string Language,
    string Origin, string Version, int Generation, string MetLocation, int MetLevel, string? MetDate,
    string Format, double HeightM, double WeightKg, string SpriteId, string? FormName, bool Locked, string? Source, DateTime? Added,
    RibbonView[] Ribbons, string? Characteristic, string? Title,
    int Pokerus, string? Gimmick, int[] Markings,
    string Uid, bool HomeTracked);

public static class MonDescriber
{
    private static readonly GameStrings S = GameInfo.GetStrings("en");

    public static string TypeName(int type) => Str(S.Types, type);
    public static string SpeciesName(int species) => Str(S.Species, species);

    public static MonInfo Describe(PKM pk, int box, int slot, VaultEntry? entry = null, bool locked = false)
    {
        var moves = new (ushort Move, int PP, int Ups)[] {
                (pk.Move1, pk.Move1_PP, pk.Move1_PPUps), (pk.Move2, pk.Move2_PP, pk.Move2_PPUps),
                (pk.Move3, pk.Move3_PP, pk.Move3_PPUps), (pk.Move4, pk.Move4_PP, pk.Move4_PPUps) }
            .Where(m => m.Move != 0)
            .Select(m => new MoveView(Str(S.Move, m.Move), SafeMoveType(m.Move, pk.Context), m.Move, m.PP, SafeMaxPP(pk, m.Move, m.Ups), Mastered(pk, m.Move)))
            .ToArray();
        int[] ivs = [pk.IV_HP, pk.IV_ATK, pk.IV_DEF, pk.IV_SPA, pk.IV_SPD, pk.IV_SPE];
        int[] evs = [pk.EV_HP, pk.EV_ATK, pk.EV_DEF, pk.EV_SPA, pk.EV_SPD, pk.EV_SPE];
        var pi = pk.PersonalInfo;
        var types = pi.Type1 == pi.Type2 ? new[] { TypeName(pi.Type1) } : [TypeName(pi.Type1), TypeName(pi.Type2)];

        string met;
        try { met = GameInfo.GetLocationName(false, pk.MetLocation, pk.Format, pk.Generation, pk.Version) ?? ""; }
        catch { met = ""; }

        var size = DexData.Size(pk.Species, pk.Form);
        return new MonInfo(
            entry?.Id, box, slot,
            pk.Species, pk.Form, pk.IsEgg ? "Egg" : SpeciesName(pk.Species), pk.Nickname, pk.IsNicknamed,
            pk.CurrentLevel, pk.IsShiny, pk.Gender, pk.IsEgg, types,
            Str(S.Natures, (int)pk.Nature), Str(S.Ability, pk.Ability),
            pk.HeldItem > 0 ? Str(S.Item, pk.HeldItem) : "",
            Str(S.balllist, pk.Ball),
            pk is PK9 p9 ? p9.TeraType.ToString() : null,
            moves, Stats(pk), ivs, evs,
            pk.OriginalTrainerName, pk.OriginalTrainerGender,
            pk.Generation >= 7 || pk.Format >= 7 ? pk.DisplayTID.ToString("000000") : pk.DisplayTID.ToString("00000"),
            ((LanguageID)pk.Language).ToString(),
            GameInfo.GetVersionName(pk.Version), pk.Version.ToString(), pk.Generation, met, pk.MetLevel,
            pk.MetDate?.ToString("yyyy-MM-dd"),
            pk.Extension.ToUpperInvariant(), size.HeightM, size.WeightKg, DexData.ShowdownId(pk.Species, pk.Form, pk.Context), FormName(pk), locked, entry?.Source, entry?.Added,
            Ribbons(pk), Characteristic(pk), Title(pk),
            pk.IsPokerusCured ? 2 : pk.IsPokerusInfected ? 1 : 0, Gimmick(pk), Markings(pk),
            CatchWatcher.Identity(pk), pk is IHomeTrack h && h.HasTracker);
    }

    // Stored (box) data has no calculated stats, so work them out like the game does.
    private static int[] Stats(PKM pk)
    {
        try
        {
            var c = pk.Clone();
            c.ResetPartyStats();
            return [c.Stat_HPMax, c.Stat_ATK, c.Stat_DEF, c.Stat_SPA, c.Stat_SPD, c.Stat_SPE];
        }
        catch { return [0, 0, 0, 0, 0, 0]; }
    }

    // Legends: Arceus move mastery.
    private static bool Mastered(PKM pk, ushort move)
    {
        try
        {
            if (pk is not IMoveShop8Mastery shop) return false;
            var i = shop.Permit.RecordPermitIndexes.IndexOf(move);
            return i >= 0 && shop.GetMasteredRecordFlag(i);
        }
        catch { return false; }
    }

    private static string? Gimmick(PKM pk)
    {
        if (pk is IGigantamax g && g.CanGigantamax) return "gmax";
        if (pk is IAlpha a && a.IsAlpha) return "alpha";
        return null;
    }

    // ● ▲ ■ ♥ ★ ◆ — 0 off, 1 on (blue), 2 pink (Gen 7+ markings have two colours).
    private static int[] Markings(PKM pk)
    {
        try
        {
            if (pk is IAppliedMarkings7 m7) return Enumerable.Range(0, m7.MarkingCount).Select(i => (int)m7.GetMarking(i)).ToArray();
            if (pk is IAppliedMarkings<bool> mb) return Enumerable.Range(0, mb.MarkingCount).Select(i => mb.GetMarking(i) ? 1 : 0).ToArray();
        }
        catch { /* no markings */ }
        return [];
    }

    private static int SafeMaxPP(PKM pk, ushort move, int ups)
    {
        try { return pk.GetMovePP(move, ups); }
        catch { return 0; }
    }

    // Every ribbon and mark the Pokémon has earned, with its English name.
    [System.Diagnostics.CodeAnalysis.UnconditionalSuppressMessage("Trimming", "IL2026", Justification = "The app is not trimmed.")]
    private static RibbonView[] Ribbons(PKM pk)
    {
        try
        {
            return RibbonInfo.GetRibbonInfo(pk)
                .Where(r => r.HasRibbon || r.RibbonCount > 0)
                .Select(r => new RibbonView(r.Name, S.Ribbons.GetNameSafe(r.Name, out var n) ? n : Pretty(r.Name),
                    r.Type == RibbonValueType.Byte ? r.RibbonCount : 1, r.Name.StartsWith("RibbonMark", StringComparison.Ordinal)))
                .ToArray();
        }
        catch { return []; }
    }
    private static string Pretty(string prop) =>
        System.Text.RegularExpressions.Regex.Replace(prop.Replace("RibbonMark", "").Replace("Ribbon", ""), "(?<=[a-z0-9])(?=[A-Z])", " ");

    private static string? Characteristic(PKM pk)
    {
        try { var c = pk.Characteristic; return c >= 0 && c < S.characteristics.Length ? S.characteristics[c] : null; }
        catch { return null; }
    }

    // The ribbon or mark shown as a title after the name (Gen 8+), e.g. "the Champion".
    private static string? Title(PKM pk)
    {
        try
        {
            if (pk is not IRibbonSetAffixed a || a.AffixedRibbon < 0) return null;
            var name = ((RibbonIndex)a.AffixedRibbon).ToString();
            return "Ribbon" + name;
        }
        catch { return null; }
    }

    private static string SafeMoveType(ushort move, EntityContext ctx)
    {
        try { return TypeName(MoveInfo.GetType(move, ctx)); }
        catch { return ""; }
    }


    /// <summary>The form's name as Showdown/PKHeX spell it ("Hisui", "Alola", "Dusk"…), or null for the base form.</summary>
    public static string? FormName(PKM pk)
    {
        if (pk.Form == 0) return null;
        try { return ShowdownParsing.GetStringFromForm(pk.Form, S, pk.Species, pk.Context) is { Length: > 0 } n ? n : null; }
        catch { return null; }
    }

    private static string Str(IReadOnlyList<string> list, int i) => (uint)i < (uint)list.Count ? list[i] : "";
}

/// <summary>National Pokédex data (names and types) for the Pokédex screen.</summary>
public static class DexData
{
    public sealed record Entry(int N, string Name, string[] Types, int HeightCm);

    public static readonly IReadOnlyList<Entry> All = Build();

    /// <summary>Showdown's sprite name for a species, e.g. "Mr. Mime" → "mrmime", "Nidoran♀" → "nidoranf".</summary>
    /// <summary>Showdown's sprite name including the form, e.g. Hisuian Arcanine → "arcanine-hisui".</summary>
    public static string ShowdownId(int species, byte form, EntityContext context)
    {
        var id = ShowdownId(species);
        if (form == 0 || id.Length == 0) return id;
        try
        {
            var f = ShowdownParsing.GetStringFromForm(form, GameInfo.GetStrings("en"), (ushort)species, context);
            var suffix = new string((f ?? "").Where(char.IsAsciiLetterOrDigit).Select(char.ToLowerInvariant).ToArray());
            return suffix.Length > 0 ? $"{id}-{suffix}" : id;
        }
        catch { return id; }
    }

    public static string ShowdownId(int species)
    {
        if ((uint)(species - 1) >= (uint)All.Count) return "";
        var name = GameInfo.GetStrings("en").Species[species]
            .Replace("♀", "f").Replace("♂", "m").Normalize(System.Text.NormalizationForm.FormD);
        return new string(name.Where(char.IsAsciiLetterOrDigit).Select(char.ToLowerInvariant).ToArray());
    }

    /// <summary>Species height in metres (0 if unknown).</summary>
    public static double HeightM(int species) => (uint)(species - 1) < (uint)All.Count ? All[species - 1].HeightCm / 100.0 : 0;

    private static readonly IPersonalTable[] SizeTables = [PersonalTable.SV, PersonalTable.ZA, PersonalTable.SWSH, PersonalTable.LA, PersonalTable.BDSP, PersonalTable.USUM];

    /// <summary>Pokédex height (m) and weight (kg) of this exact form (Hisuian Arcanine is taller than Arcanine).</summary>
    public static (double HeightM, double WeightKg) Size(ushort species, byte form)
    {
        foreach (var t in SizeTables)
        {
            if (species > t.MaxSpeciesID) continue;
            var pi = t.GetFormEntry(species, form);
            if (pi is IPersonalMisc m && m.Height > 0 && m.Weight > 0 && pi.HP > 0)
                return (m.Height / 100.0, m.Weight / 10.0);
        }
        return (HeightM(species), 0);
    }

    private static List<Entry> Build()
    {
        IPersonalTable[] tables = [PersonalTable.SV, PersonalTable.ZA, PersonalTable.SWSH, PersonalTable.LA, PersonalTable.BDSP, PersonalTable.USUM];
        int max = tables.Max(t => (int)t.MaxSpeciesID);
        var list = new List<Entry>(max);
        for (ushort s = 1; s <= max; s++)
        {
            string[] types = [];
            int height = 0;
            foreach (var t in tables)
            {
                if (s > t.MaxSpeciesID) continue;
                var pi = t.GetFormEntry(s, 0);
                if (pi is null || (pi.Type1 == 0 && pi.Type2 == 0 && pi.HP == 0)) continue;
                types = pi.Type1 == pi.Type2
                    ? [MonDescriber.TypeName(pi.Type1)]
                    : [MonDescriber.TypeName(pi.Type1), MonDescriber.TypeName(pi.Type2)];
                height = pi is IPersonalMisc misc ? misc.Height : 0;
                break;
            }
            list.Add(new Entry(s, MonDescriber.SpeciesName(s), types, height));
        }
        return list;
    }
}
