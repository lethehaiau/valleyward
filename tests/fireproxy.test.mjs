// The CPU fire proxy (DESIGN §14.6): ops make heat; oil catches and burns along a trough; fire decays; the wind drifts it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createFireProxy } from '../src/sim/fireproxy.js';
import { FIRE_OP, BURN } from '../src/shared/fireops.js';

const run = (fp, s, w = { x: 0, z: 0 }) => { for (let i = 0; i < s * 60; i++) { fp.apply([], w); fp.step(1 / 60); } };

test('a burst is hot at once and dies down without fuel', () => {
  const fp = createFireProxy();
  fp.apply([{ kind: FIRE_OP.BURST, x: 5, z: 10, r: 3, amount: 1, push: 5 }]);
  assert.ok(fp.heat(5, 10) >= BURN.threshold);
  run(fp, 6);
  assert.ok(fp.heat(5, 10) < BURN.threshold, `still ${fp.heat(5, 10)}`);
});

test('fuel catches from a spark and the fire runs along the oil', () => {
  const fp = createFireProxy();
  fp.apply([{ kind: FIRE_OP.FUEL, box: { x0: 3, z0: 0.4, x1: 15, z1: 1.6 }, amount: 1 }]);
  run(fp, 1);
  assert.ok(fp.heat(14, 1) < 0.05, 'cold oil stays cold');
  fp.apply([{ kind: FIRE_OP.EMBER, x: 3.6, z: 1, amount: 1 }]);
  run(fp, 8);
  assert.ok(fp.heat(9, 1) >= BURN.threshold, `the middle of the trough did not catch: ${fp.heat(9, 1)}`);
  assert.ok(fp.fuel(4, 1) < 0.9, 'the oil burns away');
});

test('the wind drifts the fire downwind', () => {
  const a = createFireProxy(), b = createFireProxy();
  for (const fp of [a, b]) fp.apply([{ kind: FIRE_OP.FUEL, x: 10, z: 20, r: 2.5, amount: 1 }, { kind: FIRE_OP.BURST, x: 10, z: 20, r: 2, amount: 1, push: 0 }]);
  run(a, 3, { x: 3, z: 0 }); run(b, 3, { x: 0, z: 0 });
  assert.ok(a.heat(14, 20) > b.heat(14, 20) + 0.05, `downwind ${a.heat(14, 20)} vs still ${b.heat(14, 20)}`);
});
