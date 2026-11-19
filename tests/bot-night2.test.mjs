// DESIGN §16.2: Night II (×1.35 spawns, goblins ×1.5 HP, Dousers, Hexers, two trolls) is a wall for
// the `mid` save (Hide 2, Lance 2, an Obelisk + a Chain Imp, 2 charms, a Night I card set) without more upgrades: the
// noisy bot holds ≤ 3/10 (measured 0/10), the perfect bot can still do it (measured 3/10).
// Its own file so node --test runs it beside the Night I bot tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runNight } from './helpers.mjs';

const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

test('DESIGN §16: Night II with the mid save is a wall without more upgrades — the noisy bot holds ≤ 3/10, the perfect bot ≥ 2/10', () => {
  const row = (r, seed) => ({ seed, night: r.night, won: r.won, fell: r.fell, clock: +r.clock.toFixed(1), gate: Math.round(r.gateHp), hp: Math.round(r.hp), kills: r.stats.kills, trolls: r.stats.trollsKilled || 0, air: r.stats.airKills || 0 });
  const bot = SEEDS.map((seed) => row(runNight({ seed, save: 'mid', maxSeconds: 900 }), seed));
  const noisy = SEEDS.map((seed) => row(runNight({ seed, save: 'mid', maxSeconds: 900, bot: { noise: true } }), seed));
  const w = (rows) => rows.filter((r) => r.won).length;
  console.log(`Night II (mid save): bot ${w(bot)}/10, noisy ${w(noisy)}/10; bot ${bot.map((r) => `${r.seed}:${r.won ? 'W' : 'L'}@${r.clock}s gate ${r.gate} trolls ${r.trolls} air ${r.air}`).join(' | ')} || noisy ${noisy.map((r) => `${r.seed}:${r.won ? 'W' : 'L'}@${r.clock}s gate ${r.gate}`).join(' | ')}`);
  for (const r of bot) assert.equal(r.night, 2);
  assert.ok(w(bot) >= 2, JSON.stringify(bot));
  assert.ok(w(noisy) <= 3, JSON.stringify(noisy));
  for (const r of bot.filter((x) => x.won)) assert.equal(r.trolls, 2, `seed ${r.seed}: dawn with ${r.trolls} trolls dead`);
});
