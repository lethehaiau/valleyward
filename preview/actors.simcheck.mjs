#!/usr/bin/env node
// VALLEYWARD · actors contract check (Node, no GPU): the real sim + self-play bot drive src/actors/crowd.js for a
// night; checks every submitted instance (finite numbers, valid frame indices), death pops, the troll's poses, the
// retry guard (no corpse flood) and the CPU cost of crowd.update. Run: node preview/actors.simcheck.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { createSim } from '../src/sim/sim.js';
import { createBot } from '../src/bot/bot.js';
import { createCrowd } from '../src/actors/crowd.js';
import { frameTable } from '../src/actors/atlas.js';
import * as webgl2 from '../src/gfx/webgl2/index.js';
import { setGfx } from '../src/gfx/current.js';

setGfx(webgl2);   // the crowd's sprite material comes from the active shading layer (decision 0001)

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const json = JSON.parse(fs.readFileSync(path.join(APP, 'public/assets/sprites/actors.json'), 'utf8'));
const atlas = { json, texture: new THREE.Texture(), frameTex: frameTable(json) };
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(78, 16 / 9, 0.1, 400);
const crowd = createCrowd({ atlas, scene, camera, cap: 2500 });
const seed = Number(process.argv[2] || 3);
const sim = createSim({ seed, god: true });
sim.startNight();
const drive = createBot({ seed });
const nF = json.frames.length;
const P = crowd.mesh.geometry.attributes.iPos.array, A = crowd.mesh.geometry.attributes.iA.array, B = crowd.mesh.geometry.attributes.iB.array;
const trollFrames = new Set(), kindsSeen = new Set();
let bad = 0, maxInst = 0, maxCorpses = 0, deaths = 0, retryCorpses = -1, maxAlive = 0, burnInst = 0;
const ms = [];
const T = 60 * 260;
for (let tick = 0; tick < T; tick++) {
  if (tick === 60 * 70) sim.troll();
  if (tick === 60 * 230) sim.retry();
  sim.step(drive(sim.state));
  const st = sim.state;
  for (const ev of sim.drainEvents()) { if (ev.type === 'enemy.death') deaths++; crowd.onEvent(ev, st); }
  const p = st.player;
  camera.position.set(p.x, p.y + 1.68, p.z); camera.rotation.set(p.pitch || 0, (p.yaw || 0) + Math.PI, 0, 'YXZ');
  const t0 = performance.now();
  const n = crowd.update(1 / 60, st);
  ms.push(performance.now() - t0);
  maxInst = Math.max(maxInst, n); maxCorpses = Math.max(maxCorpses, crowd.corpses); maxAlive = Math.max(maxAlive, st.horde.alive ?? 0);
  if (tick === 60 * 230 + 1) retryCorpses = crowd.corpses;
  for (let i = 0; i < n; i++) {
    const f = A[i * 4];
    if (!(f >= 0 && f < nF && Number.isInteger(f)) || !Number.isFinite(P[i * 4]) || !Number.isFinite(P[i * 4 + 1]) || !Number.isFinite(P[i * 4 + 2]) || !Number.isFinite(B[i * 4])) bad++;
    const name = json.frames[f]?.n || '?';
    if (name.startsWith('troll.')) trollFrames.add(name.replace(/\.\d+(\.glow)?$/, '$1'));
    else kindsSeen.add(name.split('.').slice(0, 2).join('.'));
    if (A[i * 4 + 1] > 0) burnInst++;
  }
}
ms.sort((a, b) => a - b);
const out = {
  seed, ticks: T, maxInstances: maxInst, maxAliveReported: maxAlive, deathsEvents: deaths, maxCorpses, corpsesRightAfterRetry: retryCorpses,
  badInstances: bad, burningInstanceFrames: burnInst, trollPoses: [...trollFrames].sort(), spriteKindsAnims: [...kindsSeen].sort(),
  updateMs: { avg: +(ms.reduce((a, b) => a + b, 0) / ms.length).toFixed(3), p95: +ms[Math.floor(ms.length * 0.95)].toFixed(3), max: +ms[ms.length - 1].toFixed(3) },
};
// cache contract (a stale cached atlas once drew a goblin cut between two sprites): no loader may force-cache, and the table's content hashes
// must match the shipped files (a stale table can then never be paired with a re-packed image)
const { createHash } = await import('node:crypto');
const sha = (f) => createHash('sha1').update(fs.readFileSync(f)).digest('hex').slice(0, 10);
const forceCache = ['src/actors/atlas.js', 'src/actors/viewmodel.js', 'src/actors/index.js']
  .filter((f) => /cache\s*:\s*['"]force-cache/.test(fs.readFileSync(path.join(APP, f), 'utf8')));
const hashOk = json.hash === sha(path.join(APP, 'public/assets/sprites', json.image))
  && (!json.fallback || json.fallback.hash === sha(path.join(APP, 'public/assets/sprites', json.fallback.image)));
// the WebP atlas and its PNG fallback must decode to the very same RGBA bytes (alpha-0 texels included)
let pixelsIdentical = null;
if (json.fallback) {
  const sharp = (await import('sharp')).default;
  const dec = (f) => sharp(path.join(APP, 'public/assets/sprites', f)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const [a, b] = await Promise.all([dec(json.image), dec(json.fallback.image)]);
  pixelsIdentical = a.info.width === json.width && a.info.height === json.height && a.data.length === b.data.length && a.data.equals(b.data);
}
const vmBad = Object.entries(json.vm || {}).filter(([n, h]) => h !== sha(path.join(APP, `public/assets/models/viewmodel/${n}.png`))).map(([n]) => n);
out.cache = { forceCache, hashOk, image: json.image, fallback: json.fallback?.image ?? null, pixelsIdentical, vmHashes: Object.keys(json.vm || {}).length, vmBad };
console.log(JSON.stringify(out, null, 1));
const ok = bad === 0 && retryCorpses >= 0 && retryCorpses < 40 && trollFrames.size >= 2
  && forceCache.length === 0 && hashOk && pixelsIdentical !== false && vmBad.length === 0 && Object.keys(json.vm || {}).length === 6;
console.log(ok ? 'PASS' : 'FAIL');
process.exit(ok ? 0 : 1);
