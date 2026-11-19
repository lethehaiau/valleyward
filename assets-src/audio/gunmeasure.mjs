#!/usr/bin/env node
// VALLEYWARD · audio · measure gun shots with the shot-shape check (decoded mono 44.1 kHz, 5 ms RMS
// frames: attack = time of the loudest frame, tail = last frame above peak − 40 dB, onsets = a rise of > 12 dB within
// 20 ms from a local minimum, within 24 dB of the peak, > 150 ms apart; plus `startsOnAttack`: the first frame is already
// within 12 dB of the peak, i.e. the shot is ON the trigger) and draw a waveform sheet (one row per file, 2 s wide).
//   node assets-src/audio/gunmeasure.mjs <out.png> <file.webm> [file …]
import fs from 'node:fs';
import zlib from 'node:zlib';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
let FFMPEG = 'ffmpeg';
try { FFMPEG = (await import(path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../tools/platform.mjs'))).FFMPEG || 'ffmpeg'; } catch { /* PATH */ }
const [png, ...files] = process.argv.slice(2);
const SR = 44100;
export function measure(file) {
  const r = spawnSync(FFMPEG, ['-v', 'error', '-i', file, '-ac', '1', '-ar', String(SR), '-f', 'f32le', '-'], { maxBuffer: 1 << 28 });
  const x = new Float32Array(r.stdout.buffer, r.stdout.byteOffset, r.stdout.byteLength / 4);
  const hop = Math.round(0.005 * SR); const db = [];
  for (let i = 0; i + hop < x.length; i += hop) { let s = 0; for (let j = i; j < i + hop; j++) s += x[j] * x[j]; db.push(20 * Math.log10(Math.sqrt(s / hop) + 1e-9)); }
  const pk = Math.max(...db); const ipk = db.indexOf(pk);
  const ons = []; let last = -1;
  for (let i = 4; i < db.length; i++) if (db[i] > pk - 24 && db[i] - Math.min(...db.slice(i - 4, i)) > 12 && (last < 0 || i - last > 30)) { ons.push(+(i * 0.005).toFixed(3)); last = i; }
  let tail = 0; for (let i = db.length - 1; i >= 0; i--) if (db[i] > pk - 40) { tail = i * 0.005; break; }
  let sp = 0; for (const v of x) sp = Math.max(sp, Math.abs(v));
  return { file: path.basename(file), dur: +(x.length / SR).toFixed(3), peakDbfs: +(20 * Math.log10(sp)).toFixed(1), attackMs: Math.round(ipk * 5), tailS: +tail.toFixed(3), onsets: ons, startsOnAttack: db[0] > pk - 12, x };
}
function sheet(out, rows) {
  const W = 1400, RH = 150, H = RH * rows.length; const img = Buffer.alloc(H * (W * 3 + 1));
  const set = (px, py, c) => { const o = py * (W * 3 + 1) + 1 + px * 3; img[o] = c[0]; img[o + 1] = c[1]; img[o + 2] = c[2]; };
  for (let y = 0; y < H; y++) for (let xx = 0; xx < W; xx++) set(xx, y, y % RH === 0 ? [44, 54, 62] : [13, 19, 23]);
  rows.forEach((m, k) => {
    const x = m.x; const per = (2 * SR) / W; const mid = k * RH + RH / 2; let sp = 0; for (const v of x) sp = Math.max(sp, Math.abs(v)); sp = sp || 1;
    for (let c = 0; c < W; c++) {
      const a = Math.floor(c * per), b = Math.min(x.length, Math.floor((c + 1) * per)); if (a >= x.length) break;
      let lo = 0, hi = 0; for (let i = a; i < b; i++) { lo = Math.min(lo, x[i]); hi = Math.max(hi, x[i]); }
      const y0 = Math.round(mid - hi / sp * (RH * 0.45)), y1 = Math.round(mid - lo / sp * (RH * 0.45));
      for (let y = y0; y <= y1; y++) set(c, y, [64, 190, 255]);
    }
    for (let y = k * RH + 1; y < (k + 1) * RH; y += 3) { set(Math.round(0.7 * W / 2), y, [120, 120, 60]); set(Math.round(1.2 * W / 2), y, [150, 80, 60]); } // 0.7 s and 1.2 s marks
  });
  const crc = (buf) => { let c = ~0; for (const b of buf) { c ^= b; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return ~c >>> 0; };
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ih = Buffer.alloc(13); ih.writeUInt32BE(W, 0); ih.writeUInt32BE(H, 4); ih[8] = 8; ih[9] = 2;
  fs.writeFileSync(out, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', zlib.deflateSync(img)), chunk('IEND', Buffer.alloc(0))]));
}
if (png && files.length) {
  const rows = files.map(measure);
  for (const m of rows) console.log(`${m.file.padEnd(24)} dur ${m.dur.toFixed(2)}s peak ${m.peakDbfs} dBFS attack ${String(m.attackMs).padStart(4)} ms tail(-40dB) ${m.tailS.toFixed(2)}s onsets [${m.onsets.join(', ')}] startsOnAttack ${m.startsOnAttack}`);
  sheet(png, rows); console.log('sheet', png);
}
