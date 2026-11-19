// pres bench: the HUD, cards, menus, end cards, FX and cinema paths over a plain greybox of ARENA with a fake ticking
// state. Run from the game root: `npx vite --config vite.config.js --port 5356 --strictPort`, open /preview/pres.html.
// URL: ?scn=<scenario> (see SCENARIOS), ?frozen=1 (time only
// moves through __pres.advance), ?nobench=1 (hide the button panel), ?quality=high|medium|low.
// Hook for tools: window.__pres = { ready, list(), setup(name), advance(seconds), ev(type, payload), state, ui, fx, cinema }.
import * as THREE from 'three';
import { EV } from '../src/shared/events.js';
import { ARENA, groundHeight, BODY } from '../src/shared/arena.js';
import { createUI } from '../src/ui/index.js';
import { createFx } from '../src/fx/index.js';
import { createCinema } from '../src/cinema/index.js';
import { UPGRADES, upgradeCost, TOWERS, freshSave } from '../src/shared/meta.js';
import { CARD_BY_ID } from '../src/sim/cards.js';
import { TIMELINE } from '../src/shared/timeline.js';
import { setGfx } from '../src/gfx/current.js';
import * as webgl2 from '../src/gfx/webgl2/index.js';

// the modules' per-edition shading (decision 0001): this bench runs the webgl2 edition's layer
setGfx(webgl2);

const Q = new URLSearchParams(location.search);
let frozen = Q.get('frozen') === '1';
const quality = Q.get('quality') || 'high';
if (Q.get('nobench') === '1') document.getElementById('bench').classList.add('hide');

// ------------------------------------------------------------------------------------------------ renderer + greybox
const renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
document.getElementById('world').appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color('#184255');
scene.fog = new THREE.Fog('#2c5168', 30, 150);
const camera = new THREE.PerspectiveCamera(78, innerWidth / innerHeight, 0.05, 600);
scene.add(new THREE.HemisphereLight('#4a8aa0', '#1a2224', 1.6));
const moon = new THREE.DirectionalLight('#9fd3e0', 1.6);
moon.position.set(ARENA.moonDir.x * 100, ARENA.moonDir.y * 100, ARENA.moonDir.z * 100);
scene.add(moon);
const fireLight = new THREE.PointLight('#ff9a4a', 30, 30, 1.6);
fireLight.position.set(ARENA.beacon.basket.x, ARENA.beacon.basket.y + 0.6, ARENA.beacon.basket.z);
scene.add(fireLight);
{ // ground
  const t = ARENA.terrain, geo = new THREE.PlaneGeometry(t.x1 - t.x0, t.z1 - t.z0, 90, 100);
  geo.rotateX(-Math.PI / 2);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) { const x = p.getX(i) + (t.x0 + t.x1) / 2, z = p.getZ(i) + (t.z0 + t.z1) / 2; p.setXYZ(i, x, groundHeight(x, z), z); }
  geo.computeVertexNormals();
  scene.add(new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: '#4a4436' })));
  const road = new THREE.MeshLambertMaterial({ color: '#5b4a38' });
  const pts = ARENA.road.points;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1], len = Math.hypot(bx - ax, bz - az);
    const m = new THREE.Mesh(new THREE.BoxGeometry(ARENA.road.width, 0.1, len), road);
    m.position.set((ax + bx) / 2, groundHeight((ax + bx) / 2, (az + bz) / 2) + 0.03, (az + bz) / 2);
    m.rotation.y = Math.atan2(bx - ax, bz - az);
    scene.add(m);
  }
}
const stone = new THREE.MeshLambertMaterial({ color: '#56626c' });
const wood = new THREE.MeshLambertMaterial({ color: '#5a3e28' });
const box = (x0, x1, y0, y1, z0, z1, mat) => { const m = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), mat); m.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2); scene.add(m); return m; };
{ const k = ARENA.keep;
  box(k.x0, k.x1, 0, k.wallHeight, k.z1 - k.wallThick, k.z1, stone); box(k.x0, k.x1, 0, k.wallHeight, k.z0, k.z0 + k.wallThick, stone);
  box(k.x0, k.x0 + k.wallThick, 0, k.wallHeight, k.z0, k.z1, stone); box(k.x1 - k.wallThick, k.x1, 0, k.wallHeight, k.z0, k.z1, stone);
  for (const t of k.towers) box(t.x - t.half, t.x + t.half, 0, t.height, t.z - t.half, t.z + t.half, stone);
  const g = ARENA.gate; box(g.x0, g.x1, 0, g.height, g.z - 0.2, g.z + 0.35, wood);
  const s = ARENA.stair; const st = box(s.x0, s.x1, 0, 0.3, s.zTop, s.zBottom, wood); st.rotation.x = Math.atan2(s.yTop, s.zBottom - s.zTop); st.position.y = s.yTop / 2;
  for (const tr of ARENA.oil.troughs) box(tr.x0, tr.x1, 0, 0.35, tr.z0, tr.z1, new THREE.MeshLambertMaterial({ color: '#3d3a33' }));
  const b = ARENA.beacon.basket; const bk = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 0.7, 1.0, 8), new THREE.MeshLambertMaterial({ color: '#2a2a2a', emissive: '#ff7a2a', emissiveIntensity: 0.6 })); bk.position.set(b.x, b.y, b.z); scene.add(bk);
  for (const [x, z] of ARENA.braziers) { const m = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.25, 0.9, 6), new THREE.MeshLambertMaterial({ color: '#2a2a2a', emissive: '#ff8a3a', emissiveIntensity: 0.8 })); m.position.set(x, 0.9, z); scene.add(m); }
}
// goblin stand-ins (targets for the shots) and the troll stand-in
const dummies = [];
const gobMat = new THREE.MeshLambertMaterial({ color: '#6f7a3a' });
for (let i = 0; i < 14; i++) {
  const x = 9 + (i % 7) * 2.1, z = 3 + Math.floor(i / 7) * 2.4 + (i % 2) * 0.6;
  const m = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.1, 0.25), gobMat); m.position.set(x, groundHeight(x, z) + 0.55, z); m.userData.id = i; scene.add(m); dummies.push(m);
}
const trollMesh = new THREE.Mesh(new THREE.BoxGeometry(3, 7, 1.5), new THREE.MeshLambertMaterial({ color: '#6a6660' }));
trollMesh.visible = false; scene.add(trollMesh);
const eliteMesh = { chief: new THREE.Mesh(new THREE.BoxGeometry(1.0, 1.9, 0.4), new THREE.MeshLambertMaterial({ color: '#7d6a3a' })), hexer: new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.4, 0.3), new THREE.MeshLambertMaterial({ color: '#4f6a3a' })) };
for (const m of Object.values(eliteMesh)) { m.visible = false; scene.add(m); }
const towerMesh = { obelisk: new THREE.Mesh(new THREE.BoxGeometry(0.9, 4.2, 0.9), new THREE.MeshLambertMaterial({ color: '#141418', emissive: '#7a3ad6', emissiveIntensity: 0.35 })), chainimp: new THREE.Mesh(new THREE.BoxGeometry(0.5, 2.0, 0.5), new THREE.MeshLambertMaterial({ color: '#3a3430' })) };
for (const m of Object.values(towerMesh)) { m.visible = false; scene.add(m); }
// DESIGN §8 stand-ins (bench only): the demon on the wall walk, the portal over the keep, the burning village, Brother Cinder
const endGroup = new THREE.Group(); endGroup.visible = false; scene.add(endGroup);
{ const demonMat = new THREE.MeshLambertMaterial({ color: '#2a0806', emissive: '#a3241a', emissiveIntensity: 0.35 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.8, 4.6, 1.0), demonMat); body.position.set(2, 5 + 2.3, -1.5); endGroup.add(body);
  for (const sx of [-0.55, 0.55]) { const horn = new THREE.Mesh(new THREE.ConeGeometry(0.22, 1.1, 5), demonMat); horn.position.set(2 + sx, 5 + 5.0, -1.5); horn.rotation.z = -sx; endGroup.add(horn); }
  const portal = new THREE.Mesh(new THREE.TorusGeometry(12, 1.6, 8, 32), new THREE.MeshBasicMaterial({ color: '#ff5a1a' })); portal.position.set(0, 40, -16); portal.rotation.x = Math.PI / 2.4; endGroup.add(portal);
  const hutMat = new THREE.MeshLambertMaterial({ color: '#5a3a1a', emissive: '#ff7a2a', emissiveIntensity: 0.5 });
  for (let i = 0; i < 7; i++) { const hut = new THREE.Mesh(new THREE.ConeGeometry(2, 3, 8), hutMat); const x = 24 + (i % 4) * 4, z = 78 + Math.floor(i / 4) * 6; hut.position.set(x, groundHeight(x, z) + 1.5, z); endGroup.add(hut); }
  const cinder = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.8, 0.7), new THREE.MeshLambertMaterial({ color: '#3a2e26' })); cinder.position.set(2, 0.4, 1.8); endGroup.add(cinder); }
const padRings = ARENA.camp.pads.map((pd) => { const m = new THREE.Mesh(new THREE.RingGeometry(0.8, 1.0, 24), new THREE.MeshBasicMaterial({ color: '#58c8d4', side: THREE.DoubleSide })); m.rotation.x = -Math.PI / 2; m.position.set(pd.x, groundHeight(pd.x, pd.z) + 0.05, pd.z); scene.add(m); return m; });
const npcMesh = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.2, 0.5), new THREE.MeshLambertMaterial({ color: '#3a2e26', emissive: '#ff8a3a', emissiveIntensity: 0.08 }));
npcMesh.position.set(ARENA.camp.npc.x, groundHeight(ARENA.camp.npc.x, ARENA.camp.npc.z) + 0.6, ARENA.camp.npc.z); scene.add(npcMesh); void padRings;

// ------------------------------------------------------------------------------------------------ fake state
function freshState() {
  return {
    t: 0, tick: 0, mode: 'play', modeT: 0, paused: false, seed: 1,
    night: { clock: 192, dawnAt: 300, kindle: 1, kindleCd: 0, waveN: 7 },
    player: { x: ARENA.playerSpawn.x, y: 0, z: ARENA.playerSpawn.z, yaw: ARENA.playerSpawn.yaw, pitch: -0.06, vx: 0, vy: 0, vz: 0, onGround: true,
      hp: 84, hpMax: 100, weapon: 'lance', ammo: { pistol: 6, blunderbuss: 4 }, fuel: 72, fuelMax: 100, reloadT: 0, firing: false,
      bombs: 2, bombsMax: 3, sunburst: 0.62, level: 4, xp: 66, xpNext: 100, magnet: 3, alive: true, unlocked: { blunderbuss: true } },
    gate: { hp: 840, hpMax: 1000 }, troll: null, horde: { count: 0 },
    pickups: Array.from({ length: 18 }, (_, i) => ({ id: i, kind: i === 3 ? 'gold' : 'xp', x: 5 + (i % 6) * 1.3, y: 0.2, z: 3.4 + Math.floor(i / 6) * 1.4, value: 1 })),
    bombs: [], spears: [], boulders: [], troughs: [], barrels: [], wind: { x: 0.6, z: -0.2 }, fireOps: [], cards: null,
    stats: { kills: 1342, burned: 871, shots: 420, timeAlive: 301, level: 9, gateLost: 160, gold: 85 },
    // DESIGN §9: a mid save, the run's gold and towers, elites, the orbit
    save: Object.assign(freshSave(), { gold: 640, runN: 2, nightsCompleted: 1, bestNight: 1,
      upgrades: { hide: 2, kestrel: 1, blunderbuss: 0, lance: 2, bombs: 0, gate: 1, slots: 0 },
      charms: { owned: ['ember-tooth', 'coin-hook', 'ashen-step', 'witchfire-wick'], equipped: ['coin-hook'] } }),
    run: { gold: 85 }, towers: [], elites: null, orbit: null, camp: null, taken: {}, air: null,
  };
}
let S = freshState();
let ticking = Q.get('tick') === '1';

// ------------------------------------------------------------------------------------------------ actors stub (muzzle)
const camQ = new THREE.Quaternion();
const actors = { sockets: { muzzle(out = new THREE.Vector3()) { camera.getWorldQuaternion(camQ); return out.set(0.16, -0.17, -0.55).applyQuaternion(camQ).add(camera.position); } } };

// ------------------------------------------------------------------------------------------------ modules
let fireStyle = 'hybrid';
// the bench plays the sim for the panels' actions (buy / equip / build / upgrade) on the fake state
function benchAction(a, d) {
  log(`ui action ${a}${d ? ' ' + JSON.stringify(d) : ''}`);
  const sv = S.save;
  if (a === 'buy') { const u = UPGRADES.find((x) => x.id === d.item), lv = sv.upgrades[d.item] | 0, c = upgradeCost(u, lv); if (lv < u.max && sv.gold >= c) { sv.gold -= c; sv.upgrades[d.item] = lv + 1; emit(EV.BUY, { item: d.item, level: lv + 1, cost: c, goldLeft: sv.gold }); } }
  if (a === 'equip') { const eq = sv.charms.equipped; if (d.on && !eq.includes(d.charm)) eq.push(d.charm); if (!d.on) sv.charms.equipped = eq.filter((x) => x !== d.charm); emit(EV.CHARM_EQUIP, { charm: d.charm, on: d.on, slot: 0 }); }
  if (a === 'build') { const c = TOWERS[d.type].cost[0]; if (sv.gold >= c) { sv.gold -= c; S.towers.push({ pad: d.pad, type: d.type, level: 1 }); emit(EV.TOWER_BUILD, { pad: d.pad, tower: d.type, level: 1, cost: c }); } }
  if (a === 'buyOrgan' && sv.gold >= 100000) { sv.gold -= 100000; sv.organ = { owned: true, equipped: true }; emit('organ.buy', {}); }
  if (a === 'equipOrgan' && sv.organ?.owned) { sv.organ.equipped = d.on !== false; emit('organ.equip', { on: sv.organ.equipped }); }
  if (a === 'upgrade') { const t = S.towers.find((x) => x.pad === d.pad); if (t && t.level < 3) { const c = TOWERS[t.type].cost[t.level]; if (sv.gold >= c) { sv.gold -= c; t.level++; emit(EV.TOWER_UPGRADE, { pad: d.pad, tower: t.type, level: t.level, cost: c }); } } }
}
const ui = createUI({ root: document.getElementById('ui'), assetsBase: '/assets/', cardDefs: CARD_BY_ID, onAction: (a, d) => benchAction(a, d), onFireStyle: (s) => { fireStyle = s; log('fire style → ' + s); } });
const fx = createFx({ scene, camera, quality, actors });
const look = { setDawn(x) { scene.background.set('#184255').lerp(new THREE.Color('#e7a77a'), x * 0.75); scene.fog.color.set('#2c5168').lerp(new THREE.Color('#c99a80'), x * 0.6); moon.color.set('#9fd3e0').lerp(new THREE.Color('#ffd6a0'), x); } };
const env = { setDawn() {}, beaconFlicker() { fireLight.intensity = 90; setTimeout(() => { fireLight.intensity = 30; }, 250); } };
const cinema = createCinema({ camera, actors, env, look, ui, audio: null });
const statEl = document.getElementById('stat');
const logs = [];
function log(s) { logs.push(s); if (logs.length > 6) logs.shift(); }

// ------------------------------------------------------------------------------------------------ events
const tmpV = new THREE.Vector3(), ray = new THREE.Raycaster();
function emit(type, payload = {}) { const ev = { type, t: S.t, ...payload }; ui.onEvent(ev, S); fx.onEvent(ev, S); return ev; }
function fire(weapon = S.player.weapon) {
  const origin = camera.position.clone(); const dir = new THREE.Vector3(); camera.getWorldDirection(dir);
  const n = weapon === 'blunderbuss' ? 10 : 1, spread = weapon === 'blunderbuss' ? 0.08 : 0.01;
  const pellets = [];
  for (let i = 0; i < n; i++) {
    const d = dir.clone().add(new THREE.Vector3((Math.random() - 0.5) * spread * 2, (Math.random() - 0.5) * spread * 2, (Math.random() - 0.5) * spread * 2)).normalize();
    ray.set(origin, d); ray.far = 60;
    const hits = ray.intersectObjects([...dummies, ...scene.children.filter((c) => c.isMesh && !dummies.includes(c))], false);
    const h = hits[0];
    const to = h ? h.point : origin.clone().addScaledVector(d, 40);
    const hitId = h && dummies.includes(h.object) ? h.object.userData.id : null;
    pellets.push({ to: { x: to.x, y: to.y, z: to.z }, hitId });
  }
  emit(EV.SHOT, { weapon, origin: { x: origin.x, y: origin.y, z: origin.z }, dir: { x: dir.x, y: dir.y, z: dir.z }, pellets });
  for (const p of pellets) if (p.hitId != null) { const crit = Math.random() < 0.2; emit(EV.E_HIT, { id: p.hitId, kind: 'grunt', pos: { x: p.to.x, y: p.to.y - 0.3, z: p.to.z }, dmg: weapon === 'blunderbuss' ? 9 : crit ? 54 : 18, source: 'bullet', crit }); }
  if (weapon !== 'lance') S.player.ammo[weapon] = Math.max(0, (S.player.ammo[weapon] ?? 8) - 1);
}
const roadPt = (x, z, dy = 0) => ({ x, y: groundHeight(x, z) + dy, z });

const B = {
  'shot pistol': () => { S.player.weapon = 'pistol'; fire('pistol'); },
  'shot blunderbuss': () => { S.player.weapon = 'blunderbuss'; fire('blunderbuss'); },
  'volley ×6': () => { S.player.weapon = 'pistol'; for (let i = 0; i < 6; i++) setTimeout(() => fire('pistol'), i * 120); },
  'hit crit': () => emit(EV.E_HIT, { id: 1, kind: 'grunt', pos: roadPt(12, 4.5, 0), dmg: 54, source: 'bullet', crit: true }),
  'deaths ×8': () => { for (let i = 0; i < 8; i++) emit(EV.E_DEATH, { id: i, kind: i % 3 ? 'grunt' : 'imp', pos: roadPt(10 + i * 1.2, 4 + (i % 3)), burned: i % 2 === 0 }); },
  'ignite ×5': () => { for (let i = 0; i < 5; i++) emit(EV.E_IGNITE, { id: i, kind: 'grunt', pos: roadPt(11 + i, 5) }); },
  'firebomb': () => emit(EV.BOMB_BURST, { id: 1, pos: roadPt(14, 5), r: 3.5 }),
  'barrel': () => emit(EV.BARREL_BURST, { idx: 0, pos: roadPt(8, 14) }),
  'sunburst': () => emit(EV.SUNBURST, { pos: { x: S.player.x, y: 0, z: S.player.z }, r: 14 }),
  'pickup xp': () => emit(EV.PICKUP, { kind: 'xp', value: 1, pos: roadPt(6, 5, 0.2) }),
  'pickup gold': () => emit(EV.PICKUP, { kind: 'gold', value: 10, pos: roadPt(6, 5, 0.2) }),
  'pickup heart': () => emit(EV.PICKUP, { kind: 'heart', value: 20, pos: roadPt(6, 5, 0.2) }),
  'level up': () => { S.player.level++; emit(EV.LEVEL_UP, { level: S.player.level, cards: ['blunderbuss', 'pitch', 'mason'] }); S.mode = 'cards'; ui.cards(['blunderbuss', 'pitch', 'mason']).then((id) => { log('picked ' + id); S.mode = 'play'; emit(EV.CARD_PICK, { cardId: id, level: S.player.level }); }); },
  'kindle': () => { S.night.kindle++; S.night.kindleCd = 45; S.player.fuel = S.player.fuelMax; emit(EV.KINDLE, { level: S.night.kindle }); emit(EV.WAVE, { n: 8, size: 300, kindled: true }); },
  'beacon ready': () => { S.night.kindleCd = 0; emit(EV.BEACON_READY, {}); },
  'wave': () => emit(EV.WAVE, { n: (S.night.waveN = (S.night.waveN || 1) + 1), size: 120, kindled: false }),
  'troll arrive': () => { trollOn(); emit(EV.T_ARRIVE, { pos: { x: S.troll.x, y: S.troll.y, z: S.troll.z } }); cinema.play('troll', S); },
  'troll glow': () => { if (!S.troll) trollOn(); S.troll.glowing = !S.troll.glowing; emit(EV.T_GLOW, { on: S.troll.glowing, heat: 1 }); },
  'troll hurt': () => { if (!S.troll) trollOn(); const d = S.troll.glowing ? 162 : 54; S.troll.hp = Math.max(1, S.troll.hp - d); emit(EV.T_HURT, { pos: { x: S.troll.x, y: S.troll.y + 4.5, z: S.troll.z }, dmg: d, hpFrac: S.troll.hp / S.troll.hpMax, glowing: S.troll.glowing }); },
  'troll stomp': () => { if (!S.troll) trollOn(); emit(EV.T_STOMP, { pos: { x: S.troll.x, y: S.troll.y, z: S.troll.z }, r: 5 }); },
  'boulder lands': () => emit(EV.T_BOULDER, { pos: roadPt(13, 6), r: 2.5 }),
  'troll smash gate': () => emit(EV.T_SMASH, { pos: { x: 0, y: 2, z: 0.6 }, target: 'gate' }),
  'troll death': () => { if (!S.troll) trollOn(); emit(EV.T_DEATH, { pos: { x: S.troll.x, y: S.troll.y, z: S.troll.z } }); S.troll = null; trollMesh.visible = false; },
  'gate hit': () => { S.gate.hp = Math.max(0, S.gate.hp - 60); emit(EV.GATE_HIT, { pos: { x: (Math.random() - 0.5) * 4, y: 1.5, z: 0.5 }, dmg: 60, hpFrac: S.gate.hp / S.gate.hpMax }); },
  'gate breach': () => emit(EV.GATE_BREACH, {}),
  'trough lit': () => emit(EV.TROUGH_LIT, { id: 'trough-e' }),
  'hurt': () => { S.player.hp = Math.max(1, S.player.hp - 12); emit(EV.P_HURT, { pos: S.player, dmg: 12, source: 'melee', dir: { x: 1, z: 0 } }); },
  'heal': () => { S.player.hp = Math.min(S.player.hpMax, S.player.hp + 30); emit(EV.P_HEAL, { amount: 30 }); },
  'weapon ↻': () => { const w = ['pistol', 'blunderbuss', 'lance']; S.player.weapon = w[(w.indexOf(S.player.weapon) + 1) % 3]; emit(EV.WEAPON_SWITCH, { weapon: S.player.weapon }); },
  'reload': () => { const w = S.player.weapon === 'lance' ? 'pistol' : S.player.weapon; S.player.weapon = w; S.player.reloadT = w === 'blunderbuss' ? 1.6 : 1.2; emit(EV.RELOAD, { weapon: w, seconds: S.player.reloadT }); },
  'lance spray': () => { S.player.weapon = 'lance'; S.player.firing = !S.player.firing; },
  'throw bomb': () => { S.player.bombs = Math.max(0, S.player.bombs - 1); emit(EV.BOMB_THROW, { id: 9, from: S.player, vel: { x: 1, y: 1, z: 0 }, fuse: 1 }); },
  'spears': () => { S.spears = [0, 1, 2].map((i) => ({ id: i, x: 18 + i, y: 1.6, z: 8 + i * 2, vx: -12, vy: 2, vz: -4 })); },
  'card pick unlock': () => emit(EV.CARD_PICK, { cardId: 'blunderbuss', level: 5 }),
  'toast': () => ui.toast('THE HORDE SWELLS'),
  'subtitle': () => ui.subtitle('The beacon answers. Every goblin in the valley saw that.'),
};
const PANELS = {
  'cards': () => B['level up'](),
  'menu': () => ui.menu.open().then((r) => log('menu → ' + r)),
  'controls': () => ui.controls.open(),
  'card night': () => ui.card('night').then((r) => log('night → ' + r)),
  'card dawn': () => { S.mode = 'victory'; emit(EV.VICTORY, { stats: S.stats }); ui.card('dawn').then((r) => { log('dawn → ' + r); S.mode = 'play'; }); },
  'card fallen (gate)': () => { S.mode = 'fallen'; emit(EV.FALLEN, { cause: 'gate', stats: S.stats }); ui.card('fallen').then((r) => { log('fallen → ' + r); S.mode = 'play'; }); },
  'card fallen (you)': () => { S.mode = 'fallen'; const hp = S.player.hp; S.player.hp = 0; emit(EV.FALLEN, { cause: 'player', stats: S.stats }); ui.card('fallen').then((r) => { log('fallen → ' + r); S.player.hp = hp; S.mode = 'play'; }); },
  'near pan': () => { const p = ARENA.beacon.pan; Object.assign(S.player, { x: p.x - 1.0, y: p.y, z: p.z + 0.3, yaw: Math.PI / 2 + 0.3, pitch: 0.25 }); },
  'pan cooling': () => { S.night.kindleCd = 23; PANELS['near pan'](); },
  'clock +30s': () => { S.night.clock = Math.min(300, S.night.clock + 30); },
  'tick on/off': () => { ticking = !ticking; },
  'freeze on/off': () => { frozen = !frozen; },
  'noui': () => ui.setHidden(!ui.el.classList.contains('ew-noui')),
};
const CINEMA = {
  'intro': () => { S.mode = 'intro'; cinema.play('intro', S).then(() => { S.mode = 'play'; emit(EV.NIGHT_START, {}); }); },
  'skip': () => cinema.skip(),
  'troll': () => B['troll arrive'](),
  'dawn': () => { S.mode = 'victory'; emit(EV.DAWN, {}); cinema.play('dawn', S).then(() => PANELS['card dawn']()); },
  'fallen gate': () => { S.mode = 'fallen'; emit(EV.FALLEN, { cause: 'gate', stats: S.stats }); cinema.setCause('gate'); cinema.play('fallen', S).then(() => ui.card('fallen')); },
  'fallen you': () => { S.mode = 'fallen'; S.player.hp = 0; emit(EV.FALLEN, { cause: 'player', stats: S.stats }); cinema.setCause('player'); cinema.play('fallen', S).then(() => ui.card('fallen')); },
  'ending': () => { Object.assign(S.player, { x: 2, y: 5, z: -1.5, yaw: 0, pitch: 0 }); S.boss = { kind: 'rainmother', hp: 0, hpMax: 12000, x: 24, z: 40 }; S.save.ended = false; S.mode = 'ending'; S.modeT = 0; S.night.n = 10; S.ending = { cinder: { x: 2, z: 1.8 }, village: { x: 30, z: 81 }, portal: { x: 0, y: 40, z: -16 }, skippable: false }; emit('mode', { mode: 'ending', prev: 'play' }); cinema.onEvent({ type: 'mode', mode: 'ending', prev: 'play' }, S); },
  'retry': () => { const keep = S; S = freshState(); S.night.clock = 0; void keep; trollMesh.visible = false; look.setDawn(0); emit(EV.RETRY, {}); cinema.play('retry', S).then(() => log('retry done')); },
};
const VIEWS = {
  plaza: () => Object.assign(S.player, { x: ARENA.playerSpawn.x, y: 0, z: ARENA.playerSpawn.z, yaw: ARENA.playerSpawn.yaw, pitch: -0.06 }),
  road: () => Object.assign(S.player, { x: 6, y: 0, z: 5, yaw: 1.75, pitch: -0.12 }),
  gate: () => Object.assign(S.player, { x: 3, y: 0, z: 10, yaw: Math.PI + 0.25, pitch: 0.02 }),
  beacon: () => Object.assign(S.player, { x: 7, y: 0, z: 8, yaw: 2.3, pitch: 0.45 }),
  wall: () => Object.assign(S.player, { x: -6, y: 5, z: -1.4, yaw: 1.95, pitch: -0.32 }),
  troll: () => Object.assign(S.player, { x: 10, y: 0, z: 8, yaw: 0.55, pitch: 0.05 }),
};
function trollOn() {
  const x = 24, z = 26;
  S.troll = { x, y: groundHeight(x, z), z, yaw: Math.PI, hp: 1680, hpMax: 2400, heat: 0.4, glowing: false, action: 'walk', stage: 'arrive', actionT: 0, actionDur: 1 };
  trollMesh.position.set(x, S.troll.y + 3.5, z); trollMesh.visible = true;
}
function panel(title, obj) {
  const b = document.getElementById('bench');
  const h = document.createElement('h4'); h.textContent = title; b.appendChild(h);
  for (const [k, fn] of Object.entries(obj)) { const btn = document.createElement('button'); btn.textContent = k; btn.onclick = (e) => { e.stopPropagation(); fn(); btn.blur(); }; b.appendChild(btn); }
}
// ---- DESIGN §9: the camp, panels, cards, v2 FX
const padP = (id) => ARENA.camp.pads.find((p) => p.id === id);
const B2 = {
  'elites': () => { S.elites = [{ id: 100, kind: 'chief', ...roadPt(14, 9), hp: 150, hpMax: 220 }, { id: 101, kind: 'hexer', ...roadPt(19, 12), hp: 140, hpMax: 140 }]; },
  'obelisk pulse': () => { if (!S.towers.some((t) => t.type === 'obelisk')) S.towers.push({ pad: 'pad-gate-e', type: 'obelisk', level: 2 }); const pd = padP('pad-gate-e'); emit(EV.OBELISK_PULSE, { pad: 'pad-gate-e', pos: roadPt(pd.x, pd.z), r: 5.5, level: 2 }); },
  'chain': () => { if (!S.towers.some((t) => t.type === 'chainimp')) S.towers.push({ pad: 'pad-road', type: 'chainimp', level: 2 }); const pd = padP('pad-road'); emit(EV.CHAIN_THROW, { pad: 'pad-road', from: roadPt(pd.x, pd.z, 2.0), to: roadPt(12.3, 4.2), targetId: null }); setTimeout(() => emit(EV.CHAIN_HOOK, { pad: 'pad-road', targetId: null, pos: roadPt(12.3, 4.2), pull: 2.5 }), 200); },
  'orbit on/off': () => { S.orbitN = S.orbitN ? 0 : 3; if (!S.orbitN) S.orbit = null; },
  'orbit hit': () => emit(EV.ORBIT_HIT, { pos: roadPt(8, 5.8), id: 1 }),
  'meteor': () => emit(EV.METEOR, { from: roadPt(8, 18, 26), pos: roadPt(14, 6), r: 3, flight: 0.8 }),
  'trail': () => { for (let i = 0; i < 6; i++) setTimeout(() => emit(EV.TRAIL, { pos: roadPt(7 + i * 0.8, 3.6 + i * 0.25) }), i * 120); },
  'gold drop': () => emit(EV.GOLD_DROP, { pos: roadPt(11, 5), value: 3, n: 3 }),
  'xp drop': () => emit(EV.XP_DROP, { pos: roadPt(12.5, 4), value: 5, n: 4 }),
  'charm drop': () => emit(EV.CHARM_DROP, { pos: roadPt(11, 6), charm: 'cinder-ward' }),
  'charm pickup': () => emit(EV.CHARM_PICKUP, { charm: 'cinder-ward', dup: false, gold: 0 }),
  'douse': () => emit(EV.DOUSE_THROW, { id: 3, from: roadPt(17, 8), to: roadPt(12, 5), r: 2.5 }),
  'hex': () => emit(EV.HEX, { from: roadPt(18, 9), to: { x: S.player.x + 1.2, y: S.player.y, z: S.player.z + 2 }, hit: false }),
  'tower build': () => { S.towers.push({ pad: 'pad-gate-e', type: 'obelisk', level: 1 }); emit(EV.TOWER_BUILD, { pad: 'pad-gate-e', tower: 'obelisk', level: 1, cost: 140 }); },
  'elite spawn': () => { B2.elites(); emit(EV.ELITE_SPAWN, { id: 100, kind: 'chief', pos: S.elites[0] }); },
  'cards v2': () => { S.mode = 'cards'; ui.cards(['soul-feast', 'ember-orbit', 'brimstone']).then((id) => { log('picked ' + id); S.mode = 'play'; }); },
  'cards v2 b': () => { S.mode = 'cards'; ui.cards(['cinder-trail', 'hearthblood', 'bellows']).then((id) => { log('picked ' + id); S.mode = 'play'; }); },
};
const CAMP = {
  'camp mode': () => { S.mode = 'camp'; S.camp = { nextNight: 2 }; S.run.gold = 0; S.night.n = 1; look.setDawn(0.45); },
  'at Cinder': () => { CAMP['camp mode'](); Object.assign(S.player, { x: ARENA.camp.npc.x + 2.0, y: 0, z: ARENA.camp.npc.z - 0.2, yaw: -Math.PI / 2, pitch: -0.12 }); },
  'at a pad': () => { CAMP['camp mode'](); const pd = padP('pad-gate-w'); Object.assign(S.player, { x: pd.x + 0.3, y: 0, z: pd.z - 1.6, yaw: 0, pitch: -0.35 }); },
  'at the pan': () => { CAMP['camp mode'](); PANELS['near pan'](); },
  'npc panel': () => ui.panel('npc', S).then((r) => log('npc panel → ' + r)),
  'charms tab': () => { ui.panel('npc', S, { tab: 'ch' }); },
  'pad panel': () => ui.panel('pad', S, { pad: 'pad-gate-w' }).then((r) => log('pad panel → ' + r)),
  'pad built': () => { S.towers.push({ pad: 'pad-gate-w', type: 'obelisk', level: 2 }); ui.panel('pad', S, { pad: 'pad-gate-w' }); },
  'poor': () => { S.save.gold = 35; },
  'camp enter (dawn)': () => { CAMP['at Cinder'](); emit(EV.CAMP_ENTER, { nextNight: 2, reason: 'dawn' }); cinema.onEvent({ type: EV.CAMP_ENTER, reason: 'dawn' }, S); },
  'camp enter (fall)': () => { CAMP['at Cinder'](); emit(EV.CAMP_ENTER, { nextNight: 1, reason: 'fall' }); cinema.onEvent({ type: EV.CAMP_ENTER, reason: 'fall' }, S); },
  'camp leave': () => { CAMP['at the pan'](); S.night.n = 2; emit(EV.CAMP_LEAVE, { night: 2 }); cinema.onEvent({ type: EV.CAMP_LEAVE, night: 2 }, S); },
  'card night II': () => ui.card('night', S, { night: 2 }),
  'card dawn I': () => { S.mode = 'victory'; S.night.n = 1; emit(EV.RUN_END, { reason: 'dawn', night: 1, stats: S.stats, goldBanked: 85 }); ui.card('dawn', S).then((r) => log('dawn → ' + r)); },
  'card coming soon': () => { S.mode = 'victory'; S.night.n = 2; emit(EV.RUN_END, { reason: 'complete', night: 2, stats: S.stats, goldBanked: 212 }); emit(EV.COMING_SOON, { completedNight: 2 }); ui.card('dawn', S).then((r) => log('coming → ' + r)); },
  'card fallen v2': () => { S.mode = 'fallen'; S.night.n = 2; emit(EV.FALLEN, { cause: 'gate', stats: S.stats }); emit(EV.RUN_END, { reason: 'fall', night: 2, stats: S.stats, goldBanked: 64 }); ui.card('fallen', S).then((r) => log('fallen → ' + r)); },
  'npc line': () => emit(EV.NPC_LINE, { line: 'afraid' }),
};
panel('events', B); panel('panels', PANELS); panel('cinema', CINEMA); panel('views', VIEWS); panel('camp fx', B2); panel('camp', CAMP);

// ------------------------------------------------------------------------------------------------ scenarios (captures)
const SCENARIOS = {
  hud: { view: 'plaza', run() {} },
  hud_pistol: { view: 'road', run() { S.player.weapon = 'pistol'; S.player.ammo.pistol = 5; } },
  hud_reload: { view: 'road', run() { S.player.weapon = 'blunderbuss'; S.player.ammo.blunderbuss = 0; S.player.reloadT = 0.8; emit(EV.RELOAD, { weapon: 'blunderbuss', seconds: 1.6 }); } },
  hud_troll: { view: 'troll', run() { trollOn(); S.troll.glowing = true; S.night.clock = 236; S.gate.hp = 220; S.player.hp = 26; S.player.sunburst = 1; } },
  prompt: { view: 'wall', run() { PANELS['near pan'](); } },
  hud_busy: { view: 'wall', run() { PANELS['near pan'](); S.player.weapon = 'pistol'; S.player.ammo.pistol = 0; emit(EV.NIGHT_START, {}); B.kindle(); S.night.kindleCd = 0; ui.toast('THE GATE IS FAILING'); ui.toast('SUNBURST READY · Q', 2.4, 'cool'); ui.subtitle('The beacon answers. Every goblin in the valley saw that.'); trollOn(); }, after: 0.3 },
  prompt_locked: { view: 'wall', run() { PANELS['pan cooling'](); } },
  banner_kindle: { view: 'beacon', run() { B.kindle(); }, after: 1.3 },
  cards: { view: 'road', run() { B['level up'](); } },
  menu: { view: 'road', run() { ui.menu.open(); } },
  menu_toast: { view: 'wall', run() { PANELS['near pan'](); ui.toast('KINDLED HEART', 3, 'cool'); ui.menu.open(); }, after: 0.3 },
  cards_pct: { view: 'road', run() { ui.cards(['lance-range', 'sunburst-rate', 'mason']); } },
  locked2: { view: 'road', run() { S.player.unlocked = { pistol: true, blunderbuss: false, lance: true }; window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Digit2', key: '2' })); }, after: 0.3 },
  toast_queue: { view: 'troll', run() { trollOn(); S.troll.glowing = true; ui.toast('ITS HIDE GLOWS · GUNS ×3', 2, 'cool'); ui.toast('SUNBURST READY · Q', 2, 'cool'); ui.toast('THE GATE IS WEAKENING', 2.2); }, after: 0.4 },
  controls: { view: 'road', run() { ui.controls.open(); } },
  night: { view: 'plaza', run() { S.mode = 'intro'; ui.card('night'); } },
  dawn: { view: 'road', run() { look.setDawn(1); PANELS['card dawn'](); } },
  fallen: { view: 'gate', run() { PANELS['card fallen (gate)'](); } },
  fallen_you: { view: 'road', run() { PANELS['card fallen (you)'](); } },
  fx_shots: { view: 'road', run() { S.player.weapon = 'blunderbuss'; fire('blunderbuss'); }, after: 0.05 },
  fx_hits: { view: 'road', run() { S.player.weapon = 'pistol'; for (let i = 0; i < 5; i++) { S.player.yaw = 1.62 + i * 0.05; camFromPlayer(); fire('pistol'); } S.player.yaw = 1.75; B['deaths ×8'](); B['hit crit'](); }, after: 0.16 },
  fx_bomb: { view: 'road', run() { B.firebomb(); }, after: 0.09 },
  fx_bomb_smoke: { view: 'road', run() { B.firebomb(); }, after: 0.7 },
  fx_barrel: { view: 'gate', run() { S.player.yaw = 0.4; B.barrel(); }, after: 0.12 },
  fx_sunburst: { view: 'road', run() { S.player.pitch = -0.35; B.sunburst(); }, after: 0.45 },
  fx_kindle: { view: 'beacon', run() { B.kindle(); }, after: 0.3 },
  fx_levelup: { view: 'road', run() { emit(EV.LEVEL_UP, { level: 5, cards: [] }); }, after: 0.35 },
  fx_troll: { view: 'troll', run() { trollOn(); B['troll stomp'](); B['boulder lands'](); S.troll.glowing = true; emit(EV.T_GLOW, { on: true }); B['troll hurt'](); }, after: 0.25 },
  fx_gate: { view: 'gate', run() { B['troll smash gate'](); B['gate hit'](); }, after: 0.2 },
  fx_gems: { view: 'road', run() { S.player.pitch = -0.5; }, after: 1.0 },
  // ---- DESIGN §9
  hud_v2: { view: 'road', run() { S.night.n = 2; S.night.clock = 95; B2.elites(); }, after: 0.1 },
  hud_elites: { view: 'troll', run() { S.night.n = 2; B2.elites(); S.elites[0].hp = 70; }, after: 0.1 },
  camp_hud: { run() { CAMP['camp mode'](); Object.assign(S.player, { x: 1.5, y: 0, z: 1.2, yaw: 0.35, pitch: -0.18 }); S.towers.push({ pad: 'pad-gate-e', type: 'obelisk', level: 1 }); }, after: 0.1 },
  camp_talk: { run() { CAMP['at Cinder'](); }, after: 0.1 },
  camp_build: { run() { CAMP['at a pad'](); }, after: 0.1 },
  camp_kindle: { run() { CAMP['at the pan'](); }, after: 0.1 },
  npc_up: { run() { CAMP['at Cinder'](); CAMP['npc panel'](); }, after: 0.4 },
  npc_poor: { run() { CAMP['at Cinder'](); S.save.gold = 35; S.save.upgrades.slots = 2; S.save.upgrades.bombs = 3; CAMP['npc panel'](); }, after: 0.4 },
  npc_charms: { run() { CAMP['at Cinder'](); CAMP['charms tab'](); }, after: 0.4 },
  npc_charms_full: { run() { CAMP['at Cinder'](); S.save.upgrades.slots = 1; S.save.charms.owned = ['ember-tooth', 'coin-hook', 'ashen-step', 'bellows-heart', 'cinder-ward', 'soot-lens', 'kindle-knot', 'witchfire-wick']; S.save.charms.equipped = ['coin-hook', 'ember-tooth', 'witchfire-wick']; CAMP['charms tab'](); }, after: 0.4 },
  npc_buy: { run() { CAMP['at Cinder'](); CAMP['npc panel'](); advance(0.4); ui.choose('hide'); }, after: 0.15 },
  pad_empty: { run() { CAMP['at a pad'](); CAMP['pad panel'](); }, after: 0.4 },
  pad_poor: { run() { CAMP['at a pad'](); S.save.gold = 120; CAMP['pad panel'](); }, after: 0.4 },
  pad_built: { run() { CAMP['at a pad'](); CAMP['pad built'](); }, after: 0.4 },
  night2: { view: 'plaza', run() { S.mode = 'intro'; S.night.n = 2; ui.card('night', S, { night: 2 }); }, after: 1.2 },
  dawn1: { view: 'road', run() { look.setDawn(1); CAMP['card dawn I'](); } },
  coming: { view: 'road', run() { look.setDawn(1); CAMP['card coming soon'](); } },
  fallen2: { view: 'gate', run() { CAMP['card fallen v2'](); } },
  cards_v2: { view: 'road', run() { B2['cards v2'](); } },
  cards_v2b: { view: 'road', run() { B2['cards v2 b'](); } },
  toast_charm: { view: 'road', run() { B2['charm pickup'](); }, after: 0.4 },
  fx_hitmark: { view: 'road', run() { S.player.weapon = 'pistol'; for (let i = 0; i < 4; i++) { S.player.yaw = 1.66 + i * 0.05; camFromPlayer(); fire('pistol'); } S.player.yaw = 1.75; fx.debugBurst('crit', 12, groundHeight(12, 4.5) + 0.9, 4.5); }, after: 0.07 },
  fx_obelisk: { run() { Object.assign(S.player, { x: 2.5, y: 0, z: 1.5, yaw: 0.9, pitch: -0.12 }); B2['obelisk pulse'](); }, after: 0.22 },
  fx_chain: { view: 'road', run() { if (!S.towers.length) S.towers.push({ pad: 'pad-road', type: 'chainimp', level: 2 }); const pd = padP('pad-road'); emit(EV.CHAIN_THROW, { pad: 'pad-road', from: roadPt(pd.x, pd.z, 2.0), to: roadPt(12.3, 4.2), targetId: null }); advance(0.2); emit(EV.CHAIN_HOOK, { pad: 'pad-road', targetId: null, pos: roadPt(12.3, 4.2), pull: 2.5 }); }, after: 0.08 },
  fx_orbit: { view: 'road', run() { S.player.pitch = -0.32; S.orbitN = 3; }, after: 0.6 },
  fx_meteor: { view: 'road', run() { B2.meteor(); }, after: 0.55 },
  fx_meteor_hit: { view: 'road', run() { B2.meteor(); }, after: 0.86 },
  fx_trail: { view: 'road', run() { S.player.pitch = -0.4; for (let i = 0; i < 6; i++) { emit(EV.TRAIL, { pos: roadPt(7 + i * 0.7, 4 + i * 0.3) }); advance(0.1); } }, after: 0.05 },
  fx_drops: { view: 'road', run() { B2['gold drop'](); B2['xp drop'](); emit(EV.GOLD_DROP, { pos: roadPt(13.5, 6), value: 3, n: 3 }); }, after: 0.35 },
  fx_drops_fly: { view: 'road', run() { B2['gold drop'](); B2['xp drop'](); emit(EV.GOLD_DROP, { pos: roadPt(13.5, 6), value: 3, n: 3 }); }, after: 0.95 },
  fx_charm: { view: 'road', run() { B2['charm drop'](); }, after: 0.3 },
  fx_douse: { view: 'road', run() { B2.douse(); }, after: 0.78 },
  fx_hex: { view: 'road', run() { B2.hex(); }, after: 0.25 },
  fx_tower: { run() { CAMP['camp mode'](); Object.assign(S.player, { x: 3, y: 0, z: 1.2, yaw: 0.6, pitch: -0.1 }); B2['tower build'](); }, after: 0.2 },
  cin_camp_1: { run() { CAMP['camp enter (fall)'](); }, after: 0.9 },
  cin_camp_2: { run() { CAMP['camp enter (fall)'](); }, after: 2.3 },
  cin_camp_3: { run() { CAMP['camp enter (fall)'](); }, after: 3.4 },
  cin_leave_1: { run() { CAMP['camp leave'](); }, after: 1.3 },
  cin_leave_2: { run() { CAMP['camp leave'](); }, after: 3.1 },
  // ---- the Organ, bats, Pyre Burst, the Ash Roar
  camp_npcmark: { run() { CAMP['camp mode'](); S.camp.tip = true; emit(EV.CAMP_ENTER, { nextNight: 2, reason: 'dawn', tip: true }); Object.assign(S.player, { x: -8.5, y: 0, z: 6.6, yaw: -1.9, pitch: 0.04 }); }, after: 0.3 },
  camp_panmark: { run() { CAMP['camp mode'](); Object.assign(S.player, { x: 3, y: 0, z: 7, yaw: 2.35, pitch: 0.28 }); }, after: 0.3 },
  camp_occluded: { run() { CAMP['camp mode'](); Object.assign(S.player, { x: -8, y: 5, z: -1.5, yaw: -1.09, pitch: -0.05 }); }, after: 0.3 },
  camp_poor: { run() { CAMP['camp mode'](); S.save.gold = 20; Object.assign(S.player, { x: -8.5, y: 0, z: 6.6, yaw: -1.9, pitch: 0.04 }); }, after: 0.3 },
  npc_v3: { run() { CAMP['at Cinder'](); S.save.organ = { owned: true, equipped: true }; S.save.upgrades.organ = 3; S.save.upgrades.kestrel = 7; S.save.gold = 99999; CAMP['npc panel'](); }, after: 0.4 },
  npc_organ_confirm: { run() { CAMP['at Cinder'](); S.save.gold = 120000; CAMP['npc panel'](); advance(0.4); ui.choose('organ'); }, after: 0.2 },
  pad_lv5: { run() { CAMP['at a pad'](); S.towers.push({ pad: 'pad-gate-w', type: 'chainimp', level: 4 }); S.save.gold = 2000; ui.panel('pad', S, { pad: 'pad-gate-w' }); }, after: 0.4 },
  cards_v3: { view: 'road', run() { S.taken = { 'ember-orbit': 1, 'cinder-trail': 1, 'cinder-trail-up': 1 }; S.mode = 'cards'; ui.cards(['pyre-burst', 'ember-orbit-up', 'cinder-trail-up']); } },
  cards_v3b: { view: 'road', run() { S.taken = {}; S.mode = 'cards'; ui.cards(['soul-feast', 'kestrel-dmg', 'brimstone']); } },
  hud_organ: { view: 'road', run() { S.save.organ = { owned: true, equipped: true }; Object.assign(S.player, { weapon: 'organ', unlocked: { blunderbuss: false, organ: true }, organ: { heat: 0.62, lockT: 0, drum: 184, drumMax: 240, reloadT: 0 } }); }, after: 0.1 },
  hud_organ_over: { view: 'road', run() { S.save.organ = { owned: true, equipped: true }; Object.assign(S.player, { weapon: 'organ', unlocked: { blunderbuss: false, organ: true }, organ: { heat: 1, lockT: 1.2, drum: 96, drumMax: 240, reloadT: 0 } }); }, after: 0.1 },
  fx_organ: { view: 'road', run() { Object.assign(S.player, { weapon: 'organ', unlocked: { organ: true }, organ: { heat: 0.4, lockT: 0, drum: 200, drumMax: 240, reloadT: 0 } }); for (let i = 0; i < 9; i++) { S.player.yaw = 1.7 + Math.sin(i * 1.7) * 0.03; S.player.pitch = -0.1 + Math.cos(i) * 0.02; camFromPlayer(); fire('organ'); advance(1 / 18); } S.player.yaw = 1.75; S.player.pitch = -0.12; }, after: 0.02 },
  fx_bats: { view: 'road', run() { S.player.pitch = -0.32; S.air = [{ x: 14, y: groundHeight(14, 9) + 5, z: 9, alive: true }, { x: 16, y: groundHeight(16, 3) + 6.5, z: 3, alive: true }, { x: 11, y: groundHeight(11, 7) + 2.2, z: 7, alive: true, mode: 'dive' }]; emit('air.dive', { id: 2, from: S.air[2], to: { x: 10.5, y: 0, z: 4.6 }, seconds: 1.2 }); }, after: 0.55 },
  fx_batdeath: { view: 'road', run() { emit('air.death', { id: 1, pos: roadPt(11, 5, 3.5), burned: false }); emit('air.crash', { id: 2, pos: roadPt(14, 7, 0.2), burned: true }); }, after: 0.25 },
  fx_pyre: { view: 'road', run() { for (const [x, z] of [[11, 4.2], [12.6, 5.6], [14, 4.4], [15.5, 6.2], [13.2, 3.4]]) emit('pyre.burst', { pos: roadPt(x, z), r: 2.2, level: 2 }); }, after: 0.07 },
  fx_roar: { view: 'troll', run() { trollOn(); S.troll.yaw = Math.atan2(10 - S.troll.x, 8 - S.troll.z); emit(EV.T_WINDUP, { move: 'roar', pos: { x: S.troll.x, y: S.troll.y, z: S.troll.z }, windup: 1.0 }); }, after: 0.7 },
  fx_roar_release: { view: 'troll', run() { trollOn(); S.troll.yaw = Math.atan2(10 - S.troll.x, 8 - S.troll.z); emit(EV.T_WINDUP, { move: 'roar', pos: { x: S.troll.x, y: S.troll.y, z: S.troll.z }, windup: 1.0 }); advance(1.0); emit('troll.roar', { pos: { x: S.troll.x, y: S.troll.y, z: S.troll.z }, dir: { x: Math.sin(S.troll.yaw), z: Math.cos(S.troll.yaw) }, r: 12, angle: 0.6, calls: 30 }); }, after: 0.5 },
  // ---- DESIGN §3.4, §10.4
  cards_v5: { view: 'road', run() { S.taken = { 'cinder-trail': 1 }; S.mode = 'cards'; ui.cards(['hearthblood', 'ember-gale', 'cinder-trail-up']); } },
  cards_v5b: { view: 'road', run() { S.taken = {}; S.mode = 'cards'; ui.cards(['iron-skin', 'kindling', 'fleet']); } },
  fx_gale: { run() { Object.assign(S.player, { x: -3, y: 5, z: -1.4, yaw: 0.35, pitch: -0.32 }); emit('gale', { dir: { x: 0, z: 1 }, strength: 4.5, seconds: 2.5, level: 1 }); }, after: 1.1 },
  fx_wallcinders: { run() { Object.assign(S.player, { x: 6, y: 0, z: 8.5, yaw: Math.PI + 0.35, pitch: 0.12 }); for (let i = 0; i < 4; i++) { emit('trail', { wall: true, from: { x: 1 + i * 0.9, y: 6.1, z: -0.3 }, pos: { x: 1 + i * 0.9, y: 0, z: 0.4 + (i % 3) * 0.5 } }); advance(0.2); } }, after: 0.25 },
  hud_hearth: { view: 'road', run() { S.taken = { hearthblood: 1 }; S.player.inFire = true; S.player.hp = 58; }, after: 0.3 },
  // ---- DESIGN §8
  night3: { view: 'plaza', run() { S.mode = 'intro'; S.night.n = 3; ui.card('night', S, { night: 3 }); }, after: 1.4 },
  night10: { view: 'plaza', run() { S.mode = 'intro'; S.night.n = 10; ui.card('night', S, { night: 10 }); }, after: 1.4 },
  dawn5: { view: 'road', run() { look.setDawn(1); S.mode = 'victory'; S.night.n = 5; ui.card('dawn', S); } },
  hud_boss: { view: 'road', run() { S.night.n = 10; S.night.clock = 95; S.weather = { rain: 0.7 }; S.boss = { kind: 'rainmother', hp: 8800, hpMax: 12000, phase: 1, lanterns: 5, lanternsMax: 6, x: 26, z: 40 }; }, after: 0.2 },
  hud_boss_climb: { view: 'road', run() { S.night.n = 10; S.night.clock = 241; S.weather = { rain: 1 }; S.boss = { kind: 'rainmother', hp: 2900, hpMax: 12000, phase: 3, lanterns: 2, lanternsMax: 6, cracked: true, x: 14, z: 16, gateDist: 14 }; }, after: 0.2 },
  hud_ram: { view: 'road', run() { S.night.n = 3; S.rams = [{ id: 1, x: 17, y: groundHeight(17, 8), z: 8, hp: 420, hpMax: 600, crew: 6, crewMax: 8, atGate: false }]; }, after: 0.2 },
  hud_ram_gate: { view: 'gate', run() { S.night.n = 3; S.rams = [{ id: 1, x: 0.5, y: groundHeight(0.5, 3), z: 3, hp: 310, hpMax: 600, crew: 4, crewMax: 8, mode: 'swing' }]; }, after: 0.3 },
  hud_coven: { view: 'road', run() { S.night.n = 7; S.coven = [{ state: 'chant', chantT: 7.5, ids: [1, 2, 3] }]; emit('coven.chant', { on: true }); }, after: 0.3 },
  fx_wave: { view: 'road', run() { S.player.pitch = -0.2; emit('boss.tide', { from: roadPt(26, 26), to: roadPt(8, 5.5), width: 7, windup: 0.8 }); }, after: 1.9 },
  fx_wave_warn: { view: 'road', run() { S.player.pitch = -0.2; emit('boss.tide', { from: roadPt(26, 26), to: roadPt(8, 5.5), width: 7, windup: 0.8 }); }, after: 0.4 },
  fx_whirl: { view: 'road', run() { S.player.pitch = -0.3; emit('boss.whirl', { pos: roadPt(12.5, 6.5), r: 5, seconds: 6 }); }, after: 0.9 },
  cin_rise: { run() { S.night.n = 10; S.boss = { kind: 'rainmother', hp: 12000, hpMax: 12000, phase: 1, x: 27, z: 46 }; emit('boss.rise', {}); cinema.onEvent({ type: 'boss.rise' }, S); }, after: 2.0 },
  ...Object.fromEntries([['flood', 2.5], ['lamp', 6.5], ['portal', 10.5], ['world', 15], ['host', 21.5], ['gloves', 27], ['reveal', 31], ['roar', 35], ['cinder', 39.6], ['hunt', 45], ['hunt2', 49.2], ['credits', 53.8], ['card', 57.6]]
    .map(([id, at]) => [`end_${id}`, { run() { CINEMA.ending(); }, after: at }])),
  cin_intro_1: { run() { CINEMA.intro(); }, after: 1.0 },
  cin_intro_2: { run() { CINEMA.intro(); }, after: 2.8 },
  cin_intro_3: { run() { CINEMA.intro(); }, after: 4.1 },
  cin_intro_4: { run() { CINEMA.intro(); }, after: 5.4 },
  cin_troll: { run() { CINEMA.troll(); }, after: 1.6 },
  cin_dawn: { view: 'road', run() { CINEMA.dawn(); }, after: 5.0 },
  cin_fallen_gate: { view: 'gate', run() { CINEMA['fallen gate'](); }, after: 1.2 },
  cin_fallen_you: { view: 'road', run() { CINEMA['fallen you'](); }, after: 1.2 },
};
function setup(name) {
  const sc = SCENARIOS[name];
  if (!sc) return false;
  S = freshState(); trollMesh.visible = false; look.setDawn(0); fx.clear?.();
  if (sc.view) VIEWS[sc.view]();
  camFromPlayer();
  ui.update(S, 0.016);
  sc.run();
  if (sc.after) advance(sc.after);
  return true;
}

// ------------------------------------------------------------------------------------------------ loop
function camFromPlayer() {
  const p = S.player, y = p.y + BODY.player.eye;
  camera.position.set(p.x, y, p.z);
  tmpV.set(p.x + Math.sin(p.yaw) * Math.cos(p.pitch), y + Math.sin(p.pitch), p.z + Math.cos(p.yaw) * Math.cos(p.pitch));
  camera.up.set(0, 1, 0);
  camera.lookAt(tmpV);
  camera.updateMatrixWorld();
}
function step(dt) {
  if (ticking && S.mode === 'play') {
    S.t += dt; S.night.clock = Math.min(300, S.night.clock + dt);
    S.player.xp += dt * 6; if (S.player.xp >= S.player.xpNext) S.player.xp -= S.player.xpNext;
    S.player.sunburst = Math.min(1, S.player.sunburst + dt * 0.03);
    S.night.kindleCd = Math.max(0, S.night.kindleCd - dt);
  }
  if (S.player.reloadT > 0) { S.player.reloadT = Math.max(0, S.player.reloadT - dt); if (!S.player.reloadT) { const w = S.player.weapon; S.player.ammo[w] = w === 'blunderbuss' ? 4 : 8; } }
  if (S.player.firing && S.player.weapon === 'lance') S.player.fuel = Math.max(0, S.player.fuel - 14 * dt);
  for (const s of S.spears) { s.x += s.vx * dt; s.y += s.vy * dt; s.z += s.vz * dt; s.vy -= 9.8 * dt; }
  S.spears = S.spears.filter((s) => s.y > groundHeight(s.x, s.z));
  if (S.mode === 'ending') { const prev = S.modeT || 0; S.modeT = prev + dt; for (const b of TIMELINE.ending.beats) if (b.at > prev && b.at <= S.modeT) emit('ending.beat', { id: b.id, at: b.at, night: 10 }); }
  endGroup.visible = S.mode === 'ending';
  if (S.orbitN) { S.orbitA = (S.orbitA || 0) + dt * 2.4; S.orbit = Array.from({ length: S.orbitN }, (_, i) => { const a = S.orbitA + (i / S.orbitN) * 6.283; return { x: S.player.x + Math.sin(a) * 2.2, y: S.player.y + 1.15, z: S.player.z + Math.cos(a) * 2.2 }; }); }
  syncStandIns();
  fx.update(dt, S);
  if (!cinema.update(dt, S)) camFromPlayer();
}
function syncStandIns() {
  for (const k of ['chief', 'hexer']) { const e = (S.elites || []).find((x) => x.kind === k); eliteMesh[k].visible = !!e; if (e) eliteMesh[k].position.set(e.x, e.y + (k === 'chief' ? 0.95 : 0.7), e.z); }
  for (const k of ['obelisk', 'chainimp']) { const t = (S.towers || []).find((x) => x.type === k); towerMesh[k].visible = !!t; if (t) { const pd = ARENA.camp.pads.find((p) => p.id === t.pad); if (pd) towerMesh[k].position.set(pd.x, groundHeight(pd.x, pd.z) + (k === 'obelisk' ? 2.1 : 1.0), pd.z); } }
}
function advance(seconds) { const n = Math.max(1, Math.round(seconds * 60)); for (let i = 0; i < n; i++) step(1 / 60); renderer.render(scene, camera); }

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  if (!frozen) step(dt); else if (!cinema.active) camFromPlayer();
  ui.update(S);
  renderer.render(scene, camera);
  const st = fx.stats();
  statEl.textContent = `fx add ${st.add} alpha ${st.alpha} num ${st.nums} · draws ${renderer.info.render.calls} · style ${fireStyle} · cinema ${cinema.active ? cinema.name : '-'}\n${logs.join(' | ')}`;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// look around: drag (no pointer lock on the bench)
let drag = null;
renderer.domElement.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY }; });
addEventListener('pointerup', () => { drag = null; });
addEventListener('pointermove', (e) => { if (!drag) return; S.player.yaw -= (e.clientX - drag.x) * 0.0022 * 2; S.player.pitch = Math.max(-1.4, Math.min(1.4, S.player.pitch - (e.clientY - drag.y) * 0.0022 * 2)); drag = { x: e.clientX, y: e.clientY }; });
addEventListener('keydown', (e) => { if (e.code === 'KeyF') fire(); if (e.code === 'Space' && cinema.active) cinema.skip(); });
addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); });

window.__pres = { ready: false, list: () => Object.keys(SCENARIOS), setup, advance, ev: emit, get state() { return S; }, ui, fx, cinema, freeze(on) { frozen = !!on; } };
document.fonts?.ready.then(() => { window.__pres.ready = true; });
const scn = Q.get('scn');
if (scn) setup(scn);
