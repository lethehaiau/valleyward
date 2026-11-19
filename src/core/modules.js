// The part loader (docs/DESIGN.md §14.3). import.meta.glob lists each part's entry, so a missing folder is just absent from
// the table (never a build error); a part is a dynamic import inside try/catch. When one is missing, throws while it loads
// or throws later in a call, the greybox or a core fallback stands in. `report` is what __ew.modules() returns.

/** The parts, in report order. */
export const LANES = ['env', 'look', 'fire', 'actors', 'fx', 'cinema', 'ui', 'audio'];

const ENTRY = import.meta.glob([
  '../env/index.js',
  '../look/index.js',
  '../fire/index.js',
  '../actors/index.js',
  '../fx/index.js',
  '../cinema/index.js',
  '../ui/index.js',
  '../audio/index.js',
]);
const entryOf = (lane) => ENTRY[`../${lane}/index.js`];

/** lane -> { ok, state: 'pending' | 'loaded' | 'fallback' | 'failed', reason, ms? }, updated in place
 *  @type {Record<string, { ok: boolean, state: string, reason: string, ms?: number }>} */
export const report = {};
for (const lane of LANES) report[lane] = { ok: false, state: 'pending', reason: '' };

/** Record a lane's outcome; `ms` only when it was timed. */
function mark(lane, ok, state, reason, ms) {
  const row = report[lane];
  Object.assign(row, ms === undefined ? { ok, state, reason } : { ok, state, reason, ms });
}
const say = (lane, what, e) => console.warn(`[ew] lane ${lane} ${what}`, e);
const messageOf = (e) => e?.message || e;
const never = () => false;

/** Downloads already started, by lane (DESIGN §15). */
const started = new Map();

/** DESIGN §15: request every part's chunk at once, a hand-made modulepreload, so the parts created later (fx, cinema)
 *  are not left waiting for the first group before their downloads even begin. A failed download is left for
 *  `loadLane` to report. */
export function prefetchLanes(lanes = LANES, skip = never) {
  for (const lane of lanes) {
    const load = entryOf(lane);
    if (!load || skip(lane) || started.has(lane)) continue;
    const pending = load();
    pending.catch(never);   // (loadLane reports it)
    started.set(lane, pending);
  }
}

/** Is the part's entry file in this build? */
export const present = (lane) => Boolean(entryOf(lane));

/**
 * Load one part: import its entry, then `factory(module)`. Resolves to the instance, or null when the fallback stands in.
 * @param {string} lane @param {(m: any) => any} factory @param {{ disabled?: string }} [options]
 */
export async function loadLane(lane, factory, options = {}) {
  const off = options.disabled;
  if (off) { mark(lane, false, 'fallback', off); return null; }
  const load = entryOf(lane);
  if (!load) { mark(lane, false, 'fallback', `src/${lane}/index.js missing`); return null; }
  const since = performance.now();
  const took = () => Math.round(performance.now() - since);
  let instance = null;
  try {
    const mod = await (started.get(lane) || load());
    instance = await factory(mod);
    if (!instance) throw new Error('factory returned nothing');
  } catch (e) {
    mark(lane, false, 'fallback', `threw while loading: ${messageOf(e)}`, took());
    say(lane, 'fell back:', e);
    return null;
  }
  mark(lane, true, 'loaded', '', took());
  return instance;
}

/** A part threw during a call: it is marked failed (once) and its caller switches to the fallback. */
export function failLane(lane, where, error) {
  if (report[lane].state === 'failed') return;
  mark(lane, false, 'failed', `threw in ${where}: ${messageOf(error)}`);
  say(lane, `threw in ${where}; using the fallback from now on:`, error);
}
