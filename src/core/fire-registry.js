// VALLEYWARD · the fire modules known to the boot code and the optional fire host (decision 0001): Firewraith's catalog
// (`firewraith/modules`), so a module merged into Firewraith is listed here with no change to the game. Each module's
// code is a separate chunk that loads only when it is picked. During development any module served from this machine
// can be tried by URL: ?lance=http://localhost:5173/src/index.js (only localhost / 127.0.0.1 / [::1] URLs are accepted).
import { MODULES } from 'firewraith/modules';

// Vite injects this manifest at dev-server startup. Node tests and production builds use the bundled catalog.
const local = typeof __EW_LOCAL_FIRE__ === 'undefined' ? { modules: [], lance: '' } : __EW_LOCAL_FIRE__;
const devEntries = local.modules.map(({ id, name, backend, slots, url }) =>
  [id, Object.freeze({ name, backend, slots: Object.freeze(slots), load: () => import(/* @vite-ignore */ url) })]);
export const DEV_LANCE = local.lance;

/** id → { name, backend, slots, load }. `backend` and `slots` come from the module's light `info`, known before loading,
 *  so the game can boot the right edition. */
const publishedEntries = Object.entries(MODULES).map(([id, m]) => [id, Object.freeze({
  name: m.info.name, backend: m.info.backend, slots: Object.freeze([...m.info.slots]), load: m.load,
})]);
export const REGISTRY = Object.freeze(Object.fromEntries([...publishedEntries, ...devEntries]));

export function devLanceOptions(edition) {
  if (!devEntries.some(([, entry]) => entry.backend === edition && entry.slots.includes('lance'))) return [];
  return Object.entries(REGISTRY)
    .filter(([, entry]) => entry.backend === edition && entry.slots.includes('lance'))
    .map(([id, entry]) => ({ id, name: entry.name }));
}

/** The module a slot falls back to, per edition (also the edition's default): classic, or its WebGPU port. */
export const FALLBACK = Object.freeze({ webgl2: 'classic', webgpu: 'classic-webgpu' });
/** @param {'webgl2'|'webgpu'} edition */
export const fallbackFor = (edition) => FALLBACK[edition] ?? null;

/** A module URL on this machine (a dev server), the only kind of URL the game loads. @param {string} id */
export const isDevUrl = (id) => /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?\//.test(id);

/** Is `id` something the game can load (a listed id or a dev URL)? @param {string} id */
export const isLoadable = (id) => Object.prototype.hasOwnProperty.call(REGISTRY, id) || isDevUrl(id);

/** Load a module's code: { info, create }. @param {string} id */
export async function loadModule(id) {
  if (Object.prototype.hasOwnProperty.call(REGISTRY, id)) return REGISTRY[id].load();
  if (isDevUrl(id)) return import(/* @vite-ignore */ id);
  throw new Error(`no fire module "${id}" (listed: ${Object.keys(REGISTRY).join(', ')}; or a http://localhost URL)`);
}

/** Explicit slot picks, before applying defaults. */
export function requestedModules(q) {
  const both = q.get('firemod') || '';
  return { lance: q.get('lance') || both, ground: q.get('ground') || both };
}

/** The explicit picks, then the compatible dev Lance or each edition's reference. */
export function pickedModules(q, edition = 'webgl2') {
  const picks = requestedModules(q), def = fallbackFor(edition);
  const devLance = REGISTRY[DEV_LANCE]?.backend === edition ? DEV_LANCE : '';
  return { lance: picks.lance || devLance || def, ground: picks.ground || def };
}

/** Switch renderer and keep explicit picks that are known to work on the new backend. */
export function rendererQuery(query, edition) {
  const next = new URLSearchParams(query);
  next.set('gpu', edition);
  next.delete('firemod');
  for (const [slot, id] of Object.entries(requestedModules(query))) {
    const entry = REGISTRY[id];
    if (entry?.backend === edition && entry.slots.includes(slot)) next.set(slot, id);
    else next.delete(slot);
  }
  return next;
}
