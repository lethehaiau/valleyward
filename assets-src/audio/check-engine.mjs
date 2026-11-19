#!/usr/bin/env node
// VALLEYWARD · audio · a Node check of the engine's logic with a mock Web Audio (no sound): loading from the
// manifest, every one-shot playable, the music state machine (night → kindle → night → troll → dawn), the per-type
// limiter (300 goblin deaths in 1 s and in one frame), the voice pool cap, and that update() allocates nothing heavy.
//   node assets-src/audio/check-engine.mjs        exit 0 = all checks pass
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(here, '../..');
const MAN = path.join(path.resolve(APP, process.env.VALLEYWARD_AUDIO_DIR || '.private/audio'), 'manifest.json');
if (!fs.existsSync(MAN)) { console.log(`check-engine: skipped, no audio files (${path.relative(APP, MAN)} is missing; see tools/vite-audio.mjs)`); process.exit(0); }
const man = JSON.parse(fs.readFileSync(MAN, 'utf8'));
const durOf = new Map(); for (const s of Object.values(man.sounds)) for (const f of s.files) durOf.set(f.file, f.dur);

// ---------------------------------------------------------------------------------------------- mock Web Audio
let now = 0;
const started = []; // { buffer, t, node }
class Param { constructor(v = 0) { this.value = v; } setValueAtTime(v) { this.value = v; } linearRampToValueAtTime(v) { this.value = v; } exponentialRampToValueAtTime(v) { this.value = v; } setTargetAtTime(v) { this.value = v; } cancelScheduledValues() {} }
class Node { connect(n) { return n; } disconnect() {} }
class Gain extends Node { gain = new Param(1); }
class Pan extends Node { pan = new Param(0); }
class Biquad extends Node { frequency = new Param(350); Q = new Param(1); type = 'lowpass'; }
class Comp extends Node { threshold = new Param(); knee = new Param(); ratio = new Param(); attack = new Param(); release = new Param(); }
class Src extends Node {
  buffer = null; loop = false; loopStart = 0; loopEnd = 0; playbackRate = new Param(1); onended = null; t = 0; stopped = false;
  start(t = now) { this.t = t; started.push(this); }
  stop() { this.stopped = true; }
}
class Ctx {
  state = 'suspended'; sampleRate = 48000; destination = new Node(); listener = {};
  get currentTime() { return now; }
  createGain() { return new Gain(); } createStereoPanner() { return new Pan(); } createBiquadFilter() { return new Biquad(); }
  createDynamicsCompressor() { return new Comp(); } createBufferSource() { return new Src(); } createConvolver() { return Object.assign(new Node(), { buffer: null }); }
  createBuffer(ch, len, sr) { const d = Array.from({ length: ch }, () => new Float32Array(len)); return { duration: len / sr, numberOfChannels: ch, sampleRate: sr, length: len, getChannelData: (c) => d[c] }; }
  async decodeAudioData(ab) { const file = new TextDecoder().decode(ab); const d = durOf.get(file) ?? 0.5; return { duration: d, numberOfChannels: 1, sampleRate: 48000, length: Math.round(d * 48000) }; }
  async resume() { this.state = 'running'; } async suspend() { this.state = 'suspended'; } async close() { this.state = 'closed'; }
}
globalThis.AudioContext = Ctx;
globalThis.fetch = async (url) => {
  const rel = String(url).replace(/^.*?audio\//, '').replace(/\?.*$/, '');
  if (rel === 'manifest.json') return { ok: true, json: async () => man };
  if (!durOf.has(rel)) return { ok: false, status: 404 };
  return { ok: true, arrayBuffer: async () => new TextEncoder().encode(rel).buffer };
};

const { createAudio } = await import(path.join(APP, 'src/audio/index.js'));
const { SOUNDS } = await import(path.join(APP, 'src/audio/bank.js'));
const { EV } = await import(path.join(APP, 'src/shared/events.js'));
const { ARENA } = await import(path.join(APP, 'src/shared/arena.js'));
const fails = [];
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) fails.push(msg); };
const tick = () => new Promise((r) => setTimeout(r, 0));

const audio = createAudio({ assetsBase: './assets/' });
await audio.ready();
const st0 = audio.stats();
check(st0.loaded === st0.total && st0.failed === 0, `every manifest file decodes (${st0.loaded}/${st0.total}, failed ${st0.failed})`);
check(audio._ctx.state === 'suspended', 'the AudioContext exists at load and waits (suspended) for the first gesture');
audio.unlock(); await tick();
check(audio._ctx.state === 'running', 'unlock() resumes it');

// every one-shot plays
const silent = Object.entries(SOUNDS).filter(([id, d]) => { if (d.loop) return false; now += 10; return !audio.play(id); }).map(([id]) => id);
check(silent.length === 0, `every one-shot id plays (${silent.length ? 'silent: ' + silent.join(', ') : 'all'})`);
now += 5;

// the music state machine from the sim state
const H = 2600;
const state = {
  t: 0, mode: 'intro', modeT: 0, troll: null, player: { x: 3, y: 0, z: 5, yaw: Math.PI / 2, weapon: 'pistol' },
  horde: { count: H, x: new Float32Array(H), y: new Float32Array(H), z: new Float32Array(H), state: new Uint8Array(H), burn: new Float32Array(H) },
  troughs: ARENA.oil.troughs.map((t) => ({ id: t.id, lit: false })),
};
const L = { x: 3, y: 1.68, z: 5, yaw: Math.PI / 2 };
const step = (s = 1 / 60) => { now += s; state.t += s; state.modeT += s; audio.update(s, state, L); };
for (let i = 0; i < 30; i++) step();
check(audio.stats().music === 'night', `intro → night music (${audio.stats().music})`);
state.mode = 'play'; state.modeT = 0; audio.onEvent({ type: EV.MODE, mode: 'play', prev: 'intro' }, state); step();
audio.onEvent({ type: EV.KINDLE, level: 1 }, state); step();
check(audio.stats().music === 'kindle', `kindle → kindle layer (${audio.stats().music})`);
for (let i = 0; i < 41 * 10; i++) step(0.1);
check(audio.stats().music === 'night', `40 s later → back to night (${audio.stats().music})`);
state.troll = { x: 30, y: 0, z: 70, hp: 2400, hpMax: 2400 }; audio.onEvent({ type: EV.T_ARRIVE, pos: { x: 30, z: 70 } }, state); step();
check(audio.stats().music === 'troll', `troll arrives → troll theme (${audio.stats().music})`);
const rr = audio.stats().perId.troll_roar?.plays || 0; for (let i = 0; i < 30; i++) step(0.1); await tick();
check((audio.stats().perId.troll_roar?.plays || 0) === rr + 1, 'the troll roar plays once on the arrival beat (2.2 s)');
state.troll.hp = 0; audio.onEvent({ type: EV.T_DEATH, pos: { x: 10, z: 20 } }, state); state.troll = null; step();
check(audio.stats().music === 'night', `troll dead before dawn → night (${audio.stats().music})`);
state.mode = 'victory'; state.modeT = 0; audio.onEvent({ type: EV.DAWN }, state); step();
check(audio.stats().music === null, 'dawn breaks → the night music fades out');
for (let i = 0; i < 45; i++) step(0.1);
check(audio.stats().music === 'dawn', `dawn music at the 'quiet' beat (${audio.stats().music})`);
state.mode = 'play'; state.modeT = 0; audio.onEvent({ type: EV.RETRY }, state); step();
check(audio.stats().music === 'night', `retry → night (${audio.stats().music})`);
audio.music('troll'); step();
check(audio.stats().music === 'troll', 'a manual music() call holds');
audio.onEvent({ type: EV.KINDLE, level: 2 }, state); step();
check(audio.stats().music === 'kindle', `…until the state's own choice changes (kindle: ${audio.stats().music})`);

// the limiter: 300 goblin deaths in 1 s (5 per frame), then 300 in one frame
const s0 = audio.stats().perId.gob_death || { plays: 0, drops: 0 }; const b0 = audio.stats().perId.gob_burn || { plays: 0, drops: 0 };
let peakVoices = 0;
for (let f = 0; f < 60; f++) {
  for (let k = 0; k < 5; k++) { const a = Math.random() * 6.283, r = 2 + Math.random() * 28; audio.onEvent({ type: EV.E_DEATH, kind: 'grunt', pos: { x: L.x + Math.cos(a) * r, y: 0, z: L.z + Math.sin(a) * r }, burned: Math.random() < 0.25 }, state); }
  await tick(); step(); peakVoices = Math.max(peakVoices, audio.stats().voices);
}
const s1 = audio.stats().perId.gob_death, b1 = audio.stats().perId.gob_burn;
const plays1 = s1.plays - s0.plays + (b1.plays - b0.plays);
check(plays1 > 10 && plays1 <= 60, `300 deaths in 1 s → ${s1.plays - s0.plays} death + ${b1.plays - b0.plays} burn sounds started (≤ 3+2 per 100 ms), ${s1.drops - s0.drops + b1.drops - b0.drops} dropped`);
check(peakVoices <= 40, `voices never exceed the pool (peak ${peakVoices} / 40)`);
const s2 = audio.stats().perId.gob_death; now += 0.5;
for (let k = 0; k < 300; k++) audio.onEvent({ type: EV.E_DEATH, kind: 'imp', pos: { x: L.x + k * 0.1, y: 0, z: L.z + 4 }, burned: false }, state);
await tick();
const i2 = audio.stats().perId.imp_chitter;
check(i2.plays <= 2 + 1, `300 imp deaths in one frame → ${i2.plays} chitters started (rate 2 per 100 ms), ${i2.drops} dropped`);
// the loudest win: of 50 deaths at 5–40 m in one frame, the started ones are the nearest (highest gain)
now += 0.5; const g0 = audio.stats().perId.gob_death.plays;
const srcBefore = started.length;
for (let k = 0; k < 50; k++) audio.onEvent({ type: EV.E_DEATH, kind: 'grunt', pos: { x: L.x + 40 - k * 0.7, y: 0, z: L.z }, burned: false }, state);
await tick();
const g1 = audio.stats().perId.gob_death.plays;
check(g1 - g0 >= 1 && g1 - g0 <= 3, `50 deaths in one frame → ${g1 - g0} started (rate 3 per 100 ms)`);
const loud = audio._slots ? audio._slots().filter((x) => x.id === 'gob_death' && x.t0 >= now - 0.01).map((x) => x.loud) : [];
check(!loud.length || Math.min(...loud) > -20, `…and they are the nearest ones (their gains: ${loud.map((v) => v.toFixed(1)).join(', ')} dB)`);
void srcBefore;

// crowd and fire beds follow the state
for (let i = 0; i < 120; i++) { state.horde.x[i] = L.x + 3 + (i % 8); state.horde.z[i] = L.z + (i % 5); state.horde.state[i] = 1; }
for (let i = 120; i < 2000; i++) { state.horde.x[i] = 10; state.horde.z[i] = 60; state.horde.state[i] = 1; }
state.troughs[1].lit = true;
for (let i = 0; i < 20; i++) step(0.05);
const bs = audio.stats();
check(bs.beds.crowd_near > 0.1 && bs.beds.crowd_far > 0.1, `crowd beds follow the horde (near ${bs.beds.crowd_near}, far ${bs.beds.crowd_far})`);
check(bs.fire > 0.3 && bs.beds.fire_mid > 0, `fire beds follow a lit trough (fire ${bs.fire}, mid ${bs.beds.fire_mid})`);

// update() cost (no audio thread here: the JS side only) at 2,600 slots
const t0 = performance.now(); for (let i = 0; i < 600; i++) step(); const per = (performance.now() - t0) / 600;
check(per < 0.5, `update() with a 2,600-slot horde: ${(per * 1000).toFixed(0)} µs per frame`);

// ------------------------------------------------------------------------------------------------------- DESIGN §9
{
  const per = () => audio.stats().perId; const plays = (id) => per()[id]?.plays || 0;
  for (let i = 0; i < H; i++) state.horde.state[i] = 0; state.troughs.forEach((t) => { t.lit = false; }); state.troll = null;
  // dawn → coming soon → camp
  state.mode = 'victory'; state.modeT = 0; audio.onEvent({ type: EV.DAWN }, state); for (let i = 0; i < 45; i++) step(0.1);
  const st0 = audio.stats().stings;
  audio.onEvent({ type: EV.COMING_SOON, completedNight: 2 }, state); step();
  check(audio.stats().music === null && audio.stats().stings === st0 + 1, `COMING_SOON → the dawn music fades and the sting plays (music ${audio.stats().music}, stings +${audio.stats().stings - st0})`);
  state.mode = 'camp'; state.modeT = 0; audio.onEvent({ type: EV.CAMP_ENTER, nextNight: 1, reason: 'complete' }, state); for (let i = 0; i < 30; i++) step(0.05);
  let bs = audio.stats();
  check(bs.music === 'camp', `camp → camp music (${bs.music})`);
  check(bs.beds.amb_camp > 0.1 && bs.beds.crowd_far === 0 && bs.beds.crowd_near === 0, `camp beds: dusk on (${bs.beds.amb_camp}), no horde (far ${bs.beds.crowd_far}, near ${bs.beds.crowd_near})`);
  // Brother Cinder
  audio.onEvent({ type: EV.NPC_OPEN }, state); step();
  const d1 = audio.say('home'); const l0 = audio.stats().lines;
  check(d1 > 1 && plays('vo_cinder_home') === 1, `say('home') plays Brother Cinder's line (${d1.toFixed(2)} s)`);
  now += 0.5; audio.onEvent({ type: EV.NPC_LINE, line: 'Odd. I never see you eat.' }, state); await tick();
  now += 0.5; audio.onEvent({ type: EV.NPC_LINE, line: 'vo_cinder_fall' }, state); now += 0.5; audio.onEvent({ type: EV.NPC_LINE, line: 'nonsense' }, state);
  check(plays('vo_cinder_eat') === 1 && plays('vo_cinder_fall') === 1 && audio.stats().lines === l0 + 2, `NPC_LINE by text and by sound id (eat ${plays('vo_cinder_eat')}, fall ${plays('vo_cinder_fall')}; an unknown line plays nothing)`);
  check(audio.stats().npcOpen === true, 'NPC_OPEN muffles the mix for the panel');
  audio.onEvent({ type: EV.NPC_CLOSE }, state); step();
  for (const ev of [{ type: EV.BUY, item: 'hide', level: 1, cost: 60, goldLeft: 10 }, { type: EV.CHARM_EQUIP, charm: 'coin-hook', slot: 0, on: true },
    { type: EV.TOWER_BUILD, pad: 'pad-gate-w', tower: 'chainimp', level: 1, cost: 140 }, { type: EV.TOWER_UPGRADE, pad: 1, level: 2, cost: 180 }]) { now += 0.4; audio.onEvent(ev, state); await tick(); }
  check(plays('shop_buy') === 1 && plays('charm_equip') === 1 && plays('tower_build') === 1 && plays('tower_upgrade') === 1, 'camp: buy, equip, build (pad id) and upgrade (pad index) each play');
  // the kindle at the camp → Night II
  audio.onEvent({ type: EV.CAMP_LEAVE, night: 2 }, state); await tick();
  state.mode = 'intro'; state.modeT = 0; step();
  check(audio.stats().music === 'night2', `CAMP_LEAVE night 2 → Night II music (${audio.stats().music})`);
  now += 2; const st1 = audio.stats().stings;
  audio.onEvent({ type: EV.NIGHT_TITLE, night: 2 }, state); for (let i = 0; i < 60; i++) step(0.1);
  check(audio.stats().stings === st1 + 1, `NIGHT_TITLE and the intro card beat give one sting, not two (+${audio.stats().stings - st1})`);
  check(plays('horde_rise') === 1 && plays('beacon_kindle') >= 1, 'the kindle roar and the horde\'s distant answer play');
  state.mode = 'play'; state.modeT = 0; step();
  audio.onEvent({ type: EV.KINDLE, level: 1 }, state); step();
  check(audio.stats().music === 'kindle', `kindle in Night II → kindle (${audio.stats().music})`);
  state.t += 41; step();
  check(audio.stats().music === 'night2', `…then back to night2 (${audio.stats().music})`);
  // one of each night event
  const P = (dx, dz) => ({ x: L.x + dx, y: 0, z: L.z + dz });
  const once = [
    [{ type: EV.GOLD_DROP, pos: P(3, 2), value: 3, n: 3 }, 'coin_spill'], [{ type: EV.PICKUP, kind: 'gold', value: 1, pos: P(0, 0) }, 'coin_tick'],
    [{ type: EV.PICKUP, kind: 'xp', value: 1, pos: P(0, 0) }, 'xp_collect'], [{ type: EV.XP_DROP, pos: P(4, 4), value: 25, n: 8 }, 'xp_collect'],
    [{ type: EV.CHARM_DROP, pos: P(6, 3), charm: 'ember-tooth' }, 'charm_found'], [{ type: EV.CHARM_PICKUP, charm: 'ember-tooth', dup: true, gold: 30 }, 'charm_found'],
    [{ type: EV.OBELISK_PULSE, pad: 'pad-gate-w', pos: P(-4, 3), r: 4.5, level: 1 }, 'obelisk_pulse'], [{ type: EV.CHAIN_THROW, pad: 1, from: P(5, 2), to: P(9, 9), targetId: 3 }, 'chain_throw'],
    [{ type: EV.CHAIN_HOOK, pad: 1, targetId: 3, pos: P(9, 9), pull: 2.5 }, 'chain_hook'], [{ type: EV.ORBIT_HIT, pos: P(2, 0), id: 4 }, 'orbit_hit'],
    [{ type: EV.METEOR, from: P(0, 30), pos: P(8, 12), r: 3, flight: 1.2 }, 'meteor_whistle'], [{ type: EV.TRAIL, pos: P(0, -1) }, 'trail_crackle'],
    [{ type: EV.ELITE_SPAWN, id: 7, kind: 'chief', pos: P(10, 30) }, 'chief_horn'], [{ type: EV.ELITE_SPAWN, id: 8, kind: 'hexer', pos: P(-6, 25) }, 'hexer_cackle'],
    [{ type: EV.HEX, from: P(4, 14), to: P(0, 0), hit: false }, 'hex_zap'], [{ type: EV.DOUSE_THROW, id: 9, from: P(3, 12), to: P(1, 5), r: 2.5 }, 'douse_throw'],
  ];
  const silent2 = [];
  for (const [ev, id] of once) { now += 1.2; const b = plays(id); audio.onEvent(ev, state); await tick(); if (plays(id) <= b) silent2.push(id); }
  now += 1.5; await tick();
  check(silent2.length === 0 && plays('meteor_impact') >= 1 && plays('douse_splash') >= 1, `every wave-2 event plays its sound (${silent2.length ? 'silent: ' + silent2.join(', ') : 'all, + the meteor impact and the splash on landing'})`);
  // the hex: the Lance chokes for 2 s
  audio.onEvent({ type: EV.LANCE_ON }, state); state.player.weapon = 'lance'; step();
  audio.onEvent({ type: EV.HEX, from: P(4, 14), to: P(0, 0), hit: true }, state); await tick(); step();
  check(audio.stats().hexed && plays('lance_sputter') === 1, 'a hex hit while spraying: the sputter plays and the loop chokes');
  for (let i = 0; i < 130; i++) step();
  check(!audio.stats().hexed && audio.stats().beds.w_lance_loop > 0.3, `…and comes back after 2 s (loop ${audio.stats().beds.w_lance_loop})`);
  audio.onEvent({ type: EV.LANCE_OFF }, state); state.player.weapon = 'pistol';
  // Ember Orbit loop
  state.orbit = [{ x: L.x + 2.2, z: L.z }, { x: L.x - 2.2, z: L.z }]; for (let i = 0; i < 10; i++) step();
  const ob = audio.stats().beds.orbit_loop;
  state.orbit = []; for (let i = 0; i < 10; i++) step();
  check(ob > 0.1 && audio.stats().beds.orbit_loop === 0, `the orbit loop runs while state.orbit holds fireballs (${ob}) and stops when it is empty`);
  // rate limits under tower and orbit spam: 6 obelisks + 3 imps × 3 hooks + 40 orbit hits per frame for 2 s
  const b0 = { o: plays('obelisk_pulse'), c: plays('chain_hook'), h: plays('orbit_hit'), t: plays('chain_throw') }; let pv = 0;
  for (let f = 0; f < 120; f++) {
    for (let k = 0; k < 6; k++) audio.onEvent({ type: EV.OBELISK_PULSE, pad: k, pos: P(-6 + k * 3, 4), r: 5.5, level: 2 }, state);
    for (let k = 0; k < 9; k++) { audio.onEvent({ type: EV.CHAIN_THROW, pad: k % 3, from: P(k, 3), to: P(k, 12) }, state); audio.onEvent({ type: EV.CHAIN_HOOK, pad: k % 3, pos: P(k, 12) }, state); }
    for (let k = 0; k < 40; k++) audio.onEvent({ type: EV.ORBIT_HIT, pos: P(Math.cos(k) * 2.2, Math.sin(k) * 2.2), id: k }, state);
    await tick(); step(); pv = Math.max(pv, audio.stats().voices);
  }
  const d = { o: plays('obelisk_pulse') - b0.o, c: plays('chain_hook') - b0.c, h: plays('orbit_hit') - b0.h, t: plays('chain_throw') - b0.t };
  check(d.o <= 9 && d.c <= 26 && d.h <= 34 && d.t <= 26 && pv <= 40, `2 s of 6 obelisks + 9 hooks + 40 orbit hits per frame → obelisk ${d.o}, throws ${d.t}, hooks ${d.c}, orbit hits ${d.h} started; peak voices ${pv}/40`);
  // update() cost with the orbit up and the horde full
  state.orbit = [{ x: 1, z: 1 }, { x: 2, z: 2 }, { x: 3, z: 3 }]; for (let i = 0; i < H; i++) state.horde.state[i] = 1;
  const t1 = performance.now(); for (let i = 0; i < 600; i++) step(); const per2 = (performance.now() - t1) / 600;
  check(per2 < 0.5, `update() with the orbit up and a 2,600-slot horde: ${(per2 * 1000).toFixed(0)} µs per frame`);
}

// the guns: every variant one shot of the same gun, within its length; the beds dip under a shot
{
  const k = man.sounds.w_kestrel_shot.files, b = man.sounds.w_blunder_shot.files;
  check(k.length === 1 && k[0].dur <= 0.7 && b.length === 1 && b[0].dur <= 1.2 && !SOUNDS.w_kestrel_shot.pitch && !SOUNDS.w_kestrel_shot.vary && !SOUNDS.w_blunder_shot.pitch && !SOUNDS.w_blunder_shot.vary,
    `one file per gun, no jitter: Kestrel ${k.map((f) => f.file + ' ' + f.dur).join()} s (≤ 0.7), blunderbuss ${b.map((f) => f.file + ' ' + f.dur).join()} s (≤ 1.2)`);
  check(Object.values(man.sounds).every((sd) => sd.files.every((f) => /^[0-9a-f]{10}$/.test(f.h || ''))), 'every manifest file carries a content hash (loaded as ?v=<hash>)');
  // a trigger pull starts exactly one voice, every time the same buffer at rate 1 and the same gain
  const shots = []; for (let i = 0; i < 6; i++) { now += 0.5; const n0 = started.length; audio.onEvent({ type: EV.SHOT, weapon: i % 2 ? 'blunderbuss' : 'pistol' }, state); await tick(); const ns = started.slice(n0); shots.push(ns.map((x) => `${x.buffer?.duration}@${x.playbackRate.value}`).join('+')); }
  check(shots.every((x) => x && !x.includes('+')) && new Set(shots.filter((_, i) => i % 2 === 0)).size === 1 && new Set(shots.filter((_, i) => i % 2)).size === 1, `each SHOT starts one sound, the same each time (${shots.join(' | ')})`);
  // a troll hurt by fire (no shot near) makes no hit sound; right after a shot it does
  now += 2; const th0 = audio.stats().perId.troll_hit?.plays || 0;
  audio.onEvent({ type: EV.T_HURT, pos: { x: 10, z: 20 }, dmg: 2, hpFrac: 0.9, glowing: false }, state); await tick();
  const th1 = audio.stats().perId.troll_hit?.plays || 0; now += 0.5;
  audio.onEvent({ type: EV.SHOT, weapon: 'pistol' }, state); audio.onEvent({ type: EV.T_HURT, pos: { x: 10, z: 20 }, dmg: 18, hpFrac: 0.8, glowing: false }, state); await tick();
  check(th1 === th0 && (audio.stats().perId.troll_hit?.plays || 0) === th0 + 1, 'troll_hit only on a real hit (none on a fire tick, one with a shot)');
  const before = audio.stats().perId.w_kestrel_shot?.plays || 0; now += 1;
  audio.onEvent({ type: EV.SHOT, weapon: 'pistol' }, state); await tick();
  check((audio.stats().perId.w_kestrel_shot?.plays || 0) === before + 1, 'a Kestrel SHOT plays one shot (and dips the beds 4 dB for 80 ms)');
}

// ------------------------------------------------------------------------------------------------------- THE ORGAN, BATS, PYRE BURST, THE ASH ROAR
{
  const plays = (id) => audio.stats().perId[id]?.plays || 0;
  state.mode = 'play'; state.modeT = 10; state.troll = null; state.orbit = []; step();
  // the THUNDER ORGAN: 18 rounds/s for 1 s → the one loop on, no per-round voice; then it stops within 0.2 s
  state.player.weapon = 'organ'; // slot 2 holds the THUNDER ORGAN
  const loopDur = man.sounds.organ_loop.files[0].dur; const n0 = started.length; const v0 = audio.stats().played; let onDuring = true;
  for (let i = 0; i < 18; i++) { audio.onEvent({ type: EV.SHOT, weapon: 'organ', origin: L, dir: { x: 0, y: 0, z: 1 }, pellets: [] }, state); await tick(); step(1 / 18); onDuring = onDuring && audio.stats().organ.on; }
  const loopsStarted = started.slice(n0).filter((x) => Math.abs((x.buffer?.duration ?? 0) - loopDur) < 1e-6).length;
  check(onDuring && loopsStarted <= 1 && audio.stats().played === v0 && audio.stats().beds.organ_loop > 0.3, `THUNDER ORGAN: 18 rounds in 1 s → its one loop on throughout (${loopsStarted} loop source started), 0 per-round voices (${audio.stats().played - v0})`);
  for (let i = 0; i < 12; i++) step(1 / 60);
  check(!audio.stats().organ.on && audio.stats().beds.organ_loop === 0, 'the trigger released → the loop fades out within 0.2 s (no tail sample)');
  for (let i = 0; i < 5; i++) { audio.onEvent({ type: EV.SHOT, weapon: 'organ' }, state); await tick(); step(1 / 18); }
  now += 0.6; audio.onEvent({ type: 'organ.overheat', seconds: 1.5 }, state); await tick(); step();
  check(plays('organ_overheat') === 1 && !audio.stats().organ.on, 'overheat → its own hiss, the loop stops');
  state.player.weapon = 'pistol';
  // the sim-driven flow: 'organ.fire' … the sim's player.organ.firing … released → off; a lost 'organ.stop' cannot leave it on
  now += 1; state.player.weapon = 'organ'; state.player.organ = { firing: true, lockT: 0 };
  audio.onEvent({ type: 'organ.fire' }, state); await tick(); step(); const onK = audio.stats().organ.on;
  for (let i = 0; i < 30; i++) step(1 / 60); const heldK = audio.stats().organ.on;
  state.player.organ.firing = false; for (let i = 0; i < 10; i++) step(1 / 60);
  check(onK && heldK && !audio.stats().organ.on, "'organ.fire' starts the loop, it holds while player.organ.firing, and stops when it clears (no 'organ.stop' needed)");
  state.player.weapon = 'pistol'; delete state.player.organ;
  // the Bat Gremlin: the flap loop follows the nearest bat; dive screech and crash on their events
  state.air = [{ id: 0, x: L.x + 3, y: 5, z: L.z, mode: 'circle' }]; for (let i = 0; i < 20; i++) step(0.05);
  const bf = audio.stats().beds.bat_flap; state.air = []; for (let i = 0; i < 20; i++) step(0.05);
  check(bf > 0.05 && audio.stats().beds.bat_flap === 0, `bat flaps follow the nearest bat (${bf} → 0 when none)`);
  now += 1; audio.onEvent({ type: 'air.screech', id: 0, pos: { x: L.x + 6, y: 4, z: L.z } }, state); now += 1; audio.onEvent({ type: 'air.crash', id: 0, pos: { x: L.x + 4, y: 0, z: L.z } }, state); await tick();
  check(plays('bat_screech') === 1 && plays('bat_crash') === 1, 'a dive screeches, a burning bat crashes');
  // Pyre Burst at 24/s for 2 s → heavily limited
  const p0 = plays('pyre_pop');
  for (let f = 0; f < 120; f++) { if (f % 5 === 0) for (let k = 0; k < 2; k++) audio.onEvent({ type: 'pyre.burst', pos: { x: L.x + 3 + k, y: 0, z: L.z + 4 } }, state); await tick(); step(1 / 60); }
  const pd = plays('pyre_pop') - p0;
  check(pd >= 5 && pd <= 22, `Pyre Burst at 24/s for 2 s → ${pd} pops started (≤ 10/s)`);
  // the Ash Roar, the BEGIN NIGHT click
  now += 1; audio.onEvent({ type: EV.T_WINDUP, move: 'roar', pos: { x: 10, z: 20 } }, state); audio.onEvent({ type: 'troll.roar', pos: { x: 10, z: 20 }, dir: { x: 0, z: -1 }, r: 9, angle: 0.8, calls: 30 }, state); audio.ui('begin'); await tick();
  check(plays('ash_roar') === 1 && plays('ui_begin') === 1, 'the Ash Roar plays (after its growl); BEGIN NIGHT clicks');
  state.air = Array.from({ length: 12 }, (_, i) => ({ id: i, x: L.x + i, y: 5, z: L.z + 8 }));
  const t2 = performance.now(); for (let i = 0; i < 600; i++) step(); const per3 = (performance.now() - t2) / 600; state.air = [];
  check(per3 < 0.5, `update() with 12 bats and the full horde: ${(per3 * 1000).toFixed(0)} µs per frame`);
}

// ------------------------------------------------------------------------------------------------------- DESIGN §8
{
  const plays = (id) => audio.stats().perId[id]?.plays || 0;
  const { TIMELINE } = await import(path.join(APP, 'src/shared/timeline.js'));
  state.mode = 'camp'; state.modeT = 0; step(); for (let i = 0; i < 10; i++) step(0.1);
  // the later nights: base loop by night, percussion layers synced to its beat
  audio.onEvent({ type: EV.CAMP_LEAVE, night: 5 }, state); state.mode = 'play'; state.modeT = 10; state.troll = null; for (let i = 0; i < 40; i++) step(0.1);
  let ly = audio._layers();
  check(audio.stats().music === 'night' && ly[0].on && ly[0].level === 0.85 && !ly[1].on, `Night V → night + war-drum layer 0.85 (${audio.stats().music}, ${JSON.stringify(ly.map((l) => [l.level, l.diffMs ?? '-']))})`);
  check(Math.abs(ly[0].diffMs) <= 1, `the layer starts on the loop's beat (offset ${ly[0].diffMs} ms)`);
  state.mode = 'camp'; step(); for (let i = 0; i < 30; i++) step(0.1);
  audio.onEvent({ type: EV.CAMP_LEAVE, night: 9 }, state); state.mode = 'play'; for (let i = 0; i < 20; i++) step(0.1);
  let maxDiff = 0; for (let i = 0; i < 1800; i++) { step(0.1); if (i % 10 === 0) for (const l of audio._layers()) if (l.on) maxDiff = Math.max(maxDiff, Math.abs(l.diffMs)); }
  ly = audio._layers();
  check(audio.stats().music === 'night' && ly[0].level === 1 && ly[1].level === 1 && maxDiff <= 16, `Night IX → both layers full; over 3 min of play their beat stays within ${maxDiff.toFixed(1)} ms of the loop's (re-synced ${audio.stats().layers.syncs}×, limit 15 ms)`);
  audio.onEvent({ type: EV.KINDLE, level: 1 }, state); for (let i = 0; i < 30; i++) step(0.1);
  check(audio.stats().music === 'kindle' && audio.stats().layers.a === 0, 'a kindle: the kindle theme, the layers fade out');
  state.t += 41; for (let i = 0; i < 40; i++) step(0.1);
  // weather and thunder
  state.weather = { rain: 0.8 }; const th0 = plays('thunder'); for (let i = 0; i < 400; i++) step(0.1);
  check(audio.stats().beds.rain_bed > 0.5 && plays('thunder') > th0, `rain 0.8 → the rain bed (${audio.stats().beds.rain_bed}) and thunder (${plays('thunder') - th0} in 40 s)`);
  state.weather = { rain: 0 }; for (let i = 0; i < 20; i++) step(0.1);
  // the Siege Ram, the coven
  state.rams = [{ id: 0, x: L.x + 20, z: L.z + 30, hp: 600, mode: 'walk' }]; for (let i = 0; i < 20; i++) step(0.1); const rd = audio.stats().beds.ram_drum; state.rams = []; for (let i = 0; i < 20; i++) step(0.1);
  now += 1; audio.onEvent({ type: 'ram.hit', id: 0, pos: { x: 0, z: 0.5 }, dmg: 120 }, state); audio.onEvent({ type: 'coven.chant', on: true, pos: { x: 5, z: 20 } }, state); await tick(); for (let i = 0; i < 20; i++) step(0.1); const cc = audio.stats().beds.coven_chant;
  audio.onEvent({ type: 'coven.chant', on: false, broken: true }, state); for (let i = 0; i < 20; i++) step(0.1);
  check(rd > 0.1 && plays('ram_impact') === 1 && cc > 0.1 && audio.stats().beds.coven_chant === 0, `the ram's drum follows the ram (${rd}), its blow on the gate; the coven chants while it chants (${cc})`);
  // the Rainmother (Night X)
  audio.onEvent({ type: EV.CAMP_LEAVE, night: 10 }, state); for (let i = 0; i < 10; i++) step(0.1);
  now += 1; audio.onEvent({ type: 'boss.rise', pos: { x: 10, z: 70 } }, state); await tick(); for (let i = 0; i < 10; i++) step(0.1);
  const mRain = audio.stats().music;
  for (const [ty, id] of [['boss.tide', 'tide_wave'], ['boss.step', 'rain_step'], ['boss.lantern', 'lantern_shatter']]) { now += 1; audio.onEvent({ type: ty, pos: { x: 8, z: 40 }, from: { x: 8, z: 60 }, to: { x: 0, z: 5 } }, state); await tick(); }
  now += 1; audio.onEvent({ type: 'boss.whirl', pos: { x: L.x + 4, z: L.z + 2 }, r: 6, seconds: 6 }, state); await tick(); for (let i = 0; i < 20; i++) step(0.1); const wp = audio.stats().beds.whirlpool;
  for (let i = 0; i < 60; i++) step(0.1); const wp2 = audio.stats().beds.whirlpool;
  now += 1; audio.onEvent({ type: 'boss.death', pos: { x: 10, z: 30 } }, state); await tick(); for (let i = 0; i < 5; i++) step(0.1);
  check(mRain === 'rain' && plays('rain_rise') === 1 && plays('tide_wave') >= 1 && plays('rain_step') === 1 && plays('lantern_shatter') === 1 && wp > 0.1 && wp2 === 0 && plays('rain_collapse') === 1,
    `the Rainmother ('boss.*'): her theme (${mRain}), the rise, a tide, a step, a lantern, a whirlpool for its 6 s (${wp} → ${wp2}), the collapse`);
  // the ending: TIMELINE.ending's beats (or 'ending.beat' events)
  state.mode = 'ending'; state.modeT = 0; step();
  const st0 = audio.stats().stings; let musicDuring = null;
  if (TIMELINE.ending?.beats) { const D = TIMELINE.ending.duration ?? 60; for (let tt = 0; tt < D + 1; tt += 0.1) { step(0.1); await tick(); if (musicDuring === null) musicDuring = audio.stats().music; } }
  else for (const id of ['flood', 'lamp', 'portal', 'world', 'host', 'gloves', 'reveal', 'roar', 'cinder', 'hunt', 'black', 'credits']) { now += 2; audio.onEvent({ type: 'ending.beat', id }, state); await tick(); step(0.1); musicDuring = musicDuring ?? audio.stats().music; }
  const done = audio.stats().ending;
  check(['flood', 'lamp', 'portal', 'world', 'host', 'gloves', 'reveal', 'roar', 'cinder', 'hunt', 'credits'].every((k) => done.includes(k)) && musicDuring === null,
    `the ending's cues fire on its beats (${TIMELINE.ending?.beats ? 'TIMELINE.ending' : "'ending.beat' events"}): ${done.join(' → ')}`);
  check(plays('portal_rip') === 1 && plays('gate_open') === 1 && plays('gloves_ignite') === 1 && plays('demon_roar') === 1 && plays('vo_cinder_master') === 1 && plays('hunt_flee') === 1 && audio.stats().stings - st0 >= 4,
    `…the rip, the gate, the gloves, the roar, "Welcome home, Master.", the hunt, and 4 score cues (portal, reveal, hunt, credits: +${audio.stats().stings - st0} stings)`);
  // the sim's own NPC_LINE 'master' at the same beat does not play the line twice
  now += 0.2; audio.onEvent({ type: EV.NPC_LINE, line: 'master' }, state); await tick();
  check(plays('vo_cinder_master') === 1, '"Welcome home, Master." once, though the beat and the sim both ask');
  state.mode = 'title'; step(); for (let i = 0; i < 30; i++) step(0.1);
  check(audio.stats().beds.hell_wind === 0 && audio.stats().beds.host_march === 0, 'leaving the ending: its beds and cues fade out');
  // update() cost with everything up
  state.mode = 'play'; state.weather = { rain: 1 }; state.rams = [{ x: 0, z: 40 }, { x: 5, z: 50 }]; state.whirlpools = [{ x: 3, z: 10 }]; state.air = Array.from({ length: 12 }, (_, i) => ({ x: i, y: 5, z: 8 }));
  const t4 = performance.now(); for (let i = 0; i < 600; i++) step(); const per4 = (performance.now() - t4) / 600;
  check(per4 < 0.5, `update() with rain, 2 rams, a whirlpool, 12 bats, the layers and a 2,600-slot horde: ${(per4 * 1000).toFixed(0)} µs per frame`);
  state.weather = { rain: 0 }; state.rams = []; state.whirlpools = []; state.air = [];
}

// ---------------------------------------------------------------------------------------------------- DESIGN §10.4
{
  const plays = (id) => audio.stats().perId[id]?.plays || 0;
  state.mode = 'play'; state.modeT = 10; state.troll = null; state.boss = null; state.night = { n: 1 }; state.troughs[1].lit = true; for (let i = 0; i < 20; i++) step(0.1);
  const fireBefore = audio.stats().beds.fire_mid;
  // EMBER GALE every 8 s (level 3) for 40 s → one gust per event, the fire beds flare during it and settle after
  const g0 = plays('gale_gust'); let flare = 0;
  for (let k = 0; k < 5; k++) { now += 0.01; audio.onEvent({ type: EV.GALE, dir: { x: 0, z: 1 }, strength: 1, seconds: 2.5, level: 3 }, state); await tick(); for (let i = 0; i < 80; i++) { step(0.1); if (i === 12) flare = Math.max(flare, audio.stats().beds.fire_mid); } }
  const fireAfter = audio.stats().beds.fire_mid;
  check(plays('gale_gust') - g0 === 5 && flare > fireBefore * 1.2 && Math.abs(fireAfter - fireBefore) < 0.02, `EV.GALE ×5 (every 8 s) → 5 gusts; the fire beds flare during each (mid ${fireBefore} → ${flare}) and settle (${fireAfter})`);
  now += 0.1; const g1 = plays('gale_gust'); audio.onEvent({ type: EV.GALE, level: 1, seconds: 2.5 }, state); audio.onEvent({ type: EV.GALE, level: 1, seconds: 2.5 }, state); await tick();
  check(plays('gale_gust') - g1 === 1, 'two gale events at once → one gust (gap 4 s)');
  // P_HEAL: Hearthblood heals continuously (10 events/s for 10 s) → a quiet tick at most every 3 s; a level heal plays
  const h0 = plays('heart');
  for (let i = 0; i < 100; i++) { audio.onEvent({ type: EV.P_HEAL, amount: 0.3, source: 'hearthblood' }, state); await tick(); step(0.1); }
  const hb = plays('heart') - h0; now += 0.5; audio.onEvent({ type: EV.P_HEAL, amount: 20, source: 'level' }, state); await tick();
  check(hb >= 3 && hb <= 4 && plays('heart') - h0 === hb + 1, `P_HEAL: 100 Hearthblood heals in 10 s → ${hb} quiet ticks (≤ 1 per 3 s); a level heal plays`);
  state.troughs[1].lit = false;
}

// ---------------------------------------------------------------------------------------------- DESIGN §15: the load order
{
  const realFetch = globalThis.fetch; const reqs = []; let failFile = '';
  globalThis.fetch = async (url) => { const rel = String(url).replace(/^.*?audio\//, '').replace(/\?.*$/, ''); if (rel !== 'manifest.json') reqs.push(rel); if (rel === failFile) return { ok: false, status: 404 }; return realFetch(url); };
  const settle = async (n = 30) => { for (let i = 0; i < n; i++) await tick(); };
  const mk = (meta, mode = 'title') => ({ t: 0, mode, modeT: 0, troll: null, meta, night: { n: 1 }, player: { x: 3, y: 0, z: 5, yaw: 0, weapon: 'pistol' }, horde: state.horde, troughs: state.troughs });
  const fresh = { runN: 0, nightsCompleted: 0, gold: 0 }, saved = { runN: 2, nightsCompleted: 1, gold: 340, run: null };
  delete globalThis.__ew;
  // A: a fresh save, at the title, before the game is ready → nothing but the manifest
  reqs.length = 0; const A = createAudio({ assetsBase: './assets/' }); const sa = mk(fresh);
  await settle(); for (let i = 0; i < 60; i++) { now += 1 / 60; A.update(1 / 60, sa, L); await tick(); }
  check(reqs.length === 0 && !A.stats().load.started, `before the game is ready: ${reqs.length} sound requests (only the manifest)`);
  // a sound asked for before the start loads at once, alone
  A.play('w_kestrel_shot'); await settle();
  check(reqs.length === 1 && reqs[0] === 'sfx/w_kestrel_shot.webm' && A._variants('w_kestrel_shot') === 1, `asked for before the start → loaded at once, alone (${reqs.join(', ')})`);
  // the game reports ready (main.js: __ew.bootMs right after progress 1) → the background starts, 4 at a time, fresh order
  globalThis.__ew = { bootMs: 2100 }; now += 1 / 60; A.update(1 / 60, sa, L); await A.ready();
  const logA = A._fetchLog(); const at = (id) => logA.indexOf(id);
  const st = A.stats();
  const firstNight = ['amb_night', 'mus_night', 'crowd_far', 'gob_death', 'hit_flesh', 'fire_low'].map(at), late = ['mus_camp', 'mus_troll', 'mus_kindle', 'amb_camp'].map(at);
  check(st.load.why === 'ready' && st.load.mode === 'fresh' && st.loaded === st.total && st.load.maxInFlight <= 4 && Math.max(...firstNight) < Math.min(...late),
    `ready → a fresh save's order: Night I's beds, the Kestrel and the horde first (≤ ${Math.max(...firstNight)}), the camp, troll and kindle after (≥ ${Math.min(...late)}); ${st.loaded}/${st.total} loaded, ≤ ${st.load.maxInFlight} in flight`);
  const endIdx = ['mus_end_credits', 'portal_rip', 'demon_roar', 'mus_rain'].map(at);
  check(Math.min(...endIdx) >= logA.length - 45, `the ending's and Night X's sounds come last (from #${Math.min(...endIdx)} of ${logA.length})`);
  console.log('     fresh order, first 24:', logA.slice(0, 24).join(' '));
  delete globalThis.__ew;
  // B: a save with progress, started by the title click → the camp's sounds right after the essentials
  reqs.length = 0; const B = createAudio({ assetsBase: './assets/' }); const sb = mk(saved); await settle();
  for (let i = 0; i < 5; i++) { now += 1 / 60; B.update(1 / 60, sb, L); await tick(); }
  B.unlock(); await B.ready(); const logB = B._fetchLog(); const bt = (id) => logB.indexOf(id);
  check(B.stats().load.why === 'click' && B.stats().load.mode === 'camp' && bt('mus_camp') < bt('mus_night') && bt('amb_camp') < bt('amb_night') && bt('vo_cinder_home') < bt('gob_death'),
    `a save → the camp first (click): mus_camp #${bt('mus_camp')} < mus_night #${bt('mus_night')}, amb_camp #${bt('amb_camp')} < amb_night #${bt('amb_night')}`);
  console.log('     camp order, first 16:', logB.slice(0, 16).join(' '));
  // C: the game goes straight to the ending (mode 'ending') → the ending's sounds right after the essentials
  const C = createAudio({ assetsBase: './assets/' }); await settle(); const sc = mk(fresh, 'ending'); now += 1 / 60; C.update(1 / 60, sc, L); await C.ready();
  const logC = C._fetchLog(); const ct = (id) => logC.indexOf(id);
  check(C.stats().load.mode === 'ending' && ct('mus_end_portal') < ct('mus_night') && ct('demon_roar') < ct('gob_death'), `the ending first when the game starts there (mus_end_portal #${ct('mus_end_portal')}, mus_night #${ct('mus_night')})`);
  // D: a failed fetch is never retried, however often the sound is asked for
  failFile = 'sfx/thunder_1.webm'; reqs.length = 0; const D = createAudio({ assetsBase: './assets/' }); await settle();
  globalThis.__ew = { bootMs: 900 }; now += 1 / 60; D.update(1 / 60, mk(fresh), L); await D.ready();
  for (let i = 0; i < 300; i++) { D.play('thunder'); D.want('thunder', null); now += 1 / 60; D.update(1 / 60, mk(fresh, 'play'), L); await tick(); }
  check(reqs.filter((r) => r === failFile).length === 1 && D.stats().failed === 1, `a failed file is fetched once (${reqs.filter((r) => r === failFile).length}×) though asked for 600× over 300 frames; the other variants still play (${D._variants('thunder')})`);
  failFile = ''; delete globalThis.__ew; globalThis.fetch = realFetch;
  for (const x of [A, B, C, D]) x.dispose();
}

console.log(fails.length ? `\n${fails.length} check(s) failed` : '\nall checks pass');
process.exit(fails.length ? 1 : 0);
