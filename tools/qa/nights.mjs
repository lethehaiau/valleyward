// Self-play nights in Node (the CPU fire proxy): node tools/qa/nights.mjs [--seeds=1-10] [--nofire] [--noisy]
// --noisy: the human reference (250 ms reaction lag + aim noise, src/bot/bot.js HUMAN_NOISE). Balance tables: tools/qa/balance.mjs.
import { runNight } from '../../tests/helpers.mjs';
const args = process.argv.slice(2);
const nofire = args.includes('--nofire'), noisy = args.includes('--noisy');
const seeds = (args.find((a) => a.startsWith('--seeds=')) || '--seeds=1-10').slice(8).split('-').map(Number);
let wins = 0;
for (let s = seeds[0]; s <= seeds[1]; s++) {
  const t0 = performance.now();
  const r = runNight({ seed: s, bot: { useFire: !nofire, noise: noisy } });
  if (r.won) wins++;
  console.log(JSON.stringify({ seed: s, won: r.won, fell: r.fell, clock: +r.clock.toFixed(1), hp: Math.round(r.hp), gate: Math.round(r.gateHp), troll: r.troll, lvl: r.level, kills: r.stats.kills, burned: r.stats.burned, kindles: r.stats.kindles, cards: r.stats.cards.join(','), ms: Math.round(performance.now() - t0),
    hurt: r.counts['player.hurt'], spears: r.counts['spear.hit'] }));
}
console.log('wins', wins);
