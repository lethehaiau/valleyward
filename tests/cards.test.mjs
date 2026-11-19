// The level-up card pool (DESIGN §10): ≥ 16 cards, unique ids, three distinct eligible cards per level, every card applies.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CARDS, drawCards } from '../src/sim/cards.js';
import { createSim } from '../src/sim/sim.js';

test('≥ 16 cards with unique ids, names and texts', () => {
  assert.ok(CARDS.length >= 16, `${CARDS.length} cards`);
  assert.equal(new Set(CARDS.map((c) => c.id)).size, CARDS.length);
  for (const c of CARDS) assert.ok(c.name && c.text && typeof c.apply === 'function', c.id);
});

test('draws 3 distinct eligible cards; every card applies; maxed cards leave the pool', () => {
  const sim = createSim({ seed: 9 });
  sim.startNight();
  const ctx = sim.ctx;
  for (let k = 0; k < 40; k++) {
    const ids = drawCards(ctx, sim.state.taken);
    assert.equal(new Set(ids).size, ids.length);
    assert.ok(ids.length === 3 || ids.length === CARDS.filter((c) => (sim.state.taken[c.id] || 0) < c.max).length);
    for (const id of ids) { const c = CARDS.find((x) => x.id === id); assert.ok(!c.when || c.when(ctx), `${id} not eligible`); }
    const id = ids[0]; CARDS.find((c) => c.id === id).apply(ctx); sim.state.taken[id] = (sim.state.taken[id] || 0) + 1;
  }
  for (const c of CARDS) assert.ok((sim.state.taken[c.id] || 0) <= c.max, `${c.id} taken more than ${c.max}`);
  assert.ok(sim.state.player.hpMax >= 100);
});
