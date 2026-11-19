# VALLEYWARD

A first-person horde survivor at a hilltop keep, with a real-time fluid fire. It runs in the browser on three.js r186,
in a WebGL2 and a WebGPU edition. Hold the gate of Valleyward Keep through ten nights against thousands of pixel
goblins, the Ash Troll and the Rainmother, with gun and fire.

> Formerly EMBERWATCH (renamed 2026-11-18; another game already uses that name). Some asset provenance records still
> use the old name.

**The design:** `docs/DESIGN.md`. Every text, line and hint in the game follows `docs/STORY.md`.

## The game

- **The loop.** A first launch goes straight into Night I. Every dawn and every fall leads to the **camp** at dusk:
  - Brother Cinder's stall sells permanent upgrades and charms;
  - six build pads take towers (the Hellfire Obelisk, the Chain Imp);
  - E at the lamp's pan on the wall walk, or BEGIN NIGHT (N / Enter), starts the next night.

  A fall ends the run: towers and cards reset, and the next run starts at Night I. Gold, upgrades and charms are kept
  in the save (`localStorage` key `valleyward.save.v1`).
- **Growth.** Skill cards unlock once, then upgrade. Towers go to 5 levels and weapon lines to 10. The THUNDER ORGAN
  minigun (slot 2) costs 4,500 gold, which is reachable around Nights V–VI. Up to 10,000 goblins can be alive on
  quality high.
- **Ten nights:**
  - I and II, with Bat Gremlins and the Ash Troll (and its Ash Roar);
  - III THE RAM (Siege Rams), IV WET WIND (rain squalls), V THE SHIELD WALL, VI THE SWARM;
  - VII THE COVEN (the lamp locked), VIII RAM AND ROAR, IX THE LAST WATCH;
  - X THE RAINMOTHER, the final boss.
- **The ending** (≈ 56 s) runs to "Directed by AL" and THE WAY IS OPEN.
- **Jumping ahead:** `?night=1..10`, `?save=late|endgame`, `?ending=1` and `__ew.goto('night<n>'|'ending')`.

## The fire is a module (decision `docs/decisions/0001-fire-modules-and-two-editions.md`)

The fire lives in **fire modules** from **[Firewraith](https://github.com/lethehaiau/firewraith)**, installed as the
`firewraith` package (`v0.2.0`). It holds the Fire API, the kit, the reference modules (`classic`, the game's original
fire, and its WebGPU port `classic-webgpu`) and the module catalog: every module Firewraith lists is playable here with
no change to the game. To write one, see Firewraith's
[CONTRIBUTING.md](https://github.com/lethehaiau/firewraith/blob/main/CONTRIBUTING.md). To cite Firewraith, use the DOI of the version
used here, v0.2.0: [10.5281/zenodo.24364837](https://doi.org/10.5281/zenodo.24364837) (all versions:
[10.5281/zenodo.24362891](https://doi.org/10.5281/zenodo.24362891); see its `CITATION.cff`).

- **The fire host** (`src/fire/`) picks a module for each **slot**:
  - `lance`: the Ember Lance's flame;
  - `ground`: the fire on the ground.

  `?lance=` and `?ground=` choose them, and `?firemod=` sets both. Each takes a listed id (`classic`) or, for
  development, a module URL on this machine (`http://localhost:…`).
- **A module that is missing, invalid or throws** is replaced by `classic` for its slots.
- **A `ground` module may decide what burns,** through its gameplay grid. Without one, the deterministic CPU fire grid
  (`src/sim/fireproxy.js`) decides.
- **Two shading layers.** The game has `src/gfx/webgl2` and `src/gfx/webgpu`, and boots the one that matches the
  picked modules' backend. `?gpu=webgl2|webgpu` forces one.
- **The WebGPU edition is complete** (`docs/WEBGPU-PORT.md`). It runs three's `WebGPURenderer` with the world, the look,
  the actors, the fx and Firewraith's `classic-webgpu` fire, which is its default and fallback module. Its frame time
  isn't measured yet. If something looks off, compare it with the WebGL2 edition.

## Run

```bash
npm ci                 # once (Node 24; three.js, Firewraith from GitHub, Vite, and puppeteer-core + sharp for the tools)
npm install --no-save ../firewraith   # optional: run on a local Firewraith checkout instead (see its CONTRIBUTING.md)
npm run dev            # http://127.0.0.1:5350/
npm run build          # → dist/ (relative base)
npm run preview        # http://127.0.0.1:5351/  (serves dist/)
npm test               # node --test: the sim, the bot over whole nights and campaigns, cards, the fire proxy, the run loop, the ten nights and the ending, static contracts (~6–10 min)
npm run e2e            # headless e2e on a production build, under tools/gpu-lock.sh (port 5358)
node tools/qa/campaign.mjs --policy noisy --seeds 1-3 --wall 1,3,5 --out c.jsonl   # DESIGN §16 campaigns (CPU-heavy: ≤ 4 at once); --aggregate c.jsonl prints the tables
npm run perf           # the performance check (DESIGN §15) at 1920×1080, both fire styles, vsync + uncapped, under tools/gpu-lock.sh (port 5359)
npm run shots          # m1 / m2 / top / troll captures, greybox and full, both fire styles, frame mean luma (port 5358)
npm run sbs -- --prefix r2_   # side-by-side sheets: each mockup next to the game's capture (after shots)
npm run soak           # N self-play nights in the browser at speed 4 (port 5359; long: ~1.5 min a night)
npm run nights -- --seeds=1-10 [--nofire] [--noisy]   # self-play nights in Node with the CPU fire proxy (--noisy: the human reference, 250 ms lag + aim noise)
node tools/qa/balance.mjs --policy bot,noisy,nofire,nogun --seeds 1-10 [--save mid] [--max 900]   # balance table: wins, fire's share of kills, level-ups, lowest HP
node tools/qa/simcost.mjs --n 2500,5000,10000,20000   # the sim's cost per enemy (ms per tick per 1,000 alive, Node)
npm run perf -- --alive 10000 --styles hybrid          # the cost in Chrome with N alive (CPU ms per part in __ew.perf().lanes)
```

The browser tools drive the installed Google Chrome through puppeteer-core (`tools/platform.mjs` says which Chrome, GL
flags and ffmpeg; `CHROME_BIN`, `CHROME_GL_ARGS` and `FFMPEG_BIN` override). `tools/gpu-lock.sh` lets one of them run
at a time. Scratch output (builds, shots, reports) goes to `.scratch/` (gitignored).

**Ports** (all on 127.0.0.1, `strictPort`): 5350 dev, 5351 preview, 5358 e2e and shots, 5359 perf and soak. The
benches in `preview/` use 5353 fire, 5354 environment, 5355 actors, 5356 HUD and cinematics, 5357 audio; each
file's header gives its command.

## Controls (DESIGN §3.2)

| Input | Action |
|---|---|
| W A S D | move (6 m/s), Shift sprint (9 m/s), Space jump |
| Mouse | look (click for pointer lock; click-drag where the lock is refused; a two-finger touchpad swipe turns) |
| Left click | fire (hold for the Ember Lance and for auto-fire) |
| Right click / G | throw a firebomb |
| 1 / 2 / 3, wheel | Kestrel / Blunderbuss (a card unlocks it) or the THUNDER ORGAN once bought / Ember Lance |
| N / Enter (camp) | begin the night (same as E at the lamp's pan) |
| R | reload |
| E | kindle the beacon (at the pan on the wall walk, by the south-east tower); at the camp: talk to Brother Cinder, open a build pad, or kindle the lamp to begin the night |
| Q | Sunburst (when charged by kills) |
| 1 / 2 / 3 or click | pick a level-up card |
| P / Esc | the menu (Resume, Restart night, Fire style, Controls) |
| H | controls |

The loading cover turns into "CLICK TO BEGIN" (the gesture unlocks audio). The intro (6 s) can be skipped after 1.5 s with Space, Enter, E or a click.

## URL parameters (DESIGN §14.8)

`seed=<n>` · `autoplay=1` (the self-play bot; with `noisy=1`, the human-reference bot: 250 ms lag + aim noise) · `skipintro=1` · `noui=1` · `quality=high|medium|low` ·
`look=greybox` (all art off: the sim's truth) · `fire=smooth|hybrid` (default hybrid) · `view=m1|m2|top|troll` (fixed capture
cameras; m1/m2 are first-person key-art poses) · `debug=1` (overlay + the fire provider's grid drawn on the ground) ·
`perf=1` · `gpuPerf=1` (GPU timers) · `fps=<0..240>` (the frame cap, default 60; 0 = every display frame) · `god=1` (player and gate cannot fall) · `speed=<0.1..8>` · `clock=<s>` · `troll=1` · `mute=1` ·
`fov=<deg>` · `fireproxy=1` (keep the CPU proxy as the sim's fire) · `warmskip=lens,fire`.
`save=fresh|mid|rich|late|endgame` (replace the save at boot: `fresh` a first launch; `mid` between Night I and II with
Hide 2, Lance 2, an Obelisk, a Chain Imp and 2 charms; `rich` 99,999 gold and the THUNDER ORGAN; `late` mid-high upgrades
at Night III; `endgame` ready for Night X) · `camp=1` (start at the camp) · `night=1..10` (start that night of the run in
the save) · `ending=1` (play the ending) · `cap=<n>` (the horde's alive cap, for measurements; caps by quality are 10,000 / 6,000 / 3,000).
Decision 0001: `gpu=webgl2|webgpu` (the edition; default: the picked fire modules' backend, else webgl2) ·
`lance=<id|url>` · `ground=<id|url>` · `firemod=<id|url>` (both slots) — a listed fire module (`classic`) or a module URL
on this machine. With `debug=1`, `__ew.fireCompare()` reports how well the ground module's gameplay grid and the CPU fire
grid (fed the same ops) agree (means, correlation, burning cells).

## Hooks (`window.__ew`)

`state()`, `drainEvents()`, `setInput(obj|null)` (a sim input: `{ fwd, right, sprint, jump, yaw, pitch, fire, bomb,
weapon, wheel, reload, kindle, ult, card }`), `step(n)`, `pause()`, `resume()`, `god(on)`, `skipIntro()`,
`teleport(x, z, yaw, pitch)` (z ≤ 0.2 within the wall's span puts you on the wall walk), `bot(on)`, `view(name)`, `pose({ x, z, yaw, pitch, lift, lean, walk })` (a first-person framing),
`spawn(kind, n, x?, z?)`, `troll()`, `setClock(s)`, `fireOp(op)`, `fireStyle(s?)`, `perf()`, `resetPerf()`,
`assetsReady()`, `busy`, `modules()` (which parts loaded or fell back, and why), `hero`, `paused`, `card(choice)`,
`lights()`, `edition()` (which edition runs and why), plus `sim`, `scene`, `camera`, `renderer`, `bootMs`, `warmMs`. `perf().fire` = the fire host's stats; `perf().fire.modules` = which module fills each slot and why a slot fell back. `save()` (write and return the
save), `resetSave()`, `setGold(n)`, `goto('camp'|'night1'|'night2')`, `command({ act: 'buy', item } | { act: 'equip',
charm, on } | { act: 'build', pad, type } | { act: 'upgrade', pad } | { act: 'open', panel, pad } | { act: 'close' } |
{ act: 'kindle' } | { act: 'continue' })` (applied at the next sim tick).

## Layout

| Path | What |
|---|---|
| `src/main.js` | boot (picks the edition), the fixed-step loop (60 Hz, ≤ 8 steps/frame, hit-stop), loading the parts and the render order |
| `src/gfx/` | the shading layers: `webgl2/` (WebGLRenderer, GLSL) and `webgpu/` (WebGPURenderer, TSL); `index.js` picks the edition |
| `src/fire/` | the fire host: the module registry, per-slot loading and fallback, the world handed to modules, the light map and the gameplay grid |
| `src/core/` | params, input, the module loader with fallbacks, shake + hit-stop, adaptive resolution, frame metrics, overlay, the fallback HUD |
| `src/sim/` | the deterministic sim (pure JS, Node-tested): player, horde (typed arrays, flow field, spatial hash), weapons, troll, cards, the CPU fire proxy |
| `src/bot/` | the self-play policy (drives tests, e2e, captures) |
| `src/view/` | the greybox renderer, the first-person camera rig and fixed views, viewmodel motion, the fallback cinema |
| `src/env/`, `src/look/`, `src/actors/`, `src/fx/`, `src/cinema/`, `src/ui/`, `src/audio/` | the parts `src/core/modules.js` loads (with a fallback each): the world, the post look, the sprite actors and viewmodel, combat FX, cutscenes, the HUD and menus, audio |
| `src/shared/` | contracts every part reads: the arena layout, events, the meta (shop, save), the fire light, the timeline of the intro, troll, dawn, fallen and retry beats |
| `tests/`, `tools/qa/` | Node tests; headless e2e, perf, shots, nights, balance and campaign runs |

## Docs

| File | What |
|---|---|
| `docs/DESIGN.md` | the design: the game, its rules and numbers, architecture, budgets and balance targets |
| `docs/STORY.md` | the story, the hidden truth and the rules for hints |
| `docs/ART-DIRECTION.md`, `docs/mockups/` | the look: palette, colour rules, light, materials, sprites, UI |
| `docs/CORE.md` | the core: the sim, the player, the horde, bosses, the meta, balance and performance |
| `docs/ENV.md` | the place and the render path: the keep, terrain, sky, weather, the grade |
| `docs/ACTORS.md` | the sprite actors, the atlas and the viewmodel |
| `docs/PRES.md` | the HUD and menus, combat FX, cutscenes |
| `docs/AUDIO.md` | the audio engine, music states and the sound list |
| `docs/FLUID.md` | where the fire went (Firewraith) |
| `docs/WEBGPU-PORT.md` | how the WebGPU edition mirrors the WebGL2 one |
| `docs/decisions/` | decision records |

## Asset sources

`public/assets/` holds the images, textures, fonts and data the game loads, with a `provenance.json` beside each set that
records every shipped file's tool, prompt and inputs. `assets-src/` holds the prompts, job files and build scripts that
made them. The raw generations (`assets-src/**/raw/`: images, audio takes and their API receipts) stay local and are
gitignored, so a clone ships the built assets but cannot rebuild them without generating again. The generation clients
(a wrapper for the Codex CLI's image generation and an ElevenLabs client) are not part of this repo either; the prompts
and job files are, so any generator can be pointed at them.

**The audio is not in this repository.** The sound effects, music and voice were generated with ElevenLabs under the
authors' licence, so they stay private. A clone builds and plays the game **silent**; nothing is requested and nothing
breaks. With an audio set in `.private/audio/` (or the folder in `VALLEYWARD_AUDIO_DIR`), `npm run dev` serves it and
`npm run build` copies it into `dist/assets/audio/` (`tools/vite-audio.mjs`). To make your own set, see `docs/AUDIO.md`:
the prompts and the build are here.

## Licence

- **Code and technical documentation:** [MIT](LICENSE).
- **Original game art and narrative content** (sprites, textures, UI art, key art, the story and the game's lines):
  [CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/).
- **Fonts:** SIL Open Font License 1.1.

[ASSET-LICENSES.md](ASSET-LICENSES.md) lists which files each licence covers, how to credit the art, the reserved project
branding and the third-party notices. Production builds include these notices (`LICENSE`, `ASSET-LICENSES.md`,
`licenses/`). The audio is not in this repository.
