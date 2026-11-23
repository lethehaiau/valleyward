// Decision 0001: the fire host's registry and world, and the edition choice (pure JS; the GPU parts run in e2e stage 9).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { checkInfo, API_VERSION } from 'firewraith/api';
import { info as classicInfo } from 'firewraith/modules/classic/info';
import { info as classicGpuInfo } from 'firewraith/modules/classic-webgpu/info';
import {
  REGISTRY, SETUPS, SLOTS, fallbackFor, pickedModules, isDevUrl, isLoadable, rendererQuery, requestedModules, setupFor,
  setupOf, setupOptions, setupQuery, slotOptions, slotQuery,
} from '../src/core/fire-registry.js';
import { MODULES } from 'firewraith/modules';
import { SETUPS as FIREWRAITH_SETUPS } from 'firewraith/setups';
import { checkSetup } from 'firewraith/api';
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

test('?firemod= is a whole setup: the module in its own slots, the edition\'s reference module in the others', () => {
  assert.deepEqual(pickedModules(Q('?firemod=lance-curved-volume')), { lance: 'lance-curved-volume', ground: 'classic' });
  assert.deepEqual(pickedModules(Q('?firemod=lance-curved-volume&ground=classic')), { lance: 'lance-curved-volume', ground: 'classic' });
  assert.deepEqual(pickedModules(Q('?firemod=lance-curved-volume&lance=classic')), { lance: 'classic', ground: 'classic' });
  assert.deepEqual(pickedModules(Q('?firemod=classic-webgpu'), 'webgpu'), { lance: 'classic-webgpu', ground: 'classic-webgpu' });
  // a dev URL's slots are unknown before it loads: it is asked for both
  assert.deepEqual(pickedModules(Q('?firemod=http://localhost:5173/m.js')),
    { lance: 'http://localhost:5173/m.js', ground: 'http://localhost:5173/m.js' });
  assert.equal(pickEdition(Q('?firemod=lance-curved-volume'), { hasWebGPU: true }).edition, 'webgl2');
});

test('the Fire module choices: one setup per listed module of the edition, its reference module first', () => {
  for (const edition of ['webgl2', 'webgpu']) {
    const setups = setupOptions(edition);
    const ids = Object.keys(MODULES).filter((id) => MODULES[id].info.backend === edition);
    assert.deepEqual(setups.map(({ id }) => id).sort(), ids.sort(), edition);
    assert.equal(setups[0].id, fallbackFor(edition), edition);
    for (const { id, name, picks } of setups) {
      const named = SETUPS[id]?.backend === edition ? SETUPS[id] : null;
      assert.equal(name, named ? named.name : MODULES[id].info.name, id);
      for (const slot of SLOTS) {
        const want = named ? named.slots[slot] : MODULES[id].info.slots.includes(slot) ? id : fallbackFor(edition);
        assert.equal(picks[slot], want, `${id} ${slot}`);
      }
      assert.equal(setupFor(picks, edition), id, id);
      assert.deepEqual(pickedModules(setupQuery(Q(''), id), edition), picks, id);
    }
  }
  assert.deepEqual(setupOf('lance-curved-volume', 'webgl2'), { lance: 'lance-curved-volume', ground: 'classic' });
  assert.deepEqual(setupOptions('webgl2').map(({ id }) => id), ['classic', 'lance-curved-volume']);
  assert.equal(setupFor({ lance: 'classic', ground: 'lance-curved-volume' }, 'webgl2'), '');
  assert.equal(setupFor({ lance: 'http://localhost:5173/m.js', ground: 'classic' }, 'webgl2'), '');
});

test('the advanced slot choices list the edition\'s modules that fill each slot', () => {
  assert.deepEqual(slotOptions('webgl2', 'lance').map(({ id }) => id), ['classic', 'lance-curved-volume']);
  assert.deepEqual(slotOptions('webgl2', 'ground').map(({ id }) => id), ['classic']);
  assert.deepEqual(slotOptions('webgpu', 'lance').map(({ id }) => id), ['classic-webgpu']);
  for (const edition of ['webgl2', 'webgpu']) {
    for (const slot of SLOTS) {
      for (const { id, name } of slotOptions(edition, slot)) {
        assert.equal(REGISTRY[id].backend, edition); assert.ok(REGISTRY[id].slots.includes(slot)); assert.equal(name, REGISTRY[id].name);
      }
    }
  }
});

test('menu reloads keep other settings: a setup drops the per-slot picks, a slot pick keeps the setup', () => {
  const start = Q('?gpu=webgl2&lance=classic&ground=classic&seed=4&fire=smooth');
  const setup = setupQuery(start, 'lance-curved-volume');
  assert.equal(setup.toString(), 'gpu=webgl2&seed=4&fire=smooth&firemod=lance-curved-volume');
  assert.deepEqual(pickedModules(setup), { lance: 'lance-curved-volume', ground: 'classic' });
  const slot = slotQuery(setup, 'lance', 'classic');
  assert.equal(slot.get('firemod'), 'lance-curved-volume');
  assert.deepEqual(pickedModules(slot), { lance: 'classic', ground: 'classic' });
  assert.equal(start.toString(), 'gpu=webgl2&lance=classic&ground=classic&seed=4&fire=smooth');
});

test('a renderer switch keeps a setup\'s modules only where they run', () => {
  const gl = rendererQuery(Q('?firemod=lance-curved-volume'), 'webgl2');
  assert.equal(gl.get('lance'), 'lance-curved-volume');
  assert.equal(gl.get('ground'), 'classic');
  assert.ok(!gl.has('firemod'));
  const gpu = rendererQuery(Q('?firemod=lance-curved-volume'), 'webgpu');
  assert.ok(!gpu.has('lance') && !gpu.has('ground') && !gpu.has('firemod'));
});

test('Firewraith\'s setups are read as they are, each checked against the catalog', () => {
  assert.deepEqual(Object.keys(SETUPS), Object.keys(FIREWRAITH_SETUPS));
  for (const [id, setup] of Object.entries(SETUPS)) assert.deepEqual(checkSetup(id, setup, MODULES), [], id);
  assert.deepEqual({ ...SETUPS['lance-curved-volume'].slots }, { lance: 'lance-curved-volume', ground: 'classic' });
});

test('a setup that is not a module joins the choices, and ?firemod= plays its picks', () => {
  const setups = { ...SETUPS,
    storm: { name: 'Storm', backend: 'webgl2', slots: { lance: 'lance-curved-volume', ground: 'classic' } },
    'classic-mix': { name: 'Classic mix', backend: 'webgpu', slots: { lance: 'classic-webgpu', ground: 'classic-webgpu' } },
    classic: { name: 'Classic + Curved', backend: 'webgl2', slots: { lance: 'lance-curved-volume', ground: 'classic' } },
  };
  const gl = setupOptions('webgl2', setups);
  assert.deepEqual(gl.map(({ id }) => id), ['classic', 'lance-curved-volume', 'storm']);
  assert.deepEqual(gl[0], { id: 'classic', name: 'Classic + Curved', picks: { lance: 'lance-curved-volume', ground: 'classic' } });
  assert.deepEqual(setupOptions('webgpu', setups).map(({ id }) => id), ['classic-webgpu', 'classic-mix']);
  assert.deepEqual(requestedModules(Q('?firemod=storm'), setups), { lance: 'lance-curved-volume', ground: 'classic' });
  assert.deepEqual(requestedModules(Q('?firemod=storm&ground=x'), setups), { lance: 'lance-curved-volume', ground: 'x' });
  assert.deepEqual(setupOf('storm', 'webgl2', setups), { lance: 'lance-curved-volume', ground: 'classic' });
  assert.equal(setupFor({ lance: 'classic-webgpu', ground: 'classic-webgpu' }, 'webgpu', '', setups), 'classic-webgpu');
  // two setups with the same picks: the one asked for is the one shown
  const same = { lance: 'lance-curved-volume', ground: 'classic' };
  assert.equal(setupFor(same, 'webgl2', '', setups), 'classic');
  assert.equal(setupFor(same, 'webgl2', 'storm', setups), 'storm');
  assert.equal(setupFor(same, 'webgl2', 'classic-webgpu', setups), 'classic');
});

test('only listed ids and localhost URLs load', () => {
  assert.ok(isDevUrl('http://localhost:5173/src/index.js'));
  assert.ok(isDevUrl('http://127.0.0.1:8080/m.js'));
  assert.ok(!isDevUrl('https://example.com/m.js'));
  assert.ok(!isDevUrl('http://localhost.evil.com/m.js'));
  assert.ok(isLoadable('classic') && isLoadable('classic-webgpu') && !isLoadable('toString') && !isLoadable('nope'));
});

test('renderer changes preserve unrelated settings and drop incompatible module requests', () => {
  const original = Q('?gpu=webgl2&firemod=classic&lance=http://127.0.0.1/lance.js&seed=14&fire=smooth');
  const next = rendererQuery(original, 'webgpu');
  assert.equal(next.get('gpu'), 'webgpu');
  assert.equal(next.get('seed'), '14');
  assert.equal(next.get('fire'), 'smooth');
  assert.ok(!next.has('firemod') && !next.has('ground') && !next.has('lance'));
  assert.deepEqual(pickedModules(next, 'webgpu'), { lance: 'classic-webgpu', ground: 'classic-webgpu' });
  assert.equal(original.get('gpu'), 'webgl2');
});

test('renderer changes retain explicitly compatible module picks per slot', () => {
  const next = rendererQuery(Q('?firemod=classic-webgpu&lance=classic'), 'webgpu');
  assert.equal(next.get('ground'), 'classic-webgpu');
  assert.ok(!next.has('lance') && !next.has('firemod'));
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
    if (f === 'src/core/fire-registry.js') continue;
    assert.doesNotMatch(s, /(^\s*import [^;]*|import\()['"]firewraith\/modules\//m, `${f} imports a fire module`);
    assert.doesNotMatch(s, /from '\.\.?\/(\.\.\/)*fluid\//, `${f} imports the old src/fluid`);
  }
  assert.ok(!fs.existsSync('src/fluid'), 'src/fluid is gone (it is Firewraith\'s classic module)');
});
