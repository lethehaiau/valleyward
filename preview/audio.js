// VALLEYWARD · audio · the standalone audio bench (preview/audio.html).
//   npx vite --config vite.config.js --port 5357 --strictPort  →  http://127.0.0.1:5357/preview/audio.html
//   ?selftest=1 runs every sound, the music switches and the 300-deaths stress by itself and prints `BENCH_RESULT {json}`.
import { createAudio } from '../src/audio/index.js';
import { SOUNDS, VOICE_LINES } from '../src/audio/bank.js';
import { EV } from '../src/shared/events.js';
import { ARENA } from '../src/shared/arena.js';

const q = new URLSearchParams(location.search);
// the page sits in preview/, the public assets at the web root (not `new URL(…, import.meta.url)`: Vite rewrites that form)
const assetsBase = new URL('../assets/', location.href).href;
const audio = createAudio({ assetsBase });
window.__audio = audio;
const bench = (window.__bench = { peakDb: -Infinity, rmsDb: -Infinity, log: [] });
const $ = (id) => document.getElementById(id);
const btn = (parent, label, fn, title = '') => { const b = document.createElement('button'); b.innerHTML = label; b.title = title; b.onclick = (e) => fn(e, b); parent.appendChild(b); return b; };
const ev = (type, payload = {}) => audio.onEvent({ type, t: performance.now() / 1000, ...payload }, null);

// a listener on the plaza facing east (the M1 framing)
const L = { x: ARENA.playerSpawn.x, y: 1.68, z: ARENA.playerSpawn.z, yaw: ARENA.playerSpawn.yaw, pitch: 0 };
const around = (rMin, rMax) => { const a = Math.random() * Math.PI * 2, r = rMin + Math.random() * (rMax - rMin); return { x: L.x + Math.cos(a) * r, y: 0, z: L.z + Math.sin(a) * r }; };
const ahead = (d, side = 0) => ({ x: L.x + Math.sin(L.yaw) * d - Math.cos(L.yaw) * side, y: 0, z: L.z + Math.cos(L.yaw) * d + Math.sin(L.yaw) * side });

// ---------------------------------------------------------------------------------------------- gate (first gesture)
$('gate').onclick = () => { audio.unlock(); $('gate').remove(); };
audio._benchBeds(true);

// ---------------------------------------------------------------------------------------------- meter
const an = audio._ctx.createAnalyser(); an.fftSize = 2048; audio._out.connect(an);
const buf = new Float32Array(an.fftSize);
function meter() {
  an.getFloatTimeDomainData(buf);
  let pk = 0, s = 0; for (let i = 0; i < buf.length; i++) { const a = Math.abs(buf[i]); if (a > pk) pk = a; s += buf[i] * buf[i]; }
  const pdb = 20 * Math.log10(pk + 1e-9), rdb = 10 * Math.log10(s / buf.length + 1e-12);
  if (pdb > bench.peakDb) bench.peakDb = pdb; if (rdb > bench.rmsDb) bench.rmsDb = rdb;
  $('meter').firstElementChild.style.width = `${Math.max(0, Math.min(100, (rdb + 60) / 60 * 100))}%`;
  $('meterText').textContent = `RMS ${rdb.toFixed(1)} dBFS · peak ${pdb.toFixed(1)} dBFS · max peak since reset ${bench.peakDb.toFixed(1)} dBFS`;
}

// ---------------------------------------------------------------------------------------------- music
const mus = $('music');
for (const n of ['camp', 'night', 'night2', 'kindle', 'troll', 'rain', 'dawn']) btn(mus, n, () => audio.music(n));
btn(mus, 'stop', () => audio.music(null));
btn(mus, 'sting: night card', () => audio.play('mus_nightcard'));
btn(mus, 'sting: fallen', () => audio.play('mus_fallen'));
btn(mus, 'sting: coming soon', () => audio.play('mus_soon'));
btn(mus, 'jump to the loop seam (−4 s)', () => { const r = audio._seam(4); bench.log.push(r); });
btn(mus, 'reset peak', () => { bench.peakDb = -Infinity; bench.rmsDb = -Infinity; });

// ---------------------------------------------------------------------------------------------- beds
const BEDS = ['amb_night', 'crowd_far', 'crowd_near', 'fire_low', 'fire_mid', 'fire_high', 'w_lance_loop', 'amb_camp', 'orbit_loop', 'organ_loop', 'bat_flap',
  'rain_bed', 'ram_drum', 'coven_chant', 'whirlpool', 'hell_wind', 'host_march'];
const bedVal = Object.fromEntries(BEDS.map((b) => [b, 0]));
const sim = { near: 0, far: 400, troughs: 0, burning: 0, yaw: L.yaw };
let manual = true;
function renderBeds() {
  const g = $('beds'); g.innerHTML = '';
  const slider = (label, min, max, step, val, on) => {
    const l = document.createElement('label'); l.innerHTML = `<span>${label}</span>`; const i = document.createElement('input');
    Object.assign(i, { type: 'range', min, max, step, value: val }); const o = document.createElement('small'); o.textContent = String(val);
    i.oninput = () => { o.textContent = i.value; on(+i.value); }; l.append(i, o); g.appendChild(l);
  };
  if (manual) for (const b of BEDS) slider(b, 0, 1, 0.01, bedVal[b], (v) => { bedVal[b] = v; audio._bed(b, v, 0, 0.2); });
  else {
    slider('goblins ≤14 m', 0, 200, 1, sim.near, (v) => { sim.near = v; });
    slider('goblins far', 0, 2500, 10, sim.far, (v) => { sim.far = v; });
    slider('troughs lit', 0, 3, 1, sim.troughs, (v) => { sim.troughs = v; });
    slider('burning near', 0, 120, 1, sim.burning, (v) => { sim.burning = v; });
    slider('listener yaw', -3.14, 3.14, 0.01, sim.yaw, (v) => { sim.yaw = v; });
  }
}
$('manual').onclick = () => { manual = true; $('manual').classList.add('on'); $('auto').classList.remove('on'); audio._benchBeds(true); renderBeds(); };
$('auto').onclick = () => { manual = false; $('auto').classList.add('on'); $('manual').classList.remove('on'); for (const b of BEDS) audio._bed(b, 0); audio._benchBeds(false); renderBeds(); };
renderBeds();

// a fake sim state for the 'simulated state' mode: a horde ring, lit troughs, burning goblins
const N = 2600;
const fake = {
  t: 0, mode: 'play', modeT: 10, troll: null, player: { x: L.x, y: 0, z: L.z, yaw: L.yaw, weapon: 'pistol' },
  horde: { count: N, x: new Float32Array(N), y: new Float32Array(N), z: new Float32Array(N), state: new Uint8Array(N), burn: new Float32Array(N) },
  troughs: ARENA.oil.troughs.map((t) => ({ id: t.id, lit: false, oil: 1 })),
};
function fillFake() {
  const h = fake.horde; let i = 0;
  // near goblins in front-right (so the pan is audible), far ones down the valley
  for (let k = 0; k < sim.near && i < N; k++, i++) { const p = ahead(4 + Math.random() * 9, -3 - Math.random() * 6); h.x[i] = p.x; h.z[i] = p.z; h.state[i] = 1; h.burn[i] = k < sim.burning ? 3 : 0; }
  for (let k = 0; k < sim.far && i < N; k++, i++) { h.x[i] = -10 + Math.random() * 60; h.z[i] = 30 + Math.random() * 50; h.state[i] = 1; h.burn[i] = 0; }
  for (; i < N; i++) h.state[i] = 0;
  fake.troughs.forEach((t, k) => { t.lit = k < sim.troughs; });
  fake.player.yaw = sim.yaw;
}

// ---------------------------------------------------------------------------------------------- stress
function stress(n, seconds, kind = 'grunt', burned = false) {
  const before = audio.stats().perId.gob_death || { plays: 0, drops: 0 };
  const beforeB = audio.stats().perId.gob_burn || { plays: 0, drops: 0 };
  bench.peakDb = -Infinity;
  const frames = Math.max(1, Math.round(seconds * 60)); let sent = 0, f = 0; const w0 = performance.now();
  return new Promise((res) => {
    const tick = () => {
      const target = Math.round(n * (f + 1) / frames);
      while (sent < target) { ev(EV.E_DEATH, { id: sent, kind, pos: around(2, 30), burned: burned || Math.random() < 0.25 }); sent++; }
      f++;
      if (f < frames) requestAnimationFrame(tick);
      else setTimeout(() => {
        const s = audio.stats(); const a = s.perId.gob_death || { plays: 0, drops: 0 }; const b = s.perId.gob_burn || { plays: 0, drops: 0 };
        const r = { sent: n, seconds, wallS: +((performance.now() - w0 - 400) / 1000).toFixed(2), gob_death: { plays: a.plays - before.plays, drops: a.drops - before.drops }, gob_burn: { plays: b.plays - beforeB.plays, drops: b.drops - beforeB.drops }, maxPeakDbfs: +bench.peakDb.toFixed(2), voicesNow: s.voices };
        bench.log.push({ stress: r }); console.log('STRESS', JSON.stringify(r)); res(r);
      }, 400);
    };
    requestAnimationFrame(tick);
  });
}
btn($('stress'), '300 goblin deaths in 1 s', () => stress(300, 1));
btn($('stress'), '300 deaths in one frame', () => stress(300, 1 / 60));
btn($('stress'), 'XP shower (40 gems)', () => { let k = 0; const t = setInterval(() => { ev(EV.PICKUP, { kind: 'xp', value: 1, pos: L }); if (++k >= 40) clearInterval(t); }, 25); });
function towerSpam(seconds = 2) {
  const ids = ['obelisk_pulse', 'chain_throw', 'chain_hook', 'orbit_hit']; const b = Object.fromEntries(ids.map((id) => [id, audio.stats().perId[id]?.plays || 0]));
  bench.peakDb = -Infinity; let f = 0; const frames = Math.round(seconds * 60); let pv = 0; const w0 = performance.now();
  return new Promise((res) => {
    const tick = () => {
      for (let k = 0; k < 6; k++) ev(EV.OBELISK_PULSE, { pad: k, pos: ARENA.camp.pads[k], r: 5.5, level: 2 });
      for (let k = 0; k < 9; k++) { ev(EV.CHAIN_THROW, { pad: k % 3, from: ahead(5, k - 4), to: ahead(14, k - 4) }); ev(EV.CHAIN_HOOK, { pad: k % 3, pos: ahead(14, k - 4) }); }
      for (let k = 0; k < 40; k++) ev(EV.ORBIT_HIT, { pos: { x: L.x + Math.cos(k) * 2.2, y: 1, z: L.z + Math.sin(k) * 2.2 }, id: k });
      pv = Math.max(pv, audio.stats().voices);
      if (++f < frames) requestAnimationFrame(tick);
      else setTimeout(() => { const s = audio.stats(); const r = { seconds, frames, wallS: +((performance.now() - w0 - 400) / 1000).toFixed(2), perFrame: '6 obelisk pulses + 9 throws + 9 hooks + 40 orbit hits', started: Object.fromEntries(ids.map((id) => [id, (s.perId[id]?.plays || 0) - b[id]])), peakVoices: pv, maxPeakDbfs: +bench.peakDb.toFixed(2) }; bench.log.push({ towerSpam: r }); console.log('TOWERS', JSON.stringify(r)); res(r); }, 400);
    };
    requestAnimationFrame(tick);
  });
}
btn($('stress'), 'tower + orbit spam 2 s', () => towerSpam(2));
btn($('stress'), 'coin shower (30 coins)', () => { ev(EV.GOLD_DROP, { pos: ahead(4), value: 30, n: 30 }); setTimeout(() => { let k = 0; const t = setInterval(() => { ev(EV.PICKUP, { kind: 'gold', value: 1, pos: L }); if (++k >= 30) clearInterval(t); }, 40); }, 600); });
btn($('stress'), 'gate siege 4 s (60 Hz hits)', () => { let k = 0; const t = setInterval(() => { ev(EV.GATE_HIT, { pos: { x: 0, y: 1, z: 0.5 }, dmg: 6, hpFrac: 1 - k / 240 }); if (++k >= 240) clearInterval(t); }, 16); });

// ---------------------------------------------------------------------------------------------- events
const E = $('events');
btn(E, 'Kestrel shot', () => ev(EV.SHOT, { weapon: 'pistol' }));
btn(E, 'Kestrel reload', () => ev(EV.RELOAD, { weapon: 'pistol', seconds: 1.2 }));
btn(E, 'Blunderbuss blast', () => ev(EV.SHOT, { weapon: 'blunderbuss' }));
btn(E, 'Blunderbuss reload', () => ev(EV.RELOAD, { weapon: 'blunderbuss', seconds: 1.6 }));
btn(E, 'dry click', () => ev(EV.DRY, { weapon: 'pistol' }));
btn(E, 'Ember Lance on/off', (e, b) => { const on = !b.classList.contains('on'); b.classList.toggle('on', on); ev(on ? EV.LANCE_ON : EV.LANCE_OFF, {}); });
btn(E, 'firebomb (throw + burst 12 m ahead)', () => { ev(EV.BOMB_THROW, {}); setTimeout(() => ev(EV.BOMB_BURST, { pos: ahead(12), r: 3.5 }), 800); });
btn(E, 'Sunburst', () => ev(EV.SUNBURST, { pos: L, r: 14 }));
btn(E, 'barrel (left, 15 m)', () => ev(EV.BARREL_BURST, { pos: ahead(10, -11) }));
btn(E, 'trough lit (east)', () => ev(EV.TROUGH_LIT, { id: 'trough-e' }));
btn(E, 'trough out', () => ev(EV.TROUGH_OUT, { id: 'trough-e' }));
btn(E, 'kindle the beacon', () => ev(EV.KINDLE, { level: 1 }));
btn(E, 'beacon ready', () => ev(EV.BEACON_READY, {}));
btn(E, 'goblin hit', () => ev(EV.E_HIT, { kind: 'grunt', pos: ahead(8), source: 'bullet' }));
btn(E, 'brute shield hit', () => ev(EV.E_HIT, { kind: 'brute', pos: ahead(8), source: 'bullet' }));
btn(E, 'goblin ignites', () => ev(EV.E_IGNITE, { kind: 'grunt', pos: ahead(6, 2) }));
btn(E, 'goblin dies', () => ev(EV.E_DEATH, { kind: 'grunt', pos: ahead(6, -2), burned: false }));
btn(E, 'goblin burns to death', () => ev(EV.E_DEATH, { kind: 'grunt', pos: ahead(6, 2), burned: true }));
btn(E, 'imp dies', () => ev(EV.E_DEATH, { kind: 'imp', pos: ahead(5), burned: false }));
btn(E, 'claw at the player', () => ev(EV.E_ATTACK, { kind: 'grunt', pos: ahead(1), target: 'player' }));
btn(E, 'spear throw + hit', () => { ev(EV.SPEAR_THROW, { from: ahead(16, 4) }); setTimeout(() => ev(EV.SPEAR_HIT, { pos: ahead(2, 1), target: 'ground' }), 850); });
btn(E, 'gate hit', () => ev(EV.GATE_HIT, { pos: { x: 0, y: 1, z: 0.5 }, dmg: 8, hpFrac: 0.9 }));
btn(E, 'gate splinters', () => ev(EV.GATE_HIT, { pos: { x: 0, y: 1, z: 0.5 }, dmg: 8, hpFrac: 0.4 }));
btn(E, 'gate breached', () => ev(EV.GATE_BREACH, {}));
btn(E, 'XP gem', () => ev(EV.PICKUP, { kind: 'xp', value: 1, pos: L }));
btn(E, 'gold', () => ev(EV.PICKUP, { kind: 'gold', value: 5, pos: L }));
btn(E, 'heart', () => ev(EV.PICKUP, { kind: 'heart', value: 20, pos: L }));
btn(E, 'level up', () => ev(EV.LEVEL_UP, { level: 2, cards: [] }));
btn(E, 'card hover', () => audio.ui('hover'));
btn(E, 'card pick', () => ev(EV.CARD_PICK, { cardId: 'x', level: 2 }));
btn(E, 'UI click', () => audio.ui('click'));
btn(E, 'player hurt', () => ev(EV.P_HURT, { dmg: 8, source: 'melee' }));
btn(E, 'player dies', () => ev(EV.P_DEATH, {}));
btn(E, 'step: earth', () => ev(EV.P_STEP, { pos: { x: 3, y: 0, z: 5 }, speed: 6 }));
btn(E, 'step: stone (wall walk)', () => ev(EV.P_STEP, { pos: { x: 0, y: 5, z: -1.5 }, speed: 6 }));
btn(E, 'step: timber (stair)', () => ev(EV.P_STEP, { pos: { x: -9, y: 2.5, z: 5 }, speed: 6 }));
btn(E, 'troll arrives (horn, roar at 2.2 s)', () => ev(EV.T_ARRIVE, { pos: ahead(40) }));
btn(E, 'troll step', () => ev(EV.T_STEP, { pos: ahead(14, 3) }));
btn(E, 'windup: smash', () => ev(EV.T_WINDUP, { move: 'smash', pos: ahead(10), windup: 1.2 }));
btn(E, 'windup: throw', () => ev(EV.T_WINDUP, { move: 'throw', pos: ahead(16), windup: 1.0 }));
btn(E, 'windup: stomp', () => ev(EV.T_WINDUP, { move: 'stomp', pos: ahead(5), windup: 0.8 }));
btn(E, 'troll smash', () => ev(EV.T_SMASH, { pos: ahead(10), target: 'gate' }));
btn(E, 'boulder: throw + land', () => { ev(EV.T_THROW, { from: ahead(18), to: L, flight: 1.4 }); setTimeout(() => ev(EV.T_BOULDER, { pos: ahead(3), r: 2.5 }), 1400); });
btn(E, 'troll stomp', () => ev(EV.T_STOMP, { pos: ahead(5), r: 5 }));
btn(E, 'troll glows', () => ev(EV.T_GLOW, { on: true, heat: 1, pos: ahead(10) }));
btn(E, 'troll hit (cool / glowing)', () => { ev(EV.T_HURT, { pos: ahead(10), dmg: 18, glowing: false }); setTimeout(() => ev(EV.T_HURT, { pos: ahead(10), dmg: 54, glowing: true }), 400); });
btn(E, 'troll dies', () => ev(EV.T_DEATH, { pos: ahead(12) }));
btn(E, 'dawn (flee)', () => ev(EV.DAWN, {}));

// ------------------------------------------------------------------------------------------------------- DESIGN §9
const W = $('events2');
const C = $('cinder');
for (const [key, l] of Object.entries(VOICE_LINES)) btn(C, `“${l.text}” <small>${key}</small>`, () => { const d = audio.say(key); $('subtitle').textContent = d ? `${l.text}  (${d.toFixed(2)} s)` : `${l.text}  (not loaded)`; });
btn(W, 'camp enter (music → camp)', () => { ev(EV.CAMP_ENTER, { nextNight: 2, reason: 'dawn' }); audio.music('camp'); });
btn(W, 'kindle at the camp → Night II', () => { ev(EV.CAMP_LEAVE, { night: 2 }); setTimeout(() => audio.music('night2'), 1200); setTimeout(() => ev(EV.NIGHT_TITLE, { night: 2 }), 2500); });
btn(W, 'NIGHT II title sting', () => ev(EV.NIGHT_TITLE, { night: 2 }));
btn(W, 'coming soon', () => ev(EV.COMING_SOON, { completedNight: 2 }));
btn(W, 'Brother Cinder: open the stall', () => ev(EV.NPC_OPEN, {}));
btn(W, 'shop: buy', () => ev(EV.BUY, { item: 'hide', level: 1, cost: 60, goldLeft: 40 }));
btn(W, 'coins spill (brute, 3)', () => ev(EV.GOLD_DROP, { pos: ahead(5, 2), value: 3, n: 3 }));
btn(W, 'coin collect ×1', () => ev(EV.PICKUP, { kind: 'gold', value: 1, pos: L }));
btn(W, 'XP gems ×8 (ladder)', () => { let k = 0; const t = setInterval(() => { ev(EV.PICKUP, { kind: 'xp', value: 1, pos: L }); if (++k >= 8) clearInterval(t); }, 70); });
btn(W, 'charm drops (elite)', () => ev(EV.CHARM_DROP, { pos: ahead(8), charm: 'ember-tooth' }));
btn(W, 'charm found', () => ev(EV.CHARM_PICKUP, { charm: 'ember-tooth', dup: false }));
btn(W, 'charm equip / unequip', (e, b) => { const on = !b.classList.contains('on'); b.classList.toggle('on', on); ev(EV.CHARM_EQUIP, { charm: 'coin-hook', slot: 0, on }); });
btn(W, 'tower: build (gate pad)', () => ev(EV.TOWER_BUILD, { pad: 'pad-gate-w', tower: 'obelisk', level: 1, cost: 140 }));
btn(W, 'tower: build Chain Imp', () => ev(EV.TOWER_BUILD, { pad: 'pad-gate-e', tower: 'chainimp', level: 1, cost: 110 }));
btn(W, 'tower: upgrade', () => ev(EV.TOWER_UPGRADE, { pad: 'pad-gate-w', tower: 'obelisk', level: 2, cost: 180 }));
btn(W, 'Obelisk pulse (lv 1 / 3)', () => { ev(EV.OBELISK_PULSE, { pos: ahead(6, 3), r: 4.5, level: 1 }); setTimeout(() => ev(EV.OBELISK_PULSE, { pos: ahead(6, 3), r: 6.5, level: 3 }), 1600); });
btn(W, 'Chain Imp: throw + hook', () => { ev(EV.CHAIN_THROW, { from: ahead(4, -3), to: ahead(13, -1) }); setTimeout(() => ev(EV.CHAIN_HOOK, { pos: ahead(13, -1), pull: 2.5 }), 300); });
btn(W, 'Ember Orbit loop on/off', (e, b) => { const on = !b.classList.contains('on'); b.classList.toggle('on', on); audio._bed('orbit_loop', on ? 1 : 0, 0, 0.25); });
btn(W, 'orbit hit', () => ev(EV.ORBIT_HIT, { pos: ahead(2.2, 1), id: 1 }));
btn(W, 'Brimstone meteor (1.2 s flight)', () => ev(EV.METEOR, { from: ahead(30), pos: ahead(10, -3), r: 3, flight: 1.2 }));
btn(W, 'Cinder Trail (run 2 s)', () => { let k = 0; const t = setInterval(() => { ev(EV.TRAIL, { pos: L }); if (++k >= 10) clearInterval(t); }, 200); });
btn(W, 'Chieftain arrives (horn)', () => ev(EV.ELITE_SPAWN, { id: 1, kind: 'chief', pos: ahead(35, 6) }));
btn(W, 'Hexer arrives (cackle)', () => ev(EV.ELITE_SPAWN, { id: 2, kind: 'hexer', pos: ahead(18, -5) }));
btn(W, 'hex misses', () => ev(EV.HEX, { from: ahead(14, -3), to: ahead(1), hit: false }));
btn(W, 'hex hits (Lance sputters if on)', () => ev(EV.HEX, { from: ahead(14, -3), to: L, hit: true }));
// the Organ, bats, Pyre Burst, the Ash Roar
const W3 = $('events3');
let organT = 0;
const organHold = (on) => { clearInterval(organT); if (on) { ev('organ.fire', {}); organT = setInterval(() => ev(EV.SHOT, { weapon: 'organ', pellets: [] }), 1000 / 18); } else ev('organ.stop', { reason: 'release' }); };
const ob = btn(W3, 'THUNDER ORGAN: hold to fire', () => {}); ob.onpointerdown = () => organHold(true); ob.onpointerup = ob.onpointerleave = () => organHold(false);
btn(W3, 'THUNDER ORGAN: fire 3 s then overheat', () => { organHold(true); setTimeout(() => { clearInterval(organT); ev('organ.stop', { reason: 'overheat' }); ev('organ.overheat', { seconds: 1.5 }); }, 3000); });
btn(W3, 'Bat flaps near on/off', (e, b) => { const on = !b.classList.contains('on'); b.classList.toggle('on', on); audio._bed('bat_flap', on ? 1 : 0, 0.3, 0.25); });
btn(W3, 'Bat dive screech', () => ev('air.screech', { id: 1, pos: ahead(9, 4), to: L }));
btn(W3, 'Bat crash (burning)', () => ev('air.crash', { id: 1, pos: ahead(5, -2) }));
btn(W3, 'Pyre Burst ×24/s for 2 s', () => { let k = 0; const t = setInterval(() => { ev('pyre.burst', { pos: around(3, 12), r: 1.6, level: 1 }); if (++k >= 48) clearInterval(t); }, 1000 / 24); });
btn(W3, 'Ash Roar (growl, roar 1.2 s later)', () => { ev(EV.T_WINDUP, { move: 'roar', pos: ahead(18), windup: 1.2 }); setTimeout(() => ev('troll.roar', { pos: ahead(18), dir: { x: 0, z: -1 }, r: 9, angle: 0.8, calls: 30 }), 1200); });
btn(W3, 'BEGIN NIGHT (ew:ui begin)', () => window.dispatchEvent(new CustomEvent('ew:ui', { detail: { sound: 'begin' } })));
// DESIGN §8: a simulated state drives the layers, the rain, the ram, the ending
const W4 = $('events4');
const simOn = () => { if (manual) $('auto').onclick(); sim.near = 0; sim.far = 300; sim.troughs = 0; sim.burning = 0; };
const night = (n) => { simOn(); fake.mode = 'play'; fake.modeT = 10; fake.night = { n }; fake.weather = { rain: n === 4 ? 0.7 : 0 }; fake.rams = []; fake.boss = null; audio.onEvent({ type: EV.CAMP_LEAVE, night: n }, fake); };
for (const n of [1, 2, 3, 5, 6, 9]) btn(W4, `Night ${n} (layers ${n >= 3 ? 'on' : 'off'})`, () => night(n));
btn(W4, 'Night IV: rain squall 0.8 + thunder', () => { night(4); fake.weather = { rain: 0.8 }; ev('weather.squall', { on: true }); });
btn(W4, 'Siege Ram marching (drum) / hit', (e, b) => { const on = !b.classList.contains('on'); b.classList.toggle('on', on); simOn(); fake.rams = on ? [{ id: 0, x: L.x + 25, z: L.z + 30, hp: 600, mode: 'walk' }] : []; if (!on) ev('ram.hit', { id: 0, pos: { x: 0, z: 0.5 }, dmg: 120 }); });
btn(W4, 'Coven chant on/off', (e, b) => { const on = !b.classList.contains('on'); b.classList.toggle('on', on); simOn(); fake.mode = 'play'; ev('coven.chant', { on, pos: ahead(20) }); });
btn(W4, 'Rainmother rises (her theme)', () => { night(10); fake.boss = { kind: 'rainmother', hp: 12000, hpMax: 12000, alive: true, x: 10, z: 70 }; fake.weather = { rain: 0.8 }; ev('boss.rise', { pos: ahead(60) }); });
btn(W4, 'tide wave', () => ev('boss.tide', { from: ahead(50), to: ahead(4), pos: ahead(25) }));
btn(W4, 'huge step', () => ev('boss.step', { pos: ahead(30, 4) }));
btn(W4, 'whirlpool (6 s)', () => { simOn(); ev('boss.whirl', { pos: ahead(5, 3), r: 6, seconds: 6 }); });
btn(W4, 'lantern shot out', () => ev('boss.lantern', { idx: 0, pos: ahead(30, -2) }));
btn(W4, 'she collapses', () => { ev('boss.death', { pos: ahead(40) }); fake.boss = null; });
btn(W4, 'THE ENDING (TIMELINE.ending, 56 s)', () => { simOn(); fake.weather = { rain: 0 }; fake.boss = null; fake.mode = 'ending'; fake.modeT = 0; fake.modeRate = 1; });
btn(W4, '“Welcome home, Master.”', () => audio.say('master'));
// DESIGN §10.4
btn(W4, 'EMBER GALE (level 1 / 3)', () => { ev(EV.GALE, { dir: { x: 0, z: 1 }, strength: 1, seconds: 2.5, level: 1 }); setTimeout(() => ev(EV.GALE, { dir: { x: 0, z: 1 }, strength: 1, seconds: 2.5, level: 3 }), 5000); });
btn(W4, 'Hearthblood heals (10/s for 10 s)', () => { let k = 0; const t = setInterval(() => { ev(EV.P_HEAL, { amount: 0.3, source: 'hearthblood' }); if (++k >= 100) clearInterval(t); }, 100); });
btn(W, 'Douser: bucket throw + splash', () => ev(EV.DOUSE_THROW, { id: 3, from: ahead(12, 3), to: ahead(5, 1), r: 2.5 }));

// ---------------------------------------------------------------------------------------------- sounds (direct)
const groups = {};
const GROUP = [['nights III–X', /^(rain_|thunder|ram_|coven_|tide_|whirl|lantern_|portal_|hell_|gate_open|host_|demon_|gloves_|hunt_)/], ['organ, bats, pyre', /^(organ_|bat_|pyre_|ash_roar)/], ['Brother Cinder', /^vo_/], ['towers', /^(tower_|obelisk_|chain_)/], ['skills', /^(orbit_|meteor_|trail_)/], ['elites and Dousers', /^(chief_|hex|lance_sputter|douse_)/], ['camp', /^(horde_rise)/], ['music', /^mus_/], ['weapons', /^(w_|bomb_|sunburst)/], ['fire and oil', /^(barrel|trough|ignite|fire_)/], ['the horde', /^(gob_|imp_|hit_|claw|spear_|gate_|horde_)/],
  ['the beacon', /^beacon_/], ['the Ash Troll', /^(troll_|boulder_)/], ['the Lamplighter', /^(p_|step_)/], ['ambience', /^(amb_|wind_)/]];
for (const [id, d] of Object.entries(SOUNDS)) {
  if (d.loop) continue; // loops are under Music / Beds
  const g = d.bus === 'ui' ? 'pickups and UI' : (GROUP.find(([, re]) => re.test(id)) || ['other'])[0];
  (groups[g] ||= []).push([id, d]);
}
const box = $('sounds');
function renderSounds() {
  box.innerHTML = '';
  for (const [g, list] of Object.entries(groups)) {
    const h = document.createElement('div'); h.style.margin = '6px 0 2px'; h.style.color = 'var(--dim)'; h.textContent = g; box.appendChild(h);
    const row = document.createElement('div'); row.className = 'row'; box.appendChild(row);
    for (const [id, d] of list) {
      btn(row, `${id} <small>×${audio._variants(id)}</small>`, () => audio.play(id, d.spatial ? { x: ahead(6).x, z: ahead(6).z } : {}), d.desc || '');
    }
  }
}
audio.ready().then(renderSounds); renderSounds();

// ---------------------------------------------------------------------------------------------- loop
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  if (!manual) { fillFake(); fake.t += dt; fake.modeT = (fake.modeT ?? 0) + dt * (fake.modeRate ?? 1); audio.update(dt, fake, { ...L, yaw: sim.yaw }); }
  else audio.update(dt, null, L);
  meter();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
setInterval(() => { const s = audio.stats(); $('stats').textContent = JSON.stringify(s, null, 1); }, 300);

// ---------------------------------------------------------------------------------------------- self-test
if (q.get('selftest') === '1') selftest();
async function selftest() {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const out = { started: new Date().toISOString() };
  audio.unlock(); $('gate')?.remove();
  const t0 = performance.now(); await audio.ready(); out.loadMs = Math.round(performance.now() - t0);
  out.ctxState = audio._ctx.state; out.sampleRate = audio._ctx.sampleRate;
  const s0 = audio.stats(); out.loaded = s0.loaded; out.failed = s0.failed; out.total = s0.total;
  // decoded lengths vs the manifest (codec delay / padding check)
  const man = await (await fetch(assetsBase + 'audio/manifest.json')).json();
  const info = audio._info(); out.lengthCheck = [];
  for (const [id, s] of Object.entries(man.sounds)) s.files.forEach((f, k) => { const d = info[id]?.[k]; if (d) out.lengthCheck.push({ file: f.file, manifestDur: f.dur, decodedDur: d.dur, diffMs: +((d.dur - f.dur) * 1000).toFixed(2) }); });
  out.maxLengthDiffMs = Math.max(...out.lengthCheck.map((r) => Math.abs(r.diffMs)));
  // every one-shot plays
  out.playable = []; out.notPlayable = [];
  // a clean pool before each (at full speed 87 sounds 15 ms apart fill the 40 voices, and a quiet one may not steal)
  for (const [id, d] of Object.entries(SOUNDS)) { if (d.loop) continue; audio._stopAll(); await wait(12); const v = audio.play(id, { db: -30 }); (v ? out.playable : out.notPlayable).push(id); await wait(15); }
  await wait(300);
  // music switches
  out.music = [];
  for (const n of ['night', 'kindle', 'night', 'troll', 'dawn', 'camp', 'night2', 'kindle', 'night2', 'rain', null]) { audio.music(n); await wait(700); out.music.push({ asked: n, playing: audio.stats().music }); }
  // Brother Cinder: every line plays (lengths), one after another cut short
  out.voice = {}; for (const key of Object.keys(VOICE_LINES)) { out.voice[key] = +audio.say(key).toFixed(3); await wait(250); }
  // the limiter: 300 goblin deaths in one second, then 300 in one frame
  audio.music('night'); await wait(800);
  out.stress1s = await stress(300, 1);
  await wait(600);
  out.stressFrame = await stress(300, 1 / 60);
  await wait(600);
  out.towerSpam = await towerSpam(2);
  // the THUNDER ORGAN: 1 s of rounds at 18/s → the one loop, no per-round voice; released → off within 0.2 s
  await wait(400); const pl0 = audio.stats().played; organHold(true); await wait(500); const onMid = audio.stats().organ.on; await wait(500);
  clearInterval(organT); const tOff = performance.now(); ev('organ.stop', { reason: 'release' });
  let offMs = null; while (performance.now() - tOff < 400) { if (!audio.stats().organ.on) { offMs = Math.round(performance.now() - tOff); break; } await wait(10); }
  out.organ = { onWhileFiring: onMid, perRoundVoices: audio.stats().played - pl0, offAfterMs: offMs, loopStarts: audio.stats().organ.starts, bedLevelAfter: audio.stats().beds.organ_loop };
  // Pyre Burst at 24/s for 2 s
  await wait(300); const pp0 = audio.stats().perId.pyre_pop?.plays || 0; const pw0 = performance.now();
  await new Promise((res) => { let k = 0; const t = setInterval(() => { ev('pyre.burst', { pos: around(3, 12), r: 1.6, level: 1 }); if (++k >= 48) { clearInterval(t); res(); } }, 1000 / 24); });
  // DESIGN §8: Night IX's layers on the loop's beat; the ending's beats at 4× speed (TIMELINE.ending)
  night(9); await wait(4000);
  out.layers = { music: audio.stats().music, layers: audio._layers() };
  fake.mode = 'ending'; fake.modeT = 0; fake.modeRate = 4; await wait(Math.ceil(((window.__TL_END ?? 56) / 4 + 1.5) * 1000));
  const es = audio.stats(); out.ending = { cues: es.ending, master: es.perId.vo_cinder_master?.plays || 0, roar: es.perId.demon_roar?.plays || 0, rip: es.perId.portal_rip?.plays || 0, music: es.music };
  fake.mode = 'title'; fake.modeRate = 1; $('manual').onclick();
  // DESIGN §10.4: one EMBER GALE event → one gust
  const gg0 = audio.stats().perId.gale_gust?.plays || 0; ev(EV.GALE, { dir: { x: 0, z: 1 }, strength: 1, seconds: 2.5, level: 2 }); await wait(300);
  out.gale = { started: (audio.stats().perId.gale_gust?.plays || 0) - gg0 };
  out.pyre = { sent: 48, wallS: +((performance.now() - pw0) / 1000).toFixed(2), started: (audio.stats().perId.pyre_pop?.plays || 0) - pp0 };
  out.statsEnd = audio.stats();
  window.__benchResult = out;
  console.log('BENCH_RESULT ' + JSON.stringify(out));
}
