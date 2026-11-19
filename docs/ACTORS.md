# ACTORS · VALLEYWARD — the sprites, the bosses and the viewmodel

Everything that moves and is not fire: the pixel-sprite horde and its death pops, the Ash Troll, the Rainmother, Siege
Rams and Bat Gremlins, pickups and projectiles, Brother Cinder and the two towers at the camp, the ending's crowds and
the demon, and the first-person viewmodel (gloved hands and four weapons). Almost all of it is camera-facing pixel
sprites from one atlas, drawn in **one instanced draw call**.

- Code: `src/actors/` (shared by both editions). The custom shaders live once per edition, under the same factory
  names: `src/gfx/webgl2/materials/actors.js` (GLSL) and `src/gfx/webgpu/materials/actors.js` (TSL); see
  `docs/WEBGPU-PORT.md`.
- Art: `assets-src/sprites/` (prompts, generation jobs, the build pipeline) → `public/assets/sprites/` (the atlas) and
  `public/assets/models/viewmodel/` (six 64×64 textures).
- Bench and tools: `preview/actors.*`.

| File | What |
|---|---|
| `src/actors/index.js` | `createActors()`: loads the atlas table, the atlas and the viewmodel; the public API; the warm-up |
| `src/actors/crowd.js` | the one instanced draw: horde, corpses, troll, bosses, rams, Bat Gremlins, pickups, projectiles, Brother Cinder, Chain Imps and chains, the ending's crowds |
| `src/actors/spriteMaterial.js` | the instanced quad and its three per-instance attributes; the material comes from the active edition |
| `src/actors/atlas.js` | `fetchAtlasJson()` (revalidated), `loadAtlas()` (versioned image, PNG fallback, stand-in), the frame-table texture |
| `src/actors/viewmodel.js` | hands and weapons built in code, their motion, the muzzle socket, the gloves' smoulder and the ending's burning gloves |
| `src/actors/towers.js` | reads the run's towers; the Hellfire Obelisk built in code (the Chain Imp is a sprite in the crowd) |
| `src/actors/telegraph.js` | the Ash Troll's ground warnings: the stomp ring and the thrown boulder's shadow |
| `src/actors/bosslight.js` | the Rainmother's pool of cold light on the ground |
| `assets-src/sprites/sprites.manifest.mjs` | every generation prompt; writes `assets-src/sprites/jobs*.json` |
| `assets-src/sprites/pipeline/build.mjs` | raw sheets → `actors.webp` / `actors.png` / `actors.json`, the viewmodel textures, `provenance.json` |
| `preview/actors.html`, `actors.js` | the bench; `actors.capture.mjs` (captures + perf), `actors.simcheck.mjs` (contract check) |

## Integration

`src/main.js` loads the actors like the other optional modules: if they fail to load, the greybox horde and a greybox
viewmodel stand in. The wiring, in render order:

```js
const actors = await createActors({ scene, camera, quality, assetsBase, renderer });
look.setViewmodel({ scene: actors.viewmodel.scene, camera: actors.viewmodel.camera });  // after the fire, depth cleared
await actors.warm(renderer, camera);              // before control: every program, hidden parts included
// every rendered frame, after the sim steps:
for (const ev of events) actors.onEvent(ev, state);   // before update: hit flashes, death pops, recoil, throws
actors.update(dt, state);                             // sprites, telegraphs, obelisks, the boss light
actors.viewmodel.update(dt, state, motion);           // motion = { bob, sway, recoil, switchT } (src/view/)
fire.lance({ origin: actors.sockets.muzzle(v), … });   // the Lance's flame leaves the drawn nozzle
```

The API: `{ update, onEvent, warm, viewmodel: { scene, camera, organ, update }, sockets: { muzzle }, setLighting,
ending: { set, demonHeight }, stats, crowd, dispose }`.

- **`sockets.muzzle(target)`** projects the current weapon's muzzle through the viewmodel camera (FOV 60) and
  un-projects it through the world camera at about 1.25 × its depth, so a flame or tracer aimed from it starts exactly
  where the nozzle is drawn.
- **`warm()`** (WebGL2) draws the viewmodel with every part visible and not frustum-culled into a 4×4 render target, then
  compiles the world scene with a target bound, so the programs match the variant the look draws (into a target: no
  tone mapping, linear output). The left hand rests at the camera origin, so without `frustumCulled = false` the
  firebomb pot was culled and compiled late. A hidden prototype Obelisk makes it compile the tower programs before the
  first tower is bought. In the WebGPU edition `compileAsync` only walks visible, unculled objects, so the hidden parts
  are shown for the synchronous part of the call.
- **`setLighting({ ambient, moon, tilt, fireGain, maxScreenH, nearFade })`** retunes the sprites' night light and the two
  near-camera limits. Nothing calls it today; the defaults are tuned.
- **`ending.set(t)`** drives the host, the hunt, the demon, Cinder kneeling and the burning gloves from a time instead of
  `state.ending.t` (null: follow the sim). `ending.demonHeight` is 5.4 m.
- **`stats()`** → instances, corpses, telegraphs, obelisks, cap, `atlas: 'generated' | 'stand-in'`.
- `?actorsDebug=1` puts the API (plus the viewmodel) on `window.__ewActors`.

**Events used.** Crowd: `enemy.hit` (flash), `enemy.death` (a death pop), `troll.hurt`, `troll.death`, `douser.throw`,
`hexer.hex`, `chain.throw`, `chain.hook`, `npc.open` / `npc.close` / `npc.line` (Cinder talks), `run.start`, `retry`.
Viewmodel: `weapon.shot`, `weapon.reload` (`seconds`), `weapon.switch`, `bomb.throw`, `lance.on` / `lance.off`,
`weapon.dry`, `player.hurt`, `player.land`, `retry`. Towers: `obelisk.pulse`, `run.start`. A death is also detected
from the slot's state going from alive (1–3) to dying (4) or freed, deduplicated over 0.25 s, so the sim's per-tick
event cap never loses a death pop.

**State read.**
- `horde.{count, x, y, z, vx, vz, kind, state, burn, hp}` (typed arrays, `src/sim/horde.js`): `y` is the absolute feet
  height (ground + pile), state 4 = dying, freed slots are reused.
- `troll.{x, y, z, hp, alive, heat, glowing, action, stage, actionT, actionDur, target}`; `boulders[].{x, y, z, tx, ty,
  tz, t, flight, r}`; `bombs`, `spears` (their `vx, vy, vz` orient the sprite); `pickups[].{kind, x, y, z, id, charm}`
  (y raised to the ground if lower); `splashes` (or `buckets`), `hexes`, `chains`; `air` (Bat Gremlins); `rams`;
  `boss` (the Rainmother); `run.towers` (else `towers`); `mode` (`'camp'`, `'ending'`), `camp.panel`, `ending.{t,
  cinder, village}`; `player.{x, y, z, weapon, vx, vz, yaw, pitch, onGround, firing, fuel, heat, organ | minigun}`.
- The fire light: the sprite shader includes `FIRELIGHT_GLSL` from `src/shared/firelight.js` with the very same uniform
  objects (the fire host in `src/fire/` fills the light map from the active fire module). The viewmodel takes
  `FIRELIGHT.nearCamera` as a warm directional light from below-front.

## How the sprites render

**One draw.** `crowd.js` fills one `InstancedBufferGeometry` (a unit quad, 2 triangles) with three `vec4` instance
attributes, 48 bytes a sprite, and uploads only the live range each frame. Capacity = `HORDE_CAP[quality]` (high 10,000,
medium 6,000, low 3,000) + 384 corpses + about 2,200 extras (pickups, projectiles, chains of up to 36 links, Bat
Gremlins, the troll and its glow layer, rams, bosses, the host's 360 and the hunt's 80). Nothing is allocated in the
frame loop; per-slot constants (scale jitter, tint variant, burn phase) are hashed once per slot.

| Attribute | x | y | z | w |
|---|---|---|---|---|
| `iPos` | feet x | feet y | feet z | scale (< 0: exempt from the melee cap: troll, towers, bosses, the ending) |
| `iA` | frame index | burn 0..1 (< 0: the troll's heat) | hit flash 0..1 (< 0: ember-orange flash) | `sign` = mirror, `floor(abs)` = class, `fract(abs)` = tint variant or hue |
| `iB` | rotation in the billboard plane (rad) | emissive 0..2 | dissolve 0..1 | char 0..1 (corpse to ash; −1: a crack-glow layer) |

**The billboard** (vertex shader). The frame table is a float texture (`frameTable()`): row 0 = the UV rect, row 1 =
size and pivot in metres, read with `texelFetch`. The quad is cylindrical (upright along world up) and tilts 25 % toward
the camera's up (`uTilt` 0.25) so the horde does not flatten when seen from the wall walk.
- **Melee cap** (`uMaxScreenH` 0.5): a sprite whose frame would take more than 50 % of the frame height shrinks about
  its feet, so its screen height stays constant as it comes closer. A grunt reaches the cap at ≈ 1.5 m, a Chieftain with
  its banner at ≈ 2.9 m; far sprites are untouched. Without it a crowd at contact range became a wall of 15–20 px texels
  and two Chieftains towered over the frame.
- **Near dissolve** (`uNearFade` [0.9, 1.9] m): a sprite dithers out between 1.9 m and 0.9 m from the camera, per
  fragment, so nothing sits in the lens.

**The fragment shader.**
- **Mip level by hand:** the shader computes the texel footprint and samples the level where one texel ≈ one screen
  pixel (`textureLod`, nearest texels, levels 0–3). Magnified sprites stay hard-edged, far ones do not shimmer. The atlas
  has 8-px gutters, clean down to level 3.
- **Alpha-tested and depth-writing** (threshold 0.5), so the fire volume composites correctly in front of and behind
  sprites. Dissolves use a 4×4 ordered (Bayer) dither. Scene fog (`fog: true`) applies.
- **Light:** `max(ambient + moon + fire, floor)` with ambient (0.22, 0.33, 0.37), moon (0.15, 0.24, 0.27) and floor
  (0.30, 0.42, 0.46), all linear. `fire` = the fire light map sampled 0.35 × toward the camera (feet lit more than
  heads), × `uSpriteFireGain`, plus `FIRELIGHT.nearCamera` × 0.8 as a front fill within 2.5–9 m of the camera. The fire
  term is soft-compressed (`f / (1 + max(f) × 0.35)`, hue kept), so a sprite beside a burst stays saturated orange
  instead of going pale pink after tone mapping. The albedo is desaturated to 72 % (`uSat`); fire tint and emissive
  are added after it, so burning sprites stay saturated.
- **At the camp** (`state.mode === 'camp'`) the night light blends over 0.8 s to a warm dusk light (`CAMP_LIGHT`).
- **Burning:** a burning goblin is lit from inside through the fire ramp, crimson to orange only (never the white-yellow
  core), flickering. The tint follows `horde.burn` (seconds left, faded over its last 0.6 s).
- **Corpses** shrink and turn to a dark warm-grey ash (luma × 0.34), never a pale grey rug or black. **Hit flash:**
  white ≤ 85 %; on the glowing troll an ember-orange flash instead.

**Sprite classes** (`floor(|iA.w|)`):

| Class | Who | What the shader does |
|---|---|---|
| 1 | every plain sprite | the path above |
| 2 | elites (Chieftain, Hexer) | the gold-rim texels (alpha 204 in the atlas) glow unlit and pulse; within 1.6–4 m and with the near dissolve the rim turns back into the dark outline |
| 3 | the charm pickup | one sprite, 9 hues (`CHARM_HUE`, the hue in `fract`), luma kept, a periodic glint |
| 4 | Brother Cinder, the Chain Imp | near-black art lifted into a warm hue (umber robe, brick-red imp); ember eyes drawn unlit |
| 5 | the ending: the host and the hunt | the host: darkened art with a ≤ 1.25 px red rim on the sides facing the gate's fire; the hunt: solid near-black silhouettes with a thin ember rim facing the burning village (`thinRim`, `uRimSource`), a quarter of the fog, ember eyes on the chasers |
| 6 | the Rainmother | a solid dark-water body (the art's luma as soft relief), foam veins as cold detail, a 2-px cyan rim; the lantern crown glows pale blue × the share of lanterns alive; cold light (`uBossLight`) on every sprite within 12 m |
| 7 | the demon | fire pixels (eyes, mouth, cracks, wing flames) unlit at ×2.2–2.6, a hot orange rim on the upper silhouette, light never below (0.7, 0.5, 0.46) |

`char = −1` draws a **crack-glow layer** (the troll's and the Rainmother's): its seam pixels through crimson → ember →
orange, the eyes amber, as pure emissive, never white.

## What is drawn, and how it animates

**The horde** (kinds from `ENEMY_KINDS`: grunt, imp, spear-chucker, brute, Chieftain, Hexer, Douser). Walk frames advance
from the real ground speed (`vx, vz`) with a stride per kind (`STRIDE`: 0.75–1.25 m a cycle), so feet do not slide;
attack, burn and death frames run on their own clocks (`fps`: walk 8, attack 5, burn 10, death 12). A sprite mirrors
toward its sideways screen motion. A Douser's throw and a Hexer's cast play from the events or from a new `state.hexes`
bolt. A kind with no sheet draws the grunt's frames at its `BODY` height.

**Death pops** live outside the slots, in a pool of 384, because the sim may reuse a slot at once. A corpse plays its 3
death frames (a 0.18 s pop and a hop), then sinks: it shrinks to ≈ 45 % from 0.3 s and dithers out over 0.7–1.8 s
(within 6 m of the camera 0.35–1.0 s, so piles never wall off the lens). A burned corpse chars to ash within 0.4 s.

**The Ash Troll** (7 m). Walk 4, smash / throw / stomp (windup + strike) and death 3. `stage === 'windup'` shows the
windup pose; any other stage of an attack (`recover`) shows the strike. On death the 3 frames play and the heap stays.
Heat 0..1 multiplies the hide toward ember `#e85a1c` and lights the crack layer (a second instance 8 cm toward the
camera) pixel by pixel through the dither; `glowing` lights it fully and pulses it.

**Telegraphs** (`telegraph.js`, one instanced draw of ≤ 8 decals, only while one is up): a red pixel ring (r 5) that fills
from the troll's feet over the stomp windup, and for a thrown boulder a dithered shadow at the landing point, faint in
the throw windup, then shrinking and darkening over the flight inside a dashed red rim. Drawn on the world's 8 px/m
grid, following the terrain (`ewGround`), or flat on the wall walk when the target is up there. A flat decal is
clipped to the wall walk's rectangle: unclipped it hung over the parapet as flat orange 1 m steps. The impact rings and
dust are the fx code's.

**Pickups and projectiles:** gold coins, hearts, XP as a small flickering ember gem, the charm (class 3); firebombs and
boulders spin; spears are rotated to their on-screen velocity; the Douser's water flies as a tumbling bucket, the
Hexer's bolt as a green orb. Pickups bob 0.28 m above the ground (charms 0.42 m). Without `state.splashes` / `hexes`
the actors fly their own from the throw events.

**Bat Gremlins** (`state.air`): flap at ≈ 7 fps, banked ≤ 26° toward their sideways screen velocity; `screech` is the
dive windup, then dive frames, burning wings, a rotating fall and the crashed heap. The soft ground shadow is the fx
code's.

**Siege Rams** (`state.rams`): walk by real speed; the swing windup (`t < 0.7`) then the strike; a burning crew stalls;
the trunk breaks over ≈ 1.2 s.

**The Rainmother** (`state.boss`, 14 m, class 6): rises from the river surface over the sim's rise, walks, winds up and
casts the tide and the whirlpool, climbs, collapses over `deathT`; `cracked` / `heat` open the crack layer like the
troll's. `bosslight.js` adds a terrain-hugging additive disc of blue light (r 11 m, a 22×22 grid on `groundHeight`,
rebuilt when she moves 0.25 m; 1 draw while she lives).

**The camp.** **Brother Cinder** (≈ 1.5 m, class 4) stands 1 m in front of `ARENA.camp.npc`, out of the awning's shadow:
idle 4 (breath, blink, head tilt) at 2.2 fps, talk 2 while a line plays or `camp.panel === 'npc'`; shown only in mode
`'camp'`. **Chain Imp** towers: an imp (class 4) crouched on a perch whose art changes at levels 1–3 (levels 4–5 reuse
the L3 perch, bigger; a second imp at level 5). Perch scale `PERCH_SCALE` 2.0 → 3.2, imp scale `IMP_SCALE` 1.45 → 1.95.
Chains are link sprites plus a hook from the imp's hand to each target, flying, then following the hooked goblin.
**The Hellfire Obelisk** (`towers.js`, 3 draws per tower: stone, core, runes): a black cube-cut basalt needle (a 16-px
pixel-stone texture) on a stepped plinth, a violet core in a chamber under the cap and down its cracks, rune rings. By
level (`LEVEL`): 4.0 / 4.8 / 5.6 / 6.6 / 7.8 m with 1–5 rings. It rises out of the ground over 0.6 s when built or
upgraded; `obelisk.pulse` adds 4.5 to the core's brightness (≈ 0.9 at rest) and 2.6 to the runes' (≈ 0.6) and tints
the stone violet, decaying as e^(−3.2 t). The nova's fire is the fire module's, its flash the fx code's.

**The ending** (mode `'ending'`, beats from `TIMELINE.ending` in `src/shared/timeline.js`):
- **host** (18 s): 30 ranks of 12 march out of the gate at 1.7 m/s and fan out down the slope (class 5); within 4–9 m of
  the lens they dither out.
- **gloves** (25 s): see the viewmodel.
- **reveal** (29 s) and **roar** (34 s): the demon (≈ 5.4 m, class 7) at the player's spot: breathing, the head lift,
  the roar (drawn ×1.06).
- **cinder** (37 s): Brother Cinder kneels at `state.ending.cinder`, else the wall's foot below the player.
- **hunt** (from 1 s before 42 s to the cut at 50 s): 44 fleeing figures (24 villagers, 6 deer, 4 boars, 10 birds) start
  among and behind the huts of `ARENA.village` and run toward its `forest`; 36 horned chasers start 16–24 m behind and
  run slower (2.9 vs ≥ 3.1 m/s), so the gap only grows and nobody is caught. Prey ×1.7, chasers ×1.6; every hunt
  sprite dithers out within 6–12 m of the lens.

## The viewmodel

Its own scene and camera (FOV 60, near 0.01); the look draws it after the fire with the depth cleared, and its depth
doubles as the mask that keeps god rays off the hands. Everything is built in code from boxes and tubes, Lambert
materials with flat shading and the six 64×64 nearest-filtered textures (`leather`, `brass`, `iron`, `wood`, `cloth`,
`strap`; a procedural pixel-noise stand-in if one fails to load). Static meshes are merged by material per weapon and per
glove (`bake()`); animated parts stay separate.

- **Weapons** (sim ids → drawn): `pistol` → the Kestrel flintlock, `blunderbuss`, `lance` → the Ember Lance, and
  `organ` / `minigun` / `thunder` → the THUNDER ORGAN (slot 2 once bought).
- **The Ember Lance** is compact (the brass tank under the rear half of the barrel), held low right with the barrel near
  the view axis (pose (0.245, −0.17, −0.2), yaw 10°, pitch 1°): perspective draws it from the bottom-right corner toward
  the crosshair, the nozzle lands at ≈ 58 % x / 62 % y and the screen centre stays clear. Its metal is the iron texture
  tinted warm bronze (× (1.3, 0.72, 0.34)); a pilot flame (blue core, orange tip) burns on top. The left glove holds the
  front grip; the right hand holds the rear grip just below the frame.
- **The Organ:** six brass barrels on a rotor around an iron axle, a receiver, a side drum, twin grips and a hand crank.
  The rotor spins with `player.organ.spin` (3 rev/s at full = 18 rounds/s from six barrels; its own spin-up 0.45 s and
  spin-down 0.9 s when the sim gives none), the crank at half speed; a shot shakes instead of kicking. The barrels glow
  with heat: nothing below 35 %, dull red past ≈ 60 %, yellow-white and pulsing while overheated.
- **Motion:** idle sway, walk bob, recoil on `weapon.shot`, reload (the left hand to the muzzle), the left-hand firebomb
  throw, the Lance's spray shake, landing and hurt kicks. A weapon switch lowers (0.16 s), swaps and raises (0.22 s) on
  its own when `player.weapon` changes; the motion's `switchT` lowers the hands further. The motion values from
  `src/view/` are layered on top.
- **Lights** (a constant set): a grey-cool hemisphere fill, a moon, a fill from behind the camera, the fire around the
  player (`FIRELIGHT.nearCamera`, ≤ 4) and a warm point light at the nozzle. No saturated cyan: it turned the brown
  leather olive and the iron blue in the graded frame. Warm light reaches the hands only from the pilot flame, the
  nozzle and the fire around the player.
- **The gloves smoulder** while the Lance sprays (full) or the player stands in fire (`nearCamera` > 0.6: up to 55 %):
  thin ember seams at the fingertips, the knuckle strap, the back of the hand and the cuff, drawn additively, and
  ≈ 10 pixel sparks a second; they cool over ≈ 1.5 s and are hidden (0 draws) when cold.
- **The ending's gloves** (from 1 s before the `gloves` beat): the weapon goes, both hands rise into the lower middle of
  the frame (NDC y ≈ −0.35), fingers up; flames lick up from the gloves (9 additive cones per hand, a warm point light
  between them), the gloves char to near-black in ≈ 0.7 s with glowing seams, and black claws grow out from 45 % of the
  1.5 s burn. Only the glove materials char. The hands are hidden from the `reveal` beat (the lens leaves the head).

## The two editions

All of `src/actors/` is shared. The four custom materials come from the active shading layer through `gfx()`
(`docs/WEBGPU-PORT.md`): `actorSpriteMaterial`, `actorTelegraphMaterial`, `actorBossLightMaterial` and
`actorSparkPoints`, each with the same uniform names in GLSL (`src/gfx/webgl2/materials/actors.js`, the original shaders
moved verbatim) and TSL (`src/gfx/webgpu/materials/actors.js`). The viewmodel uses built-in materials, which both
renderers convert. Differences by construction in the WebGPU edition: tone mapping and the output colour space are the
renderer's, so fog mixes in before them (the same result in a render target); the dither's 4×4 grid starts at the top
left, so it is mirrored in y; the glove sparks are 3-px instanced sprites, since WebGPU points are always one pixel.
A same-seed bench A/B of every sprite class matched when the edition was ported (2026-11-18).

## Atlas

`public/assets/sprites/actors.json` describes `actors.webp` (and its pixel-identical fallback `actors.png`):

```
{ version: 3, image: 'actors.webp', hash, fallback: { image: 'actors.png', hash }, vm: { leather: hash, … },
  width, height, troll: 'fine' | 'base', frames: [{ n, x, y, w, h, ax, ay, ppm }], kinds, fps }
```

- `frames`: pixel rects (top-left origin); pivot `ax` from the left and `ay` from the bottom (the feet = 0; items and the
  Bat Gremlin pivot at their centre); `ppm` = pixels per metre. Names are `<kind>.<anim>.<i>` (`grunt.walk.0`), glow
  layers `<frame>.glow`, items `item.<name>`.
- `kinds`: frame indices per animation. Goblin kinds `{ walk[4], attack[2], burn[2], death[3] }` (the Chieftain, Hexer
  and Douser add `cast = throw = attack` and `elite`); `troll` and `rainmother` add `glow: { frame → glowFrame }`;
  `chainimp` adds `perch[3]` and `perchTop[3]` (metres); `items` maps names to single frames. The other kinds:
  `cinder`, `cinderk`, `batgremlin`, `ram`, `demon`, `host`, `villagers`, `animals`.
- `hash` / `fallback.hash` / `vm`: content hashes (below).
- The atlas today (2026-11-18): 2048×2048, 212 frames, 455 distinct RGBA colours; `actors.webp` ≈ 0.60 MB,
  `actors.png` ≈ 0.95 MB. The viewmodel textures are 4–7 KB each.
- **The stand-in atlas** (`atlas.js` `standInAtlas()`): coloured pixel cards in the same schema, drawn on a canvas when
  the table or the image cannot load, so the module always works (bench: `?assets=bad`).

Sizes in the world (frame heights from the current atlas):

| Kind | Walk / idle frame | Pixels per metre | Height |
|---|---|---|---|
| grunt | 44 px | 37.0 | 1.19 m incl. the ears (`BODY` 1.1) |
| imp | 48 px | 56.5 | 0.85 m |
| spear-chucker | 48 px | 32.8 | 1.46 m incl. the spear bundle (`BODY` 1.2) |
| brute | 53 px | 27.9 | 1.9 m |
| Chieftain (elite) | 76 px | 32.3 | 2.35 m with the banner (`BODY` 1.7) |
| Hexer (elite) | 58 px | 34.1 | 1.7 m with the staff (`BODY` 1.3) |
| Douser | 42 px | 36.5 | 1.15 m |
| Bat Gremlin | 36 px | 36.0 | 1.0 m (the glider ≈ 2.4 m wide) |
| Siege Ram | 52 px | 20.0 | 2.6 m (the crew's goblins grunt-sized) |
| Ash Troll | 160 px | 22.9 | 7.0 m |
| Rainmother | 210 px | 15.0 | 14 m |
| demon | 300 px | 55.6 | 5.4 m |
| host / villagers / animals | 46 / 40 / 48 px | 24.2 / 34.8 / 30.0 | 1.9 / 1.15 / 1.6 m |
| Brother Cinder / kneeling | 50 / 38 px | 35.7 / 36.2 | 1.4 m (drawn × 1.07) / 1.05 m |
| Chain Imp | 30 px | 38.5 | 0.78 m (drawn × 1.45–1.95 by level) |

Items, by their longest side: XP gem 0.32 m, coin 0.28 m, heart 0.32 m, spear 1.7 m, boulder 1.3 m, firebomb 0.5 m,
charm 0.34 m, ember 0.3 m, bucket 0.7 m, hex orb 0.55 m, hook 0.55 m, chain link 0.7 m.

## Art pipeline

**Generation.** The sprite sheets and the viewmodel swatch sheet were generated with the Codex CLI's image generation
from the prompts in `assets-src/sprites/sprites.manifest.mjs`, which writes the batch files
`assets-src/sprites/jobs*.json` (the generator itself is not in this repo: a job file is `{ id, prompt, out, aspect, refs }`, so any image generator can run it). Raw sheets land in `assets-src/sprites/raw/*.png` (gitignored binaries) with a
`.png.json` sidecar each. The pipeline turns them into the shipped files, and each shipped file's prompts and inputs are
recorded in the `provenance.json` next to it (`public/assets/sprites/`, `public/assets/models/`).

**References.** Prompts describe the style in words. The first sheets (grunt, imp, spear, brute, items, the two trolls,
the Rainmother) and the viewmodel swatch sheet are text-only. A later sheet may attach one of our own sheets as a style
reference so it matches the atlas: the fine trolls their base sheet, most later goblin and creature sheets the grunt,
`items2` the items, the demon `trollA_fine`, and Brother Cinder's kneeling pose `cinder`. No outside image is ever
attached; every sheet was regenerated this way on 2026-11-18.

```bash
node assets-src/sprites/sprites.manifest.mjs                              # writes the jobs*.json
# generate each job in jobs*.json into its `out` path (assets-src/sprites/raw/), with any image generator
node assets-src/sprites/pipeline/build.mjs                                # raw sheets → atlas, table, textures, provenance
```

**What a sheet must look like** (the prompts ask for it; the pipeline depends on it): one character per sheet, frames in
rows on flat magenta `#FF00FF`, true low-resolution pixel art with hard edges and no anti-aliasing, a dark outline, a
muted palette, front-facing (the host, villagers and animals in side view), feet on a common baseline per row.

| Sheet(s) | Rows | Frames | Scale (frame height → metres) |
|---|---|---|---|
| `grunt`, `imp`, `spear`, `brute` | 4 / 4 / 3 | walk 4, attack 2, burn 2, death 3 | one shared grid: the grunt's walk = 44 px (`GOBLIN_PX`) |
| `trollA` + `trollB` (`_fine` preferred) | 4 / 3 and 3 / 3 | A: walk 4, death 3; B: smash, throw, stomp (windup + strike) | walk = 160 px for 7 m (`TROLL_PX`; 56 px with the base sheets) |
| `chief`, `hexer`, `douser` | 4 / 4 / 3 | the goblin layout | 76 px / 2.35 m, 58 / 1.7, 42 / 1.15 (`V2`) |
| `batgremlin`, `ram` | 4 / 4 / 3 | fly 4, dive 2, burn 2, death 3; walk 4, swing 2, burn 2, broken 3 | 36 / 1.0; 52 / 2.6 |
| `rainA` + `rainB` | 4 / 4 / 3 and 2 / 2 | A: walk 4, rise 2, climb 2, collapse 3; B: tide 2, whirl 2 | 210 px for 14 m |
| `cinder`, `cinderk` | 4 / 2; 2 | idle 4, talk 2; kneel 2 | 50 / 1.4; 38 / 1.05 |
| `chainimp` | 5 / 3 | idle 2, throw 3 (windup, release, pull); perches L1–L3 | the imp 30 px / 0.78 m |
| `demon`, `host`, `villagers`, `animals` | 2 / 2; 4 / 4; 3 / 3 / 3; 3 / 3 / 2 | see the atlas kinds | 300 / 5.4; 46 / 1.9; 40 / 1.15; 48 / 1.6 |
| `items`, `items2` | 3 / 3 each | 6 + 6 items | each by its longest side (sizes above) |
| `vmtex` | 3 / 3 | 6 texture swatches | cropped and resized to 64×64 |

**The build** (`build.mjs`, Node + sharp, deterministic, a few seconds):
1. **Key the magenta**, including the pink anti-aliased fringe the generator leaves at edges (`isBg`); drop isolated
   specks.
2. **Split frames:** 8-connected components; the N largest are the frames, and smaller detached parts (a dropped club,
   flames, dust) join the nearest frame. Frames are ordered into rows by centre y, then by x. If the components do not
   give N frames of comparable size, projection runs per row are used instead.
3. **One palette per sheet:** seeded k-means on the figure pixels (20–26 colours; the troll's and the Rainmother's two
   sheets share one), magenta-like entries removed.
4. **Majority-vote downscale** of palette indices to the sprite's real resolution, over the inner 80 % of each target
   pixel's footprint. Transparent wins only with > 62 % of the votes, which keeps thin outlines and spear shafts. No
   blur: the pixels stay hard.
5. **Outline:** a 1-px dark outline (`OUTLINE` rgb 26, 20, 24) wherever the silhouette edge is not already dark; trim.
6. **Pivot:** x at the centroid of the torso band (35–75 % of the height), y at the feet.
7. **Glow layers** for the troll and the Rainmother: a second frame per pose holding the darkest 16 % of interior pixels
   (two pixels in from the edge, brown cloth and wood excluded) and the eyes, coloured by seam thickness from ember to
   amber.
8. **Elite rim** for the Chieftain and the Hexer: a 1-px gold ring outside the outline at alpha 204, which the shader
   recognises and lights.
9. **Pack:** shelf-pack by height into the smallest power-of-two atlas that fits (up to 2048²), 8-px-aligned cells with
   8-px gutters, so mip levels 0–3 never bleed between frames. Transparent texels carry the outline colour, so mip
   averaging darkens edges instead of fringing magenta or black.
10. **Write** `actors.webp` (lossless, `exact`, effort 6) and `actors.png` (zlib 9, no row filters), decode both and
    compare them byte for byte with the source pixels (the build fails otherwise); write `actors.json` with the hashes,
    `provenance.json`, and a ×2 contact sheet to a scratch path (`--contact <png>`).

**The viewmodel textures:** the `vmtex` sheet's six swatches are cropped (1.5 % inset), resized to 64×64 and re-toned by
`VM_GRADE`: each keeps its own luminance pattern on a muted mean colour (leather `#503e34`, strap `#3c2e28`, wood
`#46372c`, dull brass `#7e663e`, iron `#54585e`, cloth `#4a4c3e`); `k` < 1 flattens the pattern's contrast and `keep`
keeps a little of the original hue. Generated swatches came out saturated (orange-veined leather and wood that read as
lava marbling up close), so the re-tone is part of the pipeline, not a one-off edit.

**Flags:** `--troll fine|base` (which troll sheets), `--vm-only` (re-tone the viewmodel textures only; the atlas stays
byte-identical), `--hash-only` (re-stamp the hashes in `actors.json`), `--reencode` (re-encode the current atlas pixels
to WebP + PNG without re-packing), `--contact <png>`.

**Content-hash versioning.** `actors.json` names every shipped image by the first 10 hex digits of its SHA-1: `hash`
(the WebP), `fallback.hash` (the PNG) and `vm.<name>` (each viewmodel texture). The runtime fetches the table with
`cache: 'no-cache'`, then loads `actors.webp?v=<hash>` (if it fails to decode, `actors.png?v=<hash>`, then the stand-in)
and `models/viewmodel/<name>.png?v=<hash>`. This exists because a browser once kept a force-cached old table while
loading a re-packed atlas, and every frame rect fell across two sprites ("the goblin model is cut in the middle of 2
models"). `preview/actors.simcheck.mjs` fails if any actors loader force-caches or a hash does not match its file.

**Lossless WebP plus a PNG fallback.** The atlas has more than 256 distinct RGBA colours (a palette per sheet, the glow
layers, the rim's alpha 204), so an indexed PNG cannot be exact. Measured on the previous atlas (2026-11-14, every
encoding decoded back and compared byte for byte): PNG with adaptive row filters 1,764,118 B; the same PNG without row
filters 902,290 B (−49 %: pixel art compresses better unfiltered); lossless WebP 569,072 B (−68 %). `exact` matters:
without it libwebp may rewrite the RGB under alpha 0, which carries the outline colour for clean mip levels.

## Performance

Measured on a production build of the bench (`preview/actors.vite.config.js`), 1920×1080, DPR 1, headless Chrome
(ANGLE Metal) on an Apple M4, uncapped frame rate, 2026-11-13/14. The bench world is a greybox; draw calls count the
whole bench frame, viewmodel included.

| What | 2,500 sprites | 6,000 | 10,000 |
|---|---|---|---|
| `crowd.update`, Node, a synthetic walking horde | 0.041 ms | 0.107 ms | 0.25 ms |
| instance data uploaded per frame (48 B a sprite) | 120 KB | 288 KB | 480 KB |
| bench frame, avg / p95 | 1.54 / 2.5 ms | 1.82 / 2.6 ms | 1.08 / 1.2 ms |
| `actors.update` + `viewmodel.update`, avg | 0.038 ms | 0.095 ms | 0.152 ms |

- **GPU:** the WebGL2 timer query (`?gpu=1`) has a floor of ≈ 1.3–1.5 ms on ANGLE/Metal that does not shrink with 64
  instances, so its readings are an upper bound. The marginal cost of 2,500 sprites was within its noise, and the
  uncapped frame did not rise (1.50–1.68 ms with 2,500 against 1.68 ms with 64).
- **Contract check** (Node, the real sim and bot for a 260 s night, seed 3, 2026-11-18): `crowd.update` 0.016 ms avg,
  p95 0.049 ms, ≤ 520 instances, 0 bad instances.
- **The ending's host and hunt** add ≈ 0.03 ms of CPU a frame and 0 draws (≤ 440 more instances in the same draw).
- **In the real game** (production build, everything loaded, vsync on, the same machine, 2026-11-13): 60 fps held
  (p95 16.7–16.8 ms) with 178–780 goblins and all six towers; the whole frame 91–104 draw calls; 0 console errors.
- **Draw calls:** the sprites are 1 draw (2 triangles each). Telegraphs 1 while one is up; the boss light 1 while the
  Rainmother lives; 3 per Obelisk (≤ 18 with six). The viewmodel alone: Kestrel 4, Blunderbuss 8, Ember Lance 10
  (204 / 320 / 660 triangles); the Organ: its merged static parts + the rotor (2) + the crank (1). The smouldering gloves
  add a seam draw and a spark draw per visible glove; the ending's burning gloves ≤ 18 draws for ≈ 3 s.
- **Shader compiles:** after `warm()`, the first firebomb, the first stomp telegraph and the first Lance draw compile
  nothing new (production build, 2026-11-13).
- Not measured: shimmer in motion (the mip selection is designed against it), and either edition's sprite cost on the
  GPU beyond the timer floor. The WebGPU edition's frame time is not measured yet.

## Decisions

- **One draw for everything sprite-like**, the troll and the bosses included (a second instance for a glow layer). It is
  cheaper than separate draws and keeps one shader.
- **The red-hot glow is pixel art, not a blend:** opaque hot pixels in a separate frame, revealed by heat through the
  ordered dither. It stays alpha-tested, so it writes depth like everything else.
- **Never white on a big sprite:** the troll's hit flash is ember-orange while it glows and its cracks stop at amber. A
  7 m sprite under gunfire washed out to pale pink with white flashes.
- **One art grid for the first goblins** (the grunt's walk = 44 px), so bigger goblins have coarser pixels per metre,
  like big sprites in classic pixel games; later kinds are scaled so their pixels match that density.
- **Sprites tilt 25 % toward the camera's up** (seen from the wall walk the horde otherwise flattens).
- **Near-camera limits** (the 50 % screen cap, the 0.9–1.9 m dissolve, corpses gone within ≈ 1 s near the lens): a horde
  on the player must stay readable, never fill the lens.
- **A light floor** and the fire around the player as a front fill: near sprites rendered black without them.
- **No sprite shadows:** a pixel-sprite look without them, and the budget.
- **The camp's characters get their own class** (class 4) and the dusk light: at dusk they read as black
  silhouettes otherwise.
- **The hunt's runners are solid black with a thin registered rim**, a quarter of the fog: darkened art disappeared into
  the night while its light parts stayed as grey patches, and a texel-wide rim drawn at the crane's magnification read
  as a hollow gold scribble beside its fill.
- **The demon is a billboard** like every sprite: the cinema's low frontal angle is the intended view.
- **Every image is content-hashed and the table revalidated** (the cut-goblin cache bug above).

## Open issues

1. **No actors tests in `npm test`.** `node preview/actors.simcheck.mjs` is the contract check (exit 0 = PASS; it
   passed on 2026-11-18). It could be wired into `npm test`.
2. **A pale wash near the Rainmother** on the ground in her phases 2–3 was reported after her boss light and the cold
   sprite light landed; the cause was never confirmed (unverified). Suspects: `bosslight.js`, the 12 m cold light
   (`uBossLight`), or steam and storm fog.
3. **The Rainmother reads small from the wall walk** in The Climb (≈ 11 % of the frame at z ≈ 41 m in a 2026-11-14
   capture). A larger share needs the sim's staging (a closer approach), not a sprite change.
4. **Seen in stills only:** shimmer at distance, the walk cycle against the ground speed, the viewmodel's bob, sway and
   recoil timing, the chains' flight and pull, the gloves' sparks.
5. **The troll's poses depend on `stage`:** `windup` shows the windup, anything else the strike. If the sim adds stages,
   map them in `crowd.js`.
6. **Goblins hit by fire but not yet alight** (`burn` 0) show no burn tint; the fire light map lights them anyway.
7. **The Douser's water is drawn as the thrown bucket** (`fBucket` in `crowd.js`); swap the sprite if only water should
   leave the bucket.
8. **Stale comments:** `towers.js`'s header gives the old needle heights (3.6 / 4.3 / 5.0 m; `LEVEL` is right), and
   the bench's `hunt` view comment names an old village position. `sprites.manifest.mjs` says its prompts are logged
   here; they live only in the manifest and the provenance files.

## How to see and test it

**The bench** (`preview/actors.html`): a fake horde of up to 2,500 goblins (`?n=` up to 20,000) flowing up a slope to a
gate, a fake fire light map, the troll cycling its moves, pickups, projectiles and the viewmodel.

```bash
npx vite --config vite.config.js --port 5355 --strictPort    # → http://127.0.0.1:5355/preview/actors.html
npx vite build --config preview/actors.vite.config.js        # production build of the bench (scratch output folder)
tools/gpu-lock.sh node preview/actors.capture.mjs [--perf] [--only a,b] [--w2|--w3|--w4|--f7] [--out <dir>]
node preview/actors.simcheck.mjs [seed]                      # contract check, no GPU: PASS / FAIL
```

- Buttons: view, burn 300, kill 200, hit flash, troll glow / move / dies, weapon, shoot, auto fire, reload, throw bomb,
  spray (lance), walk bob, fire light, motion, kills, camp, npc talk; stats top right. `window.__bench` = `{ ready,
  stats(), set({…}), step(n) }` for capture tools.
- Views (`?view=`): `m1`, `close`, `far`, `wall`, `troll`, `camp`, `banner`, `towers`, `crowd2`, `lineup`, `air`,
  `rain`, `ramv`, `reveal`, `hostv`, `hunt`.
- URL: `n`, `seed`, `quality`, `weapon=pistol|blunderbuss|lance|organ`, `spray=1`, `burn=1`, `glow=1`, `troll=<action>`,
  `fire=0`, `freeze=1` (no motion: stable captures), `noui=1`, `vmonly=1` (the viewmodel alone on grey), `marker=1` (a
  magenta ring at `sockets.muzzle()`), `gpu=1` (the WebGL2 GPU timer), `assets=bad` (the stand-ins), `dpr=`;
  `v2=1` (Chieftains, Hexers, Dousers and their throws, charm and XP drops), `towers=1|line`, `camp=1`, `talk=1`;
  `air=<n>`, `airburn=1`, `ram=<n>`, `ramburn=1`, `boss=1` (+ `bossmode=`, `bx=`, `bz=`, `lanterns=`, `crack=1`,
  `bossdead=1`), `ending=<s>`, `heat=`, `over=1`, `clear=`.
- `?edition=webgpu` runs the bench in the WebGPU edition (WebGPURenderer and the TSL materials) for side-by-side
  captures with the default WebGL2 edition at the same seed and view.

**In the real game** (`npm run dev`, `http://127.0.0.1:5350/`): `?gpu=webgpu` for the other edition; `?night=1..10`,
`?save=fresh|mid|rich|late|endgame` (`rich` owns the Organ), `?camp=1`, `?ending=1`, `?cap=<n>`, `?god=1`,
`?look=greybox` (every art module off), `?actorsDebug=1`; `__ew.spawn(kind, n, x, z)`, `__ew.troll()`,
`__ew.goto('camp'|'night<n>'|'ending')`, `__ew.pose(…)`; `npm run shots` (add `--extra gpu=webgpu` for the WebGPU
edition). The older targeted capture scripts in `preview/` (`actors.game`, `.r1`, `.melee`, `.camp`, `.w2game`,
`.w3game`, `.w4game`, `.v6`, `.f11`) each build the game and capture one situation in it; their headers give the
commands. All browser tools run one at a time under `tools/gpu-lock.sh`.

**Tuning** — where the numbers live:
- the sprite light, saturation, tilt and near limits: the uniforms' defaults in `actorSpriteMaterial()` (both
  editions), or `actors.setLighting()` at run time;
- the camp's light `CAMP_LIGHT`, strides `STRIDE`, corpse life `CORPSE_LIFE` / `CORPSE_NEAR`, Cinder `CINDER`, the Chain
  Imp `IMP_SCALE` / `PERCH_SCALE` / `PERCH_TOP`, charm hues `CHARM_HUE`: `src/actors/crowd.js`;
- the Obelisk's heights, rings and pulse: `LEVEL` and `update()` in `src/actors/towers.js`;
- the viewmodel's poses, lights, `LIFT` and timings: `src/actors/viewmodel.js`;
- sprite sizes and palettes: `GOBLIN_PX`, `TROLL_PX`, `VIS`, `V2`, `RAIN_PX` and the item specs in
  `assets-src/sprites/pipeline/build.mjs` (re-run the build).
