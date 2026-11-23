// VALLEYWARD · the fire modules known to the boot code and the optional fire host (decision 0001): Firewraith's catalog
// (`firewraith/modules`), so a module merged into Firewraith is listed here with no change to the game. Each module's
// code is a separate chunk that loads only when it is picked. During development any module served from this machine
// can be tried by URL: ?lance=http://localhost:5173/src/index.js (only localhost / 127.0.0.1 / [::1] URLs are accepted).
// The P menu's Fire module and ?firemod=<id> pick a whole fire setup, one module per slot. Firewraith's setups
// (`firewraith/setups`) name them. A module without one is a setup of its own: it fills the slots it declares and the
// edition's reference module fills the rest, so a Lance-only module plays over the classic ground fire.
import { checkSetup } from 'firewraith/api';
import { MODULES } from 'firewraith/modules';
import { SETUPS as FIREWRAITH_SETUPS } from 'firewraith/setups';

// Vite only injects a startup Lance override for development.
export const DEV_LANCE = typeof __EW_DEV_LANCE__ === 'undefined' ? '' : __EW_DEV_LANCE__;

/** The fire slots, in menu order. */
export const SLOTS = Object.freeze(['lance', 'ground']);

/** id → { name, backend, slots, load }. `backend` and `slots` come from the module's light `info`, known before loading,
 *  so the game can boot the right edition. */
const entries = Object.entries(MODULES).map(([id, m]) => [id, Object.freeze({
  name: m.info.name, backend: m.info.backend, slots: Object.freeze([...m.info.slots]), load: m.load,
})]);
export const REGISTRY = Object.freeze(Object.fromEntries(entries));
const own = (table, id) => (Object.prototype.hasOwnProperty.call(table, id) ? table[id] : undefined);
/** @param {string} id */
const listed = (id) => own(REGISTRY, id);

/** Firewraith's setups that check out against its catalog: id → { name, backend, slots }. A broken one is skipped. */
export const SETUPS = Object.freeze(Object.fromEntries(Object.entries(FIREWRAITH_SETUPS).filter(([id, setup]) => {
  const problems = checkSetup(id, setup, MODULES);
  if (problems.length) console.warn(`[ew] Firewraith setup "${id}" skipped: ${problems.join('; ')}`);
  return !problems.length;
})));
/** A setup's picks, in slot order. */
const picksOf = (setup) => Object.fromEntries(SLOTS.map((slot) => [slot, setup.slots[slot]]));

/** The module a slot falls back to, per edition (also the edition's default): classic, or its WebGPU port. */
export const FALLBACK = Object.freeze({ webgl2: 'classic', webgpu: 'classic-webgpu' });
/** @param {'webgl2'|'webgpu'} edition */
export const fallbackFor = (edition) => FALLBACK[edition] ?? null;

/** An edition's listed modules, its reference module first, then the catalog's order. @param {string} edition */
function editionModules(edition) {
  const ref = fallbackFor(/** @type {any} */ (edition));
  return entries
    .filter(([, entry]) => entry.backend === edition)
    .sort(([a], [b]) => Number(b === ref) - Number(a === ref));
}

/** The slot picks of setup `id`: Firewraith's setup of that id, else module `id` in the slots it declares and the
 *  edition's reference module in the others. @param {string} id @param {string} edition */
export function setupOf(id, edition, setups = SETUPS) {
  const setup = own(setups, id);
  if (setup?.backend === edition) return picksOf(setup);
  const fills = listed(id)?.slots ?? SLOTS, ref = fallbackFor(/** @type {any} */ (edition));
  return Object.fromEntries(SLOTS.map((slot) => [slot, fills.includes(slot) ? id : ref]));
}

/** The Fire module choices of an edition: a setup per listed module (Firewraith's under the module's id, else its own),
 *  then Firewraith's other setups. @param {string} edition */
export function setupOptions(edition, setups = SETUPS) {
  const modules = editionModules(edition).map(([id, entry]) => {
    const setup = own(setups, id);
    return { id, name: setup?.backend === edition ? setup.name : entry.name, picks: setupOf(id, edition, setups) };
  });
  const combos = Object.entries(setups)
    .filter(([id, setup]) => setup.backend === edition && !listed(id))
    .map(([id, setup]) => ({ id, name: setup.name, picks: picksOf(setup) }));
  return [...modules, ...combos];
}

/** The setup that slot picks amount to (`prefer` when it matches, as two setups may pick the same modules), or '' for a
 *  custom mix. @param {Record<string, string>} picks @param {string} edition @param {string} [prefer] */
export function setupFor(picks, edition, prefer = '', setups = SETUPS) {
  const matches = setupOptions(edition, setups).filter((setup) => SLOTS.every((slot) => setup.picks[slot] === picks[slot]));
  return (matches.find(({ id }) => id === prefer) ?? matches[0])?.id ?? '';
}

/** The listed modules of the edition that can fill one slot. @param {string} edition @param {string} slot */
export function slotOptions(edition, slot) {
  return editionModules(edition)
    .filter(([, entry]) => entry.slots.includes(slot))
    .map(([id, entry]) => ({ id, name: entry.name }));
}

/** Reload query for a whole setup: ?firemod=<id>, dropping the per-slot picks. @param {URLSearchParams} query @param {string} id */
export function setupQuery(query, id) {
  const next = new URLSearchParams(query);
  for (const slot of SLOTS) next.delete(slot);
  next.set('firemod', id);
  return next;
}

/** Reload query for one slot's module, keeping the rest. @param {URLSearchParams} query @param {string} slot @param {string} id */
export function slotQuery(query, slot, id) {
  const next = new URLSearchParams(query);
  next.set(slot, id);
  return next;
}

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

/** Explicit slot picks, before applying defaults. ?firemod= asks for a whole setup: Firewraith's setup of that id, a
 *  listed module for the slots it declares (the reference module fills the others), or a dev URL for both; ?lance= and
 *  ?ground= override one slot. */
export function requestedModules(q, setups = SETUPS) {
  const id = q.get('firemod') || '';
  const setup = own(setups, id), fills = listed(id)?.slots ?? SLOTS;
  const from = (slot) => (!id ? '' : setup ? setup.slots[slot] : fills.includes(slot) ? id : '');
  return { lance: q.get('lance') || from('lance'), ground: q.get('ground') || from('ground') };
}

/** The explicit picks, then the compatible dev Lance (unless a whole setup was asked for) or each edition's reference. */
export function pickedModules(q, edition = 'webgl2') {
  const picks = requestedModules(q), def = fallbackFor(edition);
  const devLance = !q.get('firemod') && REGISTRY[DEV_LANCE]?.backend === edition ? DEV_LANCE : '';
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
