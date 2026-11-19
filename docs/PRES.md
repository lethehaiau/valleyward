# Presentation: the HUD and menus, the combat FX and the cinematics

Everything the player reads, the combat effects that are not the fire, and the scripted camera shots. Three modules,
loaded by `src/main.js` like every other part (a missing or failing one is replaced by a fallback, never a crash):

| Path | What |
|---|---|
| `src/ui/index.js` | `createUI`: the DOM HUD over the canvas, toasts, banners, subtitles, prompts, name plates, the level-up cards, the P menu, the H controls, the night / dawn / fallen / ending cards, the credits, letterbox and fade |
| `src/ui/panels.js` | Brother Cinder's panel (Upgrades / Charms) and the build pad's panel; his lines (`CINDER_LINES`), the icon map (`ICON`) |
| `src/ui/cards.js` | the level-up card pool as shown (name, text, icon per id) and `SKILL_CARDS` (skill ids and their max level) |
| `src/ui/style.js`, `style2.js` | the stylesheet (built in code, with the font URLs) |
| `src/fx/index.js` | `createFx`: combat FX that are not the fire fluid |
| `src/fx/pool.js`, `atlas.js` | the instanced particle pool and the 16 px pixel tiles it draws (made in code) |
| `src/gfx/{webgl2,webgpu}/materials/fx.js` | the pool's and the ending wash's materials, once per edition (GLSL / TSL) |
| `src/cinema/index.js` | `createCinema`: intro, troll, Rainmother rise, kindle glance, dawn, fallen, retry, the camp shots, the ending |
| `src/shared/timeline.js` | the beat times the sim, the cinema and the audio share (`TIMELINE`) |
| `public/assets/fonts/`, `public/assets/ui/` | the pixel fonts, the icon sheets and Brother Cinder's portrait (each with `provenance.json`) |
| `assets-src/ui/` | the icon sheets' prompts and source sheets, and `make-icons.mjs` that slices them |
| `preview/pres.html`, `preview/pres*.js` | the bench, the overlap probe and the in-game capture drivers |

The fallbacks: `src/core/fallback-ui.js` (a plain HUD) when the UI fails, `src/view/fallback-cinema.js` when the cinema
fails, and no FX when the FX fail.

## How it plugs in

```js
const ui = createUI({ root, assetsBase, noui, fireStyle, cardDefs: CARD_BY_ID,
  onAction: (act, detail) => { /* 'restart' → sim.retry(); shop and camp acts → sim.command({ ...detail, act }) */ },
  onFireStyle: (s) => setFireStyle(s) });
const fx = createFx({ scene, camera, quality, actors });
const cinema = createCinema({ camera, actors, env, look, ui, audio });
// each rendered frame, after draining the sim's events:
for (const ev of events) { /* … */ fx.onEvent(ev, st); ui.onEvent(ev, st); /* audio */ cinema.onEvent(ev, st); }
fx.update(dt, st);                       // 0 while paused: the FX freeze with the game
const cine = cinema.update(dt, st);      // true → the cinema owns the camera this frame (skip the first-person rig)
ui.update(st);                           // DOM writes only when a value changes
```

- **`assetsBase`** must be `import.meta.env.BASE_URL + 'assets/'`: the fonts and icon sheets load from it, and the build
  uses a relative base.
- **The flows main.js drives:** `EV.LEVEL_UP` → `ui.cards(ids)` → `sim.pickCard(id)`; `EV.T_ARRIVE` →
  `cinema.play('troll')`; `EV.DAWN` → `cinema.play('dawn')` and, on `EV.VICTORY`, `ui.card('dawn')`; `EV.FALLEN` →
  `cinema.play('fallen')` and `ui.card('fallen')` at the timeline's card beat; an end card's button resolves `'retry'`,
  which main.js sends on as `sim.command({ act: 'continue' })` (to the camp); `EV.RETRY` → `cinema.play('retry')`; mode
  `intro` from the title → `cinema.play('intro')` (which shows the NIGHT card itself at 4.9 s).
- **Scenes that start themselves** from `cinema.onEvent`: the kindle glance (`beacon.kindle`), `camp` (`camp.enter`),
  `campLeave` (`camp.leave`), `rise` (`boss.rise`) and `ending` (mode `ending` or `ending.start`).
- **`cinema.update()`** returns true while a scene owns the lens. The dawn, fallen and ending scenes resolve their promise
  at the card beat and then **hold** the lens until `play('retry')`, `release()` or the next scene.
- **The viewmodel** is hidden while the cinema owns the lens, shown in the intro from its `hands` beat (4.6 s), and
  shown in the ending while `cinema.hands` is true (the gloves beat, 25–29 s). `cinema.overlay` is true during the
  kindle glance.
- **The UI's actions** go out through `onAction(act, detail)`: `buy {item}`, `equip {charm, on}`, `build {pad, type}`,
  `upgrade {pad}`, `close {panel}`, `beginNight`, `buyOrgan`, `equipOrgan {on}`, `skipEnding`, `continue`, plus `restart`,
  `fire-style`, `card-picked`, `card-retry`, `menu-open` / `menu-close`, `controls-open` / `controls-close`. The UI keeps
  no shop state: it re-renders the panels when the save or the towers change.
- **Pausing:** main.js pauses the sim while `ui.modal` is true in modes `play`, `victory` and `fallen` (the menu, the
  controls, an end card). Level-up cards are the sim's own mode `cards`. Behind a modal or a camp panel the world draws
  at 30 fps.
- **Keys:** the UI listens for P, H and Esc itself (`keys: false` turns P and H off). While cards are up it swallows
  1/2/3 (no weapon switch) and ignores a pick in the first 0.3 s, so a held key or click from play never picks. An end
  card's buttons ignore clicks in their first 0.9 s.
- **UI sounds** go out as the window event `ew:ui` with `detail.sound` = `hover | click | open | close | tab`; the
  audio code plays them. Card picks and level-ups sound from the sim's events.
- **The cinema calls** `env.setDawn(x)` and `look.setDawn(x)` (dawn ramps 0 → 1 over `TIMELINE.dawn.rise`, reset to 0 by
  `intro`, `retry` and `camp`), `env.beaconFlicker(s)` at the intro's beacon beat, and the UI's letterbox, fade,
  caption, subtitle, cards, credits, `setGlance` and `setCamera` (the UI projects its name plates and markers with the
  game camera the cinema hands it).
- `ui.choose(x)` resolves whatever is open (a card index or id, `'retry'` on an end card, a menu or panel choice): for
  tests and the bot. `ui.titleCover(el)` dresses the loading cover with the wordmark.

## The HUD

- **Layout** (after the key art `docs/mockups/M1_hybrid.jpg`): top centre the night clock, the dawn bar, the gate bar
  and the beacon line (and the troll's or the Rainmother's bar); top left LV, the XP bar and the gold; bottom left HP;
  bottom right the weapon block (slots, name, rounds or the Lance's fuel, firebomb pips, the Sunburst meter).
- **No crosshair.** Aim reads from the weapon. A hit shows as a white "×" (3 % of the frame
  height, 4 % and pale gold on a crit) at the **world impact point**, drawn by the FX, never at the screen centre.
- **Fonts:** Silkscreen for display (numbers, labels, banners, titles) and Pixelify Sans for body text (card text,
  controls, subtitles), self-hosted latin woff2 subsets (≈ 19 kB, OFL). Banner titles use Silkscreen 400 (the 700 "W"
  reads badly); LEVEL UP! uses 700.
- **Scale:** one pixel-font step `--k` (`resize()` in `src/ui/index.js`): 2.5 at 720p, 3.5 at 1080p, half steps between,
  never below 2; text is `k × 8 px`, so the pixel fonts stay near whole pixels.
- **Colours** (`docs/ART-DIRECTION.md`): HP is the only red, the Lance's fuel the only orange, XP a thin gold bar, the
  dawn bar moon-cyan, the gate bar stone grey; the troll bar is ash and takes the fire ramp only while the hide glows.
- **Clock:** "NIGHT I  mm:ss" counts up to 05:00. Ash markers on the dawn bar show when each troll comes
  (`NIGHTS[n].trolls`) and go once it has.
- **The beacon line:** "BEACON READY · E AT THE PAN", "BEACON · mm:ss" while it cools, "BEACON BURNS ×n · mm:ss"
  while a kindle lasts, "THE LAMP IS DIMMED · n s" during the coven's lock (it outranks the others). Within
  `ARENA.beacon.useRadius` of the pan a bottom-centre prompt says what E does or why it is locked; E while locked toasts
  the reason. "RAIN · FIRE WEAK" shows under it while `weather.rain > 0.3`.
- **Bosses and big enemies:** the Rainmother's bar (ticks at 66 % and 33 %, the phase TIDE / DOWNPOUR / THE CLIMB with a
  banner on each change, her crown's lanterns as pips, CRACKED · GUNS ×3, and in the climb a distance bar and a toast
  inside 18 m). Name plates over elites (`state.elites`, hidden past 70 m) and over Siege Rams (HP and crew pips; the
  banner THE RAM IS AT THE GATE when it starts to swing). Plates step aside under a banner. The coven shows "THE COVEN
  CHANTS · THE LAMP DIMS" with a 20 s bar.
- **Weapons:** the THUNDER ORGAN shows its name, "2 ORGAN" in the slots, the drum count, a heat bar (white → orange →
  red, flashing solid red while locked) and OVERHEATED · LET IT COOL / RELOADING / R · RELOAD. Key 2 while the
  Blunderbuss is locked toasts "BLUNDERBUSS · LOCKED / pick it from a level-up card".
- **Hearthblood:** while the card is owned and the player stands in fire below full HP, the HP bar glows and pulses
  warm with a small flame beside it.
- **The XP bar** ticks (a 0.28 s brightness step and a cyan inner edge) as XP grows, at most 7 times a second.

### Transient text
- **Toasts** are one element: one message at a time, a queue of up to 3 behind it. A waiting message cuts the current
  one short (it keeps at least 1.1 s); a repeat refreshes instead of stacking. An optional second line (Pixelify) says
  why. They sit in a band above the HUD's bottom edge (between the HP bar and the weapon block), never in the centre
  zone (±12 % around the centre) or over the upper-centre action.
- **Banners** (centre, queued, one at a time) mark big moments: a troll, an elite, the Rainmother, a new weapon.
  During the letterbox the HUD hides and banners move to the lower third.
- **Modals hide transient text:** while the menu, the controls, the cards, a panel or an end card is up, the UI sets
  `ew-modalon`: toasts, the prompt, banners, subtitles and the hint strip hide and their clocks stop, so nothing shows
  through a menu and nothing expires unseen.
- **`fitText()`** glues "+20 %", "×3" and "60 s" with no-break spaces, so no card or panel line wraps a lone "%".

### The camp
- At the camp the night bars, HP and the weapon block give way to "THE CAMP · DUSK" and "THE LAMP SMOULDERS · NEXT:
  NIGHT n"; the gold stays.
- **BEGIN NIGHT N** (bottom centre; a click, or N / Enter when nothing else is up) sends `beginNight`, the same flow as
  E at the pan, under the line "Ready? Begin the night here — or kindle the lamp at the pan on the wall walk (E)." The
  first camp of a save (`state.camp.tip`) shows a 9 s toast "THE CAMP · THREE STEPS".
- **Prompts** from `state.camp.near` (with a geometry fallback): "E · TALK", "E · BUILD", "E · UPGRADE · <TOWER>",
  "E · KINDLE THE LAMP TO BEGIN NIGHT N". They stand down for 4.5 s after `camp.leave` (the mode changes after the
  cinema starts).
- **Markers:** a bobbing coin-on-anvil icon with "BROTHER CINDER · UPGRADES" over his head and a pulsing "THE LAMP · E"
  over the pan, projected on screen, scaled 0.7–1.15 with distance, hidden past 80 m and when a keep tower or wall lies
  on the line of sight (a box test against `ARENA.keep`; the pan's marker tests the towers only, so its own parapet does
  not hide it). Cinder's marker brightens and pulses when the save's gold covers the cheapest thing he sells.
- After a fall or the first visit, his line arrives as a subtitle 2.6 s after `camp.enter` unless the sim spoke first.

### The first launch
On a first launch (title click → Night I's intro; no save yet) the H controls panel opens once at the first moment of
control, with "WASD to start · H, Esc or a click to close". Any game key (WASD, arrows, Space, Shift, E, Q, R, G, 1–3)
also closes it **and goes on to the game**, so the first step is not lost. Once closed, `localStorage`
`valleyward.controlsSeen.v1 = '1'` (in a try/catch) and it never opens again. It never opens with `?noui`, from the camp
(a save) or behind the URL shortcuts `night`, `camp`, `ending`, `skipintro`, `autoplay` and `clock`, so captures and
tests see nothing new. A night card that arrives while the panel is up is held and shown when it closes.

## Menus, cards and panels

- **Level-up cards** (`ui.cards(ids)`): three cards, picked with 1/2/3, ←/→ and Enter, or a click. A skill card shows
  **NEW SKILL** (a gold tag and border) or **UPGRADE · LV n → n+1** with level pips, the next one blinking; the class,
  kind and max come from the sim's `CARD_BY_ID` (`cls`, `kind`, `skill`, `levels`) and the level from `state.taken`.
  The sim's card texts win over `src/ui/cards.js`; unknown ids still render with a humanised name and a generic icon.
- **The P menu:** RESUME, RESTART NIGHT (press twice within 3 s: "RESTART? PRESS AGAIN"), FIRE STYLE (Smooth / Hybrid,
  live), CONTROLS. **H** opens the controls.
- **Brother Cinder's panel** (opened on `npc.open`): his pixel portrait, a line from `docs/STORY.md` (`npc.line` ids
  `home hide afraid gloves eight eat fall master`; with none the UI picks one), the gold, and two tabs:
  - **Upgrades**, the lines of `UPGRADES` in `src/shared/meta.js` (icon, level pips, compact pips for 10-level lines,
    "LV a → b", the cost, or greyed with "NEED n MORE" / "MAXED"), and the THUNDER ORGAN row: unowned, Enter arms a 3 s
    **CONFIRM · PRESS AGAIN TO BUY** before `buyOrgan`; owned, its upgrade line and a **SLOT 2** row that swaps the Organ
    and the Blunderbuss (`equipOrgan`).
  - **Charms**, 2–4 slots (`BASE_CHARM_SLOTS` + the slot upgrade; locked slots show a padlock) and every charm of
    `CHARMS`: owned (icon, text, ENTER TO EQUIP / EQUIPPED / NO FREE SLOT) or "? ? ?" NOT FOUND YET.
  - Keys: 1–9 act on line n, ↑/↓ select, ←/→ / Tab / Q switch tabs, Enter acts, E / Esc / Backspace close. The E that
    opened it cannot buy (a 0.25 s guard). A greyed line shakes instead of buying. Rows are tight enough for 9 lines at
    720p.
- **The pad panel** (`ui.panel('pad', st, { pad })`, from `pad.open`): an empty pad offers the **Black Obelisk** and the
  **Chain Imp** (icon, cost, text, level-1 numbers); a built pad shows NOW / LV n+1 and the upgrade cost or MAXED.
  On screen the Hellfire Obelisk is always the Black Obelisk (`towerName()`): `docs/STORY.md` forbids "hell" before
  Night X. The internal id stays `obelisk`.
- **End cards** (`ui.card(kind, st, extra)`):
  - `night`: the VALLEYWARD pixel wordmark (Silkscreen 700 in the fire ramp, a dark pixel outline, a crimson
    extrusion), NIGHT n between flame rules (the numeral red from Night II), the night's title (`NIGHTS[n-1].title`,
    e.g. THE RAM; Night X's in pale blue) and the order HOLD THE GATE UNTIL DAWN (Night X: HOLD THE LAMP UNTIL THE WATER
    FALLS). It closes itself after 2.8 s. The cinema's beat and the sim's `night.title` within 4 s show it once.
  - `dawn`: Night I "DAWN · NIGHT I / THE WATCH HOLDS / The valley is quieter tonight."; Nights II–IX "THE LAMP DRINKS
    THE NIGHT / <n> more nights, and it will be bright enough." Stats, "GOLD BANKED +n", **TO THE CAMP**.
  - `fallen`: THE GATE IS BREACHED or THE LAMPLIGHTER FALLS, stats, gold banked, **RETURN TO THE CAMP**.
  - `ending`: NIGHT X / **THE WAY IS OPEN** / "Ten nights. The lamp will never go out.", stats, **PLAY AGAIN**.
  - The primary button of every end card resolves `'retry'`.
- **Credits** (`ui.credits(true)`): the wordmark on black, then "DIRECTED BY / AL".

## Combat FX

### How they draw
- **Three instanced draws**, each a CPU particle pool (`src/fx/pool.js`) in fixed typed arrays with swap-remove: no
  allocation per frame, and only live instances are uploaded.

  | Pool | Blending | Used for | Size high / medium / low |
  |---|---|---|---|
  | alpha | normal | every warm thing (flashes, fireball discs, sparks, embers, tracers, rings), smoke, dust, debris, decals | 4000 / 2600 / 1500 |
  | additive | additive | cyan and white sparkles (level-up stars, gold twinkles, the magnet trail), the ending's glows | 1500 / 1000 / 600 |
  | numbers | normal, no depth test, drawn last | damage numbers and the hit "×" | 320 / 240 / 160 |

  The ending adds a fourth mesh, a full-frame additive wash, only while it plays.
- **Particles** are camera-facing billboards, velocity-stretched streaks, or flat ground decals (`MODE`), with gravity,
  drag, bounce and a floor. They draw 16 px pixel tiles from an atlas made in code (`TILE` in `src/fx/atlas.js`: square,
  disc, star, rings, puff, streak, plus, shard, digits, diamond, chunk, ember, bang). Tile 6 (puff: smoke, dust, ash) is
  drawn as a procedural soft disc in the shader.
- Particles fade out between 0.42 m and 0.12 m from the lens, so nothing fills the screen.
- **Budgets per frame** (`BUDGET`, scaled by quality `K` = 1 / 0.7 / 0.45): death bursts 32, ignites 16, hit impacts 44,
  numbers 18, pyre bursts 8, ground impacts 24 on high. A burning horde raises hundreds of events a second; the budget
  is what keeps the FX flat. Delayed parts run on a game-time queue (they freeze with a pause).
- **Fire hues** (`HUE`): each coloured fire has its own ramp (white core → hue body → deep edge): orange (default),
  violet (the Black Obelisk), blue (Ember Orbit), green (Brimstone Rain and the Witchfire Wick), lilac (Cinder Steps).
  The hues are saturated ×1.0–1.35: at ×1.5 they tone-mapped to white.

### What they draw
- **Guns:** muzzle flashes at `actors.sockets.muzzle()`, tracers, the hit "×" and ichor on enemies. **Ground hits**
  (`surfOf()` reads the pellet's `surf` from `weapon.shot`; without it, it infers enemy / wood (the gate) / stone (the
  keep) / ground / air): the Organ throws a 50 ms flash, 6 dirt chunks back toward the shooter, two dirt streaks, a tan
  dust burst, a hot ember point (0.9 s), a thin smoulder (2.6 s) and a pock mark (3.2 s: a 0.6–0.8 m ring of churned
  brown earth with a dark crater); consecutive Organ hits under 0.2 s and 3 m apart raise a dust sheet between them, so
  a sweep chews a line. Spray, dust and flashes grow with distance (×1 within 9 m, up to ×2.4). Stone throws sparks,
  falling chips, stone dust and a chip mark (2.2 s); wood throws splinters. The Kestrel and the Blunderbuss get lighter
  versions. Impacts wait for their tracer in a 256-slot typed queue. Medium and low drop the crater and the second
  streak, low halves the churn, the smoulder scales with K².
- **Fire weapons:** firebomb and barrel bursts (flash, debris, smoke, a ground shock ring; the fluid does the fire),
  the Sunburst ring, Lance nozzle sparks.
- **Damage numbers** merge per target over 0.25 s; at most 20 on screen (high); hits that are not the player's own shots
  (towers, the orbit, blasts, pyres) show only when the merged total is ≥ 40; the troll's always show; a number that would
  land within ≈ 40 px of one shown less than 0.22 s ago is dropped. Fire damage ticks show no numbers. Crits are 1.7×,
  pale gold, with "!".
- **XP wisps:** a small cyan streak arcs from a kill toward a point 4 m ahead of the lens that projects onto the XP bar.
  Sized in screen space (a head of 0.75 % of the frame height, a tail ≤ 4 %), one new wisp per 0.08 s at most (it stands
  for every kill of its batch), at most 10 in flight, from the sim's `xp.gain` event, starting only beyond 5 m.
- **Drops:** gold twinkles and the magnet trail; a charm drop's burst and a bobbing gold diamond until it is picked up.
- **The kindle:** a soft white-gold bloom, then at 0.22 s a second bloom, a pillar of ≈ 46 sparks shooting up and an
  ember fountain for ≈ 1.5 s. Every kindle sprite is capped to ¼ of the frame height at the glance's lens (≈ 2.4 m); the
  environment's flare gives the glow, the column and the light.
- **The troll:** dust, the stomp ring, boulder debris and trail, embers off the glowing hide, and the **Ash Roar**
  telegraph: a cone on the ground in front of it (12 m, half-angle 0.6) with bright edges and a red sweep filling it over
  the windup, then ash and steam through it. (The stomp and throw telegraphs are the actors'.)
- **Towers:** the Obelisk's nova (a violet core flash, a thin bright ring and a faint wide band at its radius, 18–26
  violet streaks, embers); the Chain Imp's hook spark (the actors draw the chains from `state.chains`; the FX draw a
  segmented chain only when that array is absent, as on the bench); a build / upgrade burst (rune ring, hue sparks, stars,
  dust, stone). Tower FX are muted in the ending.
- **Skills:** Ember Orbit (a blue core and trail per ball, blue sparks on a hit); Brimstone meteors (a green head, a 6 m
  streak, a landing ring that closes, then flash, ring, sparks, stone and smoke); Pyre Burst (an orange pop, a ring and
  sparks); **Ember Gale** (2.5 s: 9 fine warm streaks a frame hugging the ground 0.2–2.5 m up and following its slope,
  none within 5 m of the lens, a faint warm haze behind the front, ember motes ahead); **Cinder Steps** (lilac flashes and
  embers on the ground; from the wall walk, small motes tip over the parapet, 3 big and 6 small cinders fall to the
  wall's foot and land in a lilac flash, ring and embers); Hearthblood (a few warm embers at the bottom of the view).
- **Enemies:** the Douser's splash and steam where the bucket lands; the Hexer's green flash where its orb lands; Bat
  Gremlins (a soft ground shadow under each glider, fading with altitude; a red ring closing on the dive target; feathers
  and a dusty pop on death, an orange pop when burned; a burst on a crash).
- **The Rainmother:** the tide (the strip she will flood marked with pale dashed edges during the windup, then a foaming
  blue front with spray), the whirlpool (two spiral arms of water and foam turning inward inside a ring), a big steam
  cloud on her death.
- **The ending's light** (`stepEndingLight()`): a full-frame additive wash (a black-point lift in the lamp and host
  beats, a red flood from the top from the portal beat) and red glows (a halo round the lamp's pillar; in the host beat
  the gate passage, the wall's top and its foot lit from behind, depth-tested so the marching ranks cut out against
  them). It sits on top of the environment's own ending grade and sky, which give most of the lift.
  `__ewFx.setEndingLight(false)` turns it off for comparisons.

## Cinematics

The sim moves the bodies; the cinema moves the camera, the letterbox, the cards and the dawn ramp. Beat times come from
`TIMELINE` (`src/shared/timeline.js`), with fallbacks in `DEFAULTS` (`src/cinema/index.js`). Every call into another
module is guarded, so a missing module never breaks a scene.

| Scene | Length | Starts on | The shots |
|---|---|---|---|
| `intro` | 6.0 s (skippable after 1.5 s) | mode `intro` from the title | A: a Catmull-Rom glide 3 → 7 m over the valley road (z 72 → 30) looking up at the keep; B (3.6 s): a cut to a crane east of the beacon basket as it flickers; C (4.6 s): a cut to the eye, the gaze settling up from below as the hands rise; NIGHT card at 4.9 s; control at 6.0 s |
| `troll` | 3.2 s | `troll.arrive` | a low lens 0.9 m above the ground, 12 → 9.5 m in front of the troll toward the gate and 3.2 m to the side, FOV 56°; a roar shake at 2.2 s; the sim keeps running |
| `rise` | 4.2 s | `boss.rise` (Night X) | a look down the hill as the Rainmother stands up out of the river; a roar shake at 2.8 s |
| `kindle` | 1.0 s (`TIMELINE.kindle.glance`) | `beacon.kindle` | an overlay on play (below) |
| `dawn` | 7.0 s, card at 6.5 s | `dawn` | from the eye, a rise of 3.6 m and a turn to the east horizon; `setDawn` 0 → 1 over 5 s |
| `fallen` | 2.4 s, card at 1.4 s | `fallen` | the gate: a high push-in over the breach. The player: a 0.14 s flinch (the eye sinks to ≥ 1.3 m over the feet, a 0.3 rad roll, the gaze drops), then the lens lifts straight up to 6.2 m over the feet, looking down at the fall and the horde and turning 0.45 rad; it stops at 3.2 s |
| `retry` | 1.2 s | `retry` | a fade from black while the eye settles from 1.6 m behind and 1.1 m above |
| `camp` | 2.6 s | `camp.enter` | black, "THE DAY PASSES", the dawn reset under the black, the lens settling onto the eye at the camp as the black lifts |
| `campLeave` | 4.0 s | `camp.leave` | the kindle glance held longer: lift clear of the tower, look up at the lamp 1.0–2.6 s, a shake on the 1.6 s vision beat (the environment plays the sunset, the flare and the horned vision), the NIGHT n card at 2.6 s, back to the eye |
| `ending` | ≈ 56 s | mode `ending` | below |

- **The kindle glance** drives the camera from the live eye (walking and looking stay live). It lifts the lens until
  the line to the basket clears the south-east tower and its merlons (`planGlance()`: the first lift that sees the
  basket, + 0.6 m), turns to `ARENA.beacon.basket` (+0.9 m), narrows the FOV by 12°, holds over 0.38–0.6 of its length
  and eases back to the exact eye pose, with a small shake on the flare beat. It never interrupts another scene, and
  `skip()` ignores it. The sim holds firing for that second. The UI hides the pan prompt (`setGlance`), and the kindle
  toast "THE BEACON BURNS" lands 0.95 s after the kindle, as the glance ends.
- **Rules every shot keeps:** the lens stays ≥ 0.35 m above the terrain; the fallen shot stays ≥ 0.45 m above the feet
  (a fall on the wall walk stays on it); every ending pose is lifted out of any keep wall or tower box it would be inside
  (`outOfStone()`).
- **Skipping:** intro, troll, retry and rise skip to their end (the intro still shows its NIGHT card); the camp scenes
  finish; dawn and fallen jump to their card beat; the kindle glance and the ending ignore `skip()`.

### The ending
Letterbox throughout, no HUD. The scene follows the sim's clock (`state.ending.t`), so the sim's skip moves the lens.

| t (s) | Beat | The lens |
|---|---|---|
| 0–5 | flood | wide from up the hill on where she fell (≈ 30 → 24 m, 13 m up), looking down as she sinks; fade-in from 0.6 |
| 5–8 | lamp | low on the plaza (9, +1.7, 11) looking up the south-east tower at the beacon as the pillar rises |
| 8–12 | portal | a dolly back to (7, +2.2, 22), tilting up from the pillar to the portal at (0, 52, −26) as the lens widens |
| 12–18 | world | a slow pan from over the plaza (x −4 → −1, y 9.5, z 2.5), from the burning slope round to the black moon |
| 18–25 | host | low near the road (x 2 → 3.2, z 14 → 24, 1.75–2 m up) on the gate opening and the host marching down, ≥ 10 m ahead of the front rank |
| 25–29 | gloves | first person at the demon's eye, facing out over the parapet pitched up 0.12 rad; `cinema.hands` is true, so the burning claws (the actors' viewmodel) show above the merlons |
| 29–34 | reveal | out of the head: back and up over the walk, around (≥ 5 m off the body), down to a low frontal angle |
| 34–37 | roar | a push-in, the lens narrows, a roar shake |
| 37–42 | cinder | low on the plaza ≥ 9 m from the demon: Brother Cinder kneeling, the demon above; his subtitle "Welcome home, Master." (cleared at the hunt cut) |
| 42–50 | hunt | low on the forest side of the village (`ARENA.village`), backing off ≈ 1 m/s, 4 m off the runners' line and 2.4 m up, looking back at the burning huts: families and animals run toward the lens, the horned chasers behind |
| 50 | black | fade to black (0.45 s), before anyone is caught |
| 50.5–56 | credits | the VALLEYWARD wordmark, then "DIRECTED BY / AL" |
| 56– | card | back to the low frontal angle on the demon and the portal; the black lifts (1.4 s) under THE WAY IS OPEN; the lens holds |

The first ending cannot be skipped. After that (`state.ending.skippable`), Space / Enter / Esc after 3 s sends
`skipEnding` and a "SPACE · SKIP" hint shows.

## Tuning: where the numbers live

| What | Where |
|---|---|
| Pool sizes and the quality scale `K` | `QUALITY` in `src/fx/index.js` |
| Per-frame burst caps | `BUDGET` in `createFx()` |
| FX colours | `COL`, `COL2`, `COL3`, `COL6`, `HUE`, `ENDLIGHT` in `src/fx/index.js` |
| XP wisps | `WISP` |
| Damage numbers | `NUM_MERGE`, `NUM_CAP`, `NUM_BIG`, `NUM_GAP`, `NUM_GAP_T` |
| Ground-impact queue | `IMP_N` (256) |
| Near-lens fade, the soft puff tile | the pool material in `src/gfx/{webgl2,webgpu}/materials/fx.js` |
| Scene beats | `TIMELINE` in `src/shared/timeline.js` (shared with the sim and the audio: move all three together) |
| The kindle glance's curve | `GLANCE` in `src/cinema/index.js` |
| Shots | `shoot()` and `endingShot()` in `src/cinema/index.js` |
| Weapon names; fallback magazine sizes and reload times (the sim's values win) | `WEAPON_NAME`, `MAG`, `RELOAD_S` in `src/ui/index.js` |
| Fallback night titles | `NIGHT_TITLES` (used only when `NIGHTS[n].title` is missing) |
| The first-launch flag | `HELP_KEY` (`valleyward.controlsSeen.v1`) |
| Card names, texts, icons; skill maxima | `CARDS`, `SKILL_CARDS` in `src/ui/cards.js` (the sim's `CARD_BY_ID` texts win) |
| Cinder's lines, icon indices, pad names | `CINDER_LINES`, `ICON`, `PAD_NAME` in `src/ui/panels.js` |
| Layout, colours, the `--k` scale | `src/ui/style.js`, `src/ui/style2.js` |

**Icons:** five 192 × 192 sheets of 4 × 4 icons in `public/assets/ui/` (index 0–15 `card-icons.png`, 16–31
`v2-icons-a.png`, 32–47 `v2-icons-b.png`, 48–63 `v3-icons-c.png`, 64–79 `v5-icons-d.png`) and the 96 px
`cinder-portrait.png`, all made with the Codex CLI's image generation. The prompts and source sheets are in
`assets-src/ui/`; `node assets-src/ui/make-icons.mjs <sheet> <out> [cells] [cell]` slices a sheet.

## Performance

- The FX are CPU-side pools: per hit there are no closures, arrays or buffers (end colours are precomputed), and the
  GPU side is two or three instanced draws. `__ew.perf()` reports the FX module's CPU ms per frame and `__ewFx.stats()`
  the live instances, queued impacts, numbers and the module's own average and peak ms.
- **Measured** (production build, Chrome, quality high, 2026-11-14): a 6 s THUNDER ORGAN burst into the ground at 18
  rounds/s (≈ 108 ground hits). The FX update averaged 0.084 ms at 1280×720 and 0.065 ms at 1920×1080 (peaks 0.7 / 0.8
  ms). ≈ 300 alpha + 18 additive instances were alive mid-burst, in 2 instanced draws (102 draw calls in the frame,
  100–101 without the burst). The same sweep in Node peaked at 653 / 563 / 355 live alpha instances on high / medium /
  low, against pools of 4000 / 2600 / 1500.
- The UI writes to the DOM only when a value changes, and animates with transforms and CSS animations.
- Assets: fonts ≈ 19 kB; icon sheets 40–57 kB each.

## Decisions and lessons

- **Warm FX go through the alpha pool** with saturated HDR colours (`#fff2b8`, `#ffd24a`, `#ff9a2e`, `#e85a1c`,
  `#a3241a`): drawn additively over the teal night they turned pale cyan-white. Warm discs **pop and shrink** instead of
  fading: a half-transparent warm disc over the teal night reads as grey mud. The XP wisps are alpha too: additive cyan
  over orange fire went white and vanished.
- **Smoke is a procedural soft disc** at ≤ 0.45 alpha, light charcoal-brown, fading to clear as it rises: the magnified
  16 px blob and its dithered rim drew as hard rotated squares in the sky, and smoke at 0.85 stacked to black.
- **Nothing large near the lens.** The wisps are sized in screen space and fly to a point 4 m ahead; the Organ has no
  brass casings (at 0.5 m from the lens they drew as big yellow blocks); the Ember Gale draws no streaks within 5 m (from
  the plaza they drew warp-speed lines across the sky); the wall cinders have no velocity streaks (from a lens a metre
  above they projected as long lines); kindle sprites are capped to ¼ of the frame (big stars and flat rings filled the
  glance with cream wedges).
- **Ground hits read by their brown ring:** a black mark alone vanished against the night grass. The distance scale
  makes a 15 m hit from the wall walk as legible as a 6 m one.
- **Damage numbers merge and are capped:** a big fight drew strings of "1111111" across the screen.
- **No crosshair.** The hit marker lives at the world impact point instead.
- **Toasts never cover the action:** one at a time, in a band above the bottom HUD, never in the centre; modals hide and
  freeze transient text. The kindle message is a toast after the glance: as a centre banner it sat over the flare.
- **The fallen shot rises:** a low lens inside the horde fills the frame with sprites, which read as being buried in the
  ground; nothing overhead can block a vertical rise.
- **The intro's beacon shot is a crane:** the basket cannot be seen from the plaza (the tower top hides it from anywhere
  closer than ≈ 33 m at ground level).
- **The host beat keeps ≥ 10 m from the front rank:** the actors dither the host out within 4–9 m of the lens, which
  made it vanish. **The gloves face out over the parapet:** a turn up toward the portal swept the south-west tower and
  filled the frame with stone.
- **Ground hits use a typed-array queue,** not a closure per pellet in the game-time queue, so a long Organ burst or a
  Blunderbuss volley allocates nothing.
- **Captures run on a static build:** the Vite dev server reloads the page whenever a file is saved, which reset a
  capture to the title mid-run.

## Open issues

- **FX draw under the fire.** The FX are in the world pass and write no depth; the look composites the fire volume over
  that pass, so a flash or a number over a burning area can look behind the fire. The fix is to draw `fx.root` after
  the fire pass (`src/gfx/*/look.js` has no hook for it yet).
- The Obelisk's nova ring is the pixel `thinRing` tile stretched to the tower's radius, so its edge steps in large
  texels; a procedural ring in the pool shader would be cleaner.
- Elite name plates have no occlusion test: a plate shows over a hill that hides its elite.
- The Ash Roar's cone edges are ground decals: within 3 m of the lens they draw large (unverified since).
- Bat shadows are dark discs, faint on the dark Night II ground.
- Some FX were seen in the real game only when forced through `__ewFx` (the bat dive ring, the whirlpool) or on the
  bench only (the hit marker): no bot run caught them in a capture window.
- The troll's telegraphs are split: the Ash Roar cone is drawn by the FX, the stomp and throw by the actors
  (`src/actors/telegraph.js`).
- `src/fx/pool.js`'s header still lists flashes and sparks under the additive pool; the code draws warm things through
  the alpha pool.

## How to see and test it

- **In the game:** `npm run dev` (http://127.0.0.1:5350/) with the URL shortcuts: `?camp=1&save=rich` (the camp, the
  panels, the Organ), `?night=2&save=mid` (elites, bats, the Ash Roar), `?night=10&save=endgame` (the Rainmother),
  `?ending=1&save=endgame` (the ending), `?noui=1` (no HUD). `__ew.goto('ending')` plays the ending directly.
- **Debug hooks:** `window.__ewFx` (`root` to hide the FX and tell what is theirs, `debugBurst(kind, x, y, z)` with
  `bomb barrel sunburst kindle hit crit pyre batdeath`, `stats()`, `setEndingLight(on)`, `resetCpu()`, `clear()`);
  `window.__ewCinema` (`play(name, state)`, `name`, `t`, `holding`, `hands`, `skippable`).
- **The bench** `preview/pres.html`: a greybox of the arena with a fake ticking state, a button per event and 111
  scenarios (`?scn=<name>`: the HUD in every state, cards, menus, panels, end cards, each FX, each cinema).
  `?frozen=1` moves time only through `__pres.advance(s)`, `?nobench=1` hides the buttons, `?quality=` sets the tier.
  Tools use `window.__pres` (`ready`, `list()`, `setup(name)`, `advance(s)`, `ev(type, payload)`, `state`, `ui`, `fx`,
  `cinema`). Dev server: `npx vite --config vite.config.js --port 5356 --strictPort`, then `/preview/pres.html`.
- **The static build** for captures: `npx vite build --config preview/pres.vite.config.js --outDir <dir>`, then
  `npx vite preview --config preview/pres.vite.config.js --outDir <dir>` (port 5356). It builds the game and the bench.
- **The overlap probe** (`preview/pres-capture.js`): renders bench scenarios in headless Chrome at 1280×720 and
  1920×1080, saves PNGs and fails on overlapping HUD blocks, anything outside the viewport, clipped text, fonts not
  loaded, transient text in the centre zone, more than one toast, transient text under a modal, a lone "%" line, any
  crosshair element, and panel rows that overlap or spill. Every check should report 0.
  `tools/gpu-lock.sh node preview/pres-capture.js --out <dir> [--only hud,cards] [--sizes 1280x720,1920x1080]`.
- **In-game driver** (`preview/pres-game.js`; under `tools/gpu-lock.sh`, `--out <dir>`): drives the real game through
  `__ew` (the intro, play, the troll, dawn and fallen), captures each moment, re-runs the probe and counts console
  errors. `npm run e2e` covers the camp, the panels, the Organ, every night's twist and the ending.
- **Node tests:** `npm test` includes `tests/static.test.mjs` (hooks, no web-root asset URLs) and `tests/cards.test.mjs`
  (the card pool). There is no Node test of the FX or the cinema.
