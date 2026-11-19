// DESIGN §6.3: the Rainmother's HP is fixed (NIGHTS[9].bossHp) whatever the save,
// the scaling by the save's power is gone, and Night X's goblins are the strongest (×5.5 HP, ×3.25 damage, fire ×0.5).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSim, NO_INPUT } from '../src/sim/sim.js';
import { nightScale } from '../src/sim/constants.js';
import { NIGHTS } from '../src/shared/meta.js';

test('DESIGN §16: the Rainmother has her night\'s fixed HP for every save; Night X goblins ×5.5 HP', () => {
  for (const save of ['fresh', 'mid', 'endgame']) {
    const sim = createSim({ seed: 3, spawnScale: 0, god: true, save }); sim.goto('night10'); sim.setClock(29);
    for (let i = 0; i < 60 * 3; i++) { sim.step(NO_INPUT); sim.drainEvents(); }
    assert.equal(sim.state.boss.hpMax, NIGHTS[9].bossHp, save); assert.equal(sim.state.night.hpMul, 1);
  }
  const s = nightScale(10); assert.ok(Math.abs(s.hp - 5.5) < 1e-9 && Math.abs(s.dmg - 3.25) < 1e-9 && s.burn === 0.5);
});
