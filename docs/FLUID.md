# FLUID · the fire moved to Firewraith

VALLEYWARD's fire is no longer in this repo. The fluid that lived in `src/fluid/` is now a **fire module** in the
repo **Firewraith** ([github.com/lethehaiau/firewraith](https://github.com/lethehaiau/firewraith)), installed as the
`firewraith` package from its `v0.2.0` tag. To run the game on a local Firewraith checkout, use
`npm install --no-save ../firewraith`. Why it moved, and why the game has a WebGL2 and a WebGPU
edition: `docs/decisions/0001-fire-modules-and-two-editions.md`.

## Where things are now

| What | Where |
|---|---|
| The fire as it was in the game: the 2D GPU grid fluid, the ray-marched volume in two styles (smooth, hybrid), embers, steam, the Lance's particle jet, the light map, the gameplay grid (WebGL2) | Firewraith's `classic` module: `firewraith/modules/classic/` |
| The same fire ported to WebGPU (the WebGPU edition's default) | `firewraith/modules/classic-webgpu/` |
| How `classic` works, its knobs, its measured cost and its history, including "Light map" and "Proxy targets" | `firewraith/modules/classic/FLUID.md` |
| The Fire API v1 every module follows: slots, fire events, what the host gives a module, the gameplay grid | `firewraith/docs/API.md` |
| The game's fire host: picks a module per slot, falls back, feeds it every frame, passes on its light map and gameplay grid | `src/fire/` (in this repo) |
| The fire events (re-exported from Firewraith) and the game's own fire rules: `BURN`, `WIND`, `HUE_OF` | `src/shared/fireops.js` |
| The fire light on every material | `src/shared/firelight.js` (WebGL2), `src/gfx/webgpu/firelight.js` (WebGPU) |
| The deterministic CPU fire grid that runs beside any module | `src/sim/fireproxy.js` |

## How the game hosts a fire module

- **Two slots:** `lance` (the Ember Lance's airborne flame) and `ground` (the fire on the ground: fire, smoke, embers,
  steam, and the light it casts). One module may fill both.
- **Picking:** `?lance=<id|url>`, `?ground=<id|url>`, or `?firemod=` for both. An id must be listed in
  `src/fire/registry.js` (today `classic` and `classic-webgpu`); for development, a module URL on this machine
  (`http://localhost:…`, `127.0.0.1` or `[::1]`) also works. Without a pick each edition uses its reference module.
- **The edition follows the module.** A listed WebGPU module boots the WebGPU edition; `?gpu=webgl2|webgpu` forces one.
  A module given by URL shows its backend only once it loads, after the edition is chosen, so a WebGPU module served
  by URL needs `?gpu=webgpu` (without it the module fails its backend check and `classic` takes its slots).
- **Fallback, per slot:** a module that is missing, invalid, built for the other edition, or throws (while loading or
  later) is replaced by the edition's reference module (`classic` or `classic-webgpu`) for its slots. If the reference
  module itself fails, the fire host is switched off: the CPU fire grid is the gameplay fire and the greybox draws it.
  `__ew.perf().fire.modules` says which module fills each slot and why a slot fell back.
- **Every frame** the host passes on the fire events of every sim tick since the last frame and the wind, advances the
  modules by the game time and the rain, gives the `lance` module the Lance's origin, aim and landing, and draws the
  `ground` module, then the `lance` module, in the look's fire pass.
- **What burns.** The sim reads heat and fuel from the `ground` module's gameplay grid once it is ready and fresh, and
  from the CPU fire grid when that grid is more than 30 frames old or missing (a visual-only module). `?fireproxy=1`
  keeps the CPU grid; with `?debug=1`, `__ew.fireCompare()` compares the two. Damage from the Lance's airborne stream
  stays with the sim's ballistic arc: modules only draw it.

The details of the swap and of the fire events are in `docs/CORE.md` ("The fire").

## The fire bench

`preview/fluid.html` runs `classic` through the game's fire host, without the rest of the game (WebGL2 only). It is
built around `classic`: its sliders and readouts use classic's knobs and debug hooks, so another module will not run
there.

- With `npm run dev`: `http://127.0.0.1:5350/preview/fluid.html`. Parameters: `?quality=high|medium|low`,
  `?fire=smooth|hybrid`, `?view=m1|m2`, `?scenario=m1|m2`, `?noui=1`, `?timing=1`, `?debug=1`. Automation:
  `window.__fluidBench`.
- Captures and timings in headless Chrome: `preview/fluid.capture.mjs` (usage in its header). Timings come from a
  production build of the bench: `preview/fluid.vite.config.js`.
