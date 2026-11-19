// Environment bench (preview/env.html): the environment + the look alone, with the mockups' camera framings, a fake fire-light
// map, a stub fluid pass (so the look's fluid path runs), a dawn slider, gate damage and event buttons, and a stats
// readout. Dev: `npx vite --config vite.config.js --port 5354 --strictPort` then /preview/env.html?view=m1.
// Production numbers: `npx vite build --config preview/env.vite.config.js` + `npx vite preview --config preview/env.vite.config.js`.
// URL: view=m1|m2|top|gate|free  quality=high|medium|low  fire=1  stub=0  dawn=0..1  gate=0..1  hud=0  tone=agx
// DESIGN §9: camp=1 (state.mode 'camp': dusk)  night=2 (state.night.n)  near=<pad index>  built=0,3 (towers on pads)
//          hue=violet|blue|green|lilac (the fake fire light's hue)  flare=0..1 + vt=<s> (hold the kindle flare + vision)
//          views camp_w, camp_e, stall, campwalk, shadow, banners, glance
// DESIGN §8: night=1..10, rain=0..1, storm=1, world=, portal=, lamp=, gateopen=, village= (0..1 each, the setters),
//          ending=1&et=<s> (state.mode 'ending' with the ending clock held at et), views village, villagenear, portal, slope
import * as THREE from 'three';
import { ARENA, BODY } from '../src/shared/arena.js';
import { EV } from '../src/shared/events.js';
import { FIRELIGHT } from '../src/shared/firelight.js';
import { createEnvironment, NIGHT } from '../src/env/index.js';
import { createLook } from '../src/look/index.js';
import { setGfx } from '../src/gfx/current.js';
import * as webgl2 from '../src/gfx/webgl2/index.js';

// the modules' per-edition shading (decision 0001): this bench runs the webgl2 edition's layer
setGfx(webgl2);

const P = new URLSearchParams(location.search);
const quality = /** @type {'high'|'medium'|'low'} */ (P.get('quality') || 'high');
const host = document.getElementById('world');
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, Number(P.get('dpr')) || 1));
renderer.setSize(innerWidth, innerHeight);
host.appendChild(renderer.domElement);
renderer.info.autoReset = false;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(78, innerWidth / innerHeight, 0.05, 900);
camera.rotation.order = 'YXZ';

const VIEWS = {
  m1: { x: ARENA.playerSpawn.x, y: BODY.player.eye, z: ARENA.playerSpawn.z, yaw: ARENA.playerSpawn.yaw, pitch: 0.02 },
  m2: { x: -0.875, y: ARENA.keep.walk.y + BODY.player.eye, z: -0.75, yaw: 0.35, pitch: -0.33 },
  walk: { x: -8.5, y: ARENA.keep.walk.y + BODY.player.eye, z: -1.6, yaw: 1.3, pitch: -0.3 },
  top: { x: 12, y: 95, z: 52, yaw: Math.PI, pitch: -1.18 },
  gate: { x: 0.5, y: BODY.player.eye, z: 10, yaw: Math.PI, pitch: 0.05 },
  beacon: { x: 6, y: BODY.player.eye, z: 13, yaw: 2.45, pitch: 0.42 },
  valley: { x: 4, y: 9.5, z: -1, yaw: 0.45, pitch: -0.12 },                                  // over the valley (the far horde)
  m2o4: { x: -7, y: ARENA.keep.walk.y + BODY.player.eye, z: -0.6, yaw: 1.2, pitch: -0.3 },  // an alternative m2 framing
  // the camp and Night II (DESIGN §9)
  camp_w: { x: 7, y: BODY.player.eye, z: 7.5, yaw: -1.68, pitch: -0.04 },        // the plaza at dusk, into the low sun: pads, stall
  camp_e: { x: -19.5, y: BODY.player.eye, z: 8.2, yaw: 1.95, pitch: -0.06 },     // the other way: long shadows, the lit wall
  stall: { x: -12.6, y: 1.75, z: 8.6, yaw: -2.28, pitch: -0.12 },                // Brother Cinder's stall
  campwalk: { x: -6.5, y: ARENA.keep.walk.y + BODY.player.eye, z: -0.9, yaw: 0.62, pitch: -0.42 }, // the wall walk over the pads
  shadow: { x: -2.2, y: BODY.player.eye, z: 1.2, yaw: 2.07, pitch: -0.3 },       // the horned shadow on the gate (first person)
  shadow2: { x: -5.2, y: BODY.player.eye, z: 3.0, yaw: 1.6, pitch: -0.18 },      // the shadow on the ground and the wall, side-on
  shadow3: { x: -6, y: 2.2, z: 7, yaw: 2.39, pitch: -0.16 },                    // third person: use with pp=-2.2,1.2
  banners: { x: 7.5, y: BODY.player.eye, z: 8.8, yaw: 0.25, pitch: -0.2 },       // the dropped banners on the slope
  glance: { x: 10.25, y: 10.29, z: -1.96, yaw: 1.24, pitch: 0.69 },             // the cinema's kindle glance lens
  // the later nights and the ending (DESIGN §8)
  village: { x: 4, y: ARENA.keep.walk.y + BODY.player.eye, z: -1, yaw: 0.075, pitch: -0.19 },   // the far village from the wall walk
  villagenear: { x: 4, y: -6.5, z: 84, yaw: 0.33, pitch: -0.2 },                             // the hunt's crane, closer
  portal: { x: 3, y: -4.4, z: 36, yaw: Math.PI + 0.06, pitch: 0.36 },                        // the keep and the sky above it from the slope
  slope: { x: 4, y: 9.5, z: -1, yaw: 0.45, pitch: -0.22 },                                  // down the slope (ash, lava cracks)
};
const cam = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 };
function view(name) {
  const v = VIEWS[name] || VIEWS.m1;
  Object.assign(cam, v);
  apply();
}
function apply() {
  camera.position.set(cam.x, cam.y, cam.z);
  camera.rotation.set(cam.pitch, cam.yaw + Math.PI, 0);
  camera.updateMatrixWorld();
}

// -------------------------------------------------------- fake fire light (the fire code writes the real one in the game)
const FS = 64;
const fireData = new Float32Array(FS * FS * 4);
const spots = [
  { x: 9, z: 3.2, r: 2.6, a: 2.6 }, { x: 15, z: 4.6, r: 2.2, a: 2.2 }, { x: 8.5, z: 1.0, r: 1.6, a: 2.0 },
  { x: 21, z: 5, r: 2.0, a: 1.8 }, { x: 26, z: 9, r: 2.4, a: 1.6 }, { x: -3, z: 4, r: 1.6, a: 1.2 },
];
const HUES = { orange: [1.0, 0.42, 0.13], violet: [0.62, 0.2, 1.0], blue: [0.2, 0.45, 1.0], green: [0.3, 1.0, 0.25], lilac: [0.8, 0.55, 1.0] };
const HUE = HUES[P.get('hue')] || HUES.orange;
for (let j = 0; j < FS; j++) for (let i = 0; i < FS; i++) {
  const x = ARENA.fluid.x0 + ((i + 0.5) / FS) * ARENA.fluid.size, z = ARENA.fluid.z0 + ((j + 0.5) / FS) * ARENA.fluid.size;
  let s = 0;
  for (const p of spots) s += p.a * Math.exp(-((x - p.x) ** 2 + (z - p.z) ** 2) / (p.r * p.r));
  fireData.set([HUE[0] * s, HUE[1] * s, HUE[2] * s, 1], (j * FS + i) * 4);
}
const fireTex = new THREE.DataTexture(fireData, FS, FS, THREE.RGBAFormat, THREE.FloatType);
fireTex.magFilter = fireTex.minFilter = THREE.LinearFilter; fireTex.needsUpdate = true;
const blackFire = FIRELIGHT.uFireLightMap.value;
function setFire(on) { FIRELIGHT.uFireLightMap.value = on ? fireTex : blackFire; document.getElementById('fire').checked = on; }

// ---------------------------------------------------------------- a stub fluid pass: copy + a warm sheet over the spots
const stubMat = new THREE.ShaderMaterial({
  uniforms: {
    tColor: { value: null }, tDepth: { value: null }, uProjInv: { value: new THREE.Matrix4() }, uCamWorld: { value: new THREE.Matrix4() },
    uSpots: { value: spots.map((s) => new THREE.Vector4(s.x, s.z, s.r, s.a)) }, uOn: { value: 0 }, uTime: { value: 0 }, uHue: { value: new THREE.Vector3(...HUE) },
  },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }',
  fragmentShader: /* glsl */`
    uniform sampler2D tColor; uniform sampler2D tDepth; uniform mat4 uProjInv; uniform mat4 uCamWorld; uniform vec4 uSpots[6]; uniform float uOn; uniform float uTime; uniform vec3 uHue;
    varying vec2 vUv;
    void main(){
      vec3 c = texture2D(tColor, vUv).rgb;
      float d = texture2D(tDepth, vUv).r;
      if (uOn > 0.5 && d < 0.99999) {
        vec4 ndc = vec4(vUv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
        vec4 vp = uProjInv * ndc; vp /= vp.w;
        vec3 wp = (uCamWorld * vp).xyz;
        float s = 0.0;
        for (int i = 0; i < 6; i++) { vec2 q = wp.xz - uSpots[i].xy; s += uSpots[i].w * exp(-dot(q, q) / (uSpots[i].z * uSpots[i].z * 0.35)); }
        s *= smoothstep(1.2, 0.0, wp.y) * (0.8 + 0.2 * sin(uTime * 9.0 + wp.x));
        c += uHue * s * 0.6;
      }
      gl_FragColor = vec4(c, 1.0);
    }`,
  depthTest: false, depthWrite: false, toneMapped: false,
});
const stubQuad = new THREE.Mesh(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3)), stubMat);
stubQuad.frustumCulled = false;
const stubCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
let stubT = 0;
const stubPass = {
  render(r, { colorTex, depthTex, camera: c, target }) {
    stubMat.uniforms.tColor.value = colorTex; stubMat.uniforms.tDepth.value = depthTex;
    stubMat.uniforms.uProjInv.value.copy(c.projectionMatrixInverse); stubMat.uniforms.uCamWorld.value.copy(c.matrixWorld);
    stubMat.uniforms.uOn.value = FIRELIGHT.uFireLightMap.value === fireTex ? 1 : 0;
    stubMat.uniforms.uTime.value = stubT;
    r.setRenderTarget(target); r.render(stubQuad, stubCam);
  },
};

// ---------------------------------------------------------------- build
const t0 = performance.now();
const env = await createEnvironment({ renderer, scene, camera, quality, assetsBase: new URL('../assets/', import.meta.url).href });
const look = createLook({ renderer, scene, camera, quality });
look.setFluidPass(P.get('stub') === '0' ? null : stubPass);
const buildMs = performance.now() - t0;

const fake = {
  gate: { hp: ARENA.gate.hp, hpMax: ARENA.gate.hp },
  troughs: ARENA.oil.troughs.map((T) => ({ id: T.id, oil: 1, lit: false })),
  barrels: ARENA.oil.barrels.map(() => ({ alive: true })),
  // the fake roguelite state (the real game: ?camp=1, ?night=2, __ew.goto)
  mode: P.get('camp') === '1' ? 'camp' : 'play',
  night: { n: Number(P.get('night') || 1) },
  camp: { near: P.get('near') != null ? (ARENA.camp.pads[Number(P.get('near'))]?.id ?? null) : null },
  towers: (P.get('built') || '').split(',').filter(Boolean).map((i) => ({ pad: ARENA.camp.pads[Number(i)]?.id, type: 'obelisk', level: 1 })),
  player: { x: 0, y: 0, z: 0 },
  weather: { rain: Number(P.get('rain') || 0) },
};
if (P.get('ending') === '1') fake.mode = 'ending';
const holdFlare = P.get('flare') != null ? Number(P.get('flare')) : null;
// the DESIGN §8 setters from the URL
if (P.get('storm') === '1') env.setStorm(true);
for (const [k, fn] of [['world', 'setWorldChange'], ['portal', 'setPortal'], ['lamp', 'setLamp'], ['gateopen', 'setGateOpen'], ['village', 'setVillageBurn']]) if (P.get(k) != null) env[fn](Number(P.get(k)));
if (P.get('et') != null) env.setEndingTime(Number(P.get('et')));
const pp = P.get('pp') ? P.get('pp').split(',').map(Number) : null;   // a fake player elsewhere than the camera (pp=x,z)
const holdVision = P.get('vt') != null ? Number(P.get('vt')) : null;
if (P.get('moon')) NIGHT.moonI = Number(P.get('moon'));
if (P.get('hemi')) NIGHT.hemiI = Number(P.get('hemi'));
if (P.get('exp')) look.setExposure(Number(P.get('exp')));
let dawn = Number(P.get('dawn') || 0);
function setDawn(x) { dawn = x; env.setDawn(x); look.setDawn(x); document.getElementById('dawn').value = String(x); }
function setGate(f) { fake.gate.hp = f * ARENA.gate.hp; document.getElementById('gate').value = String(f); }
setDawn(dawn);
if (P.get('gate')) setGate(Number(P.get('gate')));
setFire(P.get('fire') === '1');
view(P.get('view') || 'm1');
if (P.get('hud') === '0') document.getElementById('hud').classList.add('hidden');
if (P.get('tone') === 'agx') look.setTone('agx');

// ---------------------------------------------------------------- UI
document.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => { if (b.dataset.view !== 'free') view(b.dataset.view); }));
document.getElementById('fire').addEventListener('change', (e) => setFire(e.target.checked));
document.getElementById('stub').addEventListener('change', (e) => look.setFluidPass(e.target.checked ? stubPass : null));
document.getElementById('dawn').addEventListener('input', (e) => setDawn(Number(e.target.value)));
document.getElementById('gate').addEventListener('input', (e) => setGate(Number(e.target.value)));
document.getElementById('campOn').addEventListener('click', () => { fake.mode = 'camp'; });
document.getElementById('campOff').addEventListener('click', () => { fake.mode = 'play'; });
document.getElementById('n1').addEventListener('click', () => { fake.night.n = 1; });
document.getElementById('n2').addEventListener('click', () => { fake.night.n = 2; });
document.getElementById('near').addEventListener('click', () => { fake.camp.near = fake.camp.near ? null : ARENA.camp.pads[0].id; });
let barrelI = 0;
document.getElementById('kindle').addEventListener('click', () => env.onEvent({ type: EV.KINDLE, level: 1 }, fake));
document.getElementById('barrel').addEventListener('click', () => { const i = barrelI++ % fake.barrels.length; fake.barrels[i].alive = false; env.onEvent({ type: EV.BARREL_BURST, idx: i }, fake); });
document.getElementById('trough').addEventListener('click', () => { const T = fake.troughs[1]; T.lit = !T.lit; if (!T.lit) T.oil = 0.2; env.onEvent({ type: T.lit ? EV.TROUGH_LIT : EV.TROUGH_OUT, id: T.id }, fake); });
let tone = P.get('tone') === 'agx' ? 'agx' : 'neutral';
document.getElementById('tone').addEventListener('click', (e) => { tone = tone === 'agx' ? 'neutral' : 'agx'; look.setTone(tone); e.target.textContent = `tone: ${tone}`; });
addEventListener('keydown', (e) => { if (e.key === 'f' || e.key === 'F') setFire(FIRELIGHT.uFireLightMap.value !== fireTex); if (e.key === 'h') document.getElementById('hud').classList.toggle('hidden'); keys[e.code] = true; });
addEventListener('keyup', (e) => { keys[e.code] = false; });
const keys = {};
let drag = null;
renderer.domElement.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY }; });
addEventListener('pointerup', () => { drag = null; });
addEventListener('pointermove', (e) => {
  if (!drag) return;
  cam.yaw -= (e.clientX - drag.x) * 0.0035; cam.pitch = Math.max(-1.5, Math.min(1.5, cam.pitch - (e.clientY - drag.y) * 0.0035));
  drag = { x: e.clientX, y: e.clientY }; apply();
});
addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); look.setSize(innerWidth, innerHeight); });

// ---------------------------------------------------------------- loop + stats
const stats = document.getElementById('stats');
const frames = [];
let last = performance.now(), t = 0, cpuMs = 0, info = { calls: 0, tris: 0, worldCalls: 0, worldTris: 0 };
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000); last = now; t += dt; stubT = t;
  frames.push(dt * 1000); if (frames.length > 240) frames.shift();
  // free fly
  const sp = (keys.ShiftLeft ? 30 : 8) * dt;
  const fx = Math.sin(cam.yaw), fz = Math.cos(cam.yaw);
  if (keys.KeyW) { cam.x += fx * sp; cam.z += fz * sp; } if (keys.KeyS) { cam.x -= fx * sp; cam.z -= fz * sp; }
  if (keys.KeyA) { cam.x += fz * sp; cam.z -= fx * sp; } if (keys.KeyD) { cam.x -= fz * sp; cam.z += fx * sp; }
  if (keys.KeyE) cam.y += sp; if (keys.KeyQ) cam.y -= sp;
  if (Object.values(keys).some(Boolean)) apply();
  const c0 = performance.now();
  renderer.info.reset();
  // the bench camera is the player (the horned shadow follows its feet)
  if (pp) { fake.player.x = pp[0]; fake.player.z = pp[1]; fake.player.y = 0; }
  else { fake.player.x = cam.x; fake.player.z = cam.z; fake.player.y = cam.y - BODY.player.eye; }
  if (holdFlare != null) env.setFlare(holdFlare);
  if (holdVision != null) env.vision(holdVision - dt);
  if (P.get('strike') === '1') env.strike();          // hold a lightning flash for captures
  env.update(dt, t, fake);
  look.render(dt);
  cpuMs = cpuMs * 0.9 + (performance.now() - c0) * 0.1;
  info = { calls: renderer.info.render.calls, tris: renderer.info.render.triangles, worldCalls: look.stats.worldCalls, worldTris: look.stats.worldTris };
  if ((t * 4 | 0) !== ((t - dt) * 4 | 0)) {
    const s = [...frames].sort((a, b) => a - b);
    stats.textContent = `frame ${(s.reduce((a, b) => a + b, 0) / s.length).toFixed(2)} ms avg · p95 ${s[Math.floor(s.length * 0.95)]?.toFixed(2)}\n` +
      `cpu (env.update + look.render) ${cpuMs.toFixed(2)} ms\nworld pass: ${info.worldCalls} calls · ${(info.worldTris / 1000).toFixed(0)}k tris (incl. shadow)\n` +
      `frame: ${info.calls} calls · ${(info.tris / 1000).toFixed(0)}k tris\nres ${look.size.width}×${look.size.height} · build ${buildMs.toFixed(0)} ms · ${quality}`;
  }
  requestAnimationFrame(frame);
}
await look.warm();
requestAnimationFrame(frame);
if (P.get('kindle') === '1') env.onEvent({ type: EV.KINDLE, level: 1 }, fake);

// ---------------------------------------------------------------- hooks for captures
window.__env = {
  ready: true, env, look, renderer, scene, camera, view, setDawn, setFire, setGate, fake, EV,
  /** flip the fake state's mode (env ramps by itself: 1.2 s in, 2.0 s sunset out) */
  camp(on) { fake.mode = on ? 'camp' : 'play'; }, night(n) { fake.night.n = n; },
  setCam(o) { Object.assign(cam, o); apply(); },
  event(ev) { env.onEvent(ev, fake); },
  /** Sample N frames: rAF interval avg/p95, CPU ms, calls and triangles of the last frame. */
  async perf(n = 120) {
    const dts = [], cpu = [];
    let prev = performance.now();
    for (let i = 0; i < n; i++) {
      await new Promise((r) => requestAnimationFrame(r));
      const now = performance.now(); dts.push(now - prev); prev = now; cpu.push(cpuMs);
    }
    dts.sort((a, b) => a - b);
    return { frames: n, avgMs: +(dts.reduce((a, b) => a + b, 0) / n).toFixed(2), p95Ms: +dts[Math.floor(n * 0.95)].toFixed(2), cpuMs: +cpuMs.toFixed(2), ...info, res: look.size, envStats: env.stats() };
  },
};
