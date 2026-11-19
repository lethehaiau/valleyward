#!/usr/bin/env node
// VALLEYWARD · actors bench captures + frame numbers on the PRODUCTION build of preview/actors.html.
// Run from the repo root, always under the GPU lock (one Chrome at a time):
//   (npx vite build --config preview/actors.vite.config.js)
//   tools/gpu-lock.sh node preview/actors.capture.mjs [--only name,name] [--perf] [--out <dir>]
// Shots land in OUT (a gitignored scratch folder, set below); stats in OUT/stats.json.
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
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const OUT = path.resolve(arg('out', path.join(ROOT, '.scratch/actors/captures')));
fs.mkdirSync(OUT, { recursive: true });
const PORT = 5355;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// [name, query, actions before the shot (bench.set), wait ms]
const SHOTS = [
  ['m1', 'view=m1&weapon=lance&spray=1', {}, 2500],
  ['close', 'view=close&weapon=pistol', {}, 2500],
  ['far', 'view=far&weapon=pistol', {}, 2500],
  ['wall', 'view=wall&weapon=blunderbuss', {}, 2500],
  ['burning', 'view=close&weapon=lance', { burn: 400 }, 900],
  ['dying', 'view=close&weapon=pistol', { kill: 250 }, 120],
  ['troll', 'view=troll&weapon=pistol&troll=walk', {}, 2000],
  ['troll_glow', 'view=troll&weapon=pistol&glow=1&troll=smash.windup', {}, 2000],
  ['troll_throw', 'view=troll&weapon=pistol&troll=throw.windup', {}, 2000],
  ['troll_stomp', 'view=troll&weapon=pistol&troll=stomp.strike', {}, 2000],
  ['vm_pistol', 'view=close&weapon=pistol&fire=1&n=200', {}, 1500],
  ['vm_blunderbuss', 'view=close&weapon=blunderbuss&n=200', {}, 1500],
  ['vm_lance', 'view=m1&weapon=lance&spray=1&n=200', {}, 1500],
  ['vm_reload', 'view=close&weapon=pistol&n=200', { reload: true }, 450],
  ['vm_throw', 'view=close&weapon=pistol&n=200', { throw: true }, 220],
  ['vm_throw_a', 'view=close&weapon=pistol&n=200', { throw: true }, 110],
  ['vm_throw_b', 'view=close&weapon=pistol&n=200', { throw: true }, 230],
  ['vm_throw_c', 'view=close&weapon=pistol&n=200', { throw: true }, 330],
  ['vm_switch', 'view=close&weapon=pistol&n=200', { weapon: 'lance' }, 110],
  ['nofire', 'view=m1&weapon=lance&fire=0', {}, 2000],
  ['standin', 'view=close&weapon=lance&assets=bad&n=800', {}, 1500],
  ['muzzle_lance', 'view=m1&weapon=lance&marker=1&n=200', {}, 1200],
  ['muzzle_pistol', 'view=m1&weapon=pistol&marker=1&n=200', {}, 1200],
  ['vmo_pistol', 'vmonly=1&weapon=pistol&n=1', {}, 800],
  ['vmo_blunderbuss', 'vmonly=1&weapon=blunderbuss&n=1', {}, 800],
  ['vmo_lance', 'vmonly=1&weapon=lance&spray=1&n=1', {}, 800],
];

// --w2 (DESIGN §9): the new goblins, the banner, Brother Cinder, the towers at levels 1–3, the smouldering gloves
const W2 = [
  ['w2_crowd', 'view=crowd2&weapon=pistol&v2=1&n=1500', {}, 2500],
  ['w2_crowd_burn', 'view=crowd2&weapon=lance&v2=1&n=1500&spray=1', { burn: 250 }, 900],
  ['w2_banner', 'view=banner&weapon=pistol&v2=1&n=300&freeze=1&fire=0', {}, 1200],
  ['w2_camp', 'view=camp&camp=1&towers=1&n=1&weapon=pistol&fire=0', {}, 1500],
  ['w2_camp_talk', 'view=camp&camp=1&towers=1&n=1&weapon=pistol&fire=0', { talk: true }, 300],
  ['w2_lineup', 'view=lineup&towers=line&n=1&weapon=pistol&fire=0&freeze=1', {}, 1500],
  ['w2_lineup_pulse', 'view=lineup&towers=line&n=1&weapon=pistol&fire=0&freeze=1', { pulse: true }, 120],
  ['w2_towers', 'view=towers&towers=1&v2=1&n=1200&weapon=pistol', {}, 4000],
  ['w2_gloves_lance', 'vmonly=1&weapon=lance&spray=1&n=1', {}, 1500],
  ['w2_gloves_game', 'view=m1&weapon=lance&spray=1&v2=1&n=1500', {}, 1800],
  ['w2_gloves_cold', 'vmonly=1&weapon=lance&n=1', {}, 1500],
];
if (argv.includes('--w2')) SHOTS.splice(0, SHOTS.length, ...W2);
// --w3: Bat Gremlins (flying, diving, burning, falling), the Thunder Organ (rest / firing / overheated), towers L1–L5
const W3 = [
  ['w3_air', 'view=air&air=8&n=300&weapon=pistol&fire=0', {}, 1600],
  ['w3_air_dive', 'view=air&air=8&n=300&weapon=pistol&fire=0', {}, 3300],
  ['w3_air_burn', 'view=air&air=8&n=300&weapon=lance&airburn=1', {}, 1600],
  ['w3_air_fall', 'view=air&air=8&n=300&weapon=pistol&fire=0', { airKill: true }, 450],
  ['w3_organ_rest', 'vmonly=1&weapon=organ&n=1', {}, 1200],
  ['w3_organ_fire', 'vmonly=1&weapon=organ&n=1', { spray: true }, 1600],
  ['w3_organ_over', 'vmonly=1&weapon=organ&n=1&over=1', { spray: true }, 900],
  ['w3_organ_hot', 'vmonly=1&weapon=organ&n=1&heat=0.7&fire=0', { spray: true }, 900],
  ['w3_organ_fire_dark', 'vmonly=1&weapon=organ&n=1&fire=0', { spray: true }, 1600],
  ['w3_organ_game', 'view=m1&weapon=organ&n=1500', { spray: true }, 1600],
  ['w3_organ_muzzle', 'view=m1&weapon=organ&marker=1&n=200', {}, 1200],
  ['w3_lineup', 'view=lineup&towers=line&n=1&weapon=pistol&fire=0&freeze=1', {}, 1500],
  ['w3_lineup_camp', 'view=lineup&towers=line&n=1&weapon=pistol&fire=0&freeze=1&camp=1', {}, 1800],
];
if (argv.includes('--w3')) SHOTS.splice(0, SHOTS.length, ...W3);
// --w4 (DESIGN §8): the Siege Rams, the Rainmother (walk, tide, whirl, rise, cracked, lanterns out, collapse), the ending
const W4 = [
  ['w4_ram', 'view=ramv&ram=3&n=20&weapon=pistol&fire=0', {}, 2500],
  ['w4_ram_burn', 'view=ramv&ram=2&ramburn=1&n=100&weapon=lance', {}, 1500],
  ['w4_rain_walk', 'view=rain&boss=1&bossmode=walk&n=300&weapon=pistol&fire=0', {}, 1500],
  ['w4_rain_tide', 'view=rain&boss=1&bossmode=tide&n=300&weapon=pistol&fire=0', {}, 1500],
  ['w4_rain_whirl', 'view=rain&boss=1&bossmode=whirl&n=300&weapon=pistol&fire=0', {}, 1500],
  ['w4_rain_rise', 'view=rain&boss=1&bossmode=rise&n=1&weapon=pistol&fire=0', {}, 800],
  ['w4_rain_crack', 'view=rain&boss=1&bossmode=climb&crack=1&lanterns=2&n=300&weapon=lance', {}, 1500],
  ['w4_rain_dead', 'view=rain&boss=1&bossdead=1&n=1&weapon=pistol&fire=0', {}, 2600],
  ['w4_host', 'view=hostv&ending=24&n=1&weapon=pistol&fire=0&noui=1', {}, 1500],
  ['w4_reveal', 'view=reveal&ending=31&n=1&weapon=pistol&fire=0&vm=0', {}, 1200],
  ['w4_roar', 'view=reveal&ending=34.7&n=1&weapon=pistol&fire=0', {}, 300],
  ['w4_cinder', 'view=reveal&ending=38.4&n=1&weapon=pistol&fire=0', {}, 300],
  ['w4_hunt', 'view=hunt&ending=44&n=1&weapon=pistol&fire=0', {}, 1500],
  ['w4_hands_burn', 'vmonly=1&ending=23.3&n=1&weapon=lance&fire=0', {}, 300],
  ['w4_hands_claws', 'vmonly=1&ending=24.8&n=1&weapon=lance&fire=0', {}, 300],
  ['w4_hands_before', 'vmonly=1&ending=22.0&n=1&weapon=lance&fire=0', {}, 300],
];
if (argv.includes('--w4')) SHOTS.splice(0, SHOTS.length, ...W4);
// --f7 (DESIGN §15): the lossless WebP atlas, and the PNG fallback with actors.webp blocked (`block` aborts matching requests)
const F7 = [
  ['f7_webp', 'view=close&weapon=pistol&n=800', {}, 1500],
  ['f7_png_fallback', 'view=close&weapon=pistol&n=800', { block: 'sprites/actors.webp' }, 1500],
];
if (argv.includes('--f7')) SHOTS.splice(0, SHOTS.length, ...F7);
const PERF_W4 = [['end_none', 'view=hostv&n=2500&weapon=pistol', {}], ['end_host', 'view=hostv&ending=38&n=2500&weapon=pistol', {}], ['end_hunt', 'view=hunt&ending=46&n=2500&weapon=pistol', {}]];
const PERF_W3 = [['m1_1', 'view=m1&weapon=pistol&n=1', {}], ['m1_2500', 'view=m1&weapon=pistol&n=2500', {}], ['m1_6000', 'view=m1&weapon=pistol&n=6000', {}],
  ['m1_10000', 'view=m1&weapon=pistol&n=10000', {}], ['far_10000', 'view=far&weapon=pistol&n=10000', {}]];

const server = spawn(process.execPath, [path.join(ROOT, 'node_modules/vite/bin/vite.js'), 'preview', '--config', 'preview/actors.vite.config.js'],
  { cwd: APP, stdio: ['ignore', 'pipe', 'pipe'] });
let slog = ''; server.stdout.on('data', (d) => { slog += d; }); server.stderr.on('data', (d) => { slog += d; });
const base = `http://127.0.0.1:${PORT}/preview/actors.html`;
let up = false;
for (let i = 0; i < 80 && !up; i++) { try { up = (await fetch(base)).ok; } catch { /* not yet */ } if (!up) await sleep(250); }
if (!up) { server.kill('SIGTERM'); console.error(slog); process.exit(1); }

const results = { when: new Date().toISOString(), shots: {}, perf: null, errors: [] };
let browser;
const launch = (uncapped) => puppeteer.launch({
  executablePath: CHROME, headless: true,
  args: [...chromeGLArgs(), '--no-first-run', '--no-default-browser-check', '--window-size=1920,1080', ...(uncapped ? ['--disable-gpu-vsync', '--disable-frame-rate-limit'] : [])],
  defaultViewport: { width: 1920, height: 1080, deviceScaleFactor: 1 },
});
try {
  let only = arg('only', null)?.split(',');
  // --perf-only still captures the stand-in fallback shot (the module with its art folder missing)
  if (argv.includes('--perf-only')) only = ['standin'];
  {
    browser = await launch(false);
    for (const [name, q, act, wait] of SHOTS) {
      if (only && !only.includes(name)) continue;
      const page = await browser.newPage();
      const { block, ...setAct } = act;
      if (block) {
        await page.setRequestInterception(true);
        page.on('request', (r) => (r.url().includes(block) ? r.abort() : r.continue()));
      }
      const atlasReqs = [];
      page.on('response', (r) => { if (r.url().includes('sprites/actors.')) atlasReqs.push(`${r.status()} ${r.url().split('/').pop()} ${r.headers()['content-type'] || ''}`); });
      page.on('console', (m) => { if (m.type() === 'error') results.errors.push(`${name}: ${m.text()}`); });
      page.on('pageerror', (e) => results.errors.push(`${name}: pageerror ${e.message}`));
      page.on('response', (r) => { if (r.status() >= 400) results.errors.push(`${name}: http ${r.status()} ${r.url()}`); });
      await page.goto(`${base}?${q}&noui=1`, { waitUntil: 'load', timeout: 60000 });
      await page.waitForFunction(() => window.__bench?.ready, { timeout: 30000 });
      await sleep(1200);
      if (Object.keys(setAct).length) await page.evaluate((a) => window.__bench.set(a), setAct);
      await sleep(wait);
      await page.screenshot({ path: path.join(OUT, `${name}.png`) });
      results.shots[name] = { ...(await page.evaluate(() => window.__bench.stats())), atlasReqs };
      await page.close();
      console.log(`shot ${name}`, JSON.stringify(results.shots[name]));
    }
    await browser.close(); browser = null;
  }
  if (argv.includes('--perf') || argv.includes('--perf-only')) {
    // uncapped frame cost: 2,500 sprites, m1 view, some burning, auto fire, then the troll glowing
    browser = await launch(true);
    const page = await browser.newPage();
    page.on('pageerror', (e) => results.errors.push(`perf: pageerror ${e.message}`));
    page.on('response', (r) => { if (r.status() >= 400) results.errors.push(`perf: http ${r.status()} ${r.url()}`); });
    const perf = {};
    for (const [k, q, act] of argv.includes('--w4') ? PERF_W4 : argv.includes('--w3') ? PERF_W3 : [['m1_2500', 'view=m1&weapon=pistol&n=2500', { autoFire: true }], ['far_2500_burn', 'view=far&weapon=lance&spray=1&n=2500', { burn: 600 }],
      ['wall_2500', 'view=wall&weapon=pistol&n=2500', {}], ['m1_0', 'view=m1&weapon=pistol&n=1', {}],
      ['gpu_m1_2500', 'view=m1&weapon=pistol&n=2500&gpu=1', {}], ['gpu_far_2500', 'view=far&weapon=pistol&n=2500&gpu=1', { burn: 600 }],
      ['gpu_wall_2500', 'view=wall&weapon=pistol&n=2500&gpu=1', {}], ['gpu_m1_1', 'view=m1&weapon=pistol&n=1&gpu=1', {}]]) {
      await page.goto(`${base}?${q}&noui=1`, { waitUntil: 'load', timeout: 60000 });
      await page.waitForFunction(() => window.__bench?.ready, { timeout: 30000 });
      await page.evaluate((a) => window.__bench.set(a), act);
      await sleep(5000);
      perf[k] = await page.evaluate(() => window.__bench.stats());
      console.log(`perf ${k}`, JSON.stringify(perf[k]));
    }
    perf.gpu = await page.evaluate(() => { const gl = document.querySelector('canvas').getContext('webgl2'); const e = gl.getExtension('WEBGL_debug_renderer_info'); return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : 'n/a'; });
    results.perf = perf;
    await browser.close(); browser = null;
  }
} catch (e) {
  results.errors.push(`fatal: ${e.stack || e}`);
  console.error(e);
} finally {
  if (browser) await browser.close().catch(() => {});
  server.kill('SIGTERM');
}
const prev = fs.existsSync(path.join(OUT, 'stats.json')) ? JSON.parse(fs.readFileSync(path.join(OUT, 'stats.json'), 'utf8')) : {};
fs.writeFileSync(path.join(OUT, 'stats.json'), JSON.stringify({ ...prev, ...results, shots: { ...(prev.shots || {}), ...results.shots }, perf: results.perf || prev.perf || null }, null, 1));
console.log(`errors: ${results.errors.length}`, results.errors.slice(0, 10).join('\n'));
