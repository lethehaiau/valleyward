#!/usr/bin/env node
// VALLEYWARD · the environment in the real game: the camp at dusk, Night II's blood moon, the hints, driven by the game's
// `__ew.goto('camp'|'night1'|'night2')` + `__ew.teleport(x, z, yaw, pitch)`. Production build into a scratch folder,
// served on the env bench port (5354; stop the bench preview first). From the repo root, under the GPU lock:
//   (npx vite build --outDir <DIST> --emptyOutDir; DIST is set below)
//   tools/gpu-lock.sh node preview/env.game.mjs [--out <dir>] [--only a,b] [--perf]
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = APP;
const require = createRequire(path.join(ROOT, 'package.json'));
const puppeteer = require('puppeteer-core');
const sharp = require('sharp');
const { CHROME, chromeGLArgs } = await import(path.join(ROOT, 'tools/platform.mjs'));
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const DIST = path.join(ROOT, '.scratch/env/game-dist');
const OUT = path.resolve(ROOT, arg('out', '.scratch/env/game'));
const ONLY = arg('only', '') ? arg('only', '').split(',') : null;
const PERF = process.argv.includes('--perf');
fs.mkdirSync(OUT, { recursive: true });
const PORT = 5354;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const server = spawn(process.execPath, [path.join(ROOT, 'node_modules/vite/bin/vite.js'), 'preview', '--outDir', DIST, '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'],
  { cwd: APP, stdio: ['ignore', 'pipe', 'pipe'] });
let slog = ''; server.stdout.on('data', (d) => { slog += d; }); server.stderr.on('data', (d) => { slog += d; });
const base = `http://127.0.0.1:${PORT}/index.html`;
let up = false;
for (let i = 0; i < 80 && !up; i++) { try { up = (await fetch(base)).ok; } catch { /* not yet */ } if (!up) await sleep(250); }
if (!up) { server.kill('SIGTERM'); console.error(slog); process.exit(1); }

// [name, goto, teleport [x, z, yaw, pitch] | null, extra setup (in page), wait ms]
const SHOTS = [
  ['camp_plaza', 'camp', [7, 7.5, -1.68, -0.04], null, 3500],
  ['camp_east', 'camp', [-19.5, 8.2, 1.95, -0.06], null, 3000],
  ['camp_stall', 'camp', [-12.6, 8.6, -2.28, -0.12], null, 3000],
  ['camp_pad', 'camp', [-5.5, 8.6, -0.2, -0.55], null, 3000],
  ['camp_shadow', 'camp', [3.4, 1.8, 2.07, -0.28], null, 3000],
  ['n1_m1', 'night1', [3, 5, Math.PI / 2, 0.02], null, 3500],
  ['n2_m1', 'night2', [3, 5, Math.PI / 2, 0.02], null, 3500],
  ['n1_slope', 'night1', [7.5, 8.8, 0.25, -0.2], null, 3000],
  ['n2_slope', 'night2', [7.5, 8.8, 0.25, -0.2], null, 3000],
];
// --set nights: every night's moon at m1, Night IV's rain, the village, the ending's beats (needs the game's
// `__ew.goto('night<n>'|'ending')`; the ending is held with `env.setEndingTime` through `__ew.modules`-free access:
// window.__ewEnv when main.js exposes it, else the shot is the live ending at that moment).
const W4 = [];
for (let n = 1; n <= 10; n++) W4.push([`w4_n${n}`, `night${n}`, [3, 5, Math.PI / 2, 0.02], null, 3000]);
W4.push(['w4_village_n1', 'night1', [-1, -0.9, 0.07, -0.19], null, 3000]);
W4.push(['w4_rain_n4', 'night4', [3, 5, Math.PI / 2, 0.02], 'rain', 3500]);
W4.push(['w4_ending', 'ending', null, 'film', 0]);   // one page: the live ending, frames at its beats
const SET = arg('set', '');
const res = { shots: [], errors: [] };
let browser;
try {
  browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: [...chromeGLArgs(), '--no-first-run', '--window-size=1600,900', '--autoplay-policy=no-user-gesture-required'],
    defaultViewport: { width: 1600, height: 900, deviceScaleFactor: 1 }, protocolTimeout: 240000 });
  for (const [name, where, tp, setup, wait] of (SET === 'nights' ? W4 : SHOTS)) {
    if (ONLY && !ONLY.includes(name)) continue;
    const page = await browser.newPage();
    page.on('console', (m) => { if (m.type() === 'error') res.errors.push(`${name}: ${m.text()}`); });
    page.on('pageerror', (e) => res.errors.push(`${name}: pageerror ${e.message}`));
    await page.goto(`${base}?h3=off${setup === 'film' ? '&ending=1' : ''}`, { waitUntil: 'load', timeout: 120000 });
    await page.waitForFunction(() => window.__ew && typeof window.__ew.goto === 'function', { timeout: 60000 });
    await sleep(800);
    const ok = setup === 'film' ? true : await page.evaluate((w) => window.__ew.goto(w), where);   // the film: ?ending=1 (main.js plays it)
    await sleep(600);
    if (tp) await page.evaluate((t) => window.__ew.teleport(t[0], t[1], t[2], t[3]), tp);
    if (setup === 'rain') await page.evaluate(() => window.__ewEnv?.setRain(1));
    else if (typeof setup === 'string' && setup.startsWith('end:')) await page.evaluate((t) => { const e = window.__ewEnv; if (e?.setEndingTime) e.setEndingTime(t); }, Number(setup.slice(4)));
    else if (setup && setup !== 'film') await page.evaluate(setup);
    if (setup === 'film') {
      // the real ending, played live (the cinema's lens, the actors' host, the environment's sky): a frame at each beat the environment draws
      const t0 = Date.now();
      for (const [beat, at] of [['flood', 2], ['lamp', 9], ['portal', 13.5], ['world', 19], ['host', 21.5], ['reveal', 31], ['cinder', 39], ['hunt', 45], ['card', 58]]) {
        const wait2 = at * 1000 - (Date.now() - t0); if (wait2 > 0) await sleep(wait2);
        const f2 = path.join(OUT, `${name}_${beat}.png`);
        await page.screenshot({ path: f2 });
        const m = await page.evaluate(() => { const e = window.__ewEnv; const s = window.__ew.state(); return { endT: e?.mood?.endT, world: e?.mood?.world, portal: e?.mood?.portal, mode: s.mode, t: s.ending?.t }; });
        res.shots.push({ name: `${name}_${beat}`, file: f2, m });
        console.log(name, beat, JSON.stringify(m));
      }
      await page.close();
      continue;
    }
    await sleep(wait);
    const file = path.join(OUT, `${name}.png`);
    await page.screenshot({ path: file });
    const { data, info } = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    let sum = 0; for (let i = 0; i < data.length; i += 3) sum += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
    const luma = +(sum / (info.width * info.height) / 255).toFixed(3);
    const st = await page.evaluate(() => { const s = window.__ew.state?.(); return s ? { mode: s.mode, night: s.night?.n, near: s.camp?.near } : null; });
    let perf = null;
    if (PERF) perf = await page.evaluate(async () => { const p = window.__ew.perf; return typeof p === 'function' ? p() : p; }).catch(() => null);
    res.shots.push({ name, goto: ok, luma, st, perf, file });
    console.log(name, 'goto', ok, 'luma', luma, JSON.stringify(st), perf ? JSON.stringify(perf).slice(0, 300) : '');
    await page.close();
  }
} finally {
  if (browser) await browser.close();
  server.kill('SIGTERM');
}
fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(res, null, 1));
console.log('errors', res.errors.length, res.errors.slice(0, 10).join('\n'));
