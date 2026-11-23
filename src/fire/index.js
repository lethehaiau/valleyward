// VALLEYWARD · the fire host (the `fire` module; decision docs/decisions/0001). The fire itself lives in fire modules
// (Firewraith's Fire API v1: firewraith/docs/API.md). This host:
//   - picks a module for each slot (`lance`: the Ember Lance's airborne flame, `ground`: the fire on the ground) from
//     ?lance= / ?ground= (?firemod= sets both; default: the edition's reference module, 'classic' in webgl2 and
//     'classic-webgpu' in webgpu), loads it, and creates one instance per module;
//   - falls back to that reference module for a slot whose module is missing, invalid, built for the other edition, or
//     throws (while loading or later in a call); if the reference module itself throws, the fire host fails and main.js keeps
//     the CPU fire grid and the greybox fire, as before;
//   - feeds the instances every frame (events → update → lance), chains their renders (ground, then lance) into the
//     look's fire pass, puts the ground module's light map on every material (FIRELIGHT) and its gameplay grid in front
//     of the sim (`fire`; main.js swaps it with the CPU grid by age).
//   const fire = await createFire({ renderer, quality, style, gpuTiming, params });
//   each frame: fire.events(ops, wind); fire.update(dt, { rain }); fire.lance(state); look: fire.pass.render(r, args)
import * as THREE from 'three';
import { checkInfo, checkModule, API_VERSION } from 'firewraith/api';
import { FIRELIGHT } from '../shared/firelight.js';
import { makeWorld } from './world.js';
import { REGISTRY, fallbackFor, loadModule, pickedModules } from '../core/fire-registry.js';

const SLOT_ORDER = ['ground', 'lance'];   // render order: the ground fire first, the airborne flame over it

/**
 * @param {{ renderer: THREE.WebGLRenderer, edition?: 'webgl2'|'webgpu', quality?: string, style?: string, gpuTiming?: boolean, params?: URLSearchParams, picks?: { lance?: string, ground?: string } }} o
 */
export async function createFire({ renderer, edition = 'webgl2', quality = 'high', style = 'hybrid', gpuTiming = false, params = new URLSearchParams(globalThis.location?.search || ''), picks }) {
  // webgpu modules also get the terrain in TSL (world.groundTSL); world.js stays free of TSL so the WebGL2 bundle never
  // loads it (the webgpu layer is already loaded in that edition: this import costs nothing)
  const world = edition === 'webgpu' ? Object.freeze({ ...makeWorld(), groundTSL: (await import('../gfx/webgpu/index.js')).ewGround }) : makeWorld();
  const FALLBACK = fallbackFor(edition);   // 'classic' in webgl2, 'classic-webgpu' in webgpu
  const want = { ...pickedModules(params, edition), ...(picks || {}) };
  /** slot → { id, ok, state, reason } for __ew.modules() / stats */
  const report = Object.fromEntries(SLOT_ORDER.map((s) => [s, { id: want[s], ok: false, state: 'pending', reason: '' }]));
  /** @type {{ id: string, info: any, mod: any, slots: string[] }[]} */
  let insts = [];
  const S = { style: style === 'hybrid' ? 'hybrid' : 'smooth', quality, rain: 0, time: 0, disposed: false, swapping: 0 };
  const originalLightMap = FIRELIGHT.uFireLightMap.value;
  let tmpRT = null;

  const host = (slots) => ({
    api: API_VERSION, backend: edition, renderer, quality: S.quality, style: S.style, slots: [...slots], world,
    options: { debug: params.has('debug'), gpuTiming, params },
  });

  /** Load + create one module for `slots`; throws with the reason. */
  async function instantiate(id, slots) {
    const code = await loadModule(id);
    const info = code?.info;
    const bad = checkInfo(info);
    if (bad.length) throw new Error(`invalid info: ${bad.join('; ')}`);
    if (info.backend !== edition) throw new Error(`a ${info.backend} module; this is the ${edition} edition (try ?gpu=${info.backend})`);
    const missing = slots.filter((s) => !info.slots.includes(s));
    if (missing.length) throw new Error(`does not fill ${missing.join(', ')} (it fills ${info.slots.join(', ')})`);
    if (typeof code.create !== 'function') throw new Error('exports no create(host)');
    const mod = await code.create(host(slots));
    const p = checkModule(mod, slots);
    if (p.length) { try { mod?.dispose?.(); } catch { /* */ } throw new Error(p.join('; ')); }
    return { id, info, mod, slots: [...slots] };
  }

  /** Create instances for the wanted modules, falling back to classic per slot. */
  async function build() {
    const groups = new Map();   // id → slots
    for (const s of SLOT_ORDER) {
      const id = want[s];
      if (!id) { Object.assign(report[s], { id: null, ok: false, state: 'empty', reason: `no ${edition} fire module picked or listed` }); continue; }
      if (!groups.has(id)) groups.set(id, []); groups.get(id).push(s);
    }
    const fallbackSlots = [];
    for (const [id, slots] of groups) {
      try {
        const inst = await instantiate(id, slots);
        insts.push(inst);
        for (const s of slots) Object.assign(report[s], { id, ok: true, state: 'loaded', reason: '' });
      } catch (e) {
        if (id === FALLBACK) throw e;   // the reference module failed: the whole fire host falls back (CPU fire grid)
        console.warn(`[ew] fire module "${id}" (${slots.join(', ')}) ${FALLBACK ? `fell back to ${FALLBACK}` : 'failed (no fallback in this edition)'}:`, e);
        for (const s of slots) Object.assign(report[s], { id: FALLBACK || null, ok: !!FALLBACK, state: FALLBACK ? 'fallback' : 'empty', reason: `${id}: ${e?.message || e}` });
        fallbackSlots.push(...slots);
      }
    }
    // classic fills either slot alone, so the fallen-back slots get their own instance (even beside another classic)
    if (fallbackSlots.length && FALLBACK) insts.push(await instantiate(FALLBACK, fallbackSlots));
    if (!insts.length) throw new Error(`no fire module runs (${SLOT_ORDER.map((s) => `${s}: ${report[s].reason}`).join('; ')})`);
    sortInsts();
  }
  /** Render order: the instance filling `ground` first. */
  function sortInsts() { insts.sort((a, b) => Math.min(...a.slots.map((s) => SLOT_ORDER.indexOf(s))) - Math.min(...b.slots.map((s) => SLOT_ORDER.indexOf(s)))); }

  /** A module threw at runtime: drop it and give its slots to classic (classic throwing fails the fire host). */
  function failed(inst, where, e) {
    if (inst.id === FALLBACK || S.disposed || (!FALLBACK && insts.length <= 1)) throw e;
    console.warn(`[ew] fire module "${inst.id}" threw in ${where}; its slots go to ${FALLBACK || 'nobody'}:`, e);
    insts = insts.filter((i) => i !== inst);
    try { inst.mod.dispose(); } catch { /* */ }
    for (const s of inst.slots) Object.assign(report[s], { id: FALLBACK || null, ok: !!FALLBACK, state: FALLBACK ? 'fallback' : 'empty', reason: `${inst.id} threw in ${where}: ${e?.message || e}` });
    if (!FALLBACK) return;
    S.swapping++;
    instantiate(FALLBACK, inst.slots).then((i) => {
      if (S.disposed) { i.mod.dispose(); return; }
      insts.push(i); sortInsts();
    }).catch((err) => console.warn('[ew] fire: the fallback module failed too', err)).finally(() => { S.swapping--; });
  }
  /** Call into every instance (or the one filling `slot`), catching per instance. */
  function each(fn, where, slot) {
    for (const inst of [...insts]) {
      if (slot && !inst.slots.includes(slot)) continue;
      try { fn(inst.mod, inst); } catch (e) { failed(inst, where, e); }
    }
  }
  const ground = () => insts.find((i) => i.slots.includes('ground')) || null;

  await build();

  const camPos = new THREE.Vector3();
  const pass = {
    /** The look's fire pass: the ground module composites over the scene, the lance module over that. */
    render(r, { colorTex, depthTex, camera, target = null, width, height }) {
      if (S.disposed || !insts.length) return;
      if (insts.length === 1) {
        const inst = insts[0];
        try { inst.mod.render(r, { colorTex, depthTex, camera, target, width, height }); } catch (e) { failed(inst, 'render', e); }
      } else {
        // two modules: ground → tmp, lance → target (each composites over what it is given)
        if (!tmpRT || tmpRT.width !== width || tmpRT.height !== height) {
          tmpRT?.dispose();
          tmpRT = new (r.isWebGLRenderer ? THREE.WebGLRenderTarget : THREE.RenderTarget)(width, height, { type: THREE.HalfFloatType, depthBuffer: false, stencilBuffer: false, generateMipmaps: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
        }
        let src = colorTex;
        insts.forEach((inst, k) => {
          const last = k === insts.length - 1, dst = last ? target : tmpRT;
          try { inst.mod.render(r, { colorTex: src, depthTex, camera, target: dst, width, height }); } catch (e) { failed(inst, 'render', e); }
          src = tmpRT.texture;
        });
      }
      // the fire light at the camera (the first-person hands), from the ground module
      const g = ground();
      if (g?.mod.nearLight) {
        camPos.setFromMatrixPosition(camera.matrixWorld);
        try { g.mod.nearLight(camPos.x, camPos.y, camPos.z, FIRELIGHT.nearCamera); } catch (e) { failed(g, 'nearLight', e); }
      }
    },
  };

  /** The ground module's light map on every patched material (black when it has none). */
  function syncLight() {
    const map = ground()?.mod.lightMap || originalLightMap;
    if (FIRELIGHT.uFireLightMap.value !== map) FIRELIGHT.uFireLightMap.value = map;
  }
  syncLight();

  const api = {
    /** ground: the fire events of every sim tick since the last frame + the wind {x, z} m/s. */
    events(ops, wind) { each((m) => m.events(ops, wind), 'events', 'ground'); },
    /** Advance by game seconds (0 while paused). `ctx.rain` 0..1 (else the last setRain). */
    update(dt, ctx = {}) {
      if (ctx.rain != null) S.rain = ctx.rain;
      S.time += Math.max(0, dt);
      each((m) => m.update(dt, { rain: S.rain, time: S.time }), 'update');
      syncLight();
    },
    /** lance: { on, origin, dir, range, t, hue, landing }. */
    lance(state) { each((m) => m.lance(state), 'lance', 'lance'); },
    setRain(x) { S.rain = Math.max(0, Math.min(1, +x || 0)); },
    pass,
    /** The ground module's gameplay grid (heat/fuel), or undefined: the sim then keeps the CPU fire grid. */
    get fire() { return ground()?.mod.fire; },
    /** Extra: the ending's fire columns, when the ground module has them. */
    get columns() { return ground()?.mod.columns; },
    setStyle(s) { S.style = s === 'hybrid' ? 'hybrid' : 'smooth'; each((m) => m.setStyle?.(S.style), 'setStyle'); },
    setQuality(q) { S.quality = q; each((m) => m.setQuality?.(q), 'setQuality'); },
    stats() {
      const g = ground();
      let st = {};
      try { st = g?.mod.stats?.() || {}; } catch (e) { if (g) failed(g, 'stats', e); }
      const l = insts.find((i) => i !== g && i.slots.includes('lance'));
      let lance;
      try { lance = l?.mod.stats?.(); } catch (e) { if (l) failed(l, 'stats', e); }
      return { ...st, ...(lance && { lance }), style: st.style ?? S.style, modules: api.report() };
    },
    /** Does a module fill this slot? @param {'lance'|'ground'} slot */
    has(slot) { return insts.some((i) => i.slots.includes(slot)); },
    /** slot → { id, ok, state ('loaded'|'fallback'|'empty'), reason }; plus each instance's info. */
    report() { return { ...JSON.parse(JSON.stringify(report)), instances: insts.map((i) => ({ id: i.id, name: i.info.name, version: i.info.version, backend: i.info.backend, slots: i.slots })) }; },
    async warm(r, camera) { for (const inst of [...insts]) { try { await inst.mod.warm?.(r, camera); } catch (e) { failed(inst, 'warm', e); } } },
    reset() { each((m) => m.reset(), 'reset'); FIRELIGHT.nearCamera.setRGB(0, 0, 0); },
    /** The ground module's own debug hooks (benches, perf tools), if it has any. */
    get debug() { return ground()?.mod.debug; },
    get instances() { return insts; },
    dispose() {
      if (S.disposed) return;
      S.disposed = true;
      for (const i of insts) { try { i.mod.dispose(); } catch { /* */ } }
      insts = [];
      tmpRT?.dispose(); tmpRT = null;
      FIRELIGHT.uFireLightMap.value = originalLightMap;
      FIRELIGHT.nearCamera.setRGB(0, 0, 0);
    },
  };
  // ?fluidDebug=1 (benches and perf tools only): the ground module on window
  if (typeof window !== 'undefined' && params.get('fluidDebug') === '1') window.__ewFluid = ground()?.mod;
  return api;
}

export { REGISTRY };
