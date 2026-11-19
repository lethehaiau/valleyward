// The machine-specific bits of the dev tooling: which Chrome puppeteer-core drives, the GL flags it gets, and where
// ffmpeg is. No dependencies; importing it costs a few file-existence checks.
//
//   import { CHROME, chromeGLArgs, FFMPEG } from './platform.mjs';
//   node tools/platform.mjs            # print this machine's answers as JSON
//
// macOS → Google Chrome.app on ANGLE/Metal and Homebrew's ffmpeg. Linux → google-chrome or chromium on ANGLE/Vulkan when
// a GPU device node is present, otherwise SwiftShader (software GL: captures are valid, frame times are not).
//
// Overrides (environment, all optional):
//   CHROME_BIN              the Chrome/Chromium executable
//   CHROME_GL_ARGS          whitespace-separated flags used instead of chromeGLArgs()'s own
//   FORCE_GPU=0|1           skip the GPU detection (0: treat the machine as software GL)
//   FFMPEG_BIN, FFPROBE_BIN the media tools
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** A trimmed environment variable, '' when unset or blank. */
function setting(name) {
  const raw = process.env[name];
  return raw ? raw.trim() : '';
}
function isFile(p) {
  if (!p) return false;
  try { return fs.existsSync(p); } catch { return false; }
}

const { platform: OS, arch: CPU_ARCH } = process;
export const IS_MAC = OS === 'darwin';

// ---- Chrome ----------------------------------------------------------------------------------------------------------
const CHROME_APP = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const LINUX_BROWSERS = ['google-chrome-stable', 'google-chrome', 'chromium', 'chromium-browser'].map((n) => `/usr/bin/${n}`);

function pickChrome() {
  const forced = setting('CHROME_BIN');
  if (forced) return forced;
  if (IS_MAC) return CHROME_APP;
  // nothing installed: name the usual path anyway, so puppeteer's "Browser was not found at …" says where it looked
  return LINUX_BROWSERS.find(isFile) ?? '/usr/bin/google-chrome';
}
/** The browser executable for puppeteer-core (which never downloads one). */
export const CHROME = pickChrome();

// ---- GPU or software GL ----------------------------------------------------------------------------------------------
function gpuPresent() {
  const forced = setting('FORCE_GPU');
  if (forced === '1') return true;
  if (forced === '0') return false;
  if (IS_MAC || isFile('/dev/nvidia0')) return true;
  let nodes = [];
  try { nodes = fs.readdirSync('/dev/dri'); } catch { /* no DRM devices */ }
  return nodes.some((n) => n.startsWith('renderD'));
}
export const HAS_GPU = gpuPresent();
/** WebGL runs on the CPU (SwiftShader): images are right, frame times mean nothing. */
export const SOFTWARE_GL = !HAS_GPU || setting('CHROME_GL_ARGS').toLowerCase().includes('swiftshader');

// Flag sets per backend; every set ends with the same two switches.
const TAIL = ['--ignore-gpu-blocklist', '--enable-webgl'];
const FLAGS = {
  metal: ['--use-angle=metal', '--enable-gpu', ...TAIL],
  vulkan: ['--use-angle=vulkan', '--enable-features=Vulkan', '--enable-gpu', ...TAIL],
  software: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', ...TAIL],
};

/**
 * Chrome's GL flags for this machine, as a new array the caller may append to.
 * @param {{ mac?: string[] }} [o] mac: a flag set used on macOS instead of the Metal one
 */
export function chromeGLArgs({ mac } = {}) {
  const forced = setting('CHROME_GL_ARGS');
  if (forced) return forced.split(/\s+/);
  if (IS_MAC) return Array.from(mac || FLAGS.metal);
  return Array.from(HAS_GPU ? FLAGS.vulkan : FLAGS.software);
}

// ---- ffmpeg ----------------------------------------------------------------------------------------------------------
const toolPath = (name, override) =>
  setting(override) || ['/opt/homebrew/bin', '/usr/local/bin'].map((dir) => `${dir}/${name}`).find(isFile) || name;
/** FFMPEG_BIN, else a Homebrew ffmpeg, else plain `ffmpeg` (found on PATH). */
export const FFMPEG = toolPath('ffmpeg', 'FFMPEG_BIN');
/** FFPROBE_BIN, else a Homebrew ffprobe, else plain `ffprobe` (found on PATH). */
export const FFPROBE = toolPath('ffprobe', 'FFPROBE_BIN');

// ---- run directly: print what this machine resolves to ---------------------------------------------------------------
const self = fileURLToPath(import.meta.url);
const launched = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (launched && (launched === self || (isFile(launched) && fs.realpathSync(launched) === self))) {
  const summary = {
    platform: `${OS}-${CPU_ARCH}`,
    cpus: os.cpus().length,
    HAS_GPU,
    SOFTWARE_GL,
    CHROME,
    chromeGLArgs: chromeGLArgs(),
    FFMPEG,
    FFPROBE,
  };
  console.log(JSON.stringify(summary, null, 2));
}
