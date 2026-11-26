# PokeVault

**Your own offline Pokémon storage for Windows.** Keep every Pokémon from your game saves in one Vault, move them between your games, and enjoy them in the Meadow. No Switch, no account, no internet needed to run.

PokeVault reads and writes save files with [PKHeX.Core](https://github.com/kwsch/PKHeX), from Red/Blue up to Scarlet/Violet and Legends: Z-A.

## Download

1. Go to **[Releases](../../releases/latest)** and download **`PokeVault-Setup.exe`**.
2. Run it and click **Install**. It installs just for you (no administrator prompt) and adds PokeVault to the Start menu.
3. Open **PokeVault** from the Start menu.

Windows may show *"Windows protected your PC"* because the installer isn't code-signed. Click **More info → Run anyway**.

**Requirements:** Windows 10 or 11 (64-bit). Everything else is included. The Microsoft Edge WebView2 runtime ships with Windows 11 and up-to-date Windows 10.

**Uninstall:** Settings → Apps → PokeVault → Uninstall. Your Vault is kept.

## Features

- **All your games in one place.** Ryujinx saves are found automatically; add any other save file from your PC.
- **The Vault.** Every Pokémon you've caught, in boxes you name, sort and decorate. Pokémon are kept in their original format, like HOME.
- **Drag & drop** between any game and the Vault, with automatic conversion. A box glows green when a Pokémon can go into that game, or explains why not.
- **Live catch alerts.** Catch something in a game and PokeVault tells you, with a button to jump straight to it.
- **Check Summary.** Stats, IVs, EVs, moves, ribbons, marks, and each Pokémon's **journey** through the games.
- **Pokédex.** All 1025, with *where to catch it* in the games you have.
- **Organize.** Auto-sort, a one-click **Living Dex**, smart boxes (saved searches), a duplicate finder, and undo.
- **Shareable cards.** A card for any Pokémon and a retro **Trainer card**, saved as PNG or copied.
- **Save backups.** Every save is backed up before PokeVault changes it, and can be restored from the Games screen.
- **The Meadow.** Let a box of Pokémon out and walk among them. Day, evening and night; seasons and weather (live from your location if you like); berries and friendship; photo mode.
- **Send Pokémon back to older games.** PKHeX can't move a Pokémon to an older generation; PokeVault can (Gen 3 to 7). It writes its own older-format copy: same shininess, nature, gender, IVs, EVs, level and nickname, with the closest legal move standing in for any move that game doesn't have. The original waits in the Vault marked **Away**, and when the Pokémon comes back it gets everything back (moves, ability, ball, Tera type, ribbons) plus whatever it did in the older game: levels, evolutions, EVs, new moves and ribbons.
- **A journey that's true.** Every move PokeVault makes is recorded with the real game it went to, so a Pokémon's story names the actual games it visited and ends with where it is now.
- **Your party.** Each game's party sits next to its boxes, and party Pokémon move like any other (party, boxes and the Vault). Fold it away when you don't need it.
- **Play your games from PokeVault.** Press **Play** on the Games screen and the game starts in the emulator you already have: **Ryujinx** or **Sudachi** (Switch), **Citra**, **Azahar** or **Lime3DS** (3DS), **melonDS** (DS) and **mGBA** (GBA and Game Boy). Set each game up once on the **Emulators** screen: its emulator, its game file, and the save it plays (PokeVault can switch an uploaded copy over to the emulator's real save).
- **Pause and refresh.** While a game is open, PokeVault pauses and leaves that save alone. When you close the game, your boxes, party, Vault and Pokédex refresh by themselves.
- **Themes and wallpapers**, and **full controller support** on every screen.

## Where your data lives

Your Vault is in **`C:\Users\<you>\PokeVault`**. Back this folder up: it *is* your Vault. Installing, updating and uninstalling never touch it.

| Inside it | What it is |
|---|---|
| `mons\` | One file per Pokémon in the Vault |
| `vault.json` | Boxes, names, wallpapers and the Pokédex |
| `backups\` | A copy of each save made before every change (`original_…` is the save before the first change) |
| `journey.json`, `meadow-bond.json`, `smart-boxes.json` | Journeys, Meadow friendship and saved searches |

**Close a game before moving Pokémon in or out of its save.** While its emulator is open, that save is copy-only (PokeVault shows a pause screen and refreshes when you close the game).

## Build it yourself

You need the [.NET 10 SDK](https://dotnet.microsoft.com/download) on Windows.

```powershell
dotnet run                                                    # run from source (uses .\data as the Vault)
powershell -ExecutionPolicy Bypass -File build-installer.ps1  # makes dist\PokeVault-Setup.exe
```

The installer is a small .NET Framework 4.8 program (`installer\`) with the self-contained app packed inside. It also supports a silent install: `PokeVault-Setup.exe /S [/D=folder] [/portable]`.

## Credits

- **Emulator icons** belong to their projects (Ryujinx, Sudachi, Citra, Azahar, Lime3DS, melonDS, mGBA) and are shown only to identify them. PokeVault doesn't include or download any emulator or game.
- **[PKHeX.Core](https://github.com/kwsch/PKHeX)** by Kaphotics and contributors (GPL-3.0): reading and writing saves, and converting Pokémon between generations.
- **Pokémon sprites and renders:** [PokeAPI sprites](https://github.com/PokeAPI/sprites), the [Pokémon Showdown](https://play.pokemonshowdown.com/sprites/) sprite archive, and the [PMD Sprite Collab](https://github.com/PMDCollab/SpriteCollab) (CC BY-NC 4.0) for the Meadow. They're downloaded once and cached.
- **Ribbon and mark pictures** from PKHeX's resources. **Game box art** from the [Bulbagarden Archives](https://archives.bulbagarden.net). **Berry pictures** from PokeAPI.
- **Weather** from [Open-Meteo](https://open-meteo.com) (only if you turn on live weather).
- **Microsoft Edge WebView2** for the app window.
- Music and interface sounds are original, synthesised in the app.

## License and disclaimer

PokeVault is free software under the **GNU General Public License v3.0** (see [LICENSE](LICENSE)), as required by PKHeX.Core.

PokeVault is a free, fan-made, non-commercial project. It is not affiliated with or endorsed by Nintendo, Game Freak, Creatures or The Pokémon Company. Pokémon and all related names, characters and images are trademarks and © of Nintendo, Creatures Inc. and GAME FREAK inc. Use it with saves from games you own, and keep backups.
