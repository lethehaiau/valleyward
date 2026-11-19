// VALLEYWARD · the greybox view: the sim's truth drawn plainly. The world (terrain from groundHeight, the keep,
// gate, stair, troughs, braziers, barrels, beacon, a few pines), the actors (2,500 goblins as one instanced draw of
// camera-facing quads coloured by kind and fire, the troll, pickups, bombs, spears, boulders with their landing ring),
// the fire (the provider's 64 × 64 grid draped over the ground: the fire when the fire module is missing, the debug overlay of the
// read-back with ?debug=1) and the Lance's arc. Each part hides when its game module is present (setParts).
import * as THREE from 'three';
import { ARENA, groundHeight, BODY } from '../shared/arena.js';
import { ENEMY } from '../sim/constants.js';

const C = {
  sky: 0x184255, fog: 0x2c5168, moon: 0x9fd3e0, hemiSky: 0x2a5a6e, hemiGround: 0x1a2224,
  stone: 0x4a5560, stoneDark: 0x3a4652, earth: 0x4a4436, road: 0x5a4a3a, grass: 0x34503f, timber: 0x6a4a32, gate: 0x7a5534, oil: 0x15120f,
};
// grunt, imp, spear, brute, + DESIGN §9: chief (gold), hexer (purple), douser (blue)
const KIND_COL = [new THREE.Color(0x6f7a3a), new THREE.Color(0xa3352a), new THREE.Color(0x8c7f5a), new THREE.Color(0x5d5a52), new THREE.Color(0xc9a23a), new THREE.Color(0x7a4a9a), new THREE.Color(0x3a6a9a)];
const HUE_HEX = { orange: 0xff9a40, violet: 0xb060ff, blue: 0x60a0ff, green: 0x70ff60, lilac: 0xd8a0ff };
const FIRE_COL = new THREE.Color(0xff8a2e), DEAD_COL = new THREE.Color(0x1d1c1a);

function box(w, h, d, color, x, y, z) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshLambertMaterial({ color }));
  m.position.set(x, y, z); m.castShadow = false; m.receiveShadow = false;
  return m;
}

export function createGreybox(scene, { patch } = {}) {
  const world = new THREE.Group(); world.name = 'greybox-world';
  const actors = new THREE.Group(); actors.name = 'greybox-actors';
  const fireG = new THREE.Group(); fireG.name = 'greybox-fire';
  scene.add(world, actors, fireG);
  const mats = [];
  const lam = (color, extra = {}) => { const m = new THREE.MeshLambertMaterial({ color, ...extra }); mats.push(m); if (patch) patch(m); return m; };

  // ---------------------------------------------------------------------------------------------- light, sky, fog
  const hemi = new THREE.HemisphereLight(C.hemiSky, C.hemiGround, 1.6);
  const moon = new THREE.DirectionalLight(C.moon, 1.5);
  moon.position.set(ARENA.moonDir.x * 100, ARENA.moonDir.y * 100, ARENA.moonDir.z * 100);
  world.add(hemi, moon, moon.target);
  const sky = new THREE.Color(C.sky);
  const fog = new THREE.Fog(C.fog, 30, 170);

  // ---------------------------------------------------------------------------------------------- terrain
  const T = ARENA.terrain, sx = 120, sz = 130;
  const tg = new THREE.PlaneGeometry(T.x1 - T.x0, T.z1 - T.z0, sx, sz);
  tg.rotateX(-Math.PI / 2);
  const pos = tg.attributes.position, col = new Float32Array(pos.count * 3);
  const cEarth = new THREE.Color(C.earth), cRoad = new THREE.Color(C.road), cGrass = new THREE.Color(C.grass), tmp = new THREE.Color();
  const roadD = (x, z) => { const P = ARENA.road.points; let b = 1e9; for (let i = 0; i < P.length - 1; i++) { const [ax, az] = P[i], [bx, bz] = P[i + 1], dx = bx - ax, dz = bz - az, L = dx * dx + dz * dz, t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L)); b = Math.min(b, Math.hypot(x - ax - dx * t, z - az - dz * t)); } return b; };
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) + (T.x0 + T.x1) / 2, z = pos.getZ(i) + (T.z0 + T.z1) / 2;
    pos.setXYZ(i, x, groundHeight(x, z), z);
    const pl = ARENA.plaza, onPlaza = x >= pl.x0 && x <= pl.x1 && z >= pl.z0 && z <= pl.z1;
    if (roadD(x, z) < ARENA.road.width / 2) tmp.copy(cRoad); else if (onPlaza) tmp.copy(cEarth); else tmp.copy(cGrass).offsetHSL(0, 0, ((x * 7.13 + z * 3.7) % 1) * 0.03);
    col.set([tmp.r, tmp.g, tmp.b], i * 3);
  }
  tg.setAttribute('color', new THREE.BufferAttribute(col, 3));
  tg.computeVertexNormals();
  const terrain = new THREE.Mesh(tg, lam(0xffffff, { vertexColors: true }));
  terrain.name = 'terrain';
  world.add(terrain);

  // ---------------------------------------------------------------------------------------------- the keep
  const K = ARENA.keep, wh = K.wallHeight, th = K.wallThick;
  const stone = lam(C.stone), stoneD = lam(C.stoneDark), timber = lam(C.timber);
  const addBox = (w, h, d, m, x, y, z) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.set(x, y, z); world.add(b); return b; };
  addBox(K.x1 - K.x0, wh, th, stone, 0, wh / 2, K.z1 - th / 2);                // south wall (the gate's)
  addBox(K.x1 - K.x0, wh, th, stone, 0, wh / 2, K.z0 + th / 2);
  addBox(th, wh, K.z1 - K.z0, stone, K.x0 + th / 2, wh / 2, (K.z0 + K.z1) / 2);
  addBox(th, wh, K.z1 - K.z0, stone, K.x1 - th / 2, wh / 2, (K.z0 + K.z1) / 2);
  addBox(K.x1 - K.x0 - 2 * th, 0.2, K.z1 - K.z0 - 2 * th, stoneD, 0, 0.1, (K.z0 + K.z1) / 2);
  for (const t of K.towers) addBox(t.half * 2, t.height, t.half * 2, stoneD, t.x, t.height / 2, t.z);
  // parapets on the wall walk (outer one open at the stair)
  const W = K.walk, S = ARENA.stair;
  addBox(S.x0 - W.x0, K.parapetH, 0.4, stone, (W.x0 + S.x0) / 2, wh + K.parapetH / 2, -0.2);
  addBox(W.x1 - S.x1, K.parapetH, 0.4, stone, (S.x1 + W.x1) / 2, wh + K.parapetH / 2, -0.2);
  addBox(W.x1 - W.x0, K.parapetH, 0.4, stone, 0, wh + K.parapetH / 2, -2.8);
  // the gate
  const G = ARENA.gate;
  const gate = addBox(G.x1 - G.x0, G.height, 0.5, lam(C.gate), (G.x0 + G.x1) / 2, G.height / 2, 0.15);
  // the stair: a ramp with rails
  const len = Math.hypot(S.zBottom - S.zTop, S.yTop), ang = Math.atan2(S.yTop, S.zBottom - S.zTop);
  const ramp = addBox(S.x1 - S.x0, 0.3, len, timber, (S.x0 + S.x1) / 2, S.yTop / 2 - 0.15, (S.zTop + S.zBottom) / 2);
  ramp.rotation.x = ang;
  for (const rx of [S.x0, S.x1]) { const r = addBox(0.12, 0.12, len, timber, rx, S.yTop / 2 + 0.85, (S.zTop + S.zBottom) / 2); r.rotation.x = ang; }
  // troughs, braziers, barrels, beacon
  const troughs = ARENA.oil.troughs.map((t) => {
    addBox(t.x1 - t.x0 + 0.3, 0.35, t.z1 - t.z0 + 0.3, stoneD, (t.x0 + t.x1) / 2, 0.175, (t.z0 + t.z1) / 2);
    const oil = addBox(t.x1 - t.x0, 0.05, t.z1 - t.z0, new THREE.MeshBasicMaterial({ color: C.oil }), (t.x0 + t.x1) / 2, 0.33, (t.z0 + t.z1) / 2);
    return oil;
  });
  const brazierMat = new THREE.MeshBasicMaterial({ color: 0xffa040 });
  for (const [bx, bz] of ARENA.braziers) {
    addBox(0.7, 0.9, 0.7, lam(0x2a2a2a), bx, 0.45, bz);
    const f = new THREE.Mesh(new THREE.SphereGeometry(0.35, 8, 6), brazierMat); f.position.set(bx, 1.15, bz); world.add(f);
    const L = new THREE.PointLight(0xff8a3a, 6, 9, 1.6); L.position.set(bx, 1.6, bz); world.add(L);
  }
  const barrelGeo = new THREE.CylinderGeometry(0.45, 0.45, 1.1, 10), barrelMat = lam(0x5a3a22);
  const barrels = ARENA.oil.barrels.map(([x, z]) => { const b = new THREE.Mesh(barrelGeo, barrelMat); b.position.set(x, groundHeight(x, z) + 0.55, z); world.add(b); return b; });
  const B = ARENA.beacon.basket;
  const beaconMat = new THREE.MeshBasicMaterial({ color: 0x8a4a20 });
  const beacon = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 0.6, 1.2, 10), beaconMat); beacon.position.set(B.x, B.y, B.z); world.add(beacon);
  const pan = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.4, 0.3, 10), lam(0x3a3a3a)); pan.position.set(ARENA.beacon.pan.x, ARENA.beacon.pan.y + 0.5, ARENA.beacon.pan.z); world.add(pan);
  // pines in the valley (instanced cones), off the road and the plaza
  const pineGeo = new THREE.ConeGeometry(1.6, 6, 6); pineGeo.translate(0, 3, 0);
  const pines = new THREE.InstancedMesh(pineGeo, lam(0x2b4a43), 260);
  let np = 0; const m4 = new THREE.Matrix4();
  const hr = (n) => { const v = Math.sin(n * 127.1 + 311.7) * 43758.5453; return v - Math.floor(v); };
  for (let k = 0; np < 260 && k < 4000; k++) {
    const x = -60 + hr(k) * 160, z = 14 + hr(k + 977) * 120;
    if (roadD(x, z) < 6 || (x > -24 && x < 48 && z < 12) || (x > 10 && x < 46 && z > 10 && z < 60 && roadD(x, z) < 10)) continue;
    const s = 0.7 + ((k * 13.37) % 1) * 0.8;
    m4.makeScale(s, s * (0.9 + ((k * 7.1) % 1) * 0.5), s).setPosition(x, groundHeight(x, z) - 0.2, z);
    pines.setMatrixAt(np++, m4);
  }
  pines.count = np; world.add(pines);

  // ---------------------------------------------------------------------------------------------- actors
  const cap = 2600;
  const quad = new THREE.PlaneGeometry(1, 1); quad.translate(0, 0.5, 0);
  const hordeMat = new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide });
  if (patch) patch(hordeMat);
  const horde = new THREE.InstancedMesh(quad, hordeMat, cap);
  horde.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  horde.setColorAt(0, KIND_COL[0]);
  horde.frustumCulled = false; horde.count = 0;
  actors.add(horde);
  const trollMat = new THREE.MeshLambertMaterial({ color: 0x5a5550, side: THREE.DoubleSide });
  const troll = new THREE.Mesh(quad, trollMat); troll.visible = false; actors.add(troll);
  const gemGeo = new THREE.OctahedronGeometry(0.18);
  const gems = new THREE.InstancedMesh(gemGeo, new THREE.MeshBasicMaterial({ color: 0xffffff }), 700);
  gems.instanceMatrix.setUsage(THREE.DynamicDrawUsage); gems.setColorAt(0, new THREE.Color(0x9ee1e9)); gems.count = 0; gems.frustumCulled = false; actors.add(gems);
  const projGeo = new THREE.SphereGeometry(0.18, 8, 6);
  const projs = new THREE.InstancedMesh(projGeo, new THREE.MeshBasicMaterial({ color: 0xffffff }), 160);
  projs.instanceMatrix.setUsage(THREE.DynamicDrawUsage); projs.setColorAt(0, new THREE.Color(0xffffff)); projs.count = 0; projs.frustumCulled = false; actors.add(projs);
  const ringGeo = new THREE.RingGeometry(0.85, 1, 32); ringGeo.rotateX(-Math.PI / 2);
  const rings = new THREE.InstancedMesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xff5030, transparent: true, opacity: 0.7, depthWrite: false }), 16);
  rings.count = 0; rings.frustumCulled = false; actors.add(rings);
  // the Lance's arc and the sunburst ring
  const arcGeo = new THREE.BufferGeometry(); arcGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3 * 64), 3));
  const arc = new THREE.Line(arcGeo, new THREE.LineBasicMaterial({ color: 0xffb040 })); arc.frustumCulled = false; arc.visible = false; actors.add(arc);
  const sunRing = new THREE.Mesh(new THREE.TorusGeometry(1, 0.25, 6, 48), new THREE.MeshBasicMaterial({ color: 0xffc060 })); sunRing.rotation.x = Math.PI / 2; sunRing.visible = false; actors.add(sunRing);

  // ---------------------------------------------------------------------------------------------- the fire grid
  const FN = 64, F = ARENA.fluid, cell = F.size / FN;
  const fg = new THREE.PlaneGeometry(F.size, F.size, FN, FN); fg.rotateX(-Math.PI / 2);
  const fpos = fg.attributes.position, fcol = new Float32Array(fpos.count * 3);
  for (let i = 0; i < fpos.count; i++) { const x = fpos.getX(i) + F.x0 + F.size / 2, z = fpos.getZ(i) + F.z0 + F.size / 2; fpos.setXYZ(i, x, Math.max(groundHeight(x, z), x > -16 && x < 16 && z < 0 ? 5 : groundHeight(x, z)) + 0.12, z); }
  fg.setAttribute('color', new THREE.BufferAttribute(fcol, 3));
  const fireMesh = new THREE.Mesh(fg, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
  fireMesh.frustumCulled = false; fireMesh.renderOrder = 5;
  fireG.add(fireMesh);
  let fireFrame = 0;

  // ---------------------------------------------------------------------------------------------- per frame
  const dummy = new THREE.Object3D(), c = new THREE.Color(), camPos = new THREE.Vector3();
  const parts = { world: true, actors: true, fire: true, debugFire: false };

  function update(dt, st, camera, fire) {
    camera.getWorldPosition(camPos);
    if (parts.world) {
      st.troughs.forEach((t, k) => { troughs[k].material.color.setHex(t.lit ? 0xff7a20 : t.oil > 0.05 ? C.oil : 0x2a2622); });
      st.barrels.forEach((b, k) => { barrels[k].visible = b.alive; });
      beaconMat.color.setHex(st.night.kindleT > 0 ? 0xffc050 : st.night.kindleCd <= 0 ? 0xff8a30 : 0x8a4a20);
      gate.scale.y = 0.35 + 0.65 * Math.max(0, st.gate.hp / st.gate.hpMax);
      gate.position.y = ARENA.gate.height * gate.scale.y / 2;
    }
    if (parts.actors) {
      const H = st.horde;
      let n = 0;
      for (let i = 0; i < H.count && n < cap; i++) {
        const s = H.state[i]; if (s === 0) continue;
        const K = ENEMY[H.kind[i]], dying = s === 4, k = dying ? Math.max(0.05, 1 - H.dyingT[i] / 0.6) : 1;
        dummy.position.set(H.x[i], H.y[i] - (dying ? (1 - k) * 0.5 : 0), H.z[i]);
        dummy.rotation.set(0, Math.atan2(camPos.x - H.x[i], camPos.z - H.z[i]), 0);
        const bob = s === 1 ? Math.abs(Math.sin(H.anim[i] * 6)) * 0.08 : 0;
        dummy.position.y += bob;
        dummy.scale.set(K.radius * 2.6, K.height * k, 1);
        dummy.updateMatrix();
        horde.setMatrixAt(n, dummy.matrix);
        if (dying) c.copy(DEAD_COL); else if (H.burn[i] > 0) c.copy(FIRE_COL).lerp(KIND_COL[H.kind[i]], 0.25 * Math.sin(H.anim[i] * 20) + 0.25); else c.copy(KIND_COL[H.kind[i]]);
        horde.setColorAt(n, c);
        n++;
      }
      horde.count = n; horde.instanceMatrix.needsUpdate = true; if (horde.instanceColor) horde.instanceColor.needsUpdate = true;
      const tr = st.troll;
      troll.visible = !!tr && (tr.alive || tr.deathT < 3);
      if (troll.visible) {
        const k = tr.alive ? 1 : Math.max(0.05, 1 - tr.deathT / 3);
        troll.position.set(tr.x, tr.y, tr.z); troll.rotation.set(0, Math.atan2(camPos.x - tr.x, camPos.z - tr.z), 0);
        troll.scale.set(BODY.troll.radius * 2.2, BODY.troll.height * k, 1);
        trollMat.color.setHex(tr.glowing ? 0xff4020 : tr.stage === 'windup' ? 0x9a8a70 : 0x5a5550);
        trollMat.emissive.setHex(tr.glowing ? 0x801000 : 0x000000);
      }
      let g = 0;
      for (const pk of st.pickups) {
        if (g >= 700) break;
        dummy.position.set(pk.x, pk.y + Math.sin((pk.t + pk.id) * 3) * 0.08, pk.z); dummy.rotation.set(0, pk.t * 2, 0); dummy.scale.setScalar(pk.kind === 'xp' ? 1 : 1.3); dummy.updateMatrix();
        gems.setMatrixAt(g, dummy.matrix); gems.setColorAt(g, c.setHex(pk.kind === 'xp' ? 0xff8a3a : pk.kind === 'gold' ? 0xffe28a : pk.kind === 'charm' ? 0xb0ffd0 : 0xff4a4a)); g++;
      }
      gems.count = g; gems.instanceMatrix.needsUpdate = true; if (gems.instanceColor) gems.instanceColor.needsUpdate = true;
      let q = 0, r = 0;
      const put = (x, y, z, s, hex) => { if (q >= 160) return; dummy.position.set(x, y, z); dummy.rotation.set(0, 0, 0); dummy.scale.setScalar(s); dummy.updateMatrix(); projs.setMatrixAt(q, dummy.matrix); projs.setColorAt(q, c.setHex(hex)); q++; };
      for (const b of st.bombs) put(b.x, b.y, b.z, 1, 0xff9a40);
      // DESIGN §9 stand-ins (when the actors module is missing): towers as tall markers, the orbit, meteors, hexes, water, chains' heads
      for (const t of st.towers || []) { put(t.x, groundHeight(t.x, t.z) + 0.6, t.z, 4.5, t.type === 'obelisk' ? 0x2a1830 : 0x5a3a2a); put(t.x, groundHeight(t.x, t.z) + 2.2, t.z, 2.2, t.type === 'obelisk' ? HUE_HEX.violet : 0xd0a070); }
      for (const o of st.orbit || []) put(o.x, o.y, o.z, 1.6, HUE_HEX.blue);
      for (const m of st.meteors || []) { const u = Math.min(1, m.t / m.flight); put(m.fx + (m.x - m.fx) * u, m.fy + (m.y - m.fy) * u, m.fz + (m.z - m.fz) * u, 3, HUE_HEX.green); }
      for (const h of st.hexes || []) put(h.x, h.y, h.z, 1.2, 0xc050ff);
      for (const w of st.splashes || []) put(w.x, w.y, w.z, 1.4, 0x60b0ff);
      for (const ch of st.chains || []) put(ch.tx, ch.ty, ch.tz, 0.8, 0x9a9a9a);
      for (const b of st.air || []) put(b.x, b.y, b.z, 2.4, b.burn > 0 ? 0xff7a30 : b.mode === 'dive' ? 0xd04040 : 0x403a48);   // DESIGN §5.5 bats
      for (const r of st.rams || []) for (let k = -2; k <= 2; k++) put(r.x + Math.sin(r.yaw) * k * 1.3, r.y + 0.9, r.z + Math.cos(r.yaw) * k * 1.3, 4, r.burn > 0 ? 0xff7a30 : 0x5a3a20);   // DESIGN §8 rams
      const bo = st.boss; if (bo && (bo.alive || bo.deathT < 4)) { for (let k = 0; k < 7; k++) put(bo.x, bo.y + k * 2, bo.z, 14, bo.cracked ? 0xff6a30 : 0x23405a); for (const L of bo.lanterns) if (L.alive) put(L.x, L.y, L.z, 2.5, 0x7ac8ff); }   // DESIGN §8 the Rainmother
      for (const s of st.spears) put(s.x, s.y, s.z, 0.6, 0xd8d0b8);
      for (const b of st.boulders) {
        put(b.x, b.y, b.z, 5, 0x6a645c);
        if (r < 16) { dummy.position.set(b.tx, b.ty + 0.08, b.tz); dummy.rotation.set(0, 0, 0); dummy.scale.setScalar(b.r * (0.4 + 0.6 * Math.min(1, b.t / b.flight))); dummy.updateMatrix(); rings.setMatrixAt(r++, dummy.matrix); }
      }
      projs.count = q; projs.instanceMatrix.needsUpdate = true; if (projs.instanceColor) projs.instanceColor.needsUpdate = true;
      rings.count = r; rings.instanceMatrix.needsUpdate = true;
      const j = st.player.jet;
      arc.visible = !!j?.on;
      if (arc.visible) {
        const a = arcGeo.attributes.position.array, steps = 30;
        const L = { speed: 16, gravity: 14 };
        for (let k = 0; k < steps; k++) {
          const t = k / (steps - 1), hd = Math.hypot(j.lx - j.ox, j.lz - j.oz), hv = Math.hypot(j.dx, j.dz) * L.speed || 1, tt = (hd / hv) * t;
          a[k * 3] = j.ox + (j.lx - j.ox) * t; a[k * 3 + 2] = j.oz + (j.lz - j.oz) * t;
          a[k * 3 + 1] = Math.max(j.ly, j.oy + j.dy * L.speed * tt - 0.5 * L.gravity * tt * tt);
        }
        arcGeo.setDrawRange(0, steps); arcGeo.attributes.position.needsUpdate = true;
      }
      sunRing.visible = !!st.ring;
      if (st.ring) { sunRing.position.set(st.ring.x, groundHeight(st.ring.x, st.ring.z) + 0.4, st.ring.z); sunRing.scale.set(st.ring.r || 0.1, st.ring.r || 0.1, 1); }
    }
    if ((parts.fire || parts.debugFire) && fire && (fireFrame++ % 3 === 0)) {
      const a = fg.attributes.color.array;
      for (let j = 0; j <= FN; j++) for (let i = 0; i <= FN; i++) {
        const x = F.x0 + i * cell, z = F.z0 + j * cell, k = (j * (FN + 1) + i) * 3;
        const h = fire.heat(x, z), u = fire.fuel ? fire.fuel(x, z) : 0;
        a[k] = Math.min(1, h * 1.6) + u * 0.08; a[k + 1] = Math.min(1, h * h * 1.1) + u * 0.05; a[k + 2] = h * h * h * 0.4 + u * 0.12;
      }
      fg.attributes.color.needsUpdate = true;
    }
  }

  return {
    update,
    sky, fog, hemi, moon, troughs, barrels, horde, terrain,
    /** Show or hide parts: { world, actors, fire, debugFire }. */
    setParts(p) {
      Object.assign(parts, p);
      world.visible = parts.world; actors.visible = parts.actors; fireG.visible = parts.fire || parts.debugFire;
      if (parts.world) { scene.background = sky; scene.fog = fog; }
    },
    get parts() { return { ...parts }; },
    dispose() { scene.remove(world, actors, fireG); },
  };
}
