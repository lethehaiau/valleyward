#!/usr/bin/env node
// VALLEYWARD · actors in the real game: production build of the app (the game's vite.config.js) into a scratch folder,
// served on the actors bench port, captured at the key-art views with a big horde, burning goblins, the troll and the Lance.
// Run from the repo root under the GPU lock:
//   (npx vite build --outDir <DIST> --emptyOutDir; DIST is set below)
//   tools/gpu-lock.sh node preview/actors.game.mjs
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = APP;
const require = createRequire(path.join(ROOT, 'package.json'));
const puppeteer = require('puppeteer-core');
const { CHROME, chromeGLArgs } = await import(path.join(ROOT, 'tools/platform.mjs'));
const DIST = path.join(ROOT, '.scratch/actors/game-dist');
const OUT = path.join(ROOT, '.scratch/actors/captures');
fs.mkdirSync(OUT, { recursive: true });
const PORT = 5355;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const server = spawn(process.execPath, [path.join(ROOT, 'node_modules/vite/bin/vite.js'), 'preview', '--outDir', DIST, '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'],
  { cwd: APP, stdio: ['ignore', 'pipe', 'pipe'] });
let slog = ''; server.stdout.on('data', (d) => { slog += d; }); server.stderr.on('data', (d) => { slog += d; });
const base = `http://127.0.0.1:${PORT}/index.html`;
let up = false;
for (let i = 0; i < 80 && !up; i++) { try { up = (await fetch(base)).ok; } catch { /* not yet */ } if (!up) await sleep(250); }
if (!up) { server.kill('SIGTERM'); console.error(slog); process.exit(1); }

const res = { shots: {}, errors: [], modules: null };
let browser;
try {
  browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: [...chromeGLArgs(), '--no-first-run', '--window-size=1920,1080', '--autoplay-policy=no-user-gesture-required'],
    defaultViewport: { width: 1920, height: 1080, deviceScaleFactor: 1 } });
  // cameras placed by teleporting the player (arena yaw: forward = (sin yaw, cos yaw))
  const shots = [
    // the road east of the plaza: the horde comes along the road at the camera (M1's direction, closer)
    ['game_road', '', async (p) => p.evaluate(() => {
      const e = window.__ew; e.setClock(170);
      e.spawn('grunt', 700, 30, 5); e.spawn('imp', 200, 34, 6); e.spawn('spear', 120, 36, 4); e.spawn('brute', 60, 38, 5);
      e.teleport(9, 5, Math.PI / 2, -0.05);
    }), 2500, null],
    ['game_m1', 'view=m1', async (p) => p.evaluate(() => { const e = window.__ew; e.setClock(170); e.spawn('grunt', 700, 24, 8); e.spawn('imp', 200, 26, 10); e.spawn('brute', 60, 28, 12); }), 2500, 'm1'],
    // from the front edge of the wall walk, over the parapet, down at the gate
    ['game_wall', '', async (p) => p.evaluate(() => {
      const e = window.__ew; e.setClock(170); e.spawn('grunt', 1000, 2, 6); e.spawn('imp', 250, -3, 8); e.spawn('brute', 100, 5, 9); e.spawn('spear', 120, 8, 10);
      e.teleport(-5, -0.5, Math.atan2(5, 7), -0.36);
    }), 5000, null],
    ['game_troll', '', async (p) => p.evaluate(() => {
      const e = window.__ew; e.setClock(200); e.troll(); e.spawn('grunt', 300, 28, 7);
      const t = e.state().troll; t.x = 24; t.z = 6; t.y = 0; t.heat = 1.1; t.glowing = true;
      e.teleport(8, 5, Math.atan2(24 - 8, 6 - 5), 0.18);
    }), 1500, null],
  ];
  for (const [name, q, setup, wait, view] of shots) {
    const page = await browser.newPage();
    page.on('console', (m) => { if (m.type() === 'error') res.errors.push(`${name}: ${m.text()}`); });
    page.on('pageerror', (e) => res.errors.push(`${name}: pageerror ${e.message}`));
    page.on('response', (r) => { if (r.status() >= 400 && !/favicon/.test(r.url())) res.errors.push(`${name}: http ${r.status()} ${r.url()}`); });
    await page.goto(`${base}?skipintro=1&noui=1&god=1&seed=2&mute=1${q ? `&${q}` : ''}`, { waitUntil: 'load', timeout: 90000 });
    await page.waitForFunction(() => window.__ew?.assetsReady?.(), { timeout: 90000 });
    await sleep(1500);
    await setup(page);
    if (view) await page.evaluate((v) => window.__ew.view(v), view);
    await sleep(wait);
    await page.evaluate(() => window.__ew.resetPerf());
    await sleep(2000);
    await page.screenshot({ path: path.join(OUT, `${name}.png`) });
    res.shots[name] = await page.evaluate(() => ({ perf: window.__ew.perf(), alive: window.__ew.state().horde.alive, troll: !!window.__ew.state().troll, mode: window.__ew.state().mode }));
    if (!res.modules) res.modules = await page.evaluate(() => window.__ew.modules());
    console.log(name, JSON.stringify(res.shots[name]).slice(0, 400));
    await page.close();
  }
} catch (e) {
  res.errors.push(`fatal: ${e.stack || e}`);
} finally {
  if (browser) await browser.close().catch(() => {});
  server.kill('SIGTERM');
}
fs.writeFileSync(path.join(OUT, 'game_stats.json'), JSON.stringify(res, null, 1));
console.log('modules', JSON.stringify(res.modules)?.slice(0, 600));
console.log(`errors: ${res.errors.length}\n${res.errors.slice(0, 12).join('\n')}`);
