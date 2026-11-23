// URL parameters (docs/DESIGN.md §14.8), read once at load. Every other module asks PARAMS, never location.search.
const query = new URLSearchParams(globalThis.location?.search || '');

/** A number, or `fallback` when the parameter is absent, empty or not a finite number. */
function numberOf(name, fallback) {
  const text = query.get(name);
  if (text === null || text === '') return fallback;
  const value = Number(text);
  return Number.isFinite(value) ? value : fallback;
}
/** On when present, unless it says 0 or false (`?debug` alone counts as on). */
const isOn = (name) => query.has(name) && !['0', 'false'].includes(query.get(name));
const within = (value, lo, hi) => Math.max(lo, Math.min(hi, value));
/** The value when it is one of `allowed`, else `fallback`. */
const choice = (name, allowed, fallback) => (allowed.includes(query.get(name)) ? query.get(name) : fallback);
/** `make()` when the parameter is given at all, else null. */
const ifGiven = (name, make) => (query.has(name) ? make() : null);

function startNight() {
  const n = Number(query.get('night'));
  return n >= 1 && n <= 10 ? Math.floor(n) : null;
}

export const PARAMS = Object.freeze({
  seed: Math.max(1, Math.floor(numberOf('seed', 1))),
  autoplay: isOn('autoplay'),   // the self-play bot plays
  noisy: isOn('noisy'),         // with autoplay: the human-reference bot (aim noise and lag)
  skipintro: isOn('skipintro'), // no title and no intro: straight into the night
  noui: isOn('noui'),
  quality: choice('quality', ['high', 'medium', 'low'], 'high'),
  look: query.get('look') || '',
  greybox: query.get('look') === 'greybox',   // every art part off: the sim's truth
  fire: query.get('fire') === 'smooth' ? 'smooth' : 'hybrid',   // hybrid unless asked (the P menu switches it live)
  fireSet: query.has('fire'),
  view: query.get('view') || '',              // a fixed capture camera: m1, m2, top, troll
  debug: isOn('debug'),                       // the overlay and the gameplay fire grid on the ground
  perf: isOn('perf'),
  gpuPerf: isOn('gpuPerf'),
  firePerf: isOn('firePerf'),
  god: isOn('god'),
  speed: within(numberOf('speed', 1), 0.1, 8),
  fps: within(Math.floor(numberOf('fps', 60)), 0, 240),   // DESIGN §15: the frame cap; 0 draws every display frame
  clock: ifGiven('clock', () => Math.max(0, numberOf('clock', 0))),
  troll: isOn('troll'),
  mute: isOn('mute'),
  proxyFire: isOn('fireproxy'),   // the CPU fire grid stays the gameplay fire even once the module's grid is read back
  fov: within(numberOf('fov', 78), 40, 110),
  warmSkip: (query.get('warmskip') || '').split(',').filter(Boolean),
  // DESIGN §9: start states for tests, tools and captures
  night: ifGiven('night', startNight),        // straight into Night 1..10 of the saved run
  ending: isOn('ending'),                     // DESIGN §14.8: the ending at once
  camp: isOn('camp'),                         // straight into the camp
  cap: ifGiven('cap', () => within(Math.floor(numberOf('cap', 0)), 100, 30000)),   // DESIGN §15.4: the horde's alive cap
  save: choice('save', ['fresh', 'mid', 'rich', 'late', 'endgame'], ''),            // a save preset replaces the save at boot
});
