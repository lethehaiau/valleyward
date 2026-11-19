// Environment bench capture: renders preview/env.html views in headless Chrome, saves PNGs, prints perf + console errors.
// Run from the repo root under the GPU lock with the env bench server up (dev 5354, or the production preview on 5354):
//   tools/gpu-lock.sh node preview/env.capture.mjs [--out <dir>] \
//     [--shots m1,m2,top,m1fire,m2fire,gate,dawn] [--size 1920x1080] [--perf] [--url http://127.0.0.1:5354/preview/env.html]
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import sharp from 'sharp';
import { CHROME, chromeGLArgs } from '../tools/platform.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const has = (k) => process.argv.includes(`--${k}`);
const out = path.resolve(arg('out', '.scratch/env/shots'));
const [W, H] = arg('size', '1672x941').split('x').map(Number);
const base = arg('url', 'http://127.0.0.1:5354/preview/env.html');
const quality = arg('quality', 'high');
const SHOTS = {
  m1: 'view=m1', m2: 'view=m2', beacon: 'view=beacon', kindle: 'view=walk&kindle=1', walk: 'view=walk', walkfire: 'view=walk&fire=1', top: 'view=top', gate: 'view=gate&gate=0.4', gate0: 'view=gate&gate=0',
  valley: 'view=valley', m2o4: 'view=m2o4', m2o4fire: 'view=m2o4&fire=1', m1fire: 'view=m1&fire=1', m2fire: 'view=m2&fire=1', dawn: 'view=m1&dawn=1', dawn5: 'view=m2&dawn=0.5', m1e115: 'view=m1&exp=1.15', m1e13: 'view=m1&fire=1&exp=1.3', m1agx: 'view=m1&fire=1&tone=agx', m1fire115: 'view=m1&fire=1&exp=1.15', m2fire115: 'view=m2&fire=1&exp=1.15',
  // the camp and Night II (DESIGN §9)
  camp_w: 'view=camp_w&camp=1', camp_e: 'view=camp_e&camp=1', stall: 'view=stall&camp=1', stallnight: 'view=stall',
  campwalk: 'view=campwalk&camp=1&near=0&built=3', walkn1: 'view=campwalk', shadow: 'view=shadow&camp=1', shadow2: 'view=shadow2&camp=1', shadow3: 'view=shadow3&camp=1&pp=-2.2,1.2',
  banners: 'view=banners', bannersdusk: 'view=banners&camp=1', m1n2: 'view=m1&night=2', m2n2: 'view=m2&night=2',
  valley: 'view=valley', valleyn2: 'view=valley&night=2', glance: 'view=glance&flare=0.87&vt=0.45', glance0: 'view=glance&flare=0.87',
  // DESIGN §8 (moons: n1..n10 at m1; rain; village; world change; portal; gate)
  n1: 'view=m1&night=1', n2: 'view=m1&night=2', n3: 'view=m1&night=3', n4: 'view=m1&night=4', n5: 'view=m1&night=5',
  n6: 'view=m1&night=6', n7: 'view=m1&night=7', n8: 'view=m1&night=8', n9: 'view=m1&night=9', n10: 'view=m1&night=10',
  rain4: 'view=m1&night=4&rain=1', rain4m2: 'view=m2&night=4&rain=1&fire=1', storm10: 'view=m1&night=10&rain=1&strike=1', rain4gate: 'view=gate&night=4&rain=1&fire=1',
  village1: 'view=village&night=1', villagenear: 'view=villagenear&night=3', villageburn: 'view=villagenear&night=10&village=1', villageburnfar: 'view=village&night=10&village=1',
  slope0: 'view=slope&night=10', slope1: 'view=slope&night=10&world=1', m1world: 'view=m1&night=10&world=1&portal=1&lamp=1',
  portal: 'view=portal&night=10&world=1&portal=1&lamp=1', portalhalf: 'view=portal&night=10&portal=0.5&lamp=0.6',
  gateopen: 'view=gate&night=10&world=1&portal=1&gateopen=1', ending20: 'view=portal&night=10&ending=1&et=20',
  m1rain: 'view=m1&night=4&rain=1', m1n10: 'view=m1&night=10', m2village: 'view=village&night=1', m2portal: 'view=portal&night=10&world=1&portal=1&lamp=1&gateopen=1', m2burn: 'view=villagenear&night=10&world=1&village=1',
  gatefire: 'view=gate&fire=1', gateviolet: 'view=gate&fire=1&hue=violet', gateblue: 'view=gate&fire=1&hue=blue', gategreen: 'view=gate&fire=1&hue=green',
};
const list = arg('shots', 'm1,m2,top,m1fire,m2fire,gate,dawn').split(',');
fs.mkdirSync(out, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new',
  args: [...chromeGLArgs(), '--no-sandbox', '--hide-scrollbars', '--disable-frame-rate-limit', '--disable-gpu-vsync'],
  protocolTimeout: 240000,
});
const errors = [];
const report = { size: `${W}x${H}`, shots: [], perf: [] };
try {
  const page = await browser.newPage();
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`pageerror ${e.message}`));
  await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
  for (const name of list) {
    const q = SHOTS[name] || name;
    await page.goto(`${base}?hud=0&quality=${quality}&${q}`, { waitUntil: 'load', timeout: 120000 });
    try { await page.waitForFunction(() => window.__env?.ready, { timeout: 45000 }); }
    catch (e) { errors.push(`${name}: not ready (${e.message})`); console.log(errors.join('\n')); continue; }
    await new Promise((r) => setTimeout(r, 1500));
    const file = path.join(out, `${name}.png`);
    await page.screenshot({ path: file });
    const { data, info } = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    let sum = 0; for (let i = 0; i < data.length; i += 3) sum += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
    const luma = +(sum / (info.width * info.height) / 255).toFixed(3);
    report.shots.push({ name, file, luma });
    console.log('luma', name, luma);
    if (has('perf') && /^(m1|m2|camp)/.test(name)) {
      const p = await page.evaluate(() => window.__env.perf(180));
      report.perf.push({ name, ...p });
      console.log('perf', name, JSON.stringify(p));
    }
    console.log('shot', name, file);
  }
} finally {
  await browser.close();
}
report.errors = errors;
fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 1));
console.log('errors', errors.length, errors.slice(0, 12).join('\n'));
