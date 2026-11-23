import assert from 'node:assert/strict';
import { existsSync, lstatSync, realpathSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import sharp from 'sharp';
import { MODULES } from 'firewraith/modules';
import { FALLBACK } from '../../src/core/fire-registry.js';
import { CHROME } from '../platform.mjs';
import { APP, launch, openPage, startVite } from './browser.mjs';

const usage = 'npm run module:check -- <id> [--slot lance|ground] [--url <local dev URL>] [--out <directory>] [--preflight]';
const { positionals, values } = parseArgs({ allowPositionals: true, options: {
  slot: { type: 'string' }, url: { type: 'string' }, out: { type: 'string' },
  preflight: { type: 'boolean' }, help: { type: 'boolean' },
} });
if (values.help) { console.log(usage); process.exit(0); }
assert.equal(positionals.length, 1, usage);
const [id] = positionals;
const packagePath = join(APP, 'node_modules', 'firewraith');
const checkout = realpathSync(packagePath);
console.log(`Firewraith ${lstatSync(packagePath).isSymbolicLink() ? 'linked checkout' : 'installed package'}: ${checkout}`);
assert.ok(Object.hasOwn(MODULES, id), `${id} is missing from that checkout's modules/catalog.js. Available: ${Object.keys(MODULES).join(', ')}`);
const { backend, slots } = MODULES[id].info;
const slot = values.slot ?? slots[0];
assert.ok(slots.includes(slot), `${id} fills ${slots.join(', ')} (${backend}), so it cannot fill ${slot}`);
const reference = FALLBACK[backend];
const viewport = { width: 1920, height: 1080 };
const selectedUrl = new URL(values.url ?? 'http://127.0.0.1:5350/');
assert.ok(/^https?:$/.test(selectedUrl.protocol) && ['127.0.0.1', 'localhost', '[::1]'].includes(selectedUrl.hostname)
  && !selectedUrl.username && !selectedUrl.password, 'Use a loopback Valleyward dev URL');
const output = resolve(values.out ?? `.scratch/module-check/${id}-${slot}`);

function picks(id) { return { lance: reference, ground: reference, [slot]: id }; }

function playUrl(base, picked, replay = false) {
  const url = new URL(base);
  url.search = new URLSearchParams({ gpu: backend, ...picks(picked), skipintro: '1', fire: 'smooth', ...(replay && {
    seed: '4', save: 'fresh', quality: 'high', fps: '0', god: '1', mute: '1', noui: '1', firePerf: '1',
  }) });
  return url.href;
}

function printLinks(base) {
  console.log(`Candidate (${backend}, ${slot}): ${playUrl(base, id)}`);
  console.log(`Classic control: ${playUrl(base, reference)}`);
}
if (values.preflight) { printLinks(selectedUrl); process.exit(0); }
assert.ok(existsSync(CHROME), `Chrome is unavailable at ${CHROME}. Set CHROME_BIN to the installed browser.`);
await mkdir(output, { recursive: true });
const profile = await mkdtemp(join(tmpdir(), 'valleyward-module-check-'));
let server, browser;
const report = { id, slot, backend, viewport, cases: {} };

async function reachable(url) {
  try { const response = await fetch(url, { signal: AbortSignal.timeout(3000) }); await response.body?.cancel(); return response.ok; }
  catch { return false; }
}

function checkSlots(modules, picked) {
  for (const [name, key] of Object.entries(picks(picked))) {
    const actual = modules?.[name];
    assert.ok(actual?.state === 'loaded' && actual.id === key,
      `${name} requested ${key}, resolved ${actual?.id ?? 'nothing'} (${actual?.state ?? 'no fire host'}). ${actual?.reason ?? ''}`);
  }
}

async function changedPercent(before, after) {
  const region = { left: 300, top: 295, width: 600, height: 350 };
  const sample = (image) => sharp(image).extract(region).removeAlpha().toColourspace('srgb').raw().toBuffer();
  const [a, b] = await Promise.all([sample(before), sample(after)]);
  let changed = 0;
  for (let i = 0; i < a.length; i += 3) {
    if (Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2])) > 3) changed++;
  }
  return +(100 * changed / (a.length / 3)).toFixed(3);
}

async function validate(label, picked, base) {
  const context = await browser.createBrowserContext();
  const result = report.cases[label] = { id: picked, url: playUrl(base, picked, true) };
  try {
    const { page, errors, warnings } = await openPage(context, result.url);
    Object.assign(result, { errors, warnings });
    await page.waitForFunction(() => window.__ew?.assetsReady() && __ew.state().mode === 'play' && !document.getElementById('loading'), { timeout: 90000 });
    const ready = await page.evaluate(() => ({
      edition: __ew.edition(), nativeWebGPU: !!__ew.renderer.backend?.isWebGPUBackend,
      fire: __ew.perf().fire?.modules, fixture: !!__ew.fireFixture && __ew.modules().look?.ok,
    }));
    Object.assign(result, { edition: ready.edition, modules: ready.fire });
    assert.equal(ready.edition.edition, backend, ready.edition.why);
    if (backend === 'webgpu') assert.ok(ready.nativeWebGPU, 'The WebGPU test needs a native WebGPU device');
    checkSlots(result.modules, picked);
    assert.ok(ready.fixture, 'Use the Valleyward dev server with the module QA hooks available');

    const fixture = new URL('/tools/qa/fire-scene.mjs', base).href;
    const frame = await page.evaluate(async ({ fixture, slot }) => (await import(fixture)).replay(slot), { fixture, slot });
    result.modules = frame.fire?.modules;
    checkSlots(result.modules, picked);
    result.slotStats = frame.fire?.slots;
    result.timing = frame.fireTiming;
    assert.equal(frame.dpr, 1, 'Comparison fixture must keep DPR 1');
    assert.ok(result.timing?.cpuSubmissionMs.combined.samples >= 20, 'No paired fire scopes were captured');
    if (result.timing.gpuMs) assert.ok(result.timing.gpuMs.combined.samples > 0, 'No GPU queries completed');

    await page.evaluate(async ({ fixture, slot }) => (await import(fixture)).freezeShot(slot), { fixture, slot });
    const draw = () => page.evaluate(async () => {
      for (let i = 0; i < 3; i++) await new Promise(requestAnimationFrame);
    });
    const shot = (name) => page.screenshot({ path: join(output, `${label}-${name}.png`) });
    await draw();
    const paused = await shot('shot');
    await draw();
    const still = await page.screenshot();
    await page.evaluate(async (fixture) => { window.removeFireOccluder = (await import(fixture)).occlude(); }, fixture);
    await draw();
    const occluded = await shot('occluded');
    await page.evaluate(() => __ew.fireFixture.setComposite(false));
    await draw();
    const withoutFire = await page.screenshot();
    await page.evaluate(() => { __ew.fireFixture.setComposite(true); window.removeFireOccluder(); });
    result.pixels = {
      changedWhilePausedPct: await changedPercent(paused, still),
      changedWithOccluderPct: await changedPercent(paused, occluded),
      occludedFireDifferencePct: await changedPercent(occluded, withoutFire),
    };
    assert.ok(result.pixels.changedWhilePausedPct <= 1, 'The paused fixture changed visibly');
    assert.ok(result.pixels.changedWithOccluderPct > 20, 'The opaque test surface did not cover the sample region');
    assert.ok(result.pixels.occludedFireDifferencePct <= 1, 'The module drew fire in front of the opaque test surface');
    checkSlots(await page.evaluate(() => __ew.perf().fire?.modules), picked);
    assert.deepEqual(errors, [], 'Browser or shader errors');
    assert.ok(!warnings.some((line) => /shader|fluid pass failed|webgl error|validation error/i.test(line)), warnings.join('\n'));
    result.passed = true;
  } finally { await context.close(); }
}

try {
  if (!await reachable(selectedUrl)) {
    assert.ok(!values.url, `No Valleyward server is responding at ${selectedUrl}`);
    server = await startVite(5359);
  }
  const base = new URL(server?.url ?? selectedUrl);
  printLinks(base);
  browser = await launch({ ...viewport, userDataDir: profile });
  report.browser = await browser.version();
  await validate('candidate', id, base);
  if (id !== reference) await validate('classic', reference, base);
  console.log(`Module check passed. Evidence: ${join(output, 'report.json')}`);
} catch (error) {
  report.error = error.message;
  process.exitCode = 1;
  console.error(`Module check failed: ${error.message}\nReport: ${join(output, 'report.json')}`);
} finally {
  try { await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n'); }
  finally {
    await browser?.close();
    server?.kill();
    await rm(profile, { recursive: true, force: true });
  }
}
