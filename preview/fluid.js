// VALLEYWARD · fluid test bench (preview/fluid.html). Its own minimal render path: scene → RT with a DepthTexture →
// fluid.pass → (cheap bloom) → ACES + sRGB → screen. The real look is src/look/. Automation: window.__fluidBench.
// URL: ?quality=high|medium|low &fire=smooth|hybrid &view=m1|m2 &scenario=m1|m2 &noui=1 &timing=1 &debug=1
import * as THREE from 'three';
import { ARENA, groundHeight, BODY } from '../src/shared/arena.js';
import { FIRE_OP } from '../src/shared/fireops.js';
import { patchFireLight, FIRELIGHT } from '../src/shared/firelight.js';
import { createFire } from '../src/fire/index.js';
import { KNOBS, DEPOSIT, makeFireVortexMaterial, jetLanding } from 'firewraith/modules/classic';

const qs = new URLSearchParams(location.search);
if (qs.get('noui') === '1') document.body.classList.add('noui');
const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById('gl'));
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: qs.get('capture') === '1' });
renderer.setPixelRatio(1);
renderer.setSize(innerWidth, innerHeight, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;

// ------------------------------------------------------------------------------------------------ pixel textures
function pixelTex(size, fn, repeat = 1) {
  const d = new Uint8Array(size * size * 4);
  let s = 7;
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) { const c = fn(x, y, rnd); const i = (y * size + x) * 4; d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255; }
  const t = new THREE.DataTexture(d, size, size);
  t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.repeat.set(repeat, repeat); t.needsUpdate = true;
  return t;
}
const earthTex = pixelTex(32, (x, y, r) => { const v = 0.75 + r() * 0.4; return [92 * v, 84 * v, 70 * v]; });
const stoneTex = pixelTex(32, (x, y, r) => {
  const row = Math.floor(y / 8), off = (row % 2) * 8, mortar = y % 8 === 0 || (x + off) % 16 === 0;
  const v = mortar ? 0.55 : 0.8 + r() * 0.35; return [92 * v, 100 * v, 112 * v];
});
const woodTex = pixelTex(16, (x, y, r) => { const v = (x % 4 === 0 ? 0.6 : 0.85) + r() * 0.2; return [96 * v, 66 * v, 42 * v]; });

// ------------------------------------------------------------------------------------------------ scene
const scene = new THREE.Scene();
scene.background = new THREE.Color('#184255');
scene.fog = new THREE.FogExp2(new THREE.Color('#2c5168'), 0.006);
const md = ARENA.moonDir;
scene.add(new THREE.HemisphereLight('#2a5a6e', '#1a2224', 1.6));
const moon = new THREE.DirectionalLight('#9fd3e0', 1.3);
moon.position.set(md.x * 100, md.y * 100, md.z * 100);
scene.add(moon);
const moonDisc = new THREE.Mesh(new THREE.CircleGeometry(16, 40), new THREE.MeshBasicMaterial({ color: new THREE.Color('#9ee1e9').multiplyScalar(2.2), fog: false }));
moonDisc.position.set(md.x * 320, md.y * 320, md.z * 320); moonDisc.lookAt(0, 0, 0);
scene.add(moonDisc);

const mats = {
  earth: patchFireLight(new THREE.MeshLambertMaterial({ map: earthTex })),
  stone: patchFireLight(new THREE.MeshLambertMaterial({ map: stoneTex })),
  wood: patchFireLight(new THREE.MeshStandardMaterial({ map: woodTex, roughness: 1, metalness: 0 })),
  pine: patchFireLight(new THREE.MeshLambertMaterial({ color: '#1f3a33' })),
  goblin: patchFireLight(new THREE.MeshBasicMaterial({ color: '#4d5728', side: THREE.DoubleSide })),
  imp: patchFireLight(new THREE.MeshStandardMaterial({ color: '#7a2a22', roughness: 1, side: THREE.DoubleSide })),
};
earthTex.repeat.set(180 / 2, 200 / 2);

// terrain (ARENA.terrain) from groundHeight
{
  const T = ARENA.terrain, w = T.x1 - T.x0, d = T.z1 - T.z0;
  const g = new THREE.PlaneGeometry(w, d, w, d);
  g.rotateX(-Math.PI / 2);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) { const x = p.getX(i) + (T.x0 + w / 2), z = p.getZ(i) + (T.z0 + d / 2); p.setXYZ(i, x, groundHeight(x, z), z); }
  g.computeVertexNormals();
  scene.add(new THREE.Mesh(g, mats.earth));
}
// the keep: walls, towers, the gate, merlons (instanced), troughs, the stair
function box(x0, y0, z0, x1, y1, z1, mat) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), mat);
  m.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  scene.add(m); return m;
}
const K = ARENA.keep;
box(K.x0, 0, -K.wallThick, ARENA.gate.x0, K.wallHeight, 0, mats.stone);
box(ARENA.gate.x1, 0, -K.wallThick, K.x1, K.wallHeight, 0, mats.stone);
box(ARENA.gate.x0, ARENA.gate.height, -K.wallThick, ARENA.gate.x1, K.wallHeight, 0, mats.stone);
box(ARENA.gate.x0, 0, -1.2, ARENA.gate.x1, ARENA.gate.height, -0.3, mats.wood);
box(K.x0, 0, K.z0, K.x0 + K.wallThick, K.wallHeight, 0, mats.stone);
box(K.x1 - K.wallThick, 0, K.z0, K.x1, K.wallHeight, 0, mats.stone);
box(K.x0, 0, K.z0, K.x1, K.wallHeight, K.z0 + K.wallThick, mats.stone);
for (const t of K.towers) box(t.x - t.half, 0, t.z - t.half, t.x + t.half, t.height, t.z + t.half, mats.stone);
{
  const n = 22, im = new THREE.InstancedMesh(new THREE.BoxGeometry(0.9, 1.1, 0.7), mats.stone, n);
  const m4 = new THREE.Matrix4();
  for (let i = 0; i < n; i++) { m4.makeTranslation(-12 + i * (24 / (n - 1)), K.wallHeight + 0.55, -0.35); im.setMatrixAt(i, m4); }
  scene.add(im);
}
for (const t of ARENA.oil.troughs) box(t.x0 - 0.15, 0, t.z0 - 0.15, t.x1 + 0.15, 0.35, t.z1 + 0.15, mats.stone);
{
  const s = ARENA.stair;
  const g = new THREE.BoxGeometry(s.x1 - s.x0, 0.25, Math.hypot(s.zBottom - s.zTop, s.yTop));
  const m = new THREE.Mesh(g, mats.wood);
  m.position.set((s.x0 + s.x1) / 2, s.yTop / 2, (s.zBottom + s.zTop) / 2);
  m.rotation.x = Math.atan2(s.yTop, s.zBottom - s.zTop);
  scene.add(m);
}
// barrels (Standard), pines (instanced Lambert)
for (const [x, z] of ARENA.oil.barrels) { const b = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 1.1, 10), mats.wood); b.position.set(x, groundHeight(x, z) + 0.55, z); scene.add(b); }
{
  const n = 140, im = new THREE.InstancedMesh(new THREE.ConeGeometry(1.8, 7, 7), mats.pine, n);
  const m4 = new THREE.Matrix4(); let s = 3;
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  let k = 0;
  while (k < n) {
    const x = -60 + rnd() * 160, z = 14 + rnd() * 120;
    if (Math.abs(x - 22) < 9 && z < 50) continue;
    const sc = 0.7 + rnd() * 0.8; m4.makeScale(sc, sc, sc).setPosition(x, groundHeight(x, z) + 3.5 * sc, z); im.setMatrixAt(k++, m4);
  }
  scene.add(im);
}
// stand-in goblins: camera-facing cards (instanced Basic + instanced Standard)
const GOB = [];
{
  let s = 11; const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  for (let i = 0; i < 40; i++) GOB.push({ x: 7 + rnd() * 18, z: 2.5 + rnd() * 6, kind: rnd() < 0.3 ? 1 : 0 });
  for (let i = 0; i < 26; i++) GOB.push({ x: -4 + rnd() * 8, z: 1.3 + rnd() * 4.5, kind: rnd() < 0.3 ? 1 : 0 });
  for (let i = 0; i < 20; i++) GOB.push({ x: 20 + rnd() * 14, z: 10 + rnd() * 20, kind: rnd() < 0.3 ? 1 : 0 });
}
const cardGeo = new THREE.PlaneGeometry(0.8, BODY.grunt.height); cardGeo.translate(0, BODY.grunt.height / 2, 0);
const gobMesh = [new THREE.InstancedMesh(cardGeo, mats.goblin, GOB.length), new THREE.InstancedMesh(cardGeo, mats.imp, GOB.length)];
gobMesh.forEach((m) => { m.frustumCulled = false; scene.add(m); });
function updateCards(cam) {
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  const c = [0, 0];
  for (const g of GOB) {
    const yaw = Math.atan2(cam.position.x - g.x, cam.position.z - g.z);
    q.setFromAxisAngle(up, yaw);
    p.set(g.x, groundHeight(g.x, g.z), g.z);
    m4.compose(p, q, sc);
    gobMesh[g.kind].setMatrixAt(c[g.kind]++, m4);
  }
  gobMesh.forEach((m, i) => { m.count = c[i]; m.instanceMatrix.needsUpdate = true; });
}

// ------------------------------------------------------------------------------------------------ cameras
const camera = new THREE.PerspectiveCamera(78 * 9 / 16 * 1.0, innerWidth / innerHeight, 0.1, 600);
const VIEWS = {
  // = the game's capture views (src/view/camera.js)
  m1: { x: ARENA.playerSpawn.x, y: BODY.player.eye, z: ARENA.playerSpawn.z, yaw: ARENA.playerSpawn.yaw - 0.12, pitch: -0.07 },
  m2: { x: -6.5, y: ARENA.keep.walk.y + BODY.player.eye, z: -1.4, yaw: 0.86, pitch: -0.3 },
  // a look-comparison framing: the same spot, leaning on the parapet and looking down over it like the M2 key art
  m2b: { x: -6.5, y: ARENA.keep.walk.y + BODY.player.eye, z: 0.3, yaw: 0.86, pitch: -0.55 },   // (floats just outside the parapet)
  top: { x: 12, y: 46, z: 30, yaw: Math.PI, pitch: -1.5 },
  // DESIGN §8: the ending's framings (bench stand-ins): the beacon's pillar from the plaza, the demon from below the wall
  end: { x: -2, y: 3, z: 40, yaw: 2.76, pitch: 0.5 },
  demon: { x: 2, y: 2.4, z: 9.5, yaw: Math.PI, pitch: 0.42 },
  whirl: { x: 11, y: 17, z: 19, yaw: Math.PI, pitch: -0.85 },
};
let viewName = qs.get('view') in VIEWS ? qs.get('view') : 'm1';
function setView(name) {
  viewName = name in VIEWS ? name : 'm1';
  const v = VIEWS[viewName]; if (!v) return;
  camera.position.set(v.x, v.y, v.z);
  camera.rotation.order = 'YXZ';
  camera.rotation.set(v.pitch, v.yaw + Math.PI, 0);
  camera.updateMatrixWorld();
}
function setFov() { camera.fov = 78; camera.near = 0.05; camera.far = 900; camera.updateProjectionMatrix(); }   // as the game (src/view/camera.js): vertical 78°
setView(viewName);

// ------------------------------------------------------------------------------------------------ render path
let W = 0, H = 0, sceneRT, fluidRT, bloomA, bloomB, bloomC, bloomD;
const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2)); quad.frustumCulled = false;
const qcam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const FSV = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
const fsMat = (frag, uniforms) => new THREE.ShaderMaterial({ vertexShader: FSV, fragmentShader: frag, uniforms, depthTest: false, depthWrite: false });
const copyMat = fsMat('varying vec2 vUv; uniform sampler2D t; void main(){ gl_FragColor = texture2D(t, vUv); }', { t: { value: null } });
const brightMat = fsMat(`varying vec2 vUv; uniform sampler2D t; uniform vec2 px;
  void main(){ vec3 c = vec3(0.0);
    for (int j = -1; j <= 1; j += 2) for (int i = -1; i <= 1; i += 2) c += texture2D(t, vUv + vec2(float(i), float(j)) * px).rgb;
    c *= 0.25; float l = max(c.r, max(c.g, c.b)); gl_FragColor = vec4(c * smoothstep(0.9, 2.2, l), 1.0); }`, { t: { value: null }, px: { value: new THREE.Vector2() } });
const blurMat = fsMat(`varying vec2 vUv; uniform sampler2D t; uniform vec2 dir;
  void main(){ vec3 c = texture2D(t, vUv).rgb * 0.227;
    c += (texture2D(t, vUv + dir * 1.385).rgb + texture2D(t, vUv - dir * 1.385).rgb) * 0.316;
    c += (texture2D(t, vUv + dir * 3.231).rgb + texture2D(t, vUv - dir * 3.231).rgb) * 0.070;
    gl_FragColor = vec4(c, 1.0); }`, { t: { value: null }, dir: { value: new THREE.Vector2() } });
const outMat = fsMat(`varying vec2 vUv; uniform sampler2D t; uniform sampler2D b1; uniform sampler2D b2; uniform float exposure;
  vec3 aces(vec3 x){ return clamp((x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14), 0.0, 1.0); }
  vec3 toSRGB(vec3 c){ return mix(c * 12.92, 1.055 * pow(max(c, vec3(0.0)), vec3(1.0/2.4)) - 0.055, step(0.0031308, c)); }
  void main(){ vec3 c = texture2D(t, vUv).rgb + texture2D(b1, vUv).rgb * 0.35 + texture2D(b2, vUv).rgb * 0.45;
    vec2 q = vUv - 0.5; c *= 1.0 - 0.35 * dot(q, q) * 2.0;
    gl_FragColor = vec4(toSRGB(aces(max(c, vec3(0.0)) * exposure)), 1.0); }`, { t: { value: null }, b1: { value: null }, b2: { value: null }, exposure: { value: 1.25 } });
function run(mat, target) { quad.material = mat; renderer.setRenderTarget(target); renderer.render(quad, qcam); }

function resize() {
  const w = innerWidth, h = innerHeight;
  if (w === W && h === H) return;
  W = w; H = h;
  renderer.setSize(w, h, false);
  camera.aspect = w / h; setFov();
  sceneRT?.dispose(); fluidRT?.dispose(); [bloomA, bloomB, bloomC, bloomD].forEach((t) => t?.dispose());
  sceneRT = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, depthTexture: new THREE.DepthTexture(w, h), depthBuffer: true });
  sceneRT.depthTexture.minFilter = sceneRT.depthTexture.magFilter = THREE.NearestFilter;
  fluidRT = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, depthBuffer: false });
  const b = (k) => new THREE.WebGLRenderTarget(Math.ceil(w / k), Math.ceil(h / k), { type: THREE.HalfFloatType, depthBuffer: false });
  bloomA = b(4); bloomB = b(4); bloomC = b(8); bloomD = b(8);
}
resize();
addEventListener('resize', resize);

// ------------------------------------------------------------------------------------------------ the fluid
const quality = ['high', 'medium', 'low'].includes(qs.get('quality')) ? qs.get('quality') : 'high';
let style = qs.get('fire') === 'hybrid' ? 'hybrid' : 'smooth';
const fluid = await createFire({ renderer, quality, style, gpuTiming: qs.get('timing') === '1' });
const tw = performance.now();
await fluid.warm(renderer, camera);   // as the game's warm-up does: both styles compiled before the first frame
const warmMs = performance.now() - tw;
let fluidOn = true;
// DESIGN §8: the portal disc with a fire vortex shader (the environment draws the real portal; this is the demo), shown with the pillar
const vortex = new THREE.Mesh(new THREE.CircleGeometry(13, 64), makeFireVortexMaterial({ noise: fluid.debug.volume.noise }));
vortex.position.set(4, 50, -12); vortex.lookAt(4, 0, 30); vortex.visible = false; vortex.frustumCulled = false;
scene.add(vortex);
let fluidMode = 'both';   // perf breakdown: 'both' | 'sim' (step only) | 'pass' (render only)

const wind = { x: 0, z: 0 };
const windEl = /** @type {HTMLInputElement} */ (document.getElementById('wind')), wdirEl = /** @type {HTMLInputElement} */ (document.getElementById('wdir'));
function readWind() {
  const s = +windEl.value, a = THREE.MathUtils.degToRad(+wdirEl.value);
  wind.x = Math.sin(a) * s; wind.z = Math.cos(a) * s;   // dir = where it blows toward (0° = +Z south, 90° = +X east)
  document.getElementById('windv').textContent = s.toFixed(1); document.getElementById('wdirv').textContent = wdirEl.value;
}
windEl.oninput = wdirEl.oninput = readWind; readWind();

// ------------------------------------------------------------------------------------------------ input: the fake Lance, bombs, troughs
const ops = [];
const mouse = new THREE.Vector2(0.25, -0.1);
let spraying = false, burningGoblins = false, paused = false;
const ray = new THREE.Raycaster();
function groundPoint(ndc) {
  ray.setFromCamera(ndc, camera);
  const o = ray.ray.origin, d = ray.ray.direction;
  for (let t = 0.5; t < 90; t += 0.25) {
    const x = o.x + d.x * t, y = o.y + d.y * t, z = o.z + d.z * t;
    if (y <= groundHeight(x, z)) return new THREE.Vector3(x, groundHeight(x, z), z);
  }
  return null;
}
const nozzle = new THREE.Vector3(), jetDir = new THREE.Vector3();
let lastLand = null;
function lance(on, target) {
  if (!on || !target) { fluid.lance({ on: false }); lastLand = null; return; }
  nozzle.set(0.26, -0.3, -0.55).applyMatrix4((scen ? lanceCam : camera).matrixWorld);
  const dist = Math.hypot(target.x - nozzle.x, target.z - nozzle.z);
  const range = 11;
  // aim: lob the jet so its ballistic arc lands near the target (the game aims with the camera instead)
  let best = 0, bestErr = 1e9;
  for (let lob = -0.3; lob <= 0.6; lob += 0.03) {
    jetDir.subVectors(target, nozzle).normalize(); jetDir.y += lob; jetDir.normalize();
    const l = jetLanding(nozzle, jetDir, range), err = Math.abs(Math.hypot(l.x - nozzle.x, l.z - nozzle.z) - Math.min(dist, range));
    if (err < bestErr) { bestErr = err; best = lob; }
  }
  jetDir.subVectors(target, nozzle).normalize(); jetDir.y += best; jetDir.normalize();
  fluid.lance({ on: true, origin: nozzle, dir: jetDir, range, t: performance.now() / 1000 });
  const land = jetLanding(nozzle, jetDir, range);
  const hx = jetDir.x, hz = jetDir.z, hl = Math.hypot(hx, hz) || 1;
  const p0 = lastLand || land;
  ops.push({ kind: FIRE_OP.STREAM, x0: p0.x, z0: p0.z, x1: land.x + hx / hl * 1.2, z1: land.z + hz / hl * 1.2, vx: hx / hl * 7, vz: hz / hl * 7, amount: 1, radius: 0.9, hue: lanceHue });
  lastLand = land;
}
function bomb(p, hue) { if (!p) return; ops.push({ kind: FIRE_OP.BURST, x: p.x, z: p.z, r: 3.5, amount: 1, push: 6, hue }, { kind: FIRE_OP.FUEL, x: p.x, z: p.z, r: 2.5, amount: 0.8 }); }
// ---- coloured fire (DESIGN §11.5). Each source as the game makes it, any hue (default: its own).
let lanceHue;   // undefined = orange; 'green' = the Witchfire Wick
/** The Hellfire Obelisk's nova: burst ops on a ring (violet). */
function nova(p, hue = 'violet', R = 3) { if (!p) return; const n = 14; for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2; ops.push({ kind: FIRE_OP.BURST, x: p.x + Math.cos(a) * R, z: p.z + Math.sin(a) * R, r: 1.4, amount: 0.7, push: 3, hue }); } ops.push({ kind: FIRE_OP.BURST, x: p.x, z: p.z, r: 1.6, amount: 0.5, push: 4, hue }); }
/** Ember Orbit: fireballs circling a point for `dur` s, dropping ember ops (blue). */
const orbits = [];
function orbit(p, hue = 'blue', dur = 3) { if (p) orbits.push({ x: p.x, z: p.z, t: 0, dur, hue }); }
/** Brimstone Rain: a meteor burst r 3 (green). */
function meteor(p, hue = 'green') { if (!p) return; ops.push({ kind: FIRE_OP.BURST, x: p.x, z: p.z, r: 3, amount: 1, push: 7, hue }, { kind: FIRE_OP.FUEL, x: p.x, z: p.z, r: 1.6, amount: 0.5 }); }
/** Cinder Trail: ember ops every 0.2 s along a walked line toward the point (lilac). */
const trails = [];
function trail(p, hue = 'lilac', from = null) { if (!p) return; const f = from || { x: p.x - 7, z: p.z + 1 }; trails.push({ x0: f.x, z0: f.z, x1: p.x, z1: p.z, t: 0, dur: 2.0, acc: 0, hue }); }
// ---- DESIGN §8.3, §6.3, §12: rain, the Rainmother's tide and whirlpools, the pillar and the demon's fire
let rain = 0;
const waves = [], whirls = [];
/** A tide wave: a 16 m douse line sweeping across `p` toward the camera's side over 1.6 s, shoving the flow. */
function tide(p) {
  if (!p) return;
  const d = new THREE.Vector3(camera.position.x - p.x, 0, camera.position.z - p.z).normalize();
  waves.push({ x: p.x - d.x * 6, z: p.z - d.z * 6, dx: d.x, dz: d.z, t: 0, dur: 1.6, speed: 7.5 });
}
/** A whirlpool at `p` for `dur` s. */
function whirl(p, dur = 6) { if (p) whirls.push({ x: p.x, z: p.z, t: 0, dur }); }
const BEACON = ARENA.beacon.basket;
const DEMON_AT = { x: 2, y: ARENA.keep.walk.y, z: -1.5 };
function pillar(on = true) { fluid.columns.set('pillar', on ? { preset: 'pillar', x: BEACON.x, y: BEACON.y, z: BEACON.z } : null); }
function demon(on = true) { fluid.columns.set('demon', on ? { preset: 'demon', ...DEMON_AT } : null); }
function wave4Ops(dt) {
  for (let i = waves.length - 1; i >= 0; i--) {
    const w = waves[i]; w.t += dt;
    const cx = w.x + w.dx * w.speed * w.t, cz = w.z + w.dz * w.speed * w.t, nx = -w.dz, nz = w.dx;
    ops.push({ kind: FIRE_OP.DOUSE, x0: cx - nx * 8, z0: cz - nz * 8, x1: cx + nx * 8, z1: cz + nz * 8, r: 1.4, vx: w.dx * 6, vz: w.dz * 6 });
    if (w.t >= w.dur) waves.splice(i, 1);
  }
  for (let i = whirls.length - 1; i >= 0; i--) {
    const w = whirls[i]; w.t += dt;
    ops.push({ kind: 'swirl', x: w.x, z: w.z, r: 5, spin: 9, pull: 2, amount: Math.min(1, w.t * 2, (w.dur - w.t) * 2) });
    if (w.t >= w.dur) whirls.splice(i, 1);
  }
}
function hueOps(dt) {
  wave4Ops(dt);
  for (let i = orbits.length - 1; i >= 0; i--) {
    const o = orbits[i]; o.t += dt; o.acc = (o.acc || 0) + dt;
    if (o.acc >= 0.1) { o.acc -= 0.1; for (let k = 0; k < 3; k++) { const a = o.t * 2.9 + k * Math.PI * 2 / 3; ops.push({ kind: FIRE_OP.EMBER, x: o.x + Math.cos(a) * 2.2, z: o.z + Math.sin(a) * 2.2, amount: 0.8, hue: o.hue }); } }
    if (o.t >= o.dur) orbits.splice(i, 1);
  }
  for (let i = trails.length - 1; i >= 0; i--) {
    const tr = trails[i]; tr.t += dt; tr.acc += dt;
    while (tr.acc >= 0.1) { tr.acc -= 0.1; const u = Math.min(1, tr.t / tr.dur); ops.push({ kind: FIRE_OP.EMBER, x: tr.x0 + (tr.x1 - tr.x0) * u, z: tr.z0 + (tr.z1 - tr.z0) * u, amount: 1, hue: tr.hue }); }
    if (tr.t >= tr.dur) trails.splice(i, 1);
  }
}
/** The same source in orange (at a) and in its hue (at b), for side-by-side captures. */
const PAIR_SRC = { violet: nova, blue: orbit, green: meteor, lilac: trail };
function pair(hue, a, b) {
  const fn = PAIR_SRC[hue];
  if (hue === 'lilac') { trail(a, 'orange'); trail(b, 'lilac'); return; }
  fn(a, 'orange'); fn(b, hue);
}
let troughT = -1;
function troughs() { for (const t of ARENA.oil.troughs) ops.push({ kind: FIRE_OP.FUEL, box: { x0: t.x0, z0: t.z0, x1: t.x1, z1: t.z1 }, amount: 1 }); troughT = 0.3; }
function emberOps(dt) {
  if (troughT >= 0) { troughT -= dt; if (troughT < 0) for (const t of ARENA.oil.troughs) ops.push({ kind: FIRE_OP.BURST, x: (t.x0 + t.x1) / 2, z: (t.z0 + t.z1) / 2, r: 1.2, amount: 0.8, push: 1 }); }
  if (burningGoblins) for (const g of GOB) if (Math.random() < dt / 0.3) ops.push({ kind: FIRE_OP.EMBER, x: g.x + (Math.random() - 0.5) * 0.6, z: g.z + (Math.random() - 0.5) * 0.6, amount: 1 });
  hueOps(dt);
}
canvas.addEventListener('pointermove', (e) => { mouse.set(e.clientX / innerWidth * 2 - 1, -(e.clientY / innerHeight) * 2 + 1); });
canvas.addEventListener('pointerdown', (e) => { if (e.button === 0) spraying = true; });
addEventListener('pointerup', () => { spraying = false; });
addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if (k === 'b') bomb(groundPoint(mouse));
  else if (k === 'v') nova(groundPoint(mouse));
  else if (k === 'o') orbit(groundPoint(mouse));
  else if (k === 'm') meteor(groundPoint(mouse));
  else if (k === 'l') trail(groundPoint(mouse));
  else if (k === 'w') lanceHue = lanceHue ? undefined : 'green';
  else if (k === 'r') { rain = rain >= 1 ? 0 : rain + 0.5; fluid.setRain(rain); }
  else if (k === 'k') tide(groundPoint(mouse));
  else if (k === 'y') whirl(groundPoint(mouse));
  else if (k === 'x') pillar(!fluid.columns.get('pillar'));
  else if (k === 'z') demon(!fluid.columns.get('demon'));
  else if (k === 't') troughs();
  else if (k === 'e') burningGoblins = !burningGoblins;
  else if (k === 'd') { for (let x = ARENA.fluid.x0; x < ARENA.fluid.x0 + 64; x += 6) for (let z = ARENA.fluid.z0; z < ARENA.fluid.z0 + 64; z += 6) ops.push({ kind: FIRE_OP.DOUSE, x, z, r: 6 }); }
  else if (k === 'u') { const p = groundPoint(mouse); if (p) ops.push({ kind: FIRE_OP.DOUSE, x: p.x, z: p.z, r: 2.5 }); }   // a Douser's bucket at the cursor
  else if (k === 's') { style = style === 'smooth' ? 'hybrid' : 'smooth'; fluid.setStyle(style); }
  else if (k === '1' || k === '2' || k === '3') fluid.setQuality(['high', 'medium', 'low'][+k - 1]);
  else if (k === 'c') { const order = ['m1', 'm2', 'm2b', 'top', 'end', 'demon']; setView(order[(order.indexOf(viewName) + 1) % order.length]); }
  else if (k === 'f') fluidOn = !fluidOn;
  else if (k === 'g') { const g = document.getElementById('grid'); g.style.display = g.style.display === 'block' ? 'none' : 'block'; }
  else if (k === 'p') paused = !paused;
});
if (qs.get('debug') === '1') document.getElementById('grid').style.display = 'block';

// ------------------------------------------------------------------------------------------------ frame
function render(withFluid) {
  updateCards(camera);
  vortex.visible = !!fluid.columns.get('pillar'); vortex.material.uniforms.uTime.value = simT;
  renderer.setRenderTarget(sceneRT);
  renderer.render(scene, camera);
  if (withFluid) fluid.pass.render(renderer, { colorTex: sceneRT.texture, depthTex: sceneRT.depthTexture, camera, target: fluidRT, width: W, height: H });
  else { copyMat.uniforms.t.value = sceneRT.texture; run(copyMat, fluidRT); }
  brightMat.uniforms.t.value = fluidRT.texture; brightMat.uniforms.px.value.set(1 / W, 1 / H); run(brightMat, bloomA);
  blurMat.uniforms.t.value = bloomA.texture; blurMat.uniforms.dir.value.set(1 / bloomA.width, 0); run(blurMat, bloomB);
  blurMat.uniforms.t.value = bloomB.texture; blurMat.uniforms.dir.value.set(0, 1 / bloomA.height); run(blurMat, bloomA);
  copyMat.uniforms.t.value = bloomA.texture; run(copyMat, bloomC);
  blurMat.uniforms.t.value = bloomC.texture; blurMat.uniforms.dir.value.set(1 / bloomC.width, 0); run(blurMat, bloomD);
  blurMat.uniforms.t.value = bloomD.texture; blurMat.uniforms.dir.value.set(0, 1 / bloomC.height); run(blurMat, bloomC);
  outMat.uniforms.t.value = fluidRT.texture; outMat.uniforms.b1.value = bloomA.texture; outMat.uniforms.b2.value = bloomC.texture;
  run(outMat, null);
}
let simT = 0;
function frame(dt, scripted) {
  simT += dt;
  if (scripted) scripted(dt, simT);
  else { lance(spraying, spraying ? groundPoint(mouse) : null); }
  emberOps(dt);
  if (fluidOn && !paused && fluidMode !== 'pass') { fluid.events(ops.splice(0), wind); fluid.update(dt); } else ops.length = 0;
  render(fluidOn && fluidMode !== 'sim');
}

// HUD
const hud = document.getElementById('hud');
const gridCv = /** @type {HTMLCanvasElement} */ (document.getElementById('grid')), gctx = gridCv.getContext('2d'), gimg = gctx.createImageData(64, 64);
let fpsAcc = 0, fpsN = 0, fpsShown = 0, lastHud = 0;
function drawHud(ms) {
  fpsAcc += ms; fpsN++;
  const now = performance.now();
  if (now - lastHud < 250) return;
  lastHud = now; fpsShown = fpsAcc / fpsN; fpsAcc = 0; fpsN = 0;
  const s = fluid.stats();
  hud.textContent = `VALLEYWARD fluid bench  ${W}×${H}  view ${viewName}\n` +
    `frame ${fpsShown.toFixed(2)} ms (${(1000 / fpsShown).toFixed(0)} fps)  fluid ${fluidOn ? 'on' : 'OFF'}\n` +
    `style ${s.style}  quality ${s.quality}  vel ${s.res.vel}²  scalars ${s.res.scalars}²\n` +
    `volume ${s.res.volume.join('×')}  embers ${s.res.embers}  jacobi ${s.res.jacobi}  ${s.res.hz} Hz\n` +
    `cpu sim ${s.simMs} ms  cpu pass ${s.renderMs} ms\n` +
    `gpu sim ${s.gpuSimMs ?? 'n/a'} ms  gpu pass ${s.gpuRenderMs ?? 'n/a'} ms\n` +
    `steps ${s.steps}  read-back age ${s.readbackAgeFrames} frames  ready ${fluid.fire.ready}\n` +
    `jet ${s.jetParticles}  wind ${wind.x.toFixed(1)},${wind.z.toFixed(1)}  nearCam ${FIRELIGHT.nearCamera.r.toFixed(2)}`;
  if (gridCv.style.display === 'block') {
    const g = fluid.debug.grid;
    for (let j = 0; j < 64; j++) for (let i = 0; i < 64; i++) {
      const k = (j * 64 + i) * 4, o = ((j) * 64 + i) * 4;
      gimg.data[o] = g[k]; gimg.data[o + 1] = g[k + 2] * 0.5; gimg.data[o + 2] = g[k + 1]; gimg.data[o + 3] = 255;
    }
    gctx.putImageData(gimg, 0, 0);
  }
}
let last = performance.now(), auto = qs.get('auto') !== '0';
function loop(now) {
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  if (auto) frame(dt, null);
  drawHud(dt * 1000);
  requestAnimationFrame(loop);
}

// ------------------------------------------------------------------------------------------------ scripted scenarios (captures, perf)
const SCEN = {
  /** M1: the Lance sweeps along the road column east of the spawn; a bomb further up; burning goblins; a light wind. */
  m1: { view: 'm1', wind: [1.4, 300], setup() { bomb(new THREE.Vector3(17, 0, 6)); burningGoblins = true; troughs(); ops.push({ kind: FIRE_OP.FUEL, x: 13, z: 3.5, r: 2.5, amount: 1 }); },
    tick(dt, t) { const a = -0.32 + Math.sin(t * 0.9) * 0.12; const target = new THREE.Vector3(3 + Math.cos(a) * 9.5, 0, 5 + Math.sin(a) * 9.5); lance(true, target); } },
  /** M2: both troughs burning along the wall, burning goblins at the gate, the Lance from the wall walk into the plaza. */
  m2: { view: 'm2', wind: [1.0, 260], setup() { troughs(); burningGoblins = true; bomb(new THREE.Vector3(1, 0, 4)); },
    tick(dt, t) { const a = Math.sin(t * 0.8) * 0.5; lance(true, new THREE.Vector3(-0.5 + a * 3, 0, 5.5 + a)); } },
  /** perf: the busiest fire the bench can make: troughs + the Lance + bombs + burning goblins (M1 view). */
  busy: { view: 'm1', wind: [1.4, 300], setup() { troughs(); burningGoblins = true; bomb(new THREE.Vector3(14, 0, 6)); bomb(new THREE.Vector3(8, 0, 3)); bomb(new THREE.Vector3(20, 0, 14)); },
    tick(dt, t) { const a = Math.sin(t * 0.9) * 0.15; lance(true, new THREE.Vector3(3 + Math.cos(a) * 10, 0, 5 + Math.sin(a) * 10)); } },
};
// each hue next to orange (same source, orange left, hue right), and every hue at once with the Lance.
// Spots per framing: m1 looks north-east from the spawn along the road, m2 down from the wall walk into the plaza.
// (orange on the left of the frame, the hue on the right, both ≈ 6–10 m away; the stand-in goblin cards hidden)
// m2 = the bench's M2 key-art vantage `m2b` (over the parapet: the bench's `m2` sees only far ground beyond it)
const PAIR_AT = { m1: [new THREE.Vector3(8.5, 0, 1.6), new THREE.Vector3(8.5, 0, 9.4)], m2: [new THREE.Vector3(3.6, 0, 5.0), new THREE.Vector3(-0.4, 0, 9.6)] };
for (const hue of ['violet', 'blue', 'green', 'lilac']) for (const v of ['m1', 'm2']) {
  SCEN[`pair_${hue}_${v}`] = { view: v === 'm2' ? 'm2b' : v, wind: [0.5, 300], setup() { gobMesh.forEach((m) => { m.visible = false; }); const [a, b] = PAIR_AT[v]; pair(hue, a, b); }, tick() {} };
}
SCEN.hues_m1 = { view: 'm1', wind: [1.0, 300], setup() { burningGoblins = false; nova(new THREE.Vector3(18, 0, 10)); meteor(new THREE.Vector3(11, 0, 10)); orbit(new THREE.Vector3(6, 0, 6), 'blue', 6); trail(new THREE.Vector3(14, 0, 4), 'lilac', { x: 7, z: 2.5 }); },
  tick(dt, t) { const a = -0.32 + Math.sin(t * 0.9) * 0.12; lance(true, new THREE.Vector3(3 + Math.cos(a) * 9.5, 0, 5 + Math.sin(a) * 9.5)); } };
SCEN.witch_m1 = { ...SCEN.m1, setup() { lanceHue = 'green'; SCEN.m1.setup(); } };
SCEN.douse_m1 = { view: 'm1', wind: [0.6, 300], setup() { bomb(new THREE.Vector3(12, 0, 6)); bomb(new THREE.Vector3(17, 0, 8), 'violet'); },
  tick(dt, t) { if (Math.abs(t - 2.0) < dt * 0.5) { ops.push({ kind: FIRE_OP.DOUSE, x: 12, z: 6, r: 2.5 }, { kind: FIRE_OP.DOUSE, x: 17, z: 8, r: 2.5 }); } } };
SCEN.m1rain = { ...SCEN.m1, setup() { rain = 1; fluid.setRain(1); SCEN.m1.setup(); } };
SCEN.m1dry = { ...SCEN.m1, setup() { rain = 0; fluid.setRain(0); SCEN.m1.setup(); } };
SCEN.tide_m1 = { view: 'm1', wind: [0.6, 300], setup() { troughs(); bomb(new THREE.Vector3(10, 0, 6)); bomb(new THREE.Vector3(15, 0, 9)); bomb(new THREE.Vector3(7, 0, 9)); },
  tick(dt, t) { if (Math.abs(t - 2.0) < dt * 0.5) tide(new THREE.Vector3(10, 0, 7)); } };
SCEN.whirl_m1 = { view: 'whirl', wind: [0.4, 300], setup() { gobMesh.forEach((m) => { m.visible = false; }); for (const [x, z] of [[8, 4], [12, 9], [14, 4], [9, 9.5], [13, 6.5]]) bomb(new THREE.Vector3(x, 0, z)); whirl(new THREE.Vector3(11, 0, 6.5), 9); }, tick() {} };
SCEN.pillar_end = { view: 'end', wind: [0.6, 300], setup() { troughs(); pillar(); }, tick() {} };
SCEN.demon_end = { view: 'demon', wind: [0.6, 300], setup() { gobMesh.forEach((m) => { m.visible = false; }); demon(); pillar(); }, tick() {} };
let scen = null;
const lanceCam = new THREE.PerspectiveCamera();   // the player's camera in a scenario (the render camera may be a debug view)
function scenario(name) {
  const s = SCEN[name]; if (!s) return false;
  scen = s;
  setView(s.view); lanceCam.position.copy(camera.position); lanceCam.quaternion.copy(camera.quaternion); lanceCam.updateMatrixWorld();
  setView(qs.get('view') || s.view);
  windEl.value = String(s.wind[0]); wdirEl.value = String(s.wind[1]); readWind();
  s.setup();
  return true;
}
/** Advance the sim by `seconds` with a fixed dt, rendering each frame (no rAF). */
function advance(seconds, dt = 1 / 60) {
  const n = Math.round(seconds / dt);
  for (let i = 0; i < n; i++) frame(dt, scen ? scen.tick : null);
}
async function settle(frames = 3) { for (let i = 0; i < frames; i++) await new Promise((r) => requestAnimationFrame(r)); }
/** Throughput timing: N frames back to back, a 1-pixel readPixels to sync before and after. */
function measure({ frames = 120, withFluid = true, mode = 'both' } = {}) {
  fluidMode = mode;
  const gl = renderer.getContext(), px = new Uint8Array(4);
  const sync = () => { renderer.setRenderTarget(null); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); };
  const prev = fluidOn; fluidOn = withFluid;
  for (let i = 0; i < 10; i++) frame(1 / 60, scen ? scen.tick : null);
  sync();
  const t0 = performance.now();
  for (let i = 0; i < frames; i++) frame(1 / 60, scen ? scen.tick : null);
  sync();
  const ms = (performance.now() - t0) / frames;
  fluidOn = prev; fluidMode = 'both';
  return { mode, msPerFrame: +ms.toFixed(3), frames, withFluid, w: W, h: H, stats: fluid.stats() };
}
// ------------------------------------------------------------------------------------------------ proxy-target experiments
// Synthetic setups stepped at 60 Hz with no wind; the 64² summary is read back synchronously (bench only) every 0.25 s.
const BURN_T = 0.22;
function probe() {
  const buf = new Uint8Array(64 * 64 * 4);
  renderer.readRenderTargetPixels(fluid.debug.solver.summaryRT, 0, 0, 64, 64, buf);
  return buf;
}
function cellXZ(i, j) { return [ARENA.fluid.x0 + i + 0.5, ARENA.fluid.z0 + j + 0.5]; }
function measureGrid(buf) {
  let area = 0, x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9, hmax = 0, fuel = 0;
  for (let j = 0; j < 64; j++) for (let i = 0; i < 64; i++) {
    const k = (j * 64 + i) * 4, h = buf[k] / 255; fuel += buf[k + 1] / 255; hmax = Math.max(hmax, h);
    if (h >= BURN_T) { area++; const [x, z] = cellXZ(i, j); x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
  }
  return { area, hmax: +hmax.toFixed(2), fuel: +fuel.toFixed(2), bbox: area ? [x0, z0, x1, z1] : null };
}
function heatAt(buf, x, z) { const i = Math.floor(x - ARENA.fluid.x0), j = Math.floor(z - ARENA.fluid.z0); return buf[(j * 64 + i) * 4] / 255; }
function experiment(name, knobs = null) {
  const saved = { K: { ...KNOBS }, D: JSON.parse(JSON.stringify(DEPOSIT)) };
  fluid.setRain(knobs?.rain ?? 0);   // { rain: 1 } measures the quench (proxy targets)
  if (knobs) { for (const [k, v] of Object.entries(knobs)) { if (k === 'rain') continue; if (k.includes('.')) { const [a, b] = k.split('.'); DEPOSIT[a][b] = v; } else KNOBS[k] = v; } }
  try { return experimentRun(name); } finally { fluid.setRain(rain); Object.assign(KNOBS, saved.K); for (const a of Object.keys(saved.D)) Object.assign(DEPOSIT[a], saved.D[a]); }
}
function experimentRun(name) {
  fluid.debug.reset();
  const W0 = { x: 0, z: 0 }, dt = 1 / 60, out = { name, samples: [] };
  const run = (seconds, opsFn, sampleFn) => {
    const n = Math.round(seconds / dt);
    for (let f = 0; f < n; f++) {
      const t = f * dt, o = opsFn ? opsFn(t) : [];
      fluid.events(o, W0); fluid.update(dt);
      if (f % 15 === 14) sampleFn(t + dt, probe());
    }
  };
  if (name === 'lance1s') {
    // the game's stream ops: the jet lands 8 m east of the spawn, op segment 1.8 m along the aim, radius 0.9, push 7 m/s
    let burnOut = null;
    run(10, (t) => t < 1 ? [{ kind: FIRE_OP.STREAM, x0: 11, z0: 5, x1: 12.8, z1: 5, vx: 7, vz: 0, amount: 1, radius: 0.9 }] : [],
      (t, b) => { const m = measureGrid(b); out.samples.push({ t: +t.toFixed(2), ...m }); if (t > 1 && m.area === 0 && burnOut == null) burnOut = t; });
    out.burnOut = burnOut;
  } else if (name === 'firebomb') {
    let burnOut = null;
    run(16, (t) => t === 0 ? [{ kind: FIRE_OP.BURST, x: 10, z: 5, r: 3.5, amount: 1, push: 6 }, { kind: FIRE_OP.FUEL, x: 10, z: 5, r: 2.5, amount: 0.7 }] : [],
      (t, b) => { const m = measureGrid(b); out.samples.push({ t: +t.toFixed(2), ...m }); if (m.area === 0 && burnOut == null && t > 0.5) burnOut = t; });
    out.burnOut = burnOut;
  } else if (name === 'trough') {
    // trough-e (x 3.2..15) filled, lit by one ember at its west end; how fast the fire runs along it, how long it burns
    const T = ARENA.oil.troughs[1];
    let reachFar = null, burnOut = null;
    run(30, (t) => t === 0 ? [{ kind: FIRE_OP.FUEL, box: { x0: T.x0, z0: T.z0, x1: T.x1, z1: T.z1 }, amount: 1 }] : (Math.abs(t - 0.5) < 1e-6 ? [{ kind: FIRE_OP.EMBER, x: T.x0 + 0.4, z: (T.z0 + T.z1) / 2, amount: 1 }] : []),
      (t, b) => {
        const m = measureGrid(b), far = heatAt(b, T.x1 - 0.5, (T.z0 + T.z1) / 2);
        out.samples.push({ t: +t.toFixed(2), ...m, farHeat: +far.toFixed(2) });
        if (far >= BURN_T && reachFar == null) reachFar = t;
        if (t > 2 && m.area === 0 && burnOut == null) burnOut = t;
      });
    out.lengthM = +(T.x1 - T.x0).toFixed(1); out.reachFar = reachFar; out.speed = reachFar ? +((T.x1 - T.x0 - 0.9) / (reachFar - 0.5)).toFixed(2) : null; out.burnOut = burnOut;
  } else if (name === 'pool') {
    // a barrel splash (fuel r 2.5, amount 1) on the plaza, lit at its west rim: time for the fire to cross 5 m
    let cross = null, burnOut = null;
    run(30, (t) => t === 0 ? [{ kind: FIRE_OP.FUEL, x: 10, z: 5, r: 2.5, amount: 1 }] : (Math.abs(t - 0.5) < 1e-6 ? [{ kind: FIRE_OP.EMBER, x: 7.6, z: 5, amount: 1 }] : []),
      (t, b) => {
        const m = measureGrid(b), east = heatAt(b, 12.4, 5);
        out.samples.push({ t: +t.toFixed(2), ...m, eastHeat: +east.toFixed(2) });
        if (east >= BURN_T && cross == null) cross = t;
        if (t > 2 && m.area === 0 && burnOut == null) burnOut = t;
      });
    out.cross = cross; out.speed = cross ? +(4.8 / (cross - 0.5)).toFixed(2) : null; out.burnOut = burnOut;
  } else if (name === 'edge') {
    // a burning trough at steady state (fuel + ember ops every 0.3 s like the sim's lit trough): heat vs distance from its rim
    const T = ARENA.oil.troughs[1];
    const profile = [];
    run(6, (t) => {
      const o = t === 0 ? [{ kind: FIRE_OP.FUEL, box: { x0: T.x0, z0: T.z0, x1: T.x1, z1: T.z1 }, amount: 1 }] : [];
      if (Math.abs((t / 0.3) - Math.round(t / 0.3)) < 1e-6) for (let i = 0; i < 6; i++) o.push({ kind: FIRE_OP.EMBER, x: T.x0 + (i + 0.5) * (T.x1 - T.x0) / 6, z: (T.z0 + T.z1) / 2, amount: 1 });
      return o;
    }, (t, b) => { if (t > 5.7) for (const d of [0, 0.5, 1, 1.5, 2, 3, 4]) profile.push({ d, heat: +heatAt(b, 9, T.z1 + d).toFixed(2) }); });
    out.profile = profile;
  }
  fluid.debug.reset();
  return out;
}

window.__fluidBench = {
  experiment,
  ready: true, renderer, fluid, setView, scenario, advance, settle, measure,
  setStyle(s) { style = s; fluid.setStyle(s); }, setQuality(q) { fluid.setQuality(q); },
  nova, orbit, meteor, trail, pair, setLanceHue(h) { lanceHue = h; }, ops, tide, whirl, pillar, demon, setRain(x) { rain = x; fluid.setRain(x); },
  setAuto(on) { auto = !!on; }, stats: () => ({ ...fluid.stats(), warmMs: +warmMs.toFixed(1) }), info: () => ({ ext: renderer.getContext().getSupportedExtensions(), gl: renderer.getContext().getParameter(renderer.getContext().VERSION) }),
  renderOnce() { render(fluidOn); },
};
if (qs.get('scenario')) { scenario(qs.get('scenario')); auto = false; advance(+(qs.get('t') || 4)); render(true); }
requestAnimationFrame(loop);
