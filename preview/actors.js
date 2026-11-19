// VALLEYWARD · actors bench (preview/actors.html): a fake horde of up to 2,500 goblins flowing up a slope to a gate
// under a grey wall, a fake fire-light map, the Ash Troll cycling its moves, pickups and projectiles, and the viewmodel
// cycling weapons. Standalone: `npx vite --config vite.config.js --port 5355 --strictPort` → /preview/actors.html.
// URL: ?n=2500 &view=close|far|troll|wall|m1 &burn=1 &glow=1 &weapon=pistol|blunderbuss|lance &spray=1 &fire=0 &noui=1
//      &quality=high &freeze=1 (no motion: stable captures) &seed=1
//      DESIGN §9: &v2=1 (Chieftains, Hexers, Dousers in the mix + their throws/casts, charm and XP drops) &towers=1 (an
//      Obelisk and a Chain Imp at each level on the camp pads, pulsing / throwing chains) &camp=1 (mode 'camp': Brother
//      Cinder at his stall) &talk=1 &view=camp|banner|towers|crowd2
//      decision 0001: &edition=webgpu runs the actors in the WebGPU edition (WebGPURenderer + the TSL materials) for
//      side-by-side captures with the default WebGL2 edition (same seed, same view)
// Hooks for capture tools: window.__bench = { ready, stats(), set({...}), step(n) }.
import * as THREE from 'three';
import * as webgl2 from '../src/gfx/webgl2/index.js';
import { setGfx } from '../src/gfx/current.js';
import { createActors } from '../src/actors/index.js';
import { ARENA, groundHeight } from '../src/shared/arena.js';
import { FIRELIGHT } from '../src/shared/firelight.js';
import { EV, ENEMY_KINDS } from '../src/shared/events.js';
import { BURN } from '../src/shared/fireops.js';

const Q = new URLSearchParams(location.search);
// the shading layer (decision 0001): the actors' custom materials and the fire-light patch come from it
const EDITION = Q.get('edition') === 'webgpu' ? 'webgpu' : 'webgl2';
const layer = EDITION === 'webgpu' ? await import('../src/gfx/webgpu/index.js') : webgl2;
setGfx(layer);
const { patchFireLight } = layer;
const qn = (k, d) => (Q.has(k) ? Number(Q.get(k)) : d);
if (Q.get('noui') === '1') document.body.classList.add('noui');
const N = Math.min(20000, qn('n', 2500));   // up to 20,000 for the cap measurements (DESIGN §15.4)
const FREEZE = Q.get('freeze') === '1';
const VMONLY = Q.get('vmonly') === '1';

// ------------------------------------------------------------------------------------------------ renderer + scene
const renderer = EDITION === 'webgpu' ? await layer.createRenderer({ antialias: false })
  : new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, Number(Q.get('dpr')) || 1));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.autoClear = false;
if (Q.get('vmonly') === '1') renderer.setClearColor(0x4a5a64, 1);
renderer.info.autoReset = false;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x184255);
scene.fog = new THREE.FogExp2(0x2c5168, 0.012);
const camera = new THREE.PerspectiveCamera(78, innerWidth / innerHeight, 0.1, 400);
addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });

scene.add(new THREE.HemisphereLight(0x2a5a6e, 0x1a2224, 1.6));
const moon = new THREE.DirectionalLight(0x9fd3e0, 1.4);
moon.position.set(ARENA.moonDir.x * 100, ARENA.moonDir.y * 100, ARENA.moonDir.z * 100);
scene.add(moon);

// ground from the arena's height function + a grey wall with a gate gap
const gGeo = new THREE.PlaneGeometry(140, 150, 140, 150);
gGeo.rotateX(-Math.PI / 2);
gGeo.translate(30, 0, 55);
const gp = gGeo.attributes.position;
for (let i = 0; i < gp.count; i++) gp.setY(i, groundHeight(gp.getX(i), gp.getZ(i)));
gGeo.computeVertexNormals();
const groundMat = patchFireLight(new THREE.MeshLambertMaterial({ color: 0x4a473e }));
scene.add(new THREE.Mesh(gGeo, groundMat));
const wallMat = patchFireLight(new THREE.MeshLambertMaterial({ color: 0x55606a, flatShading: true }));
for (const [x0, x1] of [[-16, -2.5], [2.5, 16]]) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, 5, 3), wallMat);
  m.position.set((x0 + x1) / 2, 2.5, -1.5); scene.add(m);
}
const gate = new THREE.Mesh(new THREE.BoxGeometry(5, 4.2, 0.4), patchFireLight(new THREE.MeshLambertMaterial({ color: 0x4a3424 })));
gate.position.set(0, 2.1, -0.4); scene.add(gate);
for (const t of ARENA.keep.towers.slice(0, 2)) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(t.half * 2, t.height, t.half * 2), wallMat);
  m.position.set(t.x, t.height / 2, t.z - 0.5); scene.add(m);
}

// ------------------------------------------------------------------------------------------------ fake fire light
const FL = 64;
const flData = new Uint8Array(FL * FL * 4);
const flTex = new THREE.DataTexture(flData, FL, FL, THREE.RGBAFormat);
flTex.magFilter = flTex.minFilter = THREE.LinearFilter;
flTex.needsUpdate = true;
let fireOn = Q.get('fire') !== '0';
FIRELIGHT.uFireLightMap.value = flTex;
FIRELIGHT.uFireLightGain.value = 1.6;
const fires = [{ x: 9, z: 6, r: 4.5 }, { x: 2, z: 3, r: 3.2 }, { x: 16, z: 12, r: 3.5 }];
function updateFireLight(t) {
  flData.fill(0);
  if (fireOn) {
    const f = ARENA.fluid;
    for (let j = 0; j < FL; j++) for (let i = 0; i < FL; i++) {
      const x = f.x0 + (i + 0.5) / FL * f.size, z = f.z0 + (j + 0.5) / FL * f.size;
      let s = 0;
      for (const b of fires) { const d = Math.hypot(x - b.x - Math.sin(t * 0.7) * 0.8, z - b.z); s += 0.75 * Math.max(0, 1 - d / (b.r * 1.5)) ** 1.8; }
      s *= 0.85 + 0.15 * Math.sin(t * 13 + i * 0.3) * Math.sin(t * 7 + j * 0.2);
      const o = (j * FL + i) * 4;
      flData[o] = Math.min(255, s * 255); flData[o + 1] = Math.min(255, s * 105); flData[o + 2] = Math.min(255, s * 28); flData[o + 3] = 255;
    }
  }
  flTex.needsUpdate = true;
  // fire at the camera for the viewmodel
  let s = 0;
  if (fireOn) for (const b of fires) s += Math.max(0, 1 - Math.hypot(camera.position.x - b.x, camera.position.z - b.z) / (b.r * 3));
  FIRELIGHT.nearCamera.setRGB(s * 1.0, s * 0.42, s * 0.12);
}
// visible stand-in fire pools (so captures show where the light comes from)
const poolMat = new THREE.MeshBasicMaterial({ color: 0xff7a24, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false });
const pools = fires.map((b) => { const m = new THREE.Mesh(new THREE.CircleGeometry(b.r * 0.55, 20), poolMat); m.rotation.x = -Math.PI / 2; m.position.set(b.x, groundHeight(b.x, b.z) + 0.03, b.z); scene.add(m); return m; });

// ------------------------------------------------------------------------------------------------ fake sim state
let seed = qn('seed', 1) * 9301 + 49297;
const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
const SPEED = [2.4, 4.0, 2.0, 1.6, 1.9, 2.0, 2.6];
const V2 = Q.get('v2') === '1', TOWERS = !!Q.get('towers') && Q.get('towers') !== '0', CAMP = Q.get('camp') === '1';
const LINEUP = Q.get('towers') === 'line';   // every tower level side by side in front of view=lineup
const horde = {
  count: N, cap: 2500,
  x: new Float32Array(N), y: new Float32Array(N), z: new Float32Array(N), vx: new Float32Array(N), vz: new Float32Array(N),
  kind: new Uint8Array(N), hp: new Float32Array(N), burn: new Float32Array(N), anim: new Float32Array(N), state: new Uint8Array(N), dyingT: new Float32Array(N),
};
const tx = new Float32Array(N), tz = new Float32Array(N), deadT = new Float32Array(N);
const pickKind = () => {
  const r = rnd();
  if (V2) return r < 0.45 ? 0 : r < 0.6 ? 1 : r < 0.7 ? 2 : r < 0.75 ? 3 : r < 0.79 ? 4 : r < 0.84 ? 5 : 6;
  return r < 0.62 ? 0 : r < 0.82 ? 1 : r < 0.94 ? 2 : 3;
};
const pinned = new Set();
function spawn(i, anywhere) {
  const k = pickKind();
  horde.kind[i] = k; horde.hp[i] = 12; horde.burn[i] = 0; horde.state[i] = 1;
  if (anywhere) { // spread along the road and the slope at start
    const t = rnd();
    horde.x[i] = -14 + rnd() * 60; horde.z[i] = 7 + t * 65;
  } else if (rnd() < 0.6) { horde.x[i] = -20 + rnd() * 70; horde.z[i] = 66 + rnd() * 14; }
  else { horde.x[i] = 50 + rnd() * 8; horde.z[i] = 10 + rnd() * 45; }
  tx[i] = -11 + rnd() * 22; tz[i] = 1.2 + rnd() * 5.5;
}
for (let i = 0; i < N; i++) spawn(i, true);

const state = {
  t: 0, mode: 'play', horde,
  player: { x: 3, y: 0, z: 5, yaw: Math.PI / 2, pitch: -0.08, vx: 0, vz: 0, onGround: true, weapon: Q.get('weapon') || 'pistol', fuel: 100, firing: false, hp: 100 },
  troll: { x: 22, y: 0, z: 26, yaw: 0, hp: 2400, hpMax: 2400, heat: 0, glowing: false, action: 'walk', stage: null, actionT: 0, actionDur: 0 },
  pickups: [], bombs: [], spears: [], boulders: [],
};
const CHARM_IDS = ['ember-tooth', 'coin-hook', 'ashen-step', 'bellows-heart', 'cinder-ward', 'soot-lens', 'kindle-knot', 'spark-bead', 'witchfire-wick'];
for (let j = 0; j < 60; j++) {
  const x = -6 + rnd() * 20, z = 2 + rnd() * 8;
  const kind = V2 && j < 9 ? 'charm' : j % 13 === 0 ? 'heart' : j % 5 === 0 ? 'gold' : 'xp';
  state.pickups.push({ id: j, kind, charm: kind === 'charm' ? CHARM_IDS[j] : undefined, x: V2 && j < 9 ? 1 + j * 0.9 : x, y: 0, z: V2 && j < 9 ? 9 : z, value: 1 });
}
if (TOWERS || CAMP) state.run = { towers: [
  { pad: 'pad-gate-w', type: 'obelisk', level: 1 }, { pad: 'pad-gate-e', type: 'chainimp', level: 1 },
  { pad: 'pad-road', type: 'obelisk', level: 2 }, { pad: 'pad-west', type: 'chainimp', level: 2 },
  { pad: 'pad-slope', type: 'obelisk', level: 3 }, { pad: 'pad-bend', type: 'chainimp', level: 3 },
] };
if (LINEUP) state.run = { towers: [1, 2, 3, 4, 5].flatMap((L) => [
  { pad: `ob${L}`, type: 'obelisk', level: L, x: -10 + (L - 1) * 3.4, z: 16 }, { pad: `ci${L}`, type: 'chainimp', level: L, x: 9 + (L - 1) * 3.4, z: 16 }]) };
// Bat Gremlins (?air=N) circling the camera at 10–16 m, 4–7 m up, one diving every ≈ 3 s (&airburn=1: half burning)
const AIRN = qn('air', 0);
if (AIRN) state.air = Array.from({ length: AIRN }, (_, j) => ({ id: j, a: j / AIRN * 6.283, r: 10 + (j % 4) * 2, alt: 4 + (j % 3) * 1.4,
  x: 0, y: 5, z: 0, vx: 0, vy: 0, vz: 0, state: 'fly', burn: Q.get('airburn') === '1' && j % 2 ? 2 : 0, diveT: -1 }));
let airDiveClock = 0;
// DESIGN §8: Siege Rams (?ram=N, &ramburn=1), the Rainmother (?boss=1 cycles rise/walk/tide/whirl/climb; &crack=1 &lanterns=n
// &bossdead=1), the ending (?ending=T: its crowds, the demon, Cinder and the gloves from T s into TIMELINE.ending)
const RAMN = qn('ram', 0);
if (RAMN) state.rams = Array.from({ length: RAMN }, (_, j) => ({ id: j, x: 13 - j * 3.2, y: 0, z: 11 + j * 3, yaw: 0, hp: 600, hpMax: 600, crew: 8,
  mode: Q.get('ramburn') === '1' ? 'stall' : 'walk', t: 0, burn: Q.get('ramburn') === '1' ? 2 : 0 }));
const BOSS = Q.get('boss') === '1';
const BOSS_SEQ = [['rise', 3.2], ['walk', 4], ['tide', 1.8], ['walk', 2], ['whirl', 1.8], ['climb', 3]];
let bossI = 0;
if (BOSS) state.boss = { kind: 'rainmother', x: qn('bx', 16), y: 0, z: qn('bz', 34), yaw: 0, hp: 12000, hpMax: 12000, phase: 1,
  mode: Q.get('bossmode') || 'walk', t: 0, heat: Q.get('crack') === '1' ? 1 : 0, cracked: Q.get('crack') === '1',
  lanterns: Array.from({ length: 5 }, (_, i) => ({ alive: i < qn('lanterns', 5) })), shamans: 2, alive: Q.get('bossdead') !== '1', deathT: 0 };
if (BOSS && Q.get('bossdead') === '1') state.boss.mode = 'dead';
let endT = Q.has('ending') ? qn('ending', 0) : null;
if (Q.has('heat')) state.player.heat = qn('heat', 0);
if (Q.get('over') === '1') { state.player.overheated = true; state.player.heat = 1; }
if (CAMP) state.mode = 'camp';
let towerT = 0;
const events = [];
const emit = (type, o = {}) => events.push({ type, t: state.t, ...o });

// toggles
const T = {
  burnBurst: false, glow: Q.get('glow') === '1', autoFire: false, walk: false, spray: Q.get('spray') === '1', trollAuto: true, kills: true, motion: !FREEZE,
};
if (Q.get('burn') === '1') setTimeout(() => burnNear(400), 50);
function burnNear(n) {
  const c = [];
  for (let i = 0; i < N; i++) if (horde.state[i] && horde.state[i] !== 4) c.push([Math.hypot(horde.x[i] - 9, horde.z[i] - 7), i]);
  c.sort((a, b) => a[0] - b[0]);
  for (const [, i] of c.slice(0, n)) { horde.burn[i] = BURN.seconds; emit(EV.E_IGNITE, { id: i, kind: ENEMY_KINDS[horde.kind[i]], pos: { x: horde.x[i], y: horde.y[i], z: horde.z[i] } }); }
}
function killNear(n) {
  const c = [];
  for (let i = 0; i < N; i++) if (horde.state[i] === 1 || horde.state[i] === 2) c.push([Math.hypot(horde.x[i] - 6, horde.z[i] - 6), i]);
  c.sort((a, b) => a[0] - b[0]);
  for (const [, i] of c.slice(0, n)) kill(i);
}
function kill(i) {
  horde.state[i] = 4; deadT[i] = 0;
  emit(EV.E_DEATH, { id: i, kind: ENEMY_KINDS[horde.kind[i]], pos: { x: horde.x[i], y: horde.y[i], z: horde.z[i] }, burned: horde.burn[i] > 0 });
}

let trollPhase = 0, trollT = 0, shotT = 0;
const CLEAR = qn('clear', 5);
const TROLL_SEQ = [['walk', null, 3], ['smash', 'windup', 1.2], ['smash', 'strike', 0.5], ['walk', null, 2], ['throw', 'windup', 1.0], ['throw', 'release', 0.5],
  ['stomp', 'windup', 0.8], ['stomp', 'strike', 0.5]];
let trollForce = Q.get('troll') || null;

function simStep(dt) {
  state.t += dt;
  const t = state.t;
  // horde
  let killsThisFrame = 0;
  for (let i = 0; i < N; i++) {
    const s = horde.state[i];
    if (s === 0) { spawn(i, false); continue; }
    if (pinned.has(i)) continue;
    if (s === 4) { deadT[i] += dt; if (deadT[i] > 0.4) horde.state[i] = 0; continue; }
    const k = horde.kind[i];
    let dx = tx[i] - horde.x[i], dz = tz[i] - horde.z[i];
    const d = Math.hypot(dx, dz);
    let sp = SPEED[k] * (k === 1 ? 0.8 + 0.4 * Math.sin(t * 5 + i) : 1);
    if (horde.burn[i] > 0) {
      horde.burn[i] -= dt; horde.hp[i] -= BURN.dps * dt;
      if (horde.burn[i] <= 0) horde.burn[i] = 0;
      if (horde.hp[i] <= 0) { kill(i); continue; }
      horde.state[i] = 3; sp *= 1.5; dx = -dx + Math.sin(t * 7 + i) * d; dz = -dz;
    } else if (d < 0.4) { horde.state[i] = 2; sp = 0; }
    else horde.state[i] = 1;
    const n = Math.hypot(dx, dz) || 1;
    const wob = Math.sin(t * 1.3 + i * 0.37) * 0.35;
    horde.vx[i] = (dx / n + wob * dz / n) * sp; horde.vz[i] = (dz / n - wob * dx / n) * sp;
    horde.x[i] += horde.vx[i] * dt; horde.z[i] += horde.vz[i] * dt;
    // keep a clear zone around the bench camera (the real sim attacks the player at 1.2 m; here we only look)
    { const cx = horde.x[i] - camera.position.x, cz = horde.z[i] - camera.position.z, cd = Math.hypot(cx, cz);
      if (cd < CLEAR && cd > 1e-3) { horde.x[i] = camera.position.x + cx / cd * CLEAR; horde.z[i] = camera.position.z + cz / cd * CLEAR; } }
    // the mound at the gate: crowded enemies near the gate centre stand on each other
    const gx = horde.x[i], gz = horde.z[i] - 1.2;
    const mound = Math.max(0, 3.4 - Math.abs(gx) * 0.42 - gz * 0.55) * (0.55 + 0.45 * ((i * 0.618) % 1));
    horde.y[i] = groundHeight(horde.x[i], horde.z[i]) + (horde.state[i] === 2 || d < 3 ? mound : 0);
    // attackers at the wall die off at a steady rate so the flow never stops
    if (T.kills && horde.state[i] === 2 && killsThisFrame < 2 && rnd() < dt * 0.08) { kill(i); killsThisFrame++; }
  }
  // troll
  const tr = state.troll;
  if (T.trollAuto && tr.hp > 0) {
    trollT += dt;
    const [a, st, dur] = trollForce ? (TROLL_SEQ.find((s) => `${s[0]}${s[1] ? `.${s[1]}` : ''}` === trollForce) || TROLL_SEQ[0]) : TROLL_SEQ[trollPhase];
    tr.action = a; tr.stage = st; tr.actionT = trollT; tr.actionDur = dur;
    if (a === 'walk' && !FREEZE) { const dx = 8 - tr.x, dz = 14 - tr.z, d = Math.hypot(dx, dz); if (d > 1) { tr.x += dx / d * 1.4 * dt; tr.z += dz / d * 1.4 * dt; } }
    tr.y = groundHeight(tr.x, tr.z);
    if (!trollForce && trollT > dur) {
      trollT = 0; trollPhase = (trollPhase + 1) % TROLL_SEQ.length;
      const [na, ns] = TROLL_SEQ[trollPhase];
      if (ns === 'release') state.boulders.push({ id: t, x: tr.x - 1, y: tr.y + 6, z: tr.z, vx: (state.player.x - tr.x) / 1.4, vy: 6, vz: (state.player.z - tr.z) / 1.4, life: 1.4 });
      if (ns === 'windup') emit(EV.T_WINDUP, { move: na, pos: { x: tr.x, y: tr.y, z: tr.z }, windup: TROLL_SEQ[trollPhase][2] });
    }
  }
  tr.heat = T.glow ? Math.min(1.2, 0.6 + 0.6 * Math.abs(Math.sin(t * 0.5))) : Math.max(0, tr.heat - dt * 0.5);
  if (T.glow && Q.get('glow') === '1') tr.heat = 1.1;
  tr.glowing = tr.heat >= 1;
  // projectiles
  for (const b of state.boulders) { b.vy -= 9.8 * dt; b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt; b.life -= dt; }
  state.boulders = state.boulders.filter((b) => b.life > 0);
  if (rnd() < dt * 1.2) { const x = 14 + rnd() * 10, z = 18 + rnd() * 6; state.spears.push({ id: t, x, y: groundHeight(x, z) + 1.4, z, vx: (state.player.x - x) / 1.6, vy: 3, vz: (state.player.z - z) / 1.6, life: 1.4 }); }
  for (const s of state.spears) { s.vy -= 9.8 * dt; s.x += s.vx * dt; s.y += s.vy * dt; s.z += s.vz * dt; s.life -= dt; }
  state.spears = state.spears.filter((s) => s.life > 0);
  for (const b of state.bombs) { b.vy -= 9.8 * dt; b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt; b.life -= dt; }
  state.bombs = state.bombs.filter((b) => b.life > 0);
  // DESIGN §9: Dousers throw buckets at the fire, Hexers cast at the player, towers pulse and throw chains
  if (V2 && rnd() < dt * 1.5) {
    for (let k = 0; k < 40; k++) {
      const i = (rnd() * N) | 0;
      if (horde.state[i] !== 1 || (horde.kind[i] !== 5 && horde.kind[i] !== 6)) continue;
      const from = { x: horde.x[i], y: horde.y[i] + 1.0, z: horde.z[i] };
      if (horde.kind[i] === 6) { const f = fires[(rnd() * fires.length) | 0]; emit(EV.DOUSE_THROW, { id: i, from, to: { x: f.x, z: f.z }, r: 2.5 }); }
      else emit(EV.HEX, { from, to: { x: state.player.x, y: 1.4, z: state.player.z }, hit: false });
      break;
    }
  }
  if (state.run && T.motion) {
    towerT += dt;
    for (const tw of state.run.towers) {
      const pad = ARENA.camp.pads.find((p) => p.id === tw.pad) || { x: tw.x, z: tw.z };
      tw.clock = (tw.clock ?? rnd() * 2) + dt;
      const every = tw.type === 'obelisk' ? [3.0, 2.5, 2.0][tw.level - 1] : [1.6, 1.3, 1.0][tw.level - 1];
      if (tw.clock < every) continue;
      tw.clock = 0;
      if (tw.type === 'obelisk') emit(EV.OBELISK_PULSE, { pad: tw.pad, pos: { x: pad.x, y: 0, z: pad.z }, r: 4.5, level: tw.level });
      else {
        let bi = -1, bd = 16 * 16;
        for (let i = 0; i < N; i++) { if (horde.state[i] !== 1 && horde.state[i] !== 2) continue; const d = (horde.x[i] - pad.x) ** 2 + (horde.z[i] - pad.z) ** 2; if (d < bd) { bd = d; bi = i; } }
        if (bi >= 0) {
          emit(EV.CHAIN_THROW, { pad: tw.pad, from: { x: pad.x, y: 2, z: pad.z }, to: { x: horde.x[bi], y: horde.y[bi], z: horde.z[bi] }, targetId: bi });
          const id = bi; setTimeout(() => emit(EV.CHAIN_HOOK, { pad: tw.pad, targetId: id, pos: { x: horde.x[id], y: horde.y[id], z: horde.z[id] }, pull: 2.5 }), 220);
        }
      }
    }
  }
  if (Q.get('talk') === '1' && rnd() < dt * 0.4) emit(EV.NPC_LINE, { line: 'home' });
  if (state.rams) for (const r of state.rams) {
    r.t += dt;
    if (r.mode === 'walk') { const dx = 1 - r.x, dz = 2.5 - r.z, d = Math.hypot(dx, dz); if (d > 0.5) { r.x += dx / d * 1.2 * dt; r.z += dz / d * 1.2 * dt; } else { r.mode = 'swing'; r.t = 0; } }
    else if (r.mode === 'swing' && r.t > 1.4) r.t = 0;
    r.y = groundHeight(r.x, r.z);
  }
  if (state.boss) {
    const b = state.boss; b.t += dt; b.y = groundHeight(b.x, b.z);
    if (b.alive === false) b.deathT += dt;
    else if (!Q.get('bossmode')) { const [m, d] = BOSS_SEQ[bossI]; b.mode = m; if (b.t > d) { b.t = 0; bossI = (bossI + 1) % BOSS_SEQ.length; } if (m === 'walk' || m === 'climb') b.z -= dt * 0.8; }
  }
  if (endT != null) endT += dt;
  if (state.air) {
    airDiveClock += dt;
    const P0 = state.player;
    if (airDiveClock > 3 && !FREEZE) { airDiveClock = 0; const b = state.air.find((q) => q.state === 'fly'); if (b) { b.state = 'dive'; b.diveT = 0; } }
    for (const b of state.air) {
      const ox = b.x, oy = b.y, oz = b.z;
      if (b.state === 'dive') {
        b.diveT += dt; const u = Math.min(1, b.diveT / 1.2);
        b.x += (P0.x - b.x) * Math.min(1, dt * 2.2); b.z += (P0.z - b.z) * Math.min(1, dt * 2.2); b.y = b.alt + (1.6 - b.alt) * u * u;
        if (u >= 1) b.state = 'climb';
      } else {
        if (b.state === 'climb') { b.y += dt * 3; if (b.y >= b.alt) { b.y = b.alt; b.state = 'fly'; } }
        b.a += dt * (0.35 + (b.id % 3) * 0.08);
        const tx = P0.x + Math.cos(b.a) * b.r, tz = P0.z + Math.sin(b.a) * b.r;
        b.x += (tx - b.x) * Math.min(1, dt * 1.5); b.z += (tz - b.z) * Math.min(1, dt * 1.5);
        if (b.state === 'fly') b.y = b.alt + Math.sin(state.t * 1.3 + b.id) * 0.4;
      }
      if (b.state === 'dying') { b.vy -= 9.8 * dt; b.y = Math.max(groundHeight(b.x, b.z), b.y + b.vy * dt); }
      b.vx = (b.x - ox) / Math.max(dt, 1e-3); b.vy = b.state === 'dying' ? b.vy : (b.y - oy) / Math.max(dt, 1e-3); b.vz = (b.z - oz) / Math.max(dt, 1e-3);
    }
  }
  // player / viewmodel
  const p = state.player;
  if (T.walk) { p.vx = Math.cos(t * 0.3) * 5; p.vz = 0; } else { p.vx = 0; p.vz = 0; }
  p.firing = T.spray && (p.weapon === 'lance' || p.weapon === 'organ');
  if (T.autoFire && p.weapon !== 'lance') {
    shotT -= dt;
    if (shotT <= 0) { shotT = p.weapon === 'blunderbuss' ? 0.83 : 0.25; emit(EV.SHOT, { weapon: p.weapon }); }
  }
}

// ------------------------------------------------------------------------------------------------ views
const VIEWS = {
  m1: { pos: [3, 1.68, 5], yaw: Math.PI / 2 + 0.35, pitch: -0.12 },          // M1's framing: on the plaza, down the road
  close: { pos: [2.5, 1.68, 10.5], yaw: Math.PI * 0.97, pitch: -0.08 },            // close to the wall, the mound at the gate
  far: { pos: [-9, 6.68, -1.2], yaw: 0.45, pitch: -0.3 },                    // from the wall walk: the slope full of goblins
  wall: { pos: [-9.5, 6.68, -1.5], yaw: 1.05, pitch: -0.42 },               // from the wall walk down at the gate mound (M2-ish)
  troll: { pos: [4, 1.68, 4], yaw: 0.62, pitch: 0.12 },                      // the troll up the slope
  camp: { pos: [-13.6, 1.68, 6.4], yaw: -2.2, pitch: -0.1 },                 // Brother Cinder at his stall (west plaza)
  banner: { pos: [3, 1.68, 6], yaw: 0.05, pitch: -0.04 },                    // a Chieftain, a Hexer, a Douser up close
  towers: { pos: [5.5, 6.68, -1.2], yaw: 0.0, pitch: -0.32 },              // the pads from the wall walk
  crowd2: { pos: [3, 1.68, 5], yaw: 0.2, pitch: -0.1 },                      // the new goblins in the crowd
  lineup: { pos: [5.0, 3.0, 0.8], yaw: 0.0, pitch: 0.05 },
  air: { pos: [3, 1.68, 5], yaw: Math.PI / 2 + 0.2, pitch: 0.28 },                // the Bat Gremlins against the sky
  rain: { pos: [-4, 6.68, -1.2], yaw: 0.42, pitch: 0.08 },                          // the Rainmother from the wall walk
  ramv: { pos: [4, 1.68, 4], yaw: 0.75, pitch: -0.06 },                              // the Siege Rams coming up to the gate
  reveal: { pos: [1.2, 3.2, 9.5], yaw: Math.PI + 0.05, pitch: 0.2 },                // the demon on the wall walk, low frontal angle
  hostv: { pos: [-11, 5, 3], yaw: 0.7, pitch: -0.16 },                               // the host marching out of the gate
  hunt: { pos: [18, 9, 66], yaw: 0.42, pitch: -0.2 },                               // the crane over the village (29, 84)                   // ?towers=line: every tower level side by side
};
let view = Q.get('view') || 'm1';
function applyView() {
  const v = VIEWS[view] || VIEWS.m1;
  camera.position.set(...v.pos);
  camera.rotation.set(0, 0, 0, 'YXZ');
  camera.rotation.order = 'YXZ';
  // yaw convention (arena.js): forward = (sin yaw, 0, cos yaw); three's camera looks down -Z, so rotate by yaw + π
  camera.rotation.y = v.yaw + Math.PI; camera.rotation.x = v.pitch;
  state.player.x = v.pos[0]; state.player.z = v.pos[2]; state.player.yaw = v.yaw; state.player.pitch = v.pitch;
  if (view === 'troll') { state.troll.x = 14; state.troll.z = 18; }
  if (view === 'reveal') { state.player.x = 0; state.player.y = 5; state.player.z = -1.5; }
  if (view === 'banner') {
    // three pinned goblins in front of the camera: Chieftain, Hexer, Douser (walk frame 0, facing the camera)
    [[4, 1.6, 10.6], [5, 3.6, 10.2], [6, 5.2, 9.9]].forEach(([k, x, z], j) => {
      const i = j; pinned.add(i); horde.kind[i] = k; horde.state[i] = 1; horde.burn[i] = 0; horde.vx[i] = 0; horde.vz[i] = 0;
      horde.x[i] = x; horde.z[i] = z; horde.y[i] = groundHeight(x, z);
    });
  }
}
applyView();

// ------------------------------------------------------------------------------------------------ actors
const quality = Q.get('quality') || 'high';
// ?assets=bad points the module at a missing folder: it must fall back to its stand-in atlas and textures
const assetsBase = Q.get('assets') === 'bad' ? new URL('../no-such-assets/', location.href).href : new URL('../assets/', location.href).href;
const actors = await createActors({ scene, camera, quality, assetsBase, renderer });
const vm = actors.viewmodel;
// ?marker=1: a small magenta ring drawn on top at actors.sockets.muzzle(), to prove the socket matches the drawn muzzle
const MARKER = Q.get('marker') === '1';
const markerScene = new THREE.Scene();
const marker = new THREE.Mesh(new THREE.RingGeometry(0.012, 0.02, 16), new THREE.MeshBasicMaterial({ color: 0xff00ff, depthTest: false, side: THREE.DoubleSide }));
marker.onBeforeRender = () => marker.quaternion.copy(camera.quaternion);
markerScene.add(marker);

// ------------------------------------------------------------------------------------------------ UI
const ui = document.getElementById('ui');
const btn = (label, fn, on) => { const b = document.createElement('button'); b.textContent = label; if (on) b.classList.add('on'); b.onclick = () => { const r = fn(); if (typeof r === 'boolean') b.classList.toggle('on', r); }; ui.appendChild(b); return b; };
btn('view', () => { const ks = Object.keys(VIEWS); view = ks[(ks.indexOf(view) + 1) % ks.length]; applyView(); });
btn('burn 300', () => burnNear(300));
btn('kill 200', () => killNear(200));
btn('hit flash', () => { for (let i = 0; i < N; i += 7) emit(EV.E_HIT, { id: i }); });
btn('troll glow', () => (T.glow = !T.glow), T.glow);
btn('troll move', () => { trollForce = null; trollPhase = (trollPhase + 1) % TROLL_SEQ.length; trollT = 0; });
btn('troll dies', () => { state.troll.hp = 0; state.troll.action = 'dead'; emit(EV.T_DEATH, {}); });
btn('weapon', () => { const ws = ['pistol', 'blunderbuss', 'lance']; state.player.weapon = ws[(ws.indexOf(state.player.weapon) + 1) % 3]; emit(EV.WEAPON_SWITCH, { weapon: state.player.weapon }); });
btn('shoot', () => emit(EV.SHOT, { weapon: state.player.weapon }));
btn('auto fire', () => (T.autoFire = !T.autoFire), T.autoFire);
btn('reload', () => emit(EV.RELOAD, { weapon: state.player.weapon, seconds: state.player.weapon === 'blunderbuss' ? 1.6 : 1.2 }));
btn('throw bomb', () => {
  emit(EV.BOMB_THROW, {});
  const p = state.player, dx = Math.sin(p.yaw), dz = Math.cos(p.yaw);
  state.bombs.push({ id: state.t, x: p.x + dx, y: 1.6, z: p.z + dz, vx: dx * 14, vy: 6, vz: dz * 14, life: 1.4 });
});
btn('spray (lance)', () => { T.spray = !T.spray; emit(T.spray ? EV.LANCE_ON : EV.LANCE_OFF, {}); return T.spray; }, T.spray);
btn('walk bob', () => (T.walk = !T.walk), T.walk);
btn('fire light', () => { fireOn = !fireOn; pools.forEach((m) => { m.visible = fireOn; }); return fireOn; }, fireOn);
btn('motion', () => (T.motion = !T.motion), T.motion);
btn('kills', () => (T.kills = !T.kills), T.kills);
btn('camp', () => { state.mode = state.mode === 'camp' ? 'play' : 'camp'; return state.mode === 'camp'; }, CAMP);
btn('npc talk', () => emit(EV.NPC_LINE, { line: 'home' }));
if (!fireOn) pools.forEach((m) => { m.visible = false; });

// ------------------------------------------------------------------------------------------------ loop
const statsEl = document.getElementById('stats');
const GPU = Q.get('gpu') === '1';
const gl = EDITION === 'webgl2' ? renderer.getContext() : null;   // (?gpu=1's timer query is WebGL2-only)
const gpuExt = GPU && gl ? gl.getExtension('EXT_disjoint_timer_query_webgl2') : null;
let gpuQ = null;
const gpuMs = [];
const frameMs = [], cpuMs = [], renderMs = [];   // renderMs: CPU time of the world render call (instance upload + submit)
let last = performance.now(), statT = 0;
let lastInfo = { calls: 0, triangles: 0 };
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  frameMs.push(dt * 1000); if (frameMs.length > 240) frameMs.shift();
  if (T.motion) simStep(dt);
  updateFireLight(state.t);
  layer.frame();   // per-edition per-frame sync (the webgpu fire light's uniforms follow FIRELIGHT)
  const c0 = performance.now();
  if (endT != null) actors.ending.set(endT);
  for (const ev of events) actors.onEvent(ev, state);
  events.length = 0;
  actors.update(dt, state);
  vm.update(dt, state, null);
  const c1 = performance.now();
  cpuMs.push(c1 - c0); if (cpuMs.length > 240) cpuMs.shift();
  renderer.info.reset();
  if (GPU && gpuExt && gpuQ && gl.getQueryParameter(gpuQ, gl.QUERY_RESULT_AVAILABLE)) {
    if (!gl.getParameter(gpuExt.GPU_DISJOINT_EXT)) { gpuMs.push(gl.getQueryParameter(gpuQ, gl.QUERY_RESULT) / 1e6); if (gpuMs.length > 240) gpuMs.shift(); }
    gl.deleteQuery(gpuQ); gpuQ = null;
  }
  renderer.clear();
  if (!VMONLY && GPU) {
    // ?gpu=1: the world without the crowd, then the crowd alone inside a GPU timer query (its own cost, depth-tested)
    actors.crowd.visible = false; renderer.render(scene, camera); actors.crowd.visible = true;
    const q = gpuExt && !gpuQ ? gl.createQuery() : null;
    if (q) gl.beginQuery(gpuExt.TIME_ELAPSED_EXT, q);
    renderer.render(actors.crowd, camera);
    if (q) { gl.endQuery(gpuExt.TIME_ELAPSED_EXT); gpuQ = q; }
  } else if (!VMONLY) { const r0 = performance.now(); renderer.render(scene, camera); renderMs.push(performance.now() - r0); if (renderMs.length > 240) renderMs.shift(); }
  renderer.clearDepth();
  renderer.render(vm.scene, vm.camera);
  if (MARKER) { actors.sockets.muzzle(marker.position); renderer.clearDepth(); renderer.render(markerScene, camera); }
  lastInfo = { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles };
  statT += dt;
  if (statT > 0.25) { statT = 0; statsEl.textContent = statsText(); }
  requestAnimationFrame(frame);
}
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * p))] || 0; };
const avg = (a) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
function stats() {
  const s = actors.stats();
  return { frameAvg: +avg(frameMs).toFixed(2), frameP95: +pct(frameMs, 0.95).toFixed(2), actorsCpuAvg: +avg(cpuMs).toFixed(3), actorsCpuP95: +pct(cpuMs, 0.95).toFixed(3),
    renderCpuAvg: +avg(renderMs).toFixed(3), renderCpuP95: +pct(renderMs, 0.95).toFixed(3), organ: actors.viewmodel.organ ?? null,
    gpuCrowdAvg: gpuMs.length ? +avg(gpuMs).toFixed(3) : (GPU ? (gpuExt ? 'pending' : 'no timer ext') : null), gpuCrowdP95: gpuMs.length ? +pct(gpuMs, 0.95).toFixed(3) : null, gpuSamples: gpuMs.length,
    calls: lastInfo.calls, triangles: lastInfo.triangles, instances: s.instances, corpses: s.corpses, atlas: s.atlas, weapon: state.player.weapon,
    alive: horde.state.reduce((a, v) => a + (v === 1 || v === 2 || v === 3 ? 1 : 0), 0), w: renderer.domElement.width, h: renderer.domElement.height, edition: EDITION };
}
function statsText() {
  const s = stats();
  return `frame ${s.frameAvg} ms (p95 ${s.frameP95})\nactors CPU ${s.actorsCpuAvg} ms (p95 ${s.actorsCpuP95})\ndraw calls ${s.calls} · tris ${s.triangles}\ninstances ${s.instances} (alive ${s.alive}, corpses ${s.corpses})\natlas ${s.atlas} · ${s.weapon} · view ${view}\n${s.w}×${s.h}`;
}
// settle a few frames of motion before the first capture so the horde is spread over the slope
for (let i = 0; i < 30; i++) simStep(1 / 30);
requestAnimationFrame(frame);

window.__bench = {
  ready: true,
  stats,
  set(o = {}) {
    if (o.view) { view = o.view; applyView(); }
    if (o.weapon) { state.player.weapon = o.weapon; emit(EV.WEAPON_SWITCH, { weapon: o.weapon }); }
    if (o.burn) burnNear(o.burn);
    if (o.kill) killNear(o.kill);
    if (o.glow != null) T.glow = !!o.glow;
    if (o.spray != null) { T.spray = !!o.spray; emit(T.spray ? EV.LANCE_ON : EV.LANCE_OFF, {}); }
    if (o.shot) emit(EV.SHOT, { weapon: state.player.weapon });
    if (o.reload) emit(EV.RELOAD, { weapon: state.player.weapon, seconds: 1.2 });
    if (o.throw) emit(EV.BOMB_THROW, {});
    if (o.troll) trollForce = o.troll;
    if (o.trollDead) { state.troll.hp = 0; emit(EV.T_DEATH, {}); }
    if (o.motion != null) T.motion = !!o.motion;
    if (o.fire != null) { fireOn = !!o.fire; pools.forEach((m) => { m.visible = fireOn; }); }
    if (o.walk != null) T.walk = !!o.walk;
    if (o.autoFire != null) T.autoFire = !!o.autoFire;
    if (o.kills != null) T.kills = !!o.kills;
    if (o.mode) state.mode = o.mode;
    if (o.talk) emit(EV.NPC_LINE, { line: 'home' });
    if (o.airKill && state.air) { const b = state.air.find((q) => q.state !== 'dying'); if (b) { b.state = 'dying'; b.vy = 0; } }
    if (o.firing != null) state.player.firing = !!o.firing;
    if (o.pulse) for (const tw of state.run?.towers || []) if (tw.type === 'obelisk') emit(EV.OBELISK_PULSE, { pad: tw.pad, r: 4.5, level: tw.level });
  },
  step(n = 1, dt = 1 / 60) { for (let i = 0; i < n; i++) simStep(dt); },
  actors, state,
};
