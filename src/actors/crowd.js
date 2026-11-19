// VALLEYWARD · actors · the crowd: ONE instanced draw for the horde (state.horde typed arrays), the death pops (corpses
// that play the dying frames after a slot dies, independent of slot reuse), the Ash Troll and its red-hot glow layer,
// pickups (gold, heart; XP is credited on the kill), firebombs, spears and boulders. Everything shares the sprite atlas and the shader in
// spriteMaterial.js. No allocation in the frame loop.
import * as THREE from 'three';
import { ENEMY_KINDS } from '../shared/events.js';
import { ARENA, BODY, groundHeight } from '../shared/arena.js';
import { BURN } from '../shared/fireops.js';
import { createSpriteGeometry, createSpriteMaterial } from './spriteMaterial.js';
import { FIRELIGHT } from '../shared/firelight.js';
import { createTowerReader, padKey } from './towers.js';
import { TIMELINE } from '../shared/timeline.js';

const CORPSE_CAP = 384;
const NEAR_FIRE_GAIN = 0.8;   // FIRELIGHT.nearCamera → the near sprites' front fill
// pickups + bombs + spears + boulders + troll (base + glow) + Brother Cinder, 6 Chain Imp towers (perch + imp),
// their chains (links + hooks), thrown buckets and hex orbs
const CHAIN_CAP = 24, LINKS_MAX = 36, PROJ_CAP = 96, AIR_CAP = 64;
// DESIGN §12: the ending's crowds (one draw with the rest): the host marching out of the gate, the hunt in the valley
const HOST_N = 360, HUNT_PREY = 44, HUNT_CHASERS = 36, BIG_EXTRA = 8 + 2 + 2 + 2;   // + rams, the Rainmother (+ glow), the demon, Cinder   // AIR: DESIGN §5.5, ≤ 12 Bat Gremlins alive (headroom)
const EXTRA_CAP = 512 + 64 + 64 + 32 + 2 + 1 + 20 + CHAIN_CAP * (LINKS_MAX + 1) + PROJ_CAP + AIR_CAP + HOST_N + HUNT_PREY + HUNT_CHASERS + BIG_EXTRA;
const BEAT = Object.fromEntries((TIMELINE?.ending?.beats || []).map((b) => [b.id, b.at]));
const EB = { host: BEAT.host ?? 18, reveal: BEAT.reveal ?? 29, roar: BEAT.roar ?? 34, cinder: BEAT.cinder ?? 37, hunt: BEAT.hunt ?? 42, black: BEAT.black ?? 50 };
const STRIDE = { grunt: 0.9, imp: 0.75, spear: 0.95, brute: 1.25, chief: 1.15, hexer: 0.9, douser: 0.8 };  // metres per walk cycle (feet do not slide)
const ELITE = { chief: true, hexer: true };   // gold rim (class 2 in the shader); the name plate is the HUD's
/** One charm sprite, nine hues (shader class 3; fract = hue 0..1). */
const CHARM_HUE = { 'ember-tooth': 0.0, 'coin-hook': 0.13, 'ashen-step': 0.58, 'bellows-heart': 0.06, 'cinder-ward': 0.62,
  'soot-lens': 0.75, 'kindle-knot': 0.09, 'spark-bead': 0.5, 'witchfire-wick': 0.33 };
// the Chain Imp tower: size per level (levels add size; the perch art adds spikes) and where on the perch art its
// platform is (fraction of the perch frame's height; the L3 perch has skulls on spikes above the platform)
const IMP_SCALE = [1.45, 1.55, 1.65, 1.8, 1.95], PERCH_TOP = [0.96, 0.8, 0.62, 0.62, 0.62];   // L4–5 reuse the L3 perch art, bigger
// at the camp (near-black at dusk without it): a bigger perch (L1 ≈ 2.2 m, L3 ≈ 3.8 m to the skulls), and the
// camp's dusk light on every sprite while state.mode === 'camp' (blended over 0.8 s; the night values stay the environment's/setLighting's)
const PERCH_SCALE = [2.0, 2.15, 2.3, 2.75, 3.2];
const CAMP_LIGHT = { ambient: [0.42, 0.33, 0.29], moon: [0.62, 0.4, 0.22], floor: [0.56, 0.46, 0.4] };   // linear, warm dusk
const CINDER = { scale: 1.07, forward: 1.0, hue: 0.04, emis: 0.12 };   // ≈ 1.5 m, 1 m out of the awning's shadow, dark umber, lantern-lit
const IMP_HUE = 0.0;   // dark brick red
const CHAIN_HOLD = 0.75;   // seconds a hooked chain stays taut on its goblin (the pull), then 0.2 s to reel in
const hash = (i) => { let x = (i * 2654435761) >>> 0; x ^= x >>> 15; x = Math.imul(x, 2246822519) >>> 0; x ^= x >>> 13; return (x >>> 0) / 4294967296; };

/**
 * @param {{ atlas: any, scene: THREE.Scene, camera: THREE.Camera, cap: number }} o
 */
export function createCrowd({ atlas, scene, camera, cap }) {
  const { json } = atlas;
  const K = json.kinds;
  const kindRec = ENEMY_KINDS.map((k) => K[k]);
  // a kind without its own sheet (stand-in atlas, a failed roll) draws the grunt's frames at its BODY height
  const kindScale = ENEMY_KINDS.map((k) => (K[k] ? 1 : (BODY[k] ? BODY[k].height / BODY.grunt.height : 1)));
  const kindClass = ENEMY_KINDS.map((k) => (ELITE[k] ? 2 : 1));
  const HEXER = ENEMY_KINDS.indexOf('hexer');
  const readTowers = createTowerReader();
  const max = cap + CORPSE_CAP + EXTRA_CAP;
  const geo = createSpriteGeometry(max);
  const mat = createSpriteMaterial({ atlas: atlas.texture, frameTex: atlas.frameTex, width: json.width, height: json.height });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'actors.crowd';
  mesh.frustumCulled = false;
  mesh.renderOrder = 0;
  scene.add(mesh);
  const P = geo.attributes.iPos.array, A = geo.attributes.iA.array, B = geo.attributes.iB.array;
  // the night light (the environment / actors.setLighting write here); the camp's dusk light is blended over it in update()
  const night = { ambient: mat.uniforms.uAmbient.value.clone(), moon: mat.uniforms.uMoon.value.clone(), floor: mat.uniforms.uFloor.value.clone() };
  let campK = 0;

  // per-slot memory (sized to the cap; state.horde may be bigger only if the sim raises its cap)
  let slots = cap;
  let prevState = new Uint8Array(slots), stT = new Float32Array(slots), phase = new Float32Array(slots);
  let lastCorpseAt = new Float32Array(slots).fill(-1e9);
  let flash = new Float32Array(slots), lastX = new Float32Array(slots), lastZ = new Float32Array(slots), flipS = new Int8Array(slots);
  let actT = new Float32Array(slots).fill(9);   // a Douser's throw / a Hexer's cast, from the events
  // DESIGN §15.4 (≥ 6,000 alive): per-slot constants hashed once, not per instance per frame
  let scV = new Float32Array(slots), tnV = new Float32Array(slots), hbV = new Float32Array(slots);
  const fillConst = (a, b) => { for (let i = a; i < b; i++) { scV[i] = 0.92 + hash(i + 101) * 0.16; tnV[i] = hash(i + 53) * 0.999; hbV[i] = hash(i) * 2; } };
  const grow = (n) => {
    const g = (a, C) => { const b = new C(n); b.set(a.subarray(0, Math.min(a.length, n))); return b; };
    prevState = g(prevState, Uint8Array); stT = g(stT, Float32Array); phase = g(phase, Float32Array); flash = g(flash, Float32Array);
    lastX = g(lastX, Float32Array); lastZ = g(lastZ, Float32Array); flipS = g(flipS, Int8Array);
    const at = new Float32Array(n).fill(9); at.set(actT.subarray(0, Math.min(actT.length, n))); actT = at;
    const old = scV.length; scV = g(scV, Float32Array); tnV = g(tnV, Float32Array); hbV = g(hbV, Float32Array); fillConst(old, n);
    const lc = new Float32Array(n).fill(-1e9); lc.set(lastCorpseAt.subarray(0, Math.min(lastCorpseAt.length, n))); lastCorpseAt = lc; slots = n;
  };
  for (let i = 0; i < slots; i++) { phase[i] = hash(i) * 4; flipS[i] = hash(i + 7919) > 0.5 ? 1 : -1; }
  fillConst(0, slots);
  const strideK = new Float32Array(ENEMY_KINDS.length).map((_, k) => 1 / (STRIDE[ENEMY_KINDS[k]] || 0.9));

  // corpses (death pops)
  const C = { n: 0, x: new Float32Array(CORPSE_CAP), y: new Float32Array(CORPSE_CAP), z: new Float32Array(CORPSE_CAP),
    kind: new Uint8Array(CORPSE_CAP), t: new Float32Array(CORPSE_CAP), burned: new Uint8Array(CORPSE_CAP),
    flip: new Int8Array(CORPSE_CAP), seed: new Float32Array(CORPSE_CAP) };
  let now = 0, lastCount = 0;
  const addCorpse = (x, y, z, kind, burned, seed, flip) => {
    let j = C.n;
    if (j >= CORPSE_CAP) { // reuse the oldest
      let o = 0; for (let k = 1; k < CORPSE_CAP; k++) if (C.t[k] > C.t[o]) o = k; j = o;
    } else C.n++;
    C.x[j] = x; C.y[j] = y; C.z[j] = z; C.kind[j] = kind; C.t[j] = 0; C.burned[j] = burned ? 1 : 0; C.seed[j] = seed; C.flip[j] = flip;
  };
  // a corpse plays its 3 death frames, then sinks into a low dark ash smudge (shrinks to ≈ 45 %,
  // darkens) and dithers away by 1.8 s; within 6 m of the camera it is gone by ≈ 1 s, so piles never wall off the lens
  const CORPSE_LIFE = 1.8, DIE_FPS = json.fps?.death || 12, CORPSE_NEAR = 6;

  // thrown buckets and hex orbs (from the events, unless the sim keeps them in state.buckets / state.hexes),
  // the Chain Imps' chains, the imps' throw clocks, Brother Cinder's talk
  const PR = { n: 0, kind: new Uint8Array(PROJ_CAP), fx: new Float32Array(PROJ_CAP), fy: new Float32Array(PROJ_CAP), fz: new Float32Array(PROJ_CAP),
    tx: new Float32Array(PROJ_CAP), ty: new Float32Array(PROJ_CAP), tz: new Float32Array(PROJ_CAP), t: new Float32Array(PROJ_CAP), fl: new Float32Array(PROJ_CAP) };
  const addProj = (kind, from, to, flight) => {
    if (!from || !to) return;
    const j = PR.n < PROJ_CAP ? PR.n++ : 0;
    const d = Math.hypot(to.x - from.x, to.z - from.z);
    PR.kind[j] = kind; PR.t[j] = 0;
    PR.fx[j] = from.x; PR.fz[j] = from.z; PR.fy[j] = from.y ?? groundHeight(from.x, from.z) + 1.0;
    PR.tx[j] = to.x; PR.tz[j] = to.z; PR.ty[j] = to.y ?? groundHeight(to.x, to.z);
    PR.fl[j] = flight > 0 ? flight : kind === 0 ? Math.min(1.2, Math.max(0.45, d / 10)) : Math.min(1.4, Math.max(0.25, d / 16));
  };
  const CH = [];   // { key, tx, ty, tz, id, t, flight, hookT, endT }
  const impT = new Map();   // tower key → seconds since its last throw
  const NPC = { open: false, talkT: 0 };
  const airDie = new Map();   // Bat Gremlin id → seconds since it started dying (its tumbling-fall frames)
  const ramMem = new Map();   // ram id → { x, z, phase }
  let endOverride = null;     // actors.ending.set(t): drive the ending's crowds without the sim (the actors and pres benches)
  const isCamp = (st) => st?.mode === 'camp' || st?.camp?.active === true;
  const nearestKind = (h, kind, p) => {
    if (!h || !p) return -1;
    let bi = -1, bd = 36;
    const n = Math.min(h.count, h.x.length);
    for (let i = 0; i < n; i++) {
      if (h.kind[i] !== kind || h.state[i] === 0 || h.state[i] === 4) continue;
      const d = (h.x[i] - p.x) ** 2 + (h.z[i] - p.z) ** 2;
      if (d < bd) { bd = d; bi = i; }
    }
    return bi;
  };

  // troll memory
  const T = { deathT: -1, flash: 0, lastX: 0, lastZ: 0, phase: 0, flip: 1, seen: false, actionKey: '', actionT: 0 };

  const camRight = new THREE.Vector3(), tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3();
  const fps = json.fps || { walk: 8, attack: 5, burn: 10, death: 12 };

  /** write instance n */
  const put = (n, x, y, z, scale, frame, burn, fl, flipV, rot, emis, diss, char) => {
    if (n >= max) return; // never past the instance buffers (a sim cap above ours just drops the overflow)
    const o = n * 4;
    P[o] = x; P[o + 1] = y; P[o + 2] = z; P[o + 3] = scale;
    A[o] = frame; A[o + 1] = burn; A[o + 2] = fl; A[o + 3] = flipV;
    B[o] = rot; B[o + 1] = emis; B[o + 2] = diss; B[o + 3] = char;
  };

  function onEvent(ev, state) {
    switch (ev.type) {
      case 'enemy.hit': if (ev.id != null && ev.id < slots) flash[ev.id] = 1; break;
      case 'enemy.death': {
        const id = ev.id;
        if (id == null || id >= slots) break;
        if (now - lastCorpseAt[id] < 0.25) break;
        lastCorpseAt[id] = now;
        const h = state?.horde;
        const kind = ev.kind != null ? Math.max(0, ENEMY_KINDS.indexOf(ev.kind)) : (h ? h.kind[id] : 0);
        const p = ev.pos || (h ? { x: h.x[id], y: h.y[id], z: h.z[id] } : null);
        if (p) addCorpse(p.x, p.y ?? 0, p.z, kind, !!ev.burned || (h && h.burn[id] > 0), hash(id + 31), flipS[id] || 1);
        break;
      }
      case 'troll.hurt': T.flash = 1; break;
      case 'troll.death': T.deathT = 0; break;
      case 'douser.throw': {   // at the throw; the water flies in state.splashes
        if (ev.id != null && ev.id < slots) actT[ev.id] = 0;
        if (!Array.isArray(state?.splashes ?? state?.buckets)) addProj(0, ev.from, ev.to, ev.flight);
        break;
      }
      case 'hexer.hex': {      // at the landing (the bolt flew in state.hexes; its cast pose came from there)
        if (Array.isArray(state?.hexes)) break;
        const id = ev.id != null ? ev.id : nearestKind(state?.horde, HEXER, ev.from);
        if (id >= 0 && id < slots) actT[id] = 0;
        addProj(1, ev.from, ev.to, ev.flight);
        break;
      }
      case 'chain.throw': {
        const key = padKey(ev.pad);
        impT.set(key, 0);
        if (CH.length >= CHAIN_CAP) CH.shift();
        const to = ev.to || (ev.targetId != null && state?.horde ? { x: state.horde.x[ev.targetId], y: state.horde.y[ev.targetId], z: state.horde.z[ev.targetId] } : null);
        if (to) CH.push({ key, tx: to.x, ty: (to.y ?? groundHeight(to.x, to.z)) + 0.6, tz: to.z, id: ev.targetId ?? -1, t: 0,
          flight: ev.flight > 0 ? ev.flight : 0.22, hookT: -1, endT: -1 });
        break;
      }
      case 'chain.hook': {
        const key = padKey(ev.pad);
        for (let j = CH.length - 1; j >= 0; j--) {
          const c = CH[j];
          if (c.key === key && c.hookT < 0 && (ev.targetId == null || c.id === ev.targetId || c.id < 0)) {
            c.hookT = 0; if (ev.targetId != null) c.id = ev.targetId;
            if (ev.pos) { c.tx = ev.pos.x; c.tz = ev.pos.z; c.ty = (ev.pos.y ?? groundHeight(ev.pos.x, ev.pos.z)) + 0.6; }
            break;
          }
        }
        break;
      }
      case 'npc.open': NPC.open = true; NPC.talkT = 2.4; break;
      case 'npc.close': NPC.open = false; NPC.talkT = Math.min(NPC.talkT, 0.6); break;
      case 'npc.line': NPC.talkT = 2.8; break;
      case 'run.start': CH.length = 0; PR.n = 0; impT.clear(); break;
      case 'retry': C.n = 0; T.deathT = -1; T.seen = false; prevState.fill(0); flash.fill(0); CH.length = 0; PR.n = 0; break;
      default: break;
    }
  }

  function update(dt, state) {
    now += dt;
    mat.uniforms.uTime.value = now;
    campK += ((isCamp(state) ? 1 : 0) - campK) * Math.min(1, dt / 0.8);
    { const u = mat.uniforms, k = campK;
      u.uAmbient.value.setRGB(night.ambient.r + (CAMP_LIGHT.ambient[0] - night.ambient.r) * k, night.ambient.g + (CAMP_LIGHT.ambient[1] - night.ambient.g) * k, night.ambient.b + (CAMP_LIGHT.ambient[2] - night.ambient.b) * k);
      u.uMoon.value.setRGB(night.moon.r + (CAMP_LIGHT.moon[0] - night.moon.r) * k, night.moon.g + (CAMP_LIGHT.moon[1] - night.moon.g) * k, night.moon.b + (CAMP_LIGHT.moon[2] - night.moon.b) * k);
      u.uFloor.value.setRGB(night.floor.r + (CAMP_LIGHT.floor[0] - night.floor.r) * k, night.floor.g + (CAMP_LIGHT.floor[1] - night.floor.g) * k, night.floor.b + (CAMP_LIGHT.floor[2] - night.floor.b) * k); }
    // the fire around the player as a front fill for the sprites near the camera (the fire code writes nearCamera every frame)
    const nc = FIRELIGHT.nearCamera;
    mat.uniforms.uNearFire.value.setRGB(nc.r * NEAR_FIRE_GAIN, nc.g * NEAR_FIRE_GAIN, nc.b * NEAR_FIRE_GAIN);
    camera.updateMatrixWorld();
    camRight.setFromMatrixColumn(camera.matrixWorld, 0); camRight.y = 0; camRight.normalize();
    let n = 0;
    const h = state?.horde;
    // ---------------------------------------------------------------- the horde
    if (h && h.count > 0) {
      const count = Math.min(h.count, h.x.length);
      if (count > slots) grow(count);
      // a reset (retry, a new night) shrinks the slot range: forget the old states so no corpse flood appears
      if (count < lastCount - 32) prevState.fill(0);
      lastCount = count;
      const hx = h.x, hy = h.y, hz = h.z, hk = h.kind, hs = h.state, hb = h.burn, hvx = h.vx, hvz = h.vz;
      const flashDecay = Math.exp(-dt * 14);
      for (let i = 0; i < count; i++) {
        const s = hs[i];
        const ps = prevState[i];
        if (s !== ps) {
          if ((ps === 1 || ps === 2 || ps === 3) && (s === 4 || (s === 0 && h.hp[i] <= 0)) && now - lastCorpseAt[i] >= 0.25) {
            lastCorpseAt[i] = now;
            addCorpse(hx[i], hy[i], hz[i], hk[i], hb[i] > 0, hash(i + 31), flipS[i] || 1);
          }
          if (s === 1 && (ps === 0 || ps === 4)) { phase[i] = hash(i + now) * 4; flash[i] = 0; flipS[i] = hash(i * 3 + now) > 0.5 ? 1 : -1; }
          prevState[i] = s; stT[i] = 0;
        } else stT[i] += dt;
        if (s === 0 || s === 4) continue;
        const x = hx[i], z = hz[i];
        const kind = hk[i];
        const rec = kindRec[kind] || kindRec[0];
        // speed: from the sim's velocity if it gives one, else from the position delta
        let vx = hvx ? hvx[i] : (x - lastX[i]) / Math.max(dt, 1e-3), vz = hvz ? hvz[i] : (z - lastZ[i]) / Math.max(dt, 1e-3);
        if (!hvx && (Math.abs(vx) > 30 || Math.abs(vz) > 30)) { vx = 0; vz = 0; }
        lastX[i] = x; lastZ[i] = z;
        const sp = Math.sqrt(vx * vx + vz * vz);
        const lat = vx * camRight.x + vz * camRight.z;
        if (Math.abs(lat) > sp * 0.7 && sp > 0.3) flipS[i] = lat > 0 ? 1 : -1;
        const burning = hb && hb[i] > 0;
        let frame;
        if (actT[i] < 1) actT[i] += dt;
        if (burning) {
          frame = rec.burn[((now * fps.burn + hbV[i]) | 0) & 1];
          phase[i] += dt * sp * strideK[kind];
        } else if (actT[i] < 0.5) {   // a Douser's throw / a Hexer's cast (events): windup, then release
          frame = rec.attack[actT[i] < 0.22 ? 0 : 1];
        } else if (s === 2) {
          frame = rec.attack[Math.min(1, ((stT[i] * fps.attack) | 0) % 2)];
        } else {
          phase[i] += dt * Math.max(sp * strideK[kind], s === 3 ? 2.2 : 0.0);
          frame = rec.walk[((phase[i] * 4) | 0) & 3];
        }
        flash[i] *= flashDecay;
        const burnAmt = burning ? Math.min(1, hb[i] / 0.6) : 0;
        const sc = scV[i] * kindScale[kind];
        put(n++, x, hy[i], z, sc, frame, burnAmt, flash[i] > 0.02 ? flash[i] : 0, flipS[i] * (kindClass[kind] + tnV[i]), 0, burning ? 0.25 : 0, 0, 0);
      }
    }
    // ---------------------------------------------------------------- corpses (death pops)
    const cx = camera.matrixWorld.elements[12], cz = camera.matrixWorld.elements[14];
    for (let j = 0; j < C.n; j++) {
      C.t[j] += dt;
      const t = C.t[j];
      if (t > CORPSE_LIFE) { // swap-remove
        const last = --C.n;
        if (j !== last) { C.x[j] = C.x[last]; C.y[j] = C.y[last]; C.z[j] = C.z[last]; C.kind[j] = C.kind[last]; C.t[j] = C.t[last]; C.burned[j] = C.burned[last]; C.seed[j] = C.seed[last]; C.flip[j] = C.flip[last]; j--; }
        continue;
      }
      const rec = kindRec[C.kind[j]] || kindRec[0];
      const ksc = kindScale[C.kind[j]] || 1;
      const fi = Math.min(2, (t * DIE_FPS) | 0);
      const pop = t < 0.18 ? 1 + 0.22 * Math.sin((t / 0.18) * Math.PI) : 1;
      const hop = t < 0.25 ? 0.18 * Math.sin((t / 0.25) * Math.PI) : 0;
      const near = Math.hypot(C.x[j] - cx, C.z[j] - cz) < CORPSE_NEAR;
      const d0 = near ? 0.35 : 0.7, d1 = near ? 1.0 : CORPSE_LIFE;
      const diss = t > d0 ? Math.min(1, (t - d0) / (d1 - d0)) : 0;
      if (diss >= 1) continue;
      const sink = t > 0.3 ? Math.min(1, (t - 0.3) / 0.9) : 0;
      const shrink = 1 - 0.55 * sink * sink * (3 - 2 * sink);
      const burned = C.burned[j];
      const ash = burned ? Math.min(1, t * 2.5) : Math.min(0.8, sink * 0.8);
      put(n++, C.x[j], C.y[j] + hop, C.z[j], (0.92 + C.seed[j] * 0.16) * pop * shrink * ksc, rec.death[fi], burned && t < 0.5 ? 1 - t * 2 : 0, t < 0.06 ? 1 : 0,
        C.flip[j] * (1 + C.seed[j] * 0.999), 0, 0, diss, ash);
    }
    // ---------------------------------------------------------------- the Ash Troll
    const tr = state?.troll;
    if (tr && K.troll) {
      const R = K.troll;
      const dead = tr.hp <= 0 || tr.alive === false || tr.action === 'dying' || tr.action === 'dead' || tr.action === 'death';
      if (dead && T.deathT < 0) T.deathT = 0;
      if (!dead && T.deathT >= 0 && tr.hp > 0) T.deathT = -1;
      if (T.deathT >= 0) T.deathT += dt;
      if (!T.seen) { T.lastX = tr.x; T.lastZ = tr.z; T.seen = true; }
      const vx = (tr.x - T.lastX) / Math.max(dt, 1e-3), vz = (tr.z - T.lastZ) / Math.max(dt, 1e-3);
      T.lastX = tr.x; T.lastZ = tr.z;
      const sp = Math.min(6, Math.hypot(vx, vz));
      const lat = vx * camRight.x + vz * camRight.z;
      if (Math.abs(lat) > sp * 0.6 && sp > 0.4) T.flip = lat > 0 ? 1 : -1;
      let frame;
      const act = tr.action;
      const key = `${act}|${tr.stage}`;
      if (key !== T.actionKey) { T.actionKey = key; T.actionT = 0; } else T.actionT += dt;
      if (T.deathT >= 0) frame = R.death[Math.min(2, (T.deathT * 4) | 0)];
      else if (act === 'smash' || act === 'throw' || act === 'stomp') {
        const windup = tr.stage === 'windup' || tr.stage === 0 || (tr.stage == null && tr.actionDur && tr.actionT < tr.actionDur * 0.7);
        frame = R[act][windup ? 0 : 1];
      } else {
        T.phase += dt * Math.max(sp / 2.6, 0.12);
        frame = R.walk[((T.phase * 4) | 0) & 3];
      }
      T.flash *= Math.exp(-dt * 16);
      const scale = 1;
      // heat: the ash hide multiplies toward ember red (negative burn), and a hit flashes ember-orange while it glows
      // (negative flash) and only faintly white otherwise: a 7 m sprite under gunfire must not wash out
      const heat = Math.max(0, Math.min(1, tr.heat || 0));
      const glow = T.deathT < 0 ? (tr.glowing ? 1 : heat) : 0;
      const hide = tr.glowing ? 0.85 + 0.15 * Math.sin(now * 9) : heat * 0.45;
      const fl = T.flash > 0.03 ? (tr.glowing ? -T.flash * 0.45 : T.flash * 0.35) : 0;
      put(n++, tr.x, tr.y ?? 0, tr.z, -scale, frame, T.deathT < 0 ? -hide : 0, fl, T.flip * 1.5, 0, 0, 0, T.deathT > 0 ? Math.min(0.5, T.deathT * 0.2) : 0);
      // red-hot crack layer: the dark seams light up pixel by pixel with heat (crimson → ember → orange); full and
      // pulsing while glowing
      const gframe = R.glow?.[frame];
      if (gframe != null && glow > 0.02) {
        tmp.set(camera.position.x - tr.x, 0, camera.position.z - tr.z).normalize().multiplyScalar(0.08);
        const pulse = tr.glowing ? 1.7 + 0.45 * Math.sin(now * 9) : 0.7 + 0.9 * heat;
        put(n++, tr.x + tmp.x, (tr.y ?? 0), tr.z + tmp.z, -scale, gframe, 0, 0, T.flip * 1.5, 0, pulse, 1 - glow, -1);
      }
    }
    // ---------------------------------------------------------------- pickups and projectiles
    const I = K.items;
    if (I) {
      const pk = state?.pickups;
      if (pk) for (let j = 0; j < pk.length && n < max; j++) {
        const p = pk[j];
        // DESIGN §9.3: XP drops again as a small ember gem; gold coins; hearts; an elite's charm (one sprite, a hue per charm)
        const k = p.kind, seed = (p.id || j) * 1.7;
        let fr, em, cls = 1.2, sc = 1;
        if (k === 'gold' || k === 'coin') { fr = I.coin; em = 0.25; }
        else if (k === 'heart') { fr = I.heart; em = 0.3; }
        else if (k === 'xp' || k === 'gem' || k === 'ember') { fr = I.ember ?? I.gem; em = 0.85 + 0.25 * Math.sin(now * 7 + seed); }
        else if (k === 'charm') {
          fr = I.charm ?? I.gem; sc = 1.25;
          em = 0.3 + 0.9 * Math.pow(Math.max(0, Math.sin(now * 3.1 + seed)), 12);   // a glint
          cls = 3 + Math.min(0.999, CHARM_HUE[p.charm] ?? 0.13);
        } else continue;
        if (fr == null) continue;
        const bob = (k === 'charm' ? 0.42 : 0.28) + 0.07 * Math.sin(now * 4 + seed);
        put(n++, p.x, Math.max(p.y || 0, groundHeight(p.x, p.z)) + bob, p.z, sc, fr, 0, 0, cls, 0, em, 0, 0);
      }
      const bombs = state?.bombs;
      if (bombs) for (let j = 0; j < bombs.length && n < max; j++) {
        const b = bombs[j];
        put(n++, b.x, b.y, b.z, 1, I.firebomb, 0, 0, 1.3, now * 9 + (b.id || j), 0.2, 0, 0);
      }
      const spears = state?.spears;
      if (spears) for (let j = 0; j < spears.length && n < max; j++) {
        const s = spears[j];
        // align the horizontal spear sprite with its velocity as seen on screen
        tmp.set(s.x, s.y, s.z).project(camera);
        tmp2.set(s.x + (s.vx || 0) * 0.05, s.y + (s.vy || 0) * 0.05, s.z + (s.vz || 0) * 0.05).project(camera);
        const rot = Math.atan2(tmp2.y - tmp.y, (tmp2.x - tmp.x) * (camera.aspect || 1));
        put(n++, s.x, s.y, s.z, 1, I.spear, 0, 0, 1.4, rot, 0, 0, 0);
      }
      const boulders = state?.boulders;
      if (boulders) for (let j = 0; j < boulders.length && n < max; j++) {
        const b = boulders[j];
        put(n++, b.x, b.y, b.z, 1, I.boulder, 0, 0, 1.5, -now * 3 - j, 0, 0, 0);
      }
      // ---------------------------------------------------------------- buckets and hex orbs
      const fBucket = I.bucket ?? I.firebomb, fHex = I.hex ?? I.gem;
      const sb = state?.splashes ?? state?.buckets, sh = state?.hexes;
      // a new hex bolt (t ≈ 0) plays its Hexer's cast pose (the sim emits EV.HEX only at the landing)
      if (Array.isArray(sh)) for (let j = 0; j < sh.length; j++) {
        const b = sh[j];
        if ((b.t ?? 1) <= dt * 1.5 && b.fx != null) { const id = nearestKind(h, HEXER, { x: b.fx, z: b.fz }); if (id >= 0 && id < slots) actT[id] = 0.18; }
      }
      if (Array.isArray(sb)) for (let j = 0; j < sb.length && n < max; j++) put(n++, sb[j].x, sb[j].y, sb[j].z, 1, fBucket, 0, 0, 1.3, now * 7 + j, 0.05, 0, 0);
      if (Array.isArray(sh)) for (let j = 0; j < sh.length && n < max; j++) put(n++, sh[j].x, sh[j].y, sh[j].z, 1 + 0.12 * Math.sin(now * 20 + j), fHex, 0, 0, 1.4, now * 4, 1.6, 0, 0);
      for (let j = 0; j < PR.n; j++) {
        PR.t[j] += dt;
        const u = PR.t[j] / PR.fl[j];
        if (u >= 1) { const l = --PR.n; if (j !== l) { for (const a of [PR.kind, PR.fx, PR.fy, PR.fz, PR.tx, PR.ty, PR.tz, PR.t, PR.fl]) a[j] = a[l]; j--; } continue; }
        if (n >= max) continue;
        const d = Math.hypot(PR.tx[j] - PR.fx[j], PR.tz[j] - PR.fz[j]);
        const arc = (PR.kind[j] === 0 ? 1.2 + d * 0.22 : 0.4 + d * 0.04) * 4 * u * (1 - u);
        const x = PR.fx[j] + (PR.tx[j] - PR.fx[j]) * u, z = PR.fz[j] + (PR.tz[j] - PR.fz[j]) * u;
        const y = PR.fy[j] + (PR.ty[j] - PR.fy[j]) * u + arc;
        if (PR.kind[j] === 0) put(n++, x, y, z, 1, fBucket, 0, 0, 1.3, -now * 8 - j, 0.05, 0, 0);
        else put(n++, x, y + 0.08 * Math.sin(now * 17 + j), z, 1 + 0.12 * Math.sin(now * 20 + j), fHex, 0, 0, 1.4, now * 4, 1.6, 0, 0);
      }
    }
    // ---------------------------------------------------------------- Chain Imp towers and their chains
    const CI = K.chainimp;
    const towers = readTowers(state);
    const impTop = (t) => { const L = t.level - 1; return t.y + (CI ? CI.perchTop[Math.min(L, CI.perchTop.length - 1)] * PERCH_TOP[L] : 1.0) * PERCH_SCALE[L]; };
    for (const [k, v] of impT) impT.set(k, v + dt);
    if (CI) for (const t of towers) {
      if (t.type !== 'chainimp' || n + 2 > max) continue;
      const L = t.level - 1, s = IMP_SCALE[L];
      put(n++, t.x, t.y, t.z, -PERCH_SCALE[L], CI.perch[Math.min(L, CI.perch.length - 1)], 0, 0, 1.0 + (L * 0.1), 0, 0.3, 0, 0);   // towers: no screen cap (scale < 0)
      const tt = impT.has(t.key) ? impT.get(t.key) : 9;
      let pulling = (impT.get(`${t.key}#pull`) ?? 9) < 0.1;
      for (const c of CH) if (c.key === t.key && c.hookT >= 0 && c.endT < 0) pulling = true;
      const fr = tt < 0.14 ? CI.throw[0] : tt < 0.4 ? CI.throw[1] : pulling ? CI.throw[2] : CI.idle[((now * 2 + t.x) | 0) & 1];
      // the imp sits a touch in front of the post (toward the camera) so the post never cuts through it
      tmp.set(camera.position.x - t.x, 0, camera.position.z - t.z).normalize().multiplyScalar(0.06);
      put(n++, t.x + tmp.x, impTop(t) - 0.04 * s, t.z + tmp.z, -s, fr, 0, 0, 4 + IMP_HUE, 0, 0.18, 0, 0);   // class 4: brick red, eyes glow
      if (L >= 4 && n < max) {   // DESIGN §9.6: a second imp at level 5, on the other side of the platform, a beat out of step
        const ox = -tmp.z * 9, oz = tmp.x * 9;   // ⟂ to the camera direction, ≈ 0.55 m
        const fr2 = tt < 0.3 ? CI.throw[Math.min(2, ((tt * 10) | 0) % 3)] : pulling ? CI.throw[2] : CI.idle[((now * 2 + t.x + 1) | 0) & 1];
        put(n++, t.x + tmp.x + ox, impTop(t) - 0.04 * s, t.z + tmp.z + oz, -s * 0.92, fr2, 0, 0, -(4 + IMP_HUE + 0.01), 0, 0.18, 0, 0);
      }
    }
    const fLink = I?.chain, fHook = I?.hook;
    const h2 = state?.horde;
    const drawChain = (ax, ay, az, ex, ey, ez) => {
      tmp.set(ax, ay, az).project(camera); tmp2.set(ex, ey, ez).project(camera);
      const rot = Math.atan2(tmp2.y - tmp.y, (tmp2.x - tmp.x) * (camera.aspect || 1));
      const len = Math.hypot(ex - ax, ey - ay, ez - az);
      const links = Math.min(LINKS_MAX, Math.ceil(len / 0.55));
      for (let k = 0; k < links && n < max; k++) {
        const f = (k + 0.5) / links;
        put(n++, ax + (ex - ax) * f, ay + (ey - ay) * f, az + (ez - az) * f, 1, fLink, 0, 0, 1.1, rot, 0.45, 0, 0);   // the chain catches light
      }
      if (n < max) put(n++, ex, ey, ez, 1, fHook, 0, 0, 1.1, rot, 0.5, 0, 0);
    };
    // the sim's state.chains = [{ pad, id, fx, fy, fz, tx, ty, tz, t, flight, hooked, hold }] (wins over the events)
    const stCh = state?.chains;
    if (Array.isArray(stCh)) {
      CH.length = 0;
      if (fLink != null && fHook != null) for (const c of stCh) {
        const key = padKey(c.pad);
        let tw = null;
        for (const t of towers) if (t.key === key) { tw = t; break; }
        const ax = tw ? tw.x : c.fx, az = tw ? tw.z : c.fz, ay = tw ? impTop(tw) + 0.45 * IMP_SCALE[tw.level - 1] : (c.fy ?? 2);
        if (ax == null || c.tx == null) continue;
        const u = c.hooked ? 1 : Math.min(1, (c.t || 0) / Math.max(0.05, c.flight || 0.25));
        const ty = (c.ty ?? groundHeight(c.tx, c.tz)) + (c.hooked ? 0.6 : 0.4);
        const ex = ax + (c.tx - ax) * u, ez = az + (c.tz - az) * u, ey = ay + (ty - ay) * u + (c.hooked ? 0 : 0.8 * 4 * u * (1 - u));
        drawChain(ax, ay, az, ex, ey, ez);
        if (c.t != null && c.t < dt * 1.5) impT.set(key, 0);   // the imp's throw pose
        if (c.hooked) impT.set(`${key}#pull`, 0);
      }
    }
    for (let j = 0; j < CH.length; j++) {
      const c = CH[j];
      c.t += dt;
      if (c.hookT >= 0) c.hookT += dt;
      if (c.endT < 0 && ((c.hookT >= 0 && c.hookT > CHAIN_HOLD) || (c.hookT < 0 && c.t > c.flight + 0.2))) c.endT = 0;
      if (c.endT >= 0) c.endT += dt;
      let tw = null;
      for (const t of towers) if (t.key === c.key) { tw = t; break; }
      if (!tw || c.endT > 0.2) { CH.splice(j--, 1); continue; }
      if (fLink == null || fHook == null) continue;
      // follow the hooked goblin while it is alive (the pull)
      if (c.hookT >= 0 && h2 && c.id >= 0 && c.id < h2.count && h2.state[c.id] >= 1 && h2.state[c.id] <= 3) {
        c.tx = h2.x[c.id]; c.ty = h2.y[c.id] + 0.6; c.tz = h2.z[c.id];
      }
      const ax = tw.x, ay = impTop(tw) + 0.45 * IMP_SCALE[tw.level - 1], az = tw.z;
      let u = c.hookT >= 0 ? 1 : Math.min(1, c.t / c.flight);
      if (c.endT >= 0) u *= 1 - c.endT / 0.2;
      const ex = ax + (c.tx - ax) * u, ez = az + (c.tz - az) * u;
      const ey = ay + (c.ty - ay) * u + (c.hookT < 0 ? 0.8 * 4 * u * (1 - u) : 0);
      drawChain(ax, ay, az, ex, ey, ez);
    }
    // ---------------------------------------------------------------- DESIGN §5.5: Bat Gremlins (state.air)
    // the sim's shape: an array of { id, x, y, z, vx, vy, vz, state|phase: 'fly'|'circle'|'dive'|'climb'|'dying', burn } or a
    // typed-array table like the horde ({ count, x, y, z, vx, vy, vz, state, burn }; state 2 dive, 4 dying, 0 free).
    const air = state?.air, BG = K.batgremlin;
    if (air && BG) {
      const arr = Array.isArray(air) ? air : null;
      const cnt = arr ? arr.length : Math.min(air.count | 0, air.x ? air.x.length : 0);
      for (let j = 0; j < cnt && n < max; j++) {
        let x, y, z, vx, vy, vz, st, burn, id;
        if (arr) {
          const a = arr[j]; if (!a) continue;
          st = a.state ?? a.phase ?? a.mode ?? (a.alive === false ? 'dying' : 'fly');
          if (st === 'dead' || st === 'gone') continue;
          x = a.x; y = a.y; z = a.z; vx = a.vx || 0; vy = a.vy || 0; vz = a.vz || 0; burn = a.burn || 0; id = a.id ?? j;
        } else {
          const sv = air.state ? air.state[j] : 1; if (sv === 0) continue;
          st = sv === 2 ? 'dive' : sv === 4 ? 'dying' : 'fly';
          x = air.x[j]; y = air.y[j]; z = air.z[j]; vx = air.vx ? air.vx[j] : 0; vy = air.vy ? air.vy[j] : 0; vz = air.vz ? air.vz[j] : 0; burn = air.burn ? air.burn[j] : 0; id = j;
        }
        const hv = hash(id * 13 + 7);
        let frame, rot = 0;
        const dying = st === 'dying' || st === 'fall' || st === 'crash';
        if (dying) {
          const t = (airDie.get(id) ?? 0) + dt; airDie.set(id, t);
          frame = y > groundHeight(x, z) + 0.6 ? BG.death[Math.min(1, (t * 6) | 0)] : BG.death[2];
          rot = y > groundHeight(x, z) + 0.6 ? t * 7 * (hv > 0.5 ? 1 : -1) : 0;   // tumbling
        } else {
          if (airDie.has(id)) airDie.delete(id);
          if (burn > 0) frame = BG.burn[((now * fps.burn + hv * 2) | 0) & 1];
          else if (st === 'screech') frame = BG.dive[0];   // the dive's telegraph, wings folding
          else if (st === 'dive' || (vy < -4 && st !== 'climb')) frame = BG.dive[((now * 8 + hv * 2) | 0) & 1];
          else frame = BG.fly[((now * 7 + hv * 4) | 0) & 3];
          // bank toward the heading: the screen-lateral part of its velocity tilts the glider (≤ 26°)
          if (st !== 'dive') { const lat = vx * camRight.x + vz * camRight.z; rot = Math.max(-0.45, Math.min(0.45, -lat * 0.06)); }
        }
        put(n++, x, y, z, 0.95 + hv * 0.1, frame, burn > 0 ? Math.min(1, burn / 0.6) : 0, 0, (hv > 0.5 ? 1 : -1) * (1 + hv * 0.999), rot, burn > 0 ? 0.25 : 0, 0, dying && y <= groundHeight(x, z) + 0.6 ? 0.4 : 0);
      }
      if (airDie.size > AIR_CAP * 2) airDie.clear();
    }
    // ---------------------------------------------------------------- DESIGN §5.6: Siege Rams (state.rams)
    const RM = K.ram, rams = state?.rams;
    if (RM && Array.isArray(rams)) for (let j = 0; j < rams.length && n < max; j++) {
      const r = rams[j]; if (!r) continue;
      let m = ramMem.get(r.id); if (!m) { m = { x: r.x, z: r.z, phase: hash(r.id ?? j) * 4 }; ramMem.set(r.id, m); }
      const vx = (r.x - m.x) / Math.max(dt, 1e-3), vz = (r.z - m.z) / Math.max(dt, 1e-3); m.x = r.x; m.z = r.z;
      const sp = Math.min(4, Math.sqrt(vx * vx + vz * vz));
      let fr;
      if (r.mode === 'fall' || r.hp <= 0) fr = RM.broken[Math.min(2, ((r.t || 0) * 2.5) | 0)];
      else if (r.mode === 'stall' || (r.burn > 0 && sp < 0.2)) fr = RM.burn[((now * 9) | 0) & 1];
      else if (r.mode === 'swing') fr = RM.swing[(r.t || 0) < 0.7 ? 0 : 1];
      else { m.phase += dt * Math.max(sp / 1.4, 0.15); fr = RM.walk[((m.phase * 4) | 0) & 3]; }
      const lat = vx * camRight.x + vz * camRight.z;
      const fl = Math.abs(lat) > 0.3 && lat < 0 ? -1 : 1;
      put(n++, r.x, r.y ?? groundHeight(r.x, r.z), r.z, 1, fr, r.burn > 0 ? Math.min(1, r.burn / 0.6) : 0, 0, fl * 1.3, 0, r.burn > 0 ? 0.2 : 0, 0, 0);
    }
    if (ramMem.size > 64) ramMem.clear();
    // ---------------------------------------------------------------- DESIGN §6.3: THE RAINMOTHER (state.boss)
    const RMo = K.rainmother, boss = state?.boss;
    // her cold light on the sprites around her (12 m), and the ground pool (bosslight.js, via index.js)
    const bossOn = !!(RMo && boss && boss.kind === 'rainmother' && boss.alive !== false && boss.mode !== 'dead');
    if (bossOn) mat.uniforms.uBossLight.value.set(boss.x, 0, boss.z, 12); else mat.uniforms.uBossLight.value.w = 0;
    if (RMo && boss && boss.kind === 'rainmother' && (boss.alive !== false || boss.mode === 'dead') && n + 2 <= max) {
      const t = boss.t || 0;
      let fr;
      if (boss.mode === 'dead' || boss.alive === false) fr = RMo.collapse[Math.min(2, ((boss.deathT ?? t) * 0.9) | 0)];
      else if (boss.mode === 'rise') fr = t < 2.6 ? RMo.rise[0] : t < 5.2 ? RMo.rise[1] : RMo.walk[0];   // the sim's 6 s rise
      else if (boss.mode === 'tide') fr = RMo.tide[t < 0.9 ? 0 : 1];
      else if (boss.mode === 'whirl') fr = RMo.whirl[t < 0.9 ? 0 : 1];
      else if (boss.mode === 'climb') fr = RMo.climb[((now * 1.2) | 0) & 1];
      else fr = RMo.walk[((now * 2.2) | 0) & 3];
      const lam = Array.isArray(boss.lanterns) && boss.lanterns.length ? boss.lanterns.filter((q) => q && q.alive !== false).length / boss.lanterns.length : 1;
      // during the rise the sim lifts y from 14 m under the river; the rise frames already show her coming out of the water, so
      // they stand on the surface instead
      const by = boss.mode === 'rise' ? groundHeight(boss.x, boss.z) : (boss.y ?? groundHeight(boss.x, boss.z));
      put(n++, boss.x, by, boss.z, -1, fr, 0, 0, 6 + Math.min(0.999, lam), 0, 0.08, 0, 0);   // class 6: lanterns × alive share
      // cracked (steaming, in fire): the darkest seams glow ember like the troll's red-hot layer
      const heat = Math.max(boss.cracked ? 1 : 0, Math.min(1, boss.heat || 0));
      const gf = RMo.glow?.[fr];
      if (gf != null && heat > 0.05 && boss.mode !== 'dead') {
        tmp.set(camera.position.x - boss.x, 0, camera.position.z - boss.z).normalize().multiplyScalar(0.12);
        put(n++, boss.x + tmp.x, by, boss.z + tmp.z, -1, gf, 0, 0, 1.5, 0, (boss.cracked ? 1.6 + 0.4 * Math.sin(now * 8) : 0.7) * heat, 1 - heat, -1);
      }
    }
    // ---------------------------------------------------------------- DESIGN §12: the ending (host, demon, Cinder, hunt)
    const endT = endOverride != null ? endOverride : state?.mode === 'ending' ? (state.ending?.t ?? state.modeT ?? null) : null;
    if (endT != null && endT < EB.black) {
      const HO = K.host;
      // the rim source (shader class 5): the gate's fire behind the host until the hunt, then the burning village (below)
      if (endT < EB.hunt - 1) mat.uniforms.uRimSource.value.set(0, 3, 0.5);
      // the host: 30 ranks of 12 march out of the gate (x −2.4..2.4, z 0.6) and down the road and the slope at 1.7 m/s,
      // fanning out past the plaza; gone in the valley fog (z > 78)
      if (HO && endT >= EB.host) for (let k = 0; k < HOST_N && n < max; k++) {
        const c = k % 12, row = (k / 12) | 0;
        const s0 = (endT - EB.host - row * 0.42) * 1.7;
        if (s0 < 0) break;
        const hz = 0.6 + s0;
        if (hz > 78) continue;
        const fan = Math.max(0, s0 - 2.5);   // through the gate in a column, then the ranks open out over the plaza and slope
        const hx = -2.4 + c * 0.44 + (c - 5.5) * 0.13 * fan + Math.sin(k * 1.7 + s0 * 0.6) * 0.25;
        const fr = HO.march[((s0 / 1.1 * 4 + hash(k) * 4) | 0) & 3];
        // the in-game reveal showed the column as a black wall in front of the lens: within 4–9 m of the camera they dither out
        const cd = Math.hypot(hx - camera.position.x, hz - camera.position.z);
        const hd = cd < 9 ? 1 - Math.max(0, Math.min(1, (cd - 4) / 5)) : 0;
        if (hd >= 1) continue;
        put(n++, hx, groundHeight(hx, hz), hz, 0.94 + hash(k + 5) * 0.12, fr, 0, 0, (hash(k + 9) > 0.5 ? 1 : -1) * (5 + 0.45), 0, 0.05, hd, 0);
      }
      // the demon (the player revealed, ≈ 5.4 m) at the player's spot from the reveal: breathing, the head lift, the roar
      const DM = K.demon, pl = state?.player;
      if (DM && pl && endT >= EB.reveal && n < max) {
        const r0 = EB.roar;
        const fr = endT < r0 ? DM.idle[((endT * 1.1) | 0) & 1] : endT < r0 + 0.6 ? DM.lift[0] : endT < EB.cinder + 1.5 ? DM.roar[0] : DM.idle[((endT * 1.1) | 0) & 1];
        put(n++, pl.x, pl.y ?? 5, pl.z, fr === DM.roar[0] ? -1.06 : -1, fr, 0, 0, 7.0, 0, 0.12, 0, 0);   // class 7: unlit fire pixels + the portal rim
      }
      // Brother Cinder kneels at the foot of the wall below the player (state.ending.cinder when the sim gives one)
      const CK = K.cinderk || null, CN2 = K.cinder;
      if ((CK || CN2) && endT >= EB.cinder && n < max) {
        const cp = state?.ending?.cinder || (pl ? { x: pl.x, z: 1.8 } : { x: 0, z: 1.8 });
        const fr = CK ? CK.kneel[endT < EB.cinder + 1.2 ? 0 : 1] : CN2.idle[0];
        put(n++, cp.x, groundHeight(cp.x, cp.z), cp.z, -CINDER.scale, fr, 0, 0, 4 + CINDER.hue, 0, CINDER.emis, 0, 0);
      }
      // the hunt (from 1 s before the beat to the cut): villagers and animals flee the village away from the keep; horned
      // chasers follow at a slower pace, so the gap only grows: nobody is caught (DESIGN §12.7)
      const VI = K.villagers, AN = K.animals;
      if ((VI || AN) && HO && endT >= EB.hunt - 1) {
        const h = endT - (EB.hunt - 1);
        // the hunt happens at the one village (ARENA.village); they flee toward its `forest`, the host chases from
        // the slope side (behind them along the same line)
        const AV = ARENA.village, SV = state?.ending?.village;
        const V = AV ? { x: AV.x, z: AV.z } : SV || { x: 12, z: 108 };
        mat.uniforms.uRimSource.value.set(V.x, groundHeight(V.x, V.z) + 3, V.z);   // the rims face the burning village
        const F = AV?.forest || SV?.forest || { x: V.x - 26, z: V.z + 18 };
        let dx = F.x - V.x, dz = F.z - V.z; const dl = Math.hypot(dx, dz) || 1; dx /= dl; dz /= dl;   // toward the forest
        const px = -dz, pz = dx;                                                           // across
        for (let k = 0; k < HUNT_PREY && n < max; k++) {
          const kind = k < 24 ? 'v' : k < 30 ? 'deer' : k < 34 ? 'boar' : 'bird';
          const sp = kind === 'v' ? 3.1 + hash(k) * 0.5 : kind === 'deer' ? 5.0 : kind === 'boar' ? 4.0 : 7.5;
          // from the forest-side edge of the village (out of the densest fire haze, the glow behind them)
          // they start among and behind the huts (the cinema's lens stands 19 m out toward the forest and backs off at
          // 1 m/s), so families and animals run out of the fire and into the shot during 42–48 s; the animals, faster, start
          // further back
          const R0 = AV?.r ? AV.r : 10;
          const lat0 = (hash(k + 11) - 0.5) * R0 * 1.6, fwd0 = (kind === 'v' ? -0.75 + hash(k + 23) * 0.6 : -0.75 + hash(k + 23) * 0.25) * R0;
          const d = fwd0 + sp * h;
          const x = V.x + dx * d + px * (lat0 + Math.sin(h * 2 + k) * 0.6), z = V.z + dz * d + pz * (lat0 + Math.sin(h * 2 + k) * 0.6);
          let fr, y = groundHeight(x, z), sc = 1;
          if (kind === 'v') { const set = k % 3 === 0 ? VI?.mother : k % 3 === 1 ? VI?.elder : VI?.child; if (!set) continue; fr = set[((d / 0.9) | 0) % set.length]; }
          else if (kind === 'deer') { if (!AN) continue; fr = AN.deer[((d / 1.6) | 0) % 3]; }
          else if (kind === 'boar') { if (!AN) continue; fr = AN.boar[((d / 1.0) | 0) % 3]; sc = 0.75; }
          else { if (!AN) continue; fr = AN.bird[((h * 8 + k) | 0) & 1]; y += 3 + hash(k + 3) * 4; sc = 0.35; }
          const lat = dx * camRight.x + dz * camRight.z;
          // dark silhouettes (fract 0.12) with a firelit rim (emissive 0.16 flags the rim), ×2.7
          // runners that pass by the lens dither out within 4–8 m (they are exempt from the melee screen cap)
          const pd = Math.hypot(x - camera.position.x, y - camera.position.y, z - camera.position.z);
          const pdis = pd < 12 ? 1 - Math.max(0, (pd - 6) / 6) : 0;
          if (pdis >= 1) continue;
          put(n++, x, y, z, -sc * 1.7, fr, 0, 0, (lat < 0 ? -1 : 1) * (5 + 0.12), 0, 0.18, pdis, 0);   // 0.18: the hunt's prey (shader class 5)
        }
        for (let k = 0; k < HUNT_CHASERS && n < max; k++) {
          const lat0 = (hash(k + 71) - 0.5) * 34, d = -16 - hash(k + 5) * 8 + 2.9 * h;   // ≥ 5.5 m behind the last prey, slower   // behind the prey (through the burning huts), slower
          const x = V.x + dx * d + px * lat0, z = V.z + dz * d + pz * lat0;
          const lat = dx * camRight.x + dz * camRight.z;
          const cy = groundHeight(x, z), cd2 = Math.hypot(x - camera.position.x, cy - camera.position.y, z - camera.position.z);
          const cdis = cd2 < 12 ? 1 - Math.max(0, (cd2 - 6) / 6) : 0;
          if (cdis >= 1) continue;
          put(n++, x, cy, z, -(0.95 + hash(k) * 0.1) * 1.6, HO.run[((d / 0.8 + k) | 0) & 3], 0, 0, (lat < 0 ? -1 : 1) * (5 + 0.05), 0, 0.14, cdis, 0);   // 0.14: a chaser (near-black, rim, ember eyes)
        }
      }
    }
    // ---------------------------------------------------------------- Brother Cinder at his stall (the camp)
    const CN = K.cinder;
    if (CN && isCamp(state) && n < max) {
      NPC.talkT = Math.max(0, NPC.talkT - dt);
      const open = NPC.open || state?.camp?.panel === 'npc';
      const talking = NPC.talkT > 0 || (open && ((now % 5) < 3.2));
      const IDLE = [0, 1, 0, 1, 0, 3, 2, 0];
      const fr = talking ? CN.talk[((now * 2.6) | 0) & 1] : CN.idle[IDLE[((now * 2.2) | 0) % IDLE.length]];
      const np = ARENA.camp.npc;
      const cx = np.x + Math.sin(np.yaw) * CINDER.forward, cz = np.z + Math.cos(np.yaw) * CINDER.forward;
      put(n++, cx, groundHeight(cx, cz), cz, -CINDER.scale, fr, 0, 0, 4 + CINDER.hue, 0, CINDER.emis, 0, 0);   // class 4, no screen cap
    }
    n = Math.min(n, max);
    geo.instanceCount = n;
    for (const a of [geo.attributes.iPos, geo.attributes.iA, geo.attributes.iB]) {
      a.clearUpdateRanges(); a.addUpdateRange(0, Math.max(4, n * 4)); a.needsUpdate = true;
    }
    return n;
  }

  return {
    mesh, material: mat, update, onEvent, night,
    /** DESIGN §12: drive the ending's crowds from a time (seconds into TIMELINE.ending), null = follow state.ending.t. */
    setEnding(t) { endOverride = t == null ? null : +t; },
    get count() { return geo.instanceCount; },
    get corpses() { return C.n; },
    dispose() { scene.remove(mesh); geo.dispose(); mat.dispose(); },
  };
}
