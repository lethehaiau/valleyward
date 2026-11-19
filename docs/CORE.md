# CORE · VALLEYWARD (the gameplay core)

The core decides what happens in the game; the other parts only show it. It is:

- **the sim:** a deterministic 60 Hz simulation in pure JS (no three.js, no DOM), the same in Node and in the browser;
- **the self-play bot**, which plays the sim like a player and drives the tests, the balance tools and the captures;
- **`src/main.js`:** boot, the frame loop, the wiring of the eight presentation parts with a fallback for each, and the
  `window.__ew` hooks;
- **input and the first-person camera:** pointer lock, the camera rig and fixed views, shake, hit-stop and the
  viewmodel's motion;
- **the greybox view**, which draws the sim's truth plainly and stands in for any part that is missing;
- **the save and the meta:** camp, upgrades, charms and towers;
- **the Node tests and the tools in `tools/qa/`:** balance, campaigns, soaks, performance and end-to-end runs.

The design itself (the world, the weapons, the enemies, the nights, the story) is in `docs/DESIGN.md`, with
`docs/STORY.md` for every line of text. This file does not repeat it. It says how
the core works, where its numbers live, how balance and performance were measured, and why the code is the way it is.
Where this file and the code disagree, the code wins.

## Files

| Path | What |
|---|---|
| `src/main.js` | Boot, the fixed-step loop, the parts and their fallbacks, the render order, `window.__ew` |
| `src/sim/sim.js` | `createSim`: the modes and the night flow, pickups, oil, the camp commands, the save writes, `sanitizeInput`, `hashState` |
| `src/sim/constants.js` | Most of the sim's numbers (see "Where the numbers live") |
| `src/sim/player.js` | The Lamplighter's body: walk, sprint, jump, the stair and the wall walk, colliders, the fall guard |
| `src/sim/horde.js` | The horde in typed arrays: spawning, flow, separation, the gate mound, burning, gate damage, kills and drops |
| `src/sim/world.js` | Static data built once from the arena: the flow field, the spatial hash, colliders, a ground-height table |
| `src/sim/weapons.js` | The Kestrel (id `pistol`), Blunderbuss, Ember Lance, THUNDER ORGAN, firebombs, Sunburst, barrels, spears; hitscan |
| `src/sim/troll.js`, `boss.js`, `ram.js`, `air.js`, `twists.js` | The Ash Troll, the Rainmother, Siege Rams, Bat Gremlins, rain / phalanxes / the coven |
| `src/sim/towers.js`, `skills.js`, `cards.js` | Camp towers, the skills that act every tick, the level-up card pool and the run's multipliers (`mods`) |
| `src/sim/run.js` | The roguelite layer: save validation, presets, the loadout at nightfall, the shop, Brother Cinder's lines, `bossPower` |
| `src/sim/fireproxy.js` | The CPU fire grid: a deterministic 64 × 64 fire, fuel and heat grid fed by the same fire events as the GPU fire |
| `src/sim/rng.js` | The seeded RNG (mulberry32); the sim never uses `Math.random` |
| `src/bot/bot.js` | The self-play policy, the human-reference noise, the camp shopping plan |
| `src/core/` | URL parameters (`params.js`), input, the part loader (`modules.js`), the save's browser storage (`save.js`), shake and hit-stop, resolution (pixel budget, governor, frame cap), frame metrics, the overlay, the fallback HUD |
| `src/view/` | The camera rig and fixed views, viewmodel motion and the box viewmodel, the greybox renderer, the fallback intro |
| `src/shared/` | The contracts every part reads: `arena.js` (layout, terrain height), `events.js`, `timeline.js`, `meta.js` (the catalogue and the save format), `fireops.js`, `firelight.js` |
| `src/fire/` | The fire host, which runs the fire modules (see `docs/FLUID.md` and "The fire" below) |
| `tests/` | Node tests (`npm test`) |
| `tools/qa/` | Node: `balance`, `campaign`, `nights`, `simcost`. Headless Chrome: `e2e`, `perf`, `shots`, `sbs`, `soak` |

The presentation parts have their own docs: `docs/ENV.md` (the world and the look), `docs/ACTORS.md` (sprites and the
viewmodel), `docs/PRES.md` (HUD, menus, FX, cutscenes), `docs/AUDIO.md`, and `docs/WEBGPU-PORT.md` for the two editions.

## How it fits together

### Boot (`src/main.js`)

1. **The edition.** `pickEdition` (`src/gfx/index.js`) chooses WebGL2 or WebGPU: `?gpu=` wins, then the backend of the
   picked fire modules, else WebGL2. Without WebGPU in the browser it falls back to WebGL2 and says why
   (`__ew.edition()`). Decision record: `docs/decisions/0001-fire-modules-and-two-editions.md`.
2. **The renderer**, sized by the quality's pixel budget (see "The frame loop"), and the camera: FOV 78 as three.js'
   vertical `camera.fov`, near 0.05, far 900.
3. **The sim**, with the seed, god mode, quality, the browser storage, a save preset from `?save=` and the horde cap.
   Then the bot, the greybox, the camera rig, input, shake and the viewmodel motion.
4. **The parts.** `prefetchLanes()` requests every part's chunk at once. Then `env`, `look`, `fire`, `actors`, `ui` and
   `audio` are created in parallel, then `fx`, then `cinema` (they take the others as arguments). Each is a dynamic
   import inside try/catch (`loadLane` in `src/core/modules.js`, via `import.meta.glob`, so a missing folder is never a
   build error).
5. **The warm-up**, behind the loading cover: compile every program, call each part's `warm()`, draw from four far-apart
   lenses, light a little fire and douse it, then **reset the fire modules** (a gameplay grid read back late from the
   warm-up fire once reached the sim and lit an oil barrel). Then four frames to let the GPU drain.

   **The loading bar** (`index.html`'s `#loading .ld-bar`, driven by `setProgress` in `src/main.js`) follows these steps:
   LOADING (the edition chunk) to 12 %, LOADING THE VALLEY (each of the six parts as it arrives) to 60 %, GATHERING THE
   HORDE (fx, cinema) to 72 %, LIGHTING THE LAMPS (the shader compile) to 86 %, KINDLING THE FIRE (each part's `warm()`,
   the lenses, the fire) to 97 %, then 100 % and the title. Between steps it creeps toward the next one, so a long
   compile never looks frozen; it only moves forward. It is in the page itself (no JavaScript needed to show it) and
   cool cyan-white, not fire-orange (ART-DIRECTION §3). The cover's text uses its own `font-display: swap` alias of
   Silkscreen, preloaded by `index.html`, so the wordmark never vanishes while the HUD fonts load.
6. **The start.** The cover becomes "CLICK TO BEGIN" (the AudioContext and the pointer lock need a gesture). A first
   launch (an empty save) goes straight into Night I's intro; a save with anything in it starts at the camp. URL
   parameters can skip this: `?camp=1`, `?ending=1`, `?night=N`, `?skipintro=1`, `?autoplay=1`.

### Fallbacks

Every call into a part goes through `safe()`: if it throws, the part is marked failed for the rest of the session and
its fallback takes over. `__ew.modules()` reports each part's state (`loaded`, `fallback`, `failed`) and the reason.

| Part | Stand-in when it is missing or throws |
|---|---|
| `env` | the greybox world |
| `look` | the plain render path: the scene, then the viewmodel over a cleared depth buffer |
| `fire` | the CPU fire grid is the gameplay fire, and the greybox draws it on the ground |
| `actors` | greybox actors (one instanced draw of coloured quads) and a box viewmodel |
| `fx` | nothing |
| `cinema` | `src/view/fallback-cinema.js`: the intro glide only |
| `ui` | `src/core/fallback-ui.js`: the HUD, cards, end cards and the menu, but no camp panels |
| `audio` | silence |

`?look=greybox` turns every art part off to show the sim's truth.

### The frame loop

Each display frame, `frame()` in `main.js`:

1. **Frame cap.** It draws only when the cap's accumulator says so: 60 fps by default (`?fps=N`; `?fps=0` draws every
   display frame), 30 fps behind a modal (level-up cards, a camp panel, the menu, the end cards). A skipped display
   frame draws nothing; the fixed-step sim catches up on the next drawn one.
2. **Input.** Presses are latched until a sim step consumes them, so a click shorter than a frame, or one in a frame
   with no step (hit-stop, a fast display), is never lost.
3. **Fixed steps.** Game time = real time × `?speed` × the sim's `timeScale` (the fall's slow motion). It runs at most 8
   steps of 1/60 s a frame; hit-stop holds the steps. Each step takes the bot's input, a tool's override (`__ew.setInput`)
   or the player's, steps the sim, queues its fire events for the fire host, and steps the CPU fire grid beside a module.
4. **Events.** `sim.drainEvents()`; each event goes to shake, hit-stop, the viewmodel motion, then `env`, `actors`, `fx`,
   `ui`, `audio` and `cinema` (`onEvent(ev, state)`), and to the core's own reactions (cutscenes, the level-up cards,
   the end cards, the camp's panels).
5. **The fire.** This frame's events go to the fire host with the wind; it advances by the frame's game time and rain;
   the provider of gameplay heat is swapped by age (see "The fire"); the Lance's state goes to the `lance` module with
   its origin at the actors' muzzle socket.
6. **Presentation.** `env`, `actors`, `fx` and the greybox update; the camera is a fixed view, else the cinema while it
   owns the lens, else first person with shake; audio gets the listener; the viewmodel moves; the UI updates.
7. **Render.** `look.render()` (it runs the fire pass and draws the viewmodel), or the plain render without the look.
8. **Resolution governor** (in play and at the camp, not paused, not behind a modal), then the overlay and the metrics.

### The sim (`src/sim/`)

```js
const sim = createSim({ seed, quality, god, cap, spawnScale, storage, save });
sim.step(input);                 // one 1/60 s tick
const events = sim.drainEvents();
sim.state                        // read-only for everyone else
```

- **Deterministic.** A fixed `DT = 1/60`, every random number from the seeded RNG, no wall clock. A night's seed is
  `seed + attempt × 7919` (`attempt` grows on every retry, camp visit and jump), so one seed replays a whole campaign
  to the same `sim.hash()`. The tests check this through a night, through the camp loop and through the boss fight.
- **Modes:** `title` → `intro` (6 s; from the camp a 4 s camp-leave intro) → `play` ⇄ `cards` (a level-up pauses the
  sim) → `victory` (dawn) → `camp` → `intro` → … A fall: `play` → `fallen` → `camp` with a new run at Night I. Night X:
  `play` → `ending` → its card → `camp` with a new run. The menu's "Restart night" is `retry()`.
- **One state object per night.** `fresh(n, mode)` builds a new `state` for each night and for the camp before it, so
  **never cache `sim.state`**: read it each frame.
- **Per tick in `play`:** wind, the player, weapons, the trolls (from the night's queue), elites, the horde (and its
  gate damage), towers, skills, Bat Gremlins, rams, twists, the Rainmother, hexes and water throws in flight, oil
  troughs and barrels, pickups, the XP batches, the beacon, the night clock and waves, dawn, level-ups.
- **The horde** lives in typed arrays sized to the quality's cap (10,000 / 6,000 / 3,000). A slot is a stable id: a dead
  slot (state 0) goes on a free list and is reused. Iterate `i < horde.count` and skip state 0; `horde.alive` is the live
  count. Goblins follow a flow field toward the gate (1 m cells, the road cheaper), turn on the player within 6 m, and
  push apart through a spatial hash. Far goblins step every other tick (see "Enemy cost").
- **Commands** (camp purchases, panels, "continue" after a card, skipping the ending) come from the UI through
  `sim.command(c)`, from tools, or from the bot as `input.cmds`; all are applied at the start of the next tick.
- **The save** goes through a storage adapter `{ load, save, clear }`: `localStorage` under `valleyward.save.v1` in the
  browser (every access in try/catch; in memory when storage is blocked), `memoryStorage()` in Node. `normalizeSave`
  (`run.js`) validates every field against `meta.js` and drops unknown ids. Besides gold, upgrades, charms and the Organ,
  the save holds the run in progress between nights (`run`: night, towers, cards, level, XP) and Brother Cinder's line
  rotation (`npc`).
- **The loadout** is rebuilt from scratch at every nightfall (`applyLoadout`): a fresh player and fresh multipliers from
  the upgrades and the equipped charms, then every card taken this run replayed (instant cards skipped), level and XP
  carried. Full HP, tank and firebombs at the start of every night.
- **Presets** for tools (`?save=` or `createSim({ save })`): `fresh` (a first launch), `mid` (between Nights I and II:
  Hide 2, Lance 2, an Obelisk and a Chain Imp, two charms, a typical Night I card set, level 11), `rich` (99,999 gold,
  the Organ owned), `late` (Nights III–IX: mid-high upgrades, level 14) and `endgame` (Night X ready, level 22).

### The fire

The sim does not draw fire; it asks for it and reads it back.

- **Fire events out.** Each tick fills `state.fireOps` with plain objects (`stream`, `burst`, `fuel`, `ember`, `douse`,
  `push`, …; defined by Firewraith's Fire API and re-exported by `src/shared/fireops.js`). Events made outside a tick
  (`__ew.fireOp`, the douse at the camp or a retry, the troughs filling at nightfall) join the next tick's list, so the
  fire host gets everything. Burning goblins drop ember events at most once per 2 m cell per 0.3 s, and at most 160 a
  tick.
- **Heat in.** Gameplay reads a provider `{ heat(x, z), fuel(x, z) }` in 0..1. Goblins catch fire at heat ≥ 0.22
  (`BURN` in `fireops.js`); a trough lights when heat ≥ 0.3 at one of 6 points along it; a barrel lights at ≥ 0.5 and
  bursts after a 0.5 s fuse, setting off barrels within 4 m. The Lamplighter is immune to fire.
- **Two providers.** The **CPU fire grid** (`fireproxy.js`): 64 × 64 cells of 1 m over the fire area (`ARENA.fluid`,
  x −20..44, z −2..62) holding fuel, fire and heat, drifting with 0.8 × the wind, quenched by rain. The **gameplay grid**
  of the `ground` fire module, read back from the GPU. The sim owns the CPU grid and steps it itself while it is the
  provider; while a module's grid is the provider, `main.js` keeps the CPU grid fed and stepped beside it.
- **Swapping.** `main.js` hands the sim the module's grid once it is ready and at most 8 frames old, and falls back to
  the CPU grid when it is more than 30 frames old (an overloaded GPU) or missing (a visual-only module). `?fireproxy=1`
  keeps the CPU grid. `state.fireSource` says which one is live (`proxy` or `module`). In Node there is only the CPU grid.
- **Comparing them.** With `?debug=1`, `__ew.fireCompare()` returns both grids' mean heat, their correlation and the
  burning cells of each.

How fire modules are loaded and replaced: `docs/FLUID.md` and `src/fire/index.js`.

## Interfaces

### Sim input

One object per tick; the bot returns the same shape. `sanitizeInput` checks every field.

```js
{ fwd, right,                // −1..1
  sprint, jump, fire, firePress, bomb, reload, kindle, ult,   // booleans; edges count on the tick they arrive
  yaw, pitch,                // absolute, radians; null keeps the player's own
  weapon,                    // 1..3, 0 = no change
  wheel,                     // ±1
  card,                      // 1..3 in mode 'cards'
  cmds }                     // optional commands (the bot's camp shopping)
```

Yaw and pitch use the arena's convention: forward = (sin yaw, cos yaw); pitch up is positive.

### State

`state` is read-only for every other part. Besides the fields in `docs/DESIGN.md` §14.4, it has (among others):

- `player.where` (`ground` | `stair` | `walk`), `player.jet` (the Lance's nozzle, aim, touch-down and range),
  `player.unlocked`, `player.switchT` (0 → 1 after a weapon switch), `player.trigBuf` (a buffered click),
  `player.holdFireT` (the kindle glance holds the weapons), `player.inFire`, `player.organ`;
- `horde.target[i]` (0 gate, 1 player, 2 spear stand), `horde.pile[i]` (mound height), `horde.burned`, `horde.nearGate`;
- `night.kindleT` (the kindled window), `night.kindleLockT` (the coven's lock), `night.trollQueue`, `night.power`
  (an analytics number, see "Balance");
- `troll`, `boss`, `rams`, `air`, `weather.rain`, `ending` (`t`, `beat`, `skippable`);
- `stats` (kills, burned, `killedBy { fire, bullet, blast }`, `killedKind`, gold, level, cards, …);
- `camp` (`near`, `panel`, `padId`, `tip`), `meta` / `save` (the save), `run`, `towers` (with pad positions);
- `ring` (the Sunburst ring or null), `timeScale`, `fireSource`, `mods`.

### Events

The sim pushes `{ type, t, ...payload }` (`t` in sim seconds; an enemy's `id` is its horde slot); `main.js` drains them
once per drawn frame. The catalogue is `EV` in `src/shared/events.js`. Later systems emit plain string types: `ram.*`,
`boss.*`, `coven.*`, `phalanx.spawn`, `weather.squall`, `organ.*`, `ending.start`, `ending.beat`, `pad.open`,
`pad.close`, `shop.denied`. `coming.soon` is still in `EV` but no longer emitted (the coming-soon card went when Nights
III–X arrived).

Batching keeps the event rate bounded with thousands of goblins:

- `enemy.spawn`: one per kind per tick, with a `count`;
- `enemy.hit`, `enemy.ignite`, `enemy.death`: at most 64 per type per tick (`stats` still count every one);
- `enemy.attack`: at most 8 per tick;
- `gate.hit` from the horde: one every 0.1 s with the summed damage (the troll and the rams emit their own);
- `xp.gain`: one per tick with up to 8 positions; `pickup` for XP at most once per 0.15 s; `xp.drop` and `gold.drop`
  at most 12 a tick;
- the Organ: one `weapon.shot` per tick carrying that tick's rounds, and `organ.fire` / `organ.stop` around the firing
  loop.

### Timeline

`src/shared/timeline.js` holds the beat times the sim, the cutscenes and the audio share: the intro (6.0 s, skippable
after 1.5 s), the troll's arrival (3.2 s, an overlay; the sim keeps running), dawn (7.0 s, `victory` event at 6.5 s),
the fall (2.4 s; time × 0.35 for the first 0.6 s; the card at 1.4 s), retry (1.2 s), the kindle glance (1.0 s), the camp
(2.6 s fade, the player held for 1.6 s), the camp-leave intro (4.0 s) and the ending (56 s, 13 beats; the sim emits
`ending.beat` as each is crossed). Change a time there and every part moves with it.

### Hooks and URL parameters

The full lists are in `README.md` ("URL parameters", "Hooks"). Worth knowing beyond them:

- `?noisy=1` (with `?autoplay=1`: the human-reference bot), `?fps=N` (the frame cap; `0` = uncapped), `?cap=N` (the
  horde cap, for measurements), `?night=1..10`, `?ending=1`, `?gpuPerf=1` (GPU timer queries), `?fluidDebug=1` (the
  ground fire module itself on `window.__ewFluid`, for benches and perf tools).
- `__ew.perf()`: frame-time percentiles over the last 6,000 frames, draw calls, triangles, the pixel ratio, the live
  horde, the fire host's stats, and `lanes`: CPU ms per frame for `sim`, `events`, `env`, `actors`, `fx`, `audio`, `ui`
  and `render` (render submit), as moving averages.
- `__ew.step(n)` steps the sim by hand; `__ew.pause()` holds it (captures); `__ew.command(c)` and `__ew.goto(where)`
  drive the camp and jump between nights; `__ew.pose({...})` frames a first-person shot.
- `__ew.busy` is false only in play or at the camp with nothing modal and no cutscene: tools wait on it.

## Where the numbers live

| File | Numbers |
|---|---|
| `src/sim/constants.js` | `DT`; `PLAYER`; `WEAPON` (Kestrel, Blunderbuss, Lance, firebombs, Sunburst); `ENEMY` (7 kinds); `ELITE`; `SKILL`; `LOOT`; `SPEAR`; `HORDE`; `NIGHT` (the clock, the spawn curve, the kindle, Night I's mix); `NIGHT2_MIX`, `IMP_MIX`; `PICKUP`; `XP_K`, `XP_GROW`, `XP_NEXT`; `TROLL`; `TROUGH`; `BARREL`; `NIGHT_SCALE`; `LEVEL_HEAL` |
| `src/shared/meta.js` | `NIGHTS` (per night: spawn multiplier, troll times and HP, elites, twists, the Rainmother's HP), `UPGRADES` and their cost curve, `ORGAN`, `TOWERS`, `CHARMS`, `DROPS` |
| `src/shared/arena.js` | the layout: keep, gate (1,000 HP), stair, wall walk, troughs, barrels, braziers, spawn, the fire area, camp pads |
| `src/shared/timeline.js`, `src/shared/fireops.js` | beat times; `BURN`, `WIND`, `HUE_OF` |
| `src/sim/fireproxy.js` | `PROXY` (the CPU fire grid) |
| `src/sim/boss.js`, `ram.js`, `air.js`, `twists.js`, `run.js` | `BOSS`, `RAM`, `AIR`, `TWIST`, `POWER` |
| `src/sim/horde.js` (module constants) | separation step 0.12 m, LOD radii 34 / 26 m, burning gate damage ×0.5, mound clearing 3 + 3 m, ember cells 2 m / 0.3 s |
| `src/sim/weapons.js` | `TRIGGER_BUFFER` 0.25 s |
| `src/core/resolution.js`, `shake.js`, `src/main.js` | pixel budgets, governor thresholds; shake and hit-stop; `MODAL_FPS`, the provider-swap ages |
| `src/bot/bot.js` | `HUMAN_NOISE`, `SHOP_PLAN`, card and charm preferences |
| `src/core/params.js` | URL parameter defaults and ranges |

### The difficulty knobs (current values)

| Night | Spawns × | Bosses (HP each) | Night | Spawns × | Bosses (HP each) |
|---|---|---|---|---|---|
| I | 1.0 | 1 troll, 9,250 | VI | 1.75 | 2 trolls, 37,000 |
| II | 1.35 | 2 trolls, 10,000 | VII | 1.85 | 2 trolls, 46,000 |
| III | 1.45 | 1 troll, 30,000 | VIII | 2.0 | 2 trolls, 74,000 |
| IV | 1.55 | 2 trolls, 24,000 | IX | 2.2 | 3 trolls, 61,000 |
| V | 1.65 | 2 trolls, 30,000 | X | 2.3 | the Rainmother, 91,000 |

- **The goblins grow with the night** (`nightScale(n)`): per night after the first, HP +50 %, melee and gate damage
  +25 %, speed +3 %, and the fire damage they take −7 % (floor ×0.5). Night X goblins have ×5.5 HP. It applies to every
  kind, the elites, the Bat Gremlins and the rams' crews.
- **The economy:** coin drop chances × `LOOT.goldMul` 0.5; the THUNDER ORGAN costs 4,500; `XP_NEXT(L)` = 100 × (L − 0.2)
  (60 at level 1), plus 12 % per level past level 12; each level-up heals 10 % of max HP (the only healing in a night,
  apart from the Hearthblood skill while standing in fire).
- **The gate:** 1,000 HP (+15 % per Gate upgrade); at most 20 attackers deal damage per tick; burning attackers deal
  half.

### Numbers set by measurement

These values came from measured runs, not from first principles; `docs/DESIGN.md` states the same values, and
`constants.js` and `meta.js` hold them.

- **Brutes take ×0.5 fire damage** (their door shield is wet), so the guns have a job. Tougher in fire, brutes at 6–8 %
  of Night I's mix made the gate fall in the browser, so they are 4 %; and since it still fell to a few burning brutes
  standing at it, they deal 6 gate damage a second.
- **Every kind deals ×0.5 gate damage while it burns** (`BURNING_GATE_MUL`), for the same reason.
- **At most 20 attackers count against the gate per tick** (`HORDE.gateAttackers`). Without a cap a
  2,000-goblin mound kills the gate in seconds whatever the player does; with 24 a browser soak still lost 3 of 4 nights.
- **Spear-chuckers share a budget of 1.6 spears a second**, aim with ±0.5 m error and lead a moving target by 0.85 × the
  flight time. Without a shared budget, 300 chuckers made a hail of 30 spears a second that hit a standing player 99 %
  of the time.
- **Dousers throw every 4.5 s** (3.5 s made ≈ 1,500 throws a Night II: a steam storm).
- **Boss HP per night** (the table above) was tuned against the human-reference bot. Lower values let every bot win every
  night.

## Balance

Decision 0001 makes the game a playground for fire modules as well, and says balance is not a concern there: a `ground`
module may decide what burns and change the game's difficulty. The numbers below were tuned with the CPU fire grid
and the `classic` fire.

### How it is measured

- **The bots.** The perfect bot (no lag, perfect aim) climbs to the wall walk, sweeps the Lance over the densest crowd,
  bombs the gate pile, shoots spear-chuckers and barrels, kindles the beacon and pours gunfire into a glowing troll.
  The **noisy bot is the human reference**: the same decisions, 250 ms late, with aim noise of σ 2.5° (yaw) and 1.7°
  (pitch) (`HUMAN_NOISE`). Variants: `useFire: false` (no Lance, bombs, Sunburst or barrels), `useGuns: false`,
  `sorties: false` (never leaves the wall). At the camp both bots shop the same way (`campChoice`).
- **Node, the CPU fire grid, seeds 1–10** unless stated. Node and the browser run the same sim: a browser night with
  `?fireproxy=1` gave Node's exact numbers. The GPU fire changes a night's course (which goblins burn when, and the
  random draws that follow), so browser results differ run to run.
- **`tools/qa/balance.mjs`** plays whole nights per policy and reports wins, the gate and HP left, the lowest HP,
  level-ups, kills, fire's share of kills (died burning, and by killing blow), gun kills and hurts by source.
  `--save S --night N` plays a night of a preset; `--max 900` gives slow nights time to end (a second troll alive past
  5:00 would otherwise count as a loss); `--trollHp`, `--bossHp`, `--spawnMul` probe one value without editing code.
- **`tools/qa/campaign.mjs`** plays real campaigns from a fresh save: consecutive nights, gold banked, shopping at the
  camp, a new run at Night I after every fall. `--wall 1,3,5,7` snapshots the save the first time Night N is cleared
  and plays on from it **without spending**. `--aggregate` prints the tables. One 30-night campaign takes ≈ 4–6 min of
  CPU; run at most 4 at once.
- **`tools/qa/nights.mjs`** (a Node soak) and **`tools/qa/soak.mjs`** (browser nights at speed 4 on a production build,
  flagging stuck nights) check that nights end.
- **The tests pin the current balance** (`npm test`): the perfect bot holds a fresh Night I on ≥ 8/10 seeds with 8–12
  level-ups; the noisy bot on 3–6/10; a bot without fire, or without guns, loses every night; with the `mid` save
  Night II is a wall (noisy ≤ 3/10, perfect ≥ 2/10); a perfect-bot campaign clears Night V within 25 nights; a noisy
  campaign falls at least twice in its first 15 nights and still clears Night III; a save that stops spending after
  Night I does not clear the next three nights; a noisy campaign buys the Organ around its first reach of Nights V–VI.

### Balance campaigns (latest results, 2026-11-14)

The rules (`docs/DESIGN.md §16`): the game must not be easy, goblins grow with the night, there is little healing, and
the boss cannot be tanked. In short: a fresh Night I held by an
average player 40–60 % of the time; without spending, a player rarely clears the next night and almost never the two
after it (the "wall"); about two attempts a night; a threat that rises monotonically; the perfect bot ahead of the
noisy one.

| Measure | Result | Target |
|---|---|---|
| Fresh Night I | noisy 3/10, perfect 10/10 | noisy 40–60 % (missed) |
| Night II, `mid` save | noisy 0/10, perfect 2/10 | a wall without upgrades |
| Wall after Night I (N+1 / N+2 / N+3 cleared without spending) | 20 / 0 / 0 % | ≤ 30 % (40 tolerated) / ≤ 10 % / ≈ 0 |
| Wall after Night III | 30 / 10 / 0 % | as above |
| Wall after Night V | 8 / 8 / 0 % | as above |
| Wall after Night VII | 17 / 0 / 0 % | as above |
| Attempts per night until the first clear (noisy, mean) | 1.78, no night above 2.75 | ≥ 2, none ≥ 3.5 (missed) |
| The Organ bought (noisy) | at the first reach of Night V (median), after 9–28 nights (median 22) | Nights V–VI |
| Nights to the first reach of Night X | noisy 55, 56, 71, 76 (all four beat it); perfect 24, 32, 38 | perfect faster |

Conditions: Node, the CPU fire grid, 4 workers; the walls after I and III come from 10 noisy campaigns with 3 runs per
snapshot, before the last change (the heavier bosses of Nights VIII–X), which does not touch Nights I–VII; the rest from
4 noisy and 3 perfect campaigns on the final numbers. The full 10 + 3 protocol was not re-run on the final numbers.

What the numbers mean:

- **The two targets fight under the restart rule.** A fall restarts the run at Night I. If a player needs two attempts
  at each new night, first reaching Night X costs about 1 + 2 + … + 9 replayed nights + 10 ≈ 55 nights. More falls and
  a short campaign cannot both be had; the wall was given priority, then the falls.
- **Campaigns are long now (55–76 nights to Night X, was 22–49)**, because Nights VIII–X are balanced for a player who
  owns the Organ.
- **The levers that were tried and reverted:** gold × 0.4, the level-cost growth from level 14 and Night V's trolls at
  34,000 each gave more falls (1.65 attempts a night) and 4/10 on a fresh Night I, but leaked on the wall (after III
  50 / 17 / 7 %, after V 47 / 13 / 0 %). A flat XP cost of 130 per level dropped a fresh Night I to noisy 2/10.

### How the current numbers were reached

- **Boss HP is fixed per night.** For a while boss HP scaled with the player's power at nightfall (`bossPower` in
  `run.js`: a weighted sum of the weapon lines, Hide, Firebombs, the run's cards and towers, normalised so the `late`
  preset is 1). It was replaced by goblins that grow with the night number, so a weak save is never let off easier. `bossPower` remains
  as an analytics number (`state.night.power`); `state.night.hpMul` is always 1.
- **The troll's HP is the lever that separates the two bots.** Guns decide how much of each glow window (fire heats the
  troll until it glows; it then takes ×3 gun damage) turns into damage, and the noisy bot's lag costs it there. At lower HP every bot held
  every night.
- **Gold ×0.3 → ×0.5:** at ×0.3 the noisy campaigns stalled at Nights VII–VIII for 80 nights; the wall is measured
  without spending, so more gold speeds progress without weakening it.
- **The level cost grows 12 % per level past level 12** (`XP_GROW`): a fresh Night I plays as before (about 12
  level-ups), and the run's cards snowball less across later nights.
- **The Organ's price, 4,500,** is the gold an average campaign has left at its first reach of Nights V–VI after the core
  upgrades and two or three runs' towers (median gold earned by then: 7,875 at Night V, 9,216 at Night VI). At 6,000,
  with saving right after Hide 2 / Lance 2, the noisy bot stalled at Night IV for 14–37 nights.
- **The Organ's damage grows with its own upgrade line only.** With Kestrel damage on it too, it cleared Nights VIII–X
  without another purchase and the wall after Nights V and VII collapsed (43 / 30 / 13 % and 70 / 43 / 43 %).
- **The Organ's overheat vents to 35 % heat during its 1.5 s lock.** Before, a held trigger re-overheated at once and
  the gun stalled. At purchase its sustained single-target DPS is 243, against 161 for the Blunderbuss and 156 for the
  Kestrel bought with the same gold; its pierce doubles that against a crowd.

### Older results that still explain the design

- **Fire kills most goblins.** On a fresh Night I (2026-11-13, before the later rebalances) fire dealt the killing blow
  to 92.5 % (perfect bot) and 97.8 % (noisy bot) of kills. Guns matter through the troll and the brutes: a bot that never
  pulls a trigger loses every night, because the troll dies only to guns while it glows. A 60–85 % fire share was the
  first goal; no lever moved the gun share above 5–8 % (the Kestrel cannot fire enough shots to kill 15 % of ≈ 5,000
  goblins), and that share was accepted. Not re-measured since.
- **The wall walk is the strong position.** The bot holds from the walk above the gate (melee cannot reach it; spears,
  boulders, hexes and bats can). A bot that holds the plaza instead fell to melee at 2:04–3:13 (Node, seeds 1–5).
- **The browser is harsher than Node with the GPU fire.** With brutes at 6 % of the mix, Node held Night I 10/10 and the
  browser soak 1/3; the gate fell to burning brutes standing at it. After the brute and burning changes above, the
  browser held Night I 4/4 (perfect bot) and 2/4 (noisy bot) (2026-11-14, before the DESIGN §16 changes; not re-run since).

## Performance

The budget (`docs/DESIGN.md` §15), on the reference machine (an Apple M4) at 1080p on quality `high`: 60 fps; a p95 frame
≤ 20 ms in the busiest moment; no stall over 50 ms after the first input; at most 300 draw calls and 1.5 M triangles;
a constant light count; every shader warmed before control is given.

### Frame times (latest, 2026-11-14)

Production build, headless Chrome (ANGLE/Metal) on an Apple M4 MacBook Air, quality `high`, the default 60 fps cap
under 60 Hz vsync, 10 s a run (the ending 50 s), load average 1.4–4.2. "n1" is Night I with 3,700–4,100 goblins and
fire; "troll" is Night I with the troll and ≈ 2,000 goblins; "n9" is Night IX; "organ" is a THUNDER ORGAN burst.

| Scene | Window | p50 / p95 / p99 / max (ms) | Frames > 17.5 ms | CPU ms: sim / actors / fx / ui / render | Draws | Triangles |
|---|---|---|---|---|---|---|
| n1 | 1920 × 1080 @1 | 16.7 / 16.7 / 16.8 / 16.8 | 0 | 1.4 / 0.3 / 0.2 / 0.2 / 0.7 | 108 | 540 k |
| n1 | 1512 × 860 @2 | 16.7 / 16.7 / 16.8 / 16.8 | 0 | 1.5 / 0.2 / 0.1 / 0.2 / 0.7 | 107 | 537 k |
| troll | 1920 × 1080 @1 | 16.7 / 16.8 / 16.8 / 16.8 | 0 | 0.9 / 0.1 / 0.1 / 0.3 / 0.7 | 104 | 534 k |
| n9 | 1920 × 1080 @1 | 16.7 / 16.8 / 16.8 / 16.8 | 0 | 0.5 / 0.1 / 0.1 / 0.3 / 0.6 | 103 | 542 k |
| organ | 1920 × 1080 @1 | 16.7 / 16.7 / 16.8 / 16.8 | 0 | 1.1 / 0.1 / 0.1 / 0.2 / 0.5 | 104 | 534 k |
| ending | 1920 × 1080 @1 | 16.7 / 16.7 / 16.8 / 16.8 | 0 | 0.2 / 0.0 / 0.0 / 0.2 / 0.8 | 78 | 506 k |

- **Uncapped** (`?fps=0`, Chrome's vsync off): p50 4.4–6.8 ms, so the GPU has more than 2× headroom at 60 fps. The
  resolution stays at 1.0.
- **A 1512 × 860 window at DPR 2** draws 1908 × 1085 (2.07 MP) instead of 2.93 MP, thanks to the pixel budget.
- **A 120 Hz display** (emulated: Chrome uncapped and each frame callback re-timed onto an 8.33 ms clock): 83–92 % of
  the drawn intervals were exactly 16.67 ms. The uneven rest lined up with slow GPU read-backs; after the fire module's
  later read-back fix those reads take ≤ 6 ms (the cadence was not re-counted). A real 120 Hz display was not measured.
- **Start:** 145 shader programs compile before control and none after (the intro, the first 20 s, the kindle, the
  troll, a level-up, both fire styles, the camp, the ending); the worst frame in the first 20 s is 16.8 ms.
- **Loading:** the title is interactive in 1.00 s at 40 Mbps / 40 ms, 1.45 s at 15 Mbps / 60 ms, and 4.22 s with a
  production-like 0.4 s per request; about 1.1 MB in 47 requests before the title; the whole game is 9.1 MB.
- **Memory:** a 10.2-minute session at 1080p (Night I → camp → Night II → the ending → Night I, four fire-style
  switches) showed no leak: JS heap after GC 53.0 → 56.9 MB, programs 145 throughout.
- **Uncapped, the GPU gameplay grid is never read back** (the GPU queue is too deep for a cheap read), so the sim runs
  on the CPU fire grid. With the cap this does not happen (read-back age 1 frame).
- **The WebGPU edition's frame time has not been measured yet.**

### Enemy cost

"How expensive is it to spawn more enemies?" About **0.2–0.3 ms of CPU per 1,000 goblins per tick** in the sim, plus
about 0.07–0.1 ms per 1,000 to draw them. The night's spawn curve keeps roughly 400–2,500 alive (more on later nights),
so the caps were the limit, not the cost: 10,000 / 6,000 / 3,000 alive on high / medium / low. 20,000 does not hold
60 fps.

The sim alone (`node tools/qa/simcost.mjs`, Node, the CPU fire grid, goblins spread over the plaza, road and slope,
≈ 70 % of them burning, Apple M4, 2026-11-13):

| Alive | ms per tick | ms per 1,000 alive |
|---|---|---|
| 2,500 | 0.69 | 0.29 |
| 5,000 | 1.09 | 0.23 |
| 10,000 | 1.79 | 0.19 |
| 20,000 | 3.29 | 0.18 |

In Chrome (`npm run perf -- --alive N --styles hybrid`: production build, headless, 1920 × 1080 at DPR 1, `high`, the
m2 pose with the Lance sweeping and a firebomb as often as possible; 2026-11-13, before the frame cap; CPU ms per frame
from `__ew.perf().lanes`):

| Alive | vsync p50 / p95 / p99 (ms) | uncapped p50 / p95 (ms) | sim | actors | fx | render submit |
|---|---|---|---|---|---|---|
| 2,500 | 16.7 / 16.8 / 16.8 | 9.4 / 22.4 | 1.53 | 0.21 | 0.12 | 1.28 |
| 5,000 | 16.7 / 16.7 / 16.8 | 10.3 / 21.6 | 2.23 | 0.37 | 0.17 | 0.94 |
| 10,000 | 16.7 / 16.7 / 16.8 | 13.3 / 31.3 | 3.85 | 0.68 | 0.25 | 0.93 |
| 20,000 | 16.7 / 33.3 / 50.0 | 15.2 / 33.3 | 7.70 | 2.08 | 0.55 | 1.04 |

- Draw calls do not grow with the crowd (110: all the goblin sprites are one instanced draw); triangles grow by ≈ 1 k
  per 1,000 goblins. At 20,000 only 10,000 are drawn (the actors' buffers hold the cap).
- In the browser the sim costs about twice what it costs in Node (3.85 vs 1.79 ms at 10,000), probably the heat
  lookups on the read-back grid and the page's other work (not split further).
- A whole night in Node with the perfect bot (2026-11-14, before the DESIGN §16 changes): Night IX from the `late` save
  0.128 ms a tick on average (p99 0.329); Night X 0.172 ms.

How the sim got there (a profile at 10,000 alive put the separation's neighbour walk and its closure at 33 % of a tick):

- goblins more than 34 m from the player and 26 m from the gate step every other tick with 2 × dt (by slot parity);
- the separation walks the hash's cells inline with a radius table, with no closure per goblin;
- the hash reuses its arrays: no allocation per tick;
- feet heights come from a 0.5 m ground-height table (≤ 3 cm off);
- a burning goblin samples the heat gradient every other tick.

That halved the cost per goblin (0.39 → 0.19 ms per 1,000 at 10,000).

### Stress scenes (`npm run perf`)

`tools/qa/perf.mjs` stages a busy moment and runs it per fire style, capped and uncapped. Latest stress results, all
inside the budget at vsync with no frame over 33 ms:

- Night II from the `mid` save with 4 towers, every skill, Dousers, Hexers, a Chieftain, Bat Gremlins and **6,000
  goblins** kept topped up (`--v2 --alive 6000`): p95 16.8 ms, 112 draws, 535 k triangles, 7 lights (2026-11-13).
- Night IX with the troll, a ram at the gate, rain and 2,000 goblins (`--scene night9`), and the ending
  (`--scene ending`): p95 16.7 ms, ≤ 114 draws, ≤ 553 k triangles (2026-11-14).

## Decisions

| Decision | Why |
|---|---|
| The sim is pure JS with a fixed step and a seeded RNG, and never imports three.js or touches the DOM (a test checks this) | The tests, the bot and the balance tools run the real game in Node, and a seed replays exactly |
| Commands are applied at the start of the next tick | A purchase or a "continue" happens at a tick boundary in Node and in the browser alike |
| Every input field is checked (`sanitizeInput`): a bad yaw or pitch keeps the player's own, `fwd` / `right` clamp to ±1, slots truncate | A NaN yaw from a tool once put the player's position to NaN for the rest of the night |
| `emit` writes the event's `type` after the payload; tower events use the key `tower`, not `type` | `{ type, ...payload }` once let `type: 'obelisk'` overwrite `'tower.build'` |
| The horde's slots are stable ids with a free list, never compacted | Events carry `id` = slot, and the actors key death animations on it |
| The sim owns the CPU fire grid and steps it only while it is the provider; `main.js` steps it beside a module | Node needs no glue, and the grid is always warm to take over from a stale or missing module grid |
| The CPU grid spreads fire along oil from burning neighbours, not by heat diffusion; its decay (fire 0.8/s, heat 0.75/s) was fitted to the GPU fire with `__ew.fireCompare()` | Diffusion drained a burning cell faster than it heated it, so troughs never caught; with the first decay rates the GPU fire burnt 1.6× the cells. Over a Night I in the browser (2026-11-13) the two grids' heat correlated at 0.39–0.93 |
| The camp is the next night's state in mode `camp`, with no spawns | One state object per night; the camp shows the run's towers and the loadout as the night will have them |
| The loadout is rebuilt from scratch at every nightfall | Upgrades bought at the camp apply at nightfall without counting twice |
| A fall banks the gold and writes `run: null` to the save at once; the towers stay drawn until the camp | Closing the tab on the fallen card cannot bring the run back; towers do not vanish mid slow motion |
| Several trolls a night arrive from a queue, and the next waits for the previous one's death; `state.troll` is always a single troll | Every part keeps a one-troll contract (the actors, the HUD, the audio, the cutscenes) |
| XP and gold are pickups that hop out, then fly to the player from anywhere after 0.6 s; a full pickup list credits the oldest; dawn and a fall credit everything | The wall walk is never starved, and nothing is ever lost |
| The magnet's reach is horizontal, with 7 m of vertical tolerance | Pickups at the foot of the wall reach a player on the walk |
| The ending is a sim mode with its own clock; its beats are events; a skip (only once the ending has been seen) fires every beat in between in one tick | One timeline for every part; a part keyed on a beat still sees it |
| Rain is one number (`state.weather.rain`) shared by the sim, the CPU grid and the fire module | They agree on how much the rain quenches |
| Bat Gremlins are plain objects in `state.air` (at most 12; 24 on the swarm night); a dive is a fixed 1.2 s path to where the player stood | Telegraphed, dodgeable by moving, and cheap |
| Pyre Burst queues its burst 0.12 s after the kill and spends a token bucket of 24 a second | Chain reactions without recursion inside a hash walk, and a bounded rate |
| Sim LOD for far goblins, an inlined hash walk, no per-tick allocations, a ground-height table | See "Enemy cost": it halved the cost per goblin |
| Separation is bounded: at most half the goblin's own step backwards, 0.12 m a tick in all; goblins on the same spot split | A stack of 20+ goblins funnelled onto one flow line kicked its members backwards and stood still for minutes |
| The gate mound: a cone whose height grows with the crowd pressing the gate within 7 m (up to 3.2 m). Only goblins attacking the gate count and climb, and it is flat within 3 m of a player on the ground (full height from 6 m) | Applied to every goblin near the gate, it lifted the crowd chasing the player into a tower of sprites in front of the lens (the spawn is 4.8 m from the gate) |
| Burning goblins drop at most one ember event per 2 m cell per 0.3 s | A dense gate pile set alight by Contagion swept itself away in seconds, and the mound never formed while fire was in use |
| The wall walk is safe from melee (goblins cannot use the stair) | The design's "retreat up the stair when swarmed"; spears, boulders, hexes and bats still reach it |
| Gun clicks are buffered 0.25 s in the sim, and `main.js` latches every press until a step consumes it | A click shorter than a frame, or in a frame with no step (hit-stop, a 120 Hz display), was lost |
| Hit-stop: 50 ms for a brute kill, 30 ms for a glowing-troll crit, 60 ms for a barrel, a stomp or a heavy hit on the player, 140 ms for the troll's death; at most one per 0.15 s | Impacts read without stutter at 4 shots a second |
| A 60 fps cap by default, with an accumulator; 30 fps behind a modal | Uncapped on a 120 Hz display the cadence was uneven and the GPU queue deep, which made the fire read-back slow; behind a panel the full rate only costs power |
| A pixel budget per quality: `high` at most 1920 × 1080 pixels (pixel ratio ≤ 1.5), `medium` 1600 × 900 (≤ 1.25), `low` 1280 × 720 (≤ 1); re-run on resize and on a pixel-ratio change alone (`watchDpr`) | A MacBook window at DPR 2 drew 2.93 MP on `high`; moving the window to another display or zooming fires no resize |
| The resolution governor ignores frames ≥ 0.1 s, judges each 2 s window on its median and its share of slow frames (against the cap: 18.5 / 22 ms at 60 fps), steps down 0.1 only after 2 bad windows, back up after 4 s of good ones, never below the larger of 0.6 and half the budget's pixel ratio; uncapped it holds full resolution. With the look it scales the look's render targets, not the canvas | GPU back-pressure stalls are not load: the first governor dropped to 0.6 on them and took 12 s per step to recover |
| Every part's chunk is requested at once, right after the edition is known | `fx` and `cinema` are created after the others, but their downloads no longer wait |
| Within 300 ms of a pointer lock, the first 3 mouse deltas are dropped if they are > 10 × the median of the recent ones (and > 40 px), or > 120 px while fewer than 5 are known (`lockOutlier`) | A known browser quirk can send one huge delta on lock and jump the view |
| FOV 78 is three.js' vertical `camera.fov` (`?fov=` tries others) | The design's number, taken literally |
| `?view=m1` and `m2` are first-person poses (the hands and the Lance in view); `top` and `troll` are fixed cameras | The key-art mockups show the hands and the Lance |
| `m2` stands at the wall walk's west end (x −12.4, z −1.5), leans 9 m out over the parapet, lifted 1 m, looking east (yaw 2.1) and 23° down: the gate centre-left, the beacon tower right of centre, the burning crowd across the lower middle | The mockup's composition, mirrored: in this arena the beacon stands at the walk's east end, so it is only in frame looking east. Chosen from 17 rendered candidates |
| In the climb (phase 3) the Rainmother leaves the road and strides up the slope at 3 m/s until she is 22 m from the gate, then climbs at 0.4 m/s | Before, a fast phase 3 left her far down the road or behind the SE tower, out of view from the walk. Night X was not re-run in the campaign tool after this change |
| god mode blocks all damage to the player and the gate, the hurt events, and the Rainmother's win at the gate | Captures and the e2e reach the ending, with no red hurt edge in the key-art views |
| The bot's "continue" after a dawn waits until 8.5 s into `victory` (3 s into `fallen`) | It raced the dawn card in the browser. In the browser the card holds the sim, so the card, a click or a tool goes on; in Node the bot does |
| Past its fixed shopping plan, the bot keeps buying the cheapest affordable level of a permanent line or a run tower | Once the plan was bought out, both bots' power plateaued and the gold piled up; that, not balance, made the perfect bot slower than the noisy one |
| The bot saves for the Organ only after the core upgrades (Hide 2, Lance 2, Kestrel 2, Gate 2, the Blunderbuss, a Firebomb, two towers at level 2) | Saving right after Hide 2 / Lance 2 stalled it at Night IV for 14–37 nights: the wall needs upgrades |

## Open issues

- **Balance targets missed** (see the campaign table): a fresh Night I is held 30 % of the time by the noisy bot
  (target 40–60 %), and campaigns average 1.78 attempts a night (target ≥ 2). Starting the level-cost growth at level 14
  would help Night I but softened the wall.
- **Long campaigns:** 55–76 nights to first reach Night X (4 noisy campaigns). The full 10 + 3 campaign protocol was not
  re-run on the final numbers.
- **Night X** was not re-run in the campaign tool after the Rainmother's climb was restaged.
- **Browser balance:** only Night I was soaked in the browser with the GPU fire, and that was before the DESIGN §16 changes.
  Nights II–X are covered in the browser by the e2e (with god mode) and the perf scenes, not by a balance soak.
- **Fire's share of kills and the danger of spears on the wall** were last measured before the later rebalances;
  unverified now. How much the Bat Gremlins hurt a human player is unmeasured: they hit a standing player often, moving
  dodges them, and both bots shoot diving bats first.
- **The sim costs about 2× more in the browser than in Node**; the read-back heat lookups are the likely share (not
  split).
- **Hitscan walks the whole horde:** `ray()` in `weapons.js` loops over every slot with no spatial hash. With 10,000
  alive the Organ's 20 rays a second cost about 200–300 k checks a second: small today, but the first thing to move to
  the hash if hitscan shows in a profile.
- **Without the UI part** the camp has no panels: it can only be left (E at the pan); the shop needs the UI or
  `__ew.command`. The greybox draws towers, the orbit, meteors, hexes, water and chain hooks as plain markers.
- **Not measured:** the WebGPU edition's frame time, a real 120 Hz display, a Retina display at its native pixel ratio
  (the pixel budget caps `high` to 1920 × 1080 pixels).
- **A WebGPU fire module given by URL needs `?gpu=webgpu`:** the edition is chosen before any module loads, and only a
  listed module's backend is known then. Without it the module fails its backend check and `classic` takes its slots.
- **Leftovers in the code:** `PLAYER.fireReach` is unused since the Lamplighter became immune to fire; `bossHpMul` and
  `balance.mjs --floor` belong to the retired boss-HP scaling; `EV.COMING_SOON` is never emitted.

## How to run, see, test and tune

### See it

- `npm run dev` → `http://127.0.0.1:5350/`. Useful URLs:
  - `?skipintro=1&autoplay=1&speed=4`: the bot plays a night at 4× speed; add `&noisy=1` for the human reference.
  - `?look=greybox`: the sim's truth, no art; `?debug=1`: the overlay and the gameplay fire grid on the ground;
    `?perf=1`: the frame-time overlay.
  - `?save=mid&night=2`, `?save=late&night=9&god=1`, `?save=endgame&night=10`, `?ending=1`, `?save=rich&camp=1`:
    straight to a night, the ending or the camp.
  - `?view=m1|m2|top|troll`: the fixed capture views.
- In the console: `__ew.modules()`, `__ew.perf()`, `__ew.state()`, `__ew.spawn('brute', 20)`, `__ew.troll()`,
  `__ew.setClock(200)`, `__ew.goto('night5')`, `__ew.command({ act: 'buy', item: 'hide' })`, `__ew.fireCompare()`
  (with `?debug=1`).

### Test it

- **`npm test`** (Node, about 6–10 minutes): the sim (determinism, the flow field, the player's bounds and the stair, the
  night flow, the Lance and the beacon, the troll, event caps), the bot and balance tests above, the cards, the CPU fire
  grid, the fire host's module picking and edition choice, the camp loop and the save, every night's twist, the boss and
  the ending, the night scaling and healing rules, the Organ, the frame cap, pixel budget, governor and mouse filter,
  and static contracts (every hook and URL parameter exists, the sim never imports three.js, the loader tolerates a
  missing part). One file: `node --test tests/organ.test.mjs`.
- **`npm run e2e`** (a production build in headless Chrome, port 5358, under `tools/gpu-lock.sh`): the title → intro →
  play route, a first-seconds input probe (move, fire, the Lance, a firebomb, the kindle, pause), the views, a
  self-play night to dawn and on to the camp, the camp (Cinder's panel, a purchase, pads and towers, a reload keeps the
  save, BEGIN NIGHT), Night II, the Organ, a bat dive, Pyre Burst, every night's twist, the Rainmother killed by the bot,
  every ending beat, and both editions with a fire-module fallback. It passes only with 0 console errors on every page.
  `--only entry,probe,views,night,v2,v3,v4,editions` runs some sections; `--seed`, `--speed`, `--no-build`.
  **`npm run e2e` takes the GPU lock itself**, so it needs no extra wrapper; a nested `tools/gpu-lock.sh` inside a held lock
  runs its command at once.
- **`npm run perf`** (port 5359): the stress scene per fire style, capped and uncapped; `--alive N`, `--v2`,
  `--scene night9|ending`, `--seconds`, `--styles`. **`npm run shots`** and **`npm run sbs`**: the key-art views, and
  sheets of each mockup beside the game's capture. **`npm run soak`**: browser nights at speed 4.
- The browser tools drive the installed Chrome through puppeteer-core (`tools/platform.mjs`), one at a time under
  `tools/gpu-lock.sh`, and write builds, shots and reports to the gitignored `.scratch/` folder.

### Tune it

1. Change a number in `src/sim/constants.js` or `src/shared/meta.js` (see "Where the numbers live").
2. Check one night: `node tools/qa/balance.mjs --policy bot,noisy --seeds 1-10 [--save mid --night 2] [--max 900]`, or
   probe without editing: `--trollHp 30000`, `--bossHp 80000`, `--spawnMul 1.6`.
3. Check the campaign: `node tools/qa/campaign.mjs --policy noisy --seeds 1-10 --max-nights 80 --wall 1,3,5,7
   --wall-seeds 1-3 --out c.jsonl`, the same with `--policy bot --seeds 1-3`, then
   `node tools/qa/campaign.mjs --aggregate c.jsonl`.
4. Check the browser: `npm run soak -- --seeds 1-4` (and `--extra noisy=1`).
5. Run `npm test`: the bot tests pin the balance and will say if a change moved it out of range.
