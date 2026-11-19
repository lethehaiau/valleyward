// Soak (DESIGN §16.2): self-play nights in the browser on a production build, a fresh browser context per seed.
//   tools/gpu-lock.sh node tools/qa/soak.mjs [--port 5359] [--seeds 1-20] [--speed 4] [--extra 'fireproxy=1'] [--no-build]
// A night ends as win (victory), loss (fallen), stuck (mode, clock, kills, gate HP, player HP and troll HP unchanged for
// more than 30 s of sim time) or timeout (8 min of real time); its console and page errors are counted.
// Report: soak.json in .scratch/core (gitignored). The same nights in Node, without a browser: tools/qa/nights.mjs.
import fs from 'node:fs';
import path from 'node:path';
import { startPreview, launch, sleep, ROOT } from './browser.mjs';

const args = process.argv.slice(2);
const valueOf = (name, fallback) => { const at = args.indexOf(`--${name}`); return at < 0 ? fallback : args[at + 1]; };
const PORT = Number(valueOf('port', 5359));
const SPEED = Number(valueOf('speed', 4));
const EXTRA = valueOf('extra', '');                     // more URL parameters, e.g. 'fireproxy=1'
const [FIRST, LAST] = valueOf('seeds', '1-20').split('-').map(Number);   // '7' alone: just seed 7
const OUT = path.join(ROOT, '.scratch', 'core');
const NIGHT_MS = 8 * 60 * 1000, STUCK_SIM_S = 30;

// what the stuck test compares, sampled in the page
const sample = () => {
  const st = __ew.state();
  return { mode: st.mode, t: st.t, clock: st.night.clock, kills: st.stats.kills, gate: Math.round(st.gate.hp),
    hp: Math.round(st.player.hp), troll: st.troll ? Math.round(st.troll.hp) : null };
};

async function soakNight(browser, baseUrl, seed) {
  const isolated = await browser.createBrowserContext();
  const tab = await isolated.newPage();
  await tab.setViewport({ deviceScaleFactor: 1, width: 1280, height: 720 });
  const errors = [];   // (console errors and page errors only: a failed request is not counted here)
  tab.on('console', (msg) => msg.type() === 'error' && errors.push(msg.text()));
  tab.on('pageerror', (err) => { errors.push(err.message); });
  const query = `seed=${seed}&save=fresh&skipintro=1&autoplay=1&speed=${SPEED}&noui=1` + (EXTRA ? `&${EXTRA}` : '');
  await tab.goto(`${baseUrl}?${query}`, { timeout: 120000, waitUntil: 'domcontentloaded' });
  for (let k = 0; k < 1200; k++) {   // up to 2 min for the assets
    if (await tab.evaluate(() => window.__ew?.assetsReady?.()).catch(() => false)) break;
    await sleep(100);
  }

  const started = Date.now();
  let result = 'timeout', s = null, seen = '', seenAt = 0;
  while (Date.now() - started < NIGHT_MS) {
    s = await tab.evaluate(sample);
    const key = `${s.mode}|${s.clock.toFixed(0)}|${s.kills}|${s.gate}|${s.hp}|${s.troll}`;
    if (key !== seen) { seen = key; seenAt = s.t; }
    if (s.mode === 'victory') { result = 'win'; break; }
    if (s.mode === 'fallen') { result = 'loss'; break; }
    if (s.t - seenAt > STUCK_SIM_S) { result = 'stuck'; break; }
    await sleep(500);
  }
  const row = {
    seed, result, clock: +(s?.clock ?? 0).toFixed(1), kills: s?.kills, gate: s?.gate, hp: s?.hp,
    realSeconds: +((Date.now() - started) / 1000).toFixed(1), errorCount: errors.length, errors: errors.slice(0, 4),
  };
  await isolated.close().catch(() => {});
  return row;
}

const server = await startPreview(PORT, path.join(OUT, 'dist'), { build: !args.includes('--no-build') });
const chrome = await launch({ height: 720, width: 1280 });
const rows = [];
try {
  for (let seed = FIRST; seed <= (LAST || FIRST); seed++) {
    rows.push(await soakNight(chrome, server.url, seed));
    console.log(JSON.stringify(rows.at(-1)));
  }
} finally {
  await chrome.close().catch(() => {});
  server.kill();
}

const tally = (result) => rows.filter((r) => r.result === result).length;
const summary = { speed: SPEED, nights: rows.length, wins: tally('win'), losses: tally('loss'), stuck: tally('stuck'),
  timeouts: tally('timeout'), consoleErrors: rows.reduce((n, r) => n + r.errorCount, 0) };
const reportFile = path.join(OUT, 'soak.json');
fs.mkdirSync(path.dirname(reportFile), { recursive: true });
fs.writeFileSync(reportFile, JSON.stringify({ summary, rows }, null, 1));
console.log('soak:', JSON.stringify(summary));
