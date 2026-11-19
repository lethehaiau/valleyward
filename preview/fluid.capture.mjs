// Fluid bench captures + perf in headless Chrome. Run from the repo root under the GPU lock, with the bench served
// (dev: `npx vite --config vite.config.js --port 5353 --strictPort` in the game root; perf: the production build,
// see preview/fluid.vite.config.js):
//   tools/gpu-lock.sh node preview/fluid.capture.mjs --url http://127.0.0.1:5353/preview/fluid.html \
//     [--out <dir>] [--shots m1:smooth,m1:hybrid,m2:smooth,m2:hybrid] [--perf] [--size 1920x1080] [--t 4]
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..');
const require = createRequire(path.join(ROOT, 'package.json'));
const puppeteer = require('puppeteer-core');
const { CHROME, chromeGLArgs } = await import(path.join(ROOT, 'tools/platform.mjs'));

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const has = (k) => process.argv.includes(`--${k}`);
const url = arg('url', 'http://127.0.0.1:5353/preview/fluid.html');
const out = path.resolve(arg('out', path.join(ROOT, '.scratch/fluid/shots')));
const [W, H] = arg('size', '1920x1080').split('x').map(Number);
const shots = has('noshots') ? [] : arg('shots', 'm1:smooth,m1:hybrid,m2:smooth,m2:hybrid').split(',').filter(Boolean);
const tSim = Number(arg('t', '4'));
const qualities = arg('qualities', 'high,medium,low').split(',');
const styles = arg('styles', 'smooth,hybrid').split(',');
fs.mkdirSync(out, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: true, protocolTimeout: 300000,
  args: [...chromeGLArgs(), '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', `--window-size=${W},${H}`],
  defaultViewport: { width: W, height: H, deviceScaleFactor: 1 },
});
const report = { url, size: [W, H], shots: [], perf: [], errors: [] };
async function open(params) {
  const page = await browser.newPage();
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warn') report.errors.push(`${m.type()}: ${m.text()}`); });
  page.on('pageerror', (e) => report.errors.push(`pageerror: ${e.message}`));
  await page.goto(`${url}?${params}`, { waitUntil: 'load', timeout: 120000 });
  await page.waitForFunction(() => window.__fluidBench?.ready, { timeout: 120000 });
  return page;
}
try {
  for (const s of shots) {
    const [scen, style, q = 'high', extra = ''] = s.split(':');
    const grid = extra === 'grid' || extra === 'topgrid';   // the read-back grid overlay (bottom right) next to the fire, HUD on
    const paced = extra === 'paced';                         // 30 rAF-paced frames after t (read-backs land: steam), no HUD
    const view = extra === 'topgrid' ? 'top' : extra && !grid && !paced ? extra : arg('view');
    const page = await open(`${grid ? 'debug=1' : 'noui=1'}&capture=1&auto=0&quality=${q}&fire=${style}${view ? '&view=' + view : ''}`);
    const info = await page.evaluate(async (scen, t, grid) => {
      const b = window.__fluidBench; b.setAuto(false); b.scenario(scen); b.advance(t); b.renderOnce(); await b.settle(2);
      if (grid) for (let i = 0; i < 30; i++) { b.advance(1 / 60); await b.settle(1); }   // rAF-paced frames: the async read-backs land
      b.renderOnce();
      return b.stats();
    }, scen, tSim, grid || paced);
    const file = path.join(out, `${scen}_${style}${q === 'high' ? '' : '_' + q}${extra ? '_' + extra : ''}.png`);
    await page.screenshot({ path: file });
    report.shots.push({ file, info });
    console.log('shot', file, JSON.stringify(info));
    await page.close();
  }
  if (has('experiments')) {
    const page = await open('noui=1&auto=0&quality=high&fire=smooth');
    const variants = JSON.parse(arg('variants', '[null]'));
    for (const knobs of variants) for (const name of arg('exps', 'lance1s,firebomb,trough,pool,edge').split(',')) {
      const r = await page.evaluate((n, k) => { window.__fluidBench.setAuto(false); return window.__fluidBench.experiment(n, k); }, name, knobs);
      r.knobs = knobs;
      report.experiments = report.experiments || []; report.experiments.push(r);
      const brief = { ...r }; if (brief.samples) brief.samples = brief.samples.filter((x, i) => i % 4 === 3).map((x) => `${x.t}s a${x.area} h${x.hmax}${x.bbox ? ' [' + x.bbox.join(',') + ']' : ''}${x.farHeat != null ? ' far' + x.farHeat : ''}${x.eastHeat != null ? ' east' + x.eastHeat : ''}`);
      console.log('exp', name, JSON.stringify(knobs), JSON.stringify(brief));
    }
    await page.close();
  }
  if (has('perf')) {
    for (const q of qualities) for (const style of styles) {
      const page = await open(`noui=1&auto=0&quality=${q}&fire=${style}&timing=1${has('prof') ? '&prof=1' : ''}`);
      const r = await page.evaluate(async (t) => {
        const b = window.__fluidBench; b.setAuto(false); b.scenario('busy'); b.advance(t);
        const off1 = b.measure({ frames: 150, withFluid: false });
        const on1 = b.measure({ frames: 150, withFluid: true });
        const off2 = b.measure({ frames: 150, withFluid: false });
        const on2 = b.measure({ frames: 150, withFluid: true });
        const simOnly = b.measure({ frames: 150, withFluid: true, mode: 'sim' });
        const passOnly = b.measure({ frames: 150, withFluid: true, mode: 'pass' });
        const skips = {};
        if (window.location.search.includes('prof=1')) for (const k of ['march', 'jet', 'embers']) {
          b.fluid.debug.skip[k] = true; skips[k] = b.measure({ frames: 150, withFluid: true, mode: 'pass' }).msPerFrame; b.fluid.debug.skip[k] = false;
        }
        // rAF-paced frames with GPU timer queries (if the extension exists)
        let gpu = null;
        if (b.fluid.debug.setGpuTiming(true)) {
          b.setAuto(false);
          for (let i = 0; i < 90; i++) { b.advance(1 / 60); await new Promise((res) => requestAnimationFrame(res)); }
          gpu = b.stats();
        }
        const ext = b.info().ext.includes('EXT_disjoint_timer_query_webgl2');
        return { off: Math.min(off1.msPerFrame, off2.msPerFrame), on: Math.min(on1.msPerFrame, on2.msPerFrame), raw: [off1.msPerFrame, on1.msPerFrame, off2.msPerFrame, on2.msPerFrame], simOnly: simOnly.msPerFrame, passOnly: passOnly.msPerFrame, skips, stats: on2.stats, gpu, timerExt: ext };
      }, tSim);
      r.quality = q; r.style = style; r.fluidMs = +(r.on - r.off).toFixed(3);
      report.perf.push(r);
      console.log('perf', q, style, `off ${r.off} on ${r.on} → fluid ${r.fluidMs} ms`, 'gpu', JSON.stringify(r.gpu && { sim: r.gpu.gpuSimMs, pass: r.gpu.gpuRenderMs, rbAge: r.gpu.readbackAgeFrames }), 'raw', r.raw.join('/'), 'simOnly', r.simOnly, 'passOnly', r.passOnly, 'passSkip', JSON.stringify(r.skips));
      await page.close();
    }
  }
} catch (e) {
  report.errors.push(`fatal: ${e.stack || e.message}`);
  console.error(e);
} finally {
  await browser.close();
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  console.log('errors', report.errors.length, report.errors.slice(0, 12));
}
