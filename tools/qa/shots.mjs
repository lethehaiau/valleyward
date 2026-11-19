// Quick captures: one production build, one Chrome; the m1/m2/top views in the greybox and with every module, plus
// a staged fire moment. Run under the GPU lock:  tools/gpu-lock.sh node tools/qa/shots.mjs [--port 5358] [--no-build] [--prefix p_] [--only a,b] [--extra gpu=webgpu]
// Shots: shots/<prefix><name>.jpg in OUT, a gitignored scratch folder (set below); report: OUT/shots.json
import fs from 'node:fs';
import path from 'node:path';
import { startPreview, launch, openPage, waitFor, sleep, meanLuma, ROOT, APP } from './browser.mjs';

const argv = process.argv.slice(2), opt = (k, d) => (argv.includes(`--${k}`) ? argv[argv.indexOf(`--${k}`) + 1] : d);
const PORT = Number(opt('port', 5358)), PREFIX = opt('prefix', ''), ONLY = opt('only', ''), EXTRA = opt('extra', '');   // --extra gpu=webgpu: appended to every case (decision 0001: capture the webgpu edition)
const OUT = path.join(ROOT, '.scratch/core'), SHOTS = path.join(OUT, 'shots'), DIST = path.join(OUT, 'dist');
fs.mkdirSync(SHOTS, { recursive: true });
if (!process.env.GPU_LOCK_HELD) console.warn('shots: not under tools/gpu-lock.sh — please wrap it (one headless Chrome at a time)');
const report = { started: new Date().toISOString(), shots: [], errors: {}, modules: {} };
const server = await startPreview(PORT, DIST, { build: !argv.includes('--no-build') });
const browser = await launch({ width: 1600, height: 900 });
// (every case starts from a fresh save unless it names its own, so one case's save never leaks into the next)
const W = (q) => `${server.url}?seed=3&skipintro=1&god=1${q.includes('save=') ? '' : '&save=fresh'}&${q}${EXTRA ? `&${EXTRA}` : ''}`;
const cases = [
  ['m1_greybox', 'look=greybox&view=m1', 'lance'],
  ['m2_greybox', 'look=greybox&view=m2', 'lance'],
  ['top_greybox', 'look=greybox&view=top', null],
  ['m1_full', 'view=m1&fire=smooth', 'lance'],
  ['m2_full', 'view=m2&fire=smooth', 'lance'],
  ['m1_hybrid', 'view=m1&fire=hybrid', 'lance'],
  ['m2_hybrid', 'view=m2&fire=hybrid', 'lance'],
  ['troll_full', 'view=troll&troll=1', null],
  ['debug_fire', 'debug=1&view=m2', 'lance'],
  // DESIGN §9: the camp at dusk (Brother Cinder's stall, the pads, a tower), Night II's m2 (blood moon, towers)
  ['camp_dusk', 'save=rich&camp=1', 'camp'],
  ['night2_m2', 'save=mid&night=2&view=m2&fire=hybrid', 'lance'],
].filter(([n]) => !ONLY || ONLY.split(',').includes(n));
try {
  for (const [name, q, stage] of cases) {
    const { page, errors } = await openPage(browser, W(q));
    const ok = await waitFor(page, () => window.__ew?.assetsReady?.(), null, 120000);
    if (!ok) { report.errors[name] = ['not ready', ...errors]; await page.close(); continue; }
    if (stage === 'camp') {
      // the camp: build an Obelisk and a Chain Imp on the west pads, then look west at the stall and the low sun
      await page.evaluate(() => { __ew.command({ act: 'build', pad: 'pad-west', type: 'obelisk' }); __ew.command({ act: 'build', pad: 'pad-gate-w', type: 'chainimp' }); });
      await sleep(3200);
      await page.evaluate(() => __ew.pose({ x: -2, z: 6.2, yaw: -Math.PI / 2 - 0.12, pitch: 0.0 }));
      await sleep(1500);
    } else await page.evaluate(() => { __ew.setClock(140); __ew.state().player.xpNext = 1e9; });
    // stage: a crowd on the road and at the gate, a lit trough, the Lance spraying, a firebomb
    if (stage !== 'camp') await page.evaluate((stage, m2) => {
      const st = __ew.state();
      // M1's crowd comes up the road ahead (8–25 m); M2's piles at the gate below the wall
      // m2: the mound piled at the gate with a burning front, the crowd along the wall's foot and up the
      // road, trough-e lit beyond the gate
      if (m2) {
        __ew.spawn('grunt', 220, 0.5, 3); __ew.spawn('grunt', 120, 5, 5); __ew.spawn('imp', 50, 9, 7); __ew.spawn('grunt', 140, 15, 9); __ew.spawn('spear', 20, 20, 14); __ew.spawn('brute', 8, 2, 6);
        for (const x of [6.5, 9, 11.5]) __ew.fireOp({ kind: 'burst', x, z: 1, r: 1.6, amount: 1, push: 1 });
      } else {
        // m1: the column comes up the road ahead, 15–30 m out (closer, it reaches the player within the 2.6 s and fills the
        // lens); the Lance alone sets its front alight (no trough fire in M1's foreground)
        __ew.spawn('grunt', 120, 19, 5); __ew.spawn('imp', 50, 23, 6); __ew.spawn('grunt', 160, 28, 9); __ew.spawn('spear', 20, 31, 14); __ew.spawn('brute', 6, 25, 7);
      }
      st.player.fuel = st.player.fuelMax;
      if (stage === 'lance') { const p = st.player; __ew.setInput({ fire: true, yaw: p.yaw, pitch: p.pitch, weapon: 3 }); }
    }, stage, q.includes('view=m2'));
    if (stage !== 'camp') await sleep(2600);
    if (q.includes('debug=1')) { report.fireCompare = report.fireCompare || {}; report.fireCompare[name] = await page.evaluate(() => __ew.fireCompare()); console.log('fireCompare', JSON.stringify(report.fireCompare[name])); }
    await page.evaluate(() => { __ew.pause(); });
    await sleep(400);
    const f = path.join(SHOTS, `${PREFIX}${name}.jpg`);
    await page.screenshot({ path: f, type: 'jpeg', quality: 85 });
    report.shots.push(path.relative(ROOT, f));
    report.luma = report.luma || {};
    report.luma[name] = await meanLuma(page, f);
    report.modules[name] = await page.evaluate(() => __ew.modules());
    report.errors[name] = errors.slice(0, 12);
    console.log(name, 'errors', errors.length, JSON.stringify(await page.evaluate(() => __ew.perf())));
    await page.close();
  }
  // the key art's frame mean (ART-DIRECTION: M1 ≈ 0.27; the game frame must not be darker)
  const pg = await browser.newPage();
  report.mockLuma = {};
  for (const m of ['M1_smooth', 'M1_hybrid', 'M2_smooth', 'M2_hybrid']) report.mockLuma[m] = await meanLuma(pg, path.join(APP, 'docs/mockups', `${m}.jpg`));
  await pg.close();
  console.log('luma', JSON.stringify(report.luma), 'mockups', JSON.stringify(report.mockLuma));
} catch (e) { report.exception = String(e?.stack || e); console.error(e); }
finally { await browser.close().catch(() => {}); server.kill(); }
fs.writeFileSync(path.join(OUT, 'shots.json'), JSON.stringify(report, null, 1));
console.log('shots done', JSON.stringify(report.errors));
