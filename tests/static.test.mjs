// Static contracts of the source tree, checked on what the code declares rather than on how it is written:
//   - index.html boots ./src/main.js as an ES module;
//   - nothing in src/ (nor index.html) names a web-root "/assets/…" URL: the build has a relative base, so it can be
//     served from any path, and asset URLs come from import.meta.env.BASE_URL;
//   - the object on window.__ew carries every hook of DESIGN §14.8 and every hook the QA tools call;
//   - the URL parser in src/core reads every documented URL parameter (docs/DEVELOPING.md "URL parameters");
//   - the sim and the bot stay pure: no three.js, no DOM, no Math.random;
//   - the eight parts load through import.meta.glob, never through static imports, so any of them may be absent.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = fileURLToPath(new URL('..', import.meta.url));
const read = (file) => fs.readFileSync(path.isAbsolute(file) ? file : path.join(APP, file), 'utf8');
const rel = (abs) => path.relative(APP, abs);
function filesUnder(dir) {
  const out = [];
  const visit = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) visit(p); else out.push(p);
    }
  };
  visit(path.join(APP, dir));
  return out;
}
/** Source without the comments that stand on their own lines (// lines and /* … *\/ blocks), so prose never satisfies
 *  a check. (Only line-leading ones: a glob string such as '../*\/index.js' must survive.) */
const code = (src) => src.replace(/^[ \t]*\/\*[\s\S]*?\*\//gm, '').replace(/^[ \t]*\/\/.*$/gm, '');

const PARTS = ['env', 'look', 'fire', 'actors', 'fx', 'cinema', 'ui', 'audio'];
const MAIN = path.join(APP, 'src/main.js');
const CORE = filesUnder('src/core').filter((f) => /\.m?js$/.test(f));

// ---- a small JS lexer: enough to step over strings, templates and comments and to read an object literal's keys ----
/** The index just past the string, template literal or comment that starts at `i`; `i` itself when none does. */
function skipNonCode(src, i) {
  const c = src[i];
  if (c === '/' && src[i + 1] === '/') { const e = src.indexOf('\n', i); return e < 0 ? src.length : e; }
  if (c === '/' && src[i + 1] === '*') { const e = src.indexOf('*/', i + 2); return e < 0 ? src.length : e + 2; }
  if (c === '"' || c === "'") {
    let j = i + 1;
    while (j < src.length && src[j] !== c && src[j] !== '\n') j += src[j] === '\\' ? 2 : 1;
    return j + 1;
  }
  if (c === '`') {
    let j = i + 1;
    while (j < src.length && src[j] !== '`') {
      if (src[j] === '\\') j += 2;
      else if (src[j] === '$' && src[j + 1] === '{') j = pastBalanced(src, j + 1);
      else j++;
    }
    return j + 1;
  }
  return i;
}
/** The index just past the bracket that closes the one at `open`. */
function pastBalanced(src, open) {
  let depth = 0;
  for (let i = open; i < src.length;) {
    const next = skipNonCode(src, i);
    if (next !== i) { i = next; continue; }
    if ('{[('.includes(src[i])) depth++;
    else if ('}])'.includes(src[i]) && --depth === 0) return i + 1;
    i++;
  }
  return src.length;
}
/** The top-level property names (keys, methods, getters, shorthands, quoted keys) of the object literal whose "{" is at
 *  `open`; null when its brackets never balance. */
function objectKeys(src, open) {
  const keys = [];
  let depth = 0, wantKey = false;
  for (let i = open; i < src.length;) {
    const c = src[i], next = skipNonCode(src, i);
    if (next !== i) {
      if (depth === 1 && wantKey && (c === '"' || c === "'")) { keys.push(src.slice(i + 1, next - 1)); wantKey = false; }
      i = next; continue;
    }
    if ('{[('.includes(c)) { depth++; wantKey = depth === 1; i++; continue; }
    if ('}])'.includes(c)) { if (--depth === 0) return keys; i++; continue; }
    if (depth === 1 && c === ',') { wantKey = true; i++; continue; }
    const word = depth === 1 ? /^[A-Za-z_$][\w$]*/.exec(src.slice(i, i + 64))?.[0] : null;
    if (word) {
      if (wantKey) {
        const modified = /^\s+([A-Za-z_$][\w$]*)\s*\(/.exec(src.slice(i + word.length));   // get x() / async x()
        keys.push(['get', 'set', 'async', 'static'].includes(word) && modified ? modified[1] : word);
        wantKey = false;
      }
      i += word.length; continue;
    }
    if (!/\s/.test(c)) wantKey = false;
    i++;
  }
  return null;
}

// ---- window.__ew ---------------------------------------------------------------------------------------------------
const HOOKS_14_8 = ['state', 'drainEvents', 'setInput', 'step', 'pause', 'resume', 'god', 'skipIntro', 'teleport', 'bot',
  'view', 'spawn', 'troll', 'setClock', 'fireOp', 'fireStyle', 'perf', 'assetsReady', 'busy', 'modules'];

/** The hooks object's top-level keys: the object literal assigned to window.__ew (directly, through a wrapping call such
 *  as Object.freeze({…}), or through a const of the same file), in main.js or a src/core module. Null if none is found. */
function exposedHooks() {
  for (const file of [MAIN, ...CORE]) {
    const src = code(read(file));
    const m = /\b__ew\s*=\s*/.exec(src);
    if (!m) continue;
    let at = m.index + m[0].length;
    const wrapped = /^[\w$.]+\(\s*(?=\{)/.exec(src.slice(at));
    if (wrapped) at += wrapped[0].length;
    else if (src[at] !== '{') {
      const name = /^[A-Za-z_$][\w$]*/.exec(src.slice(at))?.[0];
      const decl = name && new RegExp(`\\b(?:const|let|var)\\s+${name.replace(/\$/g, '\\$')}\\s*=\\s*(?:[\\w$.]+\\(\\s*)?\\{`).exec(src);
      if (!decl) continue;
      at = decl.index + decl[0].length - 1;
    }
    const keys = objectKeys(src, at);
    if (keys) return { file: rel(file), keys: new Set(keys) };
  }
  return null;
}
/** The hooks the QA tools call (tools/qa/*.mjs); one only ever called as __ew.x?.() is optional and left out. */
function toolHooks() {
  const plain = new Map();
  for (const f of filesUnder('tools/qa').filter((x) => x.endsWith('.mjs'))) {
    for (const m of read(f).matchAll(/__ew\??\.([A-Za-z_$][\w$]*)(\?\.)?/g)) plain.set(m[1], plain.get(m[1]) || !m[2]);
  }
  return [...plain].filter(([, p]) => p).map(([name]) => name).sort();
}

test('main.js exposes every hook of DESIGN §14.8 on window.__ew and reads every URL parameter', () => {
  const hooks = exposedHooks();
  assert.ok(hooks, 'an object literal assigned to window.__ew in src/main.js or src/core');
  assert.deepEqual(HOOKS_14_8.filter((h) => !hooks.keys.has(h)), [], `hooks of DESIGN §14.8 missing from ${hooks.file}`);
  const used = toolHooks();
  assert.ok(used.length >= 20, `the QA tools call ${used.length} hooks`);
  assert.deepEqual(used.filter((h) => !hooks.keys.has(h)), [], `hooks the QA tools call but ${hooks.file} does not define`);

  // the parser: the src/core module(s) that read the query with URLSearchParams
  const parser = CORE.map((f) => code(read(f))).filter((s) => /URLSearchParams/.test(s)).join('\n');
  assert.ok(parser, 'a src/core module parses the URL with URLSearchParams');
  const PARAMS = ['seed', 'autoplay', 'noisy', 'skipintro', 'noui', 'quality', 'look', 'fire', 'view', 'debug', 'perf',
    'gpuPerf', 'fps', 'god', 'speed', 'clock', 'troll', 'mute', 'fov', 'fireproxy', 'warmskip', 'save', 'camp', 'night',
    'ending', 'cap'];
  const unread = PARAMS.filter((k) => !new RegExp(`(['"\`])${k}\\1|(?:^|[\\s{,])${k}\\s*:`, 'm').test(parser));
  assert.deepEqual(unread, [], 'URL parameters the parser never names');
});

test('the sim and the bot never import three.js or touch the DOM', () => {
  const impure = /from\s*['"]three|import\(\s*['"]three|require\(\s*['"]three|\bdocument\.|\bwindow\.|Math\.random\(/;
  for (const f of [...filesUnder('src/sim'), ...filesUnder('src/bot')]) assert.doesNotMatch(read(f), impure, rel(f));
});

// ---- the module loader -------------------------------------------------------------------------------------------
/** The string patterns passed to the import.meta.glob(…) calls in `src`. */
function globPatterns(src) {
  const out = [];
  for (const m of src.matchAll(/import\.meta\.glob\s*\(/g)) {
    const open = m.index + m[0].length - 1, close = pastBalanced(src, open);
    for (let i = open + 1; i < close;) {
      const next = skipNonCode(src, i);
      if (next !== i && /["'`]/.test(src[i])) out.push(src.slice(i + 1, next - 1));
      i = next !== i ? next : i + 1;
    }
  }
  return out;
}
/** A Vite glob pattern (*, **, ?, {a,b}) as a RegExp. */
function globRegExp(glob) {
  let re = '', braces = 0;
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') { re += '.*'; i++; }
    else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else if (c === '{') { re += '(?:'; braces++; }
    else if (c === '}' && braces) { re += ')'; braces--; }
    else if (c === ',' && braces) re += '|';
    else re += c.replace(/[.+^$|(){}[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

test('the module loader tolerates every part being absent (import.meta.glob, not static imports)', () => {
  const lanes = PARTS.join('|');
  // static imports and re-exports of a part: from './ui/…' or a bare import './ui/…' (a dynamic import( is fine)
  assert.doesNotMatch(code(read(MAIN)), new RegExp(`(?:from|import)\\s*['"]\\./(?:${lanes})/`), 'main.js imports a part statically');
  for (const f of CORE) {
    assert.doesNotMatch(code(read(f)), new RegExp(`(?:from|import)\\s*['"]\\.\\./(?:${lanes})/`), `${rel(f)} imports a part statically`);
  }
  const patterns = globPatterns(code(read('src/core/modules.js')));
  const take = patterns.filter((p) => !p.startsWith('!')).map(globRegExp);
  const drop = patterns.filter((p) => p.startsWith('!')).map((p) => globRegExp(p.slice(1)));
  const unreachable = PARTS.filter((lane) => {
    const entry = `../${lane}/index.js`;
    return !take.some((r) => r.test(entry)) || drop.some((r) => r.test(entry));
  });
  assert.deepEqual(unreachable, [], 'parts whose index.js no import.meta.glob pattern in src/core/modules.js finds');
});

test('index.html loads the game module', () => {
  const tags = [...read('index.html').matchAll(/<script\b([^>]*)>/gi)].map((m) => m[1]);
  const attr = (tag, name) => tag.match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'))?.slice(1).find((v) => v != null);
  const entry = tags.find((t) => /^(\.\/)?src\/main\.js$/.test(attr(t, 'src') || ''));
  assert.ok(entry, 'a <script> whose src is ./src/main.js (relative)');
  assert.equal(attr(entry, 'type'), 'module');
});

test('no web-root asset URLs in src/ (quoted "/assets/…")', () => {
  const offenders = [];
  const files = [...filesUnder('src').filter((f) => /\.(m?js|css|html)$/.test(f)), path.join(APP, 'index.html')];
  for (const file of files) {
    read(file).split('\n').forEach((line, i) => {
      if (/["'`(]\/assets\//.test(line)) offenders.push(`${rel(file)}:${i + 1}: ${line.trim().slice(0, 120)}`);
    });
  }
  assert.deepEqual(offenders, []);
});
