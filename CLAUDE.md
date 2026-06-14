# CLAUDE.md

Guidance for working in this repository.

## What this is

An Elgato Stream Deck plugin (Stream Deck SDK v2, TypeScript + Node) that shows
live solar **production** and household **consumption** in watts, read directly
from a local Enphase **IQ Gateway / Envoy** over the LAN. There is no cloud
(Enlighten v4) integration and no auth — data comes from the gateway's
**unauthenticated** `/production.json` endpoint over plain HTTP (pre-v7 firmware).

## Toolchain

Node is installed via **nvm** and is **not on the default PATH**. Prefix commands:

```bash
export PATH="$HOME/.nvm/versions/node/v24.15.0/bin:$PATH"
```

(or `nvm use` if your shell has nvm loaded). Node 24 builds fine; the *installed*
plugin runs under Stream Deck's bundled Node 20 (`Nodejs.Version` in the manifest).

## Commands

| Command | What it does |
| --- | --- |
| `npm install` | Install deps |
| `npm run build` | Rollup-bundle `src/plugin.ts` → `tphan.enphase.sdPlugin/bin/plugin.js` |
| `npm run watch` | Rebuild on change + `streamdeck restart` |
| `npm run lint` | `tsc --noEmit` type-check (no test suite yet) |
| `npm run gen:icons` | Regenerate placeholder PNG icons |
| `npx streamdeck validate tphan.enphase.sdPlugin` | Validate the manifest/structure — run after manifest edits |
| `npx streamdeck link tphan.enphase.sdPlugin` | Symlink the plugin into Stream Deck for local testing |

## Layout

```
src/
  plugin.ts                     entry: registers actions, connects to Stream Deck
  render.ts                     barsImage()/errorImage() — SVG → setImage data URIs
  actions/
    polling-action.ts           PollingAction base — one shared timer, fans poll to all keys
    overview.ts                  @action tphan.enphase.overview (both bars on one key)
  enphase/
    client.ts                   HTTP fetch of /production.json + shared cache
    types.ts                    settings + gateway response/reading types
    format.ts                   formatWatts() ("850 W" / "1.23 kW")
tphan.enphase.sdPlugin/ the plugin package (the UUID is the folder name)
  manifest.json                 actions, icons, Node version, SDK version
  ui/inspector.html             property inspector (sdpi-components)
  imgs/                         icons (solar-panel PNGs from scripts/gen-icons.mjs)
  bin/                          build output (gitignored)
scripts/gen-icons.mjs           renders MDI solar-panel glyph → PNGs via @resvg/resvg-js
```

## Architecture notes

- **Polling:** `PollingAction` runs **one shared `setInterval`** (period = the
  shortest `refreshSeconds` among visible keys) and **one** `poll()` per cycle that
  fetches once and fans the result out to every key. Poll/error state is global
  (all keys read the same gateway), so failures are logged once — not per key.
  `poll()` guards against overlap (`this.polling`) and renders via `renderKey()`,
  which paints only when the image actually changed (skips redundant `setImage`).
- **Rendering:** keys are drawn, not titled. `renderKey()` calls the subclass
  `draw(readings, settings)` and pushes the result with `action.setImage()` (SVG
  data URI); the manifest `States[].Image` is only the static action-list icon. The
  title is cleared on appear. The single `Overview` action draws two stacked bars
  via `barsImage()` (`src/render.ts`), which takes a `BarRow[]`
  (label/watts/color/maxWatts — each row has its own full-scale).
- **Adding an action:** subclass `PollingAction` (`src/actions/polling-action.ts`),
  implement `draw(readings, settings): string` (return a data URI, e.g. from
  `barsImage()`), decorate with `@action({ UUID })`, and register it in
  `src/plugin.ts`. Also add a matching entry to `manifest.json` (`Actions[]`) with
  the same UUID and an `imgs/actions/<name>/` icon set.
- **Shared cache:** `getReadings()` in `client.ts` caches for `CACHE_TTL_MS` and
  de-duplicates concurrent calls. The shared poll already collapses to one fetch
  per cycle; the cache additionally absorbs appear/settings/key-press bursts. Pass
  `force = true` (key press) to bypass the cache.
- **Gateway access:** plain HTTP on port 80 to the **unauthenticated**
  `/production.json` (via `node:http`, no `fetch`/undici, no extra deps, no token).
  This endpoint is only open on pre-v7 firmware; v7+ gateways return 401/403,
  surfaced as a setup error. Adding token/HTTPS support for v7+ would mean
  switching back to `node:https` with `rejectUnauthorized: false` + a Bearer JWT.
- **Settings:** `host` is **global** (shared across all keys, written by the
  property inspector's `global` attribute); `refreshSeconds`, `productionMax`, and
  `consumptionMax` (each bar's full-scale) are per-action. There is no token
  setting. The legacy `maxWatts` is kept as a fallback scale for both bars.
- **Reading selection:** production prefers the `eim` production CT meter, falling
  back to inverter totals; consumption uses the `total-consumption` meter.

## Conventions / gotchas

- **Tabs**, not spaces (matches the Elgato template); double quotes in TS.
- Settings types passed to SDK generics **must be `type` aliases, not
  `interface`** — interfaces lack the implicit index signature the SDK's
  `JsonObject` constraint requires (see `types.ts`). This is a real compile error
  if you switch them back.
- The plugin UUID is `tphan.enphase` and **must match** the `.sdPlugin`
  folder name and the manifest `UUID` field. Action UUIDs must match between the
  `@action` decorator and `manifest.json`.
- `manifest.json` `FontSize` must be a **number**, not a string (validator fails
  otherwise). Run `streamdeck validate` after editing the manifest.
- `bin/` ships an emitted `package.json` (`{"type":"module"}`) — the
  `emit-module-package-file` rollup plugin writes it so the installed folder loads
  as ESM. Don't remove it.
- Icons in `imgs/` are generated from the MDI solar-panel glyph by
  `npm run gen:icons` (edit `PANEL_PATH`/`COLOR` in `scripts/gen-icons.mjs` to change them).
- A harmless Rollup warning ("`sourcemap` option must be set") appears on plain
  `build`; source maps are only emitted in `watch` mode.

## Verifying changes

1. `npm run lint && npm run build` — must be clean.
2. `npx streamdeck validate tphan.enphase.sdPlugin` — must pass.
3. For runtime behavior: `npx streamdeck link …` + `restart`, add a key in Stream
   Deck, enter the gateway host, and confirm the watt value renders. Logs are
   written under `tphan.enphase.sdPlugin/logs/`.
