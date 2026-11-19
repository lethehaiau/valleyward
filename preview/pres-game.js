// HUD in-game check: drives the real app (index.html through src/main.js) on the pres bench dev server and captures the
// HUD, FX and cinema surfaces in context: the intro cinema, the HUD in play with the bot, FX in a fight, the troll arrival, the
// cards, the dawn and fallen flows. Run from the repo root under the GPU lock, with the pres bench server up on 5356:
//   tools/gpu-lock.sh node preview/pres-game.js [--out <dir>] [--size 1280x720]
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { CHROME, chromeGLArgs } from '../tools/platform.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const out = path.resolve(arg('out', '.scratch/pres/game'));
const [W, H] = arg('size', '1280x720').split('x').map(Number);
const base = arg('url', 'http://127.0.0.1:5356/');
const only = arg('only', '') ? arg('only', '').split(',') : null;
fs.mkdirSync(out, { recursive: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const report = { shots: [], errors: [], notes: [] };

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: [...chromeGLArgs(), '--no-sandbox', '--hide-scrollbars', '--autoplay-policy=no-user-gesture-required'], protocolTimeout: 240000 });
async function open(q) {
  const page = await browser.newPage();
  page.on('console', (m) => { if (m.type() === 'error') report.errors.push(`${q}: ${m.text()}`); });
  page.on('pageerror', (e) => report.errors.push(`${q}: pageerror ${e.message}`));
  await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
  await page.goto(`${base}${q}`, { waitUntil: 'load', timeout: 120000 });
  await page.waitForFunction(() => window.__ew && window.__ew.assetsReady(), { timeout: 180000, polling: 250 });
  return page;
}
async function shot(page, name) {
  const file = path.join(out, `${name}_${W}x${H}.png`);
  await page.screenshot({ path: file });
  const info = await page.evaluate(() => { const s = window.__ew.state(); return { mode: s.mode, modeT: +(s.modeT || 0).toFixed(2), clock: +(s.night?.clock || 0).toFixed(1), mods: Object.fromEntries(Object.entries(window.__ew.modules()).map(([k, v]) => [k, v.state])), fx: window.__ew.ui ? null : null }; });
  report.shots.push({ name, file, ...info });
  console.log(name, JSON.stringify(info));
}
const want = (n) => !only || only.includes(n);
try {
  if (want('intro')) { // the intro from the title (a key starts it)
    const p = await open('?seed=3&god=1');
    await p.keyboard.press('KeyK');
    await p.waitForFunction(() => window.__ew.state().mode === 'intro', { timeout: 20000 });
    for (const t of [0.9, 2.6, 4.1, 5.3]) {
      await p.waitForFunction((tt) => window.__ew.state().modeT >= tt || window.__ew.state().mode !== 'intro', { timeout: 20000, polling: 16 }, t);
      await shot(p, `intro_${t}`);
    }
    await p.waitForFunction(() => window.__ew.state().mode === 'play', { timeout: 20000 });
    await wait(900);
    await shot(p, 'intro_control');
    await p.close();
  }
  if (want('play')) { // the bot plays: HUD + FX in a fight, the m1 framing
    const p = await open('?seed=3&autoplay=1&god=1&clock=150');
    await wait(9000);
    await shot(p, 'play_bot');
    await p.evaluate(() => window.__ew.view('m1'));
    await wait(2500);
    await shot(p, 'play_m1');
    await p.close();
  }
  if (want('troll')) {
    const p = await open('?seed=3&skipintro=1&god=1&clock=200');
    await wait(1500);
    await p.evaluate(() => window.__ew.troll());
    await wait(1700);
    await shot(p, 'troll_arrive');
    await wait(2600);
    await shot(p, 'troll_after');
    await p.close();
  }
  if (want('dawn')) { // dawn: kill the troll and run the clock out (god), then the dawn flow and the card
    const p = await open('?seed=3&skipintro=1&god=1&clock=297');
    await p.evaluate(() => { window.__ew.bot(true); });
    const st = await p.evaluate(() => { const s = window.__ew.state(); if (s.troll) s.troll.hp = 1; return !!s.troll; });
    report.notes.push(`dawn: troll present at start ${st}`);
    await p.waitForFunction(() => { const s = window.__ew.state(); if (s.troll && s.troll.hp > 1) s.troll.hp = 1; return s.mode === 'victory'; }, { timeout: 60000, polling: 200 }).catch(() => report.notes.push('dawn: no victory within 60 s'));
    await wait(3500);
    await shot(p, 'dawn_rise');
    await wait(4500);
    await shot(p, 'dawn_card');
    await p.close();
  }
  if (want('fallen')) {
    const p = await open('?seed=3&skipintro=1&clock=120');
    await wait(800);
    await p.evaluate(() => { const s = window.__ew.state(); s.gate.hp = 1; window.__ew.spawn('brute', 6, 0, 3); });
    await p.waitForFunction(() => window.__ew.state().mode === 'fallen', { timeout: 30000, polling: 100 }).catch(() => report.notes.push('fallen: no fall within 30 s'));
    await wait(700);
    await shot(p, 'fallen_cine');
    await wait(1800);
    await shot(p, 'fallen_card');
    await p.close();
  }
} catch (e) { report.errors.push(String(e?.stack || e)); console.error(e); }
finally { await browser.close(); }
fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 1));
console.log('errors', report.errors.length, report.errors.slice(0, 8).join('\n'), '\nnotes', report.notes.join(' | '));
