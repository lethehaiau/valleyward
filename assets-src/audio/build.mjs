#!/usr/bin/env node
// VALLEYWARD · audio · build the shipped sound set from the raw ElevenLabs takes (assets-src/audio/raw/, gitignored
// binaries) and the procedural sounds below: split multi-sound takes into variants on silence, trim, cut seamless loops
// (music: a bar-like period found by onset-envelope correlation, then sample-aligned; SFX/beds: an end→start crossfade),
// normalise (music −18 LUFS, beds/loops −20/−18 LUFS, SFX peak −3 dBFS), encode Opus in WebM (SFX mono, music and beds
// stereo), verify the decoded files, and write {manifest.json,provenance.json} into .private/audio/ (or $VALLEYWARD_AUDIO_DIR; never committed) plus an analysis table
// (analysis.{json,md} in a local scratch folder, not in the repo).
//   node assets-src/audio/build.mjs [--only id,id]
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { MUSIC, SFX, MUSIC2, SFX2, CINDER, GUN2, SFX3, MUSIC4, SFX4, CINDER4, SFX5 } from './jobs.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(here, '../..');
const REPO = APP;
const RAW = path.join(here, 'raw');
const OUT = path.resolve(APP, process.env.VALLEYWARD_AUDIO_DIR || '.private/audio');   // not in the repo: tools/vite-audio.mjs
const SCR = path.join(REPO, '.scratch/audio/build');
const SR = 48000;
const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const only = opt('--only') ? new Set(opt('--only').split(',')) : null;
let FFMPEG = 'ffmpeg';
try { FFMPEG = (await import(path.join(REPO, 'tools/platform.mjs'))).FFMPEG || 'ffmpeg'; } catch { /* PATH */ }
const { SOUNDS } = await import(path.join(APP, 'src/audio/bank.js'));
fs.mkdirSync(path.join(OUT, 'music'), { recursive: true });
fs.mkdirSync(path.join(OUT, 'sfx'), { recursive: true });
fs.mkdirSync(path.join(OUT, 'voice'), { recursive: true });
fs.mkdirSync(SCR, { recursive: true });
const DATE = new Date().toISOString().slice(0, 10);
const rel = (p) => path.relative(REPO, p).split(path.sep).join('/');

// ------------------------------------------------------------------------------------------------ I/O
/** Decode any file to float32 at 48 kHz, `ch` channels, de-interleaved: [Float32Array, …]. */
function readPCM(file, ch) {
  const r = spawnSync(FFMPEG, ['-v', 'error', '-i', file, '-f', 'f32le', '-ac', String(ch), '-ar', String(SR), '-'], { maxBuffer: 1 << 30, timeout: 120000 });
  if (r.status !== 0) throw new Error(`decode ${file}: ${r.stderr}`);
  const all = new Float32Array(r.stdout.buffer, r.stdout.byteOffset, r.stdout.byteLength / 4);
  const n = all.length / ch; const out = [];
  for (let c = 0; c < ch; c++) { const a = new Float32Array(n); for (let i = 0; i < n; i++) a[i] = all[i * ch + c]; out.push(a); }
  return out;
}
function interleave(chs) {
  const n = chs[0].length, C = chs.length, o = new Float32Array(n * C);
  for (let i = 0; i < n; i++) for (let c = 0; c < C; c++) o[i * C + c] = chs[c][i];
  return Buffer.from(o.buffer);
}
/** raw float PCM to a scratch file (ffmpeg reads it from disk: a large stdin pipe once hung the build) */
function rawFile(chs) { const f = path.join(SCR, '_in.f32'); fs.writeFileSync(f, interleave(chs)); return f; }
function writeWav(file, chs) {
  const r = spawnSync(FFMPEG, ['-v', 'error', '-y', '-f', 'f32le', '-ar', String(SR), '-ac', String(chs.length), '-i', rawFile(chs), '-c:a', 'pcm_s16le', file], { maxBuffer: 1 << 26, timeout: 120000 });
  if (r.status !== 0) throw new Error(`wav ${file}: ${r.stderr}`);
}
function encode(file, chs, kbps) {
  const r = spawnSync(FFMPEG, ['-v', 'error', '-y', '-f', 'f32le', '-ar', String(SR), '-ac', String(chs.length), '-i', rawFile(chs),
    '-c:a', 'libopus', '-b:a', `${kbps}k`, '-vbr', 'on', '-application', 'audio', '-frame_duration', '20', '-f', 'webm', file], { maxBuffer: 1 << 26, timeout: 120000 });
  if (r.status !== 0) throw new Error(`encode ${file}: ${r.stderr}`);
}
/** EBU R128 of a set of channels: { I (LUFS), TP (dBTP) }. */
function loudness(chs) {
  const w = path.join(SCR, '_l.wav'); writeWav(w, chs);
  const r = spawnSync(FFMPEG, ['-hide_banner', '-nostats', '-i', w, '-af', 'ebur128=peak=true:framelog=quiet', '-f', 'null', '-'], { encoding: 'utf8', maxBuffer: 1 << 26, timeout: 120000 });
  const s = r.stderr.slice(r.stderr.lastIndexOf('Summary:'));
  const num = (re) => { const m = re.exec(s); return m ? (m[1] === '-inf' ? -Infinity : Number(m[1])) : null; };
  return { I: num(/I:\s+(-?[\d.]+|-inf) LUFS/), TP: num(/Peak:\s+(-?[\d.]+|-inf) dBFS/) };
}

// ------------------------------------------------------------------------------------------------ DSP helpers
const db = (x) => 20 * Math.log10(Math.max(1e-12, x));
const fromDb = (d) => Math.pow(10, d / 20);
const mono = (chs) => { if (chs.length === 1) return chs[0]; const n = chs[0].length, o = new Float32Array(n); for (let i = 0; i < n; i++) { let s = 0; for (const c of chs) s += c[i]; o[i] = s / chs.length; } return o; };
const peak = (chs) => { let p = 0; for (const c of chs) for (let i = 0; i < c.length; i++) { const a = Math.abs(c[i]); if (a > p) p = a; } return p; };
const scale = (chs, g) => { for (const c of chs) for (let i = 0; i < c.length; i++) c[i] *= g; };
const slice = (chs, a, b) => chs.map((c) => c.slice(a, b));
/** RMS envelope (hop samples). */
function env(x, hop) { const n = Math.floor(x.length / hop), e = new Float32Array(n); for (let k = 0; k < n; k++) { let s = 0; for (let i = k * hop; i < (k + 1) * hop; i++) s += x[i] * x[i]; e[k] = Math.sqrt(s / hop); } return e; }
/** Soft ceiling: transparent below `t`, smoothly saturating to `ceil` above (sample-wise, no latency: loop-safe). */
function softClip(chs, ceil = fromDb(-1.2), t = fromDb(-4)) {
  let n = 0;
  for (const c of chs) for (let i = 0; i < c.length; i++) {
    const a = Math.abs(c[i]); if (a <= t) continue; n++;
    c[i] = Math.sign(c[i]) * (t + (ceil - t) * Math.tanh((a - t) / (ceil - t)));
  }
  return n;
}
function fadeIn(chs, n) { for (const c of chs) for (let i = 0; i < Math.min(n, c.length); i++) c[i] *= i / n; }
function fadeOut(chs, n) { for (const c of chs) { const L = c.length; for (let i = 0; i < Math.min(n, L); i++) c[L - 1 - i] *= i / n; } }
/** Trim leading / trailing silence below (peak − rel dB) and fade the edges. */
function trim(chs, rel = 50, pre = 0.004, fadeMs = 30) {
  const m = mono(chs); const p = peak([m]); const th = p * fromDb(-rel);
  const hop = 96; const e = env(m.map(Math.abs), hop); // ≈2 ms
  let a = 0; while (a < e.length && e[a] < th) a++;
  let b = e.length - 1; while (b > a && e[b] < th) b--;
  const s0 = Math.max(0, a * hop - Math.round(pre * SR)), s1 = Math.min(m.length, (b + 1) * hop + Math.round(0.02 * SR));
  const out = slice(chs, s0, s1); fadeIn(out, Math.round(0.002 * SR)); fadeOut(out, Math.round(fadeMs / 1000 * SR));
  return out;
}
/**
 * Split a take holding several sounds into `n` variants. The takes rarely leave clean silence between the sounds, so the
 * cut is onset-based: an onset is a rise of ≥ 9 dB within 60 ms to within 24 dB of the take's peak, at least `gap` s after
 * the previous one; a part runs from its onset to the next onset (or until it falls 45 dB under its peak, at most `max`
 * s). The n loudest parts are kept, in time order.
 */
function split(chs, n, { gap = 0.22, max = 1.2, minDur = 0 } = {}) {
  const m = mono(chs); const hop = 240; const e = env(m, hop); const ed = Array.from(e, (v) => db(v)); // 5 ms
  const pk = Math.max(...ed); const minGap = Math.round(gap * SR / hop);
  const onsets = []; let last = -1e9;
  for (let k = 1; k < ed.length; k++) {
    let lo = Infinity; for (let j = Math.max(0, k - 12); j < k; j++) lo = Math.min(lo, ed[j]);
    if (ed[k] - lo >= 9 && ed[k] >= pk - 24 && k - last >= minGap) { onsets.push(k); last = k; }
  }
  if (!onsets.length) onsets.push(0);
  const parts = onsets.map((a, i) => {
    let p = -Infinity; for (let j = a; j < Math.min(ed.length, a + 20); j++) p = Math.max(p, ed[j]);
    const hard = Math.min(i + 1 < onsets.length ? onsets[i + 1] - 2 : ed.length, a + Math.round(max * SR / hop));
    let b = a + 4; while (b < hard && ed[b] > p - 45) b++;
    return { a, b, p };
  });
  const found = parts.length;
  const keep = parts.filter((r) => (r.b - r.a) * hop / SR >= minDur).sort((x, y) => y.p - x.p).slice(0, n).sort((x, y) => x.a - y.a);
  const outs = keep.map((r) => {
    const s0 = Math.max(0, r.a * hop - 480), s1 = Math.min(m.length, r.b * hop);
    const y = slice(chs, s0, s1); fadeIn(y, Math.round(0.003 * SR)); fadeOut(y, Math.round(Math.min(0.08, (s1 - s0) / SR / 3) * SR));
    return y;
  });
  return { outs, found };
}
/**
 * Loop seam metric (on the decoded file): `ratio` = the sample jump across end→start over the signal's mean sample step
 * (≈ 1 is seamless; > 4 an audible click is likely); `rmsStepDb` = RMS of the first 50 ms over the last 50 ms; `pctile` =
 * where that step ranks among the |RMS steps| at every other 50 ms boundary inside the file (a seam at ≤ 0.9 is no
 * bigger than the sound's own ordinary motion; a loop cut on a downbeat ranks high because a drum hit starts there).
 */
function seam(chs) {
  const x = mono(chs); const n = x.length; let d = 0; for (let i = 1; i < n; i++) d += Math.abs(x[i] - x[i - 1]); d /= (n - 1);
  const jump = Math.abs(x[0] - x[n - 1]);
  const w = Math.round(0.05 * SR); let a = 0, b = 0; for (let i = 0; i < w; i++) { a += x[n - w + i] ** 2; b += x[i] ** 2; }
  const step = 10 * Math.log10((b + 1e-12) / (a + 1e-12));
  const e = env(x, w); const steps = []; for (let k = 1; k < e.length; k++) steps.push(Math.abs(20 * Math.log10((e[k] + 1e-9) / (e[k - 1] + 1e-9))));
  const pct = steps.filter((v) => v < Math.abs(step)).length / Math.max(1, steps.length);
  return { ratio: +(jump / (d + 1e-9)).toFixed(2), rmsStepDb: +step.toFixed(2), pctile: +pct.toFixed(2) };
}
/**
 * A seamless loop from x[a .. b) with an equal-power crossfade of N samples: y[t] = x[b+t]·cos + x[a+t]·sin for t < N,
 * else x[a+t]. y wraps from x[b−1] to x[b]: continuous by construction. Needs x up to b+N.
 */
function makeLoop(chs, a, b, N) {
  const L = b - a;
  return chs.map((x) => {
    const y = new Float32Array(L);
    for (let t = 0; t < L; t++) {
      if (t < N) { const u = (t + 0.5) / N; y[t] = x[b + t] * Math.cos(u * Math.PI / 2) + x[a + t] * Math.sin(u * Math.PI / 2); }
      else y[t] = x[a + t];
    }
    return y;
  });
}
/** Onset strength (10 ms frames): the low band (drums, < ~180 Hz) plus half the full band, half-wave log rises, smoothed. */
function onsetEnv(x) {
  const hop = 480;
  const lo = Float32Array.from(x); onePoleLP(lo, 180); onePoleLP(lo, 180);
  const e1 = env(lo, hop), e2 = env(x, hop); const n = e1.length; const on = new Float32Array(n);
  for (let k = 1; k < n; k++) on[k] = Math.max(0, Math.log(e1[k] + 1e-4) - Math.log(e1[k - 1] + 1e-4)) + 0.5 * Math.max(0, Math.log(e2[k] + 1e-4) - Math.log(e2[k - 1] + 1e-4));
  const sm = new Float32Array(n); for (let k = 1; k < n - 1; k++) sm[k] = (on[k - 1] + 2 * on[k] + on[k + 1]) / 4;
  return { on: sm, e: e2, hop };
}
/**
 * Beat period (10 ms frames, fractional) and phase. The cues were asked for at 92 BPM (jobs.mjs), so the search is a
 * prior window of 80–104 BPM: the period whose comb (lags P, 2P, 4P, 8P, 16P) collects the most onset product.
 */
function beatOf(on, from = 0, to = on.length) {
  const at = (t) => { const i = Math.floor(t), f = t - i; return (on[i] || 0) * (1 - f) + (on[i + 1] || 0) * f; };
  let best = -1, P = 65;
  for (let p = 57.7; p <= 75; p += 0.02) {
    let sc = 0;
    for (const j of [1, 2, 4, 8, 16]) { const lag = j * p; for (let k = from; k + lag < to; k += 1) sc += on[k] * at(k + lag); }
    if (sc > best) { best = sc; P = p; }
  }
  let bestPh = 0, bestS = -1;
  for (let ph = 0; ph < P; ph += 1) { let s0 = 0; for (let t = from + ph; t < to; t += P) s0 += at(t); if (s0 > bestS) { bestS = s0; bestPh = ph; } }
  return { P, phase: (bestPh - from + P * 1000) % P };
}
/**
 * Music loop points. The beat period P comes from the onset autocorrelation; the loop length L is a whole number of
 * 4-beat bars inside [minL, maxL]; the start a (aMin..aMax s) and L (± 30 ms around each bar multiple) maximise the
 * onset-envelope correlation over 8 s after a and after a+L, with a level match; then b is sample-aligned by waveform
 * correlation (± 12 ms). Returns { a, b, bpm, bars, envCorr, waveCorr }.
 */
function findMusicLoop(chs, { aMin = 3, aMax = 16, minL = 40, maxL = 86, xf = 1.0 } = {}) {
  const x = mono(chs); const { on, e, hop } = onsetEnv(x);
  const total = e.length; const W = 800; const need = Math.ceil((xf + 0.3) * SR / hop);
  const { P } = beatOf(on, Math.round(aMin * 100), total - 300);
  const corr = (p, q, w, s) => {
    let sp = 0, sq = 0, pp = 0, qq = 0, pq = 0, cnt = 0;
    for (let i = 0; i < w; i += s) { const u = on[p + i], v = on[q + i]; sp += u; sq += v; pp += u * u; qq += v * v; pq += u * v; cnt++; }
    const cov = pq / cnt - (sp / cnt) * (sq / cnt); const vu = pp / cnt - (sp / cnt) ** 2, vv = qq / cnt - (sq / cnt) ** 2;
    return cov / Math.sqrt(vu * vv + 1e-12);
  };
  const lvl = (p, w) => { let s0 = 0; for (let i = 0; i < w; i++) s0 += e[p + i] * e[p + i]; return 10 * Math.log10(s0 / w + 1e-12); };
  let best = { a: 0, L: 0, bars: 0, score: -9 };
  for (let bars = Math.ceil(minL * 100 / (4 * P)); bars * 4 * P <= maxL * 100; bars++) {
    const L0 = Math.round(bars * 4 * P);
    for (let a = Math.round(aMin * 100); a <= Math.round(aMax * 100); a += 5) {
      for (let L = L0 - 6; L <= L0 + 6; L++) {
        if (a + L + Math.max(W, need) >= total) continue;
        const c = corr(a, a + L, W, 1); const lv = Math.abs(lvl(a, 200) - lvl(a + L, 200));
        const score = c - 0.04 * lv + 0.0015 * bars; // prefer longer loops a little
        if (score > best.score) best = { a, L, bars, score };
      }
    }
  }
  const A = best.a * hop; const B = (best.a + best.L) * hop; const w = Math.round(0.04 * SR); let bestC = -Infinity, bestB = B;
  for (let s = -576; s <= 576; s++) {
    let c = 0, u2 = 0, v2 = 0; const bb = B + s;
    for (let i = 0; i < w; i += 2) { const u = x[A + i], v = x[bb + i]; c += u * v; u2 += u * u; v2 += v * v; }
    c /= Math.sqrt(u2 * v2 + 1e-12); if (c > bestC) { bestC = c; bestB = bb; }
  }
  const lvA = lvl(best.a, 100), lvB = lvl(best.a + best.L, 100); // the two 1 s segments the crossfade blends
  return { a: A, b: bestB, bpm: +(6000 / P).toFixed(2), bars: best.bars, xfLevelDiffDb: +(lvB - lvA).toFixed(2), envCorr: +corr(best.a, best.a + best.L, W, 1).toFixed(3), waveCorr: +bestC.toFixed(3) };
}
/** Beat grid of a finished loop (for beat-matched crossfades at run time): { bpm, beat0 s }. */
function gridOf(chs) { const { on } = onsetEnv(mono(chs)); const { P, phase } = beatOf(on); return { bpm: +(6000 / P).toFixed(2), beat0: +(phase / 100).toFixed(3) }; }

// ------------------------------------------------------------------------------------------------ procedural sounds
let seed = 7; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
function synth(dur, fn) { const n = Math.round(dur * SR), y = new Float32Array(n); for (let i = 0; i < n; i++) y[i] = fn(i / SR, i); return [y]; }
function onePoleLP(x, hz) { const a = Math.exp(-2 * Math.PI * hz / SR); let s = 0; for (let i = 0; i < x.length; i++) { s = (1 - a) * x[i] + a * s; x[i] = s; } return x; }
function onePoleHP(x, hz) { const y = Float32Array.from(x); onePoleLP(y, hz); for (let i = 0; i < x.length; i++) x[i] -= y[i]; return x; }
const PROC = {
  /** XP gem tick: a bright glassy blip (the engine pitches it up a ladder on rapid pickups). */
  xp_tick: () => synth(0.11, (t) => {
    const e = Math.exp(-t * 48); const a = Math.min(1, t / 0.0015);
    return a * e * (0.6 * Math.sin(2 * Math.PI * 1568 * t) + 0.25 * Math.sin(2 * Math.PI * 3136 * t) + 0.12 * Math.sin(2 * Math.PI * 4704 * t + 1));
  }),
  /** UI click: a tiny wooden tock. */
  ui_click: () => {
    const [y] = synth(0.06, (t) => { const e = Math.exp(-t * 140); return e * (0.7 * Math.sin(2 * Math.PI * 1150 * t) + 0.3 * Math.sin(2 * Math.PI * 2310 * t)) + (t < 0.003 ? (rnd() * 2 - 1) * 0.6 : 0); });
    return [y];
  },
  /** BEGIN NIGHT: a soft low wooden click with a small warm ember breath under it. */
  ui_begin: () => {
    const [y] = synth(0.32, (t) => {
      const c = Math.exp(-t * 90) * (0.55 * Math.sin(2 * Math.PI * 520 * t) + 0.3 * Math.sin(2 * Math.PI * 1040 * t + 0.4)) + (t < 0.002 ? (rnd() * 2 - 1) * 0.25 : 0);
      const br = Math.sin(Math.PI * Math.min(1, t / 0.32)) ** 2 * (rnd() * 2 - 1) * 0.12;
      return c + br;
    });
    onePoleLP(y, 3200);
    return [y];
  },
  /** Card hover: a soft papery swish. */
  card_hover: () => {
    const [y] = synth(0.12, (t) => { const e = Math.sin(Math.PI * Math.min(1, t / 0.12)) ** 2; return e * (rnd() * 2 - 1); });
    onePoleHP(y, 1800); onePoleLP(y, 6500);
    for (let i = 0; i < y.length; i++) y[i] += 0.08 * Math.sin(2 * Math.PI * 1320 * i / SR) * Math.exp(-i / SR * 30);
    return [y];
  },
  /**
   * Coin collect: a bright "pixel" clink. Two contacts of a small metal disc (inharmonic plate modes 1 : 2.32 :
   * 4.25 : 6.63 over 2.35 kHz, the second contact 38 ms later and a fifth higher), then sample-and-hold at 16 kHz and 5-bit
   * amplitude steps for the pixel sheen. The engine pitches it up a ladder on rapid pickups.
   */
  coin_tick: () => {
    const modes = [[1, 1, 70], [2.32, 0.55, 95], [4.25, 0.3, 130], [6.63, 0.18, 170]];
    const [y] = synth(0.17, (t) => {
      let v = 0;
      for (const [t0, f0, g] of [[0, 2350, 0.8], [0.038, 3520, 1]]) {
        const u = t - t0; if (u < 0) continue;
        for (const [r, a, d] of modes) v += g * a * Math.exp(-u * d) * Math.sin(2 * Math.PI * f0 * r * u + r);
        if (u < 0.0015) v += g * 0.4 * (rnd() * 2 - 1);
      }
      return v;
    });
    const hold = SR / 16000; let h = 0;
    for (let i = 0; i < y.length; i++) { if (i % Math.round(hold) === 0) h = Math.round(y[i] * 16) / 16; y[i] = h; }
    onePoleLP(y, 9000); onePoleHP(y, 400);
    return [y];
  },
  /** Dry trigger: the flint hammer falls on an empty pan (two metal clicks, no bang). */
  w_dry: () => {
    const [y] = synth(0.16, (t) => {
      let v = 0;
      for (const [t0, g] of [[0, 1], [0.034, 0.6]]) {
        const u = t - t0; if (u < 0) continue;
        const e = Math.exp(-u * 90);
        v += g * e * (0.5 * Math.sin(2 * Math.PI * 3150 * u) + 0.35 * Math.sin(2 * Math.PI * 4720 * u + 0.5) + 0.25 * Math.sin(2 * Math.PI * 1890 * u)) + g * (u < 0.002 ? (rnd() * 2 - 1) : 0);
      }
      return v;
    });
    return [y];
  },
};
/** Stand-ins if a generated take is missing (never shipped while the take exists). */
function fallback(id) {
  const noise = (dur, lp, hp, att, dec) => { const [y] = synth(dur, (t) => Math.min(1, t / att) * Math.exp(-t / dec) * (rnd() * 2 - 1)); if (hp) onePoleHP(y, hp); if (lp) onePoleLP(y, lp); return [y]; };
  const thump = (dur, f0, f1, dec) => synth(dur, (t) => Math.exp(-t / dec) * Math.sin(2 * Math.PI * (f1 + (f0 - f1) * Math.exp(-t * 18)) * t));
  if (/shot|burst|smash|stomp|impact|thud|breach|explo/.test(id)) { const a = thump(0.8, 160, 45, 0.18)[0], b = noise(0.8, 2500, 80, 0.002, 0.12)[0]; for (let i = 0; i < a.length; i++) a[i] = 0.7 * a[i] + 0.5 * b[i]; return [a]; }
  if (/whoosh|throw|ignite|gust|kindle|sunburst/.test(id)) return noise(1.2, 1800, 200, 0.4, 0.5);
  if (/fire_|lance_loop|crowd|amb_/.test(id)) return noise(6, 1500, 100, 0.001, 1e9);
  return noise(0.3, 3000, 300, 0.005, 0.08);
}

// --------------------------------------------------------------------------------------------------------- voice
/** RBJ biquad (shelf) in place. type 'low' | 'high', f0 Hz, gain dB, slope 0.8 */
function shelf(x, type, f0, gainDb) {
  const A = Math.pow(10, gainDb / 40), w = 2 * Math.PI * f0 / SR, c = Math.cos(w), sn = Math.sin(w), S = 0.8;
  const al = sn / 2 * Math.sqrt((A + 1 / A) * (1 / S - 1) + 2), sq = 2 * Math.sqrt(A) * al;
  let b0, b1, b2, a0, a1, a2;
  if (type === 'low') { b0 = A * ((A + 1) - (A - 1) * c + sq); b1 = 2 * A * ((A - 1) - (A + 1) * c); b2 = A * ((A + 1) - (A - 1) * c - sq); a0 = (A + 1) + (A - 1) * c + sq; a1 = -2 * ((A - 1) + (A + 1) * c); a2 = (A + 1) + (A - 1) * c - sq; }
  else { b0 = A * ((A + 1) + (A - 1) * c + sq); b1 = -2 * A * ((A - 1) + (A + 1) * c); b2 = A * ((A + 1) + (A - 1) * c - sq); a0 = (A + 1) - (A - 1) * c + sq; a1 = 2 * ((A - 1) - (A + 1) * c); a2 = (A + 1) - (A - 1) * c - sq; }
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) { const x0 = x[i]; const y0 = (b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0; x2 = x1; x1 = x0; y2 = y1; y1 = y0; x[i] = y0; }
  return x;
}
/** A small room (a stone stall under a canopy): early reflections at 6–23 ms and a 0.3 s darkening tail. */
function smallRoomIR() {
  let sd = 91; const r = () => { sd = (sd * 1664525 + 1013904223) >>> 0; return sd / 4294967296 * 2 - 1; };
  const n = Math.round(0.3 * SR), ir = new Float32Array(n); let lp = 0;
  for (let i = 0; i < n; i++) { const t = i / SR; lp += (r() - lp) * (0.75 - 0.5 * Math.min(1, t / 0.3)); ir[i] = lp * Math.exp(-t * 23) * Math.min(1, t / 0.004) * 0.5; }
  for (const [ms, g] of [[6.1, 0.5], [9.7, -0.38], [14.2, 0.3], [18.9, -0.22], [23.4, 0.16]]) ir[Math.round(ms / 1000 * SR)] += g;
  return ir;
}
/** Light processing for Brother Cinder: a little warmth (low shelf +2.5 dB at 220 Hz, high shelf −2 dB at 7 kHz, a soft
 *  tanh drive mixed 25 %) and a small room (wet ≈ −14 dB under the dry voice). */
function voiceFx(chs) {
  const x = Float32Array.from(mono(chs));
  shelf(x, 'low', 220, 2.5); shelf(x, 'high', 7000, -2);
  const pk = peak([x]) || 1; for (let i = 0; i < x.length; i++) { const u = x[i] / pk; x[i] = pk * (0.75 * u + 0.25 * Math.tanh(1.6 * u) / Math.tanh(1.6)); }
  const ir = smallRoomIR(); const tail = ir.length; const y = new Float32Array(x.length + tail);
  const sparse = []; for (let k = 0; k < tail; k++) if (Math.abs(ir[k]) > 2e-4) sparse.push(k);
  const wet = fromDb(-14) / 0.5;
  for (let i = 0; i < x.length; i++) { const v = x[i]; y[i] += v; if (v === 0) continue; const vw = v * wet; for (const k of sparse) y[i + k] += vw * ir[k]; }
  fadeOut([y], Math.round(0.12 * SR));
  return [y];
}

// ------------------------------------------------------------------------------------------------------------ guns
/**
 * One gun, every time: the take's main transient moved to 1 ms, a decaying ceiling (no second bang, no sustained hiss),
 * a hard length (Kestrel 0.7 s, blunderbuss 1.2 s) and the same procedural punch under every variant: a 3 ms crack
 * (high-passed noise) and a thump sweeping 90 → 62 Hz (Kestrel) / 80 → 60 Hz (blunderbuss) that decays over ≈ 120 ms.
 */
const GUN = {
  w_kestrel_shot: { len: 0.7, dbPerS: 58, crack: 0.55, thump: 0.5, f0: 90, f1: 62, tau: 0.032 },
  w_blunder_shot: { len: 1.2, dbPerS: 34, crack: 0.45, thump: 0.75, f0: 80, f1: 60, tau: 0.045, scatter: -8 },
};
function gunPunch(g, n) {
  let sd = 1234; const r = () => { sd = (sd * 1664525 + 1013904223) >>> 0; return sd / 4294967296 * 2 - 1; };
  const crack = new Float32Array(n), th = new Float32Array(n); const pre = Math.round(0.001 * SR);
  for (let i = 0; i < Math.round(0.004 * SR); i++) { const t = i / SR; crack[pre + i] = r() * Math.exp(-t / 0.0011); }
  onePoleHP(crack, 1800); onePoleHP(crack, 1800);
  let ph = 0;
  for (let i = 0; i + pre < n; i++) { const t = i / SR; if (t > 0.16) break; const f = g.f1 + (g.f0 - g.f1) * Math.exp(-t / 0.03); ph += 2 * Math.PI * f / SR; th[pre + i] = Math.sin(ph) * Math.exp(-t / g.tau) * Math.min(1, t / 0.0008) * (t > 0.13 ? (0.16 - t) / 0.03 : 1); }
  const pc = peak([crack]) || 1; for (let i = 0; i < n; i++) crack[i] /= pc;
  return { crack, th };
}
/** the take's main transient → 1 ms; ceiling-limited decay; hard length; the punch layered under; returns mono */
function gunShape(chs, id) {
  const g = GUN[id]; const x0 = mono(chs);
  const h1 = 48; const e1 = env(x0, h1); let pe = 0; for (const v of e1) pe = Math.max(pe, v);
  // the shot = the loudest 1 ms frame in the first 0.4 s after the take wakes up; start where the rise into it begins
  // (a flint snap or click before the blast sits before a dip and is cut off)
  let w = 0; while (w < e1.length && e1[w] < pe * fromDb(-30)) w++;
  let km = w; for (let k = w; k < Math.min(e1.length, w + Math.round(0.4 * SR / h1)); k++) if (e1[k] > e1[km]) km = k;
  let a = km; while (a > 0 && e1[a - 1] < e1[a] && e1[a - 1] > e1[km] * fromDb(-40)) a--;
  const s0 = Math.max(0, a * h1 - Math.round(0.0005 * SR));
  const n = Math.round(g.len * SR); const x = new Float32Array(n); for (let i = 0; i < n && s0 + i < x0.length; i++) x[i] = x0[s0 + i];
  const pre = Math.round(0.001 * SR); const y = new Float32Array(n); for (let i = 0; i + pre < n; i++) y[i + pre] = x[i]; // the shot at 1 ms
  for (let i = 0; i < pre; i++) y[i] = 0;
  // decaying ceiling on a 5 ms RMS: level ≤ E0 − dbPerS·t (E0 = the loudest 5 ms in the first 30 ms)
  const hop = 240; const e = env(y, hop); let E0 = 0; for (let k = 0; k < Math.min(e.length, 6); k++) E0 = Math.max(E0, e[k]);
  const gk = new Float32Array(e.length + 1).fill(1);
  // output level o[k] ≤ the decaying ceiling and ≤ 8 dB over the lowest of the last 4 frames (20 ms): no new onset can form
  const o = new Float32Array(e.length);
  for (let k = 0; k < e.length; k++) {
    const t = (k + 0.5) * hop / SR; let allow = E0 * fromDb(-g.dbPerS * t);
    if (k >= 4) { let lo = Infinity; for (let j = Math.max(0, k - 6); j < k; j++) lo = Math.min(lo, o[j]); allow = Math.min(allow, Math.max(lo, E0 * fromDb(-70)) * fromDb(6)); }
    gk[k] = e[k] > allow ? allow / e[k] : 1; o[k] = e[k] * gk[k];
  }
  for (let i = 0; i < n; i++) { const kf = i / hop - 0.5; const k = Math.max(0, Math.floor(kf)); const f = Math.min(1, Math.max(0, kf - k)); y[i] *= gk[k] * (1 - f) + gk[Math.min(gk.length - 1, k + 1)] * f; }
  // blunderbuss: a procedural decaying scatter bed (band-limited noise) `scatter` dB under the ceiling fills the gaps
  // between the take's crackles, so the tail decays as one sound (no gap-then-crackle reads as a new shot)
  if (g.scatter != null) {
    let sd = 99; const r = () => { sd = (sd * 1664525 + 1013904223) >>> 0; return sd / 4294967296 * 2 - 1; };
    const nb = new Float32Array(n); for (let i = 0; i < n; i++) nb[i] = r(); onePoleLP(nb, 2600); onePoleHP(nb, 160);
    let rms = 0; for (let i = 0; i < n; i++) rms += nb[i] * nb[i]; rms = Math.sqrt(rms / n) || 1;
    for (let i = pre; i < n; i++) { const t = (i - pre) / SR; y[i] += nb[i] / rms * E0 * fromDb(-g.dbPerS * t + g.scatter) * Math.min(1, t / 0.004); }
  }
  // hard length: a cosine fade over the last 35 %
  const fs0 = Math.round(n * 0.65); for (let i = fs0; i < n; i++) y[i] *= 0.5 + 0.5 * Math.cos(Math.PI * (i - fs0) / (n - fs0));
  // the punch, scaled to the take's own peak
  const pk = peak([y]) || 1; const { crack, th } = gunPunch(g, n);
  for (let i = 0; i < n; i++) y[i] += pk * (g.crack * crack[i] + g.thump * th[i]);
  return [y];
}
/** onset count / attack / tail on a shaped shot (gunmeasure.mjs's measure, at 48 kHz) */
function gunCheck(y) {
  const hop = 240; let ons = 0, ipk = 0, tail = Infinity, tailMax = 0;
  for (const off of [0, 60, 120, 180]) { // the worst case over frame alignments (the check after encoding frames differently)
    const e = env(y[0].subarray(off), hop); const d = Array.from(e, (v) => db(v)); const pk = Math.max(...d); ipk = Math.max(ipk, d.indexOf(pk));
    let on = 0, last = -1; for (let i = 4; i < d.length; i++) if (d[i] > pk - 24 && d[i] - Math.min(...d.slice(i - 4, i)) > 12 && (last < 0 || i - last > 30)) { on++; last = i; }
    ons = Math.max(ons, on);
    let tl = 0; for (let i = d.length - 1; i >= 0; i--) if (d[i] > pk - 40) { tl = (i * hop + off) / SR; break; }
    tail = Math.min(tail, tl); tailMax = Math.max(tailMax, tl);
  }
  tail = tailMax;
  // spectral brightness proxy for picking similar variants: zero-crossing rate over the first 100 ms
  let zc = 0; const m = Math.min(y[0].length, Math.round(0.1 * SR)); for (let i = 1; i < m; i++) if ((y[0][i] >= 0) !== (y[0][i - 1] >= 0)) zc++;
  return { onsets: ons, attackMs: ipk * 5, tailS: +tail.toFixed(3), zcr: zc / 0.1 };
}

// --------------------------------------------------------------------------------------------------------- the THUNDER ORGAN loop
/** onset strength of x on `hop`-sample frames (half-wave log rises of the RMS envelope) */
function onsetsOf(x, hop) { const e = env(x, hop); const on = new Float32Array(e.length); for (let k = 1; k < e.length; k++) on[k] = Math.max(0, Math.log(e[k] + 1e-5) - Math.log(e[k - 1] + 1e-5)); return { on, e }; }
/** the round period (samples, fractional) by autocorrelation of the onset strength over 40–110 ms (9–25 rounds/s) */
function roundPeriod(x) {
  const hop = 24; const { on } = onsetsOf(x, hop); let best = -1, bl = 0; const sc = [];
  for (let lag = Math.round(0.04 * SR / hop); lag <= Math.round(0.11 * SR / hop); lag++) { let c = 0; for (let k = 0; k + lag < on.length; k++) c += on[k] * on[k + lag]; sc[lag] = c; if (c > best) { best = c; bl = lag; } }
  const a = sc[bl - 1] ?? best, b = sc[bl + 1] ?? best; const d = (a - b) / (2 * (a - 2 * best + b) || 1); // parabolic peak
  return (bl + Math.max(-0.5, Math.min(0.5, d))) * hop;
}
/** round onsets (s) of a signal: onset-strength peaks ≥ 35 ms apart above a third of the strongest */
function roundTimes(x) {
  const hop = 48; const { on } = onsetsOf(x, hop); let mx = 0; for (const v of on) mx = Math.max(mx, v);
  const t = []; let last = -1e9; for (let k = 1; k < on.length - 1; k++) if (on[k] > mx / 3 && on[k] >= on[k - 1] && on[k] >= on[k + 1] && k - last >= Math.round(0.035 * SR / hop)) { t.push(k * hop / SR); last = k; }
  return t;
}
/**
 * One seamless firing loop: a whole number of round periods, cut at a valley between rounds, the end sample-aligned by
 * waveform correlation, crossfaded over one period; then resampled (circularly) so the rounds come at `rate` per second.
 */
function organLoop(chs, rate) {
  const x = mono(chs); const P = roundPeriod(x); const measured = SR / P; const xf = Math.round(P);
  // anchor both cut points on detected rounds, at the same offset before each (a and b sit in the same place of a round),
  // then search the end rounds for the seam whose round spacing best matches the loop's own (and the best waveform match)
  const rt0 = roundTimes(x).map((t) => Math.round(t * SR)); const lead = Math.round(0.3 * P);
  const i0 = rt0.findIndex((t) => t > 0.25 * SR); const a = rt0[i0] - lead;
  const build1 = (b) => {
    const [y] = makeLoop([x], a, b, xf);
    const f = rate / measured; const L2 = Math.round(y.length / f); const z = new Float32Array(L2);
    for (let i = 0; i < L2; i++) { const u = i * y.length / L2; const k = Math.floor(u), fr = u - k; z[i] = y[k % y.length] * (1 - fr) + y[(k + 1) % y.length] * fr; }
    const two = new Float32Array(2 * L2); two.set(z); two.set(z, L2);
    const rt = roundTimes(two); const iois = []; for (let i = 1; i < rt.length; i++) iois.push(rt[i] - rt[i - 1]);
    const sorted = iois.slice().sort((p, q) => p - q); const med = sorted[sorted.length >> 1] || 0; const Ls = L2 / SR;
    let seamIoi = null; for (let i = 1; i < rt.length; i++) if (rt[i - 1] < Ls && rt[i] >= Ls) seamIoi = rt[i] - rt[i - 1];
    const pct = seamIoi == null ? null : sorted.filter((v) => v < seamIoi).length / sorted.length;
    const W = Math.round(0.05 * SR); let e0 = 0, e1 = 0; for (let i = 0; i < W; i++) { e0 += z[L2 - W + i] ** 2; e1 += z[i] ** 2; }
    const step = Math.abs(10 * Math.log10((e1 + 1e-12) / (e0 + 1e-12)));
    return { z, f, Ls, med, seamIoi, pct, n: rt.length, step };
  };
  let best = null;
  for (let j = rt0.length - 1; j > i0 + 20; j--) {
    const b = rt0[j] - lead; if (b + xf + Math.round(0.02 * SR) >= x.length) continue; if ((b - a) / SR < 2.4) break;
    const w = Math.round(0.02 * SR); let c = 0, u2 = 0, v2 = 0; for (let i = 0; i < w; i++) { const u = x[a + i], v = x[b + i]; c += u * v; u2 += u * u; v2 += v * v; } c /= Math.sqrt(u2 * v2 + 1e-12);
    const r = build1(b); if (r.seamIoi == null) continue;
    const score = Math.abs(r.seamIoi - r.med) / r.med - 0.2 * c + 0.12 * r.step; // round spacing, waveform match, level step
    if (!best || score < best.score) best = { score, b, c, r, rounds: j - i0 };
  }
  const { r, b, c } = best;
  // the loop is circular: rotate it so the file starts (and the codec's edges fall) at its quietest millisecond; the
  // crossfaded seam then sits inside the file, continuous by construction
  const z = r.z; const h1 = 48; let km = 0, ke = Infinity; for (let k = 0; k + h1 <= z.length; k += h1) { let e0 = 0; for (let i = k; i < k + h1; i++) e0 += z[i] * z[i]; if (e0 < ke) { ke = e0; km = k; } }
  const rot = new Float32Array(z.length); for (let i = 0; i < z.length; i++) rot[i] = z[(i + km) % z.length];
  return { y: [rot], info: { rotatedS: +(km / SR).toFixed(4), measuredRoundsPerS: +measured.toFixed(2), periodMs: +(P / SR * 1000).toFixed(2), rounds: best.rounds, cutA: +(a / SR).toFixed(4), cutB: +(b / SR).toFixed(4), waveCorr: +c.toFixed(3), xfadeMs: +(xf / SR * 1000).toFixed(1),
    resample: +r.f.toFixed(4), roundsPerS: rate, loopS: +r.Ls.toFixed(4), medianIoiMs: +(r.med * 1000).toFixed(1), seamIoiMs: +(r.seamIoi * 1000).toFixed(1), seamIoiPctile: +r.pct.toFixed(2), seamStepDb: +r.step.toFixed(2), roundsFound: r.n } };
}
/** loudness steadiness of a take: the spread (dB) of its 100 ms RMS levels (lower = an even stream of fire) */
function steadiness(chs) { const x = mono(chs); const w = Math.round(0.1 * SR); const L = []; for (let a = 0; a + w <= x.length; a += w) { let s0 = 0; for (let i = a; i < a + w; i++) s0 += x[i] * x[i]; L.push(10 * Math.log10(s0 / w + 1e-12)); } const m = L.reduce((p, q) => p + q, 0) / L.length; return Math.sqrt(L.reduce((p, q) => p + (q - m) ** 2, 0) / L.length); }

// ------------------------------------------------------------------------------------------------ the build
const analysis = [];
const manifest = { version: 1, generated: DATE, note: 'VALLEYWARD audio. Files are Opus in WebM, 48 kHz. Built by assets-src/audio/build.mjs; policy per id in src/audio/bank.js.', sounds: {} };
const prov = { tool: 'ElevenLabs (music_v2_5, eleven_text_to_sound_v2, text-to-speech eleven_multilingual_v2 with an original designed voice) via tools/elevenlabs.mjs; procedural DSP in Node; ffmpeg libopus. Processing: assets-src/audio/build.mjs', date: DATE, files: {} };
const prevManifest = fs.existsSync(path.join(OUT, 'manifest.json')) ? JSON.parse(fs.readFileSync(path.join(OUT, 'manifest.json'), 'utf8')) : null;
const prevProv = fs.existsSync(path.join(OUT, 'provenance.json')) ? JSON.parse(fs.readFileSync(path.join(OUT, 'provenance.json'), 'utf8')) : null;

/** music shipped mono (layers under the stereo music: the percussion of the later nights) */
const MONO_MUSIC = new Set(['mus_perc_a', 'mus_perc_b']);
/** per-id loudness overrides for loops whose pops would otherwise pin the level (LUFS target; the soft ceiling takes the pops) */
const LOUD = { fire_low: { lufs: -28 } };
/** loops that always get the end→start crossfade (the API's own loop seam measured a step) */
const FORCE_XFADE = new Set(['w_lance_loop']);
/** multi-sound takes not shipped (their parts came out truncated; single-sound takes replace them; the calls stay logged) */
const SKIP = new Set(['troll_step', 'gale_gust_b']); // gale_gust_b: 4 onsets (choppy), take A ships
/** per-take split options (gap: minimum spacing of onsets, max: longest part, s) */
const SPLIT_OPTS = {
  step_earth: { gap: 0.18, max: 0.4 }, step_stone: { gap: 0.18, max: 0.4 }, step_timber: { gap: 0.18, max: 0.45 },
  troll_step: { gap: 0.25, max: 1.2 }, gold: { gap: 0.15, max: 0.5 }, gob_death_a: { gap: 0.3, max: 0.9 }, gob_death_b: { gap: 0.3, max: 0.9 },
  gob_burn: { gap: 0.4, max: 1.4, minDur: 0.3 }, imp_chitter: { gap: 0.25, max: 0.8 }, hit_flesh: { gap: 0.2, max: 0.5 }, hit_wood: { gap: 0.2, max: 0.6 },
  claw: { gap: 0.25, max: 0.8 }, w_kestrel_shot: { gap: 0.8, max: 1.4 }, w_blunder_shot: { gap: 1.6, max: 2.4 }, bomb_burst: { gap: 1.6, max: 2.4 },
  gate_thud: { gap: 1.2, max: 1.6 }, p_hurt: { gap: 0.35, max: 0.9 }, troll_windup: { gap: 0.6, max: 2.0 }, troll_hit: { gap: 0.25, max: 0.9 },
  ignite_puff: { gap: 0.3, max: 1.0 }, spear_impact: { gap: 0.3, max: 1.0 }, pyre_pop: { gap: 0.45, max: 1.0 },
  // the DESIGN §9 set (jobs.mjs SFX2)
  coin_spill: { gap: 0.45, max: 1.2, minDur: 0.15 }, xp_collect: { gap: 0.3, max: 0.8 }, obelisk_pulse: { gap: 1.2, max: 2.4 },
  chain_throw: { gap: 0.4, max: 1.1 }, chain_hook: { gap: 0.6, max: 1.5 }, orbit_hit: { gap: 0.3, max: 0.9 },
  trail_crackle: { gap: 0.3, max: 0.9 }, douse_splash: { gap: 1.0, max: 2.2 },
  // the DESIGN §8 set (jobs.mjs SFX4)
  thunder: { gap: 2.5, max: 4.6, minDur: 1.0 }, ram_impact: { gap: 1.5, max: 2.6 }, rain_step: { gap: 1.5, max: 2.6 }, lantern_shatter: { gap: 0.6, max: 1.3 },
};
/** stingers cut dead at this time (s) of their take: a swell that stops (read off the 50 ms envelope; the peak is at 4.35 s) */
const STING_CUT = { mus_soon: 4.58 };
/** takes whose sounds rise too slowly for the onset split: cut by hand at these times (s; read off the 50 ms envelope) */
const CUTS = {
  chain_hook: [[0.0, 0.5], [1.12, 1.75], [2.2, 3.3]],
  chain_throw: [[0.12, 0.95], [1.4, 2.35]],
  trail_crackle: [[0.04, 0.7], [0.7, 1.38], [1.38, 2.1]],
};
/** the newest take of a job: <id>.wav|mp3, <id>__r2…, or the take named in PICK */
const PICK = JSON.parse(fs.existsSync(path.join(here, 'picks.json')) ? fs.readFileSync(path.join(here, 'picks.json'), 'utf8') : '{}');
function takeOf(job) {
  const dir = path.join(RAW, job.api); const ext = job.api === 'music' ? '.mp3' : '.wav';
  if (job.api === 'tts') return fs.existsSync(path.join(dir, job.id + ext)) ? path.join(dir, job.id + ext) : null;
  if (PICK[job.id]) return path.join(dir, PICK[job.id] + ext);
  let best = fs.existsSync(path.join(dir, job.id + ext)) ? path.join(dir, job.id + ext) : null;
  for (let n = 2; n < 20; n++) { const p = path.join(dir, `${job.id}__r${n}${ext}`); if (fs.existsSync(p)) best = p; }
  return best;
}
function receiptOf(file) { const r = file.replace(/\.(wav|mp3)$/, '.result.json'); return fs.existsSync(r) ? JSON.parse(fs.readFileSync(r, 'utf8')) : null; }

/** process one shipped file and register it */
function ship(id, k, chs, { cls, kind, source, loopInfo, grid }) {
  const def = SOUNDS[id]; if (!def) throw new Error(`no bank entry for ${id}`);
  const stereo = (cls === 'music' || cls === 'sting' || cls === 'bed') && !MONO_MUSIC.has(id);
  const isVoice = cls === 'voice';
  let x = stereo ? (chs.length === 2 ? chs : [chs[0], Float32Array.from(chs[0])]) : [mono(chs)];
  let gainDb = 0, clipped = 0;
  if (cls === 'sfx') { gainDb = -3 - db(peak(x)); scale(x, fromDb(gainDb)); }
  else {
    const target = cls === 'music' || cls === 'sting' || isVoice ? -18 : cls === 'bed' ? -20 : -18;
    const L = loudness(x); gainDb = target - L.I;
    const lo = LOUD[id];
    if (lo) gainDb = lo.lufs - L.I; // sparse crackle: louder, its rare pops go through the soft ceiling below
    else if (cls === 'loop' || cls === 'bed') gainDb = Math.min(gainDb, -1.5 - db(peak(x))); // a high crest factor: never clip it
    scale(x, fromDb(gainDb));
    if (peak(x) > fromDb(-1.2)) clipped = softClip(x);
  }
  const sub = cls === 'music' || cls === 'sting' ? 'music' : isVoice ? 'voice' : 'sfx';
  const name = `${sub}/${id}${k != null ? '_' + (k + 1) : ''}.webm`;
  // music 80 kb/s stereo (was 96; lowered to fit the ten nights' music in the 8 MB budget); the percussion layers mono 64
  const kbps = MONO_MUSIC.has(id) ? 64 : cls === 'music' || cls === 'sting' ? 80 : cls === 'bed' ? 64 : /shot|burst|blast/.test(id) ? 64 : 48;
  const file = path.join(OUT, name); encode(file, x, kbps);
  // verify the decoded file
  const dec = readPCM(file, x.length); const n = x[0].length;
  const dl = dec[0].length; let L2 = loudness(dec.map((c) => c.subarray(0, Math.min(c.length, n))));
  // SFX: Opus can lift a hard transient's true peak over the −3 dBFS sample peak; pull those back to −3 dBTP once
  if (cls === 'sfx' && L2.TP != null && L2.TP > -2) {
    const back = -3 - L2.TP; scale(x, fromDb(back)); gainDb += back; encode(file, x, kbps);
    const d2 = readPCM(file, x.length); L2 = loudness(d2.map((c) => c.subarray(0, Math.min(c.length, n))));
  }
  const sm = def.loop ? seam(dec.map((c) => c.subarray(0, n))) : null;
  const bytes = fs.statSync(file).size;
  const rec = { file: name, dur: +(n / SR).toFixed(4) };
  if (def.loop) { rec.loopStart = 0; rec.loopEnd = +(n / SR).toFixed(5); }
  if (grid) { rec.bpm = grid.bpm; rec.beat0 = grid.beat0; }
  const entry = manifest.sounds[id] || (manifest.sounds[id] = { files: [], loop: !!def.loop, gain: def.gain, bus: def.bus, variants: 0 });
  entry.files[k ?? 0] = rec; entry.variants = entry.files.filter(Boolean).length;
  const sha = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  prov.files[name] = { ...source, processed: DATE, script: 'assets-src/audio/build.mjs', bytes, sha256: sha };
  analysis.push({ id, k, file: name, cls, kind, dur: rec.dur, decodedDur: +(dl / SR).toFixed(4), bytes, kbps, gainDb: +gainDb.toFixed(2), softClipped: clipped,
    LUFS: L2.I, TP: L2.TP, seam: sm, loop: loopInfo || null });
}

function nextIndex(id) { return manifest.sounds[id] ? manifest.sounds[id].files.filter(Boolean).length : 0; }
/** a sound that becomes multi-variant keeps its file names numbered (x.webm → x_1.webm) */
function renameFirst(id) {
  const f = manifest.sounds[id]?.files?.[0]; if (!f || /_\d+\.webm$/.test(f.file)) return;
  const nn = f.file.replace(/\.webm$/, '_1.webm');
  fs.renameSync(path.join(OUT, f.file), path.join(OUT, nn));
  prov.files[nn] = prov.files[f.file]; delete prov.files[f.file];
  const a = analysis.find((r) => r.file === f.file); if (a) { a.file = nn; a.k = 0; }
  f.file = nn;
}
const VOICE = Object.entries({ ...CINDER.lines, ...CINDER4 }).map(([lid, text]) => ({ id: `vo_cinder_${lid}`, api: 'tts', cls: 'voice', out: `vo_cinder_${lid}`, text }));
const jobs = [...MUSIC, ...SFX, ...MUSIC2, ...SFX2, ...SFX3, ...MUSIC4, ...SFX4, ...SFX5, ...VOICE].filter((j) => !only || only.has(j.id) || only.has(j.out));
for (const job of jobs) {
  if (SKIP.has(job.id)) continue;
  if (GUN[job.out || job.id]) continue; // the guns are rebuilt as a set below
  if ((job.out || job.id) === 'organ_loop') continue; // the THUNDER ORGAN loop: below
  const file = takeOf(job);
  const rc = file ? receiptOf(file) : null;
  const source = file
    ? job.api === 'tts'
      ? { tool: `ElevenLabs text-to-speech (${CINDER.model}) via tools/elevenlabs.mjs, an original designed voice ("${CINDER.name}": voice design eleven_multilingual_ttv_v2 from a text description only; no real person, no sound-alike)`,
        endpoint: rc?.endpoint?.replace(/\?.*$/, '').replace(/text-to-speech\/[^/]+/, 'text-to-speech/{voice_id}') || null, voice_description: CINDER.design.voice_description, text: job.text,
        settings: CINDER.settings, take: path.basename(file), receipt: rel(file.replace(/\.(wav|mp3)$/, '.result.json')), processing: 'trim, warmth (low shelf +2.5 dB @ 220 Hz, high shelf −2 dB @ 7 kHz, 25 % tanh drive), small generated room (0.3 s, −14 dB wet), −18 LUFS', date: (rc?.date || DATE).slice(0, 10) }
      : { tool: `ElevenLabs ${job.api === 'music' ? 'music (music_v2_5)' : 'sound effects (eleven_text_to_sound_v2)'} via tools/elevenlabs.mjs`, endpoint: rc?.endpoint?.replace(/\?.*$/, '') || null,
      prompt: job.api === 'music' ? job.body.prompt : job.body.text, request: { ...job.body }, take: path.basename(file), receipt: rel(file.replace(/\.(wav|mp3)$/, '.result.json')), date: (rc?.date || DATE).slice(0, 10) }
    : { tool: 'procedural stand-in (generation missing)', script: 'assets-src/audio/build.mjs', prompt: `fallback for ${job.id}`, date: DATE };
  const chs = file ? readPCM(file, job.api === 'tts' ? 1 : 2) : fallback(job.id);
  const out = job.out || job.id;
  if (job.cls === 'voice') {
    if (!file) { console.warn(`[build] ${job.id}: no take, not shipped (the UI subtitle still shows)`); continue; }
    ship(out, null, voiceFx(trim(chs, 45, 0.03, 80)), { cls: 'voice', kind: 'voice', source });
  } else if (job.cls === 'music' && job.loop) {
    const perc = /^mus_perc_/.test(job.id); // the percussion layers repeat anyway: short loops (size)
    const lp = findMusicLoop(chs, { minL: job.id === 'mus_troll' ? 36 : perc ? 20 : 44, maxL: job.id === 'mus_troll' ? 72 : perc ? 32 : 86 });
    const N = Math.round(1.0 * SR);
    const y = makeLoop(chs, lp.a, lp.b, N);
    const grid = gridOf(y);
    ship(out, null, y, { cls: 'music', kind: 'music', source, grid, loopInfo: { a: +(lp.a / SR).toFixed(3), b: +(lp.b / SR).toFixed(3), L: +((lp.b - lp.a) / SR).toFixed(3), bpm: lp.bpm, bars: lp.bars, xfLevelDiffDb: lp.xfLevelDiffDb, envCorr: lp.envCorr, waveCorr: lp.waveCorr, xfade: 1.0, grid } });
  } else if (job.cls === 'sting') {
    // the coming-soon take (__r2) swells from silence to its loudest at 4.35 s, then decays: cut it dead just after the peak
    const cut = STING_CUT[job.id] && /__r2/.test(file || '') ? STING_CUT[job.id] : null;
    const src = cut ? slice(chs, 0, Math.round(cut * SR)) : chs;
    const y = trim(src, 60, 0.002, job.id === 'mus_dawn' || job.id === 'mus_end_hunt' ? 1500 : cut ? 50 : 600);
    ship(out, null, y, { cls: 'sting', kind: 'music', source: cut ? { ...source, processing: `cut dead at ${cut} s of the take (its swell peaks at 4.35 s, then decays), 50 ms fade; leading silence trimmed; −18 LUFS` } : source });
  } else if (job.cls === 'loop' || job.cls === 'bed') {
    const x = job.cls === 'bed' ? chs : [mono(chs)];
    const s0 = seam(x);
    let y = x, how = 'as generated (API loop)';
    if (FORCE_XFADE.has(job.id) || s0.ratio > 2.5 || Math.abs(s0.rmsStepDb) > 1.5) {
      const T = x[0].length; const N = Math.round(Math.min(0.6, T / SR / 6) * SR);
      y = makeLoop(x, 0, T - N, N); how = `end→start crossfade ${(N / SR).toFixed(2)} s (raw seam ratio ${s0.ratio}, step ${s0.rmsStepDb} dB)`;
    }
    ship(out, null, y, { cls: job.cls, kind: 'loop', source, loopInfo: { how, rawSeam: s0 } });
  } else if (job.split && CUTS[job.id]) {
    const base = nextIndex(out);
    CUTS[job.id].forEach(([a, b], i) => {
      const y = slice(chs, Math.round(a * SR), Math.min(chs[0].length, Math.round(b * SR))); fadeIn(y, Math.round(0.004 * SR)); fadeOut(y, Math.round(0.08 * SR));
      ship(out, base + i, trim(y, 50, 0.004, 60), { cls: 'sfx', kind: 'cut', source: { ...source, part: `${i + 1} of ${CUTS[job.id].length} (cut by hand at ${a}–${b} s)` } });
    });
  } else if (job.split) {
    const { outs, found } = split(chs, job.split, SPLIT_OPTS[job.id] || {});
    const base = nextIndex(out);
    outs.forEach((y, i) => ship(out, base + i, y, { cls: 'sfx', kind: 'split', source: { ...source, part: `${i + 1} of ${outs.length} (regions found: ${found})` } }));
    if (outs.length < job.split) console.warn(`[build] ${job.id}: wanted ${job.split} parts, found ${found}`);
  } else {
    const k = out !== job.id || manifest.sounds[out] ? nextIndex(out) : null;
    if (k) renameFirst(out);
    const y = trim(chs, 50, 0.004, out === 'gale_gust' ? 300 : 60);
    if (out === 'gale_gust') fadeIn(y, Math.round(0.4 * SR)); // the gust comes from the keep: a 400 ms swell-in, no edge
    ship(out, k, y, { cls: 'sfx', kind: 'single', source: out === 'gale_gust' ? { ...source, processing: 'trim, 400 ms fade-in, 300 ms fade-out, peak −3 dBFS (take B not shipped: 4 onsets)' } : source });
  }
}
// the guns: candidates = every take of the id (the first set's split parts + the GUN2 single-shot takes), shaped; keep those with one
// onset, attack ≤ 10 ms and the tail inside the length; of those, the `want` most alike (zero-crossing rate near the median)
for (const id of Object.keys(GUN)) {
  if (only && !only.has(id)) continue;
  const want = 1; // one sound per gun: one file per gun, no variants
  const cands = [];
  for (const job of [...SFX, ...GUN2].filter((j) => (j.out || j.id) === id)) {
    const file = takeOf(job); if (!file) continue; const rc = receiptOf(file);
    const chs = readPCM(file, 2);
    const parts = job.split ? split(chs, job.split, SPLIT_OPTS[job.id] || {}).outs : [chs];
    parts.forEach((pc, i) => {
      const y = gunShape(pc, id); const c = gunCheck(y);
      cands.push({ y, c, src: { tool: 'ElevenLabs sound effects (eleven_text_to_sound_v2) via tools/elevenlabs.mjs + a procedural punch', endpoint: rc?.endpoint || null, prompt: job.body.text, request: { ...job.body }, take: path.basename(file),
        receipt: rel(file.replace(/\.(wav|mp3)$/, '.result.json')), date: (rc?.date || DATE).slice(0, 10), ...(job.split ? { part: `${i + 1} of ${parts.length}` } : {}),
        processing: `gun set: main transient moved to 1 ms, decaying ceiling ${GUN[id].dbPerS} dB/s (no second bang, no sustained hiss), hard length ${GUN[id].len} s, + procedural punch (3 ms high-passed crack, ${GUN[id].f0}→${GUN[id].f1} Hz thump, τ ${GUN[id].tau * 1000} ms)` } });
    });
  }
  for (const q of cands) console.log(`[build]   ${id} candidate ${q.src.take}${q.src.part ? " " + q.src.part : ""} ${JSON.stringify(q.c)}`);
  const minTail = id === 'w_kestrel_shot' ? 0.35 : 0.6; // a body and a tail, not a click
  const ok = cands.filter((q) => q.c.onsets === 0 && q.c.attackMs <= 10 && q.c.tailS <= GUN[id].len && q.c.tailS >= minTail); // no onset after the attack
  const zs = ok.map((q) => q.c.zcr).sort((p, q) => p - q); const med = zs[zs.length >> 1] ?? 0;
  // prefer the GUN2 single-shot takes (one prompt: one gun), then the closest to the median brightness
  // the best-measured take (gunmeasure.mjs, 44.1 kHz): Kestrel take f (attack 0 ms, tail 0.56 s, no
  // onset after the attack); blunderbuss take c (attack 5 ms vs take d's 10 ms, tail 0.88 s, none after the attack)
  const GUN_PICK = { w_kestrel_shot: 'w_kestrel_shot_f.wav', w_blunder_shot: 'w_blunder_shot_c.wav' };
  const forced = ok.filter((q) => q.src.take === GUN_PICK[id]);
  const pick = forced.length ? forced.slice(0, 1) : ok.sort((p, q) => (/_[c-f]\.wav$/.test(p.src.take) && p.src.date && GUN2.some((j) => p.src.take.startsWith(j.id)) ? 0 : 1) - (GUN2.some((j) => q.src.take.startsWith(j.id)) ? 0 : 1) || Math.abs(p.c.zcr - med) - Math.abs(q.c.zcr - med)).slice(0, want);
  console.log(`[build] ${id}: ${cands.length} candidates, ${ok.length} pass (no onset after the attack, attack ≤ 10 ms, tail ≤ ${GUN[id].len} s); kept`, pick.map((q) => `${q.src.take}${q.src.part ? ' ' + q.src.part : ''} ${JSON.stringify(q.c)}`));
  for (const f of fs.readdirSync(path.join(OUT, 'sfx'))) if (f.startsWith(id + '_') || f === id + '.webm') fs.unlinkSync(path.join(OUT, 'sfx', f)); // the old set (this build's own outputs)
  if (manifest.sounds[id]) delete manifest.sounds[id];
  if (prevManifest?.sounds?.[id]) delete prevManifest.sounds[id];
  if (prevProv) for (const k of Object.keys(prevProv.files)) if (k.startsWith(`sfx/${id}_`)) delete prevProv.files[k];
  pick.forEach((q) => ship(id, null, q.y, { cls: 'sfx', kind: 'gun', source: q.src })); // sfx/<id>.webm (a new name too)
}
// the THUNDER ORGAN: the steadiest take, cut on whole round periods, rounds at 18/s (DESIGN §4.2)
if (!only || only.has('organ_loop')) {
  const takes = SFX3.filter((j) => (j.out || j.id) === 'organ_loop').map((j) => ({ j, file: takeOf(j) })).filter((t) => t.file);
  const scored = takes.map((t) => { const chs = readPCM(t.file, 2); return { ...t, chs, spread: steadiness(chs) }; }).sort((p, q) => p.spread - q.spread);
  for (const t of scored) console.log(`[build] organ_loop take ${path.basename(t.file)}: 100 ms level spread ${t.spread.toFixed(2)} dB`);
  const t = scored[0];
  if (t) {
    const rc = receiptOf(t.file); const { y, info } = organLoop(t.chs, 18);
    console.log('[build] organ_loop', JSON.stringify(info));
    ship('organ_loop', null, y, { cls: 'loop', kind: 'loop', loopInfo: { how: 'whole round periods, cut between rounds, 1-period crossfade, resampled to 18 rounds/s', ...info },
      source: { tool: 'ElevenLabs sound effects (eleven_text_to_sound_v2) via tools/elevenlabs.mjs', endpoint: rc?.endpoint || null, prompt: t.j.body.text, request: { ...t.j.body }, take: path.basename(t.file), receipt: rel(t.file.replace(/\.(wav|mp3)$/, '.result.json')), date: (rc?.date || DATE).slice(0, 10), wave: 3,
        processing: `the steadiest of ${scored.length} takes (100 ms level spread ${t.spread.toFixed(2)} dB); a loop of ${info.rounds} round periods (${info.periodMs} ms measured, ${info.measuredRoundsPerS}/s) cut between rounds at ${info.cutA}–${info.cutB} s, end aligned by waveform correlation (${info.waveCorr}), a ${info.xfadeMs} ms equal-power crossfade, resampled ×${info.resample} to 18 rounds/s; −18 LUFS` } });
  }
}
// the credits theme (DESIGN §12.8): the camp loop's own motif, slowed to 0.8× (−3.9 st), darkened (low-passed) and
// washed in a long generated reverb: "a slow sinister music-box version of the camp motif", from the camp music itself
if (!only || only.has('mus_end_credits')) {
  const camp = MUSIC2.find((j) => j.id === 'mus_camp'); const f = takeOf(camp);
  if (f) {
    const chs = readPCM(f, 2); const a0 = Math.round(13.05 * SR), len = Math.round(26 * SR); const r = 0.8; const n = Math.round(len / r);
    const out = chs.map((x) => { const y = new Float32Array(n + Math.round(4 * SR)); for (let i = 0; i < n; i++) { const u = a0 + i * r; const k = Math.floor(u), fr = u - k; y[i] = (x[k] || 0) * (1 - fr) + (x[k + 1] || 0) * fr; } onePoleLP(y, 3800); onePoleLP(y, 5200); return y; });
    // a long dark reverb: 4 decaying feedback combs per channel (≈ 3.5 s), mixed −9 dB under the dry
    for (const [ci, y] of out.entries()) {
      const dry = Float32Array.from(y); const wet = new Float32Array(y.length);
      for (const [ms, g] of [[41.1 + ci * 1.7, 0.84], [47.3 + ci * 2.3, 0.83], [53.9 - ci * 1.1, 0.82], [61.7 + ci * 0.9, 0.81]]) {
        const d = Math.round(ms / 1000 * SR); const buf = new Float32Array(y.length); let lp = 0;
        for (let i = 0; i < y.length; i++) { const fb = i >= d ? buf[i - d] : 0; lp += (fb - lp) * 0.45; buf[i] = dry[i] + g * lp; wet[i] += buf[i] * 0.25; }
      }
      for (let i = 0; i < y.length; i++) y[i] = dry[i] + wet[i] * fromDb(-9);
    }
    fadeIn(out, Math.round(1.2 * SR)); fadeOut(out, Math.round(5 * SR));
    ship('mus_end_credits', null, out, { cls: 'sting', kind: 'music', source: { tool: 'procedural from the shipped camp theme (ElevenLabs music_v2_5 take mus_camp.mp3)', take: path.basename(f), date: DATE,
      processing: '26 s of the camp loop from its loop start (13.05 s), resampled 0.8× (slower, −3.9 st), low-passed 3.8 / 5.2 kHz, 4-comb generated reverb ≈ 3.5 s at −9 dB, 1.2 s fade-in, 5 s fade-out; −18 LUFS' } });
  }
}
for (const [id, fn] of Object.entries(PROC)) {
  if (only && !only.has(id)) continue;
  ship(id, null, fn(), { cls: 'sfx', kind: 'procedural', source: { tool: 'procedural DSP (Node)', script: 'assets-src/audio/build.mjs', prompt: `procedural: ${SOUNDS[id].desc}`, date: DATE } });
}

// merge with a previous build when --only was used
if (only && prevManifest) { for (const [k, v] of Object.entries(prevManifest.sounds)) if (!manifest.sounds[k]) manifest.sounds[k] = v; }
if (only && prevProv) { for (const [k, v] of Object.entries(prevProv.files)) if (!prov.files[k]) prov.files[k] = v; }
// every file gets a short content hash: the engine loads `<file>?v=<h>`, so a rebuilt file under the same name is never
// served from a stale browser cache (the manifest itself is fetched no-cache)
for (const sd of Object.values(manifest.sounds)) for (const f of sd.files || []) if (f && fs.existsSync(path.join(OUT, f.file))) f.h = crypto.createHash('sha256').update(fs.readFileSync(path.join(OUT, f.file))).digest('hex').slice(0, 10);
// keys in bank order; gain/bus from the bank
const ordered = {}; for (const id of Object.keys(SOUNDS)) if (manifest.sounds[id]) ordered[id] = { ...manifest.sounds[id], gain: SOUNDS[id].gain, bus: SOUNDS[id].bus, loop: !!SOUNDS[id].loop };
manifest.sounds = ordered;
const missing = Object.keys(SOUNDS).filter((id) => !ordered[id]);
fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 1) + '\n');
const pOrdered = {}; for (const k of Object.keys(prov.files).sort()) pOrdered[k] = prov.files[k]; prov.files = pOrdered;
fs.writeFileSync(path.join(OUT, 'provenance.json'), JSON.stringify(prov, null, 1) + '\n');

// analysis
const anaDir = path.join(REPO, '.scratch/audio'); fs.mkdirSync(anaDir, { recursive: true });
let prevAna = []; try { prevAna = JSON.parse(fs.readFileSync(path.join(anaDir, 'analysis.json'), 'utf8')); } catch { /* */ }
const anaAll = only ? [...prevAna.filter((r) => !analysis.some((q) => q.file === r.file)), ...analysis] : analysis;
fs.writeFileSync(path.join(anaDir, 'analysis.json'), JSON.stringify(anaAll, null, 1));
const total = ['music', 'sfx', 'voice'].flatMap((d) => fs.readdirSync(path.join(OUT, d)).map((f) => path.join(OUT, d, f))).reduce((s, f) => s + fs.statSync(f).size, 0);
const lines = ['| file | cls | dur s | KB | kbps | LUFS | TP dBTP | seam ratio / RMS step dB | loop |', '|---|---|---|---|---|---|---|---|---|'];
for (const r of anaAll.sort((a, b) => a.file < b.file ? -1 : 1)) lines.push(`| ${r.file} | ${r.cls} | ${r.dur} | ${(r.bytes / 1024).toFixed(1)} | ${r.kbps} | ${r.LUFS} | ${r.TP} | ${r.seam ? r.seam.ratio + ' / ' + r.seam.rmsStepDb : ''} | ${r.loop ? JSON.stringify(r.loop) : ''} |`);
fs.writeFileSync(path.join(anaDir, 'analysis.md'), lines.join('\n') + `\n\nTotal shipped audio: ${(total / 1048576).toFixed(2)} MB\n`);
console.log(`[build] ${analysis.length} files built; total shipped ${(total / 1048576).toFixed(2)} MB; missing ids: ${missing.join(', ') || 'none'}`);
const big = anaAll.filter((r) => r.bytes > 2 * 1048576); if (big.length) console.warn('[build] files over 2 MB:', big.map((r) => r.file));
