// VALLEYWARD · the core's stand-in for src/cinema/ (used only while it is missing or throws): the intro glide up the
// valley road to the spawn on TIMELINE.intro's times; the troll, dawn and fallen beats leave the first-person lens alone.
import * as THREE from 'three';
import { ARENA, BODY, groundHeight } from '../shared/arena.js';
import { TIMELINE } from '../shared/timeline.js';

const ease = (x) => x * x * (3 - 2 * x);

export function createFallbackCinema({ camera }) {
  let active = null, t = 0;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), la = new THREE.Vector3(), lb = new THREE.Vector3();
  const P = [[29, groundHeight(29, 70) + 6, 72], [26, groundHeight(26, 30) + 4, 30], [ARENA.playerSpawn.x - 2, BODY.player.eye + 0.6, ARENA.playerSpawn.z]];
  const L = [[18, 4, 6], [6, 3, 4], [ARENA.playerSpawn.x + 10, BODY.player.eye, ARENA.playerSpawn.z - 0.6]];
  return {
    play(name) { t = 0; active = name === 'intro' ? 'intro' : null; return Promise.resolve(); },
    skip() { active = null; },
    /** Returns true while it owns the camera. */
    update(dt, st) {
      if (active !== 'intro') return false;
      if (st.mode !== 'intro') { active = null; return false; }
      t = st.modeT;
      const D = TIMELINE.intro.duration, u = Math.min(1, t / (D * 0.8));
      const seg = u < 0.5 ? 0 : 1, k = ease(seg === 0 ? u * 2 : (u - 0.5) * 2);
      a.set(...P[seg]); b.set(...P[seg + 1]); la.set(...L[seg]); lb.set(...L[seg + 1]);
      camera.position.lerpVectors(a, b, k);
      camera.lookAt(la.lerp(lb, k));
      return true;
    },
    get active() { return active; },
  };
}
