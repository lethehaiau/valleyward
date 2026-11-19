// VALLEYWARD · the fire host · the fire modules this build knows (decision 0001): Firewraith's catalog
// (`firewraith/modules`), so a module merged into Firewraith is listed here with no change to the game. Each module's
// code is a separate chunk that loads only when it is picked. During development any module served from this machine
// can be tried by URL: ?lance=http://localhost:5173/src/index.js (only localhost / 127.0.0.1 / [::1] URLs are accepted).
import { MODULES } from 'firewraith/modules';

/** id → { name, backend, slots, load }. `backend` and `slots` come from the module's light `info`, known before loading,
 *  so the game can boot the right edition. */
export const REGISTRY = Object.freeze(Object.fromEntries(Object.entries(MODULES).map(([id, m]) => [id, Object.freeze({
  name: m.info.name, backend: m.info.backend, slots: Object.freeze([...m.info.slots]), load: m.load,
})])));

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

/** The modules picked for each slot from the URL (?lance=, ?ground=; ?firemod= sets both), else the edition's default
 *  (null: none). @param {URLSearchParams} q @param {'webgl2'|'webgpu'} [edition] */
export function pickedModules(q, edition = 'webgl2') {
  const both = q.get('firemod') || '', def = fallbackFor(edition);
  return { lance: q.get('lance') || both || def, ground: q.get('ground') || both || def };
}
