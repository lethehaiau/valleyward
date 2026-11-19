// VALLEYWARD · viewmodel motion (computed here; src/actors/viewmodel.js draws them): bob {x, y} from the real walking
// speed, sway {x, y} lagging behind the look, recoil (an extra kick on heavy events), switchT (0 = raised; the actors' viewmodel runs
// its own lower/raise on a weapon change, so this passes 0 unless a hard event forces the hands down, e.g. a fall).
// Also the greybox viewmodel (a box gun bottom-right with a muzzle socket) used when src/actors/ is missing.
import * as THREE from 'three';
import { EV } from '../shared/events.js';
import { TIMELINE } from '../shared/timeline.js';

const HANDS_AT = TIMELINE.intro.beats.find((b) => b.id === 'hands')?.at ?? 4.6;

export function createMotion() {
  const m = { bob: { x: 0, y: 0 }, sway: { x: 0, y: 0 }, recoil: 0, switchT: 0 };
  let swX = 0, swY = 0, rec = 0, down = 0;
  return {
    values: m,
    onEvent(ev) {
      if (ev.type === EV.P_HURT && ev.dmg >= 15) rec += 0.6;
      if (ev.type === EV.P_LAND && ev.fall > 1.2) rec += Math.min(0.8, ev.fall * 0.15);
      if (ev.type === EV.P_DEATH) down = 1;
      if (ev.type === EV.RETRY || ev.type === EV.NIGHT_START) down = 0;
    },
    /** @param {number} dt @param {any} st @param {{ph:number, amp:number}} bob @param {number} lookDX px @param {number} lookDY px */
    update(dt, st, bob, lookDX, lookDY) {
      m.bob.x = Math.sin(bob.ph) * 0.011 * bob.amp;
      m.bob.y = -Math.abs(Math.cos(bob.ph)) * 0.014 * bob.amp;
      swX += lookDX * 0.0006; swY += lookDY * 0.0005;
      const k = Math.exp(-dt * 9);
      swX = Math.max(-0.08, Math.min(0.08, swX * k)); swY = Math.max(-0.06, Math.min(0.06, swY * k));
      m.sway.x = -swX; m.sway.y = swY;
      rec *= Math.exp(-dt * 10); m.recoil = rec;
      if (st.mode === 'play' || st.mode === 'cards' || st.mode === 'camp') m.switchT = down;
      else if (st.mode === 'intro' && st.night?.fromCamp) m.switchT = down;   // (DESIGN §9: from the camp the hands stay up through the lamp's cinema)
      else if (st.mode === 'intro') {   // the hands rise at the intro's 'hands' beat
        const u = Math.min(1, Math.max(0, (st.modeT - HANDS_AT) / 0.35));   // an ease-out: the hands are mostly up by 4.75 s
        m.switchT = (1 - u) * (1 - u);
      } else if (st.mode === 'ending' && st.ending) {
        // DESIGN §12: the hands rise for the gloves beat (25 s) and drop again just before the reveal (29 s)
        const t = st.ending.t, up = Math.min(1, Math.max(0, (t - 24.7) / 0.3)), dn = Math.min(1, Math.max(0, (t - 28.7) / 0.3));
        m.switchT = 1 - up * (1 - dn);
      } else m.switchT = 1;
      return m;
    },
  };
}

/** A stand-in viewmodel (when src/actors/ is missing): a box gun bottom-right; its colour names the weapon. */
export function createGreyViewmodel() {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(55, 16 / 9, 0.01, 10);
  scene.add(new THREE.HemisphereLight(0x9fd3e0, 0x302018, 1.6));
  const gun = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ color: 0x6a5a48 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.1, 0.5), mat); body.position.set(0, 0, -0.2); gun.add(body);
  const hand = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.16, 0.12), new THREE.MeshLambertMaterial({ color: 0x4a3326 })); hand.position.set(0, -0.1, 0); gun.add(hand);
  const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0.02, -0.46); gun.add(muzzle);
  gun.position.set(0.22, -0.2, -0.45);
  scene.add(gun);
  const COLORS = { pistol: 0x6a5a48, blunderbuss: 0x7a4a2a, lance: 0x8a7a3a };
  let kick = 0;
  return {
    scene, camera,
    onEvent(ev) { if (ev.type === EV.SHOT) kick = ev.weapon === 'blunderbuss' ? 1 : 0.5; },
    update(dt, st, motion) {
      mat.color.setHex(COLORS[st.player.weapon] || 0x6a5a48);
      kick *= Math.exp(-dt * 14);
      const lower = Math.max(motion?.switchT || 0, 1 - (st.player.switchT ?? 1));
      gun.position.set(0.22 + (motion?.bob?.x || 0) + (motion?.sway?.x || 0), -0.2 + (motion?.bob?.y || 0) + (motion?.sway?.y || 0) - lower * 0.3, -0.45 + kick * 0.05);
      gun.rotation.set(kick * 0.15 + (motion?.recoil || 0) * 0.2, 0, 0);
    },
    muzzle(v) { gun.updateMatrixWorld(); return muzzle.getWorldPosition(v); },
    setAspect(a) { camera.aspect = a; camera.updateProjectionMatrix(); },
  };
}
