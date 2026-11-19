# ART-DIRECTION · VALLEYWARD

The art bible, drawn from the four key-art mockups (2026-11-13). Open the mockups before you make anything whose style
matters:
`docs/mockups/M1_smooth.jpg`, `M1_hybrid.jpg` (on the plaza, facing east along the wall: the Lance into the road
column) and `M2_smooth.jpg`, `M2_hybrid.jpg` (from the wall walk: the mound at the gate, the trough fire, the beacon).
They are Codex key art, not renders: match their look, palette and density, not every pixel.

## 1. The look in one line
A retro pixel-textured world (chunky cube-cut stone and timber, nearest-filtered 16–32 texels per metre, low-poly
pines) and thousands of flat pixel-sprite goblins under one cold teal night with a huge cyan-white moon, lit by modern
light (moon shafts, fog layers, bloom, grade), where **the fire is the only warm thing**: a live fluid that curls,
pools and lights everything around it.

## 2. Palette (sampled from M1_smooth pixels, sRGB)
| Role | Hex | Notes |
|---|---|---|
| sky (zenith side) | `#184255` | deep teal; darker toward the top, never black |
| sky near the moon | `#255b71` | a wide soft halo |
| moon | `#9ee1e9` | cyan-white disc, faint craters, bloom halo |
| far mountains | `#164057` | flat silhouettes, aerial perspective |
| valley fog / pines | `#2c5168` / `#2d5268` | fog lifts the pines toward the sky colour with distance |
| stone, lit by fire | `#7b4233` | the same stone unlit is slate `#3a4652`–`#4a5560` |
| road earth, lit by fire | `#934833` | unlit earth `#3b3a34` |
| fire body / core | `#e36a25` / `#ea8a32` → core `#fff2b8` | white-yellow core, orange body, crimson edge `#a3241a` |
| smoke | `#312526` | charcoal-brown, lit orange from below near fire |
| goblin skin (unlit) | olive `#6f7a3a`, imp red `#a3352a` | muted; burning sprites go orange-red |
Frame mean luma of M1 ≈ **0.27**: the game frame must not be darker than that (check with a capture).

## 3. Colour rules (hard)
1. Warm colours (white-yellow, orange, crimson) belong **only** to fire, embers, braziers, the beacon, muzzle flashes and
   the Lance's pilot flame. Nothing else is saturated warm (no orange banners, no red UI outside the HP bar).
2. The night is cool: teal, indigo, slate, grey-green. Fire-lit surfaces turn warm only through the fire light map.
3. Goblins stay muted (olive, ochre-grey, imp brick-red) until they burn.
4. XP gems: cool cyan-white sparkle (reads against fire); gold: pale yellow pixel coins (small).
5. **The camp and Night II (DESIGN §9.2, §8.1, §11.5).** Three exceptions, each deliberate: (a) **the camp at dusk** has a low amber sun in
   the west-south-west (`ARENA.camp.sunDir`, sun `#ffbf8e`), an amber band on the western horizon (`#e48a4c`) fading to
   teal in the east (`#4d7482`) under a deep blue zenith (`#2a4d68`), a lavender sky fill and long shadows; (b) **Night
   II's blood moon** (`#e3261a` disc, `#6a2422` halo; the sky a touch more indigo, `#212f48`; moonlight lavender-grey
   `#a9a8c6`, never orange on the ground); (c) **coloured fire** (violet, blue, green, lilac) only as fire and its light.
   The build pads' rune circles glow ember-orange (they are burnt into the ground: fire). Banners: bone cloth with a
   charcoal lamp crossed by a dark crimson slash (small, muted). The materials and the grade never push a fire light
   toward orange: the slate tint sits on the moon / sky light only (`lightTint`), and the grade's warm highlight push
   skips saturated non-warm pixels.
6. **Nights III–X and the ending (DESIGN §8.1, §8.3, §12).** (a) **The ten moons** redden night by night: teal-white, blood `#e3261a`, rust
   `#c8561c`, crimson `#d21a2c`, dark red `#a01410`, red-violet `#c01e5e`, violet `#8c2ed6`, deep red `#8e0a0a`,
   black-red `#5e0808`, and Night X a black disc with a ragged red corona; the sky, fog and moonlight darken and warm a
   little each night (`src/env/nights.js`). (b) **Rain** is cool and grey: pale grey-blue streaks, small pixel splash
   crowns, a wet Fresnel sheen that mirrors the sky and the fire light, a low overcast; lightning is a cold white-blue.
   (c) **The ending** is the one place warm colour takes the whole frame: a red-black grade (luminance to red, darks to
   black, fire stays bright), a black moon with a red corona, charcoal pines with crawling embers, ash-grey grass, pixel
   lava cracks (white-yellow cores, orange bodies) along a few rifts, embers falling like snow, the portal's ring of fire
   with a black-red eye, and the lamp's black-core crimson pillar. (d) **The goblin village** is muted straw, clay and
   timber with small warm lantern windows (fire); it burns orange only in the hunt.

## 4. Light
- Moon key from `ARENA.moonDir` (east-south-east, low): cool `#9fd3e0`, soft shadows on the plaza and wall; god rays
  through the fog when looking toward the moon.
- Hemisphere fill: sky `#2a5a6e`, ground `#1a2224`, low intensity, so unlit stone keeps readable shapes.
- Fire light: the shared light map (`src/shared/firelight.js`) on every world material and sprite; the braziers and
  the beacon add a few real point lights (constant count).
- Post: bloom on truly bright pixels (fire core, moon), a grade with calm darks and warm highlights, soft vignette.

## 5. Materials and textures
- Pixel textures: 32×32 or 64×64 texel tiles (stone blocks, timber, earth, grass, roof slate), `NearestFilter` for
  magnification, mip-mapped minification (no shimmer), 16–32 texels per metre. Vertex AO / corner darkening is fine.
- Shading: Lambert (or Standard at roughness 1) with the pixel textures; no gloss, no rim glow.
- Geometry: chunky blocks with slight random offsets per block (cube-cut stone like M1/M2's walls), timber posts with
  pointed tops, low-poly cone pines in layers.

## 6. Sprites
- Goblins, imps, spear-chuckers, brutes and the troll: 2D pixel art, ≈ 32–48 px tall per goblin (troll ≈ 160 px),
  1–2 px dark outline, 4-frame walk, 2-frame attack, 2-frame burn (on fire, running), 3-frame death; camera-facing
  (cylindrical billboards), alpha-tested (they write depth so the fire volume sits right).
- They receive moonlight (flat, from their front) and the fire light map; burning ones are tinted toward the fire ramp.

## 7. Fire (Firewraith's `classic` module; see DESIGN §11.6)
- `smooth`: M1_smooth / M2_smooth: soft, painterly, fine filaments, marbled eddies.
- `hybrid`: M2_hybrid: the same curls on a coarse pixel grid with a stepped 6-colour ramp
  (`#fff2b8`, `#ffd24a`, `#ff9a2e`, `#e85a1c`, `#a3241a`, `#4a1612`) and ordered dither at the borders.
- Smoke rolls and lingers but thins near the camera; embers drift up and along the flow.

## 8. UI
- Pixel font (e.g. Google Fonts "Silkscreen" or "Pixelify Sans"), white with a dark outline, small, at the edges only:
  top-centre "NIGHT I  03:12" + a thin wave/dawn bar; top-left a thin gold XP bar and "LV 4"; bottom-left a red health
  bar with the number; bottom-right the weapon name over its ammo or fuel gauge; a small gate HP bar under the clock;
  the beacon prompt "E · KINDLE THE BEACON" near the pan; level-up cards as dark slate panels with pixel icons.
- The M1_hybrid HUD (pixel-styled bars) is the closer target.

## 9. Avoid
Photoreal textures or PBR scan sets; smooth bilinear-blurred pixel textures; cartoon flame sprites standing in for the
fluid; black, crushed nights; warm colours outside the fire rules; orange UI; text inside the 3D world; a frame darker
or greyer than M1.

## 10. Environment decisions (2026-11-13, the first build)
- **Textures:** 10 Codex pixel tiles (`public/assets/tex/`: stone, blocks, flag, timber, earth, road, grass, roof, iron,
  pine), box-downsampled to 64² (iron, pine 32²), 10–14-colour palettes, lossless WebP, **16 texels per metre**
  (one 64-px tile = 4 m), `NearestFilter` up close, trilinear mip-maps far away. Their pixels ARE the unlit colours of
  §2 (slate, unlit earth, pine teal); the light brings them back to about their own value and the grade makes it night.
- **Cube-cut walls are geometry, not texture:** every visible block is its own box (0.5–0.8 m courses, 0.7–1.5 m long,
  up to 7 cm proud, ±15 % tone) over a dark core, so joints are real shadow lines; a one-texel pixel bevel (light top
  and left edge, dark bottom and right edge) sells the chunky cut. The `blocks` tile is kept for flat far surfaces.
- **Light:** moon key `#9fd3e0` at intensity 7 from `ARENA.moonDir` (2048 shadow map, ±30 m frustum following the camera,
  shadows at 65 % so nothing goes black), hemisphere sky (0.55, 0.8, 0.95) / ground (0.25, 0.3, 0.3) at 3.6, braziers
  `#ff8a3a` ×4 and the beacon `#ff9440` as the only point lights (constant count 5). Fire light comes through
  `patchFireLight` on every Lambert material, the oil and the terrain.
- **Sky:** one dome shader: zenith `#0d2a38` → `#184255` → horizon `#2c5168`, halo `#2f6a80`, the moon `#9ee1e9`
  ×2.3 (HDR, so it blooms) 12° across and pixelated on a 60-px grid, faint fanned rays below it, thin moonlit clouds,
  sparse stars, three mountain ridges `#1f4659` / `#173a4c` / `#11303f` with moon-side rims and snow on the far ridge.
- **Timber** tile desaturated (×0.62) and darkened (×0.92) at processing, plus a cool material tint, so wood reads
  dark brown under the moon and only turns warm in fire light (§3 rule 1).
- **Post (the look):** exposure 1.15, Khronos PBR Neutral tone mapping (AgX greyed the teal), split tone (darks ×(0.94, 1.0, 1.06),
  highlights ×(1.06, 1.0, 0.94)), saturation 1.08 rising in the glows, contrast 1.04, a 1.2 % teal floor lift so darks
  never crush, vignette 0.32, bloom threshold 1.0 (only the moon, fire cores, flames and coals bloom), ¼-res god rays
  from the open sky around the moon.
- **Flames on braziers and the beacon** are the environment's own 16×24 pixel sprites (6 frames, the §7 hybrid ramp), HDR ×3.2 so
  they bloom; the beacon basket's flame is 2.6× and flares ×2.6 for 3 s on a kindle.
- **Dawn** (setDawn 1): fog `#9fb0b0`, the key swings to the east and turns `#ffc996`, the east horizon `#e9a27a`, the
  moon, halo, rays and stars fade, a warm sun disc rises in the east; braziers dim to 40 %.

## 11. Refinements after the first playable (2026-11-13)
- **Brightness:** exposure 1.15 plus a display-space mid-tone lift (`c += 0.25·c·(1−c)²` after the sRGB encode;
  the highlights and the deepest darks barely move), hemisphere fill 3.6 → 3.9 with a less saturated sky colour
  (0.64, 0.8, 0.9), split-tone darks (0.97, 1.0, 1.03). Target: the frame body (p50) of m1/m2 **without fire** at
  0.22–0.24 (key art with fire 0.215–0.248); fire adds on top.
- **Slate, not cobalt:** stone, flagstones and rocks carry `NIGHT.stoneTint` (1.42, 1.14, 0.95), which cancels the
  teal of the moon and sky light on the cool tile, so unlit stone reads slate grey and fire-lit stone turns warm brown.
- **Firelit walls:** vertical stone takes a second, wider sample of the fire's light map (2.4 m out, 8 m height
  falloff, ×1.6), and the four braziers are real wall-washers (55 cd, decay 1.4, range 17 m, 1.1 m above the flame) in the
  fire-light colour (linear 1, 0.42, 0.13): `#ff8a3a` mixed with the teal night into mauve.
- **Pines:** 4–6 stepped tiers (each rim well outside the tier above), a dark underside, per-face UVs (square
  texels on every face), shorter near the keep. **Moon:** the disc is drawn in screen pixels, round anywhere.
- **Bounds:** no pine inside `ARENA.playerBounds`; a boulder band marks the west, east and south edges,
  dense pine lines stand beyond the west and south ones, the west palisade sits at x −22.8;
  no fence stands inside the bounds (scenery has no colliders, so no fences where anyone walks).
- **Wall walk:** outer sill 0.5 m, crenels 1.5 m, merlon tops ≈ 1.2 m above the walk.
- **Beacon:** an iron cresset mast (raked legs, collars, X-bracing, a rung ladder); on a kindle the basket
  flame swells ≈ 3×, a three-sprite fire column stands over it, sparks fountain up, a warm glow blooms in the sky and
  the beacon light pulses ×8 (≈ 3.4 s). Big flare flames burn at lower HDR so they stay orange, not white.
- **Far horde:** ≈ 4,200 dark specks and ≈ 7.5 % torch dots stream toward the keep down the far valley road, off
  the east hill and out of the south-west valley (one Points draw, fogged; torches pierce the fog).
- **Timber** cooled again (material tint (0.7, 0.75, 0.86)); fences still read red-brown in some views.
