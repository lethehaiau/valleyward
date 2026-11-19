// Fairness (DESIGN §16.2): the self-play bot holds the night (troll dead, dawn) on ≥ 7 of 10 seeds in Node with the CPU
// fire proxy (measured 10/10, and the noisy bot, the human reference, ≥ 6/10); a bot that never uses fire (no Lance, no firebombs, no Sunburst, no barrels) loses: fire matters.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runNight } from './helpers.mjs';

const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

test('the bot holds the night (troll dead, dawn) on ≥ 8/10 seeds (DESIGN §6.2)', () => {
  const rows = SEEDS.map((seed) => { const r = runNight({ seed, maxSeconds: 900 }); return { seed, won: r.won, fell: r.fell, clock: +r.clock.toFixed(1), gate: Math.round(r.gateHp), hp: Math.round(r.hp), kills: r.stats.kills, burned: r.stats.burned, troll: r.troll, level: r.level }; });
  const wins = rows.filter((r) => r.won);
  console.log(`bot: ${wins.length}/10 nights held; ${rows.map((r) => `${r.seed}:${r.won ? 'W' : 'L-' + r.fell}@${r.clock}s gate ${r.gate} kills ${r.kills} burned ${r.burned}`).join(' | ')}`);
  assert.ok(wins.length >= 8, JSON.stringify(rows));
  for (const r of wins) assert.equal(r.troll?.alive, false, `seed ${r.seed}: won with the troll alive`);
  // XP on every kill gives a wall player ≈ 8–12 level-ups a night
  for (const r of rows) assert.ok(r.level - 1 >= 8 && r.level - 1 <= 12, `seed ${r.seed}: ${r.level - 1} level-ups`);
});

test('the noisy bot (the human reference: 250 ms lag + aim noise) holds Night I on 40–55 % of seeds with a fresh save (DESIGN §6.2; 3–6 of 10 allowed)', () => {
  const rows = SEEDS.map((seed) => { const r = runNight({ seed, bot: { noise: true }, maxSeconds: 900 }); return { seed, won: r.won, fell: r.fell, clock: +r.clock.toFixed(1), gate: Math.round(r.gateHp), levelUps: r.level - 1 }; });
  const wins = rows.filter((r) => r.won).length;
  console.log(`noisy bot: ${wins}/10 nights held; ${rows.map((r) => `${r.seed}:${r.won ? 'W' : 'L-' + r.fell}@${r.clock}s gate ${r.gate} lv+${r.levelUps}`).join(' | ')}`);
  assert.ok(wins >= 3 && wins <= 6, JSON.stringify(rows));
});

test('a bot that never uses fire loses (fire matters)', () => {
  for (const seed of SEEDS.slice(0, 5)) {
    const r = runNight({ seed, bot: { useFire: false } });
    assert.equal(r.won, false, `seed ${seed}: the no-fire bot held the night`);
    assert.ok(r.fell, `seed ${seed}: the no-fire bot neither won nor fell (clock ${r.clock})`);
    // (a stray Kestrel shot at a Chieftain may burst an oil barrel: a handful burn, never the night's fire)
    assert.ok(r.stats.burned <= Math.max(10, r.stats.kills * 0.05), `seed ${seed}: ${r.stats.burned} of ${r.stats.kills} burned without fire`);
  }
});

test('a bot that never pulls a gun trigger does not hold the night (guns matter: the troll dies only to guns while it glows)', () => {
  for (const seed of [1, 2, 3]) {
    const r = runNight({ seed, bot: { useGuns: false } });
    assert.equal(r.won, false, `seed ${seed}: the no-gun bot held the night`);
    assert.ok(r.troll?.alive, `seed ${seed}: the troll died without guns`);
  }
});

test('the bot reaches the wall walk from anywhere on the plaza (no stuck waypoint at the foot of the stair)', async () => {
  const { createSim } = await import('../src/sim/sim.js');
  const { createBot } = await import('../src/bot/bot.js');
  for (const [x, z] of [[3, 5], [-9, 12.5], [-9, 14], [-14, 6], [12, 8], [-5, 11]]) {
    const sim = createSim({ seed: 1, god: true, spawnScale: 0 });
    sim.startNight(); sim.teleport(x, z, 0, 0);
    const drive = createBot({ seed: 1, sorties: false, maxKindles: 0 });
    let t = 0;
    for (; t < 60 * 25 && sim.state.player.where !== 'walk'; t++) sim.step(drive(sim.state));
    assert.equal(sim.state.player.where, 'walk', `from (${x}, ${z}): still on the ${sim.state.player.where} at (${sim.state.player.x.toFixed(1)}, ${sim.state.player.z.toFixed(1)}) after 25 s`);
  }
});
