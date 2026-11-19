// VALLEYWARD · the first-person camera rig: the eye at BODY.player.eye above the feet, yaw/pitch from the input
// (0.0022 rad/px), FOV 78, a little walk bob, the shake offset; and the fixed capture views (?view=, __ew.view()):
//   m1     on the plaza at ARENA.playerSpawn facing east along the wall (M1's framing: wall left, road ahead, moon right)
//   m2     from the wall walk's west end, leaning far out over the parapet, looking east and down: the gate centre-left
//          below, the beacon tower right of centre, the burning crowd filling the lower middle (M2 mirrored)
//   top    high over the plaza and the road, looking down (layout checks)
//   troll  from the gate's wall top toward the troll (or its spawn on the road)
import * as THREE from 'three';
import { ARENA, BODY, groundHeight } from '../shared/arena.js';

export const VIEWS = Object.freeze({
  m1: { pos: [ARENA.playerSpawn.x, BODY.player.eye, ARENA.playerSpawn.z], yaw: ARENA.playerSpawn.yaw - 0.12, pitch: -0.07, player: 'ground' },
  // from the west end of the wall walk (x −12.4), the eye leaned 9 m out over the parapet and
  // lifted 1 m, looking east (yaw 2.1) and 23° down (pitch −0.40, ≈ 17° more than before): the gate arch centre-left
  // below, the SE beacon tower right of centre, the burning crowd at the gate's foot across the lower middle, the timber
  // stair as the near foreground at the lower left. M2 itself (its walk on the right, the crowd left) is this mirrored:
  // in this arena the beacon stands at the walk's east end, so it can only be on the right looking east
  m2: { pos: [-12.4, 5 + BODY.player.eye, -1.5], yaw: 2.1, pitch: -0.40, player: 'walk', lift: 1.0, lean: 9 },
  top: { pos: [12, 78, 26], yaw: Math.PI, pitch: -1.48 },
  troll: { pos: [4, 9.5, -1.0], target: null },
});

export function createCameraRig(camera, { fov = 78 } = {}) {
  let view = 'play';
  const look = { yaw: ARENA.playerSpawn.yaw, pitch: -0.04 };
  let bobPh = 0, bobAmp = 0;
  /** A key-art pose's extra eye height (m2: leaning out over the parapet); it ends once the player moves away. */
  let pose = null;
  const tgt = new THREE.Vector3();
  camera.rotation.order = 'YXZ';

  function applyFov(f) { if (Math.abs(camera.fov - f) > 1e-3) { camera.fov = f; camera.updateProjectionMatrix(); } }

  return {
    look,
    get view() { return view; },
    setView(name) { view = VIEWS[name] ? name : 'play'; pose = null; return view; },
    /** First-person key-art pose: extra eye height `lift` while the player stays within 0.4 m of (x, z). */
    setPose(x, z, lift, lean = 0) { pose = lift || lean ? { x, z, lift, lean } : null; },
    /** Turn by a look delta (px) at the given sensitivity. */
    turn(dx, dy, sens) { look.yaw -= dx * sens; look.pitch = Math.max(-1.45, Math.min(1.45, look.pitch - dy * sens)); look.yaw = ((look.yaw + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI; },
    /** Sync the look to the player's (bot, teleport, retry). */
    syncTo(p) { look.yaw = p.yaw; look.pitch = p.pitch; },
    /** First person (or a fixed view). shake: { x, y, z, roll, pitch }. */
    update(dt, st, shake) {
      applyFov(fov);
      if (view !== 'play') return fixed(st);
      const p = st.player;
      const sp = p.onGround ? Math.min(1, p.speed / 6) : 0;
      bobAmp += (sp - bobAmp) * Math.min(1, dt * 8);
      bobPh += dt * p.speed * 1.25;
      const by = Math.abs(Math.sin(bobPh)) * 0.045 * bobAmp, bx = Math.sin(bobPh) * 0.025 * bobAmp;
      const fx = Math.sin(look.yaw), fz = Math.cos(look.yaw);
      if (pose && Math.hypot(p.x - pose.x, p.z - pose.z) > 0.4) pose = null;
      const lift = pose ? pose.lift : 0, lean = pose ? pose.lean : 0;
      camera.position.set(p.x - fz * bx + (shake?.x || 0), p.y + BODY.player.eye + lift + by + (shake?.y || 0), p.z + lean + fx * bx + (shake?.z || 0));
      camera.rotation.set(look.pitch + (shake?.pitch || 0), look.yaw + Math.PI, shake?.roll || 0, 'YXZ');
    },
    /** The bob phase and amplitude (the viewmodel uses them). */
    get bob() { return { ph: bobPh, amp: bobAmp }; },
    listener(out) { out.x = camera.position.x; out.y = camera.position.y; out.z = camera.position.z; out.yaw = look.yaw; out.pitch = look.pitch; return out; },
  };

  function fixed(st) {
    const v = VIEWS[view];
    if (view === 'troll') {
      const tr = st.troll, T = tr ? { x: tr.x, y: tr.y + 3.5, z: tr.z } : { x: 29, y: groundHeight(29, 70) + 3, z: 70 };
      camera.position.set(...v.pos);
      tgt.set(T.x, T.y, T.z);
      camera.lookAt(tgt);
      return;
    }
    camera.position.set(...v.pos);
    camera.rotation.set(v.pitch, v.yaw + Math.PI, 0, 'YXZ');
  }
}
