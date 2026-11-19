// DESIGN §15 performance, the pure parts: the 60 fps frame cap with an accumulator
// (30 fps behind a modal), the pixel budget, the cap-aware resolution governor, the lock-delta
// outlier. Node.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createFrameCap, budgetDpr, createResolutionGovernor, watchDpr } from '../src/core/resolution.js';
import { lockOutlier } from '../src/core/input.js';
import { PARAMS } from '../src/core/params.js';

const drawn = (hz, fps, seconds = 2, jitter = 0) => {
  const cap = createFrameCap(0); const times = []; let t = 0;
  for (let k = 1; k <= hz * seconds; k++) { t = k * 1000 / hz + (k % 2 ? jitter : -jitter); if (cap.draw(t, fps)) times.push(t); }
  const gaps = times.slice(1).map((x, i) => x - times[i]);
  return { n: times.length, min: Math.min(...gaps), max: Math.max(...gaps) };
};

test('60 fps by default; a 120 Hz display draws every other frame, evenly; 60 Hz every frame; ?fps=0 every frame', () => {
  assert.equal(PARAMS.fps, 60);
  const r120 = drawn(120, 60); assert.ok(Math.abs(r120.n - 120) <= 1 && r120.min > 16 && r120.max < 17.5, JSON.stringify(r120));
  const r60 = drawn(60, 60, 2, 0.4); assert.ok(r60.n >= 119, `60 Hz with jitter: ${JSON.stringify(r60)}`);
  const r144 = drawn(144, 60); assert.ok(Math.abs(r144.n - 120) <= 2 && r144.max < 21, `144 Hz: ${JSON.stringify(r144)}`);
  const unc = drawn(120, 0); assert.equal(unc.n, 240);
});

test('behind a modal the world draws at 30 fps (every other frame at 60 Hz, every fourth at 120 Hz)', () => {
  const a = drawn(60, 30); assert.ok(Math.abs(a.n - 60) <= 1 && a.min > 32 && a.max < 34.5, JSON.stringify(a));
  const b = drawn(120, 30); assert.ok(Math.abs(b.n - 60) <= 1, JSON.stringify(b));
});

test('high draws at most a 1920 × 1080 budget (a 1512 × 860 window at DPR 2: 2.93 MP → ≤ 2.07 MP); medium and low smaller', () => {
  const d = budgetDpr('high', 2, 1512, 860), px = 1512 * 860 * d * d;
  assert.ok(d < 1.5 && px <= 1920 * 1080 + 1 && px > 1920 * 1080 * 0.99, `dpr ${d}, ${(px / 1e6).toFixed(2)} MP`);
  assert.equal(budgetDpr('high', 1, 1280, 720), 1, 'a small window at DPR 1 stays 1');
  assert.equal(budgetDpr('high', 2, 1280, 720), 1.5, 'the 1.5 ceiling holds');
  assert.ok(budgetDpr('medium', 2, 1512, 860) < d && budgetDpr('low', 2, 1512, 860) < budgetDpr('medium', 2, 1512, 860));
  assert.ok(budgetDpr('high', 1, 3840, 2160) < 1, '4K at DPR 1 draws below 1');
});

test('the governor judges against the cap; uncapped (target 0) it holds the full resolution', () => {
  const run = (g, dt, n = 600) => { let d; for (let i = 0; i < n; i++) d = g(dt); return d; };
  assert.equal(run(createResolutionGovernor(1.5), 1 / 60), 1.5, 'steady 60 at a 60 cap');
  assert.ok(run(createResolutionGovernor(1.5), 0.025) < 1.5, '25 ms frames at a 60 cap step down');
  assert.equal(run(createResolutionGovernor(1.5, { target: 1 / 30 }), 1 / 30), 1.5, 'steady 30 at a 30 cap');
  assert.equal(run(createResolutionGovernor(1.5, { target: 0 }), 0.03), 1.5, 'uncapped: back-pressure is not load');
});

test('a huge first delta after a pointer lock is an outlier; ordinary ones are not', () => {
  assert.equal(lockOutlier(600, []), true); assert.equal(lockOutlier(60, []), false);
  const h = [3, 5, 4, 6, 5, 7, 4];
  assert.equal(lockOutlier(30, h), false); assert.equal(lockOutlier(500, h), true);
});

test('a device-pixel-ratio change alone (another display) re-runs the budget; the query is re-armed at the new ratio', () => {
  // a stub window: matchMedia returns queries that remember their listeners; a "move to another display" changes the
  // ratio and fires the armed query's change listeners (no resize event)
  const queries = [];
  const win = { devicePixelRatio: 1, matchMedia(q) { const mq = { q, ls: new Set(), addEventListener: (t, f) => mq.ls.add(f), removeEventListener: (t, f) => mq.ls.delete(f) }; queries.push(mq); return mq; } };
  const seen = [];
  const stop = watchDpr(win, (d) => seen.push({ d, budget: budgetDpr('high', d, 1512, 860) }));
  assert.equal(queries.length, 1); assert.equal(queries[0].q, '(resolution: 1dppx)'); assert.equal(queries[0].ls.size, 1);
  const move = (d) => { const armed = queries.filter((m) => m.ls.size); win.devicePixelRatio = d; for (const m of armed) for (const f of [...m.ls]) f(); };
  move(2);
  assert.deepEqual(seen.map((x) => x.d), [2]); assert.ok(seen[0].budget < 1.5 && seen[0].budget > 1.2, `the budget at DPR 2: ${seen[0].budget}`);
  assert.equal(queries.at(-1).q, '(resolution: 2dppx)'); assert.equal(queries[0].ls.size, 0, 'the old query let go');
  assert.equal(queries.filter((m) => m.ls.size).length, 1, 'exactly one armed query');
  move(1);
  assert.deepEqual(seen.map((x) => x.d), [2, 1]); assert.equal(seen[1].budget, 1);
  stop(); assert.equal(queries.filter((m) => m.ls.size).length, 0, 'stopped: nothing armed');
  // no matchMedia (Node, an old browser): a no-op
  assert.doesNotThrow(() => watchDpr({ devicePixelRatio: 1 }, () => {})());
});
