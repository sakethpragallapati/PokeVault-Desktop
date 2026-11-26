using PKHeX.Core;

namespace PokeVault.Core;

public sealed record SlotRef(int Box, int Slot);
public sealed record Skipped(string Name, string Reason);
public sealed record TransferResult(MonInfo[] Done, Skipped[] Skipped, int? Box, Trip[]? Trips = null);
/// <summary>A Pokémon that went to an older game (with the moves that changed) or came back from one.</summary>
public sealed record Trip(string Name, string Game, bool Back, MoveSwap[] Swaps);

/// <summary>Moves Pokémon between game saves and the vault. Every operation runs one at a time.</summary>
public sealed class TransferService(GameService games, VaultService vault, JourneyService journey, MoveDataService moveData)
{
    public static readonly object Gate = new();

    private static readonly EntityImportSettings Import =
        new(EntityImportOption.Enable, EntityImportOption.Enable, EntityImportOption.Disable);

    /// <summary>
    /// Game → vault. With <paramref name="copy"/> the Pokémon also stays in the game (the save isn't changed at all);
    /// otherwise it leaves the save, like depositing into HOME.
    /// </summary>
    public TransferResult Deposit(string gameId, IReadOnlyList<SlotRef> slots, bool copy, int? vaultBox, int? vaultSlot)
    {
        if (slots.Count == 0) throw new VaultException("Pick at least one Pokémon.");
        if (!copy) games.EnsureWritable(gameId);
        var g = games.Get(gameId);
        var sav = copy ? games.LoadForReading(gameId) : games.LoadForEditing(gameId);
        if (!copy && !GameService.CanMoveOut(sav))
            throw new VaultException($"{g.Game} saves can only be copied into the vault, not moved out.");

        var done = new List<(PKM Pk, VaultEntry Entry)>();
        var back = new List<(VaultEntry Entry, PKM Merged, string Uid, string Name)>();   // copies of Vault Pokémon coming home
        var skipped = new List<Skipped>();
        var source = $"{g.Game} · {sav.OT}";
        try
        {
            foreach (var r in slots.Distinct())
            {
                if (r.Box < 0 || r.Box >= sav.BoxCount || r.Slot < 0 || r.Slot >= sav.BoxSlotCount)
                { skipped.Add(new("?", "That box slot doesn't exist.")); continue; }
                var pk = sav.GetBoxSlotAtIndex(r.Box, r.Slot);
                var name = MonDescriber.SpeciesName(pk.Species);
                if (pk.Species == 0) { skipped.Add(new("Empty slot", "Nothing there.")); continue; }
                if (!pk.ChecksumValid) { skipped.Add(new(name, "Its data looks damaged (bad checksum).")); continue; }
                if (!copy && (sav.IsBoxSlotLocked(r.Box, r.Slot) || sav.IsBoxSlotOverwriteProtected(r.Box, r.Slot)))
                { skipped.Add(new(name, "The game has locked that slot.")); continue; }

                // a copy PokeVault sent here from the Vault: the original takes its progress back
                var uid = CatchWatcher.Identity(pk);
                if (vault.All.FirstOrDefault(e => e.Away?.CopyUid == uid) is { } home)
                {
                    var orig = vault.Read(home);
                    back.Add((home, DownConverter.MergeBack(orig, pk, home.Away!), CatchWatcher.Identity(orig), name));
                    if (!copy) sav.SetBoxSlotAtIndex(sav.BlankPKM, r.Box, r.Slot, EntityImportSettings.None);
                    continue;
                }

                var (vb, vs) = slots.Count == 1 && vaultBox is int b && vaultSlot is int s
                    ? (b, s)
                    : vault.FirstEmpty(vaultBox ?? 0);
                if (vault.At(vb, vs) is { Away: { } held } waiting)
                    throw new VaultException($"That slot is kept for {vault.Info(waiting)?.SpeciesName ?? "a Pokémon"}, who's away in {held.Game}. " +
                        "Only that Pokémon can go there. Pick an empty slot for this one.");
                var entry = vault.Add(pk.Clone(), vb, vs, source);
                done.Add((pk, entry));
                if (!copy) sav.SetBoxSlotAtIndex(sav.BlankPKM, r.Box, r.Slot, EntityImportSettings.None);
            }
            // Vault files are written first, so a Pokémon always exists somewhere even if the save write fails.
            if (!copy && (done.Count > 0 || back.Count > 0)) games.Write(gameId, sav);
        }
        catch
        {
            foreach (var (_, e) in done) vault.Discard(e);
            throw;
        }
        foreach (var (e, merged, _, _) in back)
        {
            vault.Replace(e, merged);
            if (!copy) e.Away = null;   // home again; a copy-only deposit just brings the progress over
        }
        vault.Persist();
        journey.AddMany(done.Select(d => (CatchWatcher.Identity(d.Pk), "vault",
            copy ? $"Copied into the Vault from {g.Game}" : $"Entered the Vault from {g.Game}", (string?)g.Game, (int)sav.Generation)));
        if (!copy)
            journey.AddMany(back.Select(x => (x.Uid, "vault", $"Entered the Vault from {g.Game}", (string?)g.Game, (int)sav.Generation)));
        var infos = done.Select(d => vault.Info(d.Entry)!).Concat(back.Select(x => vault.Info(x.Entry)!)).ToArray();
        return new(infos, skipped.ToArray(),
            done.Count > 0 ? done[0].Entry.Box : back.Count > 0 ? back[0].Entry.Box : null,
            back.Select(x => new Trip(x.Name, g.Game, true, [])).ToArray());
    }

    /// <summary>Vault → game. Converts the format when needed (e.g. a Sword/Shield Pokémon going into Scarlet).</summary>
    public TransferResult Withdraw(string gameId, IReadOnlyList<string> ids, int? box, int? slot)
    {
        if (ids.Count == 0) throw new VaultException("Pick at least one Pokémon.");
        games.EnsureWritable(gameId);
        var g = games.Get(gameId);
        var sav = games.LoadForEditing(gameId);
        if (!GameService.CanMoveOut(sav))
            throw new VaultException($"PokeVault can't put Pokémon into {g.Game} saves. Use PKHeX for those.");

        var done = new List<(VaultEntry Entry, MonInfo Info, string Uid)>();
        var trips = new List<(VaultEntry Entry, AwayTrip Trip, string Name, MoveSwap[] Swaps)>();
        var skipped = new List<Skipped>();
        int searchBox = box ?? 0;
        var moves = moveData.Cached();

        foreach (var id in ids.Distinct())
        {
            var entry = vault.Find(id);
            if (entry is null) continue;
            var original = vault.Read(entry);
            var name = original.IsEgg ? "Egg" : MonDescriber.SpeciesName(original.Species);
            if (entry.Away is { } away) { skipped.Add(new(name, $"It's away in {away.Game}. Bring it back to the Vault first.")); continue; }

            PKM pk;
            List<MoveSwap>? swaps = null;
            List<ushort[]>? pairs = null;
            if (DownConverter.IsDown(original, sav))
            {
                // an older game: PokeVault writes its own copy there and keeps the original here
                if (!DownConverter.CanConvert(original, sav, out var whyNot)) { skipped.Add(new(name, whyNot)); continue; }
                try { (pk, swaps, pairs) = DownConverter.Convert(original, sav, moves); }
                catch (Exception ex) { skipped.Add(new(name, $"It couldn't be converted for {g.Game} ({ex.Message}).")); continue; }
            }
            else if (!TryConvert(original, sav, out pk, out var why)) { skipped.Add(new(name, why)); continue; }

            int tb, ts;
            if (ids.Count == 1 && box is int b && slot is int s)
            {
                if (b < 0 || b >= sav.BoxCount || s < 0 || s >= sav.BoxSlotCount)
                    throw new VaultException("That box slot doesn't exist in this save.");
                if (sav.GetBoxSlotAtIndex(b, s).Species != 0 || sav.IsBoxSlotLocked(b, s) || sav.IsBoxSlotOverwriteProtected(b, s))
                    throw new VaultException("That box slot in the game is taken. Pick an empty one.");
                (tb, ts) = (b, s);
            }
            else if (FirstEmpty(sav, searchBox) is (int fb, int fs))
            {
                (tb, ts) = (fb, fs);
                searchBox = fb;
            }
            else { skipped.Add(new(name, "Every box in the game is full.")); continue; }

            sav.SetBoxSlotAtIndex(pk, tb, ts, Import);
            var placed = sav.GetBoxSlotAtIndex(tb, ts);
            done.Add((entry, MonDescriber.Describe(placed, tb, ts), CatchWatcher.Identity(original)));
            if (pairs is not null)
                trips.Add((entry, new AwayTrip
                {
                    GameId = gameId, Game = g.Game, Gen = sav.Generation, CopyUid = CatchWatcher.Identity(placed),
                    SentSpecies = placed.Species, Moves = pairs, SentNickname = placed.Nickname, SentItem = placed.HeldItem, Time = DateTime.Now,
                }, name, swaps!.ToArray()));
        }

        if (done.Count > 0)
        {
            games.Write(gameId, sav);
            foreach (var (e, _, _) in done)
            {
                var t = trips.FirstOrDefault(x => x.Entry == e);
                if (t.Trip is not null) { e.Away = t.Trip; vault.Touch(e); }   // the original stays, locked
                else vault.Remove(e);
            }
            vault.Persist();
            journey.AddMany(done.Select(d => (d.Uid, "game", $"Arrived in {g.Game}", (string?)g.Game, (int)sav.Generation)));
        }
        return new(done.Select(d => d.Info).ToArray(), skipped.ToArray(), done.Count > 0 ? done[0].Info.Box : null,
            trips.Select(t => new Trip(t.Name, g.Game, false, t.Swaps)).ToArray());
    }

    /// <summary>Moves a Pokémon to another box slot inside the same save; an occupied target swaps.</summary>
    public void MoveInGame(string gameId, int fromBox, int fromSlot, int toBox, int toSlot)
    {
        if (fromBox == toBox && fromSlot == toSlot) return;
        games.EnsureWritable(gameId);
        var g = games.Get(gameId);
        var sav = games.LoadForEditing(gameId);
        if (!GameService.CanMoveOut(sav))
            throw new VaultException($"PokeVault can't rearrange {g.Game} boxes. Do it in the game.");
        foreach (var (b, s) in new[] { (fromBox, fromSlot), (toBox, toSlot) })
        {
            if (b < 0 || b >= sav.BoxCount || s < 0 || s >= sav.BoxSlotCount)
                throw new VaultException("That box slot doesn't exist in this save.");
            if (sav.IsBoxSlotLocked(b, s) || sav.IsBoxSlotOverwriteProtected(b, s))
                throw new VaultException("The game has locked that slot, so it can't be changed.");
        }
        var moving = sav.GetBoxSlotAtIndex(fromBox, fromSlot);
        if (moving.Species == 0) throw new VaultException("There's no Pokémon in that slot any more.");
        var other = sav.GetBoxSlotAtIndex(toBox, toSlot);
        sav.SetBoxSlotAtIndex(moving, toBox, toSlot, EntityImportSettings.None);
        sav.SetBoxSlotAtIndex(other.Species == 0 ? sav.BlankPKM : other, fromBox, fromSlot, EntityImportSettings.None);
        games.Write(gameId, sav);
    }

    /// <summary>Whether a vault Pokémon can go into this save, and if not, why (for the compatibility glow).</summary>
    public static bool CanGoInto(PKM pk, SaveFile sav, out string why) =>
        DownConverter.IsDown(pk, sav) ? DownConverter.CanConvert(pk, sav, out why) : TryConvert(pk, sav, out _, out why);

    private static bool TryConvert(PKM pk, SaveFile sav, out PKM result, out string why)
    {
        result = pk;
        why = "";
        // Like HOME: Pokémon never go back to an older generation (Gen 1 ⇄ Gen 2 is fine, the games' Time
        // Capsule does that). Checked first because PKHeX's converter can get stuck forever on some
        // backwards conversions (e.g. a Gen 9 Pokémon into Gen 3), which froze the whole app.
        int from = pk.Format, to = sav.Generation;
        if (pk.GetType() != sav.PKMType && from > to && to < 8 && !(from <= 2 && to <= 2))
        {
            why = $"Pokémon can't go back from Gen {from} to Gen {to} ({GameService.GameName(sav)}).";
            return false;
        }
        if (pk.GetType() != sav.PKMType)
        {
            var converted = EntityConverter.ConvertToType(pk, sav.PKMType, out var r);
            if (converted is null || r != EntityConverterResult.Success)
            {
                why = r switch
                {
                    EntityConverterResult.IncompatibleSpecies => $"It doesn't exist in {GameService.GameName(sav)}.",
                    EntityConverterResult.IncompatibleForm => $"That form can't go into {GameService.GameName(sav)}.",
                    _ => $"A {pk.Extension} Pokémon can't be moved into {GameService.GameName(sav)} (no transfer route).",
                };
                return false;
            }
            result = converted;
        }
        if (result.Species > sav.MaxSpeciesID || !sav.Personal.IsPresentInGame(result.Species, result.Form))
        {
            why = $"It doesn't exist in {GameService.GameName(sav)}.";
            return false;
        }
        return true;
    }

    private static (int, int)? FirstEmpty(SaveFile sav, int preferBox)
    {
        for (int i = 0; i < sav.BoxCount; i++)
        {
            int b = (preferBox + i) % sav.BoxCount;
            for (int s = 0; s < sav.BoxSlotCount; s++)
                if (sav.GetBoxSlotAtIndex(b, s).Species == 0 && !sav.IsBoxSlotLocked(b, s) && !sav.IsBoxSlotOverwriteProtected(b, s))
                    return (b, s);
        }
        return null;
    }
}
