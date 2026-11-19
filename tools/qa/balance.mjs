// Balance probe: whole nights in Node with the CPU fire proxy, per policy:
//   bot     the self-play bot (perfect aim, no lag)
//   noisy   the human reference: the same bot with a 250 ms reaction lag and aim noise (src/bot/bot.js HUMAN_NOISE)
//   wall    the bot without gem sorties (it never leaves the wall walk except to kindle)
//   nofire  the bot without fire (no Lance, firebombs, Sunburst or barrels)
//   nogun   the bot that never pulls a gun trigger (fire only)
// Reports per night: result, gate and HP at the end, the lowest HP, level-ups, kills, fire's share of kills, the player's
// hurts by source and spear hits. One JSON line per night, then a summary line per policy.
//   node tools/qa/balance.mjs --policy noisy --seeds 1-10 [--save fresh|mid|rich] [--out file.jsonl]
// (--save mid plays Night II of the mid save; the default is a fresh save, Night I)
import fs from 'node:fs';
import { createSim } from '../../src/sim/sim.js';
import { createBot } from '../../src/bot/bot.js';
import { EV } from '../../src/shared/events.js';
import { bossHpMul } from '../../src/sim/run.js';

const argv = process.argv.slice(2), opt = (k, d) => (argv.includes(`--${k}`) ? argv[argv.indexOf(`--${k}`) + 1] : d);
const policies = opt('policy', 'bot,noisy,nofire').split(',');
const [s0, s1] = opt('seeds', '1-10').split('-').map(Number);
const OUT = opt('out', ''), SAVE = opt('save', '');
// tuning probes: --trollHp n, --spawnMul x (this night only; nothing is written)
const FLOOR = Number(opt('floor', -1));   // probe: the night's hpFloor (boss HP × lerp(floor, 1, power))
const TROLLHP = Number(opt('trollHp', 0)), SPAWNMUL = Number(opt('spawnMul', 0)), MAXS = Number(opt('max', 420)), NIGHTN = Number(opt('night', 0)), BOSSHP = Number(opt('bossHp', 0)), BOSSSPEED = Number(opt('bossSpeed', 0));
const BOT = { bot: {}, noisy: { noise: true }, wall: { sorties: false }, nofire: { useFire: false }, nogun: { useGuns: false }, noisywall: { noise: true, sorties: false } };

export function night(seed, botOpts, maxSeconds = 420) {
  const sim = createSim({ seed, quality: 'high', save: SAVE || undefined });
  if (NIGHTN) sim.goto(`night${NIGHTN}`);
  if (TROLLHP || SPAWNMUL || BOSSHP || BOSSSPEED || FLOOR >= 0) sim.ctx.nightCfg = { ...sim.ctx.nightCfg, ...(TROLLHP ? { trollHp: TROLLHP } : {}), ...(SPAWNMUL ? { spawnMul: SPAWNMUL } : {}), ...(BOSSHP ? { bossHp: BOSSHP } : {}), ...(BOSSSPEED ? { bossSpeed: BOSSSPEED } : {}), ...(FLOOR >= 0 ? { hpFloor: FLOOR } : {}) };
  if (FLOOR >= 0 && sim.state.night.power != null) sim.state.night.hpMul = bossHpMul(sim.ctx.nightCfg, sim.state.night.power);   // (goto set it at nightfall)
  if (!NIGHTN) sim.startNight();   // (--night N plays that night of the save's run, started above)
  const drive = createBot({ seed, ...botOpts });
  const hurt = {}, ev = {};
  let ticks = 0, spearHits = 0, end = null, hpMin = sim.state.player.hp, wall = 0;
  while (ticks < maxSeconds * 60) {
    sim.step(drive(sim.state)); ticks++;
    const p = sim.state.player;
    if (p.hp < hpMin) hpMin = p.hp;
    if (p.where === 'walk') wall++;
    for (const e of sim.drainEvents()) {
      ev[e.type] = (ev[e.type] || 0) + 1;
      if (e.type === EV.P_HURT) hurt[e.source] = (hurt[e.source] || 0) + e.dmg;
      if (e.type === EV.SPEAR_HIT && e.target === 'player') spearHits++;
      if (e.type === EV.VICTORY || e.type === 'ending.start') end = 'win';
      if (e.type === EV.FALLEN) end = 'fell:' + e.cause;
    }
    if (end) break;
  }
  const st = sim.state;
  return { seed, night: st.night.n, end: end || 'timeout', clock: Math.round(st.night.clock), gate: Math.round(st.gate.hp), gateMax: st.gate.hpMax, hp: Math.round(st.player.hp), hpMin: Math.round(hpMin),
    levelUps: st.player.level - 1, kills: st.stats.kills, burned: st.stats.burned, firePct: Math.round(100 * st.stats.burned / Math.max(1, st.stats.kills)),
    fireBlowPct: Math.round(100 * (st.stats.killedBy?.fire || 0) / Math.max(1, st.stats.kills)), killedBy: st.stats.killedBy, killedKind: st.stats.killedKind, shots: st.stats.shots, gunKills: st.stats.killedBy?.bullet || 0,
    hurt: Object.fromEntries(Object.entries(hurt).map(([k, v]) => [k, Math.round(v)])), spearHits, spearsThrown: ev[EV.SPEAR_THROW] || 0,
    wallPct: Math.round(100 * wall / Math.max(1, ticks)), kindles: st.stats.kindles, troll: st.troll ? (st.troll.alive ? 'alive' : 'dead') : 'none' };
}

const lines = [];
for (const pol of policies) {
  const rows = [];
  for (let s = s0; s <= s1; s++) {
    const r = { policy: pol, ...night(s, BOT[pol], MAXS) };
    rows.push(r); lines.push(JSON.stringify(r)); console.log(JSON.stringify(r));
  }
  const n = rows.length, avg = (k) => +(rows.reduce((a, r) => a + r[k], 0) / n).toFixed(1);
  const sum = { policy: pol, save: SAVE || 'fresh', night: NIGHTN || null, seeds: `${s0}-${s1}`, wins: rows.filter((r) => r.end === 'win').length, of: n, falls: rows.filter((r) => r.end.startsWith('fell')).map((r) => `${r.seed}:${r.end}@${r.clock}`).join(' '),
    firePct: avg('firePct'), fireBlowPct: avg('fireBlowPct'), gunKills: avg('gunKills'), levelUps: avg('levelUps'), levelUpsRange: `${Math.min(...rows.map((r) => r.levelUps))}-${Math.max(...rows.map((r) => r.levelUps))}`,
    hpMin: avg('hpMin'), hpMinLowest: Math.min(...rows.map((r) => r.hpMin)), gate: avg('gate'), kills: avg('kills'), wallPct: avg('wallPct') };
  lines.push(JSON.stringify({ summary: sum })); console.log('SUMMARY', JSON.stringify(sum));
}
if (OUT) fs.writeFileSync(OUT, lines.join('\n') + '\n');
