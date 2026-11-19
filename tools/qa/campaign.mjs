// Campaign simulator (DESIGN §16.2): real campaigns, not presets. From a fresh save the bot (noisy = the human reference,
// or the perfect bot) plays consecutive nights in one run, banks gold, shops at the camp with its policy (src/bot/bot.js
// SHOP_PLAN) between nights, and on a fall starts a new run at Night I keeping the upgrades (the roguelite loop). It
// records attempts per night, the nights played to first reach / clear each night, and a snapshot of the save the first
// time each night N in --wall is cleared; `--wall` then plays, from each snapshot, the next nights WITHOUT spending.
//   node tools/qa/campaign.mjs --policy noisy --seeds 1-10 [--max-nights 60] [--wall 1,3,5] [--wall-seeds 1-5] [--out f.jsonl]
//   node tools/qa/campaign.mjs --aggregate f1.jsonl,f2.jsonl,…   (the DESIGN §16.2 tables from the per-campaign lines)
// Node, the CPU fire proxy, deterministic per seed. CPU-heavy: one campaign of 30 nights ≈ 4–6 min; run ≤ 4 at once.
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createSim } from '../../src/sim/sim.js';
import { createBot } from '../../src/bot/bot.js';
import { EV } from '../../src/shared/events.js';

const argv = process.argv.slice(2), opt = (k, d) => (argv.includes(`--${k}`) ? argv[argv.indexOf(`--${k}`) + 1] : d);
const range = (s) => { const [a, b] = String(s).split('-').map(Number); return Array.from({ length: (b || a) - a + 1 }, (_, i) => a + i); };
const POLICY = opt('policy', 'noisy'), MAXN = Number(opt('max-nights', 60)), OUT = opt('out', '');
const WALL = opt('wall', '') ? opt('wall', '').split(',').map(Number) : [], WSEEDS = range(opt('wall-seeds', '1-5'));
const botOpts = (seed, shop) => ({ seed, shop, ...(POLICY === 'noisy' ? { noise: true } : {}) });

/** One campaign from a fresh save (or a snapshot): until Night X falls, `maxNights` nights, or (stopOnFall) the first fall. */
export function campaign(seed, { save = 'fresh', shop = true, maxNights = MAXN, stopOnFall = false, snapAt = [], policy = POLICY, stopAt = 0, stopOnOrgan = false } = {}) {
  const sim = createSim({ seed, quality: 'high', save });
  sim.startNight();
  const bot = createBot({ seed, shop, ...(policy === 'noisy' ? { noise: true } : {}) });
  const r = { seed, policy, shop, nights: 0, falls: 0, attempts: {}, cleared: {}, firstReach: {}, firstClear: {}, seq: [], beatX: false, snaps: {}, earned: 0, goldAt: {}, organAt: null };
  let ticks = 0, cur = 1, done = false;   // (startNight above queued the first NIGHT_START: counted in the loop)
  const cap = (maxNights + 2) * 60 * 480;
  while (!done && ticks < cap) {
    sim.step(bot(sim.state)); ticks++;
    for (const e of sim.drainEvents()) {
      if (e.type === EV.NIGHT_START) {
        cur = e.night; r.nights++; r.attempts[cur] = (r.attempts[cur] || 0) + 1; r.firstReach[cur] ??= r.nights;
        // DESIGN §4.2: the gold curve (gold earned so far at the first reach of each night) and the Organ's purchase
        if (r.goldAt[cur] == null) r.goldAt[cur] = { earned: r.earned, bank: sim.meta.gold };
        if (!r.organAt && sim.meta.organ?.owned) { r.organAt = { night: cur, nights: r.nights, maxNight: Math.max(...Object.keys(r.firstReach).map(Number)) }; if (stopOnOrgan) done = true; }
      } else if (e.type === EV.RUN_END) {
        r.earned += e.goldBanked || 0;
      } else if (e.type === EV.VICTORY) {
        r.seq.push(`${cur}+`); r.cleared[cur] = (r.cleared[cur] || 0) + 1; r.firstClear[cur] ??= r.nights;
        r.earned += e.goldBanked || 0;
        if (stopAt && cur >= stopAt) done = true;
      } else if (e.type === 'ending.start') {
        r.seq.push('10+'); r.cleared[10] = (r.cleared[10] || 0) + 1; r.firstClear[10] ??= r.nights; r.beatX = true; done = true;
      } else if (e.type === EV.FALLEN) {
        r.seq.push(`${cur}x`); r.falls++;
        if (stopOnFall) done = true;
      } else if (e.type === EV.CAMP_ENTER && e.reason === 'dawn' && snapAt.includes(e.nextNight - 1) && !r.snaps[e.nextNight - 1]) {
        r.snaps[e.nextNight - 1] = sim.save();
      }
    }
    if (r.seq.length >= maxNights && sim.state.mode !== 'play') done = true;
    if (stopOnFall && r.seq.length >= 3 && r.seq.every((x) => x.endsWith('+'))) done = true;
  }
  r.ticks = ticks; r.upgrades = { ...sim.meta.upgrades }; r.gold = sim.meta.gold;
  return r;
}

/** The wall: from a snapshot taken when Night N was first cleared, the bot plays on WITHOUT spending, 3 nights at most. */
function wall(snap, N, seeds) {
  return seeds.map((w) => { const c = campaign(1000 + w, { save: snap, shop: false, maxNights: 3, stopOnFall: true }); return c.seq.filter((x) => x.endsWith('+')).length; });
}

const MAIN = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (!MAIN) { /* imported (tests): nothing runs */ } else if (argv.includes('--aggregate')) {
  const rows = opt('aggregate', '').split(',').flatMap((f) => fs.readFileSync(f, 'utf8').trim().split('\n').map((l) => JSON.parse(l)));
  for (const pol of [...new Set(rows.map((r) => r.policy))]) {
    const C = rows.filter((r) => r.policy === pol && r.kind === 'campaign');
    if (!C.length) continue;
    const n1 = C.filter((r) => r.seq[0] === '1+').length;
    console.log(`\n## ${pol} · ${C.length} campaigns (max ${C[0].max} nights)`);
    console.log(`Fresh save, Night I (first attempt): held ${n1}/${C.length}`);
    console.log('| Night | campaigns that cleared it | attempts until the first clear (mean) | nights played to first clear (mean) |');
    for (let n = 1; n <= 10; n++) {
      const cl = C.filter((r) => r.firstClear[n]);
      const att = cl.map((r) => { let a = 0; for (const x of r.seq) { if (x.startsWith(`${n}`) && (x === `${n}+` || x === `${n}x`)) { a++; if (x === `${n}+`) break; } } return a; });
      const mean = (a) => (a.length ? (a.reduce((s, v) => s + v, 0) / a.length).toFixed(2) : '—');
      console.log(`| ${n} | ${cl.length}/${C.length} | ${mean(att)} | ${mean(cl.map((r) => r.firstClear[n]))} |`);
    }
    const reachX = C.filter((r) => r.firstReach[10]).map((r) => r.firstReach[10]);
    console.log(`Reached Night X: ${reachX.length}/${C.length} (nights to first reach: ${reachX.sort((a, b) => a - b).join(', ') || '—'}); beat Night X within ${C[0].max}: ${C.filter((r) => r.beatX).length}/${C.length}`);
    // DESIGN §4.2: the THUNDER ORGAN's purchase (the furthest night reached so far, and nights played, when first carried into a night)
    const O = C.filter((r) => r.organAt);
    if (O.length) {
      const med = (a) => { const b = [...a].sort((x, y) => x - y); return b.length % 2 ? b[(b.length - 1) / 2] : (b[b.length / 2 - 1] + b[b.length / 2]) / 2; };
      console.log(`The Organ bought in ${O.length}/${C.length} campaigns: furthest night reached at purchase ${O.map((r) => r.organAt.maxNight).join(', ')} (median ${med(O.map((r) => r.organAt.maxNight))}); nights played ${O.map((r) => r.organAt.nights).join(', ')} (median ${med(O.map((r) => r.organAt.nights))})`);
    }
    const G = C.filter((r) => r.goldAt);
    if (G.length) for (const n of [3, 4, 5, 6, 7]) { const v = G.map((r) => r.goldAt[n]?.earned).filter((x) => x != null).sort((a, b) => a - b); if (v.length) console.log(`gold earned by the first reach of Night ${n}: median ${v[Math.floor((v.length - 1) / 2)]} (${v[0]}–${v[v.length - 1]})`); }
    const W = rows.filter((r) => r.policy === pol && r.kind === 'wall');
    for (const N of [...new Set(W.map((w) => w.N))].sort((a, b) => a - b)) {
      const res = W.filter((w) => w.N === N).flatMap((w) => w.clears), k = res.length;
      console.log(`Wall after Night ${N} (no spending, ${k} runs from ${W.filter((w) => w.N === N).length} snapshots): N+1 ${res.filter((c) => c >= 1).length}/${k}, N+2 ${res.filter((c) => c >= 2).length}/${k}, N+3 ${res.filter((c) => c >= 3).length}/${k}`);
    }
  }
} else {
  for (const seed of range(opt('seeds', '1-10'))) {
    const t0 = Date.now();
    const c = campaign(seed, { snapAt: WALL });
    const line = { kind: 'campaign', max: MAXN, ...c, snaps: Object.keys(c.snaps), secs: Math.round((Date.now() - t0) / 1000) };
    console.log(JSON.stringify({ seed, nights: c.nights, falls: c.falls, beatX: c.beatX, seq: c.seq.join(' '), upgrades: c.upgrades, secs: line.secs }));
    if (OUT) fs.appendFileSync(OUT, JSON.stringify(line) + '\n');
    for (const N of WALL) {
      if (!c.snaps[N]) continue;
      const clears = wall(c.snaps[N], N, WSEEDS);
      const wl = { kind: 'wall', policy: POLICY, seed, N, clears };
      console.log(JSON.stringify(wl));
      if (OUT) fs.appendFileSync(OUT, JSON.stringify(wl) + '\n');
    }
  }
}
