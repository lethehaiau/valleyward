// @ts-check
// Seeded RNG (mulberry32). The sim never uses the global random generator: every random number comes from here, so a seed replays.
/** @param {number} seed */
export function createRng(seed) {
  let a = (seed >>> 0) || 1;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    range: (lo, hi) => lo + (hi - lo) * next(),
    int: (n) => Math.floor(next() * n),
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    gauss: () => (next() + next() + next() - 1.5) * 0.8165,
    get seed() { return a; },
    set seed(v) { a = v >>> 0; },
  };
}
