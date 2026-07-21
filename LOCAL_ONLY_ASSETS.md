# Owner-supplied assets

The files under `public/assets/local-only/` were selectively extracted from the user-supplied `Jims buckshot.zip` and `buckshot-decomp-public-main.zip` archives. Only the specific textures, interface audio, ambience, font, and sound effects currently used by the browser version were copied; the full archives were not vendored.

The project owner confirmed on 2026-07-21 that they own these supplied files and authorize their public distribution as part of Jims Roulette, including through Firebase Hosting and packaged game builds:

- `public/assets/local-only/audio/`
- `public/assets/local-only/fonts/`
- `public/assets/local-only/textures/`
- `public/assets/local-only/original/audio/`
- `public/assets/local-only/original/textures/`

`public/assets/local-only/audio/club/Bass Killer.mp3` was supplied separately by the owner for the nightclub sequence. It is always the first club track, and the owner's public-distribution authorization includes this file.

The supplied decompilation contains imported textures and engine metadata but not a usable set of the original environment, Dealer, shotgun, or item meshes. Those shapes are therefore reconstructed in Three.js or sourced from the redistributable models listed in `public/assets/ATTRIBUTIONS.md`.

The independently licensed asset set has a separate license ledger at `public/assets/ATTRIBUTIONS.md`.
