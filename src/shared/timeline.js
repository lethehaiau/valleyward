// @ts-check
// VALLEYWARD · scripted beats (seconds from the start of the mode, state.modeT, or from the event that starts the beat).
// The sim runs on these times; the cinema moves the camera, shows cards and subtitles on the same times;
// audio cues music and stingers on them. Change a time here and all three move
// together. Pure data, no imports (Node tests read it).
//
// Flows (docs/DESIGN.md §7):
//   title (standalone only: "click to begin") → intro (mode 'intro') → play ('play', EV.NIGHT_START) ⇄ cards ('cards')
//   → troll arrival (an overlay beat during 'play', from EV.T_ARRIVE; the sim keeps running) → dawn ('victory', from
//   EV.DAWN; EV.VICTORY at victory.card) | fallen ('fallen', from EV.FALLEN) → retry (EV.RETRY, then 'play' again).

export const TIMELINE = Object.freeze({
  /** mode 'intro' (≈ 6 s, skippable after 1.5 s; skipped on retry). The sim holds the player at ARENA.playerSpawn. */
  intro: Object.freeze({
    duration: 6.0,
    skippableAfter: 1.5,
    beats: Object.freeze([
      { at: 0.0, id: 'valley' },      // camera low over the valley road under the moon, the first goblin torches far off
      { at: 1.8, id: 'glide' },       // glide up the road toward the keep (the camera owns the lens; cinema)
      { at: 3.6, id: 'beacon' },      // the beacon basket on the SE tower flickers (env/audio beat)
      { at: 4.6, id: 'hands' },       // first person at the spawn: the Lamplighter's hands rise with the Kestrel
      { at: 4.9, id: 'card' },        // card "NIGHT I · VALLEYWARD" (ui.card('night'), auto-dismissing)
      { at: 6.0, id: 'control' },     // mode → 'play', EV.NIGHT_START
    ]),
  }),
  /** EV.T_ARRIVE during 'play' (the sim does not stop; the cinema may take a short look and give the lens back). */
  troll: Object.freeze({
    duration: 3.2,
    beats: Object.freeze([
      { at: 0.0, id: 'horn' },        // a low horn from the valley; music → 'troll'
      { at: 0.4, id: 'emerge' },      // the Ash Troll steps out of the fog at the road's far end (state.troll.stage 'arrive')
      { at: 2.2, id: 'roar' },        // roar (audio), a little shake
      { at: 3.2, id: 'done' },        // overlay over; the troll walks (state.troll.action 'walk')
    ]),
  }),
  /** mode 'victory', from EV.DAWN (troll dead and the clock ≥ 300 s). */
  dawn: Object.freeze({
    duration: 7.0,
    beats: Object.freeze([
      { at: 0.0, id: 'sunrise' },     // setDawn ramps 0 → 1 over `rise` seconds; the horde flees (state 3); douse ops
      { at: 0.0, id: 'flee' },
      { at: 4.0, id: 'quiet' },       // fire out, music → 'dawn'
      { at: 6.5, id: 'card' },        // EV.VICTORY; card "DAWN · THE WATCH HOLDS" (ui.card('dawn'))
    ]),
    rise: 5.0,
  }),
  /** mode 'fallen', from EV.FALLEN (gate HP 0 or player HP 0). */
  fallen: Object.freeze({
    duration: 2.4,
    slowmo: 0.6,                      // sim time scale 0.35 for the first 0.6 s (state.timeScale)
    slowmoScale: 0.35,
    beats: Object.freeze([
      { at: 0.0, id: 'slowmo' },
      { at: 0.6, id: 'fade' },        // colour drains, sound ducks
      { at: 1.4, id: 'card' },        // card "THE GATE IS BREACHED" / "THE LAMPLIGHTER FALLS" (ui.card('fallen'))
    ]),
  }),
  /** EV.RETRY: state reset to the plaza; a short re-entry, no full intro; mode 'play' straight away. */
  retry: Object.freeze({
    duration: 1.2,
    beats: Object.freeze([{ at: 0.0, id: 'fadein' }, { at: 1.2, id: 'control' }]),
  }),
  /** EV.KINDLE: the beacon flares (light + audio beat). */
  kindle: Object.freeze({ flare: 0.25, hold: 2.0, fade: 3.0, glance: 1.0 }),   // glance: the cinema's look up at the flaring basket; the sim holds firing for it
  /** DESIGN §9: EV.CAMP_ENTER → the 'camp' cinema (2.6 s fade: "THE DAY PASSES"); the sim holds the player for `hold` s. */
  camp: Object.freeze({ duration: 2.6, hold: 1.6 }),
  /** DESIGN §9: EV.CAMP_LEAVE (E at the pan in the camp) → mode 'intro' for `duration` s with the 'campLeave' cinema
   *  (not the valley intro): the lamp flares (the environment's horned-vision beat at `vision`), EV.NIGHT_TITLE at `card`, then play. */
  campLeave: Object.freeze({ duration: 4.0, vision: 1.6, card: 2.6 }),
  /** DESIGN §12, the ending (mode 'ending', from the Rainmother's fall; the sim holds the player, the cinema owns the
   *  lens). Seconds from the start of the mode; the sim emits EV 'ending.beat' {id, at, night} as each is crossed. The first
   *  time (save without `ended`) it is not skippable; afterwards `{act:'skipEnding'}` jumps to 'card' after `skippableAfter`.
   *  At 'card' the sim waits: `{act:'continue'}` (Play again → a new run, the camp before Night I) or the UI's exit. */
  ending: Object.freeze({
    duration: 56,
    skippableAfter: 3,
    beats: Object.freeze([
      { at: 0.0, id: 'flood' },     // the Rainmother collapses in the valley; the rain stops (state.weather.rain → 0 over 3 s); silence, steam
      { at: 5.0, id: 'lamp' },      // the beacon's flame turns black-red and swells into a pillar of fire
      { at: 8.0, id: 'portal' },    // the sky tears open above the keep: a ring of fire, a vortex of fire inside, red light floods
      { at: 12.0, id: 'world' },    // the world changes: red-black grade, the moon a black disc with a red corona, pines burn to black spikes, ash, lava cracks, embers fall like snow
      { at: 18.0, id: 'host' },     // the gate opens from the inside; the horned host marches down the hill; the goblins flee (the sim's horde flees from here)
      { at: 25.0, id: 'gloves' },   // first person: the gloves catch fire and fall away to black claws
      { at: 29.0, id: 'reveal' },   // the camera pulls out of the head, back and around to a low frontal angle: the demon on the wall walk (≈ 5 m), the portal behind
      { at: 34.0, id: 'roar' },     // the demon lifts its head and roars
      { at: 37.0, id: 'cinder' },   // Brother Cinder kneels at the foot of the wall: "Welcome home, Master." (voice; NPC_LINE 'master')
      { at: 42.0, id: 'hunt' },     // the wide crane over the valley village burning; the host gives chase into the forest (≈ 8 s, no one is caught)
      { at: 50.0, id: 'black' },    // cut to black
      { at: 50.5, id: 'credits' },  // on black: VALLEYWARD, then "Directed by AL" (≈ 5 s, the lamp's last crackle)
      { at: 56.0, id: 'card' },     // THE WAY IS OPEN / "Ten nights. The lamp will never go out." + stats + Play again
    ]),
  }),
  /** EV.LEVEL_UP: the sim stops in mode 'cards' at once; the UI may play a 0.35 s "LEVEL UP" flourish before the cards. */
  levelUp: Object.freeze({ flourish: 0.35 }),
});
