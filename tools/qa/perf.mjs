// Checkpoint P (DESIGN §15): a production build in Chrome at 1920×1080 (DPR 1 in headless; the real Retina
// measurement needs a real browser window), quality high, the busiest moment: the troll + 2,000 goblins + a burning trough + the Lance
// spraying + a firebomb every 2 s. Records p50/p95/p99 frame, long frames (> 50 ms) after the first input, draw calls,
// triangles, lights, the sim's ms per frame and the fluid's stats. Run under the GPU lock:
//   tools/gpu-lock.sh node tools/qa/perf.mjs [--port 5359] [--seconds 12] [--quality high] [--no-build] [--uncapped-only|--vsync-only] [--styles smooth,hybrid]
// Runs both fire styles × vsync and uncapped, the new m2 pose, p50 and frames over 33 / 50 ms, long tasks.
// Report: perf.json in OUT, a gitignored scratch folder (+ a screenshot of the moment)
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { startPreview, launch, openPage, waitFor, sleep, ROOT } from './browser.mjs';

const argv = process.argv.slice(2), opt = (k, d) => (argv.includes(`--${k}`) ? argv[argv.indexOf(`--${k}`) + 1] : d);
const PORT = Number(opt('port', 5359)), SECONDS = Number(opt('seconds', 12)), QUALITY = opt('quality', 'high');
const OUT = path.join(ROOT, '.scratch/core'), DIST = path.join(OUT, 'dist');
fs.mkdirSync(path.join(OUT, 'shots'), { recursive: true });
const load = os.loadavg();
const server = await startPreview(PORT, DIST, { build: !argv.includes('--no-build') });
const report = { started: new Date().toISOString(), loadavg: load.map((x) => +x.toFixed(2)), quality: QUALITY, viewport: '1920x1080', runs: {} };
const STYLES = opt('styles', 'smooth,hybrid').split(',');
// --v2 (the DESIGN §9 Checkpoint P): Night II with four towers (two Obelisks, two Chain Imps), Ember Orbit ×3, Cinder Trail,
// Brimstone Rain, Dousers and Hexers in the crowd, the Lamplighter strafing on the plaza in front of the gate
const V2 = argv.includes('--v2');
// --alive N (DESIGN §15.4, the enemy cost): keep N goblins alive (the horde cap raised with ?cap=) instead of 2,000
const ALIVE = Number(opt('alive', 2000));
// --scene night9 | ending (the DESIGN §8 Checkpoint P): Night IX from the late save (its trolls, a ram, bats, rain squalls, the
// crowd topped up) or the ending played from its start (no input; the whole 50 s before the card)
const SCENE = opt('scene', '');
report.scene = SCENE;
report.alive = ALIVE;
report.v2 = V2;
for (const style of STYLES) for (const uncapped of argv.includes('--uncapped-only') ? [true] : argv.includes('--vsync-only') ? [false] : [false, true]) {
  const key = `${style}_${uncapped ? 'uncapped' : 'vsync'}`;
  const browser = await launch({ width: 1920, height: 1080, uncapped });
  const run = report.runs[key] = {};
  try {
    const startQ = SCENE === 'night9' ? '&save=late&night=9&clock=205' : SCENE === 'ending' ? '&save=fresh&ending=1' : V2 ? '&save=mid&camp=1' : '&save=fresh&skipintro=1&clock=200';
    const { page, errors } = await openPage(browser, `${server.url}?seed=4&god=1&quality=${QUALITY}&perf=1&noui=0&fire=${style}` + startQ + (ALIVE > 2000 ? `&cap=${ALIVE + 600}` : '') + (uncapped ? '&fps=0' : ''));   // (DESIGN §15: the 60 fps cap is lifted for the GPU-throughput runs)
    // long main-thread tasks (> 50 ms) from here on
    await page.evaluate(() => { window.__ewLong = []; try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__ewLong.push(Math.round(e.duration)); }).observe({ type: 'longtask', buffered: false }); } catch { /* no longtask API */ } });
    await waitFor(page, () => window.__ew?.assetsReady?.(), null, 120000);
    run.boot = await page.evaluate(() => ({ bootMs: __ew.bootMs, warmMs: __ew.warmMs, modules: Object.fromEntries(Object.entries(__ew.modules()).map(([k, v]) => [k, v.state])) }));
    // the busiest moment, seen from the wall walk over the gate (the M2 framing): the troll, 2,000 goblins (topped up),
    // the east trough burning, the Lance sweeping, a firebomb every 2 s
    if (SCENE === 'ending') {
      // the ending: measured from its start for 50 s (to the cut to black), nothing driven
      await page.evaluate(() => { __ew.resetPerf(); window.__ewLong = []; });
      const tS = Date.now(); const beats = new Set();
      while (Date.now() - tS < 50000) { const b = await page.evaluate(() => __ew.state().ending?.beat); if (b) beats.add(b); await sleep(500); }
      run.perf = await page.evaluate(() => __ew.perf()); run.longTasks = await page.evaluate(() => ({ n: window.__ewLong.length, max: window.__ewLong.length ? Math.max(...window.__ewLong) : 0 }));
      run.lights = await page.evaluate(() => __ew.lights()); run.beats = [...beats]; run.errors = errors.slice(0, 10);
      const f = path.join(OUT, 'shots', `perf_ending_${QUALITY}_${key}.jpg`); await page.screenshot({ path: f, type: 'jpeg', quality: 80 }); run.shot = path.relative(ROOT, f);
      await page.close(); await browser.close().catch(() => {});
      const pf = run.perf || {};
      console.log(key, JSON.stringify({ scene: 'ending', beats: run.beats.length, lanes: pf.lanes, frames: pf.frames, p50: pf.p50, p95: pf.p95, p99: pf.p99, max: pf.max, over33: pf.over33, over50: pf.over50, calls: pf.calls, tris: pf.triangles, longTasks: run.longTasks, lights: run.lights, errors: run.errors?.length }));
      continue;
    }
    if (SCENE === 'night9') await page.evaluate(() => { __ew.sim.ctx.rams.spawn(); const r = __ew.state().rams[0]; if (r) { r.x = 24; r.z = 24; r.k = 5; } });
    if (V2) {
      await page.evaluate(() => { __ew.setGold(9999); __ew.command({ act: 'build', pad: 'pad-road', type: 'obelisk' }); __ew.command({ act: 'build', pad: 'pad-slope', type: 'chainimp' });
        __ew.command({ act: 'upgrade', pad: 'pad-gate-w' }); __ew.command({ act: 'upgrade', pad: 'pad-gate-e' }); });
      await sleep(300);
      run.towers = await page.evaluate(() => { __ew.goto('night2'); __ew.setClock(200); const c = __ew.sim.ctx; c.mods.orbit = 3; c.mods.trail = 3; c.mods.meteor = 2; return __ew.state().run.towers.map((t) => `${t.pad}:${t.type}:${t.level}`); });
      await sleep(500);
    }
    await page.evaluate((v2, ALIVE) => {
      if (v2) __ew.pose({ x: 3, z: 7.5, yaw: Math.PI * 0.86, pitch: -0.2 }); else __ew.view('m2');
      __ew.state().player.xpNext = 1e9;
      __ew.troll(); const tr = __ew.state().troll; tr.x = 6; tr.z = 9; tr.action = 'walk'; tr.stage = 'walk';
      const k = ALIVE / 2000;
      __ew.spawn('grunt', 600 * k, 2, 6); __ew.spawn('grunt', 600 * k, 16, 9); __ew.spawn('imp', 300 * k, 22, 16); __ew.spawn('spear', 250 * k, 26, 24); __ew.spawn('brute', 250 * k, 12, 18);
      if (v2) { __ew.spawn('douser', 60, 8, 14); __ew.spawn('hexer', 3, 4, 22); __ew.spawn('chief', 1, 10, 20); }
      __ew.fireOp({ kind: 'burst', x: 9, z: 1, r: 2, amount: 1, push: 2 });
    }, V2, ALIVE);
    const topUp = () => page.evaluate((ALIVE) => {
      const st = __ew.state(), p = st.player, need = ALIVE - st.horde.alive;
      if (need > 0) { __ew.spawn('grunt', Math.ceil(need * 0.6), 20, 30); __ew.spawn('imp', Math.ceil(need * 0.25), 30, 40); __ew.spawn('brute', Math.ceil(need * 0.15), 10, 36); }
      p.fuel = p.fuelMax; p.bombs = Math.max(p.bombs, 1);
      window.__ewAim ??= { yaw: p.yaw, pitch: p.pitch };   // the m2 pose's aim (VIEWS.m2), swept ±0.25 rad
      __ew.setInput({ fire: true, weapon: 3, yaw: window.__ewAim.yaw + Math.sin(st.t * 1.5) * 0.25, pitch: window.__ewAim.pitch, bomb: true,
        ...(st.meta && window.__ewV2 ? { right: Math.sin(st.t * 0.9) > 0 ? 1 : -1 } : {}) });   // v2: strafe (Cinder Trail needs a running Lamplighter)
      return st.horde.alive;
    }, ALIVE);
    if (V2) await page.evaluate(() => { window.__ewV2 = true; });
    await topUp(); await sleep(1500);
    await page.evaluate(() => { __ew.resetPerf(); window.__ewLong = []; });
    const t0 = Date.now(); const alive = [];
    while (Date.now() - t0 < SECONDS * 1000) { alive.push(await topUp()); await sleep(1000); }
    run.perf = await page.evaluate(() => __ew.perf());
    run.longTasks = await page.evaluate(() => ({ n: window.__ewLong.length, max: window.__ewLong.length ? Math.max(...window.__ewLong) : 0 }));
    run.alive = { min: Math.min(...alive), max: Math.max(...alive) };
    run.lights = await page.evaluate(() => __ew.lights());
    run.troll = await page.evaluate(() => !!__ew.state().troll?.alive);
    run.trough = await page.evaluate(() => __ew.state().troughs.map((t) => t.lit));
    run.fireStyle = await page.evaluate(() => __ew.fireStyle());
    if (V2) run.v2 = await page.evaluate(() => { const st = __ew.state(), ev = __ew.drainEvents(), c = (t) => ev.filter((e) => e.type === t).length;
      return { night: st.night.n, towers: st.towers.length, orbit: st.orbit.length, pulses: c('obelisk.pulse'), hooks: c('chain.hook'), trail: c('trail'), meteors: c('meteor'), douses: c('douser.throw'), pickups: st.pickups.length }; });
    run.actors = await page.evaluate(() => { try { return __ew.modules && window.__ew.actorsStats?.(); } catch { return null; } });
    if (SCENE === 'night9') run.night9 = await page.evaluate(() => { const st = __ew.state(); return { night: st.night.n, trolls: st.troll ? 1 : 0, rams: st.rams.length, air: st.air.length, rain: +st.weather.rain.toFixed(2) }; });
    const f = path.join(OUT, 'shots', `perf_${SCENE ? SCENE + '_' : ''}${V2 ? 'v2_' : ''}${ALIVE !== 2000 ? 'n' + ALIVE + '_' : ''}${QUALITY}_${key}.jpg`);
    await page.screenshot({ path: f, type: 'jpeg', quality: 80 });
    run.shot = path.relative(ROOT, f);
    run.errors = errors.slice(0, 10);
    await page.close();
  } catch (e) { run.exception = String(e?.stack || e); } finally { await browser.close().catch(() => {}); }
  const pf = run.perf || {};
  console.log(key, JSON.stringify({ scene: SCENE || null, night9: run.night9, alive: ALIVE, lanes: pf.lanes, v2: run.v2, frames: pf.frames, p50: pf.p50, p95: pf.p95, p99: pf.p99, max: pf.max, over33: pf.over33, over50: pf.over50, dpr: pf.dpr, calls: pf.calls, tris: pf.triangles, longTasks: run.longTasks, lights: run.lights, alive: run.alive, readbackAge: pf.fire?.readbackAgeFrames, errors: run.errors?.length }));
}
server.kill();
report.loadavgEnd = os.loadavg().map((x) => +x.toFixed(2));
const tag = `${SCENE ? SCENE + '_' : ''}${V2 ? 'v2_' : ''}${ALIVE !== 2000 ? 'n' + ALIVE + '_' : ''}${QUALITY}`;
fs.writeFileSync(path.join(OUT, `perf_${tag}.json`), JSON.stringify(report, null, 1));
console.log('perf report', path.join(OUT, `perf_${tag}.json`));
