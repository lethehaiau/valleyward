// @ts-check
// The short cinematics (docs/DESIGN.md §14.3 createCinema, §2.5; beat times from src/shared/timeline.js).
// The sim moves the bodies; this module moves the camera, the letterbox, the night card and the dawn ramp. It owns the
// camera while update() returns true. Every call into env / look / ui / audio / actors is guarded, so a missing module
// never breaks a scene.
//
//   intro  (6.0 s)  a low glide up the valley road toward the keep, a cut to the beacon tower flickering, then the
//                   Lamplighter's eye on the plaza facing the road; ui.card('night') at the card beat; resolves at control
//   troll  (3.2 s)  a low-angle look up at the Ash Troll stepping out of the valley fog, a roar beat, a cut back
//   dawn   (7.0 s)  from the eye, a slow rise and turn to the east as the sun comes up (env/look.setDawn 0 → 1 over
//                   TIMELINE.dawn.rise); resolves at the card beat and HOLDS the lens until play('retry') / release()
//   fallen (2.4 s)  the gate: a high shot over the breach; the player: the eye drops to the ground with a roll; a dim at
//                   the fade beat; resolves at the card beat and HOLDS the lens until play('retry') / release()
//   retry  (1.2 s)  a fade from black while the eye settles from just above and behind the spawn
//   kindle (1.0 s)  an OVERLAY on play: from the live eye (the player keeps walking and looking) the lens lifts
//                   clear of the SE tower and tilts up to the flaring basket, holds the flare, and comes back to the
//                   exact eye pose; no letterbox, the HUD stays (`overlay` is true); never overrides another scene
//   camp   (2.6 s)  DESIGN §9 camp enter (after a dawn or a fall): black, "THE DAY PASSES", the lens settles onto the eye at
//                   the camp at dusk as the black lifts (starts itself on EV.CAMP_ENTER)
//   ending (≈ 56 s) DESIGN §12 on TIMELINE.ending (its clock follows state.modeT in mode 'ending'): the flood falls, the lamp
//                   opens, the portal, the world changes, the host, the hands (first person: `hands` true for the viewmodel),
//                   the reveal (out of the head and around to a low frontal angle on the demon), the roar, Brother Cinder,
//                   the hunt (a wide crane, cut to black), the credits, the end card; it holds the lens at the card
//   campLeave (4.0 s) E at the pan: the lens lifts and looks up at the lamp while the dusk goes to night, the lamp flares
//                   with the environment's vision beat (1.6 s), the NIGHT n card (2.6 s), back to the eye (starts itself on EV.CAMP_LEAVE)
import * as THREE from 'three';
import { ARENA, BODY, groundHeight } from '../shared/arena.js';
import * as TL from '../shared/timeline.js';

/** Fallback beat times (DESIGN §7) when the timeline lacks a scene. */
const DEFAULTS = Object.freeze({
  intro: { duration: 6.0, skippableAfter: 1.5, beats: [{ at: 0, id: 'valley' }, { at: 1.8, id: 'glide' }, { at: 3.6, id: 'beacon' }, { at: 4.6, id: 'hands' }, { at: 4.9, id: 'card' }, { at: 6.0, id: 'control' }] },
  troll: { duration: 3.2, beats: [{ at: 0, id: 'horn' }, { at: 0.4, id: 'emerge' }, { at: 2.2, id: 'roar' }, { at: 3.2, id: 'done' }] },
  dawn: { duration: 7.0, rise: 5.0, beats: [{ at: 0, id: 'sunrise' }, { at: 4.0, id: 'quiet' }, { at: 6.5, id: 'card' }] },
  fallen: { duration: 2.4, beats: [{ at: 0, id: 'slowmo' }, { at: 0.6, id: 'fade' }, { at: 1.4, id: 'card' }] },
  retry: { duration: 1.2, beats: [{ at: 0, id: 'fadein' }, { at: 1.2, id: 'control' }] },
  kindle: { duration: 1.0, beats: [{ at: 0, id: 'up' }, { at: 0.22, id: 'flare' }, { at: 1.0, id: 'back' }] },
  camp: { duration: 2.6, beats: [{ at: 0, id: 'dark' }, { at: 0.3, id: 'caption' }, { at: 1.5, id: 'fadeup' }, { at: 2.6, id: 'control' }] },
  campLeave: { duration: 4.0, beats: [{ at: 0, id: 'look' }, { at: 1.6, id: 'vision' }, { at: 2.6, id: 'card' }, { at: 4.0, id: 'control' }] },
  rise: { duration: 4.2, beats: [{ at: 0, id: 'horn' }, { at: 0.4, id: 'emerge' }, { at: 2.8, id: 'roar' }, { at: 4.2, id: 'done' }] },
  ending: { duration: 56, skippableAfter: 3, beats: [{ at: 0, id: 'flood' }, { at: 5, id: 'lamp' }, { at: 8, id: 'portal' }, { at: 12, id: 'world' }, { at: 18, id: 'host' },
    { at: 25, id: 'gloves' }, { at: 29, id: 'reveal' }, { at: 34, id: 'roar' }, { at: 37, id: 'cinder' }, { at: 42, id: 'hunt' }, { at: 50, id: 'black' }, { at: 50.5, id: 'credits' }, { at: 56, id: 'card' }] },
});
/** the kindle glance's curve (fractions of its duration): up (ease out), hold the flare, back (ease in-out) */
const GLANCE = Object.freeze({ up: 0.38, hold: 0.6 });
/** @param {string} name */
function scene(name) {
  const t = /** @type {any} */ (TL)?.TIMELINE?.[name];
  const d = /** @type {any} */ (DEFAULTS)[name];
  if (name === 'kindle') { const g = Number(t?.glance); return { ...d, duration: g > 0.3 && g < 3 ? g : d.duration }; } // TIMELINE.kindle holds the flare's times, not a scene
  if (name === 'camp' || name === 'campLeave') { const x = t && Number(t.duration) > 1 && Array.isArray(t.beats) ? t : null; return x ? { ...d, ...x } : d; }
  if (!t) return d;
  return { ...d, ...t, beats: Array.isArray(t.beats) && t.beats.length ? t.beats : d.beats };
}
const beatAt = (sc, id, fallback) => { const b = sc.beats.find((x) => x.id === id); return b ? b.at : fallback; };

const ease = (u) => { u = u < 0 ? 0 : u > 1 ? 1 : u; return u * u * (3 - 2 * u); };
const easeOut = (u) => { u = u < 0 ? 0 : u > 1 ? 1 : u; return 1 - (1 - u) * (1 - u) * (1 - u); };
const easeIn = (u) => { u = u < 0 ? 0 : u > 1 ? 1 : u; return u * u; };
const easeInOut = (u) => { u = u < 0 ? 0 : u > 1 ? 1 : u; return u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2; };
const EYE = BODY.player.eye;
const g = (x, z) => groundHeight(x, z);

function call(obj, fn, ...args) {
  try { const f = obj && obj[fn]; if (typeof f === 'function') return f.apply(obj, args); } catch (e) { console.warn(`[ew-cinema] ${fn}`, e); }
  return undefined;
}

/**
 * @param {{ camera: THREE.PerspectiveCamera, actors?: any, env?: any, look?: any, ui?: any, audio?: any }} o
 */
export function createCinema({ camera, actors = null, env = null, look = null, ui = null, audio = null }) {
  void actors; void audio; // the audio code follows state.mode / TIMELINE itself
  let name = '', t = 0, active = false, holding = false;
  /** @type {any} */ let sc = null;
  /** @type {((v?: any) => void) | null} */ let resolveFn = null;
  let resolveAt = Infinity, fired = new Set();
  const baseFov = camera.fov || 78;
  let cause = 'gate', pendingCause = '', dawnX = 0, leaveNight = 0;
  call(ui, 'setCamera', camera);   // the UI projects the elite name plates with it
  const pos = new THREE.Vector3(), tgt = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  const eyeP = new THREE.Vector3(), eyeT = new THREE.Vector3(), a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const startP = new THREE.Vector3(), startT = new THREE.Vector3(), trollP = new THREE.Vector3(), side = new THREE.Vector3();
  const m4 = new THREE.Matrix4();
  let roll = 0, fov = baseFov;
  // the kindle glance: the lift (from the eye) that clears the beacon tower; the fallen shot: the feet and facing
  const kLift = new THREE.Vector3();
  let fallFeet = 0, fallYaw = 0;
  const towerSE = (ARENA.keep?.towers || []).find((tw) => tw.beacon) || { x: 16, z: 0, half: 3.2, height: 10 };
  /** true when the segment from p to the basket clears the beacon tower's box (+ its merlons) */
  function seesBasket(px, py, pz) {
    const bk = ARENA.beacon.basket, h = towerSE.half + 0.15, top = towerSE.height + 1.5;
    for (let i = 1; i < 28; i++) {
      const u = i / 28, x = px + (bk.x - px) * u, y = py + (bk.y + 0.5 - py) * u, z = pz + (bk.z - pz) * u;
      if (Math.abs(x - towerSE.x) < h && Math.abs(z - towerSE.z) < h && y < top) return false;
    }
    return true;
  }
  /** pick the glance's lift for the eye at e: up (and a little back from the tower) until the basket is in sight */
  function planGlance(e) {
    const bk = ARENA.beacon.basket;
    let hx = e.x - bk.x, hz = e.z - bk.z; const hl = Math.hypot(hx, hz) || 1; hx /= hl; hz /= hl;
    let L = 1.2;
    for (let l = 0; l <= 7.01; l += 0.5) { if (seesBasket(e.x + hx * l * 0.4, e.y + l, e.z + hz * l * 0.4)) { L = Math.max(1.2, l + 0.6); break; } L = 7.6; }
    kLift.set(hx * L * 0.4, L, hz * L * 0.4);
  }
  const wrapA = (x) => { while (x > Math.PI) x -= Math.PI * 2; while (x < -Math.PI) x += Math.PI * 2; return x; };

  // the intro's valley glide (road points, low over the slope, looking up at the keep)
  const glide = new THREE.CatmullRomCurve3([
    new THREE.Vector3(31, g(31, 72) + 3.2, 72),
    new THREE.Vector3(30.5, g(30.5, 58) + 4.2, 58),
    new THREE.Vector3(29.5, g(29.5, 44) + 5.4, 44),
    new THREE.Vector3(27, g(27, 30) + 7.0, 30),
  ], false, 'catmullrom', 0.5);

  /** the player's eye pose (from the state, or the spawn) */
  function eye(state, outP, outT) {
    const p = state?.player;
    const x = p && Number.isFinite(p.x) ? p.x : ARENA.playerSpawn.x, z = p && Number.isFinite(p.z) ? p.z : ARENA.playerSpawn.z;
    const y = (p && Number.isFinite(p.y) ? p.y : g(x, z)) + EYE;
    const yaw = p && Number.isFinite(p.yaw) ? p.yaw : ARENA.playerSpawn.yaw, pitch = p && Number.isFinite(p.pitch) ? p.pitch : -0.04;
    outP.set(x, y, z);
    outT.set(x + Math.sin(yaw) * Math.cos(pitch) * 10, y + Math.sin(pitch) * 10, z + Math.cos(yaw) * Math.cos(pitch) * 10);
  }

  function setDawn(x) { dawnX = x; call(env, 'setDawn', x); call(look, 'setDawn', x); }

  // ---------------------------------------------------------------------------------------------- the ending (DESIGN §12)
  // Positions are taken once at play('ending'): the demon stands at the player's wall-walk spot (feet `endP`), the
  // Rainmother fell at `endB`, Brother Cinder kneels at `endC`, the village burns at `endV`, the portal opens at `endQ`.
  const endP = new THREE.Vector3(), endB = new THREE.Vector3(), endC = new THREE.Vector3(), endV = new THREE.Vector3(), endQ = new THREE.Vector3();
  const endT = new THREE.Vector3(), endE = new THREE.Vector3(), endD = new THREE.Vector3(), huntDir = new THREE.Vector3(1, 0, 0), huntSide = new THREE.Vector3(0, 0, 1);
  let gloveYaw = 0, glovePitch = 0.6;
  let endYaw = 0, endFirst = true, revealPath = /** @type {THREE.CatmullRomCurve3 | null} */ (null);
  const KEEP = ARENA.keep;
  const KEEP_BOXES = [...(KEEP.towers || []).map((tw) => [tw.x - tw.half, tw.z - tw.half, tw.x + tw.half, tw.z + tw.half, tw.height + 1.6]),
    [KEEP.x0, KEEP.z1 - KEEP.wallThick, KEEP.x1, KEEP.z1, KEEP.wallHeight + (KEEP.parapetH || 1.1) + 0.3],
    [KEEP.x0, KEEP.z0, KEEP.x1, KEEP.z0 + KEEP.wallThick, KEEP.wallHeight + 1.4],
    [KEEP.x0, KEEP.z0, KEEP.x0 + KEEP.wallThick, KEEP.z1, KEEP.wallHeight + 1.4], [KEEP.x1 - KEEP.wallThick, KEEP.z0, KEEP.x1, KEEP.z1, KEEP.wallHeight + 1.4]];
  /** the lens is never inside the keep's stone: inside a wall / tower box it is lifted over its top */
  function outOfStone(v) {
    for (const b of KEEP_BOXES) if (v.x > b[0] - 0.3 && v.x < b[2] + 0.3 && v.z > b[1] - 0.3 && v.z < b[3] + 0.3 && v.y < b[4]) v.y = b[4] + 0.4;
  }
  const xz = (o, x, z, dy = 0) => o.set(x, g(x, z) + dy, z);
  function planEnding(state) {
    const p = state?.player, e = state?.ending || {}, bo = state?.boss;
    endP.set(p && Number.isFinite(p.x) ? p.x : 0, p && Number.isFinite(p.y) ? p.y : ARENA.keep.walkY, p && Number.isFinite(p.z) ? p.z : -1.5);
    endYaw = p && Number.isFinite(p.yaw) ? p.yaw : 0;
    if (bo && Number.isFinite(bo.x)) xz(endB, bo.x, bo.z); else xz(endB, 25, 52);
    // the anchors the actors draw at (src/actors/crowd.js): Cinder below the player at z 1.8, the hunt at (29, 84) unless the
    // state / ARENA names a village; the portal the environment draws (src/env/ending.js PORTAL: 0, 52, −26)
    if (e.cinder && Number.isFinite(e.cinder.x)) xz(endC, e.cinder.x, e.cinder.z); else xz(endC, endP.x, 1.8);
    const vil = /** @type {any} */ (ARENA).village || e.village;   // one village (the environment builds it, the actors stage the hunt there)
    if (vil && Number.isFinite(vil.x)) xz(endV, vil.x, vil.z); else xz(endV, 12, 108);
    const fo = vil?.forest || e.village?.forest || { x: endV.x - 26, z: endV.z + 18 };
    huntDir.set(fo.x - endV.x, 0, fo.z - endV.z).normalize();
    huntSide.set(huntDir.z, 0, -huntDir.x);   // the side away from the keep (the keep lies up the hill to the north)
    if (huntSide.z < 0) huntSide.multiplyScalar(-1);
    // the gloves: facing out over the parapet (the player's facing), pitched a little up so the burning claws (lower middle)
    // sit above the merlons against the burning valley's horizon glow; no turn (a turn toward the portal swept the SW tower)
    gloveYaw = endYaw; glovePitch = 0.12;
    if (e.portal && Number.isFinite(e.portal.x)) endQ.set(e.portal.x, Number.isFinite(e.portal.y) ? e.portal.y : 52, e.portal.z); else endQ.set(0, 52, -26);
    // the reveal: out of the head, back and up over the walk, around, down to a low frontal angle on the plaza
    // every waypoint below the demon's head keeps ≥ 5 m from its axis (the sprite is ≈ 5.4 m tall), whatever the spot
    const E = new THREE.Vector3(endP.x, endP.y + EYE, endP.z);
    const D = new THREE.Vector3(endP.x + 2.2, 0, Math.max(endP.z + 10.5, 8.5)); D.y = Math.max(g(D.x, D.z), endP.y - 3.4) + 1.6;
    revealPath = new THREE.CatmullRomCurve3([E, new THREE.Vector3(endP.x - 0.2, endP.y + 5.0, endP.z - 3.0), new THREE.Vector3(endP.x + 5.6, endP.y + 7.6, endP.z + 1.6),
      new THREE.Vector3(endP.x + 5.0, Math.max(D.y + 1.8, endP.y + 1.0), endP.z + 7.0), D], false, 'catmullrom', 0.5);
    endD.copy(D);
  }
  /** the demon's head (≈ 5 m tall on the wall walk) */
  const demonHead = (o, k = 1) => o.set(endP.x, endP.y + 4.9 * k, endP.z);   // the actors' demon is ≈ 5.4 m tall
  function endingShot(state) {
    const at = (id, fb) => beatAt(sc, id, fb);
    const tLamp = at('lamp', 5), tPortal = at('portal', 8), tWorld = at('world', 12), tHost = at('host', 18), tGloves = at('gloves', 25);
    const tReveal = at('reveal', 29), tRoar = at('roar', 34), tCinder = at('cinder', 37), tHunt = at('hunt', 42), tBlack = at('black', 50), tCard = at('card', 56);
    if (t >= tCard) {           // the end card: the low frontal angle again, the demon and the portal behind THE WAY IS OPEN
      pos.copy(endD); demonHead(tgt, 0.9); fov = baseFov - 8; outOfStone(pos); return;
    }
    if (t < tLamp) {            // 1 the flood falls: wide from up the hill on the valley where she collapses
      const u = ease(t / tLamp);
      let vx = 0 - endB.x, vz = -16 - endB.z; const l = Math.hypot(vx, vz) || 1; vx /= l; vz /= l;
      const d = 30 - 6 * u;
      pos.set(endB.x + vx * d, 0, endB.z + vz * d); pos.z = Math.max(pos.z, 3); pos.y = Math.max(g(pos.x, pos.z) + 13, endB.y + 13 - 2 * u);
      tgt.set(endB.x, endB.y + 4 - 2.5 * u, endB.z);
      fov = baseFov - 18;
    } else if (t < tWorld) {    // 2 the lamp opens: up at the pillar, then back and up to the portal tearing the sky
      const bk = ARENA.beacon.basket;
      const u = ease((t - tLamp) / (tWorld - tLamp)), w = ease((t - tPortal) / (tWorld - tPortal - 1));
      xz(a, 9, 11, 1.7); xz(b, 7, 22, 2.2); pos.lerpVectors(a, b, w);
      c.set(bk.x, bk.y + 2 + 10 * Math.min(1, (t - tLamp) / (tPortal - tLamp)), bk.z);
      tgt.lerpVectors(c, endQ, w);
      fov = baseFov - 10 + 18 * w; void u;
    } else if (t < tHost) {     // 3 the world changes: a slow pan from the burning slope to the black moon
      const u = ease((t - tWorld) / (tHost - tWorld));
      pos.set(-4 + 3 * u, 9.5, 2.5);
      const y0 = Math.atan2(0.2, 1), y1 = Math.atan2(ARENA.moonDir.x, ARENA.moonDir.z), yaw = y0 + (y1 - y0) * u, pitch = -0.22 + 0.24 * u;
      tgt.set(pos.x + Math.sin(yaw) * Math.cos(pitch) * 10, pos.y + Math.sin(pitch) * 10, pos.z + Math.cos(yaw) * Math.cos(pitch) * 10);
      fov = baseFov - 4;
    } else if (t < tGloves) {   // 4 the host: low on the road below the gate as it opens from the inside and they march down
      const u = ease((t - tHost) / (tGloves - tHost));
      // (up over the burnt grass, nearer the road's line, and ≥ 10 m ahead of the front rank all through the beat:
      // the actors dither the host out within 4–9 m of the lens, which is why the old 11 → 16 m track lost it. The ranks cut
      // out against the gate's fire and the wall's foot, lit red from behind (the environment's gate card and lava, the FX glows))
      xz(pos, 2.0 + 1.2 * u, 14 + 10 * u, 1.75 + 0.25 * u);
      tgt.set(0, 2.1 - 0.5 * u, 0.5 + 6 * u);
      fov = baseFov - 8;
    } else if (t < tReveal) {   // 5 the hands: first person, the burning gloves (the actors' viewmodel, lower middle) against the portal's glow
      const u = ease((t - tGloves) / 1.4);
      pos.set(endP.x, endP.y + EYE, endP.z);
      const yaw = endYaw + wrapA(gloveYaw - endYaw) * u, pitch = 0.05 + (glovePitch - 0.05) * u + 0.03 * Math.sin((t - tGloves) * 0.9);
      tgt.set(pos.x + Math.sin(yaw) * Math.cos(pitch) * 10, pos.y + Math.sin(pitch) * 10, pos.z + Math.cos(yaw) * Math.cos(pitch) * 10);
      fov = baseFov;
    } else if (t < tCinder) {   // 6 the reveal + 7 the roar: out of the head and around to a low frontal angle; then the roar
      const u = Math.min(1, (t - tReveal) / Math.max(0.5, tRoar - tReveal - 1)), k = easeInOut(u);
      revealPath?.getPointAt(k, pos);
      endE.set(endP.x + Math.sin(gloveYaw) * Math.cos(glovePitch) * 10, endP.y + EYE + Math.sin(glovePitch) * 10, endP.z + Math.cos(gloveYaw) * Math.cos(glovePitch) * 10);   // from the gloves' look
      demonHead(endT, 1);
      tgt.lerpVectors(endE, endT, ease(Math.min(1, u * 1.6)));
      fov = baseFov - 4 * k;
      if (t >= tRoar) {         // push in a little, the lens narrows, a roar shake
        const r = (t - tRoar);
        pos.y += 0.25 * ease(r / 2); pos.z -= 0.8 * ease(r / 2);
        fov = baseFov - 4 - 6 * ease(r / 1.5);
        if (r > 0.15 && r < 1.6) { const s = (1 - (r - 0.15) / 1.45) * 0.16; pos.x += Math.sin(t * 61) * s; pos.y += Math.sin(t * 47 + 1) * s; tgt.x += Math.sin(t * 53 + 2) * s * 3; }
      }
    } else if (t < tHunt) {     // 8 Brother Cinder kneels at the foot of the wall; the demon towers behind him
      const u = ease((t - tCinder) / (tHunt - tCinder));
      xz(pos, endC.x + 3.4 - 0.6 * u, endC.z + 4.6 - 0.8 * u, 1.25);
      // keep ≥ 9 m from the demon (≈ 5.4 m tall) so Cinder at its feet and the figure above both fit, wherever it stands
      let hx = pos.x - endP.x, hz = pos.z - endP.z; const hl = Math.hypot(hx, hz) || 1;
      if (hl < 9) { hx /= hl; hz /= hl; xz(pos, endP.x + hx * 9, endP.z + hz * 9, 1.25); }
      tgt.set(endC.x * 0.65 + endP.x * 0.35, endP.y * 0.5 + 3.0 + 0.8 * u, (endC.z + endP.z) / 2 + 0.4);
      fov = baseFov - 6;
    } else {                    // 9 the hunt: low and close, a 3/4-front track on the families and animals fleeing toward the forest,
      // the horned chasers behind them and the burning huts behind both (silhouettes against the fire); black at 50 s.
      // the actors' staging (src/actors/crowd.js): h = t − (hunt − 1); villagers at ≈ 3.3 h m from the village centre along the
      // line to ARENA.village.forest (spread ±11 m across it), the chasers at ≈ −20 + 2.9 h m (the gap only grows)
      // low on the forest side of the village, looking back at the burning huts: the families and
      // animals run toward the lens with the fire behind them, the horned chasers coming through the huts. The lens backs
      // off slowly toward the forest (≈ 1 m/s from the actors' (−4, 118); 28 m out the lens was among the pines with the runners
      // filling it) and stands 4 m off the runners' line
      const h = t - (tHunt - 1);
      const dCam = 19 + 1.0 * h, side = 4, up = 2.4;
      pos.set(endV.x + huntDir.x * dCam + huntSide.x * side, 0, endV.z + huntDir.z * dCam + huntSide.z * side);
      pos.y = g(pos.x, pos.z) + up;
      const dT = 2 + 0.6 * h;
      tgt.set(endV.x + huntDir.x * dT + huntSide.x * 2, 0, endV.z + huntDir.z * dT + huntSide.z * 2);
      tgt.y = g(tgt.x, tgt.z) + 2.4;
      fov = baseFov - 10;
    }
    outOfStone(pos);
  }

  // ---------------------------------------------------------------------------------------------- shots
  /** @param {any} state */
  function shoot(state) {
    roll = 0; fov = baseFov;
    if (name === 'ending') { endingShot(state); return; }
    if (name === 'rise') {     // Night X: the Rainmother rises out of the valley river (a look down the hill as she stands up)
      const done = beatAt(sc, 'done', sc.duration);
      if (t >= done - 0.02) { eye(state, pos, tgt); return; }
      const bo = state?.boss; if (bo && Number.isFinite(bo.x)) endB.set(bo.x, g(bo.x, bo.z), bo.z);
      let vx = 0 - endB.x, vz = 0 - endB.z; const l = Math.hypot(vx, vz) || 1; vx /= l; vz /= l;
      const u = ease(t / done), d = 30 - 4 * u;
      pos.set(endB.x + vx * d, 0, endB.z + vz * d); pos.y = Math.max(g(pos.x, pos.z) + 7, endB.y + 6);
      tgt.set(endB.x, endB.y + 3 + 8 * ease(Math.min(1, t / 2.6)), endB.z);
      fov = baseFov - 16;
      const roar = beatAt(sc, 'roar', 2.8);
      if (t > roar && t < roar + 0.8) { const k = (1 - (t - roar) / 0.8) * 0.14; pos.x += Math.sin(t * 61) * k; pos.y += Math.sin(t * 47 + 1) * k; }
      outOfStone(pos);
      return;
    }

    if (name === 'intro') {
      const tBeacon = beatAt(sc, 'beacon', 3.6), tHands = beatAt(sc, 'hands', 4.6);
      if (t < tBeacon) {
        // A: low over the valley road under the moon, gliding up toward the keep
        const u = easeOut(t / tBeacon * 0.92 + 0.0);
        glide.getPointAt(Math.min(1, u), pos);
        a.set(10, 5.5, 0); b.set(15, 9, 0);
        tgt.lerpVectors(a, b, ease(t / tBeacon));
        fov = baseFov - 14;
      } else if (t < tHands) {
        // B: a cut to a crane at the tower's height east of the keep: the beacon basket against the sky as it flickers
        const u = ease((t - tBeacon) / Math.max(0.1, tHands - tBeacon));
        const bk = ARENA.beacon.basket;
        a.set(bk.x + 6.8, bk.y + 2.0, bk.z + 9.0); b.set(bk.x + 5.4, bk.y + 1.3, bk.z + 7.2);
        pos.lerpVectors(a, b, u);
        tgt.set(bk.x - 0.3, bk.y + 0.1, bk.z);
        fov = baseFov - 26;
      } else {
        // C: a cut to the eye on the plaza; the view settles from a slight downward look (the hands rise: the actors' viewmodel)
        eye(state, pos, eyeT);
        const u = easeOut((t - tHands) / 0.8);
        tgt.copy(eyeT); tgt.y -= 3.2 * (1 - u);
        fov = baseFov - 6 * (1 - u);
      }
      return;
    }
    if (name === 'troll') {
      const done = beatAt(sc, 'done', sc.duration);
      if (t >= done - 0.02) { eye(state, pos, tgt); return; }
      const tr = state?.troll;
      if (tr && Number.isFinite(tr.x)) trollP.set(tr.x, Number.isFinite(tr.y) ? tr.y : g(tr.x, tr.z), tr.z);
      // toward the keep from the troll, a little to the side, the lens near the ground
      a.set(ARENA.gate.target.x - trollP.x, 0, ARENA.gate.target.z - trollP.z).normalize();
      side.set(-a.z, 0, a.x);
      const u = ease(t / done);
      const dist = 12 - 2.5 * u;
      pos.set(trollP.x + a.x * dist + side.x * 3.2, 0, trollP.z + a.z * dist + side.z * 3.2);
      pos.y = g(pos.x, pos.z) + 0.9;
      tgt.set(trollP.x, trollP.y + 4.6 + 0.6 * u, trollP.z);
      fov = 56;
      const roar = beatAt(sc, 'roar', 2.2);
      if (t > roar && t < roar + 0.7) { // the roar: a short shake of this shot's lens (the core's trauma shake is for play)
        const k = (1 - (t - roar) / 0.7) * 0.12;
        pos.x += Math.sin(t * 61) * k; pos.y += Math.sin(t * 47 + 1) * k; tgt.x += Math.sin(t * 53 + 2) * k * 2;
      }
      return;
    }
    if (name === 'dawn') {
      // from the eye: rise ~3.5 m and turn to the east where the sun comes up over the valley
      const u = ease(t / 4.5);
      a.copy(startP); b.set(startP.x - 1.5, startP.y + 3.6, startP.z + 1.2);
      pos.lerpVectors(a, b, u);
      c.set(startP.x + 70, startP.y + 7, startP.z + 18); // the east horizon, a little south over the valley
      tgt.lerpVectors(startT, c, ease(t / 3.2));
      return;
    }
    if (name === 'fallen') {
      if (cause === 'gate') {
        // a high shot over the breach, slowly pushing in
        const u = ease(t / sc.duration);
        a.set(9, 9.5, 17); b.set(6.5, 7.6, 13);
        pos.lerpVectors(a, b, u);
        tgt.set(0, 1.4, 0.8);
        fov = baseFov - 16;
      } else {
        // the player (never into the ground): the knees go — the eye sinks to 0.8 m above the feet with a roll and
        // the gaze drops — then the lens lifts out of the body, straight up over the spot (nothing overhead can block it),
        // and looks down at where the Lamplighter fell and the horde closing in, turning slowly; it stops at 3.2 s
        // (the sink is a 0.14 s flinch: a horde around the body fills a low lens with sprites, which read as mud)
        const t1 = 0.14, tt = Math.min(t, 3.2), y1 = Math.max(fallFeet + 1.3, startP.y - 0.22);
        a.set(startT.x, startT.y - 4, startT.z);                      // the dropped gaze
        if (tt < t1) {
          const u = easeIn(tt / t1);
          pos.set(startP.x, startP.y + (y1 - startP.y) * u, startP.z);
          tgt.lerpVectors(startT, a, ease(tt / t1));
          roll = 0.3 * easeOut(tt / t1);
        } else {
          const u = easeOut((tt - t1) / 1.8), k = ease(Math.min(1, (tt - t1) / 0.8));
          pos.set(startP.x, y1 + (fallFeet + 6.2 - y1) * u, startP.z);
          const yw = fallYaw + 0.45 * ease(Math.min(1, (tt - t1) / 2.9));
          b.set(startP.x + Math.sin(yw) * 2.6, fallFeet + 0.2, startP.z + Math.cos(yw) * 2.6);
          tgt.lerpVectors(a, b, k);
          roll = 0.3 * (1 - ease(Math.min(1, (tt - t1) / 1.2)));
        }
        const floor = Math.max(g(pos.x, pos.z), fallFeet) + 0.45;
        if (pos.y < floor) pos.y = floor;
      }
      return;
    }
    if (name === 'kindle') {
      // the live eye (walking and looking stay live), lifted by kLift and turned toward the basket by w
      eye(state, eyeP, eyeT);
      const D = sc.duration || 1, x = t / D;
      const w = x < GLANCE.up ? easeOut(x / GLANCE.up) : x < GLANCE.hold ? 1 : 1 - ease((x - GLANCE.hold) / (1 - GLANCE.hold));
      pos.copy(eyeP).addScaledVector(kLift, w);
      const bk = ARENA.beacon.basket;
      const y0 = Math.atan2(eyeT.x - eyeP.x, eyeT.z - eyeP.z), p0 = Math.atan2(eyeT.y - eyeP.y, Math.hypot(eyeT.x - eyeP.x, eyeT.z - eyeP.z));
      const y1 = Math.atan2(bk.x - pos.x, bk.z - pos.z), p1 = Math.min(1.35, Math.atan2(bk.y + 0.9 - pos.y, Math.hypot(bk.x - pos.x, bk.z - pos.z)));
      const yaw = y0 + wrapA(y1 - y0) * w, pitch = p0 + (p1 - p0) * w;
      tgt.set(pos.x + Math.sin(yaw) * Math.cos(pitch) * 10, pos.y + Math.sin(pitch) * 10, pos.z + Math.cos(yaw) * Math.cos(pitch) * 10);
      fov = baseFov - 12 * w;
      const fl = beatAt(sc, 'flare', 0.22);
      if (t > fl && t < fl + 0.35) { const k = (1 - (t - fl) / 0.35) * 0.05; pos.x += Math.sin(t * 67) * k; pos.y += Math.sin(t * 51 + 1) * k; }
      return;
    }
    if (name === 'camp') {
      // the eye at the camp (the sim has placed the player): the lens settles from a little above and behind as the black lifts
      eye(state, eyeP, eyeT);
      const yw = state?.player?.yaw ?? ARENA.playerSpawn.yaw;
      const u = easeOut(Math.max(0, t - 1.1) / 1.5);
      a.set(eyeP.x - Math.sin(yw) * 1.4, eyeP.y + 0.9, eyeP.z - Math.cos(yw) * 1.4);
      pos.lerpVectors(a, eyeP, u);
      tgt.copy(eyeT); tgt.y += 1.2 * (1 - u);
      return;
    }
    if (name === 'campLeave') {
      // the kindle glance held longer: lift clear of the tower, look up at the lamp through the turn to night, come back
      eye(state, eyeP, eyeT);
      const x = t, w = x < 1.0 ? easeOut(x / 1.0) : x < 2.6 ? 1 : 1 - ease((x - 2.6) / 0.9);
      pos.copy(eyeP).addScaledVector(kLift, w);
      const bk = ARENA.beacon.basket;
      const y0 = Math.atan2(eyeT.x - eyeP.x, eyeT.z - eyeP.z), p0 = Math.atan2(eyeT.y - eyeP.y, Math.hypot(eyeT.x - eyeP.x, eyeT.z - eyeP.z));
      const y1 = Math.atan2(bk.x - pos.x, bk.z - pos.z), p1 = Math.min(1.35, Math.atan2(bk.y + 1.2 - pos.y, Math.hypot(bk.x - pos.x, bk.z - pos.z)));
      const yaw = y0 + wrapA(y1 - y0) * w, pitch = p0 + (p1 - p0) * w;
      tgt.set(pos.x + Math.sin(yaw) * Math.cos(pitch) * 10, pos.y + Math.sin(pitch) * 10, pos.z + Math.cos(yaw) * Math.cos(pitch) * 10);
      fov = baseFov - 14 * w;
      const vb = beatAt(sc, 'vision', 1.6);
      if (t > vb && t < vb + 0.45) { const k = (1 - (t - vb) / 0.45) * 0.06; pos.x += Math.sin(t * 67) * k; pos.y += Math.sin(t * 51 + 1) * k; }
      return;   // the environment plays the sunset back into night and the lamp's flare + vision from EV.CAMP_LEAVE itself
    }
    if (name === 'retry') {
      eye(state, eyeP, eyeT);
      const u = easeOut(t / sc.duration);
      a.set(eyeP.x - Math.sin((state?.player?.yaw ?? ARENA.playerSpawn.yaw)) * 1.6, eyeP.y + 1.1, eyeP.z - Math.cos((state?.player?.yaw ?? ARENA.playerSpawn.yaw)) * 1.6);
      pos.lerpVectors(a, eyeP, u);
      tgt.copy(eyeT);
      return;
    }
    eye(state, pos, tgt);
  }

  function apply() {
    const gfl = g(pos.x, pos.z) + 0.35;   // no shot ever puts the lens into the terrain
    if (pos.y < gfl) pos.y = gfl;
    camera.position.copy(pos);
    m4.lookAt(pos, tgt, up);
    camera.quaternion.setFromRotationMatrix(m4);
    if (roll) camera.rotateZ(roll);
    if (Math.abs(camera.fov - fov) > 0.01) { camera.fov = fov; camera.updateProjectionMatrix(); }
    camera.updateMatrixWorld();
  }

  // ---------------------------------------------------------------------------------------------- beats
  function beat(id, state) {
    switch (`${name}.${id}`) {
      case 'intro.valley': call(ui, 'setLetterbox', true); break;
      case 'intro.beacon': call(env, 'beaconFlicker', 1.0); call(env, 'onEvent', { type: 'cinema.beacon', t: state?.t ?? 0 }, state); break;
      case 'intro.hands': call(ui, 'setLetterbox', false); break;
      case 'intro.card': call(ui, 'card', 'night'); break;
      case 'troll.horn': call(ui, 'setLetterbox', true); break;
      case 'dawn.sunrise': call(ui, 'setLetterbox', true); break;
      case 'fallen.slowmo': call(ui, 'setLetterbox', true); break;
      case 'fallen.fade': call(ui, 'fade', 0.35, 0.8); break;
      case 'retry.fadein': call(ui, 'fade', 1, 0); call(ui, 'fade', 0, 0.9); break;
      case 'camp.dark': call(ui, 'setLetterbox', true); call(ui, 'fade', 1, 0.3); if (dawnX !== 0) setDawn(0); break;
      case 'camp.caption': call(ui, 'caption', 'THE DAY PASSES'); break;
      case 'camp.fadeup': call(ui, 'caption', ''); call(ui, 'fade', 0, 1.0); break;
      case 'campLeave.look': call(ui, 'setLetterbox', true); call(ui, 'caption', ''); break;
      case 'campLeave.vision': break;   // the lens shakes on it (shoot); the environment's flare and vision land here on their own
      case 'rise.horn': call(ui, 'setLetterbox', true); break;
      case 'ending.flood': call(ui, 'setLetterbox', true); call(ui, 'fade', 0.6, 0); call(ui, 'fade', 0, 1.6); break;
      case 'ending.hunt': call(ui, 'fade', 0, 0.2); call(ui, 'subtitle', ''); break;   // Cinder's line ends with his beat
      case 'ending.black': call(ui, 'fade', 1, 0.45); break;
      case 'ending.credits': call(ui, 'credits', true); break;
      case 'ending.card': call(ui, 'credits', false); call(ui, 'setLetterbox', false); call(ui, 'fade', 0, 1.4); call(ui, 'card', 'ending', state); break;
      case 'campLeave.card': call(ui, 'setLetterbox', false); call(ui, 'card', 'night', state, { night: leaveNight || state?.night?.n || 1 }); break;
      default: break;
    }
  }

  function finish() {
    const r = resolveFn; resolveFn = null;
    active = false; holding = false;
    if (name === 'kindle') call(ui, 'setGlance', false);
    if (name === 'camp') { call(ui, 'caption', ''); call(ui, 'fade', 0, 0.3); }
    if (name === 'ending') { call(ui, 'credits', false); call(ui, 'fade', 0, 0.4); }
    call(ui, 'setLetterbox', false);
    if (Math.abs(camera.fov - baseFov) > 0.01) { camera.fov = baseFov; camera.updateProjectionMatrix(); }
    const was = name; name = '';
    r?.(was);
  }

  // ---------------------------------------------------------------------------------------------- API
  /** @param {'intro'|'troll'|'dawn'|'fallen'|'retry'|'kindle'|'camp'|'campLeave'|'rise'|'ending'} nm @param {any} state @returns {Promise<any>} */
  function play(nm, state) {
    if (!DEFAULTS[nm]) return Promise.resolve();
    if (nm === 'kindle' && active && name !== 'kindle') return Promise.resolve(); // the glance never interrupts a scene
    if (nm === 'kindle' && active && name === 'kindle' && t < 0.15) return Promise.resolve();
    if ((nm === 'camp' || nm === 'campLeave' || nm === 'ending') && active && name === nm && (t < 0.3 || nm === 'ending')) return Promise.resolve(); // the event and main.js's call in one frame (the ending never restarts itself)
    if (nm === 'kindle' && state?.mode && state.mode !== 'play') return Promise.resolve();
    if (resolveFn) { const r = resolveFn; resolveFn = null; r(name); }
    call(ui, 'setGlance', nm === 'kindle');   // the UI hides the pan prompt during the glance
    name = nm; sc = scene(nm); t = 0; active = true; holding = false; fired = new Set();
    // where the promise resolves: control for intro/troll/retry; the card beat for dawn/fallen (then the lens is held)
    resolveAt = nm === 'dawn' || nm === 'fallen' || nm === 'ending' ? beatAt(sc, 'card', sc.duration) : sc.duration;
    eye(state, startP, startT);
    if (nm === 'kindle' || nm === 'campLeave') planGlance(startP);
    if (nm === 'ending') { planEnding(state); endFirst = state?.ending && typeof state.ending.skippable === 'boolean' ? !state.ending.skippable : !(state?.meta?.ended ?? state?.save?.ended); }
    if (nm === 'fallen') {
      const pl = state?.player;
      fallFeet = pl && Number.isFinite(pl.y) ? pl.y : startP.y - EYE;
      fallYaw = pl && Number.isFinite(pl.yaw) ? pl.yaw : Math.atan2(startT.x - startP.x, startT.z - startP.z);
      cause = pendingCause || (state?.player && state.player.hp <= 0 ? 'player' : 'gate');
      pendingCause = '';
    }
    if (nm === 'kindle') { // an overlay: the HUD and the letterbox stay as they are
      sc = scene('kindle');
    }
    if (nm === 'troll') {
      const tr = state?.troll;
      const end = ARENA.road.points[ARENA.road.points.length - 1];
      trollP.set(end[0], g(end[0], end[1]), end[1]);
      if (tr && Number.isFinite(tr.x)) trollP.set(tr.x, Number.isFinite(tr.y) ? tr.y : g(tr.x, tr.z), tr.z);
    }
    if (nm === 'retry' || nm === 'intro') { if (dawnX !== 0) setDawn(0); call(ui, 'fade', 0, 0.01); }
    const p = new Promise((res) => { resolveFn = res; });
    update(0, state);
    return p;
  }

  /** the fallen cause from EV.FALLEN { cause }: main.js may pass it here (or route events to onEvent) before play('fallen') */
  function setCause(cz) { pendingCause = cz === 'player' ? 'player' : 'gate'; }
  /** optional: main.js may hand the cinema every event; it only reads EV.FALLEN's cause */
  function onEvent(ev, state) {
    if (!ev) return;
    if (ev.type === 'fallen' && ev.cause) setCause(ev.cause);
    // the kindle glance starts itself from the event stream; a second play('kindle') from main.js in
    // the same frame is ignored below
    if (ev.type === 'beacon.kindle' && state) play('kindle', state);
    // DESIGN §9: the camp cinemas start themselves
    if (ev.type === 'camp.enter') play('camp', state);
    if (ev.type === 'camp.leave') { leaveNight = Number(ev.night) || 0; play('campLeave', state); }
    // DESIGN §6.3: the Rainmother's rise (a 4.2 s look down the hill; the sim keeps running)
    if ((ev.type === 'boss.rise' || ev.type === 'rainmother.rise') && state?.mode === 'play' && !(active && name !== 'kindle')) play('rise', state);
    // DESIGN §12: the ending starts itself on the mode change or its first beat
    if ((ev.type === 'mode' && ev.mode === 'ending') || ev.type === 'ending.start' || (ev.type === 'ending.beat' && !(active && name === 'ending'))) play('ending', state);
    if (ev.type === 'mode' && ev.prev === 'ending' && active && name === 'ending') finish();
  }

  function skip() {
    if (!active || name === 'kindle') return false;  // a jump or a skip key never cuts the 1 s kindle glance
    // the caller gates the intro's skip (TIMELINE.intro.skippableAfter, the sim's skipIntro); here a skip always ends it
    if (name === 'ending') return false;   // the sim skips it (the UI sends `skipEnding`); the lens follows state.modeT
    if (name === 'camp' || name === 'campLeave') {
      if (name === 'campLeave' && !fired.has('card')) { fired.add('card'); call(ui, 'card', 'night', null, { night: leaveNight || 1 }); }
      finish(); return true;
    }
    if (name === 'intro' || name === 'troll' || name === 'retry' || name === 'rise') {
      if (name === 'intro') { call(ui, 'setLetterbox', false); if (!fired.has('card')) { fired.add('card'); call(ui, 'card', 'night'); } }
      finish();
      return true;
    }
    if ((name === 'dawn' || name === 'fallen') && t < resolveAt) { t = resolveAt; return true; }
    return false;
  }

  /** stop holding the lens (after the dawn / fallen card); play('retry') does this too */
  function release() { if (active) finish(); }

  /** @param {number} dt real seconds @param {any} state @returns {boolean} true while the cinema owns the camera */
  function update(dt, state) {
    if (!active) return false;
    t += Math.max(0, Math.min(0.1, dt || 0));
    if (name === 'ending' && state?.mode === 'ending') { const et = state.ending?.t ?? state.modeT; if (Number.isFinite(et)) t = et; }   // the sim's clock (and its skip)
    for (const bt of sc.beats) if (t >= bt.at && !fired.has(bt.id)) { fired.add(bt.id); beat(bt.id, state); }
    if (name === 'dawn') setDawn(Math.min(1, t / (sc.rise || 5)));
    shoot(state);
    apply();
    if (t >= resolveAt && resolveFn) {
      if (name === 'dawn' || name === 'fallen' || name === 'ending') { holding = true; const r = resolveFn; resolveFn = null; r(name); }
      else { finish(); return true; }
    }
    return true;
  }

  const api = {
    play, skip, update, release, setCause, onEvent,
    get active() { return active; },
    get name() { return name; },
    get holding() { return holding; },
    /** true while a first-person overlay runs (the kindle glance): keep the viewmodel and the HUD */
    get overlay() { return active && name === 'kindle'; },
    /** DESIGN §12: the gloves beat of the ending is first person: main.js shows the viewmodel while this is true */
    get hands() { return active && name === 'ending' && t >= beatAt(sc, 'gloves', 25) && t < beatAt(sc, 'reveal', 29); },
    /** the ending may be skipped (not the first time; after TIMELINE.ending.skippableAfter) */
    get skippable() { return active && name === 'ending' && !endFirst && t >= (Number(sc?.skippableAfter) || 3) && t < beatAt(sc, 'card', 56); },
    get t() { return t; },
    dispose() { if (active) finish(); },
  };
  try { if (typeof window !== 'undefined') /** @type {any} */ (window).__ewCinema = api; } catch { /* tests and tools read it */ }
  return api;
}
