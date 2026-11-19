// pres bench capture + overlap probe: renders preview/pres.html scenarios in headless Chrome, saves PNGs and checks that no
// two visible HUD blocks overlap and that everything stays inside the viewport. Run it under the GPU lock from the repo
// root, with the pres bench server up (npx vite --config vite.config.js --port 5356 --strictPort):
//   tools/gpu-lock.sh node preview/pres-capture.js [--out <dir>] \
//     [--only hud,cards] [--sizes 1280x720,1920x1080] [--wait 1400]
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { CHROME, chromeGLArgs } from '../tools/platform.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const has = (k) => process.argv.includes(`--${k}`);
const out = path.resolve(arg('out', '.scratch/pres/caps'));
const sizes = arg('sizes', '1280x720,1920x1080').split(',').map((s) => s.split('x').map(Number));
const only = arg('only', '') ? arg('only', '').split(',') : null;
const wait = Number(arg('wait', '1400'));
const base = arg('url', 'http://127.0.0.1:5356/preview/pres.html');
fs.mkdirSync(out, { recursive: true });

/** in-page: rects of the visible HUD blocks and their pairwise overlaps */
function probe() {
  const vis = (el) => {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    for (let e = el; e && e !== document.body; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) < 0.05) return false;
    }
    return true;
  };
  const groups = [
    ['top-left', '.ew-tl'], ['top', '.ew-top'], ['hp', '.ew-bl'], ['weapon', '.ew-br'], ['prompt', '.ew-prompt'], ['banner', '.ew-banner .ew-btitle'],
    ['banner-sub', '.ew-banner .ew-bsub'], ['toast', '.ew-toast'], ['subtitle', '.ew-sub'], ['hints', '.ew-hints'],
    ['camp-top', '.ew-camptop'], ['plate', '.ew-plate'], ['caption', '.ew-caption'],   // DESIGN §9
  ];
  const W = innerWidth, H = innerHeight;
  const boxes = [];
  for (const [name, sel] of groups) {
    for (const el of document.querySelectorAll(sel)) {
      if (!vis(el)) continue;
      // tighten to the union of visible children with content (flex containers may span wider than their content)
      const r = el.getBoundingClientRect();
      boxes.push({ name, x: r.left, y: r.top, w: r.width, h: r.height });
    }
  }
  const modal = [...document.querySelectorAll('.ew-modal.on')].map((m) => m.className);
  const cards = [...document.querySelectorAll('.ew-card')].filter(vis).map((el) => { const r = el.getBoundingClientRect(); return { name: 'card', x: r.left, y: r.top, w: r.width, h: r.height }; });
  const panels = [...document.querySelectorAll('.ew-modal.on .ew-panel, .ew-modal.on .ew-endc, .ew-modal.on .ew-cwrap, .ew-modal.on .ew-srow, .ew-modal.on .ew-crow2, .ew-modal.on .ew-tcard')].filter(vis).map((el) => { const r = el.getBoundingClientRect(); return { name: el.className, x: r.left, y: r.top, w: r.width, h: r.height }; });
  const hit = (a, b) => a.x < b.x + b.w - 0.5 && b.x < a.x + a.w - 0.5 && a.y < b.y + b.h - 0.5 && b.y < a.y + a.h - 0.5;
  const overlaps = [];
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i], b = boxes[j];
    if (a.name === b.name) continue;
    if ((a.name === 'banner' && b.name === 'banner-sub') || (b.name === 'banner' && a.name === 'banner-sub')) continue;
    if (hit(a, b)) overlaps.push(`${a.name} × ${b.name}`);
  }
  for (let i = 0; i < cards.length; i++) for (let j = i + 1; j < cards.length; j++) if (hit(cards[i], cards[j])) overlaps.push('card × card');
  const outside = [...boxes, ...cards, ...panels].filter((b) => b.x < 4 || b.y < 4 || b.x + b.w > W - 4 || b.y + b.h > H - 4).map((b) => b.name);
  // text that overflows its own box (clipped words)
  const clipped = [...document.querySelectorAll('.ewui .ew-ts, .ewui .ew-ctext, .ewui .ew-cname, .ewui .ew-btn, .ewui .ew-stext, .ewui .ew-sname, .ewui .ew-say, .ewui .ew-sbody')].filter(vis).filter((el) => el.scrollWidth > el.clientWidth + 2 && getComputedStyle(el).overflow !== 'visible').map((el) => el.className);
  const fontsOk = document.fonts.check("16px 'EW Silkscreen'") && document.fonts.check("16px 'EW Pixelify'");
  // transient text never in the crosshair zone (±12 % around the centre), one toast at a time, nothing
  // transient showing under a modal, no card line that is a lone "%"
  const cz = { x: W * 0.38, y: H * 0.38, w: W * 0.24, h: H * 0.24 };
  const onCross = boxes.filter((b) => (b.name === 'toast' || b.name === 'subtitle') && hit(b, cz)).map((b) => b.name);
  const toastsShown = boxes.filter((b) => b.name === 'toast').length;
  const underModal = modal.some((m) => !/night/.test(m)) ? boxes.filter((b) => ['toast', 'prompt', 'banner', 'subtitle', 'hints'].includes(b.name)).map((b) => b.name) : [];
  const loneWraps = [];
  for (const el of document.querySelectorAll('.ew-ctext, .ew-cname')) {
    if (!vis(el) || !/%/.test(el.textContent || '')) continue;
    const rg = document.createRange(); rg.selectNodeContents(el);
    const lines = new Map(); for (const r of rg.getClientRects()) { const k = Math.round(r.top); lines.set(k, (lines.get(k) || 0) + r.width); }
    const tops = [...lines.keys()].sort((a, b) => a - b);
    if (tops.length > 1 && lines.get(tops[tops.length - 1]) < 14) loneWraps.push(el.textContent);
  }
  if (onCross.length) overlaps.push(...onCross.map((n) => `${n} × crosshair-zone`));
  if (toastsShown > 1) overlaps.push(`${toastsShown} toasts at once`);
  if (underModal.length) overlaps.push(...underModal.map((n) => `${n} under the modal`));
  if (loneWraps.length) overlaps.push(...loneWraps.map((t) => `lone % in "${t}"`));
  // no crosshair at all (DESIGN §13); panel rows never overlap each other
  if (document.querySelector('.ew-cross, .ew-hit')) overlaps.push('crosshair present');
  const rows = [...document.querySelectorAll('.ew-modal.on .ew-srow, .ew-modal.on .ew-crow2, .ew-modal.on .ew-tcard')].filter(vis).map((el) => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
  for (let i = 0; i < rows.length; i++) for (let j = i + 1; j < rows.length; j++) if (hit(rows[i], rows[j])) overlaps.push('panel row × row');
  // text that spills out of a panel row (a too-long line under a narrow column)
  for (const el of document.querySelectorAll('.ew-modal.on .ew-srow > *, .ew-modal.on .ew-crow2 *, .ew-modal.on .ew-tcard > *')) {
    if (!vis(el)) continue; const r = el.getBoundingClientRect(), pr = el.closest('.ew-srow, .ew-crow2, .ew-tcard').getBoundingClientRect();
    if (r.right > pr.right + 1 || r.left < pr.left - 1 || r.bottom > pr.bottom + 1) overlaps.push(`spill ${el.className || el.tagName}`);
  }
  return { boxes: boxes.map((b) => `${b.name}@${Math.round(b.x)},${Math.round(b.y)} ${Math.round(b.w)}×${Math.round(b.h)}`), modal, overlaps, outside, clipped, fontsOk };
}

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: [...chromeGLArgs(), '--no-sandbox', '--hide-scrollbars'], protocolTimeout: 180000 });
const report = { shots: [], errors: [] };
try {
  const page = await browser.newPage();
  page.on('console', (m) => { if (m.type() === 'error') report.errors.push(m.text()); });
  page.on('pageerror', (e) => report.errors.push(`pageerror ${e.message}`));
  let names = null;
  for (const [w, h] of sizes) {
    await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
    if (!names) {
      await page.goto(`${base}?nobench=1&frozen=1`, { waitUntil: 'load', timeout: 60000 });
      await page.waitForFunction(() => window.__pres?.ready, { timeout: 60000 });
      names = (await page.evaluate(() => window.__pres.list())).filter((n) => !only || only.includes(n));
    }
    for (const n of names) {
      await page.goto(`${base}?nobench=1&frozen=1&scn=${n}`, { waitUntil: 'load', timeout: 60000 });
      await page.waitForFunction(() => window.__pres?.ready, { timeout: 60000 });
      await new Promise((r) => setTimeout(r, wait));
      const p = await page.evaluate(probe);
      const file = path.join(out, `${n}_${w}x${h}.png`);
      await page.screenshot({ path: file });
      report.shots.push({ name: n, size: `${w}x${h}`, file, ...p });
      console.log(`${n} ${w}x${h} overlaps=${p.overlaps.length ? p.overlaps.join(';') : 0} outside=${p.outside.join(',') || 0} clipped=${p.clipped.length} fonts=${p.fontsOk}`);
    }
  }
} catch (e) { report.errors.push(String(e?.stack || e)); console.error(e); }
finally { await browser.close(); }
fs.writeFileSync(path.join(out, `report.json`), JSON.stringify(report, null, 1));
console.log(`errors: ${report.errors.length}${report.errors.length ? '\n' + report.errors.slice(0, 10).join('\n') : ''}`);
