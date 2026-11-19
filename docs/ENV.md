# ENV · VALLEYWARD — the place and the render path

The environment is Valleyward Keep on its hilltop and everything around it: the terrain and the road, the cube-cut stone
keep and its gate, the oil troughs and barrels, braziers and the beacon, pines, fog, the sky with its big pixel moon,
the far horde in the valley, the camp's set dressing, the goblin village, rain, and the ending's sky and fire. It also
owns **the look**: the hand-written render path that draws the world, the fire, the viewmodel and the post-processing
(god rays, bloom, the grade) into one frame.

- World code: `src/env/` (shared by both editions). Layout: `src/shared/arena.js` (`ARENA`, `groundHeight`), which the
  sim, the fire and the actors read too.
- The look: `src/look/index.js` dispatches to `src/gfx/webgl2/look.js` or `src/gfx/webgpu/look.js`; `src/look/mood.js`
  holds the mood the environment writes and the look reads.
- Custom shaders, once per edition under the same names: `src/gfx/webgl2/materials/env.js` (GLSL) and
  `src/gfx/webgpu/materials/env.js` (TSL); see §6 and `docs/WEBGPU-PORT.md`.
- Art: `assets-src/env/` (prompts, processing scripts) → `public/assets/tex/` (14 pixel tiles, ≈ 35 KB in all).
- Bench and tools: `preview/env.*`.

## 1. Integration

`src/main.js` does all of this; a failed load falls back to the greybox world (the environment) or to a plain
`renderer.render` with ACES (the look).

```js
const env = await createEnvironment({ renderer, scene, camera, quality, assetsBase });  // adds env.root, sets scene.fog
const look = createLook({ renderer, scene, camera, quality });                        // owns tone mapping + output
if (env.envMap) scene.environment = env.envMap;     // a PMREM of the night sky (Standard materials only)
look.setFluidPass(fire.pass);                       // the fire host's pass: composites the fire over the world
look.setViewmodel({ scene: vm.scene, camera: vm.camera });   // drawn after the fire, depth cleared
// every rendered frame, after the sim steps:
for (const ev of events) env.onEvent(ev, state);
env.update(dt, t, state);
look.setHurt(x); look.render(dt);
// on resize: renderer.setSize(...) then look.setSize(w, h)   (the look reads the drawing-buffer size)
// adaptive resolution: look.setResolutionScale(0.5..1)       (world + post at a fraction, upscaled)
```

- **The environment drives itself from the state**, so the game needs no extra calls: `gate.hp` → the gate's damage
  state; `troughs[i].{oil, lit}` → the oil level and soot; `barrels` → which barrels stand; `mode === 'camp'` → dusk;
  `night.n` → the night's palette; `weather.{rain, storm}` → rain and lightning; mode `'ending'` + `ending.t` → the
  ending's channels; `camp.near` and `towers` → the build pads; `player` → the horned shadow.
- **Events:** `BARREL_BURST` (10 staves fly), `KINDLE` (the beacon flare and its vision), `CAMP_ENTER` / `CAMP_LEAVE`
  (dusk in 1.2 s; sunset in `CAMP_SUNSET` = 1.6 s with the lamp flaring 0.2 s before night falls), `RUN_START`,
  `GATE_HIT` (the doors shake), `TROUGH_LIT` / `TROUGH_OUT` (soot) / `TROUGH_FULL`, `RETRY` (gate, troughs, barrels and
  dawn reset), `'cinema.beacon'` (the beacon sputters for the intro).
- **Setters** (all optional; each overrides its channel until reset): `setDawn(x)` (call it on the look too),
  `setCamp(x, seconds)`, `setNight(n, now)`, `setRain(x | null)`, `setStorm(on)`, `strike()`, `setWorldChange(x)`,
  `setPortal(x)`, `setLamp(x)`, `setGateOpen(x)`, `setVillageBurn(x)`, `setEndingTime(t | null)`, `flare()`,
  `beaconFlicker(s)`. Read-outs: `env.mood`, `env.endingBeats`, `env.stats()` (build ms, scene triangles, pine count).
- **The mood** (`MOOD` in `src/look/mood.js`): `camp`, `red`, `dawn`, `dawnReset`, `sunDir`, `rain`, `world`, `flash`,
  `lightning` (a strike counter the audio can follow), `night`. The environment writes it every frame; the look reads it.
- **Lights** are a constant set, never toggled, so no program recompiles: 1 moon `DirectionalLight` (shadow map 2048 on
  high and medium, 1024 on low; a ±30 m frustum that follows the camera, snapped to texels) + 1 `HemisphereLight` + 5
  `PointLight`s (4 braziers, the beacon) = 7. Other glows (the village's lanterns and fires, the stall's forge) are
  emissive only.
- **The sky does not write depth:** the look finds open sky by depth = 1 for the god rays. Anything drawn "at infinity"
  must write depth if it should block them.
- **The camera** is the game's `PerspectiveCamera(78, …, 0.05, 900)` (78 = vertical FOV); the sky sits on the far plane
  whatever `far` is.
- Debug handles: `window.__ewEnv` (the environment, with `.firelight`), `window.__ewLook` (the look: grade uniforms,
  exposure).

## 2. The place

| File | What |
|---|---|
| `src/env/index.js` | `createEnvironment()`: materials, lights, the moods, the gate / troughs / barrels / debris state, the shadow follow, the PMREM env map, the ending's channels |
| `src/env/keep.js` | the keep from `ARENA.keep`: every wall face laid as individual cut blocks (courses 0.5–0.8 m, blocks 0.7–1.5 m, 0–7 cm proud, a tone each, 3.5 cm joints over a dark core); towers with corbel bands and merlons; the gatehouse (buttresses, a flattened arch of 11 voussoirs, a dark passage); the wall walk and parapets; the timber stair; the trough rims; the courtyard the wall walk sees; palisades |
| `src/env/gate.js` | the doors: 10 planks cut to the arch, 2 barricade beams, 6 iron bands (3 instanced draws); 5 damage states from the HP fraction (≥ 0.75 whole, ≥ 0.5 cracked, ≥ 0.25 holed, > 0 failing, 0 breached); `setOpen(x)` swings both leaves out for the ending |
| `src/env/terrain.js` | `envHeight()` = `groundHeight` inside `ARENA.terrain` plus a falling, rolling backdrop beyond; one mesh (0.75 m cells on the plaza and slope, 1.25 m on low, coarser further out, ≈ 71k triangles); grass, earth and road mixed per texel with a hashed dither, so the road edge reads as pixels; `ROAD_DRAWN` continues the road down the far valley |
| `src/env/nature.js` | pines (3 low-poly stepped-tier variants, instanced: 2,661 on high, 1,886 medium, 1,246 low; the near set casts shadows; the horde's corridor and the open hilltop east of the plaza kept sparse); 3 drifting valley-fog planes |
| `src/env/props.js` | braziers in iron baskets on stone pillars, the beacon's iron cresset mast, the kindling pan; pixel flame billboards (1 instanced draw, a 6-frame atlas); coals; oil barrels (instanced, burst into staves); boulders; grass tufts |
| `src/env/sky.js` | the sky dome (1 draw): gradient, the pixel moon (12° across, 60 art pixels, drawn in screen pixels so it stays round), halo, rays, clouds, stars, three mountain ridges, the dawn sun, the dusk, the overcast, the black moon's corona, the ending's red sky |
| `src/env/nights.js` | `NIGHT_LOOKS` (the ten nights' palettes), `WORLD_LOOK` (the ending), `nightLook()` |
| `src/env/beaconfx.js` | the kindle flare: an additive sky glow, a shader-animated spark fountain, the vision (3 draws) |
| `src/env/farhorde.js` | the far horde: 4,200 specks (2,800 medium, 1,600 low), 7.5 % of them torches, streaming toward the keep down the far valley, off the east hill and out of the south-west valley (1 Points draw) |
| `src/env/camp.js` | Brother Cinder's stall, the goblins' dropped banners on the slope, the six build pads |
| `src/env/hints.js` | the player's horned shadow at dusk |
| `src/env/village.js` | the goblin village at `ARENA.village` and its burning |
| `src/env/weather.js` | rain streaks, splashes, lightning |
| `src/env/ending.js` | the portal, the lamp's pillar, the hell-gate glow, the falling embers |
| `src/env/materials.js` | the Lambert family (`lambert()`), `WALLFIRE`, `ENVFX`, `patchEnvFx()` |
| `src/env/textures.js` | the tile loader with procedural fallbacks; the flame atlas, the tuft sprite, the fog noise |
| `src/env/util.js` | a seeded RNG and the `Builder` that merges boxes and geometries into one indexed geometry per material |

**How it is built.** Everything static goes through `Builder`s merged by material, so the keep, the stall's timber, the
village's racks and fences cost one draw per material. Lit materials are `MeshLambertMaterial` with a pixel tile and
vertex colour (`lambert()`), patched per edition with: a one-texel pixel bevel on cut blocks (`aBlk`: a light top-left
edge, a dark bottom-right edge, the cube-cut look); soot on burnt troughs (`aTag`); `WALLFIRE` (the fire light map
sampled 2.4 m out along the normal on vertical stone, 8 m height falloff, × 1.6, so a burning trough warms the wall
beside it); `lightTint`; the shared fire light (`patchFireLight`); and `ENVFX` (wetness, ash, lava). The oil surfaces
are the one `MeshStandardMaterial` (a wet sheen from `scene.environment`).

**The camp's set** (`camp.js`). Brother Cinder's stall is a lean-to on the SW tower's south face at `ARENA.camp.npc`:
posts and braces, a sagging striped cloth awning with a flapped valance (1 draw + its shadow), an anvil on a stump, a
workbench, two blades on the wall, a small forge (a flame and coals, no light), crates, a hanging lantern. The six build
pads (1 draw) are pixel rune circles burnt into scorched discs, an ember glow that breathes and crawls round the ring:
0.1 by night, 0.6 at the camp, × 2.4 within reach (`camp.near`), × 0.65 under a tower. Six goblin banners lie on the
slope (three planted askew, three trampled flat): a lamp crossed out on bone cloth, a hint of the story.

**The hints.** At dusk the low sun throws the player's shadow across the plaza and up the south wall, and the shadow has
two small horns (`hints.js`: each fragment traces back toward the sun onto a silhouette plane through the player;
multiply-blended, ≈ 70 % darker on the wall, 60 % on the ground). In every kindle flare, 0.18–0.74 s after it, two files
of small horned figures with spears march through the fire column as dark pixel silhouettes (`beaconfx.js`).

**The kindle flare** (`EV.KINDLE`): the basket flame swells ≈ 3×, a 3-sprite fire column rises, 220 sparks fountain, a
warm sky glow blooms and the beacon light pulses, for ≈ 3.4 s. Flame sprites are screen-plane billboards, upright along
world up as it falls on the screen and capped at ≈ 0.36 × their distance: a cylindrical quad seen from below splayed
into a wide block.

**The village** (`village.js`, at `ARENA.village` (12, 108), r 17): 8 round wattle-and-daub huts with thatched cone roofs,
a well, 4 drying racks with hides, a stake fence, 7 lantern posts (emissive glass, no lights); the pines keep a
clearing. Walls and roofs are 2 draws; the rest merges into the keep's batches. Seen from the wall walk ≈ 110 m away as a
quiet far village every night; in the ending's hunt it burns: 20 light-less flame instances catch one after another,
the roofs char, and a 68 × 32 m additive glow swells over it (1 draw).

## 3. The moods

Each frame `applyMood()` blends, in order: the night's palette → rain → the ending's world change → dawn → the camp at
dusk, into the moon/sun light, the hemisphere fill, the fog, the sky uniforms, the valley fog and `MOOD`.

**The ten nights** (`NIGHT_LOOKS` in `nights.js`, from `state.night.n`; one night to the next ramps over 1.5 s): the moon
reddens night by night — I teal-white, II blood, III rust, IV crimson, V dark red, VI red-violet, VII violet, VIII deep
red, IX black-red with a faint corona, X a black disc with a ragged red corona. Each row also sets the halo, the sky,
the three ridges, the fog (density 0.0068 → 0.0076, a little darker and warmer each night), the moonlight (7.0 → 5.4,
teal → grey-lavender → rose-grey) and the fill (3.9 → 3.45). Night II's moon sits at a lower HDR (× 0.9) so the tone
map keeps it red, not salmon, and its moonlight is lavender-grey: a rose moonlight under the first blood moon turned
the earth orange. (`NIGHT` in `index.js` holds Night I's base values and the brazier and beacon lights; the `NIGHT2`
constant there is unused, superseded by `NIGHT_LOOKS`.)

**The camp at dusk** (`DUSK`, from `mode === 'camp'`): the key light swings from the moon to a low amber sun at
`ARENA.camp.sunDir` (`#ffbf8e`, 5.6), shadows darken (0.65 → 0.82) with more normal bias for the grazing light, a
lavender fill, a dusty mauve fog (`#6a6472`, 0.0046); the sky gets an amber band on the western horizon, clouds lit from
below, a 20-px pixel sun, a pale moon in the east and no stars; the god rays stream from the sun (× 0.7); the braziers
drop to 55 %, the lamp smoulders, the far horde's torches are hidden. Entering drops any held dawn.

**Dawn** (`setDawn(x)` on both the environment and the look): the key swings to a warm sun in the east, the sky
brightens, the moon and stars fade, the fog lightens, the look warms the grade.

**Rain** (`state.weather.rain` 0..1, smoothed): ≤ 6,000 world-space streaks (3,500 medium, 1,800 low; one instanced draw
wrapped in a 44 × 26 × 44 m box round the camera, slanted by the wind, fogged) and ≤ 600 pixel splash crowns (250 on
low). The ground gets wet over ≈ 3 s and dries over ≈ 20 s (`ENVFX.uWet`): lit materials darken and the up-facing ones
mirror the sky and the fire light. A low overcast hides the stars and the moon (its disc −55 %), the fog greys and
thickens (density × 1.5), the moonlight drops 30 %, and the look grades cooler and darker (exposure −4 % and a cool
multiply). **Lightning** (Night X,
`weather.storm` or `setStorm(true)`, with rain ≥ 0.45): double flashes every 4–10 s light the overcast, the fill and the
frame (`MOOD.flash`); `MOOD.lightning` counts strikes.

**The ending** (mode `'ending'`; beat times from `TIMELINE.ending` in `src/shared/timeline.js`, `ENDING_DEFAULT` only as
a fallback). Each channel ramps from its beat: `lamp` (5 s, over 4 s), `portal` (8 s, over 5 s), `world` (12 s, over
6 s), the gate (`host`, 18 s, over 2.5 s), the village burning (around `hunt`, 42 s).
- **The lamp:** the beacon's flame and fire column turn black-red and swell; a pillar of black-red fire climbs from the
  basket (a cylindrical billboard with a scrolling flame shader); the beacon light turns red and swells, lighting its own
  patch of sky.
- **The portal:** a ring of fire torn in the sky above the keep (`PORTAL` (0, 52, −26), r 24, tilted 0.42 rad toward the
  plaza and the valley), a vortex of fire filaments into a black-red eye, pixel-quantised. From this beat the sky turns
  crimson (brightest low and toward the portal, with drifting smoke banks), the far world fades into dark-red fog, and
  the portal becomes the key light (+ 4.2, its direction fully from above-north once 60 % open): what faces it gets red
  rims, south faces stay dark.
- **The world change:** grass to ash, pines to charcoal with crawling ember specks, timber charred; lava cracks open
  along a few sparse rifts across the plaza and the slope (8 texels a metre, hot cores, a red glow), with a river of
  cracks from the gate down the slope; embers fall like snow round the camera (≤ 2,400 points, 900 on low); the far
  horde's torches go out. The look grades darks toward near-black with a cold indigo cast, mid-tones lose colour, and
  bright light (the portal, the pillar, lava, fire) keeps its own hue; the black point lifts a little and the mid-tones
  get more lift so dark silhouettes still separate.
- **The host:** both gate leaves swing out over the plaza and the passage behind fills with fire light (`hell-gate`), so
  the host marching out reads as black horned figures against fire and red ground.
- **The hunt:** the village burns (see §2).

## 4. The look (the render path)

Hand-written, no composer: the fire must sit between the world and the viewmodel with the scene's depth, and the
viewmodel's depth doubles as the mask that keeps god rays off the hands. Per frame:

1. **World** (environment + actors + fx) → `sceneRT`: half-float linear HDR plus a depth texture.
   `renderer.info.autoReset = false` and a reset per frame fill `look.stats.worldCalls / worldTris` (the world pass with
   its shadow pass) for the perf overlay.
2. **God rays:** a mask of the open sky (depth = 1) near the source, bright pixels only, at ¼ resolution (⅕ on low),
   then a radial blur toward the source (40 / 28 / 20 samples on high / medium / low). The source is the moon by night
   and the low sun at the camp (× 0.7); rays fade with dawn. They are drawn only while the source is in front of the
   camera and near the frame; strength `GRADE.rays` = 0.5 (`?rays=`).
3. **The fire:** `fire.pass.render(renderer, { colorTex, depthTex, camera, target, width, height })` composites the fire
   over `sceneRT` into `compRT` (skipped when there is no fire pass).
4. **The viewmodel:** its own scene and camera, after clearing depth.
5. **Bloom:** a soft threshold (1.0, knee 0.45) on bright pixels only, a dual-filter chain at ½ … 1/32 resolution
   (5 levels, 4 on low); the widest halos are weighted × 0.8 per level, so a big fire no longer tints the whole sky.
6. **One output pass:** + bloom (0.75) + rays (masked off the hands) → exposure (`GRADE.exposure` 1.15) → split tone
   (cool teal darks, warm highlights; the warm push skips saturated non-warm light, so violet, blue and green fire keep
   their hue) → dawn, rain and world-change grades → tone map (Khronos PBR Neutral; AgX with `?tone=agx`) → saturation
   by luminance (1.08) and contrast (1.04) → a lifted floor → vignette (0.32) → the hurt edge → flash → sRGB → a
   display-space mid-tone lift (`GRADE.mid` 0.2) → dither → the canvas.

No SSR, TAA, DOF or MSAA. API (both editions): `render`, `setFluidPass`, `setViewmodel`, `flash(rgb, amount, seconds)`,
`setHurt`, `setDawn`, `setExposure`, `setTone('neutral' | 'agx')`, `setSize`, `setResolutionScale`, `warm`, `dispose`,
`depthTexture`, `grade`, `stats`. Tuning without a rebuild: `?exp=`, `?mid=`, `?rays=`, `?tone=agx`, and
`window.__ewLook`.

## 5. Numbers

**Budget.** The environment's share of the game's frame budget (`docs/DESIGN.md` §4.8: ≤ 300 draw calls, ≤ 1.5 M triangles
for the whole frame) is ≤ 140 draws and ≤ 700k triangles at the m1 and m2 views on high. It is met with room to spare.

**The bench** (`preview/env.capture.mjs --perf` on a production build of the bench, 1920×1080, `quality=high`, headless
Chrome + Metal on an Apple M4, 180 frames a view, vsync and the frame cap off; the environment and the look only, with a
stub fire pass, no actors), 2026-11-14:

| View (state) | World pass draws (incl. shadow) | World pass triangles | Frame draws (with post) |
|---|---|---|---|
| m1, Night I | 45 | 526k | 56 |
| m1, Night IV, full rain | 47 | 539k | 58 |
| m1, world change + portal + lamp | 47 | 526k | 58 |
| m2, Night I | 50 | 527k | 61 |
| the village from the wall walk | 50 | 527k | 61 |
| the portal view (world, portal, lamp, gate open) | 53 | 527k | 64 |
| the hunt's crane, village burning | 27 | 473k | 38 |

- **Frame cost** of the environment + the look: ≈ 3–4 ms at 1080p on a quiet machine (2026-11-13: m1 3.05 ms avg /
  4.1 ms p95, m2 3.46 / 4.3, the camp views 3.6–4.1 / 4.7–5.3). With other jobs loading the machine (2026-11-14) the same
  draws read 5.8–7.4 ms, so treat those as load, not cost.
- **Scene triangles** in one pass: ≈ 424k (pines ≈ 250k, terrain 71k, the keep's stone 43k, rocks 19k, tufts 14k).
  Instanced pines are submitted whole (no per-instance culling), so the count barely changes with the view; the first
  lever if the frame needs triangles back is a far-pine LOD.
- **Extra draws by state:** + 0 at rest by night (the village merges into the keep's batches except its 2 meshes), + 2
  in rain (streaks, splashes), + 3 in the ending (portal, pillar, embers), + 1 for the burning village's glow, + 1 at
  the camp (the horned shadow); the vision only for half a second. The awning, the banners and the pads are always
  drawn (3 draws + the awning's shadow).
- **Build:** `createEnvironment` takes 100–173 ms on the M4 (everything is generated; the tiles are tiny).
- **In the full game** (production build, 1600×900, vsync on, the M4, 2026-11-13): the whole frame 87–96 draws and
  513–518k triangles at 60 fps (p50 16.7 ms, p95 16.8 ms), 0 console errors.

**Frame luma** (mean of the frame, sRGB). The night grade (exposure 1.15 and the mid-tone lift) was tuned in the full
game so the night without fire sits at a frame p50 of ≈ 0.24–0.26 at m1 and m2 (production build, 1600×900, 160×90
Rec.709 stats, 2026-11-13: m1 p50 0.255 / mean 0.261, m2 0.242 / 0.264); the fire carries the frame above that. An
earlier pass at exposure 1.3 with a 0.6 lift read p50 0.31 without fire: too bright. These were measured
before the god rays first showed (2026-11-18); the rays add a soft halo only when the moon is in view.
- The ten nights, bench m1 (2026-11-14): I 0.269, II 0.203, III 0.204, IV 0.191, V 0.185, VI 0.186, VII 0.176, VIII 0.164,
  IX 0.165, X 0.167. Full rain: m1 0.150, m2 0.153.
- The ending in the real app (production build, 1920×1080 high, 400×225 Rec.709 stats, 2026-11-14), mean / p50:
  lamp (6.6 s) 0.126 / 0.133, portal (10.2 s) 0.182 / 0.178, world (15.0 s) 0.156 / 0.161, host (21.5 s) 0.130 / 0.105,
  reveal (31.5 s) 0.192 / 0.127, hunt (44.5 s) 0.152 / 0.105.

## 6. The two editions

The game has two shading layers (decision `docs/decisions/0001-fire-modules-and-two-editions.md`; the porting rules
and status are in `docs/WEBGPU-PORT.md`). Both run the same environment code; only the custom shaders and the look
differ:
- `src/env/*` builds geometry, placement and animation and asks the active layer for materials through `gfx()`: an
  `env*` factory per custom shader (sky, rain streaks and splashes, valley fog, flames, the village glow, pads, the
  horned shadow, portal, pillar, hell-gate, embers, the beacon's glow, sparks and vision, the far horde), the patches
  `envPatchLambert` / `envPatchTerrain` / `envPatchFx`, `envMapFromScene` (the PMREM) and `envPoints`. Each factory
  returns a material whose `.uniforms` names match, so `mat.uniforms.uTime.value = t` works in both.
- **WebGL2** (`src/gfx/webgl2/`): the GLSL, moved verbatim when the editions split; it builds 29/29 programs identical to
  before the move. The look: `src/gfx/webgl2/look.js`.
- **WebGPU** (`src/gfx/webgpu/`, `?gpu=webgpu`): TSL twins of every factory; patched built-in materials get their own
  program cache keys; sized points (sparks, embers, the far horde) become pixel-sized instanced quads, because WebGPU
  points are always one pixel. The look (`src/gfx/webgpu/look.js`) is the same passes as `RenderTarget`s and TSL quad
  passes; the output pass encodes sRGB itself, so the renderer's own output transform is off for that draw (no double
  tone map). A like-for-like bench (the same stand-in world through both looks) matched within the dither (mean
  difference ≤ 0.24 / 255). Its frame time is not measured yet.
- `GRADE` is defined in both looks with the same values; change both.

## 7. Art: the pixel tiles

**Generation.** The tiles were generated with the Codex CLI's image generation from the prompts
in `assets-src/env/*.jobs.json` (`tex.jobs.json` is written by `tex.batch.mjs`; `props.jobs.json` holds the banner and
the awning cloth, `village.jobs.json` the village's thatch and mud) (the generator itself is not in this repo: a job file is `{ id, prompt, out, aspect, refs }`, so any image generator can run it). Raw images land in `assets-src/env/raw/*.png`
(gitignored binaries) with a `.png.json` sidecar each. The processing scripts turn them into the shipped tiles, and each
tile's prompt and inputs are recorded in `public/assets/tex/provenance.json`. The prompts are text-only: no image is
attached (the ten `tex.jobs.json` tiles were regenerated that way on 2026-11-18).

```bash
node assets-src/env/tex.batch.mjs                                     # writes tex.jobs.json
# generate each job in tex / props / village .jobs.json into its `out` path, with any image generator
node assets-src/env/tex.process.mjs && node assets-src/env/props.process.mjs && node assets-src/env/village.process.mjs
```

**Processing:**
- `tex.process.mjs` (stone, blocks, flag, timber, earth, road, grass, roof: 64×64; iron, pine: 32×32): resize to the
  tile size (sharp, cubic kernel; the script's header calls it a box downsample), make organic tiles seamless (stone,
  earth, road, grass, iron, pine) with a **seam pick** — each pixel keeps either the original or the half-offset copy,
  chosen by a hash against a weight that is 0 at the edges and 1 in the middle, so the edges come from the wrapped copy
  and no pixel is blended — then a palette cut (libimagequant through sharp, 10–14 colours, no dither) and lossless
  WebP. Timber is desaturated (× 0.62) and darkened (× 0.92) first: the generated wood read too warm.
- `props.process.mjs`: `banner.webp` 40×60 RGBA, nearest-sampled, the magenta ground keyed to alpha; `cloth.webp` 64×64,
  nearest-sampled. `village.process.mjs`: `thatch.webp`, `mud.webp` 64×64, nearest-sampled. All lossless WebP.

**At run time** (`textures.js`): `NearestFilter` magnification (hard pixels), trilinear mip-mapped minification (no
shimmer), repeat, anisotropy ≤ 8; 16 texels per metre on every surface. A tile that fails to load falls back to a
procedural pixel tile in the same palette (`FALLBACK`), the banner to a procedural banner, so the world never shows a
missing texture. The tiles are authored as the final unlit colours (slate `#3a4652`–`#4a5560`), which is why the moon
and sky light are strong (§8).

## 8. Decisions

- **A hand-written render path, not a post-processing library:** the fire needs the scene depth between the world and
  the viewmodel, and the viewmodel's depth must mask the rays. 1 scene pass + 2 ray passes + the bloom chain + 1 output
  pass.
- **Khronos PBR Neutral tone mapping:** it keeps the teal night teal and the fire orange. An A/B with AgX lifted the frame
  (m1 luma 0.34) and turned the teal sky and the slate grey. `?tone=agx` keeps the A/B one parameter away.
- **Exposure 1.15 plus a display-space mid-tone lift (0.2):** the first build's frame body was 20–45 % darker than the
  key art; the lift raises the mid-tones without washing the darks or the fire.
- **God rays at 0.5:** at 1.6 they washed out the moon's craters and hazed the treeline; at 0.5 the moon keeps a soft
  halo and the camp's low sun casts soft shafts. Lesson: until 2026-11-18 they never showed, because the look called
  `THREE.MathUtils.smoothstep` with GLSL's argument order (`(edge0, edge1, x)` instead of `(x, min, max)`), so the
  strength was always 0.
- **Lambert everywhere** (the roughness-1 look, the cheapest lit material); the oil is the one Standard material.
- **Strong moon and sky light** (moon 7, hemisphere 3.9, sky colour (0.64, 0.8, 0.9)): the tiles carry the final colours,
  so the light has to bring them back to about their own value; the grade, not the light, makes the night.
- **Slate stone through `lightTint`:** the stone's tint (1.42, 1.14, 0.95) goes on the moon, sky and brazier light only,
  not on the albedo, so the fire light map lands in its own hue (violet, blue and green fire included). As an albedo
  tint it warmed every fire light × 1.2 red / × 0.8 blue.
- **Fire-lit walls:** `WALLFIRE` on vertical stone, and braziers at 55 cd, range 17 m, decay 1.4, placed 1.1 m above the
  flame and 0.45 m off the wall, in the fire light's colour (linear 1, 0.42, 0.13). The stretch of wall beside a fire
  should read warm.
- **The moon is 12° across** (`MOON_RADIUS` 0.105 rad), 60 art pixels, drawn in screen pixels around its projected
  centre: big and round anywhere on screen (a world-space disc turned oval near the frame's edge).
- **No fences inside the player's bounds:** the sim gives scenery no colliders, so fences were removed rather than
  collided. The bounds are marked by a boulder band, pine lines and the west palisade; no pine stands within 4.5 m of
  `ARENA.playerBounds`.
- **The plateau east of the plaza is open** (no pines at x > 24, z < 16) and the ground beyond `ARENA.terrain` falls
  away east, so the m1 view looks past the road to the sky ridges.
- **The wall walk's parapet** has a 0.5 m outer sill, 1.5 m crenels and 0.95 m merlons ≈ 1.22 m above the walk: from
  the wall walk the player must see the slope and the road. The merlons stay for the silhouette; the sim's parapet
  colliders did not change.
- **The world change is light, not a tint:** the changed world is dark, and the red is light from a source (the portal,
  the pillar, lava, fire). A flat red wash read as monotone (no frame should be monotone). Lesson: a
  pink-mauve south wall in the world beat survived turning the fire pass off; it was the hemisphere's red ground colour
  under a lavender sky filling every vertical face, so the ending's fill is cold and neutral (ground 0.1, 0.07, 0.07).
- **Layout lives in `ARENA`:** moves of troughs, braziers, the beacon or the village flow through without changes here.

## 9. Open issues

- **The tiles are not content-hashed.** `textures.js` loads `tex/<name>.webp` with no version, unlike the actor atlas
  (`docs/ACTORS.md`, "Content-hash versioning"); a regenerated tile can be served stale from a browser cache.
- **`blocks.webp` is loaded but no material uses it** (the cube-cut look is geometry plus the bevel).
- **`scene.environment`** (the PMREM for Standard materials) is the night sky in every mood, the camp at dusk included.
- **The far horde** reads as torch-lit groups in the fog rather than a dense dark column; the specks are 1.5–6 px and
  mostly fogged. A scrolling crowd band on the valley floor would add density cheaply.
- **The valley fog planes barely show** from m1 and m2; the valley's depth comes mostly from the scene fog. A lower,
  brighter fog bank is the next art step.
- **The horned shadow** falls only on the south wall's plane (the gate included) and the flat plaza; troughs, braziers
  and crates hide parts of it. It reads best within ≈ 2 m of the gate.
- **The vision in the kindle flare** reads mostly at the column's edges; in the bright centre the bloom fills the
  silhouettes in. Bigger figures or a darker flame behind them are the levers.
- **The dusk earth** reads warm orange-brown under the amber sun; next to fire it could pass for fire light (`DUSK.sunI`,
  `DUSK.sun`).
- **Night II–X sit below Night I** without fire (by design "a little darker"); the fire carries those frames.
- **Lightning** is checked as a held peak only (`strike=1`); its timing against the thunder is tied only through
  `MOOD.lightning`.
- **Rain is world-space only** (no drops on the lens).
- **Timber** still reads red-brown in some views (crates, the stair) after the tile's desaturation (unverified since).
- **Stale comments:** the bench's header lists fewer views than it has, and `tex.process.mjs` says "box-downsample".

## 10. How to see and test it

**The bench** (`preview/env.html`): the environment and the look alone, at fixed camera framings, with a fake fire light
map, a stub fire pass (so the look's fire path runs), sliders for dawn and the gate, event buttons and a stats readout.
It runs the WebGL2 edition.

```bash
npx vite --config vite.config.js --port 5354 --strictPort      # → http://127.0.0.1:5354/preview/env.html?view=m1
npx vite build --config preview/env.vite.config.js && npx vite preview --config preview/env.vite.config.js   # production
tools/gpu-lock.sh node preview/env.capture.mjs --out <dir> [--shots m1,m2,...] [--size 1920x1080] [--perf] [--url <bench>]
```

- Views (`?view=`): `m1` (the player's spawn on the plaza, facing east), `m2` (the wall walk over the gate), `walk`,
  `top`, `gate`, `beacon`, `valley`, `m2o4`; the camp: `camp_w`, `camp_e`, `stall`, `campwalk`, `shadow`, `shadow2`,
  `shadow3` (with `pp=x,z`), `banners`, `glance`; the later nights and the ending: `village`, `villagenear`, `portal`,
  `slope`. (These are the bench's own; the game's `?view=` cameras are in `src/view/`.)
- URL: `quality=`, `fire=1` (the fake fire light), `stub=0`, `hue=violet|blue|green|lilac`, `dawn=0..1`, `gate=0..1`,
  `hud=0`, `tone=agx`, `exp=`, `mid=`, `rays=`, `moon=`, `hemi=` (light overrides), `dpr=`, `kindle=1`, `flare=0..1` +
  `vt=<s>` (hold the flare and the vision); `camp=1`, `night=1..10`, `near=<pad>`, `built=0,3`, `pp=x,z` (a fake player
  elsewhere); `rain=0..1`, `storm=1`, `strike=1` (hold a lightning peak), `world=`, `portal=`, `lamp=`, `gateopen=`,
  `village=` (0..1 each), `ending=1&et=<s>` (the ending's clock held at `et`).

**In the real game** (`npm run dev`, `http://127.0.0.1:5350/`): `?night=1..10`, `?camp=1`, `?ending=1`,
`?save=…`, `?gpu=webgpu` (the WebGPU edition), `?look=greybox` (every art module off), `?view=m1|m2|top|troll`;
`__ew.goto('camp'|'night<n>'|'ending')` and `__ew.teleport(x, z, yaw, pitch)`; `window.__ewEnv` and
`window.__ewLook` for live tuning. `npm run shots` captures the m1 / m2 / top / troll views with frame luma
(`--extra gpu=webgpu` for the WebGPU edition); `npm run perf` measures the whole game. `preview/env.game.mjs` (the camp,
the nights, rain and the live ending in the real app through `__ew.goto` and `__ew.teleport`) captures the game; its
header gives the commands. All
browser tools run one at a time under `tools/gpu-lock.sh`.

**Tuning** — where the numbers live:
- Night I's light and fog, the braziers and the beacon: `NIGHT` in `src/env/index.js`; the camp `DUSK`, dawn `DAWN`, rain
  `RAIN` (and the factors in `applyMood()`) there too;
- the ten nights and the ending's palette: `NIGHT_LOOKS` / `WORLD_LOOK` in `src/env/nights.js`;
- the wall fire: `WALLFIRE`, wetness / ash / lava: `ENVFX` in `src/env/materials.js`;
- the portal's place and size: `PORTAL` in `src/env/ending.js`; rain counts and the box: `src/env/weather.js`;
- the moon's size: `MOON_RADIUS` in `src/env/sky.js`;
- the grade: `GRADE` (exposure, mid, rays) and the output pass's uniforms in both looks
  (`src/gfx/webgl2/look.js`, `src/gfx/webgpu/look.js`); bloom levels and ray samples per quality: `Q` there.
