# AUDIO · VALLEYWARD

The game's sound: a Web Audio engine that turns the simulation's events and state into music, ambience, sound effects
and one spoken character, plus the build that makes the sound files.

Every sound was made with ElevenLabs (sound effects, music, and a Voice Design voice for Brother Cinder), except six
small procedural sounds made in Node (`xp_tick`, `coin_tick`, `ui_click`, `card_hover`, `ui_begin`, `w_dry`), the
credits theme (made from the camp music) and the procedural punch layered under the two gun shots.

**The audio files are not in this repository.** They were generated with ElevenLabs under the authors' licence, so
the set stays private: `.private/audio/` (gitignored) or the folder in `VALLEYWARD_AUDIO_DIR`. `tools/vite-audio.mjs`
serves it on the dev server and copies it into a build when it is present. Without it the game builds and plays
silent: `__VW_AUDIO__` is false, so the engine never requests a file. The engine, the sound bank, the prompts
(`assets-src/audio/jobs.mjs`) and the build are all here, so a set can be made again with your own ElevenLabs key.

**Files**

| Path | What |
|---|---|
| `src/audio/index.js` | the engine: `createAudio()`, the voice pool, beds, music, the event map, loading |
| `src/audio/bank.js` | the sound bank: every id and how it plays (`SOUNDS`), Brother Cinder's lines (`VOICE_LINES`), bus levels (`BUS_DB`), music crossfade times (`XFADE`). Pure data; the build reads it too |
| `.private/audio/` (not in the repo) | the audio set: `music/`, `sfx/`, `voice/` (Opus in WebM, 48 kHz), `manifest.json` (id → files, loop points, beat grid, content hash), `provenance.json` (one note per file: tool, prompt, request, raw take, sha256) |
| `assets-src/audio/` | the asset build: `jobs.mjs` (every prompt), `build.mjs` (processing), `check-engine.mjs` (Node check), `gunmeasure.mjs` and `loopseam.mjs` (measurements), `calls.json` (the call ledger), `raw/` (takes; binaries gitignored, receipts kept) |
| `preview/audio.html`, `preview/audio.js` | the audio bench: every sound, event and music state on a button |

**Size:** 136 sound ids in 185 files, 7.59 MiB (music 16 files 5.00 MiB, SFX and beds 161 files 2.34 MiB, voice 8 files
0.25 MiB). The largest file is `music/mus_kindle.webm` at 743 KiB. The budget is 8 MiB for the set and 2 MiB per file
(the build warns over 2 MiB).

---

## 1. How the game uses it

`src/main.js` loads the module with a dynamic `import()` in a try/catch, like the game's other parts. If the module or Web
Audio is missing, a silent stand-in with the same shape takes its place.

```js
const audio = createAudio({ assetsBase });       // at load: the AudioContext is created now, suspended
audio.unlock();                                   // on the first gesture (the title click, any key or pointer)
for (const ev of events) audio.onEvent(ev, state);   // every rendered frame, the frame's drained sim events
audio.update(dt, state, listener);                // every rendered frame, after the camera
audio.setFire(sim.fire);                          // the fire field: anything with heat(x, z)
```

- **Listener:** `{ x, y, z, yaw }` with yaw in the arena convention, forward = (sin yaw, cos yaw), as `state.player.yaw`
  and `src/shared/arena.js`. A forward vector `{ fx, fz }` wins over `yaw` (the cinema uses it). A three.js camera's
  `rotation.y` (which looks down −Z) would swap left and right.
- **The context is never suspended by the game.** Pauses, the menu, the level-up cards, Brother Cinder's panel and the
  dawn and fallen cards all hold the simulation, but the audio keeps running and muffles its own mix from the state
  (`state.paused`, `mode`, `state.camp.panel`). That way the dawn music and the fallen sting play under their cards.
  `syncPause()` in `main.js` only calls `resume()`; the game never calls `pause()`.
- **Volume:** `setVolume(v)` sets the master gain to v² (0..1). `?mute=1` mutes (the module reads it, and `main.js` also
  sets the volume to 0).
- **UI sounds without the audio handle:** `dispatchEvent(new CustomEvent('ew:ui', { detail: { sound } }))` with `hover`,
  `click`, `open`, `close`, `tab`, `begin`, `pick`, `levelup`, or `stall`, `buy`, `equip`, `unequip`, `build`,
  `upgrade`, `deny`. The UI sends only `hover`, `click`, `open`, `close` and `tab`: the shop, charm and tower sounds come
  from the simulation's own events, so the UI must not send those too.
- **A line by DOM event:** `dispatchEvent(new CustomEvent('ew:say', { detail: { line: 'home' } }))` plays a Brother
  Cinder line and writes its length into `detail.seconds` synchronously (for subtitle timing).
- **Other calls:** `play(id, { x, z, db, rate, delay, variant, offset })` (no rate limit), `want(id, pos, db, rate,
  delay, variant)` (rate-limited, what `onEvent` uses), `ui(name)`, `say(line)` → seconds, `lineSeconds(line)`, `lines`
  (= `VOICE_LINES`), `music(name)` (a manual music state that holds until the state's own choice changes), `ready()`
  (resolves when every file has decoded), `stats()`, `dispose()`.
- **Debug:** `window.__ewAudio` is the API. `__ewAudio.stats()` reports the context state, the music, files loaded and
  failed, the load queue (`load: { started, why, mode, workers, maxInFlight }`), voices in use, plays and drops per id,
  every bed's level, the organ, the bats, the percussion layers, rain, the ending's cues fired and more.
  `__ewAudio._fetchLog()` lists the files in the order they were requested.

## 2. The engine (`src/audio/index.js`)

**Signal graph.**
- Buses (`BUS_DB` in `bank.js`): music −4 dB, ambience −6 dB, SFX 0, UI −2 dB, voice −3 dB.
- music → duck → low-pass → master; ambience → duck → shot dip → master; SFX, UI and voice → master.
- Stingers and the ending's score cues have their own bus at the music level, so they ride over the music's duck.
- master (volume²) → a limiter: `DynamicsCompressor`, −3 dB threshold, 20:1, 2 ms attack, 150 ms release.
- **Space:** one `ConvolverNode` with a generated 0.9 s stereo impulse response for a hilltop outside a stone keep (wall
  slaps at about 22, 48 and 83 ms, then a tail that darkens as it decays; `makeHillIR`). The SFX bus sends 0.1 into it
  and the far path 0.35, so distant sounds are wetter (`sendNear`, `sendFar`).

**One-shot voices.**
- A fixed pool of 40 voices (`POOL`): source → gain → stereo pan → a near/far split. The far path is low-passed at
  2.6 kHz and blends in from 14 m to 50 m.
- Spatial sounds (`spatial: true` in the bank) are attenuated by `ref / (ref + roll · (d − ref))` beyond `ref` metres and
  panned by the listener's yaw, at most ±0.8 (narrower within 3 m).
- A new sound takes a free voice, or steals the quietest-oldest one if it is louder, with a 6 ms fade (no click).
- Per id, from `bank.js`: `max` concurrent voices (the id's oldest is stolen), `rate` starts per 100 ms, `gap` seconds
  between starts, `pitch` (± semitones of random jitter), `vary` (± dB of random jitter), `gain` (dB on top of the
  normalised file).
- `onEvent` never plays directly. It queues requests (`want`, a fixed pool of 384), and they are flushed once per frame in
  a microtask: per id, the loudest after distance win up to the id's allowance, the rest are dropped.
- Variants are picked at random, never the same one twice in a row.

**Beds.** 17 persistent loop channels (`BEDS`) that are never stolen. Their gains glide to targets computed in
`update()`; a bed starts when its level first rises above zero (or when its file lands).
- The horde is scanned every 0.1 s over the simulation's typed arrays (no allocation): goblins within 14 m drive
  `crowd_near` (panned to their side), those from 14 m to 60 m (and, weighted 0.35, those farther) drive `crowd_far`,
  burning goblins within 25 m add to the fire, and the nearest Bat Gremlin drives `bat_flap`.
- The fire level is computed every 0.15 s from lit troughs, the braziers, burning goblins and the fire field's `heat()`
  sampled at 8 points around the listener. It crossfades `fire_low` → `fire_mid` → `fire_high` and pans (±0.7).
- Rams, whirlpools and the coven are scanned every 0.1 s too.
- `update()` allocates nothing per frame.

**Music.** Loop players with `loopStart`/`loopEnd` from the manifest. A switch crossfades (times in `XFADE`). When both
loops carry a beat grid at the same tempo (within 2 %), the new loop starts on the old one's beat phase. A state whose
file has not decoded yet starts when it lands. Section 3 has the states.

## 3. Music

All music was asked for in D minor at 92 BPM. Every loop came back at a measured 91.97–92.02 BPM, so the loops are cut
on whole 4-beat bars and any two of them crossfade on the beat. The manifest stores each loop's grid (`bpm`, `beat0`).

**The state follows the game by itself** (`autoMusic`):

| Game state | Music |
|---|---|
| title | silence |
| camp | `camp` |
| intro, play, cards: the Rainmother risen and alive | `rain` |
| …a living Ash Troll | `troll` |
| …a kindle running (the sim's `night.kindleT`, else 40 s after `EV.KINDLE`) | `kindle` |
| …otherwise | Night I `night`, Night II `night2`; Nights III–X alternate (odd `night`, even `night2`) with percussion layers |
| victory (dawn) | silence, then `dawn` (one-shot) at the dawn timeline's `quiet` beat (4.0 s) |
| fallen | silence; the fallen sting at the fallen timeline's `card` beat (1.4 s) |
| ending | no base music: the ending's cues are its score (below) |

The order of the checks is the priority: the Rainmother over the troll over a kindle over the night.

**Crossfades** (`XFADE`, seconds): night or night2 → kindle 1.5; kindle → night or night2 4; → troll 2; → dawn 3;
→ camp 3; camp → night or night2 2.5; night → night2 3; → rain 4; rain → silence 1.2; → silence 2; anything else 2.5.

**The night card sting** (`mus_nightcard`) plays once per night card: on the intro's `card` beat (4.9 s), on
`EV.NIGHT_TITLE`, or when play starts after a skipped intro; requests within 4 s are merged. It gets lower and slower
night by night: 1.0× on Night I, 0.94× on Night II, then 0.012 lower per night down to 0.86×, and 0.84× on Night X.

**Percussion layers** (`LAYER_BY_NIGHT`): two mono loops over the night loop on later nights.

| Night | I–II | III | IV | V | VI | VII | VIII | IX | X |
|---|---|---|---|---|---|---|---|---|---|
| `mus_perc_a` (war drums) | 0 | 0.6 | 0.7 | 0.85 | 0.6 | 0.7 | 0.85 | 1 | 1 |
| `mus_perc_b` (heavier battle percussion) | 0 | 0 | 0 | 0 | 0.6 | 0.7 | 0.85 | 1 | 1 |

- A layer starts on the base loop's beat phase and keeps its own position in the bar.
- The loops are whole bars only to within about 30 ms, so the base loop's beat grid shifts a little at each wrap. Every
  frame (arithmetic only) the engine compares the two beat phases and restarts the layer with a 10 ms crossfade when they
  differ by more than 15 ms.
- The layers play only over `night` and `night2`: they fade out under `kindle`, `troll` and `rain` and come back on the
  beat.

**The mix while the game waits** (the menu, the level-up cards, Brother Cinder's panel): the music is low-passed to
1.1 kHz and the ambience drops to 0.4 (≈ −8 dB). UI sounds still play. A fall low-passes the music to 420 Hz and ducks
it 5 dB.

**Ducks.** Big moments duck the music for a moment: a kindle −3 dB, the Sunburst −4 dB, the gate breached −8 dB, the
troll's death −6 dB, the Ash Roar −4 dB, the Rainmother's rise −4 dB, the Chieftain's horn −3 dB, a stinger −6 dB (the
fallen sting −12 dB), Brother Cinder's lines −7 dB for their length (the ambience −6 dB too).

**The ending** (mode `ending`, timed to `TIMELINE.ending` in `src/shared/timeline.js`, or to the sim's
`'ending.beat' {id}` events). Each kind of beat fires once (`ENDING_CUES` matches beat ids by keyword):

| Time | Beat | What plays |
|---|---|---|
| 0 s | flood | the Rainmother's collapse (−3 dB) and a steam hiss, then silence |
| 5 s | lamp | the kindle roar at the basket; the dark choir (`mus_end_portal`) starts rising |
| 8 s | portal | the sky tears open (`portal_rip`) |
| 12 s | world | the burning wind bed (`hell_wind`) comes in |
| 18 s | host | the keep's gate opens from inside (`gate_open`), then the host's march bed (`host_march`) |
| 25 s | gloves | the gloves ignite (`gloves_ignite`) |
| 29 s | reveal | the brutal swell (`mus_end_reveal`) |
| 34 s | roar | the roar (`demon_roar`), the loudest sound in the game |
| 37 s | cinder | "Welcome home, Master." (once, though the beat and the sim's `NPC_LINE` both ask); the score dips under him |
| 42 s | hunt | the quiet coda (`mus_end_hunt`), fleeing animals; the wind and the march drop to 0.6 and 0.5 |
| 50 s | black | a hard cut: the score and both ending beds stop |
| 50.5 s | credits | the credits theme (`mus_end_credits`) with the lamp's last crackle |

Each score cue fades the previous one. The fire beds stay on; the crowd and rain beds go silent. Leaving the ending
(Play again) fades everything out.

## 4. What plays on which event

Events are `EV.*` from `src/shared/events.js`, or the dotted string events the simulation sends for later features.
Positions make a sound spatial when its bank entry says `spatial`.

**The Lamplighter and the weapons**

| Event | Sound |
|---|---|
| `SHOT` | exactly one voice: `w_kestrel_shot` (pistol) or `w_blunder_shot`, plus a dip of the beds (−4 dB for 80 ms, −6 dB for 150 ms; recovers with τ 120 ms). A pellet with `hitId < 0` (a gun hits a Bat Gremlin) adds `hit_flesh` at 1.15×. The THUNDER ORGAN: see below |
| `RELOAD` / `DRY` / `WEAPON_SWITCH` | the weapon's reload, its rate fitted to `seconds` (0.9–1.3×; the organ reuses the blunderbuss reload) / `w_dry` / `w_switch` |
| `LANCE_ON` / `LANCE_OFF` | `w_lance_ignite` and the `w_lance_loop` bed on (40 ms) / the loop off (60 ms) and `w_lance_stop`. The loop also stops when the weapon changes or the mode leaves `play` |
| `HEX {hit}` | a hit: `hex_zap` on the player, `lance_sputter` if the Lance is out, and the spraying Lance loop chokes for 2 s (random dips every 60–130 ms, also while `state.player.sputterT > 0`). A miss: `hex_zap` where it lands |
| `P_STEP` / `P_JUMP` / `P_LAND` | `step_stone` on the wall walk (y > 4.3), `step_timber` on the stair, else `step_earth`; louder and faster when running; a jump is quieter, a landing heavier |
| `P_HURT` / `P_DEATH` | `p_hurt` (+2 dB at 20 damage or more) / `p_death` |
| `P_HEAL` | `heart`; from `source: 'hearthblood'` (healing while standing in fire) a quiet tick instead (−10 dB, 0.92×), at most once per 3 s |
| `GALE {level}` | one `gale_gust` (+1 dB and −3 % pitch per level), at most one per 4 s; the fire beds swell by up to 35 % over the gust's `seconds` |

**The THUNDER ORGAN** (the rotary gun). It plays one seamless firing loop (`organ_loop`, 18 rounds/s) while the
trigger is held, and nothing per round.
- `'organ.fire'` starts the loop at once (4 ms rise, the first round already in it).
- Each `SHOT {weapon: 'organ'}` keeps it alive for 85 ms and re-arms a −3 dB bed dip; it starts no voice.
- When the sim publishes `state.player.organ.firing`, that wins, so a lost `'organ.stop'` can never leave the loop on.
- `'organ.stop'`, the release, a weapon switch, a reload or leaving `play` fade it out with τ 25 ms (≈ −40 dB in
  115 ms). There is no tail sample.
- `'organ.overheat'` plays `organ_overheat` (steam hiss and cooling pings); `'organ.equip'` plays `w_switch`;
  `'organ.spin'` is silent.
- A `SHOT` carrying `rps` sets the loop's rate to `rps / 18` (0.8–1.45×) for an upgraded fire rate.

**Pickups, camp and UI**

| Event | Sound |
|---|---|
| `PICKUP {kind: 'xp'}` | `xp_collect` (fallback `xp_tick`), climbing a pentatonic ladder (`LADDER`: 0 2 4 7 9 12 … 24 semitones) while pickups come within 0.55 s |
| `PICKUP {kind: 'gold', count}` | the procedural `coin_tick` up the same ladder, louder for bigger batches (fallback `gold`) |
| `GOLD_DROP {n}` / `XP_DROP` | `coin_spill` at the kill (+2 dB from 3 coins, +4 dB and 0.9× from 8) / `xp_collect` at 0.75× for big spills only (n ≥ 5 or value ≥ 10) |
| `CHARM_DROP` / `CHARM_PICKUP {dup}` / `CHARM_EQUIP {on}` | `charm_found` (quieter, lower) / `charm_found`, plus `coin_spill` 0.45 s later for a duplicate / `charm_equip` (unequip −3 dB at 0.84×) |
| `LEVEL_UP` / `CARD_PICK` | `levelup` / `card_pick` |
| `BUY` / `'shop.denied'` / `'pad.open'` | `shop_buy` / `w_dry` / `ui_click` |
| `NPC_OPEN` / `NPC_LINE {line}` | `npc_open`, and the panel mix while it is open / Brother Cinder's line (a new line cuts the old one). `line` may be the id, the sound id, an index or the text itself |
| `TOWER_BUILD` / `TOWER_UPGRADE {level}` | `tower_build` at the pad (a Chain Imp adds a chain rattle 1.3 s later) / `tower_upgrade`, 6 % higher per level above 2 |
| `RUN_START`, `CAMP_ENTER`, `CAMP_LEAVE`, `NIGHT_TITLE` | set the night number used for the music. `CAMP_LEAVE` also plays `beacon_kindle` at the basket and the horde's distant war cry (`horde_rise`) on the camp-leave `vision` beat (1.6 s) |

Entering the camp swaps the night forest (`amb_night` drops to 0.2) for the dusk bed (`amb_camp`), silences the crowd
beds, makes the wind gusts 5 dB quieter and resets the in-night state (kindle, troll, gate damage steps, hex, the Lance).

**The horde, the gate and the troll**

| Event | Sound |
|---|---|
| `E_HIT {source: 'bullet'}` | `hit_flesh` (`hit_wood` on a brute's door shield; +3 dB on a crit; 1.2× on an imp). Other sources are silent |
| `E_IGNITE` | `ignite_puff`, and a 15 % chance of a `gob_burn` shriek |
| `E_DEATH` | `gob_death` (brute lower and louder, spear goblin slightly lower), `imp_chitter` for an imp, `gob_burn` if burned; a Bat Gremlin: `bat_crash` if burned, else `gob_death` at 1.15× |
| `E_ATTACK {target: 'player'}` / `SPEAR_THROW` / `SPEAR_HIT` | `claw` / `spear_throw` / `spear_impact` (variant 1 on the player, 0 in the ground) |
| `GATE_HIT` / `GATE_BREACH` | `gate_thud` (louder for big blows), and `gate_splinter` as the gate falls below 75, 50 and 25 % / `gate_breach` |
| `BOMB_THROW` / `BOMB_BURST` / `SUNBURST` / `BARREL_BURST` | `bomb_throw` / `bomb_burst` / `sunburst` / `barrel_burst` |
| `TROUGH_LIT` / `TROUGH_OUT` | `trough_ignite` / `fire_out` at the trough's centre |
| `KINDLE` / `BEACON_READY` | `beacon_kindle` at the basket, music → `kindle` for 40 s / `beacon_ready` (also on the intro's `beacon` beat) |
| `T_ARRIVE` | `troll_horn`, the `troll_roar` on the troll timeline's `roar` beat (2.2 s), music → `troll` |
| `T_WINDUP {move}` | a growl as the audio telegraph: smash deep, throw higher, stomp short, the Ash Roar the deepest |
| `T_STEP` / `T_SMASH` / `T_THROW` / `T_BOULDER` / `T_STOMP` | `troll_step` / `troll_smash` (plus a gate thud on the gate) / `troll_throw` / `boulder_impact` / `troll_stomp` |
| `T_GLOW {on}` / `T_HURT` / `T_DEATH` | `troll_sizzle` / `troll_hit`, only for `source: 'bullet'` (brighter and +3 dB while glowing) / `troll_death` |
| `'troll.roar'` | the Ash Roar (`ash_roar`) at the troll |
| `DAWN` / `RETRY` | `horde_flee` and `fire_out` / the mix resets and the night music returns |

**Night II on: towers, skills, elites, Bat Gremlins**

| Event | Sound |
|---|---|
| `OBELISK_PULSE {level}` | `obelisk_pulse` (+1.5 dB and −4 % pitch per level) |
| `CHAIN_THROW` / `CHAIN_HOOK` / `ORBIT_HIT` | `chain_throw` / `chain_hook` / `orbit_hit` |
| `state.orbit` non-empty | the `orbit_loop` bed (0.55 + 0.15 per orb, up to 3), panned with the first three orbs |
| `METEOR {flight}` | `meteor_whistle`, timed to end at the landing (sped up to at most 1.35× for short flights), then `meteor_impact` at `flight` |
| `TRAIL` | `trail_crackle`, at most one per 0.15 s |
| `ELITE_SPAWN {kind}` | the Chieftain: `chief_horn`; the Hexer: `hexer_cackle` |
| `DOUSE_THROW` | `douse_throw`, then `douse_splash` where it lands, after `flight` |
| `state.air` / Bat Gremlins in the horde | the `bat_flap` bed: one loop that follows the nearest bat (full at 3 m, gone at 16 m, louder with more bats within 14 m), never one per bat |
| `'air.screech'` / `'air.hit'` / `'air.ignite'` / `'air.crash'` / `'air.death'` | `bat_screech` (the dive's telegraph) / `claw` / `ignite_puff` / `bat_crash` / `gob_death` at 1.15× when not burned |
| `'pyre.burst'` (up to 24 a second) | `pyre_pop`, at most one per 100 ms and 0.09 s apart: never more than 10 a second |

**The later nights and the Rainmother**

| Event or state | Sound |
|---|---|
| `state.weather.rain` | the `rain_bed` level; above 0.55, thunder every 10–28 s at a random side; `'weather.squall' {on}` adds a strike |
| `state.rams` (walking) | the `ram_drum` loop follows the nearest marching ram (full at 10 m, gone at 80 m). The sim's `'ram.drum'` events are ignored |
| `'ram.hit'` / `'ram.carrier'` / `'ram.death'` | `ram_impact` / a death squeak / a crash |
| `'coven.chant' {on}` / `'coven.gather'` / `'coven.lock'` | the `coven_chant` loop / a cackle / the lamp dims (a low hiss at the basket) |
| `'boss.rise'` / `'boss.phase'` | `rain_rise` and her theme / her moan |
| `'boss.step'` / `'boss.tide'` / `'boss.tide.hit'` | `rain_step` / `tide_wave` / a splash on the Lamplighter |
| `'boss.whirl' {pos, seconds}` | a surge, then the `whirlpool` loop at its position for its seconds (also any `whirlpools` in the state) |
| `'boss.lantern'` / `'boss.hex'` / `'boss.crack'` / `'boss.gate'` | `lantern_shatter` / the Hexer path above / a sizzle / `gate_breach` |
| `'boss.hurt'` | `troll_hit`, lower, only from bullets |
| `'boss.death'` | `rain_collapse`; her theme ends |

**Always on.** `amb_night` (wind in pines, crickets, a far owl) in the night modes and on the title; wind gusts every
9–23 s at a random side; the crowd and fire beds above.

## 5. The sounds

The full list with descriptions is `SOUNDS` in `src/audio/bank.js`; the full prompts are in `assets-src/audio/jobs.mjs`
and `provenance.json`. Here they are by group.

**Music loops** (stereo, Opus 80 kb/s; the percussion layers mono 64 kb/s):

| id | What | Loop |
|---|---|---|
| `mus_night` | the night theme, dark folk | 24 bars, 62.6 s |
| `mus_kindle` | the heavier night theme while the beacon is kindled (a separate cue, crossfaded on the beat) | 29 bars, 75.7 s |
| `mus_troll` | the Ash Troll's theme | 20 bars, 52.2 s |
| `mus_camp` | the camp at dusk, calm and slightly sinister | 22 bars, 57.4 s |
| `mus_night2` | the second night theme | 23 bars, 60.0 s |
| `mus_rain` | the Rainmother's storm theme (low wordless choir, timpani, rain) | 18 bars, 47.0 s |
| `mus_perc_a`, `mus_perc_b` | percussion layers over the night loops: war drums from Night III, heavier battle percussion from Night VI | 8 bars, 20.9 s each |

**Stingers and score cues:** `mus_nightcard` (5.6 s, the night card), `mus_fallen` (6.6 s), `mus_dawn` (20.6 s, D major),
`mus_soon` (4.3 s, a choir swell cut dead; see open issues), and the ending's `mus_end_portal` (13.1 s, a rising dark
choir), `mus_end_reveal` (9.1 s), `mus_end_hunt` (13.5 s) and `mus_end_credits` (36.5 s: the camp loop slowed to 0.8×,
darkened and washed in a long reverb).

**Brother Cinder** (`voice/vo_cinder_<line>.webm`, mono 48 kb/s): eight lines in `VOICE_LINES`, text verbatim from
`docs/STORY.md`: `home`, `hide`, `afraid`, `gloves`, `eight`, `eat`, `fall` (the camp) and `master` (the ending).
2.9–8.9 s each.

**One-shot SFX** (mono, 48 kb/s; shots and bursts 64 kb/s). A number is the variant count where there is more than one;
a multi-variant id never plays the same variant twice in a row, and most ids add pitch and level jitter.
- **Weapons:** `w_kestrel_shot`, `w_blunder_shot` (one file each, no jitter), `w_kestrel_reload`, `w_blunder_reload`,
  `w_lance_ignite`, `w_lance_stop`, `w_switch`, `w_dry`, `organ_overheat`, `bomb_throw`, `bomb_burst` 2, `sunburst`.
- **Fire and oil:** `barrel_burst`, `trough_ignite`, `ignite_puff` 2, `fire_out`, `gale_gust`, `pyre_pop`.
- **The horde:** `gob_death` 6, `gob_burn` 3, `imp_chitter` 3, `hit_flesh` 3, `hit_wood` 2, `claw` 3, `spear_throw`,
  `spear_impact` 2, `gate_thud` 3, `gate_splinter`, `gate_breach`, `horde_flee`, `horde_rise`.
- **Elites and specials:** `chief_horn`, `hexer_cackle`, `hex_zap`, `lance_sputter`, `douse_throw`, `douse_splash`,
  `bat_screech`, `bat_crash`, `ram_impact` 2, `thunder` 3.
- **The Ash Troll:** `troll_horn`, `troll_roar`, `troll_windup` 2, `troll_step` 2, `troll_smash`, `troll_throw`,
  `boulder_impact`, `troll_stomp`, `troll_hit` 2, `troll_sizzle`, `troll_death`, `ash_roar`.
- **The Rainmother:** `rain_rise`, `rain_step` 2, `tide_wave`, `lantern_shatter` 2, `rain_collapse`.
- **The ending:** `portal_rip`, `gate_open`, `demon_roar`, `gloves_ignite`, `hunt_flee`.
- **Towers and skills:** `tower_build`, `tower_upgrade`, `obelisk_pulse` 2, `chain_throw` 2, `chain_hook` 3,
  `orbit_hit` 3, `meteor_whistle`, `meteor_impact`, `trail_crackle` 3.
- **The beacon:** `beacon_kindle`, `beacon_ready`.
- **The Lamplighter:** `p_hurt` 3, `p_death`, `step_earth` 4, `step_stone` 3, `step_timber` 4.
- **Pickups, camp and UI** (UI bus): `xp_tick`, `xp_collect`, `coin_tick`, `coin_spill` 3 (SFX bus), `gold` 3, `heart`,
  `levelup`, `charm_found`, `charm_equip`, `shop_buy`, `npc_open`, `card_hover`, `card_pick`, `ui_click`, `ui_begin`.
- **Ambience:** `wind_gust`.

**Loops and beds:**
- **Stereo beds, 64 kb/s:** `amb_night`, `amb_camp`, `crowd_far`, `crowd_near`, `rain_bed`, `hell_wind`, `host_march`.
- **Mono loops, 48 kb/s:** `fire_low`, `fire_mid`, `fire_high`, `w_lance_loop`, `organ_loop`, `orbit_loop`, `bat_flap`,
  `ram_drum`, `coven_chant`, `whirlpool`.

**Brother Cinder's voice.**
- An original voice made with ElevenLabs Voice Design (`eleven_multilingual_ttv_v2`) from a text description only, no
  reference audio: *"A very old man, small and hunched: a dry, papery, slightly raspy voice, amused and knowing,
  unhurried, speaking softly with a small smile in it, a neutral English accent."*
- Of the three previews, the build kept the one whose median pitch (148 Hz) was nearest the 115 Hz aimed at for an old
  man; the others measured 195 Hz and 74 Hz. The saved voice's id and the pick are in
  `assets-src/audio/raw/tts/cast.json`.
- The lines are read with `eleven_multilingual_v2` (stability 0.42, similarity 0.8, style 0.25, speed 0.9).
- Processing (`voiceFx` in `build.mjs`): a low shelf +2.5 dB at 220 Hz, a high shelf −2 dB at 7 kHz, a 25 % tanh drive,
  and a generated 0.3 s small room (early reflections at 6–23 ms, −14 dB wet).

## 6. Loading and performance

**Nothing but the manifest loads before the game is ready.** The background queue starts at the first of:
- the game reporting ready (`window.__ew.bootMs`, set by `main.js` right after the load bar reaches 1);
- the title click (`unlock()`);
- the game leaving `title` (a `?night=`, `?camp=1` or `?ending=1` start);
- a caller of `ready()`.

Then 4 files load at a time, in an order chosen by how the game starts (`decideStart`, mirroring the sim's first-launch
rule). Each file belongs to a group (`GROUP_OF`); within a group the bank's `prio` decides.

| Start | Order (`ORDERS`) |
|---|---|
| a fresh save | core → Night I → Night I's later events → camp → Night II on → late nights → Night X → ending |
| `?camp=1`, or a save with progress | core → camp → Night I → Night I's later events → Night II on → late nights → Night X → ending |
| `?night=2` | core → Night I → Night II on → … |
| `?night=3` to `9` | core → Night I → Night II on → late nights → … |
| `?night=10` | core → Night I → Night X → late nights → … |
| `?ending=1` | core → ending → … |

- **core:** the Kestrel, the UI, steps, the player's grunts, XP and coins.
- **Night I:** the night bed, crowds, fire beds, goblins, hits, the Lance, firebombs, the beacon, troughs (every id not
  in another group).
- **Night I's later events:** kindle, troll, Sunburst, dawn, fallen, the blunderbuss, the Chieftain, charms.
- **camp:** the camp music and bed, Brother Cinder, the shop, towers.
- **Night II on:** bats, Hexers, Dousers, tower pulses, the orbit, the meteor, the trail, the organ, Pyre Burst, the Ash
  Roar, the gale.
- **late nights:** the percussion layers, rain, the ram, the coven. **Night X:** the Rainmother. **ending:** its cues.

Rules:
- **A sound asked for jumps the queue, even before the start.** Up to 2 on-demand workers fetch exactly what was asked,
  so nothing waits for the background start. A one-shot asked for before its file has decoded is dropped; a bed or a
  music state starts when its file lands.
- **A failed fetch or decode is never retried.** Its id is remembered, so asking again costs nothing; the id's other
  variants still play.
- **Every file is fetched as `<file>?v=<h>`,** where `h` is the first 10 hex digits of its sha256, written into the
  manifest by the build. The manifest itself is fetched `no-cache`.

**Measured** (Node, mock fetch, `check-engine.mjs`, 2026-11-18):
- before ready, 0 sound requests;
- a fresh save: the core files first, Night I's beds and horde all by request #57, `mus_camp`, `mus_troll` and
  `mus_kindle` from #81, and the ending and Night X last (#164–185);
- a save with progress: `mus_camp` at #29; `?ending=1`: `mus_end_portal` at #29.

**Decode in Chrome** (headless Chrome on an Apple M4, local dev server, `preview/audio.html?selftest=1`, 2026-11-14):
185/185 files fetched and decoded in 0.9 s, 0 failures; every decoded length matches the manifest within 0.5 ms (Chrome
trims the Opus pre-skip and padding, so the manifest's loop points hold).

**CPU.**
- In the game: 0.03–0.05 ms per frame for the audio's `update()`, flat from 2,500 to 20,000 goblins
  (production build, headless Chrome on an Apple M4, 1920×1080, `npm run perf`, 2026-11-13).
- In Node with a mock Web Audio (`check-engine.mjs`, 2026-11-18): `update()` takes 4–19 µs per frame across its
  checks, from a 2,600-slot horde alone to the horde with the orbit, 12 bats, rain, 2 rams, a whirlpool and both
  percussion layers up.

**Voices under load** (headless Chrome on an Apple M4):
- 300 goblin deaths in 1 s from the bench start 30 death and 18 burn sounds and drop the rest; the output peaks at
  −6.3 dBFS, with no overload at the limiter (2026-11-13). 300 deaths in one frame start 3 + 2.
- Two seconds of six Obelisks, Chain Imp throws and hooks and 40 orbit hits per frame start 8 / 24 / 24 / 30 sounds,
  at most 13–14 of 40 voices; the output peaks between −2.3 and −3.0 dBFS, with no overload (2026-11-13/14).
- 70 s of bot play on Night I (`index.html?autoplay=1&skipintro=1&speed=2&quality=low`, 2026-11-13): 718 sounds
  started and 392 dropped by the limiter, at most 24 voices, 0 console errors.

## 7. The asset build (`assets-src/audio/`)

The build needs Node and ffmpeg (`tools/platform.mjs` finds it). Generating needs an ElevenLabs account; building from the raw takes and playing the game need none.

**Generate.** The generation client is not in this repo (the takes were made with the authors' ElevenLabs account).
`jobs.mjs` holds every request body (`api` `sfx` | `music`, the prompt, the length, the loop flag) and the voice design,
so a set can be made again with any ElevenLabs client: save each take as `assets-src/audio/raw/<api>/<id>.mp3|wav`,
then run the build below. Newer takes of a job are `<id>__r<n>`; the build uses the newest.
- `--voice` runs Brother Cinder's pipeline: design (3 previews) → pick by median pitch → save the voice → one reading
  per line.
- Raw takes go to `raw/{music,sfx,tts}/`. The audio is gitignored; each take's receipt (`*.result.json`) is kept.

**Build** (`node assets-src/audio/build.mjs [--only id,id]`; `--only` rebuilds those ids and merges the rest from the
previous manifest):
1. **Split** multi-sound takes into variants on onsets (`split`): a rise of ≥ 9 dB within 60 ms to within 24 dB of the
   take's peak; per-take options in `SPLIT_OPTS`. Takes whose sounds rise too slowly are cut by hand at fixed times
   (`CUTS`).
2. **Trim** leading and trailing silence and fade the edges.
3. **Music loops** (`findMusicLoop`): find the beat period from the onset envelope (a prior window of 80–104 BPM), choose
   a loop of whole 4-beat bars whose start and end best match (onset-envelope correlation over 8 s, level match), align
   the end to the sample by waveform correlation, and crossfade 1 s, equal power (`makeLoop`). The loop wraps from
   x[b−1] to x[b] of the original, so the seam is continuous by construction. The loop's beat grid (`bpm`, `beat0`) goes
   into the manifest.
4. **Beds and loops:** keep the API's own loop when its seam measures clean (ratio ≤ 2.5 and step ≤ 1.5 dB), else
   crossfade end→start over up to 0.6 s. `w_lance_loop` is always crossfaded (`FORCE_XFADE`).
5. **The guns** (`GUN`, `gunShape`, `gunPunch`, `gunCheck`), the **organ loop** (`organLoop`) and the **credits theme**:
   see section 8.
6. **Stingers:** `mus_soon` is cut dead 0.23 s after its swell peaks, at 4.58 s of its take (`STING_CUT`), with a 50 ms
   fade.
7. **Loudness:** music, stingers and voice −18 LUFS; beds −20 LUFS and loops −18 LUFS, both held to a −1.5 dBFS peak;
   `fire_low` −28 LUFS (`LOUD`: sparse crackle, its pops go through a soft ceiling at −1.2 dBFS); SFX to a −3 dBFS
   sample peak.
8. **Encode** Opus in WebM, 48 kHz: music and stingers 80 kb/s stereo, the percussion layers 64 kb/s mono, beds 64 kb/s
   stereo, shots and bursts 64 kb/s mono, everything else 48 kb/s mono.
9. **Verify** by decoding each file again: an SFX whose true peak came out above −2 dBTP is pulled back to −3 dBTP and
   re-encoded; loops get the seam measurement.
10. **Write** `manifest.json` (ids in bank order, each file with `dur`, loop points, beat grid and content hash `h`) and
    `provenance.json`, plus an analysis table (per file: length, size, bitrate, LUFS, true peak, seam) in the gitignored
    `.scratch/` folder.

The procedural sounds are in `PROC`, and `fallback()` makes stand-ins for a job whose take is missing (never shipped
while the take exists). Takes listed in `SKIP` are not shipped.

## 8. Measurement rules and results

Unless a date says otherwise, the results are from 2026-11-18: ffmpeg EBU R128 (`ebur128=peak=true`) on the shipped
files, and the build's `seam()` metric on the decoded files at 48 kHz.

### Loop seams

The seam metric (`seam()` in `build.mjs`):
- **ratio** = the sample jump across end→start over the file's mean sample step. About 1 is seamless; above 4 a click is
  likely.
- **step** = the RMS of the first 50 ms over the last 50 ms, in dB, with its **percentile** among the file's own steps at
  every 50 ms boundary. A seam at or below about the 90th percentile is no bigger than the sound's ordinary motion. A
  music loop cut on a downbeat ranks high because a drum hit starts there.

| Loop | Length | Tempo | Ratio | Step (percentile) |
|---|---|---|---|---|
| `mus_night` | 24 bars, 62.60 s | 91.97 BPM | 0.45 | 7.65 dB (97th: lands on a downbeat) |
| `mus_kindle` | 29 bars, 75.66 s | 92.02 BPM | 0.72 | 3.67 dB (83rd) |
| `mus_troll` | 20 bars, 52.16 s | 91.97 BPM | 0.13 | 1.66 dB (71st) |
| `mus_camp` | 22 bars, 57.39 s | 92.02 BPM | 0.41 | 7.36 dB (100th: the music's own entry) |
| `mus_night2` | 23 bars, 60.01 s | 91.97 BPM | 0.93 | 3.32 dB (82nd) |
| `mus_rain` | 18 bars, 46.95 s | 91.97 BPM | 0.00 | 0.84 dB (43rd) |
| `mus_perc_a` / `mus_perc_b` | 8 bars, 20.86 / 20.87 s | 91.97 BPM | 0.19 / 1.10 | 2.63 dB (58th) / 0.79 dB (22nd) |

Beds and loops: every ratio ≤ 2.5, every step ≤ 2.9 dB at or below the 76th percentile (`fire_mid` 2.83 dB), except two
whose step is part of the sound: `orbit_loop` (5.7 dB, 99th: a fireball passing) and `bat_flap` (4.05 dB, 82nd: a wing
beat).

### Loudness

| Class | Files | At the master (file + bank gain + bus) |
|---|---|---|
| Music and stingers | −18.0 LUFS (camp −17.9), true peak −7.2 to −0.5 dBTP | −23 LUFS (camp −24); the percussion layers −26 / −27 under the base |
| Brother Cinder | −16.4 to −17.0 LUFS (the build aims at −18), true peak ≤ −1.2 dBTP | ≈ −20 LUFS, over the music ducked 7 dB |
| Beds | −20.0 to −20.4 LUFS (`host_march` −22.9: held by its peak) | −28 to −29 LUFS at full level |
| Loops | −17.8 to −19.7 LUFS; `fire_low` −28.9 LUFS with a +4.1 dBTP true peak in the file (its pops) | the Lance and organ loops −22 LUFS |
| One-shot SFX (144 files) | sample peak −5.4 to −2.0 dBFS, true peak ≤ −2.0 dBTP (median −3.0) | the loudest: the ending's roar −14.3 LUFS, `portal_rip` −14.5, `troll_roar` −15.6, `troll_death` −16.2, `ash_roar` −16.5 (within their `ref` distance); `gale_gust` ≈ −24; `xp_collect` −35 (it fires constantly) |

Integrated LUFS means little for one-shots under about 0.4 s (the gating discards them); those are set by peak.

### The gun-shot rule

`gunmeasure.mjs` measures a shot on the decoded file (mono 44.1 kHz, 5 ms RMS frames):
- **attack** = the time of the loudest frame;
- **tail** = the last frame above the peak − 40 dB;
- **onsets** = a rise of more than 12 dB within 20 ms from a local minimum, within 24 dB of the peak, more than 150 ms
  apart;
- **starts on the attack** = the first frame is already within 12 dB of the peak.

A shot passes with **no onset after the attack**, an attack of at most 10 ms, the tail inside its hard length, and a body
(tail ≥ 0.35 s for the Kestrel, ≥ 0.6 s for the blunderbuss, so not a click). `gunCheck()` in the build applies the same
rule at four frame alignments.

How the build makes a shot (`gunShape`):
- The rise into the take's loudest transient is moved to 1 ms, which cuts any flint snap or click before the blast.
- A **decaying ceiling** (Kestrel 58 dB/s, blunderbuss 34 dB/s, and never more than 6 dB over the quietest of the last
  30 ms) means no second bang can form and no hiss can sustain.
- A hard length: Kestrel 0.7 s, blunderbuss 1.2 s, with a cosine fade over the last 35 %.
- The same procedural punch under both (`gunPunch`): a 3 ms high-passed noise crack and a thump sweeping 90 → 62 Hz
  (Kestrel) or 80 → 60 Hz (blunderbuss) that decays over about 120 ms (cut at 160 ms).
- For the blunderbuss, a band-limited decaying scatter 8 dB under the ceiling, so the gaps between its crackles never
  read as a new shot.
- `GUN_PICK` names the shipped take; the build still checks it against the rule.

| Gun | File | Length | Peak | Attack | Tail (−40 dB) | Onsets after the attack |
|---|---|---|---|---|---|---|
| Kestrel | `sfx/w_kestrel_shot.webm` | 0.70 s | −2.5 dBFS | 0 ms | 0.56 s | none |
| Blunderbuss | `sfx/w_blunder_shot.webm` | 1.20 s | −3.6 dBFS | 5 ms | 0.88 s | none |

**Audible in a busy night** (an offline mix of the files at their bank and bus gains, 2026-11-13): the crowd beds and
`fire_high` full, `fire_mid` at 0.6 and the night bed come to −23.0 dBFS RMS at the master. The loudest 50 ms of the
Kestrel shot is about 10 dB above that and the blunderbuss about 9 dB; with the bed dip, 12–15 dB.

The rule is for gunshots. On broadband noise the 5 ms RMS swings by more than 12 dB, so it flags false onsets: it finds
5 in `gale_gust`, a smooth swell. On 50 ms frames the gust's largest rise within 24 dB of its peak is 4.6 dB, so it has
no hit.

### The THUNDER ORGAN loop

How it is cut (`organLoop` in `build.mjs`):
- The round period comes from the autocorrelation of the onset strength (0.5 ms frames, 40–110 ms), interpolated:
  61.03 ms, so the take fires at 16.39 rounds/s. Of two takes, the steadier is used (100 ms level spread 1.38 dB against
  26 dB).
- Both cut points sit 0.3 periods before a detected round. The end round is chosen by how well the round spacing across
  the seam matches the loop's own, the waveform correlation and the 50 ms level step.
- A one-period (61 ms) equal-power crossfade, then a resample ×1.0986 so the rounds come at 18/s (the pitch rises
  1.6 semitones).
- Finally the loop is rotated to start at its quietest millisecond, so the codec's file edges fall between rounds.

The result is a 2.354 s loop at −19.3 LUFS, 15 KB. Measured with `loopseam.mjs` on the shipped file (rounds = onset
peaks at least 35 ms apart, so mechanical clatter counts too):

| | At the wrap | The loop's own |
|---|---|---|
| sample jump ÷ mean sample step | 0.00 | (≈ 1 is seamless) |
| 50 ms RMS step | 1.48 dB | same-phase steps: median 0.98 dB, max 3.92 dB; the wrap ranks at the 67th percentile |
| round spacing | 47 ms | median 40 ms; the 73rd percentile |

### The credits theme

`mus_end_credits` is made from the camp music's own take: 26 s from the loop start, resampled to 0.8× (slower, −3.9
semitones), low-passed at 3.8 and 5.2 kHz, and washed in a generated 4-comb reverb of about 3.5 s at −9 dB, with a 1.2 s
fade-in and a 5 s fade-out.

## 9. Decisions

- **One key and one tempo for all the music** (D minor, 92 BPM). Every loop is cut on whole bars, any two crossfade on
  the beat, and the percussion layers sit on the night loops. `kindle` and `night2` are separate, heavier cues rather
  than layers, because the music generator gives no stems.
- **One sound per gun.** Each gun sounds the same on every shot. The first
  variant sets read as different guns (a late second bang, a sustained hiss, a thin click). So each gun has exactly one
  shaped file, played at rate 1 and its bank gain with no pitch or volume jitter. A trigger pull starts one voice and
  nothing else (no shell, click or tail layer; the punch is baked into the file). The THUNDER ORGAN plays one loop and
  nothing per round. Pyre Burst is a skill, not a gun, so it keeps its jitter.
- **The shot is kept clear by dipping the beds,** not by making it louder: a short gain dip on the ambience bus (crowd,
  fire, night). The player's own Lance loop is on the SFX bus and is not dipped.
- **Hit sounds only for real hits.** `T_HURT` and `'boss.hurt'` also come from fire ticks and blasts, so `troll_hit`
  plays only for `source: 'bullet'`, or, when an event has no source, within 0.25 s of a shot. The sim now passes
  `source` with both events, so the fallback only covers older event shapes.
- **Stereo pan and distance gain instead of HRTF `PannerNode`s:** hundreds of events a second and one first-person
  listener. It is cheap and keeps the voice pool fixed.
- **A fixed voice pool, per-id limits and per-frame pooling,** so 300 goblins dying at once stay a clean crowd of squeaks:
  the nearest and loudest win, the rest are dropped. One loop per kind for things that come in crowds (the bats, the
  rams' drum, the orbit), never one per creature.
- **Opus in WebM** (Chrome, Firefox, Safari 15 and later), with loop points from the manifest so the codec's padding
  never sits inside a loop.
- **Music at 80 kb/s** (it was 96) to keep the set under 8 MiB once the later nights' music was added; that saved
  0.96 MB. The percussion layers are mono 8-bar loops, because drums repeat anyway.
- **No audio before the game is ready, then in the order the start needs.** The engine used to fetch 41–82 sounds
  (3.3–3.8 MB) while the title was loading; at 15 Mbps that pushed the title to 4.3 s (a performance audit,
  2026-11-14).
- **Content-hashed URLs** (`?v=<h>`), so a file rebuilt under the same name, as the gun files were, can never come
  from a stale browser cache.
- **The AudioContext is created at load and only resumed by the first gesture,** so the first key press has no hitch.
- **The game never suspends the audio for pauses and cards;** the module muffles its own mix instead, so the dawn music
  and the fallen sting play under their cards.
- **A new sound for the Ember Gale.** It is heard every 8–14 s, and the library's nearest fits were wrong: the trough
  ignition is a loud roar that already means "a trough caught fire", the Sunburst has a nova hit, and `wind_gust` is a
  4.7 s cold wind. Of two takes, the smooth one ships (the other had 4 onsets).
- **The credits theme is made from the camp music** (no new generation), so the ending closes on the camp motif, slowed
  and darkened.
- **Brother Cinder's voice is designed from a description,** with no reference audio and no real person.
- **No bells anywhere.** The beacon is the game's risk-and-reward device, and its sounds are fire.

## 10. Open issues

- **The mix was set by measurement, not by ear.** Every gain in `bank.js` comes from each file's measured loudness at
  the master (music −23 LUFS, blasts and the troll 5–8 LU over it, beds 5–6 LU under it). Apart from the guns, which
  were reworked after playtesting, no listening pass is recorded. Retuning a `gain` needs no rebuild: the engine reads
  the bank.
- **Brother Cinder** was picked by a pitch rule and processed without listening, and there is no speech-to-text check of
  the readings: a mispronounced or added word is possible until someone listens.
- **Choirs:** `mus_soon` was generated with vocals allowed (it asks for a choir), and `mus_rain`, `mus_end_portal` and
  `mus_end_reveal` ask for wordless choirs. Whether any words came through is unchecked.
- **`mus_soon` is unused.** The sim no longer sends `COMING_SOON` (all ten nights are built and the coming-soon card is
  gone), so the sting and its handling in `onEvent` are dead. It costs 44 KB.
- **Seams to listen to:** `mus_night` (on a downbeat) and `mus_camp` (on the music's own entry) are continuous by
  construction but have the largest steps.
- **The layer re-syncs** happen about once per base-loop wrap with a 10 ms crossfade. If a flam is audible there, re-cut
  the base loops on exact bars (a rebuild, no generation).
- **Bitrate:** compare the night theme's strings at 80 kb/s if the music sounds dull.
- **`fire_low`**'s pops pass the soft ceiling: +4.1 dBTP in the file, about −6 dBTP at the master at full bed level.
- **The reverb is generated, not measured;** a listening pass may want the sends lower (`sendNear`, `sendFar`).
- **The THUNDER ORGAN** runs 1.6 semitones above its take so the rounds match the 18/s tracers. Its release fade (τ
  25 ms) is the scheduled value; it has not been measured on the waveform in Chrome.
- **Fewer variants than asked** for some ids: `ignite_puff`, `troll_hit`, `troll_step`, `troll_windup`, `bomb_burst`,
  `hit_wood`, `spear_impact` have 2; `xp_collect` and `douse_splash` have 1. Pitch and level jitter cover the repetition.
- **`?ending=1`** starts the ending as the page loads, so its first cue (the flood's collapse) may be dropped before its
  file has decoded. In a real run the ending follows Night X, long after every file has loaded. Unverified since the
  load-order change.
- **The load order is verified in Node only.** It has not been measured in Chrome against the moment the game reports
  ready.
- **iOS is unchecked;** WebM/Opus decodes in Chrome, Firefox and Safari 15 and later on macOS.

## 11. How to test and listen

**The Node check** (no browser, a mock Web Audio; a few seconds):

```
node assets-src/audio/check-engine.mjs        # exit 0 = all pass; 77 checks on 2026-11-18
```

It covers loading from the manifest, every one-shot playable, the music states, the limiter (300 deaths in 1 s and in
one frame, the nearest win), the beds, the camp, Brother Cinder, one of each event, the guns (one file each, one voice
per trigger), the organ, the bats, Pyre Burst, the layers on the beat, rain, the ram, the coven, the Rainmother, the
ending's cues, the gale, the heal ticks, the load order and the never-retried failure, and `update()`'s cost.

**The bench:** run `npm run dev`, open http://127.0.0.1:5350/preview/audio.html and click once (the gesture). To run it
beside the game: `npx vite --port 5357 --strictPort` and port 5357.
- Music buttons for every state, the stingers, and *jump to the loop seam (−4 s)*.
- Beds as sliders, or driven by a simulated state (goblins near and far, lit troughs, burning goblins, the listener's
  yaw).
- Every event as a button, through `onEvent` and rate-limited as in the game; every sound id direct.
- Rows for Brother Cinder, the camp, Night II on, the organ (*hold to fire*), the later nights, the Rainmother, *THE
  ENDING (56 s)*, the gale and the heals.
- Stress buttons: *300 goblin deaths in 1 s*, *tower + orbit spam 2 s*, *coin shower*, *gate siege*.
- An output meter (peak and RMS at the limiter) and live `stats()`.
- `?selftest=1` runs the checks by itself and prints `BENCH_RESULT {json}` to the console.

The latest self-test (headless Chrome on an Apple M4, 2026-11-14): every file decoded, all 111 one-shots (95 SFX, 8
stingers, 8 lines) played, every music switch landed (night → kindle → night → troll → dawn → camp → night2 → kindle →
night2 → rain → off), the organ ran one loop with 0 per-round voices, the layers sat 0 ms off the beat, all 12 ending
cues fired in order, one gale event gave one gust, 300 deaths in 0.99 s started 30 + 18 sounds, and there were 0 console
errors.

**In the game:**
- `?ending=1` plays the ending; `?night=9&autoplay=1` gives both percussion layers (and a kindle's fade-out when the bot
  kindles); `?camp=1&save=mid` opens in the camp with towers; `?autoplay=1` lets the bot play; `?mute=1` mutes.
- `__ewAudio.stats()` in the console shows what the engine is doing.
- In headless Chrome on an Apple M4 (2026-11-13/14), every ending cue landed on its beat, Night IX's layers sat 0 ms
  off the beat, and opening Brother Cinder's stall played his line under the panel mix.

**Measurement tools:**
- `node assets-src/audio/gunmeasure.mjs <out.png> <file.webm> …` prints the gun-shot rule's numbers and draws a waveform
  sheet (one row per file, 2 s wide, marks at 0.7 s and 1.2 s).
- `node assets-src/audio/loopseam.mjs <file.webm> <loopEnd s>` measures a rapid-fire loop's seam.

**What to listen to first:**
1. The night, kindle, camp and troll loops at their seams (*jump to the loop seam*), then night → kindle → night (a
   beat-matched crossfade).
2. Brother Cinder's eight lines: old, dry, amused, slightly raspy; no accent drift; no wrong words.
3. The Kestrel and the blunderbuss, then *300 goblin deaths in 1 s*: a clean crowd, not noise.
4. The THUNDER ORGAN held for 3–5 s: one even stream at 18 rounds/s, no hitch every 2.35 s, a clean stop.
5. The ending start to finish: the cues on the picture, the roar's level, the credits theme ("a slow, sinister music
   box", or just slow?).
6. Nights III, V, VI and IX: the drum layers on the night loop's beat, across a loop wrap.
7. *Pyre Burst ×24/s*: a crackle of pops, never a machine gun. *EMBER GALE*: hot, and pleasant every 8 s.
