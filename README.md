# Jims Roulette

A first-person browser adaptation built with TypeScript, Three.js, Vite, and a deterministic simulation layer shared by Story Mode and private online play.

## Desktop launcher

The Electron launcher runs the production web build from a loopback-only local server. It checks versioned GitHub Releases from `Ltaylor809/jims-roulette`, downloads compatible updates, and installs a downloaded update on restart.

```bash
pnpm install
pnpm electron:dev
```

Create an unpacked local app with `pnpm electron:pack`, or build the platform installer/update artifacts with `pnpm electron:dist`. Release builds use the version in `package.json`; bump it before publishing a new GitHub Release.

## Run locally

```bash
npm install
npm run dev
```

Solo works through the Vite development server. To test private two-player rooms, build and run the bundled WebSocket server:

```bash
npm run build
npm start
```

Then open `http://localhost:3000` in two browser windows.

## Controls

- Select the physical shotgun, then choose **Yourself** or **The Dealer**.
- Select physical equipment on your half of the table to use it without spending a shot.
- Hover over the shotgun or an item for its description.
- A blank fired at yourself keeps the turn.
- Shells are visible only during the load reveal. Remember the announced counts after they are hidden.

## Story Mode

- Round I starts with 2 charges and no items.
- Round II starts with 4 charges and distributes 2 items per load.
- Round III starts with 6 charges and distributes 4 items per load. The last two charges are cut away when the defibrillator fails.
- The local rules engine implements the complete eleven-item set. Story Mode uses the original five-item pool; the later items are available to the multiplayer ruleset.

## Project boundaries

- `src/game/simulation/` owns deterministic rules and dealer AI.
- `src/render/` owns Three.js scene composition and animation.
- `src/ui/` owns the minimal DOM interaction layer, accessibility controls, and menus.
- `server/` owns private-room matchmaking and WebSocket relay.
- `public/assets/ATTRIBUTIONS.md` records redistributable asset licenses.
- `LOCAL_ONLY_ASSETS.md` records owner-supplied reference assets that must not be published without permission.

## Public repository boundary

`public/assets/local-only/` is intentionally ignored by Git. A public clone contains the code and redistributable asset set, but the private reference audio/textures are not bundled. Do not attach a desktop build containing those files to a public GitHub Release unless you hold the necessary redistribution rights. The open asset ledger in `public/assets/ATTRIBUTIONS.md` is the starting point for a fully redistributable package.
