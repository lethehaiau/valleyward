// Headless-Chrome plumbing shared by the QA scripts: servers for the app, a browser, pages that record their errors.
// The browser and its GL flags come from tools/platform.mjs (puppeteer-core never downloads one). Run every caller
// under tools/gpu-lock.sh: one Chrome at a time on this machine.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { CHROME, chromeGLArgs } from '../platform.mjs';

/** The repository root (the app lives at the top of it, so both names point there). */
export const APP = fileURLToPath(new URL('../..', import.meta.url)).replace(/[\\/]$/, '');
export const ROOT = APP;

export const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

// ---- servers ---------------------------------------------------------------------------------------------------------
const VITE_CLI = path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
const POLL_MS = 250, POLL_TRIES = 120;   // up to 30 s for a server to answer

/** Spawn `node <args…>` in the app folder with its output kept, and poll the server until it answers on `port`. */
async function serve(args, port, what) {
  const proc = spawn(process.execPath, args, { cwd: APP, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  const keep = (chunk) => { output += chunk; };
  proc.stdout.on('data', keep);
  proc.stderr.on('data', keep);
  const server = { url: `http://127.0.0.1:${port}/`, kill: () => proc.kill('SIGTERM'), get log() { return output; } };
  const running = () => proc.exitCode === null && proc.signalCode === null;
  for (let tries = 0; tries < POLL_TRIES && running(); tries++) {
    const up = await fetch(server.url).then((res) => { res.body?.cancel().catch(() => {}); return res.ok; }, () => false);
    if (up) return server;
    await sleep(POLL_MS);
  }
  proc.kill('SIGTERM');
  throw new Error(`${what} did not start on ${port}:\n${output}`);
}

/** The app's Vite dev server on `port` (strict port, no HMR and no file watching: tools/qa/serve.mjs). Resolves once it
 *  answers with { url, kill(), log }. */
export function startVite(port) {
  return serve([fileURLToPath(new URL('./serve.mjs', import.meta.url)), String(port)], port, 'vite');
}

/** A production build of the app in `outDir` (skipped with build: false), served by `vite preview` on `port`.
 *  Resolves with { url, kill(), log }. */
export async function startPreview(port, outDir, opts = {}) {
  const { build = true } = opts;
  if (build) {
    const code = await new Promise((done, fail) => {
      const b = spawn(process.execPath, [VITE_CLI, 'build', '--outDir', outDir, '--emptyOutDir', '--logLevel', 'warn'], { cwd: APP, stdio: 'inherit' });
      b.on('error', fail);
      b.on('exit', done);
    });
    if (code !== 0) throw new Error(`vite build exited ${code}`);
  }
  return serve([VITE_CLI, 'preview', '--outDir', outDir, '--port', String(port), '--strictPort', '--host', '127.0.0.1'], port, 'vite preview');
}

// ---- the browser -----------------------------------------------------------------------------------------------------
/**
 * Launch headless Chrome with this machine's GL flags and WebGPU exposed (the webgpu edition, decision 0001).
 * @param {{ width?: number, height?: number, uncapped?: boolean, userDataDir?: string }} [o] uncapped: no vsync and no frame-rate limit
 */
export function launch({ width = 1280, height = 720, uncapped = false, userDataDir } = {}) {
  const args = chromeGLArgs();
  args.push('--enable-unsafe-webgpu', '--autoplay-policy=no-user-gesture-required', '--no-first-run',
    '--no-default-browser-check', `--window-size=${width},${height}`);
  if (uncapped) args.push('--disable-gpu-vsync', '--disable-frame-rate-limit');
  return puppeteer.launch({
    executablePath: CHROME, headless: true, args, defaultViewport: { width, height },
    ...(userDataDir && { userDataDir, pipe: true }),
  });
}

/**
 * Open `url` in a new tab that records what went wrong. errors: console errors (with the script URL when known), page
 * errors, failed requests other than the favicon, and every HTTP response of 400 or more (it names the URL behind a
 * bare "Failed to load resource"). warnings: console warnings.
 * @returns {Promise<{ page: any, errors: string[], warnings: string[] }>}
 */
export async function openPage(browser, address) {
  const tab = await browser.newPage();
  const errors = [];
  const warnings = [];
  tab.on('console', (msg) => {
    const kind = msg.type();
    if (kind === 'warn' || kind === 'warning') warnings.push(msg.text());
    if (kind !== 'error') return;
    const where = msg.location()?.url;
    errors.push(where ? `${msg.text()} @ ${where}` : msg.text());
  });
  tab.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  tab.on('requestfailed', (req) => {
    if (!req.url().includes('favicon')) errors.push(`requestfailed: ${req.url()} ${req.failure()?.errorText}`);
  });
  tab.on('response', (res) => {
    if (res.status() >= 400) errors.push(`http ${res.status()}: ${res.url()}`);
  });
  await tab.goto(address, { timeout: 90000, waitUntil: 'domcontentloaded' });
  return { page: tab, errors, warnings };
}

/** Evaluate `fn(arg)` in the page every `everyMs` until it gives something truthy (returned) or `timeoutMs` has passed
 *  (null). A throw in the page counts as "not yet". */
export async function waitFor(page, probe, arg, timeoutMs = 60000, everyMs = 250) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const value = await page.evaluate(probe, arg).catch(() => null);
    if (value) return value;
    await sleep(everyMs);
  }
  return null;
}

/** The mean luma of an image file (Rec. 709 weights on the sRGB-encoded values, 0..1, three decimals), measured in the
 *  page on a 320 px wide copy. */
export async function meanLuma(page, imagePath) {
  const file = imagePath;
  const type = /\.png$/i.test(file) ? 'image/png' : 'image/jpeg';
  const dataUrl = `data:${type};base64,${fs.readFileSync(file).toString('base64')}`;
  return page.evaluate(async (src) => {
    const img = new Image();
    img.src = src;
    await img.decode();
    const w = 320, h = Math.round((w * img.height) / img.width);
    const canvas = Object.assign(document.createElement('canvas'), { width: w, height: h });
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, w, h);
    const px = ctx.getImageData(0, 0, w, h).data;
    let sum = 0;
    for (let k = 0; k < px.length; k += 4) sum += 0.2126 * px[k] + 0.7152 * px[k + 1] + 0.0722 * px[k + 2];
    return Number((sum / (px.length / 4) / 255).toFixed(3));
  }, dataUrl);
}
