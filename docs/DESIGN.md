# DESIGN · VALLEYWARD

VALLEYWARD is a first-person horde survivor with a roguelite campaign. The Lamplighter holds the gate of a hilltop keep
through ten five-minute nights against thousands of pixel-sprite goblins, the Ash Troll and each night's twist. The
showcase is a real-time fluid fire that lights the world and burns the enemies. Between nights, gold buys permanent
upgrades, charms and towers; a fall restarts the run at Night I. The last boss's fall reveals what the Lamplighter is.

This is the design as it stands. The tuned numbers live in code; where this file names a constant, the constant wins.
Code cites this file as "DESIGN §n.m".

## 1. The game at a glance

### 1.1 The idea
- A chunky pixel-textured 3D world, thousands of flat pixel-sprite enemies, a big moon, modern light, level-up cards
  and weapon unlocks. The risk/reward device is the beacon: kindle it for a bigger wave.
- The fire is a grid fluid on the ground drawn as a 2.5D volume, in two live styles, `smooth` and `hybrid` (the
  default; its stepped pixel edges fit the world). It lights every material and decides what burns.
- VALLEYWARD borrows genres and techniques only; its world, names, art, lines, music and code are its own. English.

### 1.2 The shape of play
A night (§7) is 5:00 at Valleyward Keep (§2): hold the gate, kindle the beacon, kill the trolls. Ten nights, each with
a twist (§8), make a run; the camp between them sells upgrades, charms and towers (§9). The Ash Troll leads Nights
I–IX, the Rainmother Night X (§6); her fall plays the ending (§12).

### 1.3 Where the rest lives
Numbers: `src/sim/constants.js`, `src/shared/meta.js`, `src/shared/arena.js` and the constants of `src/sim/*.js`.
Controls, URL parameters and hooks: `README.md`. Story and hints (binding for every text): `docs/STORY.md`. The look:
`docs/ART-DIRECTION.md` and the key art `docs/mockups/`. The fire: `docs/FLUID.md` and decision
`docs/decisions/0001-fire-modules-and-two-editions.md`. Subsystems: `docs/CORE.md` (with the balance and performance
results), `ENV.md`, `ACTORS.md`, `PRES.md`, `AUDIO.md`.

## 2. The place
Layout: `ARENA` in `src/shared/arena.js`, the one source of truth for colliders, terrain height and the fire area.
Metres; y up, +X east, +Z south (downhill, toward the valley and the moon).
- **The keep:** a square stone fort (32 × 32 m, walls 5 m) whose south wall faces the valley. The horde attacks the
  **gate** in that wall (`ARENA.gate.hp`, 1,000). A **timber stair** west of the gate climbs to the **wall walk**. The
  **beacon** burns on the south-east tower; its kindling pan is on the wall walk.
- **The plaza** runs east along the wall into the **road**, which switchbacks down into the fog. **Oil troughs** line
  the wall's foot, a **trench** crosses the road, **barrels** stand on the slope, **braziers** burn by the wall.
- **Beyond:** pines in fog, the valley where the horde gathers, the goblins' **village** (`ARENA.village`, §12.7) and
  the moon low in the east-south-east. **The camp** is the same plaza at dusk (§9.2).

## 3. The player

### 3.1 The Lamplighter
The last keeper of the beacon, seen only as gloved hands, weapons and a shadow. `PLAYER.hp` 100, more with Hide.
What they truly are is only hinted (`docs/STORY.md`) until the ending.

### 3.2 Movement and controls
- Walk 6 m/s, sprint 9, jump 1.1 m (`PLAYER`); FOV 78°, eye 1.68 m. The ground, the stair and the wall walk; a fall
  guard returns the player to the last safe spot.
- Mouse and WASD; E kindles the beacon and acts at the camp; Q the Sunburst; G or right click a firebomb. The full
  table: `README.md`.

### 3.3 Immune to fire
The Lamplighter takes no fire damage anywhere; fire at the feet only warms the viewmodel. It is the first hint of the
truth.

### 3.4 Health and healing
- No healing in a night except **+10 % of max HP on each level-up** (`LEVEL_HEAL`). No hearts drop; Vigour adds max HP
  only.
- **One exception:** the Hearthblood skill heals while standing in fire on the ground (§10.4).
- HP, the tank and the firebombs are full at each nightfall. Survival grows through Hide, Cinder Ward and Iron Skin.

## 4. Weapons

### 4.1 The arsenal
Numbers: `WEAPON` in `src/sim/constants.js`. Slots: 1 Kestrel, 2 Blunderbuss or THUNDER ORGAN, 3 Ember Lance.
- **Kestrel** (flintlock pistol, id `pistol`), the start gun: hitscan, 18 damage, 4 shots/s, 8 rounds, pierces one.
- **Blunderbuss:** a card unlocks it, or its first upgrade carries it from nightfall; 10 pellets × 9 in a 9° cone.
- **Ember Lance** (flamethrower), a start weapon: a 100 tank that burns 14/s and refills after a pause, faster by a
  brazier; a kindle fills it. The jet arcs out to 11 m and lays a `stream` of fire where it lands; anything inside the
  airborne jet catches fire. Rain shortens it (§8.3).
- **Firebombs** (right click / G): 3 charges, one back every 7 s; they burst into fire and oil.
- **Sunburst** (Q): charged by 150 kills, a ring of fire from the player to 14 m.

### 4.2 The THUNDER ORGAN
A brass six-barrel rotary gun with a hand crank (`ORGAN` in `src/shared/meta.js`).
- Bought once from Brother Cinder for `ORGAN.cost`, 4,500 gold, priced so an average player affords it around their
  first reach of Nights V–VI. It takes slot 2 from the Blunderbuss; a toggle in his panel swaps back.
- Hold to spin up (0.45 s), then 20 rounds/s of 20 damage that pass through one goblin; a 300-round drum. After 6 s of
  fire it overheats into a 1.5 s lock that vents the heat, so a held trigger fires again.
- **Intent:** at level 1 the clear best slot-2 weapon for its gold, shredding the crowds of Nights V–VI. Its damage
  grows with its own line only (§4.3), not with Kestrel damage, so it cannot carry a save through the late nights.
- One sound while firing (§13). `?save=rich` owns it.

### 4.3 Upgrade lines
Brother Cinder sells weapon levels (`UPGRADES`); level k+1 costs `round(base × growth^k)` (`upgradeCost`).

| Line | Levels | Base × growth | Per level |
|---|---|---|---|
| Kestrel | 10 | 50 × 1.45 | +15 % damage, +8 % rate |
| Blunderbuss | 10 | 120 × 1.45 | level 1 carries it from nightfall; then +2 pellets |
| Ember Lance | 10 | 60 × 1.45 | +15 % tank, +15 % refill |
| Thunder Organ (once owned) | 10 | 450 × 1.3 | +8 % damage, +3 % rate, +8 % drum |
| Firebombs | 3 | 90 × 1.6 | +1 charge |

### 4.4 Guns and fire
Fire is the main killer. Guns have the jobs fire cannot do: the Ash Troll dies only to guns while it glows (§6.2);
brutes halve fire; spear-chuckers stand off; bats fly above ground fire; the Rainmother's lanterns must be shot out.

### 4.5 Hits and their effects
Each `EV.SHOT` pellet carries `surf` (what it struck). Organ rounds kick up dirt or sparks and leave brief marks; a
sweeping burst chews a line through the ground. Hits have hit-stop and sparks.

## 5. The horde

### 5.1 Enemy kinds
Base numbers: `ENEMY` (Night I; §5.7 scales them).
- **Grunt goblin** (22 HP) flows to the gate and fights the player in reach. **Imp** (12 HP) is fast and erratic.
- **Spear-chucker** stops 14–18 m from the player with a line of sight and throws visible, dodgeable spears.
- **Brute** carries a door as a shield: bullets from the front do ×0.25, fire ×0.5 (the door is wet).
- **Elites and Dousers** (§5.4), **Bat Gremlins** (§5.5), **Siege Rams** (§5.6), the bosses (§6).

### 5.2 Movement, the mound and the caps
- A flow field toward the gate (the road cheaper; walls, stair and towers block); separation by a spatial hash. A
  goblin within 6 m that can reach the player turns on them.
- Goblins pressing on the gate **pile into a mound**, flattened near a player on the ground. At most 20 attackers hurt
  the gate per tick (`HORDE.gateAttackers`), so a huge mound cannot break it in seconds whatever the player does; a
  burning attacker deals half.
- Spear-chuckers share a budget of spears a second (`SPEAR`): a volley, never a hail.
- **Alive caps** (`HORDE.cap`): 10,000 on `high`, 6,000 on `medium`, 3,000 on `low`.

### 5.3 Burning
`BURN` in `src/shared/fireops.js`. Heat ≥ 0.22 at the feet sets an enemy alight (4 damage a second, scaled by kind,
night, oil and fire damage). Burning enemies panic and drop embers, so fire spreads through the horde, sparsely enough
that a pile does not burn out in seconds. **Intent:** a burning grunt lives about 5.5 s on Night I and longer later;
crowds must be worked, not wiped.

### 5.4 Elites and Dousers
- **Elites** (bigger, gold-rimmed, name-plated): at most 3 per night from `NIGHTS[n].elites`; the coven's Hexers come on
  top (§8.2). The **Goblin Chieftain** bears a banner with a crossed-out lamp and speeds goblins near him; he always
  drops a charm. The **Hexer** keeps 13–20 m away and throws hexes that make the Lance sputter for 2 s; it drops a charm
  half the time.
- **Dousers** (from Night II) throw buckets at a lit trough or the nearest hot fire: the water douses it and stops
  goblins burning. They are trying to put the fire out.

### 5.5 Air: the Bat Gremlin
A goblin under a stitched bat-wing glider (`AIR`), on nights with `air` set: flocks of 3–6, at most 12 alive (doubled
on THE SWARM). It circles the Lamplighter and dives at them (a screech and a shadow warn) to hit for 6; it ignores the
gate. Guns and the Lance's airborne jet reach it, ground fire only during a dive; a burning bat crashes.

### 5.6 The Siege Ram
An oak trunk with an iron ram's head carried by eight goblins (`RAM`), from Night III. It walks the road to the gate
behind a war drum and swings every 2.5 s for 120 gate damage (scaled by night and crew left). Its HP is the crew's; it
slows as carriers fall. A burning crew stalls it; guns kill the crew.

### 5.7 Scaling by night
Every kind, the elites, bats and ram crews grow with the night (`NIGHT_SCALE`, `nightScale(n)`). Per night after the
first: HP +50 %, melee and gate damage +25 %, speed +3 %, fire damage taken −7 % (never below ×0.5). Night X goblins
have 5.5 × Night I's HP. Difficulty rises with the night and never adapts to the save.

## 6. The bosses

### 6.1 What every boss follows
- **Fixed HP per night** (`NIGHTS[n].trollHp`, `bossHp`), the same for every save, so a weak save is never let off
  easier. `bossPower` (`src/sim/run.js`) is an analytics number only.
- **No tanking:** 3–4 direct hits kill a Lamplighter with modest Hide (Hide 2: 130 HP, −10 %).
- **Fire opens, guns finish:** fire barely hurts a boss but heats it into a state where guns do ×3.

### 6.2 The Ash Troll
A 7 m pixel sprite with an ash hide (`TROLL` in `src/sim/constants.js`).
- **Arrival** at the night's times (`NIGHTS[n].trolls`), or early on the third kindle; one at a time, the next waits
  for the last to die. A short beat (horn, emergence, roar) while play goes on.
- **The hide:** fire does ×0.2. Standing in fire heats it; at full heat it **glows** red-hot for 4 s and guns do ×3.
- **Moves,** each telegraphed by sight and sound: **smash** the gate; **throw** a boulder where a distant player stood
  (a shadow marks it); **stomp** a player on the ground nearby; the **Ash Roar** every 20 s, a cone that douses the
  fire ahead and calls 30 goblins. It walks at a grounded Lamplighter within 8 m.
- **HP per troll** (`trollHp`): I 9,250 · II 10,000 · III 30,000 · IV 24,000 · V 30,000 · VI 37,000 · VII 46,000 ·
  VIII 74,000 · IX 61,000. `TROLL.hp` is only a fallback.

### 6.3 The Rainmother
The final boss of Night X (`BOSS` in `src/sim/boss.js`; HP `NIGHTS[9].bossHp`, 91,000): a 14 m river-giantess of dark
water, stones and moss, goblin shamans on her shoulders and six blue lanterns in her hair. Water against fire.
- She rises from the river at 0:30 and walks up the road; the storm comes with her (§8.3).
- **Tide** (100–66 %): waves down the road douse a line, knock back a grounded Lamplighter and bring goblins.
- **Downpour** (66–33 %): full rain; whirlpools that douse and pull; her shamans hex the Lance.
- **The Climb** (33–0 %): she strides straight up the slope at the gate, in full view of the wall walk. **If she
  reaches the gate, the night is lost.**
- In heavy fire she steams and **cracks** for 5 s: guns do ×3. Each lantern shot out removes a shaman and some rain.
- Her fall drops nothing and starts the ending (§12).

## 7. A night
Beat times: `TIMELINE` in `src/shared/timeline.js`, read by the sim, the cinema and the audio.
- **Modes:** `title`, `intro`, `play`, `cards`, `victory`, `fallen`, `camp`, `ending`. A first launch plays a 6 s
  intro; from the camp a 4 s beat shows the NIGHT card. Level-ups pause in `cards`.
- **The clock:** 5:00 (`NIGHT.dawnAt`). Spawns trickle for 20 s, then rise from 5 to 22 a second at 3:00 (`NIGHT`),
  × the night's `spawnMul`, × 1.6 while kindled, × 0.6 past 5:00; the kind mix shifts with the clock.
- **The beacon:** E at the pan kindles it: for 40 s spawns ×1.6 and XP ×1.5, the Lance refills, and a 1 s glance shows
  the flare. Cooldown 45 s (`NIGHT.kindleCd`). The third kindle brings the next troll early.
- **Oil:** troughs fill at nightfall, light at heat ≥ 0.3 and burn as walls of fire, then refill (`TROUGH`). Barrels
  burst at heat ≥ 0.5 or a shot, setting off neighbours (`BARREL`). Braziers are light, not fire.
- **Wind** (`WIND`) drifts with gusts and usually blows uphill toward the keep; the fire leans with it.
- **Dawn:** the clock at 5:00 and every troll of the night dead (until then the night holds at the edge of dawn). The
  horde flees, the fire is doused, the gold is banked; the card reads "THE WATCH HOLDS" (Night I) or "THE LAMP DRINKS
  THE NIGHT" (II–IX), then **TO THE CAMP**. Night X has no dawn (§6.3).
- **A fall:** the gate at 0 ("THE GATE IS BREACHED"), the Lamplighter at 0 ("THE LAMPLIGHTER FALLS"), or the
  Rainmother at the gate: slow motion, the card, **RETURN TO THE CAMP**; the run ends (§9.1).
- **Restart night** (P menu) replays the night as at nightfall; after a fall it starts a new run.

## 8. The ten nights

### 8.1 The table
`NIGHTS` in `src/shared/meta.js`. Every night is 5:00; the moon reddens night by night to black, a hint.

| Night | Title | Spawns × | Trolls (HP each) | Elites | The twist |
|---|---|---|---|---|---|
| I | — | 1.0 | 3:30 (9,250) | 2 Chieftains | — |
| II | BLOOD MOON | 1.35 | 2:30, 4:00 (10,000) | 3 Hexers | Dousers; Bat Gremlins |
| III | THE RAM | 1.45 | 3:30 (30,000) | 2 Chieftains | 3 Siege Rams |
| IV | WET WIND | 1.55 | 2:30, 4:00 (24,000) | Hexer | rain squalls; Dousers ×2 |
| V | THE SHIELD WALL | 1.65 | 2:30, 4:00 (30,000) | Chieftain | 4 phalanxes; spears ×2 |
| VI | THE SWARM | 1.75 | 2:30, 4:00 (37,000) | 2 Hexers | imp floods; flocks ×2 |
| VII | THE COVEN | 1.85 | 2:30, 4:00 (46,000) | — | 3 covens; bats |
| VIII | RAM AND ROAR | 2.0 | 2:30, 4:00 (74,000) | 2 Chieftains | 3 rams; bats |
| IX | THE LAST WATCH | 2.2 | 2:00, 3:20, 4:20 (61,000) | Chieftain, 2 Hexers | 2 rams, a phalanx, squalls, bats |
| X | THE RAINMOTHER | 2.3 | — | — | the Rainmother (91,000) and the storm |

Dousers are in the mix from Night II; every troll has the Ash Roar; the exact times are in `NIGHTS`.

### 8.2 The twists
- **Phalanx:** two lines of six brutes across the lower road, six spear-chuckers behind.
- **Coven:** three Hexers walk to a spot up the slope and chant for 20 s; unless one dies, the lamp is dimmed (no
  kindling) for 30 s.
- **Swarm:** imp floods and double flocks (up to 24 bats). **Rams:** §5.6. **The Rainmother:** §6.3.

### 8.3 Rain
`state.weather.rain` (0..1; `TWIST` in `src/sim/twists.js`). While it rains fire is weak: the fire module quenches and
draws smaller flames, the CPU fire grid decays fire and heat ×(1 + 1.2 rain), the Lance loses up to 20 % of its range,
and the fire light dims. **Squalls** (IV, IX) come and go; **the storm** (X) follows the Rainmother's phase and lightens
with each lantern shot out.

## 9. The camp and the run

### 9.1 The loop
```
first launch ──► NIGHT I ──dawn──► CAMP ──begin──► NIGHT II ──dawn──► CAMP ──► … ──► NIGHT X ──► ENDING
                   └──fall──► CAMP (a new run at Night I) ◄──fall── any night ◄──┘
```
- A first launch goes straight into Night I; every later start goes to the camp.
- **A run** is Nights I–X; level, XP, cards and towers carry through it. **A fall ends the run:** they reset and the
  next night is Night I.
- **Kept forever:** banked gold, upgrades, charms, the Organ, the best night and story flags.

### 9.2 The camp
- Dusk at the keep: no enemies, free movement; the HUD shows the gold and the next night.
- **Brother Cinder**, a small hooded figure with ember-glow eyes, keeps a stall on the west plaza. E opens his panel
  (Upgrades, Charms); he speaks in short, ambiguous lines (`docs/STORY.md`). A marker over his head, readable across the
  plaza, brightens when the gold covers something he sells.
- **Pads:** E at one of six rune circles builds or upgrades a tower (§9.6).
- **BEGIN NIGHT N** (a button; N or Enter) or E at the lamp's pan starts the night; a tip line names both. The first
  camp of a save shows a three-step tip. Purchases apply at nightfall.

### 9.3 XP, gold and charms from kills
- Every kill spills an XP gem; some spill coins (`DROPS`). Both fly to the Lamplighter after 0.6 s, so the wall walk is
  never starved. Kindled kills give ×1.5 XP.
- Every coin chance is halved by `LOOT.goldMul` (0.5), so an upgrade costs several nights of gold.
- Gold is **banked** at dawn, on a fall and at the ending, pickups in flight first: it is never lost.
- **Charms** drop from Chieftains (always) and Hexers (half the time), preferring ones not yet owned.

### 9.4 Brother Cinder's shop
Besides the weapon lines (§4.3) and the Organ (§4.2): **Hide** (5 levels: +15 max HP, −5 % damage taken), **Gate**
(4: +15 % gate HP) and **Charm slot** (2: +1 slot), each ×1.6 dearer per level.

### 9.5 Charms
Kept once found; they work while equipped (2 slots, 4 with upgrades); a duplicate gives 30 gold. `CHARMS`: Ember Tooth,
Coin Hook, Ashen Step, Bellows Heart, Cinder Ward, Soot Lens, Kindle Knot, Spark Bead and Witchfire Wick (a green
Lance).

### 9.6 Towers
Built and upgraded only at the camp; they last the run. Invulnerable and solid. Five levels each, **weak at first and
great after upgrades** (`TOWERS`).
- **Black Obelisk:** a black needle with a molten core pulsing a violet fire nova: real fire on its ring, damage inside.
- **Chain Imp:** an imp on a perch throwing chained hooks at goblins within 16 m, brutes and elites first; each hook
  slows, pulls and hurts. Pull them into the nova.

### 9.7 The save
`localStorage` key `valleyward.save.v1` (`SAVE_KEY`); every access in try/catch, memory in Node; `normalizeSave`
validates it. It keeps the permanent items of §9.1, `ended`, and the run in progress between nights, so a reload
resumes at the camp. Presets (`?save=fresh|mid|rich|late|endgame`): `README.md`.

## 10. Level-up cards and skills
The pool: `CARDS` in `src/sim/cards.js`.

### 10.1 Levelling
The next level costs `XP_NEXT(L)`, 100 × (L − 0.2), plus 12 % per level past 12 (`XP_GROW`) so cards snowball less late
in a run. A player holding the wall gets about 8–12 level-ups on Night I. Each heals 10 % (§3.4) and pauses on three
cards.

### 10.2 Offers
- Three distinct eligible cards, drawn with the seeded RNG. **Stat cards** can be taken up to their max.
- **Skill cards** come in pairs: the **unlock** card (NEW SKILL) only while the skill is not owned; then its
  **upgrade** card (LV n → n+1) until the skill's max. One offer never holds two cards of the same skill.
- Blunderbuss cards are not offered while the Organ holds slot 2.

### 10.3 Stat cards
Heavy Shot (Kestrel damage +25 %), Quick Hammer (Kestrel rate +20 %), Blunderbuss (unlock), Grapeshot (+3 pellets),
Long Nozzle (Lance range +20 %), Deep Tank (tank +30 %), Bellows (refill +35 %), Bandolier (+1 firebomb), Black Powder
(firebomb radius +25 %), Magnetism (pickup reach +50 %), Vigour (+20 max HP), Mason (gate +25 % HP), Kindled Heart
(Sunburst 30 % faster), Iron Skin (damage taken −8 %), Kindling (fire damage +12 %), Fleet Foot (speed +8 %).

### 10.4 Skills
Numbers: `SKILL` in `src/sim/constants.js`.
- **Contagion:** burning goblins drop embers twice as often. **Pitch-soaked:** bullets oil goblins; they burn ×2.
  **Wildfire:** fire lasts longer and spreads faster.
- **Cinder Steps** (3 levels): the footsteps burn at any speed (lilac): a wake on the ground; on the wall walk, cinders
  fall over the parapet and light the foot of the wall, where the goblins batter the gate.
- **Ember Gale** (3): every 14 / 11 / 8 s a hot gust sweeps downhill from the keep: the fire leans and flares toward the
  horde, and goblins near the wall are pushed back and stagger. A visible, regular fire beat.
- **Hearthblood** (3): heals 2 / 3 / 4 HP/s **only** while standing in fire on the ground (never on the wall walk).
  The goblins make it a risk, the Lance's fuel limits it, and roars, Dousers and rain put it out.
- **Ember Orbit** (3): 1–3 blue fireballs circle the Lamplighter, burning what they touch.
- **Brimstone Rain** (2): a green meteor on the densest crowd every 8 / 6 s.
- **Pyre Burst** (3): fire kills burst (50 / 75 / 100 %), igniting neighbours in chains; at most 24 bursts a second.

## 11. Fire as a game element

### 11.1 Fire ops
The sim asks for fire; it never draws it. Each tick it fills `state.fireOps` with Fire API v1 events (re-exported by
`src/shared/fireops.js`): `stream` (the Lance), `burst`, `fuel` (oil), `ember` (small sources), `push` (air),
`douse` (water) and `swirl` (whirlpools), within `FIRE_CAPS` per tick.

### 11.2 What burns
Gameplay reads `{ heat(x, z), fuel(x, z) }`: the `ground` module's gameplay grid when fresh, else the CPU fire grid
(§14.6). Thresholds: enemies 0.22, troughs 0.3, barrels 0.5; trolls heat and the Rainmother cracks in fire. The
Lance's airborne jet does its damage along the sim's own arc, whatever module draws it.

### 11.3 Fire and water
Fire comes from the Lance, firebombs, oil, barrels, burning enemies, the Sunburst, the Obelisk and the fire skills.
Water fights it: Dousers, the Ash Roar, the Rainmother's tides and whirlpools, rain; dawn and the camp douse all.

### 11.4 Wind and spread
The fire drifts with the wind (§7) and spreads through the horde by embers (§5.3).

### 11.5 Coloured fire
Some sources burn in their own hue (`HUE_OF`): **violet** for the Black Obelisk, **blue** for Ember Orbit, **green** for
Brimstone Rain and the Witchfire Wick Lance, **lilac** for Cinder Steps; the rest orange. The hue travels with the fire
and blends where hues meet; each hue has its own ramp in both styles, and its light and embers take it. Gameplay and the
CPU grid ignore it. Warm colours belong to fire alone; the other hues appear only as fire and its light.

### 11.6 The fire's look and the reference module
The reference module is Firewraith's `classic` (`classic-webgpu` in WebGPU); details in its `FLUID.md`.
- A grid fluid over `ARENA.fluid` (64 × 64 m; velocity 256², scalars 512² on `high`): advection, vorticity confinement,
  warm-started Jacobi pressure (16 iterations on `high` and `medium`, 10 on `low`), combustion, GPU embers.
- A ray-marched volume up to about 4 m, depth-tested, lit by the fire and the moon, thinned near the camera.
- `smooth` is a continuous ramp with soft curls; `hybrid` is the same shapes on a pixel grid with a stepped six-colour
  ramp and dithering. `?fire=` and the P menu switch live.
- A light map lights every material (`src/shared/firelight.js`); a 64² grid is read back asynchronously, ≤ 2 frames old.

## 12. The ending
About 56 s after the Rainmother's fall (`TIMELINE.ending`; the shots in `docs/PRES.md`).

### 12.1 How it plays
Letterboxed; the cinema owns the lens. The first ending of a save cannot be skipped; later ones after 3 s. The story's
rule against "demon", "hell" and "summon" ends at its card.

### 12.2 The flood and the lamp
She collapses; the rain stops. The beacon's flame turns black-red and swells into a pillar, and the sky above the keep
tears open into a portal of fire.

### 12.3 The world changes
A red-black grade, a black moon with a red corona, pines burnt to black spikes, ash, lava cracks, embers like snow.

### 12.4 The host
The gate opens from the inside; hundreds of horned silhouettes march down into the valley; the goblins flee.

### 12.5 The reveal
The gloves burn away to black claws. The camera pulls out and around to a low frontal angle: a towering horned demon
(about 5 m; burning eyes, a ruined lamplighter's coat, wings of smoke and fire) on the wall walk, the portal behind,
roaring. Like every creature here it is a pixel sprite, wrapped in live fire.

### 12.6 Brother Cinder
He kneels at the foot of the wall and speaks his last line, voiced: "Welcome home, Master."

### 12.7 The hunt
A wide crane over the burning village: animals bolt, mothers carry children and elders run for the trees, and the host
gives chase into the forest. Seen from afar in silhouette, it cuts to black before anyone is caught; no harm to the
children is shown.

### 12.8 Credits and the end card
On black: VALLEYWARD, then "Directed by AL", with the lamp's last crackle. Then **THE WAY IS OPEN** / "Ten nights. The
lamp will never go out.", the run's stats and **Play again**.

### 12.9 After the ending
Nothing else persists: the save records `ended` and the best night; no changed world, no new game+.

## 13. UI rules
The HUD, panels, FX and cutscenes: `docs/PRES.md`. Colours and fonts: `docs/ART-DIRECTION.md`.
- **No crosshair.** Aim reads from the weapon; a hit shows as a small "×" flash at the world impact point, never at the
  screen centre.
- **Words:** every text follows `docs/STORY.md`. Nothing says "demon", "hell" or "summon" before the ending card; the
  beacon is "the lamp", and the internal Hellfire Obelisk is "the Black Obelisk" on screen.
- **Text:** one toast and one banner at a time, never in the centre; modals hide them. Panels fade in 0.14 s, never
  through black.
- **Sound:** one sound per gun. The Organ is a single seamless firing loop; ground hits add no sounds (`docs/AUDIO.md`).

## 14. Architecture and contracts
More detail: `docs/CORE.md`, `docs/FLUID.md`, `docs/WEBGPU-PORT.md`.

### 14.1 Stack and editions
- three.js r186 in a **WebGL2** (GLSL) and a **WebGPU** (TSL) edition that share everything but the shading
  (`src/gfx/`). `?gpu=` picks one, else the fire modules' backend, else WebGL2. Runtime dependencies: `three` and
  `firewraith`; no physics library.
- A 60 Hz fixed step, at most 8 steps a frame. The sim (`src/sim/`) is pure JS with a seeded RNG, no three.js and no
  DOM: deterministic in Node with the CPU fire grid.

### 14.2 Files
`src/main.js` wires everything; `src/sim/` and `src/bot/` are the game and its player; `src/shared/` holds the
contracts (`arena.js`, `events.js`, `fireops.js`, `meta.js`, `timeline.js`); `src/fire/` is the fire host; the rest of
`src/` is presentation. Per file: `docs/CORE.md`.

### 14.3 Module interfaces
- Each part is a dynamic `import()` in try/catch (`src/core/modules.js`); when one is missing or throws, the greybox or
  a no-op stands in, and `__ew.modules()` says why.
- Factories: `createFire`, `createEnvironment`, `createLook`, `createActors`, `createFx`, `createCinema`, `createUI`,
  `createAudio`; parts react through `update(dt, state)` and `onEvent(ev, state)`. The look owns the render targets and
  takes the fire pass and the viewmodel.
- `assetsBase` is `import.meta.env.BASE_URL + 'assets/'`, never a web-root URL. Scripted beats come only from
  `src/shared/timeline.js`.

### 14.4 The sim state
```js
const sim = createSim({ seed, quality, god, cap, spawnScale, storage, save });
sim.step(input); sim.drainEvents(); sim.command(cmd); sim.setFire(provider);
state = { t, tick, mode, modeT, night, player, gate, troll, boss, rams, air, elites, weather, horde /* typed arrays */,
  pickups, bombs, spears, boulders, troughs, barrels, wind, fireOps, cards, taken, mods, stats, camp, meta, run, … }
```
`state` is read-only for every other part; `fresh()` builds a new one per night and camp, so never cache `sim.state`.
Horde slots are stable ids. Commands apply at the next tick; one seed replays a whole campaign.

### 14.5 Events
Events (`{ type, t, ...payload }`) are drained once per frame and handed to every part. `EV` in `src/shared/events.js`
is the catalogue: add types, never rename or remove one. Busy types are batched per tick.

### 14.6 The fire host and the fire provider
- **The host** (`src/fire/index.js`) fills two slots, `lance` and `ground` (`?lance=`, `?ground=`, `?firemod=`); the
  edition's reference module takes over the slots of a failing module. Each frame it takes the ops and wind, steps
  with game time and rain, and renders `ground` then `lance` in the fire pass.
- **The provider** (`sim.setFire`): the `ground` module's gameplay grid once fresh (≤ 8 frames old), the CPU fire grid
  while it is stale (> 30 frames) or missing; Node has only the CPU grid.
- **The CPU fire grid** (`src/sim/fireproxy.js`): 64 × 64 cells of 1 m with fuel, fire and heat, fed the same ops,
  drifting with the wind, quenched by rain, run every step. `__ew.fireCompare()` (`?debug=1`) compares the two.

### 14.7 Render order
1. The world (environment, alpha-tested depth-writing sprites, FX) into a target with depth.
2. God rays from the sky near the moon (at the camp, the low sun).
3. The fire pass composites the fire (skipped if the fire failed).
4. The viewmodel with its own camera, depth cleared.
5. Bloom, then one output pass: exposure, grade, tone map, dawn grade, vignette, hurt edge, flash. No SSR, TAA or DOF.

### 14.8 Hooks, URL parameters and presets
Tools, tests and captures drive the game through `window.__ew` and URL parameters (`README.md`; checked by
`tests/static.test.mjs`). For the campaign: `?night=1..10`, `?save=late|endgame`, `?ending=1`, `__ew.goto(...)`.

## 15. Performance budgets
Reference: a production build in Chrome at 1920 × 1080 on `high` on an Apple M4. `npm run perf`; results in
`docs/CORE.md`.

### 15.1 Frame
60 fps, never below 45; p95 ≤ 20 ms in the busiest moment (the troll, 2,000 goblins, a burning trough, the Lance, a
firebomb); no stall over 50 ms; ≤ 300 draw calls, ≤ 1.5 M triangles, a constant light count. A 60 fps cap gives a
120 Hz display even frames; behind a modal the world draws at 30 fps. `high` draws at most 1920 × 1080 pixels.

### 15.2 Start and loading
Every shader, the fire's included, is warmed before control, spread over frames. What the first minute needs loads
first, the sounds after the start. The worst frame in the first 20 s, and any hitch at the first kindle, the first
troll or the ending, stays ≤ 50 ms. Loading is checked on 40 and 15 Mbps.

### 15.3 Fire
≤ 4.5 ms of GPU time for the fire's simulation, volume and embers on `high` at 1080p.

### 15.4 Crowd and effects
≥ 6,000 alive hold 60 fps on `high`; the caps (§5.2) size the actors' buffers. Far goblins (over 34 m from the player
and 26 m from the gate) step every other tick, the sim allocates nothing per tick, only live instances are uploaded,
and events are batched. Ground-hit effects stay ≤ 0.3 ms at the Organ's full rate.

### 15.5 Assets
Shipped assets ≤ 60 MB, each file < 20 MB; textures WebP or KTX2 ≤ 1024 px; a relative base.

## 16. Balance
Balanced with the CPU fire grid and the `classic` fire; a `ground` module that decides what burns may shift it.

### 16.1 Principles
- Difficulty rises with the night and never falls for a weak save (§5.7, §6.1).
- Progress comes from gold: the run's cards must not outgrow the night scaling.
- A player who stops buying hits a wall within two or three nights.
- An average player falls about once per night before beating it. With the restart rule, that makes a long campaign
  (about 55 nights to first reach Night X): the wall and the fall rate come first, and the length is reported, not
  targeted.
- Fire lands most killing blows (over 90 % is fine); guns stay necessary (§4.4).

### 16.2 Targets

| Measure | Target |
|---|---|
| Fresh save, Night I | noisy bot 40–60 % of seeds; perfect bot ≥ 8/10 with 8–12 level-ups |
| Night II from the `mid` save | a wall: noisy ≤ 3/10, perfect ≥ 2/10 |
| The wall after first clearing Night N (N = 1, 3, 5, 7), buying nothing more | N+1 ≤ 30 % (40 % tolerated), N+2 ≤ 10 %, N+3 ≈ 0 % |
| Attempts per night until its first clear (noisy) | mean ≥ 2, spread across nights, none ≥ 3.5 |
| The threat curve | each night harder than the last for the same save; no spikes, no dips |
| The perfect bot | reaches Night X in fewer nights than the noisy bot |
| The THUNDER ORGAN | bought around the first reach of Nights V–VI (noisy, median); the wall no worse with it |
| Fire and guns | a bot without fire, or without guns, loses every night |
| Nights end | no stuck state in a 20-night browser soak at speed 4 |

### 16.3 How it is measured
- **Bots** (`src/bot/bot.js`): the perfect bot and the **noisy bot, the human reference** (the same decisions 250 ms
  late, with aim noise); variants without fire or guns. Both shop by the same plan.
- Node, the CPU fire grid, seeds 1–10: `tools/qa/balance.mjs` plays nights per policy; `tools/qa/campaign.mjs` plays
  whole campaigns (10 noisy to 80 nights, 3 perfect), and `--wall` replays from a snapshot without buying.
  `tools/qa/nights.mjs` and `soak.mjs` check that nights end. `npm test` pins the current balance.
- Results, including targets not yet met: `docs/CORE.md` ("Balance").

## 17. Quality targets

### 17.1 Play
- A night plays to dawn or a fall; restart needs no reload; 0 console errors. `npm test` and `npm run e2e` pass.
- The loop works end to end: dawn, the camp (buy, build, equip), the next night; a fall returns to Night I with towers
  cleared and gold kept; a reload keeps everything permanent.
- Every verb has its own animation and sound; every boss move is telegraphed by sight and sound.

### 17.2 Fire
In both styles the fire is live: the stream curls and pools, bombs bloom, troughs burn as walls, the horde spreads it,
the wind leans it, and it lights walls, ground and sprites. A `?debug=1` capture shows the read-back matching it.

### 17.3 Crowd
Thousands of goblins (≥ 2,000 in the busiest scene, ≥ 6,000 under stress) move as a horde, pile at the gate and burn
within the §15 budgets.

### 17.4 Look
From the `m1` and `m2` views the game matches the key art M1 and M2 in both styles (`npm run shots`, `npm run sbs`),
not darker or greyer: the frame mean stays close to the mockup's.

### 17.5 Campaign and story
The e2e covers every night's twist, a Night X boss kill with `god=1`, and the ending beat by beat to its card. The
`docs/STORY.md` hints are in the game; nothing says "demon" before the ending card. No black frames on any transition.
