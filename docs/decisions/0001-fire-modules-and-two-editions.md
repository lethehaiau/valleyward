# 0001 · Fire modules (Firewraith) and two shading layers (WebGL2 + WebGPU)

Status: **accepted** (2026-11-18).

## Context

VALLEYWARD started as one game with its fire built in (`src/fluid/`, a 2D GPU grid fluid drawn as a ray-marched 2.5D
volume, plus the Ember Lance's particle jet). The goal now is wider:

- **The game is for fun and is also a playground** where people try their own fire / fluid simulations. Game balance
  is not a concern.
- What matters:
  - people want to join;
  - it is easy to experiment;
  - it is easy to test a fire in the real game locally;
  - it is easy to publish a fire to our hosted version so others can play with it.
- Both repos will be open-sourced. The [Valleyward licensing policy](../../ASSET-LICENSES.md) covers the game code and assets.

## Decisions

1. **Two repos.**
   - **`valleyward`** is the game, which we host.
   - **`firewraith`** holds:
     - the Fire API;
     - the shared helpers (the "kit");
     - the reference fire modules;
     - the docs for module authors.

   The game imports Firewraith. Community modules live in their authors' own repos.
2. **Shared vocabulary:**

   | Term | Meaning |
   |---|---|
   | **fire module** | One swappable implementation of the fire. Not called an "engine", which clashes with "game engine", and not an "algo". |
   | **slot** | A place where a fire module plugs in. API v1 has two: **`lance`** (the Ember Lance's airborne flame) and **`ground`** (the fire on the ground: fire, smoke, embers, steam, the light it casts). |
   | **method** | What a module does inside: a 2D or 3D grid, particles, SPH, anything. It is the author's free choice. |
   | **Fire API** | The versioned agreement between the game and a module. v1 is in `firewraith/docs/API.md`. |
   | **host** | The game side. It loads modules, feeds them every frame, and falls back when a module fails. |
   | **reference module** | Ours. **`classic`** is today's fire, moved out of the game, and can fill both slots. |
   | **gameplay fire** | What decides burning. |
   | **CPU fire grid** | The deterministic 64 × 64 grid in `src/sim/fireproxy.js`. |
   | **bench** | A page where a module runs without the game. |
   | **checks** | Automatic tests a module must pass to be listed. |

3. **A module may decide the gameplay fire.** Balance doesn't matter, so a `ground` module that provides a gameplay
   grid really burns goblins.
   - A module that provides no grid is visual only, and the CPU fire grid decides burning.
   - The CPU fire grid always runs beside the module. It is the fallback when the module's grid is missing or stale,
     which keeps the behaviour of today's `fluid` lane.
   - Damage from the Lance's airborne jet stays with the sim's ballistic arc.
4. **The game owns the hard plumbing.** The host takes care of:
   - loading modules;
   - recovering from errors (fall back to `classic` for that slot);
   - lighting the world (the module may supply a light map);
   - the CPU fire grid.

   Firewraith's kit gives authors ready-made GPU helpers: render targets, full-screen passes, depth reconstruction,
   and a GPU → CPU grid read-back that never stalls.
5. **Making modules easy to build and share** (the plan; built in stages, see below):
   - **Starters:** particles, 2D grid, and a 3D grid.
   - **Local testing:** hot reload inside the running game, plus `?lance=` / `?ground=` to pick a module.
   - **Sharing:** an unlisted share link with a warning, or a listed entry in the registry (reviewed).
   - **Playing:** live switching between modules and a fire sandbox mode.
6. **One game repo, two shading layers (two editions).**
   - **What is shared** (written once):
     - the simulation, bot, UI, audio, cinema logic and assets;
     - the world-building code: geometry, placement, animation and standard three.js materials.

     About three quarters of the game's code is shared.
   - **What exists twice**, once per edition, under `src/gfx/webgl2/` and `src/gfx/webgpu/`: the custom shaders, the
     render pipeline ("look") and the fire-light patch.
   - **How the editions run:**
     - The WebGL2 edition uses three.js `WebGLRenderer` and GLSL.
     - The WebGPU edition uses three.js `WebGPURenderer` and TSL / WGSL.
     - Both import the same three.js core (`three/build/three.core.js` is shared by `three` and `three/webgpu`, checked in
       r186).
   - **The game boots in the edition of the chosen fire module.**
     - A GLSL (`webgl2`) module boots the WebGL2 edition; a `webgpu` module boots the WebGPU edition.
     - Every module therefore runs natively: no copies between graphics APIs, no lag, and no bridge.
     - Switching between modules of different backends reloads the page and restarts the night. Switching within one
       backend is live.
     - `?gpu=webgl2|webgpu` picks the edition directly. Without WebGPU support the game falls back to WebGL2.
   - **A WebGPU edition can be partly ported.** Until a lane's shaders exist in the WebGPU layer, that lane is off in
     the WebGPU edition and the greybox stands in, as it already does when a lane fails. The WebGPU edition is
     therefore playable from its first day and reaches parity lane by lane.

## Rationale

- **Splitting the fire out is feasible.**
  - The game already loaded its fire as an optional lane with a CPU fallback.
  - The fire events (`FIRE_OP`) were already plain data.
  - Gameplay asks the fire only `heat(x, z)` and `fuel(x, z)`.
  - The hard part was a clean interface, because today's fire does many game-specific jobs: the light map on every
    material, the ending's fire columns, rain, five hues and two styles.
- **The Lance first.** The Lance's airborne flame (`jet.js`, 189 lines) was already visual-only and is the smallest
  slot. The ground fire is harder, because it decided gameplay and lit the world.
- **Visual-only vs gameplay modules.**
  - Visual-only modules would keep balance fair.
  - Gameplay modules need written fire rules, gameplay checks and per-module balance runs.
  - Balance is out of scope, so modules may decide the gameplay grid; only a referee/fallback grid stays.
- **A 3D grid fluid as a module** (a separate WebGL2 3D-smoke experiment; 48³ ≈ 1.8–2.0 ms measured there).
  - Its draw call has nearly the same shape as the game's fire pass.
  - Gaps:
    - its 6 m box is fixed in the world, while the Lance reaches 11 m and swings fast;
    - it simulates rising gas, while the Lance is a falling liquid arc, so the likely recipe is particles along the
      arc plus the gas grid for flames and smoke;
    - one colour ramp;
    - its own tone mapping;
    - a fixed time step;
    - the cost in first-person close-ups was never measured.
- **WebGL2 vs WebGPU.**
  - WebGPU has compute shaders: scattered writes, shared memory, atomics and real 3D storage textures. Fluid authors
    increasingly want it.
  - WebGL2 runs everywhere, and most three.js shader code, ours included, is GLSL.
  - A WebGL2 context and a WebGPU device cannot share memory, so mixing them needs a bridge:
    - **image bridge:** the module draws its own picture, with two copies per frame and maybe a frame of lag;
    - **data bridge:** the module simulates and the host draws, through a CPU round trip.
  - `WebGPURenderer` runs neither GLSL `ShaderMaterial` nor `onBeforeCompile` patches (checked in r186: only built-in
    materials convert, via `StandardNodeLibrary`).
- **Options for offering both formats.**

  | Option | Verdict |
  |---|---|
  | WebGL2 game + bridge | Cheap, but WebGPU modules pay for the bridge |
  | **One repo, two shading layers** | **Chosen.** Every module native; the cost is a one-time rewrite of the shading layer (about 2,100 lines of GLSL in 85 blocks / 23 files, plus the pipeline) and doing later visual changes twice. Small, because the game's look is close to final. |
  | One `WebGPURenderer` layer that falls back to WebGL2 | GLSL modules could never run natively, and compute does not fully work on the fallback |
  | Two repos | Rejected: the sim, UI, audio, assets and tests would fork and drift |

## Consequences

- `src/fluid/` leaves the game and becomes Firewraith's `classic` module, `webgl2` backend.
  - The game's `fluid` lane becomes the **fire host** (`src/fire/`).
  - The host keeps the old lane behaviour: the CPU grid fallback, the greybox fire, and the `__ew` hooks.
- Fire events (`FIRE_OP`, `FIRE_HUE`, `FIRE_CAPS`) are defined in Firewraith's API. The game's `src/shared/fireops.js`
  re-exports them and keeps the game-only rules (`BURN`, `WIND`, `HUE_OF`).
- `docs/FLUID.md` moves with the module to `firewraith/modules/classic/FLUID.md`.
- Visual changes are made in both shading layers once the WebGPU edition reaches parity. Each release needs
  side-by-side captures of both editions.
- Browser tests (e2e, shots, perf) run per edition. The Node tests stay single, because the sim is shared.

## Implementation stages

| Stage | What | Done when |
|---|---|---|
| 1 | The Firewraith repo: the API v1 doc, the API code (events, validation), the kit, `classic` (webgl2) moved out of the game; node tests | Firewraith tests pass; committed locally |
| 2 | The fire host in the game: registry, `?lance=` / `?ground=`, per-slot fallback, URL modules on localhost; `src/fluid/` removed | `npm test`, `npm run e2e` pass; captures match the pre-split baseline |
| 3 | Two editions: `src/gfx/{webgl2,webgpu}`, edition choice (`?gpu=`, the module's backend), the WebGPU edition booting with `WebGPURenderer` (greybox world, UI, audio, CPU fire grid) | Both editions boot and play with 0 console errors |
| 4 | Port the lanes to the WebGPU layer one by one (look, env, actors, fx, cinema), each split into shared world code plus per-edition materials; a `webgpu` reference fire module in Firewraith | Per lane: side-by-side captures of both editions |
| 5 | Author experience: starters, `create` tool, bench, hot reload, sandbox mode, live switching, hosting and registry | — |

## Open items

- **Hosting:** the game is a static build (`npm run build` → `dist/`) served by a static host.
- **Unlisted module links** on the hosted site (with a warning) — yes or no.
