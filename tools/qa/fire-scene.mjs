// Browser-side fixture. Both modules see the same pose, inputs, and ground burst.
import { Mesh, MeshBasicMaterial, PlaneGeometry, Vector3 } from 'three';

const POSE = Object.freeze({ x: 3, z: 7.5, yaw: -0.6, pitch: -0.23 });
const BURST = { kind: 'burst', x: 1.6, z: 10.7, r: 2, amount: 1, push: 0 };

async function ticks(count) {
  const start = __ew.state().tick;
  const until = performance.now() + 10000;
  while (__ew.state().tick - start < count) {
    if (performance.now() > until) throw new Error(`Fire fixture stalled while waiting for ${count} game ticks`);
    await new Promise(requestAnimationFrame);
  }
}

function aim(fire, yaw = POSE.yaw) {
  __ew.setInput({ weapon: 3, fire, yaw, pitch: POSE.pitch });
}

export async function replay(slot) {
  __ew.pose(POSE);
  __ew.fireOp(BURST);
  if (slot === 'lance') {
    aim(true); await ticks(12);        // tap
    aim(false); await ticks(30);       // gap
    aim(true);                        // held flame
  }
  await ticks(12);
  __ew.resetPerf();
  await ticks(30);
  if (slot === 'lance') {
    if (!__ew.state().player.jet.on) throw new Error('The Lance did not fire during the replay');
    aim(true, POSE.yaw + Math.PI / 2); await ticks(30);
    aim(false, POSE.yaw + Math.PI / 2); await ticks(30);
    if (__ew.state().player.jet.on) throw new Error('The Lance did not release during the replay');
  } else {
    await ticks(60);
  }
  return __ew.perf();
}

export async function freezeShot(slot) {
  __ew.pose(POSE);
  if (slot === 'lance') aim(true);
  else __ew.fireOp(BURST);
  await ticks(24);
  __ew.pause();
}

export function occlude() {
  const { scene, camera } = __ew;
  camera.updateMatrixWorld();
  const slab = new Mesh(new PlaneGeometry(4, 4), new MeshBasicMaterial({ color: 0x293848, fog: false }));
  slab.position.copy(new Vector3(0, 0, -0.55).applyMatrix4(camera.matrixWorld));
  slab.quaternion.copy(camera.quaternion);
  scene.add(slab);
  return () => { scene.remove(slab); slab.geometry.dispose(); slab.material.dispose(); };
}
