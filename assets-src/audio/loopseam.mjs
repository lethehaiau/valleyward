#!/usr/bin/env node
// VALLEYWARD · audio · the seam of a rapid-fire loop (the THUNDER ORGAN), measured on the shipped file: the sample
// jump at the wrap over the mean sample step; the RMS step (50 ms each side) and its percentile among the steps at the
// SAME round phase inside the loop (a fair comparison: every round onset makes a step); the round spacing (IOI) across
// the seam vs the loop's own. Rounds = onset-strength peaks on 1 ms frames ≥ 35 ms apart (mechanical clatter counts too).
//   node assets-src/audio/loopseam.mjs <file.webm> <loopEnd s>
import { spawnSync } from 'node:child_process';
const [file, le] = process.argv.slice(2); const SR = 48000;
const r = spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-ac', '1', '-ar', String(SR), '-f', 'f32le', '-'], { maxBuffer: 1 << 28 });
const y = new Float32Array(r.stdout.buffer, r.stdout.byteOffset, r.stdout.byteLength / 4); const L = Math.round(Number(le) * SR);
const x = new Float32Array(3 * L); for (let k = 0; k < 3; k++) x.set(y.subarray(0, L), k * L);
const h = 48, n = Math.floor(x.length / h), e = new Float32Array(n); for (let k = 0; k < n; k++) { let s = 0; for (let i = k * h; i < (k + 1) * h; i++) s += x[i] * x[i]; e[k] = Math.sqrt(s / h); }
const on = new Float32Array(n); for (let k = 1; k < n; k++) on[k] = Math.max(0, Math.log(e[k] + 1e-5) - Math.log(e[k - 1] + 1e-5)); let mx = 0; for (const v of on) mx = Math.max(mx, v);
const rt = []; let last = -1e9; for (let k = 1; k < n - 1; k++) if (on[k] > mx / 3 && on[k] >= on[k - 1] && on[k] >= on[k + 1] && k - last >= 35) { rt.push(k * h); last = k; }
const rms = (a, b) => { let s = 0; for (let i = a; i < b; i++) s += x[i] * x[i]; return s / (b - a); }; const W = 2400;
const stepAt = (p) => Math.abs(10 * Math.log10(rms(p, p + W) / rms(p - W, p)));
const nxt = rt.find((t) => t >= L); const ph = nxt - L;
const steps = rt.filter((t) => t > L + W && t < 2 * L - W).map((t) => stepAt(t - ph)).sort((a, b) => a - b); const sAt = stepAt(L);
let d = 0; for (let i = 1; i < L; i++) d += Math.abs(x[i] - x[i - 1]); d /= L;
const iois = []; for (let i = 1; i < rt.length; i++) iois.push(rt[i] - rt[i - 1]); const so = [...iois].sort((a, b) => a - b); const med = so[so.length >> 1];
let si = null; for (let i = 1; i < rt.length; i++) if (rt[i - 1] < L && rt[i] >= L) si = rt[i] - rt[i - 1];
console.log(JSON.stringify({ loopS: +(L / SR).toFixed(4), sampleJumpRatio: +(Math.abs(x[L] - x[L - 1]) / d).toFixed(2), seamStepDb: +sAt.toFixed(2),
  samePhaseSteps: { n: steps.length, median: +steps[steps.length >> 1].toFixed(2), max: +steps[steps.length - 1].toFixed(2) }, seamStepPctile: +(steps.filter((v) => v < sAt).length / steps.length).toFixed(2),
  medianIoiMs: +(med / SR * 1000).toFixed(1), seamIoiMs: si && +(si / SR * 1000).toFixed(1), seamIoiPctile: +(so.filter((v) => v < si).length / so.length).toFixed(2) }));
