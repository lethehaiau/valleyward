// Decision 0001: the fire host's registry and world, and the edition choice (pure JS; the GPU parts run in e2e stage 9).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { checkInfo, API_VERSION } from 'firewraith/api';
import { info as classicInfo } from 'firewraith/modules/classic/info';
import { info as classicGpuInfo } from 'firewraith/modules/classic-webgpu/info';
import { REGISTRY, fallbackFor, pickedModules, isDevUrl, isLoadable } from '../src/fire/registry.js';
import { MODULES } from 'firewraith/modules';
import { makeWorld } from '../src/fire/world.js';
import { pickEdition } from '../src/gfx/index.js';
import { ARENA, groundHeight } from '../src/shared/arena.js';
import { FIRE_OP } from '../src/shared/fireops.js';

const Q = (s) => new URLSearchParams(s);

test('the registry lists every module in Firewraith\'s catalog, with its info', () => {
  assert.deepEqual(Object.keys(REGISTRY).sort(), Object.keys(MODULES).sort());
  for (const [id, m] of Object.entries(MODULES)) {
    assert.equal(REGISTRY[id].backend, m.info.backend, id);
    assert.deepEqual([...REGISTRY[id].slots], [...m.info.slots], id);
    assert.equal(REGISTRY[id].load, m.load, id);
  }
});

test('the registry lists classic and classic-webgpu as Firewraith says they are', () => {
  assert.equal(API_VERSION, 1);
  for (const [id, info] of [['classic', classicInfo], ['classic-webgpu', classicGpuInfo]]) {
    assert.deepEqual(checkInfo(info), [], id);
    assert.equal(info.id, id);
    assert.equal(REGISTRY[id].backend, info.backend, id);
    assert.deepEqual([...REGISTRY[id].slots], [...info.slots], id);
  }
  assert.equal(classicGpuInfo.backend, 'webgpu');
  assert.equal(fallbackFor('webgl2'), 'classic');
  assert.equal(fallbackFor('webgpu'), 'classic-webgpu');
});

test('modules are picked per slot from the URL, with the edition default', () => {
  assert.deepEqual(pickedModules(Q('')), { lance: 'classic', ground: 'classic' });
  assert.deepEqual(pickedModules(Q(''), 'webgpu'), { lance: 'classic-webgpu', ground: 'classic-webgpu' });
  assert.deepEqual(pickedModules(Q('?ground=classic'), 'webgpu'), { lance: 'classic-webgpu', ground: 'classic' });
  assert.deepEqual(pickedModules(Q('?lance=mine')), { lance: 'mine', ground: 'classic' });
  assert.deepEqual(pickedModules(Q('?firemod=x&ground=y')), { lance: 'x', ground: 'y' });
});

test('only listed ids and localhost URLs load', () => {
  assert.ok(isDevUrl('http://localhost:5173/src/index.js'));
  assert.ok(isDevUrl('http://127.0.0.1:8080/m.js'));
  assert.ok(!isDevUrl('https://example.com/m.js'));
  assert.ok(!isDevUrl('http://localhost.evil.com/m.js'));
  assert.ok(isLoadable('classic') && isLoadable('classic-webgpu') && !isLoadable('toString') && !isLoadable('nope'));
});

test('the edition: ?gpu= wins, then the modules\' backend, else webgl2; no WebGPU → webgl2', () => {
  assert.equal(pickEdition(Q(''), { hasWebGPU: true }).edition, 'webgl2');
  assert.equal(pickEdition(Q('?gpu=webgpu'), { hasWebGPU: true }).edition, 'webgpu');
  const down = pickEdition(Q('?gpu=webgpu'), { hasWebGPU: false });
  assert.equal(down.edition, 'webgl2'); assert.ok(down.downgraded);
  assert.equal(pickEdition(Q('?gpu=webgl2&ground=classic'), { hasWebGPU: true }).edition, 'webgl2');
  assert.equal(pickEdition(Q('?gpu=vulkan'), { hasWebGPU: true }).edition, 'webgl2');
  assert.equal(pickEdition(Q('?firemod=classic-webgpu'), { hasWebGPU: true }).edition, 'webgpu');
  assert.equal(pickEdition(Q('?ground=classic-webgpu'), { hasWebGPU: false }).edition, 'webgl2');
});

test('the world handed to modules matches the arena', () => {
  const w = makeWorld();
  assert.deepEqual({ ...w.area }, { x0: ARENA.fluid.x0, z0: ARENA.fluid.z0, size: ARENA.fluid.size });
  assert.equal(w.walls.length, 1 + ARENA.keep.towers.length);
  for (const b of w.walls) assert.ok(b[0] < b[2] && b[1] < b[3], `wall box ${b}`);
  for (const [x, z] of [[0, 5], [10, 30], [-20, 60]]) assert.equal(w.groundHeight(x, z), groundHeight(x, z));
  assert.match(w.groundGLSL, /float ewGround\(vec2/);
  assert.deepEqual({ ...w.lance }, { speed: 16, gravity: 14 });
  assert.ok(w.light.gain > 0 && w.light.height > 0);
});

test('the game\'s fire events are Firewraith\'s', async () => {
  const api = await import('firewraith/api');
  assert.equal(FIRE_OP, api.FIRE_OP);
});

test('no game file imports the fire module code directly (only the host, through the registry)', () => {
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(`${d}/${e.name}`) : e.name.endsWith('.js') ? [`${d}/${e.name}`] : []));
  for (const f of walk('src')) {
    const s = fs.readFileSync(f, 'utf8');
    if (f === 'src/fire/registry.js') continue;
    assert.doesNotMatch(s, /(^\s*import [^;]*|import\()['"]firewraith\/modules\//m, `${f} imports a fire module`);
    assert.doesNotMatch(s, /from '\.\.?\/(\.\.\/)*fluid\//, `${f} imports the old src/fluid`);
  }
  assert.ok(!fs.existsSync('src/fluid'), 'src/fluid is gone (it is Firewraith\'s classic module)');
});
