// VALLEYWARD · audio · the generation list (ElevenLabs music + sound effects). Read by the generation client (calls the API under
// the DESIGN §1.1 caps) and build.mjs (splits, trims, loops, normalises, encodes). All prompts are original; none names or
// imitates an existing game, film or artist.
//
// Fields: id (raw file prefix) · api 'sfx'|'music' · body (the API request body) · out: the shipped
// sound id(s) · split: N → the take holds N separated sounds, split on silence into variants · cls: 'sfx' (mono, peak
// −3 dBFS) | 'loop' (mono seamless loop, peak −3 dBFS) | 'bed' (stereo seamless loop, −20 LUFS) | 'music' (stereo, −18
// LUFS; loop: true → a seamless loop is cut at a bar-like period) | 'sting' (stereo, −18 LUFS one-shot).

const KEY = 'D minor, 92 BPM, steady 4/4';

export const MUSIC = [
  {
    id: 'mus_night', api: 'music', cls: 'music', loop: true,
    body: {
      prompt: `Instrumental dark folk score for a tense night siege at a lonely hilltop fortress under a huge cold moon. ${KEY}. A droning hurdy-gurdy and a low bowed fiddle drone, slow frame drums and a deep low tom pulse on every beat, a sparse plucked bouzouki ostinato, low cello swells, rattling bones percussion. Ominous and watchful, one even intensity from start to end so it can loop seamlessly; no intro build, no ending, no big finale, no vocals.`,
      music_length_ms: 96000, force_instrumental: true,
    },
  },
  {
    id: 'mus_kindle', api: 'music', cls: 'music', loop: true,
    body: {
      prompt: `Instrumental dark folk battle score, the heavier and faster-feeling variation of a night siege theme. ${KEY}. Pounding war drums and frame drums on every beat with driving eighth-note toms, an aggressive hurdy-gurdy and fiddle drone with fast bowed ostinatos, gritty low strings, rhythmic stomps, a crackling urgent energy. Relentless at one even high intensity from start to end so it can loop seamlessly; no intro, no ending, no vocals.`,
      music_length_ms: 96000, force_instrumental: true,
    },
  },
  {
    id: 'mus_troll', api: 'music', cls: 'music', loop: true,
    body: {
      prompt: `Instrumental boss battle theme for a dark folk fantasy siege: a giant ash troll marches up the hill. ${KEY}. Huge slow war drums, deep brass-like low horns blaring a heavy three-note motif, growling low strings and a hurdy-gurdy drone, anvil hits on the off-beats, massive and menacing. One even intensity throughout so it can loop seamlessly; no intro, no ending, no vocals.`,
      music_length_ms: 80000, force_instrumental: true,
    },
  },
  {
    id: 'mus_dawn', api: 'music', cls: 'sting',
    body: {
      prompt: 'Short instrumental resolution cue for the dawn after a long night siege: warm and relieved dark folk in D major, a solo fiddle melody over a soft hurdy-gurdy drone, a gentle frame-drum heartbeat slowing down, light strings swelling as the sun rises, ending on a held peaceful chord with a natural fade out. No vocals.',
      music_length_ms: 22000, force_instrumental: true,
    },
  },
  {
    id: 'mus_nightcard', api: 'music', cls: 'sting',
    body: {
      prompt: 'A five-second instrumental sting for a title card at the start of a night siege: one deep booming frame-drum hit and a low horn swell over a hurdy-gurdy drone in D minor, dark and ominous, ending in a long reverb tail. No vocals.',
      music_length_ms: 6000, force_instrumental: true,
    },
  },
  {
    id: 'mus_fallen', api: 'music', cls: 'sting',
    body: {
      prompt: 'A five-second instrumental defeat sting: a low mournful fiddle phrase falling over a hurdy-gurdy drone in D minor, one final soft drum hit, ending in a long reverb tail. No vocals.',
      music_length_ms: 6000, force_instrumental: true,
    },
  },
];

const S = (id, text, duration_seconds, o = {}) => ({
  id, api: 'sfx', cls: o.cls || 'sfx', split: o.split || 0, out: o.out || id,
  body: { text, duration_seconds, prompt_influence: o.pi ?? (o.split ? 0.65 : 0.45), ...(o.loop ? { loop: true } : {}) },
});

export const SFX = [
  // weapons
  S('w_kestrel_shot', 'Three separate shots from one antique flintlock pistol: each a sharp flint snap, a short powder fizz and a loud deep black-powder bang with a short outdoor echo, one second of silence between the shots, nothing else', 5, { split: 3 }),
  S('w_kestrel_reload', 'Reloading an antique flintlock pistol quickly: powder poured from a horn, a lead ball rammed down the barrel with a thin metal ramrod in two short strokes, then the hammer cocked with a crisp click', 1.6),
  S('w_blunder_shot', 'Two separate blasts from an antique brass blunderbuss: each a huge booming black-powder explosion with a scatter of lead shot and a rolling outdoor echo, two seconds of silence between the blasts, nothing else', 6, { split: 2 }),
  S('w_blunder_reload', 'Reloading an antique brass blunderbuss: powder poured down the wide flared muzzle, a handful of lead shot rattling in, a cloth wad rammed down, the heavy hammer cocked', 2),
  S('w_lance_ignite', 'A handheld flamethrower igniting: a brass valve clicks open, oil gas hisses and a pilot flame catches with a deep whoomph', 1.2),
  S('w_lance_loop', 'A handheld flamethrower spraying a continuous jet of burning oil: a steady roaring rushing stream of fire with crackles, constant intensity', 4, { cls: 'loop', loop: true }),
  S('w_lance_stop', 'A handheld flamethrower shutting off: the flame jet cuts out with a sputter, a brass valve clank and a fading hiss of gas and dripping burning oil', 1.5),
  S('w_switch', 'Quickly swapping weapons: a leather strap creaks and a heavy metal pistol is drawn with a short rattle of buckles', 0.8),
  S('bomb_throw', 'A clay firebomb with a burning rag thrown hard overhand: a quick arm whoosh and a fluttering flame trail flying away', 1.2),
  S('bomb_burst', 'Two separate impacts of a clay pot full of oil shattering on stone and bursting into a big ball of flame with a deep whoomph, two seconds of silence between them, nothing else', 6, { split: 2 }),
  S('sunburst', 'A massive fire nova: a short rising inhale of flame, then a huge ring of fire blasting outward with a deep roaring whoosh and crackling', 3),
  // fire and oil
  S('barrel_burst', 'An oil barrel exploding: wooden staves bursting, a deep boom and a large fireball whoomph with crackling burning debris falling', 3),
  S('trough_ignite', 'Oil in a long stone trench catching fire: a fast whoosh of flame racing along it from one end to the other, rising into a strong roar', 3.5),
  S('fire_low', 'A small campfire crackling softly at night: gentle pops, small crackles and a soft hiss, steady', 10, { cls: 'loop', loop: true }),
  S('fire_mid', 'A large bonfire burning steadily: strong crackling, popping wood and a low roar of flames, steady', 10, { cls: 'loop', loop: true }),
  S('fire_high', 'A raging wall of fire: a deep continuous roar of a big blaze with heavy crackling and whooshing gusts, steady', 10, { cls: 'loop', loop: true }),
  S('ignite_puff', 'Three separate small fire ignitions: each a short soft whoomph of flame catching on cloth, one second of silence between them, nothing else', 4, { split: 3 }),
  S('fire_out', 'Fire dying out: flames sputtering down to glowing embers with a soft hiss of smoke', 2.5),
  // the horde
  S('crowd_far', 'A distant horde of hundreds of small goblin creatures gathering in a valley at night: a low rumbling murmur of growls, squeaks and chatter, no words, steady', 12, { cls: 'bed', loop: true }),
  S('crowd_near', 'A dense crowd of small vicious goblin creatures close by: snarling, squeaking, hissing and gibbering chatter, many feet shuffling on dirt, no words, steady', 12, { cls: 'bed', loop: true }),
  S('gob_death_a', 'Three separate short death squeaks of small goblin creatures: each a high raspy yelp cut off abruptly, one second of silence between them, no words', 4, { split: 3, out: 'gob_death' }),
  S('gob_death_b', 'Three separate short death cries of small gremlin creatures: a gurgling croak, a choked squeal and a raspy yelp, one second of silence between each, no words', 4, { split: 3, out: 'gob_death' }),
  S('gob_burn', 'Four separate panicked shrieks of small goblin creatures catching fire: high raspy screams with crackling flames, one second of silence between each, no words', 7, { split: 4 }),
  S('imp_chitter', 'Three separate quick high chittering squeaks of a tiny imp creature, one second of silence between them, no words', 4, { split: 3 }),
  S('hit_flesh', 'Three separate bullet impacts into a small creature: each a short wet thwack, one second of silence between them, nothing else', 3.5, { split: 3 }),
  S('hit_wood', 'Two separate musket balls thunking hard into a thick wooden shield, one second of silence between them, nothing else', 2.5, { split: 2 }),
  S('claw', 'Three separate quick claw swipes through the air, each with a small snarl, one second of silence between them', 3.5, { split: 3 }),
  S('spear_throw', 'A wooden spear thrown hard: a fast whooshing whistle through the air, flying past', 1.2),
  S('spear_impact', 'Two separate spear impacts: first a spear thudding into packed earth, then a spear striking a leather-armoured body, one second of silence between them', 3, { split: 2 }),
  S('gate_thud', 'Three separate heavy blows against a barricaded oak castle door: deep wooden booms with iron fittings rattling, one second of silence between them', 5, { split: 3 }),
  S('gate_splinter', 'A thick oak door splintering under a heavy blow: loud cracking wood and planks breaking', 2),
  S('gate_breach', 'A barricaded castle gate collapsing: oak doors bursting apart, planks and iron bars crashing down, a big wooden crash', 3.5),
  S('horde_flee', 'A large crowd of small goblin creatures shrieking in panic and running away into the distance, fading out', 5),
  // the beacon
  S('beacon_kindle', 'A huge iron fire basket on a stone tower bursting into flame: a deep rising roar of a beacon fire igniting, crackling and blazing up', 3.5),
  S('beacon_ready', 'A soft rising crackle of embers brightening with a gentle low warm whoosh', 1.5),
  // pickups and UI
  S('gold', 'Three separate gold coins clinking as they are picked up: small bright metallic clinks, one second of silence between them', 3, { split: 3 }),
  S('heart', 'A soft warm magical pickup: a gentle rising shimmer with one soft heartbeat thump', 1.2),
  S('levelup', 'A bright magical level-up sound: a quick rising arpeggio of warm glassy chimes and a plucked harp with a soft sparkle, triumphant and short', 2),
  S('card_pick', 'Choosing a parchment card: a crisp paper flip and slap on a wooden table with a soft warm magical shimmer', 1),
  // the Ash Troll
  S('troll_horn', 'A distant deep war horn blown once from far down a misty valley at night: one long low mournful note echoing off the hills', 4),
  S('troll_roar', 'A giant troll roaring: a thunderous deep guttural rocky roar echoing across a valley at night', 3.5),
  S('troll_windup', 'Two separate deep straining growls of a giant troll gathering its strength, one second of silence between them, no words', 4.5, { split: 2 }),
  S('troll_step', 'Two separate colossal footsteps of a giant stone troll: deep earth-shaking thuds with gravel crunching, one second of silence between them', 4, { split: 2 }),
  S('troll_smash', 'A giant troll slamming a huge fist down onto a wooden gate and stone: a massive crash, cracking timber and a deep boom', 2.5),
  S('troll_throw', 'A giant troll heaving a boulder: a deep grunt of effort and a heavy rock whooshing away through the air', 2),
  S('boulder_impact', 'A large boulder crashing into the ground: a deep heavy thud, rock cracking and dirt and gravel scattering', 2.5),
  S('troll_stomp', 'A giant stamping the ground: a deep concussive boom, the earth shaking with rumbling debris', 2.5),
  S('troll_hit', 'Two separate musket ball impacts on a giant creature’s stony ash-covered hide: each a dull rocky crack with a puff of ash, one second of silence between them', 3, { split: 2 }),
  S('troll_sizzle', 'A glowing red-hot stone hissing and sizzling as heat builds up, crackling embers', 2.5),
  S('troll_death', 'A giant troll’s final dying roar fading into a groan as its huge body collapses to the ground with a massive crumbling thud', 5),
  // the Lamplighter
  S('p_hurt', 'Three separate short pained grunts of an adult man being struck, no words, one second of silence between them', 4, { split: 3 }),
  S('p_death', 'A man’s final pained gasp and groan as he collapses onto the ground, no words', 2.5),
  S('step_earth', 'Four separate footsteps of a leather boot on packed dry earth and gravel, half a second apart, nothing else', 3, { split: 4 }),
  S('step_stone', 'Four separate footsteps of a leather boot on a stone castle wall walk, half a second apart, nothing else', 3, { split: 4 }),
  S('step_timber', 'Four separate footsteps of a heavy boot on a wooden timber stair, hollow creaking planks, half a second apart, nothing else', 3, { split: 4 }),
  // ambience
  S('wind_gust', 'A cold night wind gust blowing across a bare hilltop, rising and falling away', 5),
  S('amb_night', 'A quiet forest at night on a hilltop: soft wind in pine trees, crickets, and a distant owl hooting now and then, steady', 20, { cls: 'bed', loop: true }),
  // single-sound takes that add variants where a multi-sound take held fewer distinct sounds than wanted
  S('w_kestrel_shot_b', 'A single shot from an antique flintlock pistol: a sharp flint snap, a short fizz of priming powder and a loud deep black-powder bang with a short outdoor echo over a hillside', 2, { out: 'w_kestrel_shot' }),
  S('w_kestrel_shot_c', 'One antique flintlock pistol firing outdoors at night: a crisp hammer snap and a punchy booming black-powder crack that echoes off a stone wall', 2, { out: 'w_kestrel_shot' }),
  S('hit_flesh_b', 'A single musket ball smacking into a small goblin creature: a short meaty wet thwack with a tiny squeak', 0.8, { out: 'hit_flesh' }),
  S('hit_flesh_c', 'A single lead shot hitting a small creature hard: a dull punchy thump with a little splatter', 0.8, { out: 'hit_flesh' }),
  S('ignite_puff_b', 'A small creature’s rag clothing suddenly catching fire: a quick soft whoomph of flame and a brief crackle', 1, { out: 'ignite_puff' }),
  S('troll_hit_b', 'A single musket ball cracking against a giant’s stony hide: a dull rocky clack and a puff of ash and grit', 1, { out: 'troll_hit' }),
  S('gob_death_c', 'A single small goblin dying: a short high strangled squeal that cuts off with a gurgle, no words', 1, { out: 'gob_death' }),
  S('gob_burn_b', 'A single small goblin creature on fire: one long panicked raspy shriek over crackling flames, no words', 1.5, { out: 'gob_burn' }),
  S('troll_step_b', 'One colossal footstep of a giant stone troll on packed earth: a deep heavy thud with a low rumble and gravel settling', 1.5, { out: 'troll_step' }),
  S('troll_step_c', 'A single huge stomping footfall of a giant creature on a dirt road: a booming low impact, the ground trembling, small stones rattling', 1.5, { out: 'troll_step' }),
  S('gate_thud_b', 'One heavy blow against a barricaded oak castle gate: a deep resonant wooden boom with iron bands rattling and dust falling', 1.2, { out: 'gate_thud' }),
  S('gob_death_d', 'A single small gremlin creature killed: a quick raspy croaking yelp and a wheeze, no words', 1, { out: 'gob_death' }),
];

export const CAPS = { musicCalls: 25, musicSeconds: 480, sfxCalls: 80 };

// =========================================================================================== DESIGN §9 SET (--wave2)
// The camp, Night II, the coming-soon card, Brother Cinder's voice, towers, elites, Dousers, charms,
// the new skills. Caps for this set (enforced by the generation client on the ledger records tagged `wave: 2`): ≤ 4 music calls,
// ≤ 30 SFX calls, ≤ 10 TTS-side calls (voice design + voice save + the line readings all count).
export const CAPS2 = { musicCalls: 4, sfxCalls: 30, ttsCalls: 10 };

export const MUSIC2 = [
  {
    id: 'mus_camp', api: 'music', cls: 'music', loop: true, wave: 2,
    body: {
      prompt: `Instrumental dark folk dusk theme for a quiet camp inside a lonely hilltop keep between night sieges: calm, warm on the surface and slightly sinister underneath. ${KEY}. Low sustained cellos and violas, a slow music-box melody with a few uneasy notes, a soft hurdy-gurdy drone, a gentle brushed frame drum on the downbeats, embers crackling softly in the background. Restful but watchful, one even intensity from start to end so it can loop seamlessly; no intro build, no ending, no vocals.`,
      music_length_ms: 96000, force_instrumental: true,
    },
  },
  {
    id: 'mus_night2', api: 'music', cls: 'music', loop: true, wave: 2,
    body: {
      prompt: `Instrumental dark folk score for the second night of a siege at a hilltop fortress under a blood-red moon: a heavier, darker variation of the night siege theme. ${KEY}. A grinding hurdy-gurdy and a low bowed fiddle drone, deep war drums and a low tom pulse on every beat, a driving plucked bouzouki ostinato, heavy low cello and double bass swells, rattling chains and bones percussion, dark low brass drones. Ominous and relentless, one even intensity from start to end so it can loop seamlessly; no intro build, no ending, no big finale, no vocals.`,
      music_length_ms: 96000, force_instrumental: true,
    },
  },
  {
    id: 'mus_soon', api: 'music', cls: 'sting', wave: 2,
    body: {
      // take 1 (raw/music/mus_soon.mp3, its receipt keeps the prompt) came back as a loud hit decaying to silence: the
      // retake (__r2) asks for a crescendo that stops dead
      prompt: 'An eight-second ominous crescendo for a dark fantasy "coming soon" title card. It starts from near silence and swells steadily louder the whole time: a low wordless choir of deep voices singing "ah" over a deep drone in D minor and a rising drum roll, reaching its loudest at the very end and then stopping dead with an abrupt cut to silence, no reverb tail. Wordless choir only, no lyrics, no words.',
      music_length_ms: 8000, force_instrumental: false,
    },
  },
];

const S2 = (id, text, d, o = {}) => ({ ...S(id, text, d, o), wave: 2 });
export const SFX2 = [
  // gold, XP, charms, the shop
  S2('coin_spill', 'Three separate handfuls of a few small gold coins spilling and bouncing onto packed earth: bright metallic jingles and clinks, one second of silence between them, nothing else', 4, { split: 3 }),
  S2('xp_collect', 'Three separate tiny soft crystalline chimes of a glowing ember gem being collected: each a short bright glassy ting with a warm sparkle, one second of silence between them, nothing else', 3.5, { split: 3 }),
  S2('charm_found', 'A small magical charm found: a glassy shimmering chime rising in two notes with a soft warm sparkle and a breath of air, short and mysterious', 2),
  S2('shop_buy', 'Buying from a merchant: a small leather purse of gold coins poured onto a wooden counter, a short coin jingle and a soft thump', 1.5),
  S2('charm_equip', 'A small carved bone charm on a cord snapped into place on a leather strap: a crisp click, a tiny clink and a soft low magical hum that fades', 1.2),
  S2('npc_open', 'The heavy cloth curtain of a small market stall drawn aside, a quiet stir of embers in an iron brazier and a soft low warm whoosh', 1.5),
  // towers
  S2('tower_build', 'A stone tower rising out of the ground by magic: heavy stone blocks grinding and scraping together, gravel falling, ending in a deep fiery whoomph', 3),
  S2('tower_upgrade', 'A stone tower growing stronger: a short heavy stone grind and a rising crackle of fire ending in a deep whoomph', 2),
  S2('obelisk_pulse', 'Two separate magical fire pulses from a black stone obelisk: each a deep resonant whoomph with a low humming throb and a ring of flame rushing outward, two seconds of silence between them, nothing else', 5, { split: 2 }),
  S2('chain_throw', 'Two separate iron chains with hooks thrown fast through the air: each a quick rattling chain whoosh, one second of silence between them, nothing else', 3, { split: 2 }),
  S2('chain_hook', 'Two separate iron hooks catching a small goblin creature: each a sharp metal clank, a chain yank and a short surprised goblin yelp, one second of silence between them, no words', 4, { split: 2 }),
  // skills
  S2('orbit_loop', 'Small fireballs circling fast around a person: a steady whooshing hum of flames passing by with a soft crackle, constant intensity', 4, { cls: 'loop', loop: true }),
  S2('orbit_hit', 'Three separate small fireballs striking a small creature: each a quick sizzling fwump of flame, one second of silence between them, nothing else', 3.5, { split: 3 }),
  S2('meteor_whistle', 'A burning rock falling fast from the sky: a descending whistling scream of fire rushing down, getting louder, ending just before the impact', 1.8),
  S2('meteor_impact', 'A burning meteor crashing into the ground: a deep explosive boom, rock shattering and a big rush of crackling flames', 2.5),
  S2('trail_crackle', 'Three separate short bursts of small flames catching on the ground behind running feet: each a quick soft crackle and hiss, one second of silence between them, nothing else', 3.5, { split: 3 }),
  // elites and Dousers
  S2('chief_horn', 'A goblin chieftain blowing a crude ram horn war horn nearby: a rough raspy brassy blare in two short rising blasts, fierce, outdoors', 3),
  S2('hexer_cackle', 'A small goblin witch cackling: a raspy mocking high laugh, short, no words', 2),
  S2('hex_zap', 'A sour cursed magic spell: a short wobbling detuned zap with a sickly buzzing crackle and a hissing whisper, no words', 1.5),
  S2('lance_sputter', 'A handheld flamethrower choking and sputtering: the flame jet coughs, pops and stutters with wet hissing spurts, faltering', 2),
  S2('douse_throw', 'A wooden bucket of water swung and thrown hard: a creak of the rope handle and a big slosh of water flying through the air', 1.5),
  S2('douse_splash', 'Two separate buckets of water splashing onto burning fire: each a heavy water splash with a loud hiss of steam, one second of silence between them, nothing else', 5, { split: 2 }),
  // the camp
  S2('amb_camp', 'A calm dusk on a hilltop outside a stone keep: a light breeze, a few evening birds singing in the distance, the first crickets, the soft crackle of a small fire nearby, steady', 20, { cls: 'bed', loop: true }),
  S2('horde_rise', 'A large goblin horde far away down a valley at nightfall raising a distant war cry, drums beating and crude horns, echoing, distant', 5),
];

/** Brother Cinder (docs/STORY.md hint 4): an original designed voice (no real person, no sound-alike), then one reading per line. */
export const CINDER = {
  design: {
    voice_description: 'A very old man, small and hunched: a dry, papery, slightly raspy voice, amused and knowing, unhurried, speaking softly with a small smile in it, a neutral English accent. An original character voice. Studio quality, close, dry.',
    text: "You're home, Lamplighter. The lamp missed you. Coin for the hide? It wears thin on you. Always has. They climb because they're afraid. Afraid is good. Afraid is loud. Don't mind the gloves. They smoke when you're cross. Odd. I never see you eat.",
    model_id: 'eleven_multilingual_ttv_v2', guidance_scale: 4, loudness: 0.5, seed: 4511,
  },
  name: 'Valleyward · Brother Cinder',
  settings: { stability: 0.42, similarity_boost: 0.8, style: 0.25, use_speaker_boost: true, speed: 0.9 },
  model: 'eleven_multilingual_v2',
  /** line id (EV.NPC_LINE `line`) → text, verbatim from docs/STORY.md hint 4 */
  lines: {
    home: "You're home, Lamplighter. The lamp missed you.",
    hide: 'Coin for the hide? It wears thin on you. Always has.',
    afraid: "They climb because they're afraid. Afraid is good. Afraid is loud.",
    gloves: "Don't mind the gloves. They smoke when you're cross.",
    eight: 'Eight more nights. Then we can all go out.',
    eat: 'Odd. I never see you eat.',
    fall: "You'll be back. You always are. That's rather the point of you.",
  },
};

// The first gun-shot variants read as different weapons (a late second bang, a
// hiss, a thin click). New single-shot takes with tight prompts; build.mjs rebuilds both gun ids from the clean parts and
// layers one procedural punch under every variant (GUN in build.mjs).
const KES = 'A single antique flintlock pistol gunshot, instant: one sharp loud black-powder bang right at the very start, no delay before the shot, a short punchy body and a brief outdoor echo off a stone wall that fades quickly. No second shot, no ricochet, no hiss, no click before it, nothing else.';
const BLU = 'A single heavy brass blunderbuss blast, instant: one huge deep booming black-powder explosion right at the very start, no delay before the shot, a scatter of lead shot and a rolling outdoor echo that decays quickly. No second shot, no ricochet, no hiss, nothing else.';
export const GUN2 = [
  S2('w_kestrel_shot_d', KES, 1.0, { out: 'w_kestrel_shot', pi: 0.75 }),
  S2('w_kestrel_shot_e', KES, 1.0, { out: 'w_kestrel_shot', pi: 0.75 }),
  S2('w_kestrel_shot_f', KES, 1.0, { out: 'w_kestrel_shot', pi: 0.75 }),
  S2('w_blunder_shot_c', BLU, 1.5, { out: 'w_blunder_shot', pi: 0.75 }),
  S2('w_blunder_shot_d', BLU, 1.5, { out: 'w_blunder_shot', pi: 0.75 }),
];

// =========================================================================================== THE ORGAN, BATS, PYRE BURST SET (--wave3)
// The THUNDER ORGAN (one seamless firing loop: one sound per gun), the Bat Gremlin,
// Pyre Burst, the troll's Ash Roar. Cap for this set (ledger records tagged `wave: 3`): ≤ 12 SFX calls.
export const CAPS3 = { sfxCalls: 12 };
const S3 = (id, text, d, o = {}) => ({ ...S(id, text, d, o), wave: 3 });
export const SFX3 = [
  S3('organ_loop', 'A brass six-barrel hand-cranked rotary gun firing continuously at a very fast steady rate of about eighteen black-powder shots per second: a relentless even rattling roar of rapid bangs with a metallic mechanical clatter, constant speed and loudness from start to end, no spin-up, no slowing down, no pauses, outdoors.', 4, { cls: 'loop', loop: true, pi: 0.7 }),
  S3('organ_loop_b', 'Continuous rapid automatic gunfire from an antique brass rotary cannon, eighteen sharp black-powder shots every second in a perfectly even stream, mechanical brass clatter under the shots, steady constant intensity throughout, no start, no stop, no echo tail.', 4, { cls: 'loop', loop: true, pi: 0.7, out: 'organ_loop' }),
  S3('organ_overheat', 'An overheated brass rotary gun: a sharp hiss of steam venting from hot metal barrels, a few metallic pings and ticks of cooling brass, fading', 1.8),
  S3('bat_flap', 'The leathery wing flaps of a small creature gliding on stitched bat wings nearby: soft steady rhythmic whooshing flaps, constant, no voice', 4, { cls: 'loop', loop: true }),
  S3('bat_screech', 'A small goblin creature screeching as it dives from the sky on bat wings: a sharp rising shrill screech with a rushing whoosh of air, no words', 1.5),
  S3('bat_crash', 'A small burning flying creature crashing into the ground: a soft thud, snapping wooden glider struts, a small whoomph of flame and a crackle, nothing else', 1.5),
  S3('pyre_pop', 'Three separate short fiery pops of a small body bursting into flame: each a quick punchy whoomph with a crackle, one second of silence between them, nothing else', 4, { split: 3 }),
  S3('ash_roar', 'A giant ash troll roaring a huge cone of ash and steam over burning fire: a deep guttural rumbling roar with a great rushing hiss of steam as the flames are smothered, then fading', 4),
];

// =========================================================================================== DESIGN §8 SET (--wave4)
// The ten nights (percussion layers by night), the Rainmother, the ending (sections cued on
// TIMELINE.ending's beats), rain and the storm, Brother Cinder's last line. Caps (records tagged `wave: 4`):
// ≤ 6 music calls, ≤ 20 SFX calls, ≤ 4 TTS calls. The credits theme is made from the camp loop itself (build.mjs).
export const CAPS4 = { musicCalls: 6, sfxCalls: 20, ttsCalls: 4 };
const M4 = (id, prompt, ms, o = {}) => ({ id, api: 'music', cls: o.cls || 'music', loop: !!o.loop, wave: 4, ...(o.out ? { out: o.out } : {}), body: { prompt, music_length_ms: ms, force_instrumental: o.instr ?? true } });
export const MUSIC4 = [
  M4('mus_perc_a', `Percussion only, no melody, no instruments with pitch: a heavy war-drum layer for a dark folk siege score, ${KEY}. Deep low war drums and frame drums on every beat, booming floor-tom accents on beats 2 and 4, rattling shakers and bone clatter in eighths, steady and driving; one even intensity from start to end so it can loop seamlessly; no intro, no fills at the end, no ending, no vocals.`, 72000, { loop: true }),
  M4('mus_perc_b', `Percussion only, no melody: a relentless heavier battle percussion layer for the last nights of a siege, ${KEY}. Massive taiko-like drums, pounding sixteenth-note toms, anvil strikes on the off-beats, iron chains rattling, deep booms on each downbeat, furious and steady; one even intensity throughout so it can loop seamlessly; no intro, no ending, no vocals.`, 72000, { loop: true }),
  M4('mus_rain', `The theme of an ancient river giantess, a vast and sorrowful storm-driven boss theme in a dark folk world, ${KEY}. A low wordless choir of deep voices singing long mournful "ah" and "oh" vowels, rolling timpani and huge slow drums, low cellos and basses, a hurdy-gurdy drone, the sound of heavy rain and distant thunder woven through, tragic and immense. One even intensity throughout so it can loop seamlessly; no intro, no ending; wordless choir only, no lyrics, no words.`, 96000, { loop: true, instr: false }),
  M4('mus_end_portal', 'Fourteen seconds: after a deep silence, a dark wordless choir of low voices rises slowly and inexorably over a deep sub drone in D minor, swelling and darkening as a gateway of fire tears open in the sky, ominous and awe-struck, ending on a held dark chord still rising in tension. Wordless choir only, no lyrics, no words.', 14000, { cls: 'sting', instr: false }),
  M4('mus_end_reveal', 'Ten seconds: a brutal, overwhelming orchestral swell in D minor: massive drums, roaring low brass, a screaming dark choir, everything crashing in at once as a monstrous figure is revealed, then one colossal final hit that rings out into a long dark reverb. Wordless choir only, no lyrics, no words.', 10000, { cls: 'sting', instr: false }),
  M4('mus_end_hunt', 'Fourteen seconds: a quiet, terrible coda in D minor: a single low sustained string note, a slow distant heartbeat drum, a faint high detuned violin harmonic and a whisper of a wordless choir, cold and sorrowful, slowly fading toward silence. No lyrics, no words.', 14000, { cls: 'sting', instr: false }),
];
const S4 = (id, text, d, o = {}) => ({ ...S(id, text, d, o), wave: 4 });
export const SFX4 = [
  S4('rain_bed', 'Heavy steady rain falling on a stone castle wall, wooden roofs and wet earth at night, a constant dense hiss with drips and gusts, steady', 15, { cls: 'bed', loop: true }),
  S4('thunder', 'Three separate thunder strikes over a valley at night: each a sharp close crack followed by a long deep rolling rumble, two seconds of silence between them, nothing else', 14, { split: 3 }),
  S4('ram_drum', 'A goblin war drum beaten slowly and heavily as a siege ram crew marches: a deep booming hide drum on a steady march beat with a rough wooden clack, constant, outdoors', 6, { cls: 'loop', loop: true }),
  S4('ram_impact', 'Two separate impacts of a huge oak battering ram with an iron head smashing into a barricaded castle gate: a colossal deep wooden boom, iron clanging and splintering, two seconds of silence between them', 6, { split: 2 }),
  S4('coven_chant', 'Three goblin witches chanting together in an eerie low rhythmic murmur, a wordless hissing and humming incantation with a sour droning magic hum underneath, constant, no words', 8, { cls: 'loop', loop: true }),
  S4('tide_wave', 'A huge wave of river water surging up a dirt road and crashing over everything: a deep rising rush of water, a massive crashing splash and a long hissing wash of steam as it smothers fire', 4.5),
  S4('whirlpool', 'A large swirling whirlpool of dark water: a deep rushing circular gurgling roar of spinning water, constant', 6, { cls: 'loop', loop: true }),
  S4('rain_step', 'Two separate colossal footsteps of a giantess made of river stone and water: each a massive wet stony thud with a heavy splash of water and stones grinding, two seconds of silence between them', 6, { split: 2 }),
  S4('rain_rise', 'A colossal giantess of water and stone rising out of a river at night: a huge rushing cascade of water pouring off her, stones grinding, and a deep mournful wordless moan, no words', 6),
  S4('lantern_shatter', 'Two separate glass lanterns shot and shattering high above: each a bright glass smash with a hissing puff of cold blue fire going out, one second of silence between them', 4, { split: 2 }),
  S4('rain_collapse', 'A colossal giantess of water and stone collapsing into a valley: a long thunderous crash of water and boulders, a huge splash, then a long hiss of steam fading to quiet', 7),
  S4('portal_rip', 'A gateway of fire tearing open in the sky: a deep cosmic ripping roar, a vast low rumble of the air being torn apart and a howling rush of fire pouring through', 7),
  S4('hell_wind', 'A scorching burning wind over a ruined hillside: a deep roaring hot gale with crackling embers and distant fires, ominous, constant', 12, { cls: 'bed', loop: true }),
  S4('gate_open', 'A huge barricaded castle gate forced open from the inside: heavy iron bars sliding, chains running, great oak doors grinding and groaning open and booming against the walls', 5),
  S4('host_march', 'A vast army of huge creatures marching down a hill in the distance: a deep rumbling of hundreds of heavy feet, rattling armour and low growls, steady, distant', 10, { cls: 'bed', loop: true }),
  S4('demon_roar', 'A towering monstrous creature of fire roaring: a huge deep inhuman roar with a growling rasp and a roaring rush of flame, echoing across a valley, no words', 5),
  S4('gloves_ignite', 'Leather gloves suddenly catching fire on burning hands: a fast whoosh of flame, crackling, leather hissing and crisping as it burns away', 3),
  S4('hunt_flee', 'Animals fleeing a forest fire at night in the distance: birds bursting into flight with flapping wings, hooves galloping away, a boar squealing, crackling fire behind, no voices', 6),
];
/** Brother Cinder's last line (STORY.md: Night X), read in his existing saved voice (raw/tts/cast.json) */
export const CINDER4 = { master: 'Welcome home, Master.' };

// ============================================================================================ DESIGN §10.4 (--wave5)
// EMBER GALE (EV.GALE every 14 / 11 / 8 s): one hot gust that sweeps from the keep down the slope.
// Cap for this job (records tagged `wave: 5`): ≤ 4 SFX calls. Two takes; build.mjs keeps the softer sweep.
export const CAPS5 = { sfxCalls: 4 };
const S5 = (id, text, d, o = {}) => ({ ...S(id, text, d, o), wave: 5 });
const GALE = 'A hot gust of wind blowing out from a burning fortress and sweeping away down a hillside: a smooth rising rushing whoosh of hot air fanning flames, a soft roar of fire flaring up as it passes, then moving away and fading. Smooth start, no hit, no bang, no crackle pops, nothing else.';
export const SFX5 = [
  S5('gale_gust', GALE, 2.8, { pi: 0.6 }),
  S5('gale_gust_b', GALE, 2.8, { pi: 0.6, out: 'gale_gust' }),
];
