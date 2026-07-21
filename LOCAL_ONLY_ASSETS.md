# Local-only supplied assets

The files under `public/assets/local-only/` were selectively extracted from the user-supplied `Jims buckshot.zip` and `buckshot-decomp-public-main.zip` archives for this private local build. Only the specific textures, interface audio, ambience, font, and sound effects currently used by the browser version were copied; the full archives were not vendored.

The archives identify themselves as decompilations of the commercial game Buckshot Roulette and do not grant redistribution rights. These files must be removed or replaced before any public GitHub push, hosting, or distribution unless the owner has the necessary permission:

- `public/assets/local-only/audio/`
- `public/assets/local-only/fonts/`
- `public/assets/local-only/textures/`
- `public/assets/local-only/original/audio/`
- `public/assets/local-only/original/textures/`

`public/assets/local-only/audio/club/Bass Killer.mp3` was supplied separately by the user for the nightclub sequence. It is always the first club track in this private build. No redistribution license is asserted for it, so it must also remain local-only unless the owner confirms public distribution rights.

The supplied decompilation contains imported textures and engine metadata but not a usable set of the original environment, Dealer, shotgun, or item meshes. Those shapes are therefore reconstructed in Three.js or sourced from the redistributable models listed in `public/assets/ATTRIBUTIONS.md`.

The remaining asset set has a separate license ledger at `public/assets/ATTRIBUTIONS.md` and provides a clean replacement path for a future distributable build.
