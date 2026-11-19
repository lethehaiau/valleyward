// VALLEYWARD · the actors (docs/DESIGN.md §14.3): everything that moves and is not fire. The pixel-sprite horde, its death
// pops, the Ash Troll (+ its red-hot glow layer), pickups and projectiles in ONE instanced draw (crowd.js), and the
// first-person viewmodel (viewmodel.js) in its own scene. main.js wires it (docs/ACTORS.md §Integration):
//
//   const actors = await createActors({ scene, camera, quality, assetsBase, renderer });
//   look.setViewmodel({ scene: actors.viewmodel.scene, camera: actors.viewmodel.camera });
//   each frame: for (const ev of events) actors.onEvent(ev, state); actors.update(dt, state);
//               actors.viewmodel.update(dt, state, motion);  fluid.jet.set({ origin: actors.sockets.muzzle(), … })
import { Vector3, WebGLRenderTarget } from 'three';
import { loadAtlas, fetchAtlasJson } from './atlas.js';
import { createCrowd } from './crowd.js';
import { createViewmodel } from './viewmodel.js';
import { createTelegraphs } from './telegraph.js';
import { createObelisks, createTowerReader } from './towers.js';
import { createBossLight } from './bosslight.js';

/** Alive caps per quality (DESIGN §5.2). */
/** DESIGN §15.4 (≥ 6,000 alive on high): the instance buffers' size; only the live range is uploaded. */
export const HORDE_CAP = Object.freeze({ high: 10000, medium: 6000, low: 3000 });

/**
 * @param {{ scene: import('three').Scene, camera: import('three').PerspectiveCamera, quality?: 'high'|'medium'|'low',
 *           assetsBase: string, renderer?: import('three').WebGLRenderer }} o
 */
export async function createActors({ scene, camera, quality = 'high', assetsBase, renderer }) {
  const json = await fetchAtlasJson(assetsBase);   // revalidated; names every image by its content hash
  const [atlas, vm] = await Promise.all([loadAtlas(assetsBase, json), createViewmodel({ assetsBase, camera, versions: json?.vm })]);
  const cap = HORDE_CAP[quality] || HORDE_CAP.high;
  const before = new Set(scene.children);
  const crowd = createCrowd({ atlas, scene, camera, cap });
  const tele = createTelegraphs({ scene });
  const obelisks = createObelisks({ scene });      // the Hellfire Obelisk (the Chain Imp is in the crowd draw)
  const readTowers = createTowerReader();
  const bossLight = createBossLight({ scene });   // the Rainmother's cold pool of light
  const own = scene.children.filter((o) => !before.has(o));   // this module's objects in the world scene
  if (renderer) {
    // upload the atlas now; the programs are compiled by warm() (main.js's warmUp), in the variant the look draws
    try { renderer.initTexture?.(atlas.texture); } catch { /* the first frame uploads it */ }
  }
  let lastDt = 0;
  /** The webgpu edition's warm-up (decision 0001). WebGPURenderer's compile (`compileAsync`) walks the visible, unculled
   *  objects only, so this module's hidden parts (the telegraphs, the boss light, the warm-up obelisk) are shown for the
   *  synchronous part of the call, where it collects them. It compiles in the bound target's variant (the canvas while
   *  the webgpu look is off), and the viewmodel is drawn the same way (behind the loading cover). */
  async function warmWebGPU(r, cam) {
    const vis = new Map();
    for (const o of own) o.traverse((q) => { vis.set(q, [q.visible, q.frustumCulled]); q.visible = true; q.frustumCulled = false; });
    let pending = null;
    try { pending = r.compileAsync(scene, cam); } catch (e) { console.warn('[actors] warm', e); }
    finally { for (const [q, [v, f]] of vis) { q.visible = v; q.frustumCulled = f; } }
    try {
      await pending;
      vm.warm(r, r.getRenderTarget());
      r.initTexture?.(atlas.texture);
    } catch (e) { console.warn('[actors] warm', e); }
  }
  const api = {
    /** Per frame, after the events: the horde, corpses, troll, pickups, projectiles. */
    update(dt, state) { lastDt = dt; crowd.update(dt, state); tele.update(dt, state); obelisks.update(dt, readTowers(state)); bossLight.update(dt, state); },
    /** Before control (main.js's warmUp calls it): compile every actors program in the variant the look draws (into a render
     *  target: no tone mapping, linear output; three keys programs on that), incl. the parts that are hidden until first
     *  use (the firebomb pot, the other weapons, the pilot flame, the troll telegraphs). */
    warm(r = renderer, cam = camera) {
      if (!r) return;
      if (r.isWebGPURenderer) return warmWebGPU(r, cam);
      const rt = new WebGLRenderTarget(4, 4);
      const prev = r.getRenderTarget();
      try {
        vm.warm(r, rt);
        r.setRenderTarget(rt);
        r.compile(scene, cam);      // three compiles hidden objects too (traverse), with the bound target's variant
        r.initTexture?.(atlas.texture);
      } catch (e) { console.warn('[actors] warm', e); }
      finally { r.setRenderTarget(prev); rt.dispose(); }
    },
    onEvent(ev, state) { crowd.onEvent(ev, state); vm.onEvent(ev, state); obelisks.onEvent(ev, state); },
    viewmodel: {
      scene: vm.scene,
      camera: vm.camera,
      get organ() { return vm.organ; },
      update(dt, state, motion) { vm.update(dt, state, motion); },
    },
    sockets: {
      /** World position of the current weapon's muzzle or nozzle (a new Vector3 unless `target` is passed). */
      muzzle(target) { return vm.muzzle(target || new Vector3()); },
    },
    /** Extra (not in DESIGN §14.3): tune the sprites' night light from the look/environment ({ ambient, moon } as THREE.Color or hex,
     *  tilt 0..1 toward the camera, fireGain). */
    setLighting({ ambient, moon, tilt, fireGain, maxScreenH, nearFade } = {}) {
      const u = crowd.material.uniforms;
      if (maxScreenH != null) u.uMaxScreenH.value = maxScreenH;                 // melee cap (fraction of the frame height)
      if (nearFade != null) u.uNearFade.value.set(nearFade[0], nearFade[1]);  // [gone at, starts at] metres
      // the night light (crowd.update blends the camp's dusk light over it while state.mode === 'camp')
      if (ambient != null) crowd.night.ambient.set(ambient);
      if (moon != null) crowd.night.moon.set(moon);
      if (tilt != null) u.uTilt.value = tilt;
      if (fireGain != null) u.uSpriteFireGain.value = fireGain;
    },
    /** DESIGN §12, the ending: the actors read `state.ending.t` in mode 'ending' (TIMELINE.ending beats) on its own; `set(t)`
     *  drives the host, the hunt, the demon, Cinder kneeling and the burning gloves from a time instead (null: follow the
     *  sim). Anchors for the lens: the demon stands at `state.player` (≈ 5.4 m), Cinder at `state.ending.cinder` or the
     *  wall's foot below the player, the hunt starts at `state.ending.village` / `ARENA.village` (else (29, 84)). */
    ending: {
      set(t) { crowd.setEnding(t); vm.setEnding?.(t); },
      demonHeight: 5.4,
    },
    stats() { return { instances: crowd.count, corpses: crowd.corpses, telegraphs: tele.count, obelisks: obelisks.count, cap, atlas: atlas.stand ? 'stand-in' : 'generated', dt: lastDt }; },
    /** The crowd mesh and its material (for the look's warm-up and debugging). */
    crowd: crowd.mesh,
    dispose() { crowd.dispose(); tele.dispose(); obelisks.dispose(); bossLight.dispose(); vm.dispose(); atlas.texture.dispose(); atlas.frameTex.dispose(); },
  };
  // tools only (?actorsDebug=1): the API on window, to check sockets.muzzle() against the drawn viewmodel
  if (typeof location !== 'undefined' && /[?&]actorsDebug=1/.test(location.search)) globalThis.__ewActors = { ...api, vm };
  return api;
}
