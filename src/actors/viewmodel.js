// VALLEYWARD · actors · the first-person viewmodel: leather-gloved hands and three chunky low-poly weapons built in code
// (the Kestrel flintlock, the Blunderbuss, the Ember Lance), textured with 64×64 nearest-filtered pixel textures made
// by Codex (public/assets/models/viewmodel/*.png; a procedural pixel-noise stand-in if one fails to load). Its own scene
// and camera (FOV 60); the look draws it last with the depth cleared (DESIGN §14.7). Motion: idle sway, walk bob, recoil on
// EV.SHOT, reload, weapon switch (down/up), the left-hand firebomb throw, the Lance's spray shake and pilot-flame flare.
// The core's motion values ({bob, recoil, sway, switchT}) are layered on top when main.js passes them.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { FIRELIGHT } from '../shared/firelight.js';
import { TIMELINE } from '../shared/timeline.js';
import { gfx } from '../gfx/current.js';

const TEX_NAMES = ['leather', 'brass', 'iron', 'wood', 'cloth', 'strap'];
const FALLBACK = { leather: 0x4a2a1c, brass: 0xa07428, iron: 0x3a3e44, wood: 0x6a4424, cloth: 0x3c3e30, strap: 0x6a2a1c };

function standInTex(name) {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  const col = new THREE.Color(FALLBACK[name]);
  for (let y = 0; y < 64; y += 4) for (let x = 0; x < 64; x += 4) {
    const k = 0.8 + Math.random() * 0.35;
    g.fillStyle = `rgb(${(col.r * 255 * k) | 0},${(col.g * 255 * k) | 0},${(col.b * 255 * k) | 0})`;
    g.fillRect(x, y, 4, 4);
  }
  return new THREE.CanvasTexture(c);
}

async function loadTextures(base, versions = {}) {
  const loader = new THREE.TextureLoader();
  const out = {};
  await Promise.all(TEX_NAMES.map(async (n) => {
    let t;
    const v = versions?.[n];   // content-versioned like the atlas (actors.json `vm`)
    try { t = await loader.loadAsync(`${base}models/viewmodel/${n}.png${v ? `?v=${v}` : ''}`); } catch { t = standInTex(n); }
    t.colorSpace = THREE.SRGBColorSpace;
    t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestMipmapLinearFilter;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    out[n] = t;
  }));
  return out;
}

const deg = Math.PI / 180;

export async function createViewmodel({ assetsBase, camera: worldCamera, versions }) {
  const tex = await loadTextures(assetsBase, versions);
  const scene = new THREE.Scene();
  scene.name = 'actors.viewmodel';
  const camera = new THREE.PerspectiveCamera(60, worldCamera?.aspect || 16 / 9, 0.01, 10);
  scene.add(camera);

  // lights (constant count): cool hemisphere fill, the moon, the fire around the player (FIRELIGHT.nearCamera), and a
  // warm point at the muzzle/nozzle (pilot flame, the Lance's jet, muzzle flashes)
  // grey and dim on purpose (an earlier saturated cyan fill turned the brown leather olive and the iron blue in
  // the graded frame), plus a soft fill from behind the camera so the faces the player sees (gloves, tank) read
  const hemi = new THREE.HemisphereLight(0xa8b6ba, 0x2a2826, 2.3);
  const moon = new THREE.DirectionalLight(0xb4d0d8, 1.5); moon.position.set(-1.2, 1.6, 0.9);
  const camFill = new THREE.DirectionalLight(0xd0ccc4, 1.3); camFill.position.set(0.3, 0.45, 1.0);
  const fire = new THREE.DirectionalLight(0xff8a3a, 0); fire.position.set(0.3, -0.6, -1.0);
  const nozzleLight = new THREE.PointLight(0xff9a40, 0, 1.4, 1.6);
  scene.add(hemi, moon, camFill, fire, nozzleLight);

  const mats = {};
  const LIFT = { leather: 1.3, strap: 1.2, cloth: 0.9, iron: 1.15, wood: 1.0, brass: 0.82 }; // the graded swatches under a night light
  for (const n of TEX_NAMES) mats[n] = new THREE.MeshLambertMaterial({ map: tex[n], flatShading: true, color: new THREE.Color().setScalar(LIFT[n]) });
  // the Lance's metal is warm dark bronze like M1's (the iron swatch tinted warm; same program as
  // every other viewmodel part), not the cool iron that read navy under the night light
  mats.bronze = new THREE.MeshLambertMaterial({ map: tex.iron, flatShading: true, color: new THREE.Color(1.3, 0.72, 0.34) });
  const box = (w, h, d, m, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => {
    const g = new THREE.BoxGeometry(w, h, d);
    const mesh = new THREE.Mesh(g, mats[m]);
    mesh.position.set(x, y, z); mesh.rotation.set(rx, ry, rz);
    return mesh;
  };
  // cylinder along -Z (front) from z0 to z1; rFront at z1 (more negative), rBack at z0
  const tube = (rBack, rFront, z0, z1, m, x = 0, y = 0, seg = 8) => {
    const g = new THREE.CylinderGeometry(rFront, rBack, Math.abs(z1 - z0), seg, 1);
    g.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(g, mats[m]);
    mesh.position.set(x, y, (z0 + z1) / 2);
    return mesh;
  };

  // ---------------------------------------------------------------- hands
  // STORY hint 1 ("the gloves smoulder"): thin ember seams at the fingertips, over the knuckles and on the cuff,
  // drawn additively and only while the Lance fires or the player stands in fire (else the material is hidden: 0 draws)
  const smoulderMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: true });
  smoulderMat.visible = false;
  mats.smoulder = smoulderMat;
  // DESIGN §12 (the gloves beat): the gloves have their own leather/strap materials so they alone char to black, and black
  // claws (hidden until the burn) grow from the fingertips
  mats.gloveLeather = mats.leather.clone(); mats.gloveStrap = mats.strap.clone();
  mats.claw = new THREE.MeshLambertMaterial({ color: 0x0b0908, flatShading: true, emissive: new THREE.Color(0.12, 0.02, 0.0) });
  mats.claw.visible = false;
  function glove(side /* 1 right, -1 left */) {
    const g = new THREE.Group();
    for (let f = 0; f < 4; f++) {                                              // the claws (merged by bake into one mesh)
      const fy = 0.03 - f * 0.024;
      for (const cx of [0.006 * side, 0.03 * side]) {
        const c = new THREE.Mesh(new THREE.ConeGeometry(0.0075, 0.05, 4), mats.claw);
        c.rotation.x = -Math.PI / 2 - 0.25; c.position.set(cx, fy - 0.004, -0.085); g.add(c);
      }
    }
    const seam = (w, x, y, z, h = 0.0035, d = 0.0035) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), smoulderMat); m.position.set(x, y, z); g.add(m); };
    for (let f = 0; f < 4; f++) {
      const fy = 0.03 - f * 0.024;
      seam(0.024, 0.006 * side, fy + 0.0085, -0.0655);                         // fingertip seams (front top edge)
      seam(0.02, 0.03 * side, fy + 0.0065, -0.0655);
      seam(0.0035, 0.006 * side + 0.012 * side, fy, -0.0655, 0.017);            // a side seam down one finger
    }
    seam(0.097, 0, 0.0385, -0.0195);                                            // under the knuckle strap
    seam(0.098, 0, 0.0503, -0.019, 0.002, 0.002);                               // the knuckle strap's front top edge (seen)
    seam(0.002, 0.022, 0.0458, 0.03, 0.0018, 0.022);                            // two stitched seams down the back of the hand
    seam(0.002, -0.022, 0.0458, 0.03, 0.0018, 0.022);
    seam(0.1, 0, 0.0255, 0.0395);                                               // the cuff's top edge
    seam(0.1, 0, 0.0255, 0.0395 + 0.0005, 0.0035, 0.0035);
    seam(0.0035, -0.035 * side, 0.06, -0.05, 0.0035, 0.03);                    // the thumb's seam
    g.add(box(0.084, 0.09, 0.08, 'gloveLeather', 0, 0, 0.004));                    // the back of the hand around a grip
    for (let f = 0; f < 4; f++) {                                              // four curled fingers (read as a glove)
      const fy = 0.03 - f * 0.024;
      g.add(box(0.026, 0.021, 0.03, 'gloveLeather', 0.006 * side, fy, -0.05, 0, 0, 0));
      g.add(box(0.022, 0.019, 0.026, 'gloveLeather', 0.03 * side, fy - 0.002, -0.052, 0, 0, 0));
    }
    g.add(box(0.096, 0.012, 0.03, 'gloveStrap', 0, 0.044, -0.004));                // a stitched seam over the knuckles
    g.add(box(0.028, 0.028, 0.06, 'gloveLeather', -0.035 * side, 0.045, -0.02, 0.3, 0, 0)); // thumb over the top
    g.add(box(0.098, 0.07, 0.06, 'gloveStrap', 0, -0.01, 0.07));                  // cuff
    const sleeve = tube(0.052, 0.046, 0.08, 0.55, 'cloth', 0, 0, 7);
    sleeve.position.set(0.02 * side, -0.07, 0.3); sleeve.rotation.set(-0.42, 0.18 * side, 0);
    g.add(sleeve);
    return g;
  }

  // ---------------------------------------------------------------- weapons (muzzle socket = an Object3D at the tip)
  function kestrel() {
    const g = new THREE.Group();
    g.add(tube(0.016, 0.016, -0.02, -0.27, 'iron', 0, 0.055));                // barrel
    g.add(tube(0.021, 0.021, -0.255, -0.28, 'brass', 0, 0.055));              // muzzle ring
    g.add(tube(0.02, 0.02, -0.02, -0.05, 'brass', 0, 0.055));                 // breech ring
    g.add(box(0.034, 0.028, 0.23, 'wood', 0, 0.03, -0.12));                    // stock under the barrel
    g.add(box(0.032, 0.115, 0.048, 'wood', 0, -0.025, 0.035, 0.38, 0, 0));     // grip, raked back
    g.add(box(0.038, 0.03, 0.055, 'brass', 0, -0.085, 0.06, 0.38, 0, 0));      // butt cap
    g.add(box(0.008, 0.032, 0.07, 'iron', 0.02, 0.05, -0.015));                // lock plate
    g.add(box(0.008, 0.028, 0.012, 'iron', 0.021, 0.074, 0.022, -0.55, 0, 0)); // hammer (cock)
    g.add(box(0.008, 0.008, 0.06, 'brass', 0, -0.0, -0.01));                   // trigger guard bottom
    const m = new THREE.Object3D(); m.position.set(0, 0.055, -0.29); g.add(m);
    return { group: g, muzzle: m, left: null, pose: new THREE.Vector3(0.145, -0.13, -0.36), yaw: 4 * deg, pitch: 1 * deg };
  }
  function blunderbuss() {
    const g = new THREE.Group();
    g.add(tube(0.02, 0.046, -0.12, -0.56, 'brass', 0, 0.065, 9));            // flared brass barrel
    g.add(tube(0.05, 0.05, -0.545, -0.565, 'brass', 0, 0.065, 9));           // lip
    g.add(box(0.05, 0.04, 0.38, 'wood', 0, 0.028, -0.2));                     // forestock
    g.add(tube(0.026, 0.026, -0.2, -0.22, 'iron', 0, 0.06));                 // bands
    g.add(tube(0.03, 0.03, -0.36, -0.38, 'iron', 0, 0.06));
    g.add(box(0.044, 0.07, 0.2, 'wood', 0, -0.0, 0.1, 0.2, 0, 0));            // wrist + butt (runs out of view)
    g.add(box(0.034, 0.105, 0.05, 'wood', 0, -0.035, 0.03, 0.42, 0, 0));      // pistol grip
    g.add(box(0.008, 0.036, 0.08, 'iron', 0.026, 0.055, -0.06));               // lock
    g.add(box(0.008, 0.032, 0.013, 'iron', 0.027, 0.084, -0.016, -0.55, 0, 0)); // hammer
    const m = new THREE.Object3D(); m.position.set(0, 0.065, -0.57); g.add(m);
    return { group: g, muzzle: m, left: { pos: new THREE.Vector3(-0.005, -0.02, -0.3), rot: new THREE.Euler(0.1, 0.25, 0.5) }, pose: new THREE.Vector3(0.165, -0.19, -0.24), yaw: 3 * deg, pitch: 1 * deg };
  }
  let pilot = null;
  // M1/M2's composition. The Lance is compact (the brass tank sits under the rear half of the
  // barrel, as in the key art), held low and right with its barrel almost parallel to the view axis, so perspective
  // draws it from the bottom-right corner up toward the crosshair: the nozzle lands at ≈ 58 % x / 62 % y, the screen
  // centre stays clear and the jet (aimed at the crosshair) leaves the nozzle across the frame, seen from the side.
  function lance() {
    const g = new THREE.Group();
    g.add(tube(0.085, 0.085, 0.12, -0.3, 'brass', 0.07, -0.045, 12));        // the dented brass tank (right, under the barrel)
    g.add(tube(0.089, 0.089, 0.06, 0.08, 'bronze', 0.07, -0.045, 12));         // bands
    g.add(tube(0.089, 0.089, -0.19, -0.21, 'bronze', 0.07, -0.045, 12));
    g.add(tube(0.064, 0.078, -0.3, -0.33, 'bronze', 0.07, -0.045, 12));        // front cap
    g.add(box(0.036, 0.04, 0.036, 'bronze', 0.085, 0.05, -0.24));                // valve block on top of the tank's front
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.008, 8), mats.brass);
    wheel.position.set(0.085, 0.074, -0.24); g.add(wheel);
    g.add(tube(0.024, 0.024, -0.05, -0.56, 'bronze', 0, 0.045, 8));            // the iron barrel pipe
    for (let i = 0; i < 4; i++) g.add(tube(0.029, 0.029, -0.42 - i * 0.03, -0.432 - i * 0.03, 'bronze', 0, 0.045, 8)); // ribs
    g.add(tube(0.026, 0.05, -0.55, -0.63, 'bronze', 0, 0.045, 9));             // flared nozzle
    g.add(tube(0.052, 0.052, -0.615, -0.632, 'brass', 0, 0.045, 9));         // brass lip
    g.add(box(0.016, 0.016, 0.16, 'bronze', 0.035, 0.035, -0.26, 0, -0.35, 0));  // feed pipe tank → barrel
    g.add(box(0.034, 0.034, 0.06, 'bronze', 0.0, 0.045, -0.03));                  // breech block
    g.add(box(0.03, 0.075, 0.04, 'strap', 0, -0.0, -0.42, 0.15, 0, 0));         // front grip (leather wrapped)
    g.add(box(0.032, 0.1, 0.045, 'wood', 0, -0.02, 0.0, 0.3, 0, 0));          // rear pistol grip (right hand, below the frame)
    // pilot light: a small iron cup on top of the barrel ahead of the tank, with a blue core and an orange tip (additive)
    g.add(box(0.022, 0.03, 0.022, 'bronze', 0, 0.085, -0.37));
    const p = new THREE.Group(); p.position.set(0, 0.105, -0.37);
    const core = new THREE.Mesh(new THREE.ConeGeometry(0.007, 0.016, 6), new THREE.MeshBasicMaterial({ color: 0x4a8cff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
    core.position.y = 0.008;
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.011, 0.026, 6), new THREE.MeshBasicMaterial({ color: 0xff9a2e, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }));
    tip.position.y = 0.016;
    p.add(tip, core); g.add(p);
    p.userData.keep = true;
    pilot = p;
    const m = new THREE.Object3D(); m.position.set(0, 0.045, -0.635); g.add(m);
    return { group: g, muzzle: m,
      left: { pos: new THREE.Vector3(-0.03, -0.05, -0.43), rot: new THREE.Euler(0.25, 0.3, 0.6) },
      pose: new THREE.Vector3(0.245, -0.17, -0.2), yaw: 10 * deg, pitch: 1 * deg };   // the barrel points just left of the crosshair (≈ 43 % x at 10 m), nozzle still 58 % / 62 %
  }

  /** Merge a group's static meshes by material (one draw per material; animated parts carry userData.keep). */
  function bake(group) {
    group.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(group.matrixWorld).invert();
    const byMat = new Map(), gone = [];
    group.traverse((o) => {
      if (!o.isMesh) return;
      for (let q = o; q && q !== group; q = q.parent) if (q.userData.keep) return;
      const g = o.geometry.index ? o.geometry.clone() : o.geometry.clone();
      g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
      if (!byMat.has(o.material)) byMat.set(o.material, []);
      byMat.get(o.material).push(g); gone.push(o);
    });
    for (const o of gone) { o.parent.remove(o); o.geometry.dispose(); }
    for (const [m, gs] of byMat) {
      const merged = mergeGeometries(gs, false);
      gs.forEach((g) => g.dispose());
      if (merged) group.add(new THREE.Mesh(merged, m));
    }
    return group;
  }

  // ---------------------------------------------------------------- DESIGN §4.2: the THUNDER ORGAN (slot 2 when owned)
  // a brass rotary gun: six brass barrels on a rotor (spins with the spin state), iron end plates, a brass receiver, a
  // side drum, a hand crank (turns with the rotor), wooden twin grips; the barrels glow with heat (their own material)
  mats.organBarrel = new THREE.MeshLambertMaterial({ map: tex.brass, flatShading: true, color: new THREE.Color().setScalar(0.9), emissive: new THREE.Color(0, 0, 0) });
  let organRotor = null, organCrank = null;
  function organ() {
    const g = new THREE.Group();
    const rotor = new THREE.Group(); rotor.position.set(0, 0.062, 0);
    for (let k = 0; k < 6; k++) {
      const a = k * Math.PI / 3, x = Math.cos(a) * 0.031, y = Math.sin(a) * 0.031;
      const b = tube(0.0105, 0.0105, -0.12, -0.6, 'organBarrel', x, y, 6); rotor.add(b);
      const bore = tube(0.006, 0.006, -0.598, -0.606, 'iron', x, y, 6); rotor.add(bore);
    }
    rotor.add(tube(0.012, 0.012, -0.1, -0.6, 'iron', 0, 0, 6));                          // the axle
    for (const z of [-0.2, -0.42, -0.58]) rotor.add(tube(0.047, 0.047, z + 0.008, z - 0.008, 'iron', 0, 0, 6));   // barrel clamps
    bake(rotor); rotor.userData.keep = true; g.add(rotor);
    g.add(tube(0.058, 0.058, 0.06, -0.12, 'brass', 0, 0.062, 8));                        // the receiver (brass drum housing)
    g.add(tube(0.062, 0.062, -0.1, -0.125, 'iron', 0, 0.062, 8));                        // its front ring
    const drum = new THREE.CylinderGeometry(0.05, 0.05, 0.05, 10); drum.rotateZ(Math.PI / 2);
    const drumM = new THREE.Mesh(drum, mats.iron); drumM.position.set(-0.07, 0.07, -0.02); g.add(drumM);   // the ammunition drum (left)
    g.add(box(0.03, 0.03, 0.08, 'brass', -0.04, 0.065, -0.02));                          // its feed
    g.add(box(0.034, 0.1, 0.045, 'wood', 0, -0.03, 0.05, 0.35, 0, 0));                   // rear grip (right hand)
    g.add(box(0.03, 0.085, 0.04, 'wood', 0, -0.02, -0.3, 0.1, 0, 0));                     // front grip under the barrels (left hand)
    g.add(box(0.012, 0.03, 0.2, 'iron', 0, 0.0, -0.2));                                   // the grip rail
    const crank = new THREE.Group(); crank.position.set(0.064, 0.062, 0.0);
    crank.add(box(0.008, 0.075, 0.012, 'iron', 0.004, -0.03, 0));                         // the crank arm
    crank.add(box(0.03, 0.016, 0.016, 'wood', 0.02, -0.066, 0));                          // its handle
    bake(crank); crank.userData.keep = true; g.add(crank);
    organRotor = rotor; organCrank = crank;
    const m = new THREE.Object3D(); m.position.set(0, 0.062, -0.615); g.add(m);
    return { group: g, muzzle: m, left: { pos: new THREE.Vector3(-0.01, -0.06, -0.3), rot: new THREE.Euler(0.15, 0.2, 0.45) },
      pose: new THREE.Vector3(0.175, -0.2, -0.22), yaw: 4 * deg, pitch: 1 * deg };
  }

  const rig = new THREE.Group(); camera.add(rig);
  const weapons = { pistol: kestrel(), blunderbuss: blunderbuss(), lance: lance(), organ: organ() };
  /** The sim's weapon id → ours (the minigun id is the sim's; any of these names draws the Thunder Organ). */
  const wid = (w) => (w === 'minigun' || w === 'organ' || w === 'thunder' || w === 'thunderOrgan' ? 'organ' : w);
  for (const w of Object.values(weapons)) bake(w.group);
  const rightHand = bake(glove(1));
  const leftHand = bake(glove(-1));
  // DESIGN §12: real flames lick up from the burning gloves (camera-space cones, always pointing up), and the claw
  // meshes (merged per hand by bake) grow out of the fingertips
  const flameOuter = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.42, 0.08), transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false });
  const flameInner = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.85, 0.35), transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false });
  mats.flameOuter = flameOuter; mats.flameInner = flameInner;
  const flameGeo = new THREE.ConeGeometry(0.014, 0.075, 5, 1, true); flameGeo.translate(0, 0.0375, 0);
  // [hand-space anchor x (× side), y, z, size, inner?]
  const FLAME_SPOTS = [[0.006, 0.042, -0.07, 1.1, 0], [0.03, 0.036, -0.07, 1.0, 0], [0.006, 0.0, -0.07, 0.9, 0], [0.03, -0.02, -0.07, 0.85, 0],
    [0.0, 0.05, -0.01, 1.25, 0], [-0.03, 0.05, 0.03, 0.9, 0], [0.012, 0.04, -0.06, 0.8, 1], [0.0, 0.05, 0.0, 0.9, 1], [-0.02, 0.04, 0.03, 0.7, 1]];
  const flames = [];
  for (const [hi, hand] of [[0, rightHand], [1, leftHand]]) {
    for (let k = 0; k < FLAME_SPOTS.length; k++) {
      const f = FLAME_SPOTS[k];
      const m = new THREE.Mesh(flameGeo, f[4] ? flameInner : flameOuter);
      m.visible = false; m.frustumCulled = false; m.renderOrder = 5;
      camera.add(m);
      flames.push({ m, hand, side: hi === 0 ? 1 : -1, at: new THREE.Vector3(f[0] * (hi === 0 ? 1 : -1), f[1], f[2]), size: f[3], ph: k * 1.7 + hi * 3.1, inner: !!f[4] });
    }
  }
  const clawMeshes = [];
  for (const hand of [rightHand, leftHand]) hand.traverse((o) => { if (o.isMesh && o.material === mats.claw) clawMeshes.push(o); });
  const fv = new THREE.Vector3();
  // tiny sparks rising off the seams while the gloves smoulder (pixel-sized points, additive; hidden when cold)
  const SPARKS = 10;
  const SEAM_SPOTS = [[0.006, 0.04, -0.066], [0.03, 0.035, -0.066], [0.006, 0.015, -0.066], [0.03, 0.0, -0.066], [0.0, 0.04, -0.02], [-0.03, 0.026, 0.04]];
  const sparkSets = [rightHand, leftHand].map((hand, hi) => {
    // 3-px points per edition (src/gfx/<edition>/materials/actors.js): WebGPU draws a Points object 1 px wide, so there
    // the sparks are an instanced sprite; either way `geo.attributes.position / color` are the arrays written below
    const { pts, geo } = gfx().materials.actorSparkPoints({ count: SPARKS });
    pts.frustumCulled = false; pts.visible = false;
    hand.add(pts);
    const side = hi === 0 ? 1 : -1;
    return { pts, geo, side, life: new Float32Array(SPARKS), age: new Float32Array(SPARKS).fill(9), v: new Float32Array(SPARKS * 3) };
  });
  let smoulder = 0, sparkAcc = 0;
  // left-hand firebomb (thrown with the left hand)
  const bombPot = new THREE.Group();
  bombPot.add(new THREE.Mesh(new THREE.SphereGeometry(0.045, 7, 5), new THREE.MeshLambertMaterial({ color: 0x8a4a2a, flatShading: true })));
  const rag = box(0.016, 0.04, 0.016, 'cloth', 0, 0.055, 0);
  bombPot.add(rag);
  const ragFlame = new THREE.Mesh(new THREE.ConeGeometry(0.014, 0.05, 5), new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
  ragFlame.position.y = 0.095; bombPot.add(ragFlame);
  bombPot.position.set(0, 0.07, -0.02);
  leftHand.add(bombPot);
  const holder = new THREE.Group(); rig.add(holder);
  for (const w of Object.values(weapons)) { w.group.visible = false; holder.add(w.group); }
  holder.add(rightHand);
  rig.add(leftHand);

  let shown = 'pistol', target = 'pistol';
  weapons[shown].group.visible = true;
  const O = { spin: 0, angle: 0, heat: 0, lock: 0, shotT: 9 };   // the Thunder Organ's own state (when the sim gives none)
  const S = { sw: 0, lowering: false, recoil: 0, recoilT: 9, recoilKind: 'pistol', reloadT: 9, reloadDur: 1, throwT: 9, spray: 0, sprayOn: false,
    bobPh: 0, t: 0, prevYaw: null, prevPitch: null, swayX: 0, swayY: 0, hurtT: 9, dryT: 9, flashT: 9, landT: 9 };

  function setWeapon(name) {
    for (const [k, w] of Object.entries(weapons)) w.group.visible = k === name;
    shown = name;
    const w = weapons[name];
    if (w.right) { rightHand.position.copy(w.right.pos); rightHand.rotation.copy(w.right.rot); }
    else { rightHand.position.set(0, -0.035, 0.035); rightHand.rotation.set(0.38, 0, 0); }
    bombPot.visible = false;
    leftHand.visible = !!w.left;
  }
  setWeapon('pistol');

  function onEvent(ev) {
    switch (ev.type) {
      case 'weapon.shot':
        if (wid(ev.weapon) === 'organ') { O.shotT = 0; S.flashT = 0; break; }   // 18 rounds/s: a shake, not a kick per round
        S.recoilT = 0; S.recoilKind = ev.weapon || shown; S.flashT = 0; break;
      case 'weapon.reload': S.reloadT = 0; S.reloadDur = Math.max(0.4, ev.seconds || 1.2); break;
      case 'weapon.switch': if (ev.weapon && weapons[wid(ev.weapon)]) target = wid(ev.weapon); break;
      case 'bomb.throw': S.throwT = 0; break;
      case 'lance.on': S.sprayOn = true; break;
      case 'lance.off': S.sprayOn = false; break;
      case 'weapon.dry': S.dryT = 0; break;
      case 'player.hurt': S.hurtT = 0; break;
      case 'player.land': S.landT = 0; break;
      case 'retry': S.reloadT = 9; S.throwT = 9; S.sprayOn = false; break;
      default: break;
    }
  }

  const ease = (x) => x * x * (3 - 2 * x);
  const tmpV = new THREE.Vector3(), tmpW = new THREE.Vector3();

  let endOverride = null;
  const BURN = { at: (TIMELINE?.ending?.beats || []).find((b) => b.id === 'gloves')?.at ?? 25, dur: 1.5 };
  const REVEAL = (TIMELINE?.ending?.beats || []).find((b) => b.id === 'reveal')?.at ?? 29;   // the lens leaves the head: no hands
  const baseLeather = mats.gloveLeather.color.clone(), baseStrap = mats.gloveStrap.color.clone();
  let endHands = false, endHandsFlame = 0;
  function update(dt, state, motion) {
    S.t += dt;
    const endT = endOverride != null ? endOverride : state?.mode === 'ending' ? (state.ending?.t ?? state.modeT ?? null) : null;
    const p = state?.player;
    camera.aspect = worldCamera?.aspect || camera.aspect;
    camera.updateProjectionMatrix();
    // weapon switch: lower (0.16 s) → swap → raise (0.22 s)
    if (p?.weapon && weapons[wid(p.weapon)]) target = wid(p.weapon);
    if (target !== shown) { S.sw = Math.min(1, S.sw + dt / 0.16); if (S.sw >= 1) setWeapon(target); }
    else S.sw = Math.max(0, S.sw - dt / 0.22);
    const w = weapons[shown];
    let lower = ease(S.sw);
    if (motion && typeof motion.switchT === 'number') lower = Math.max(lower, Math.min(1, motion.switchT));

    // walk bob (from the core's motion, else from the player's speed)
    let bx = 0, by = 0;
    if (motion?.bob && typeof motion.bob === 'object') { bx = motion.bob.x || 0; by = motion.bob.y || 0; }
    else {
      const sp = p ? Math.hypot(p.vx || 0, p.vz || 0) : 0;
      const onG = p ? p.onGround !== false : true;
      if (typeof motion?.bob === 'number') S.bobPh = motion.bob; else S.bobPh += dt * (onG ? sp * 1.25 : 0);
      const amp = Math.min(1, sp / 6) * (onG ? 1 : 0.2);
      bx = Math.sin(S.bobPh) * 0.011 * amp; by = -Math.abs(Math.cos(S.bobPh)) * 0.014 * amp;
    }
    // sway: the core's value, else lag behind look changes
    let sx = 0, sy = 0;
    if (motion?.sway && typeof motion.sway === 'object') { sx = motion.sway.x || 0; sy = motion.sway.y || 0; }
    else if (p) {
      if (S.prevYaw == null) { S.prevYaw = p.yaw || 0; S.prevPitch = p.pitch || 0; }
      let dy = (p.yaw || 0) - S.prevYaw; if (dy > Math.PI) dy -= 2 * Math.PI; if (dy < -Math.PI) dy += 2 * Math.PI;
      S.swayX += dy * 0.35; S.swayY += ((p.pitch || 0) - S.prevPitch) * 0.35;
      S.prevYaw = p.yaw || 0; S.prevPitch = p.pitch || 0;
      const k = Math.exp(-dt * 9); S.swayX = Math.max(-0.08, Math.min(0.08, S.swayX * k)); S.swayY = Math.max(-0.06, Math.min(0.06, S.swayY * k));
      sx = S.swayX; sy = S.swayY;
    }
    // recoil on SHOT (+ the core's recoil value)
    S.recoilT += dt;
    const heavy = S.recoilKind === 'blunderbuss';
    const kick = S.recoilT < 0.6 ? Math.exp(-S.recoilT * (heavy ? 11 : 17)) * (1 - Math.exp(-S.recoilT * 120)) : 0;
    const rec = kick * (heavy ? 1.7 : 1) + (typeof motion?.recoil === 'number' ? motion.recoil : 0);
    // reload: tilt down-left and roll, the left hand pumps at the muzzle (ramrod) for muzzle-loaders
    S.reloadT += dt;
    const rl = S.reloadT < S.reloadDur ? S.reloadT / S.reloadDur : 1;
    const rEnv = rl < 1 ? ease(Math.min(1, rl / 0.22)) * ease(Math.min(1, (1 - rl) / 0.22)) : 0;
    // firebomb throw (left hand), 0.45 s
    S.throwT += dt;
    const th = S.throwT < 0.45 ? S.throwT / 0.45 : 1;   // the sim releases the bomb at the press: a quick fling
    // Lance spray: shake + pilot flare
    const spraying = shown === 'lance' && (S.sprayOn || (p && p.firing && p.weapon === 'lance' && (p.fuel == null || p.fuel > 0)));
    S.spray += ((spraying ? 1 : 0) - S.spray) * Math.min(1, dt * (spraying ? 14 : 6));
    S.hurtT += dt; S.dryT += dt; S.flashT += dt; S.landT += dt;
    const hurt = S.hurtT < 0.35 ? Math.sin(S.hurtT / 0.35 * Math.PI) : 0;
    const dry = S.dryT < 0.15 ? Math.sin(S.dryT / 0.15 * Math.PI) : 0;
    const land = S.landT < 0.3 ? Math.sin(S.landT / 0.3 * Math.PI) : 0;

    // the Thunder Organ (DESIGN §4.2): spin-up 0.45 s / spin-down ≈ 0.9 s, 18 rounds/s from six barrels = 3 rev/s; heat
    // over 6 s of fire, a 1.5 s lock when it overheats. The sim's state wins when present (spin 0..1, heat 0..1, overheat).
    O.shotT += dt;
    if (shown === 'organ') {
      const mg = p?.minigun || p?.organ || null;
      const cs = typeof p?.spin === 'number' ? p.spin : typeof mg?.spin === 'number' ? mg.spin : null;
      const ch = typeof p?.heat === 'number' ? p.heat : typeof mg?.heat === 'number' ? mg.heat : null;
      const over = !!(p?.overheated || mg?.overheated || (p?.overheatT ?? mg?.overheatT ?? mg?.lockT ?? 0) > 0);
      const trig = !!(p && p.firing && wid(p.weapon) === 'organ');
      if (O.lock > 0) O.lock -= dt;
      if (cs != null) O.spin = Math.max(0, Math.min(1, cs));
      else O.spin = Math.max(0, Math.min(1, O.spin + (trig && O.lock <= 0 ? dt / 0.45 : -dt / 0.9)));
      if (ch != null) O.heat = Math.max(0, Math.min(1, ch));
      else { O.heat = Math.max(0, Math.min(1, O.heat + (trig && O.spin >= 1 && O.lock <= 0 ? dt / 6 : -dt / 2.5))); if (O.heat >= 1) O.lock = 1.5; }
      O.over = over || O.lock > 0;
      O.firing = typeof mg?.firing === 'boolean' ? mg.firing && !O.over : (trig && O.spin >= 0.98 && !O.over) || O.shotT < 0.08;   // the sim's player.organ.firing
      O.angle += dt * O.spin * 3 * Math.PI * 2;
      if (organRotor) organRotor.rotation.z = O.angle;
      if (organCrank) organCrank.rotation.x = -O.angle * 0.5;
      // barrel heat: dull red → orange, pulsing when overheated (emissive, so it reads in the dark)
      const hk = Math.max(0, (O.heat - 0.35) / 0.65);   // no glow in short bursts; dull red past ≈ 60 %, bright at the lock
      const hh = hk * hk * (O.over ? 0.85 + 0.15 * Math.sin(S.t * 18) : 1);
      mats.organBarrel.emissive.setRGB(1.4 * hh, 0.32 * hh * hh + 0.05 * hh, 0.03 * hh);
    } else { O.spin = Math.max(0, O.spin - dt / 0.9); O.firing = false; }
    // compose the holder transform (camera space)
    const idleX = Math.sin(S.t * 0.9) * 0.0025, idleY = Math.sin(S.t * 1.3) * 0.003;
    const shake = S.spray * 0.0035 + (shown === 'organ' ? (O.firing ? 0.0045 : O.spin * 0.0008) : 0);
    const jx = shake * (Math.sin(S.t * 71) + Math.sin(S.t * 113) * 0.5), jy = shake * (Math.sin(S.t * 83 + 1) + Math.sin(S.t * 127) * 0.5);
    holder.position.set(
      w.pose.x + bx + idleX - sx * 0.6 + jx - rEnv * 0.05 + (th < 1 ? Math.sin(th * Math.PI) * 0.02 : 0),
      w.pose.y + by + idleY - sy * 0.5 + jy - lower * 0.28 - rEnv * 0.06 - land * 0.025 - hurt * 0.02 - (th < 1 ? Math.sin(th * Math.PI) * 0.04 : 0),
      w.pose.z + rec * (heavy ? 0.075 : 0.05) + dry * 0.006 + (shown === 'organ' && O.firing ? 0.006 + 0.004 * Math.sin(S.t * 113) : 0),
    );
    holder.rotation.set(
      (w.pitch || 0) + rec * (heavy ? 0.32 : 0.22) + lower * -0.6 + rEnv * 0.55 + sy * 1.2 + hurt * 0.1 + dry * 0.04,
      w.yaw + sx * 1.5 + rEnv * 0.35,
      rEnv * 0.65 + sx * 0.8 + jx * 4 + hurt * -0.08,
    );
    // left hand: holds the barrel (blunderbuss, lance), pumps the ramrod on reload, throws the firebomb
    const L = w.left;
    if (th < 1) {
      if (leftHand.parent !== rig) rig.add(leftHand);
      leftHand.visible = true; bombPot.visible = th < 0.4; ragFlame.scale.setScalar(0.8 + 0.4 * Math.sin(S.t * 40));
      // up from below-left → wind back beside the head → fling forward → drop away (the sleeve always points down-back,
      // out of the frame)
      const a = th < 0.45 ? ease(th / 0.45) : 1, b = th >= 0.45 ? ease(Math.min(1, (th - 0.45) / 0.2)) : 0, c = th > 0.68 ? ease((th - 0.68) / 0.32) : 0;
      leftHand.position.set(-0.22 + a * 0.05 + b * 0.09 - c * 0.02, -0.34 + a * 0.29 + b * 0.05 - c * 0.32, -0.3 + a * 0.03 - b * 0.27 + c * 0.05);
      leftHand.rotation.set(0.6 + b * 0.6 - c * 0.2, 0.25, 0.3 - b * 0.15);
    } else if (L) {
      if (leftHand.parent !== holder) holder.add(leftHand);
      leftHand.visible = true; bombPot.visible = false;
      leftHand.position.copy(L.pos);
      if (rEnv > 0) leftHand.position.y += rEnv * 0.06 + Math.max(0, Math.sin(rl * Math.PI * 6)) * 0.025 * rEnv;
      leftHand.rotation.copy(L.rot);
    } else if (rEnv > 0) {
      if (leftHand.parent !== holder) holder.add(leftHand);
      leftHand.visible = true; bombPot.visible = false;
      leftHand.position.set(-0.04, 0.02 + Math.max(0, Math.sin(rl * Math.PI * 6)) * 0.035 - 0.1 * (1 - rEnv), -0.24);
      leftHand.rotation.set(0.9, 0.35, 0.25);
    } else leftHand.visible = false;

    // pilot flame + the warm point light at the nozzle (spray / muzzle flash)
    if (pilot) {
      const f = 1 + S.spray * 0.6 + 0.12 * Math.sin(S.t * 31) + 0.08 * Math.sin(S.t * 53);
      pilot.scale.set(1 + S.spray * 0.6, f, 1 + S.spray * 0.6);
    }
    w.muzzle.getWorldPosition(tmpV);  // camera.matrixWorld is identity in the vm scene → camera space
    nozzleLight.position.copy(tmpV);
    const flash = shown === 'organ' ? (O.firing ? 0.7 + 0.6 * Math.abs(Math.sin(S.t * 57)) : 0)   // dim: the barrels' heat glow must stay the cue
      : S.flashT < 0.07 && shown !== 'lance' ? (1 - S.flashT / 0.07) * (heavy ? 5 : 3) : 0;
    nozzleLight.intensity = (shown === 'lance' ? 0.25 + S.spray * 2.6 : 0) + flash;
    if (endHandsFlame > 0) { nozzleLight.position.set(0, -0.06, -0.26); nozzleLight.intensity = 1.6 * endHandsFlame * (0.85 + 0.15 * Math.sin(S.t * 21)); }
    // the fire around the player lights the hands (the fire code writes FIRELIGHT.nearCamera every frame)
    const nc = FIRELIGHT.nearCamera;
    const nl = Math.max(nc.r, nc.g, nc.b);
    fire.color.setRGB(nl > 0 ? nc.r / nl : 1, nl > 0 ? nc.g / nl : 0.5, nl > 0 ? nc.b / nl : 0.2);
    fire.intensity = Math.min(4, nl * 2.2);
    // the gloves smoulder (STORY hint 1): while the Lance sprays, and fainter while the player stands in fire
    const inFire = nl > 0.6 ? Math.min(1, (nl - 0.6) / 1.0) * 0.55 : 0;
    const want = Math.max(spraying ? 1 : 0, inFire);
    smoulder += (want - smoulder) * Math.min(1, dt * (want > smoulder ? 4 : 0.7));
    const flick = 0.82 + 0.12 * Math.sin(S.t * 13.1) + 0.06 * Math.sin(S.t * 31.7);
    const sv = smoulder > 0.02 ? (0.12 + 0.9 * smoulder) * flick : 0;
    smoulderMat.visible = sv > 0;
    smoulderMat.color.setRGB(0.62 * sv, 0.12 * sv, 0.014 * sv);  // ember red-orange, never yellow-white; subtle (STORY: a hint)
    // DESIGN §12, the gloves beat: from 1 s before it, the weapon is gone and both hands rise in front of the lens; over
    // 1.5 s the gloves catch fire, char to black and black claws come through (they stay); the lens is the cinema's
    const burnU = endT == null ? 0 : Math.max(0, Math.min(1, (endT - BURN.at) / BURN.dur));
    const wantHands = endT != null && endT >= BURN.at - 1;
    rig.visible = !(endT != null && endT >= REVEAL);
    if (wantHands) {
      endHands = true;
      if (rightHand.parent !== rig) rig.add(rightHand);
      if (leftHand.parent !== rig) rig.add(leftHand);
      for (const w of Object.values(weapons)) w.group.visible = false;
      const lift = Math.min(1, (endT - (BURN.at - 1)) / 0.8), e = lift * lift * (3 - 2 * lift);
      const tremble = burnU > 0 && burnU < 1 ? Math.sin(S.t * 41) * 0.004 : 0;
      rightHand.visible = leftHand.visible = true; bombPot.visible = false;
      // raised into the lower-middle of the frame (NDC y ≈ −0.35), as if looking at them, fingers up and
      // spread outward, the backs toward the lens so the claws come out against the flames
      rightHand.position.set(0.1 + tremble, -0.3 + 0.225 * e, -0.32); rightHand.rotation.set(0.3 + 0.75 * e, -0.15, -0.42 * e);
      leftHand.position.set(-0.1 - tremble, -0.3 + 0.225 * e, -0.32); leftHand.rotation.set(0.3 + 0.75 * e, 0.15, 0.42 * e);
      const fire = burnU > 0 && burnU < 1 ? Math.sin(burnU * Math.PI) : 0;
      // the flames: up over 0.3 s from the beat, full through the charring, gone 3.8 s after it (before the reveal)
      const ft = endT - BURN.at;
      const flame = ft < 0 ? 0 : ft < 0.3 ? ft / 0.3 : ft < 2.8 ? 1 : Math.max(0, 1 - (ft - 2.8) / 1.0);
      rightHand.updateMatrixWorld(true); leftHand.updateMatrixWorld(true);
      for (const f of flames) {
        f.m.visible = flame > 0.01;
        if (!f.m.visible) continue;
        fv.copy(f.at); f.hand.localToWorld(fv); f.m.position.copy(fv);   // camera space (the vm camera sits at the origin)
        const lick = 0.65 + 0.35 * Math.sin(S.t * 17 + f.ph) * Math.sin(S.t * 9.3 + f.ph * 2.1);
        const h = flame * f.size * (f.inner ? 0.6 : 1) * lick;
        f.m.scale.set(f.size * (f.inner ? 0.7 : 1) * (0.8 + 0.2 * flame), Math.max(0.01, h * 1.5), f.size * (f.inner ? 0.7 : 1));
        f.m.rotation.set(0, 0, Math.sin(S.t * 7 + f.ph) * 0.18);
      }
      flameOuter.opacity = 0.9 * flame; flameInner.opacity = 0.95 * flame; endHandsFlame = flame;
      // lit by their own fire: the warm point light sits between the hands
      nozzleLight.position.set(0, -0.06, -0.26);
      const claw = Math.max(0, Math.min(1, (burnU - 0.45) / 0.45));
      for (const c of clawMeshes) c.scale.setScalar(0.55 + 0.6 * claw);
      smoulder = Math.max(smoulder, burnU > 0 ? (burnU < 1 ? 1 : 0.35) : 0);
      // the seams stay as glowing ember cracks in the charred gloves
      const sv2 = (0.55 + 1.2 * fire + 0.35 * Math.min(1, burnU * 2)) * (0.85 + 0.15 * Math.sin(S.t * 23));
      smoulderMat.visible = burnU > 0; smoulderMat.color.setRGB(1.1 * sv2, 0.3 * sv2, 0.04 * sv2);
      const k = Math.min(1, burnU * 2.2);   // char to black (by ≈ 0.7 s)
      mats.gloveLeather.color.copy(baseLeather).multiplyScalar(1 - 0.94 * k); mats.gloveStrap.color.copy(baseStrap).multiplyScalar(1 - 0.94 * k);
      const em = 0.28 * fire * (1 - k) + 0.04 * k;
      mats.gloveLeather.emissive.setRGB(em, em * 0.25, em * 0.03); mats.gloveStrap.emissive.setRGB(em, em * 0.22, em * 0.03);
      mats.claw.visible = burnU > 0.45;
      mats.claw.emissive.setRGB(0.1 + 0.25 * fire, 0.02 + 0.05 * fire, 0);
    } else if (endHands) {
      endHands = false; endHandsFlame = 0; holder.add(rightHand); setWeapon(shown);
      for (const f of flames) f.m.visible = false;
      mats.gloveLeather.color.copy(baseLeather); mats.gloveStrap.color.copy(baseStrap);
      mats.gloveLeather.emissive.setRGB(0, 0, 0); mats.gloveStrap.emissive.setRGB(0, 0, 0); mats.claw.visible = false;
    }
    sparkAcc += dt * smoulder * (wantHands && burnU > 0 && burnU < 1 ? 60 : 16);  // ≈ 16 sparks/s at full smoulder; a shower while the gloves burn
    for (const sp of sparkSets) {
      const pos = sp.geo.attributes.position.array, col = sp.geo.attributes.color.array;
      let any = false;
      for (let i = 0; i < SPARKS; i++) {
        if (sp.age[i] >= sp.life[i]) {
          if (sparkAcc < 1 || !sp.pts.parent?.visible) continue;
          sparkAcc -= 1 / sparkSets.length;
          const s0 = SEAM_SPOTS[(Math.random() * SEAM_SPOTS.length) | 0];
          pos[i * 3] = s0[0] * sp.side + (Math.random() - 0.5) * 0.01; pos[i * 3 + 1] = s0[1]; pos[i * 3 + 2] = s0[2];
          sp.v[i * 3] = (Math.random() - 0.5) * 0.03; sp.v[i * 3 + 1] = 0.05 + Math.random() * 0.07; sp.v[i * 3 + 2] = (Math.random() - 0.5) * 0.02;
          sp.age[i] = 0; sp.life[i] = 0.3 + Math.random() * 0.45;
        }
        sp.age[i] += dt;
        const u = sp.age[i] / sp.life[i];
        if (u >= 1) { col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = 0; continue; }
        any = true;
        pos[i * 3] += sp.v[i * 3] * dt; pos[i * 3 + 1] += sp.v[i * 3 + 1] * dt; pos[i * 3 + 2] += sp.v[i * 3 + 2] * dt;
        const a = (1 - u) * (u < 0.15 ? u / 0.15 : 1);
        col[i * 3] = 1.3 * a; col[i * 3 + 1] = (0.42 - 0.3 * u) * a; col[i * 3 + 2] = 0.04 * a;
      }
      sparkAcc = Math.min(sparkAcc, 2);
      sp.pts.visible = any;
      if (any) { sp.geo.attributes.position.needsUpdate = true; sp.geo.attributes.color.needsUpdate = true; }
    }
  }

  /** World-space muzzle/nozzle: the tip's screen position re-projected through the world camera at a fixed depth, so a
   *  world-space effect (the fluid's jet, tracers) starts exactly where the viewmodel's muzzle is drawn. */
  const ndc = new THREE.Vector3(), out = new THREE.Vector3();
  function muzzle(target = out) {
    const w = weapons[shown];
    camera.updateMatrixWorld();
    w.muzzle.getWorldPosition(ndc);
    const depth = Math.max(0.35, -ndc.z) * 1.25;
    ndc.project(camera); // camera-space point → NDC of the vm camera (its world matrix is identity in its own scene)
    const wc = worldCamera;
    if (!wc) return target.set(0, 0, 0);
    const tanY = Math.tan((wc.fov * deg) / 2);
    target.set(ndc.x * depth * tanY * wc.aspect, ndc.y * depth * tanY, -depth).applyMatrix4(wc.matrixWorld);
    return target;
  }

  /** Compile every program the viewmodel can need (all three weapons, both hands, the firebomb pot and its rag flame,
   *  the pilot flame) before control: renderer.compile() only walks visible objects. */
  function warm(renderer, rt) {
    if (!renderer) return;
    // every part visible and never frustum-culled (the left hand rests at the camera origin when no weapon uses it,
    // so a plain render culled the firebomb pot and its program still compiled at the first throw)
    const vis = new Map();
    scene.traverse((o) => { vis.set(o, [o.visible, o.frustumCulled]); o.visible = true; o.frustumCulled = false; });
    // draw into a render target like the look does (three's programs differ for the screen and for a target:
    // tone mapping and output colour space), so the very programs the game uses get compiled and the buffers uploaded
    const prev = renderer.getRenderTarget(), ac = renderer.autoClear, smV = smoulderMat.visible;
    smoulderMat.visible = true;   // the smoulder seams and sparks are hidden while the gloves are cold: compile them too
    const clawV = mats.claw.visible; mats.claw.visible = true;
    try { renderer.setRenderTarget(rt || null); renderer.autoClear = true; renderer.render(scene, camera); }
    finally { renderer.setRenderTarget(prev); renderer.autoClear = ac; smoulderMat.visible = smV; mats.claw.visible = clawV; for (const [o, [v, f]] of vis) { o.visible = v; o.frustumCulled = f; } }
  }

  return {
    scene, camera, update, onEvent, muzzle, warm,
    get weapon() { return shown; },
    /** The Thunder Organ's drawn state (for tools): spin 0..1, heat 0..1, overheated, firing. */
    /** DESIGN §12: drive the gloves' burn from a time into TIMELINE.ending (null: follow state.ending.t in mode 'ending'). */
    setEnding(t) { endOverride = t == null ? null : +t; },
    get organ() { return { spin: O.spin, heat: O.heat, over: !!O.over, firing: !!O.firing }; },
    dispose() {
      scene.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.isPoints || o.isSprite) o.material.dispose(); });
      for (const m of Object.values(mats)) m.dispose();
      for (const t of Object.values(tex)) t.dispose();
    },
  };
}
