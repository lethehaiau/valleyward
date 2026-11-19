// @ts-check
// VALLEYWARD · the self-play policy (docs/DESIGN.md §16.2). It reads only `state` and returns the same input object a
// player produces (absolute yaw/pitch + move + buttons), so it drives the sim in Node and in the browser alike.
// Policy: climb to the wall walk above the gate and keep moving along it (spears and boulders miss a moving target);
// sweep the Ember Lance across the densest crowd below; firebomb the gate pile and dense clusters; shoot spear-chuckers,
// the nearest attackers and barrels with crowds round them; kindle the beacon when it is ready and the gate is healthy;
// Sunburst into a big pile; when the Ash Troll glows, pour Kestrel shots into it; between glows, heat it with fire.
// `useFire: false` never uses the Lance, firebombs, the Sunburst or barrels (the "fire matters" test); `useGuns: false`
// never pulls a gun trigger (the "guns matter" probe: the troll only dies to guns while it glows).
// `noise: true` (or { lag, yaw, pitch }) is the human reference: every input reaches the sim
// 250 ms late (a reaction lag) and the aim carries noise (σ 2.5° yaw, 1.7° pitch per tick).
import { ARENA, BODY } from '../shared/arena.js';
import { WEAPON, ENEMY, TROLL } from '../sim/constants.js';
import { lanceArc } from '../sim/weapons.js';
import { createRng } from '../sim/rng.js';
import { UPGRADES, upgradeCost, TOWERS, BASE_CHARM_SLOTS, ORGAN } from '../shared/meta.js';

const EYE = BODY.player.eye;
const WALK = ARENA.keep.walk, S = ARENA.stair, PAN = ARENA.beacon.pan, GT = ARENA.gate.target;
const STAIR_X = (S.x0 + S.x1) / 2;
// a balanced pick (guns and fire), as a player would build with ~10 level-ups a night
const PREF = ['blunderbuss', 'contagion', 'pyre-burst', 'kestrel-dmg', 'mason', 'pellets', 'wildfire', 'brimstone', 'pyre-burst-up', 'kestrel-rate', 'bomb-charge', 'bellows', 'brimstone-up', 'pitch', 'lance-tank',
  'bomb-radius', 'lance-range', 'sunburst-rate', 'kindling', 'iron-skin', 'vigour', 'fleet', 'magnet', 'ember-orbit', 'ember-orbit-up', 'cinder-trail', 'cinder-trail-up', 'ember-gale', 'ember-gale-up', 'hearthblood', 'hearthblood-up'];
const PREF_NOFIRE = ['blunderbuss', 'kestrel-dmg', 'kestrel-rate', 'pellets', 'mason', 'vigour', 'iron-skin', 'fleet', 'magnet', 'kindling', 'ember-gale', 'ember-gale-up', 'hearthblood', 'hearthblood-up', 'contagion', 'pitch', 'wildfire',
  'bomb-charge', 'lance-tank', 'bomb-radius', 'lance-range', 'sunburst-rate', 'bellows', 'cinder-trail', 'cinder-trail-up', 'ember-orbit', 'ember-orbit-up', 'brimstone', 'brimstone-up', 'pyre-burst', 'pyre-burst-up'];
/** The camp (DESIGN §9.2): what the bot buys, builds and upgrades, in this order of preference (the first affordable). */
const SHOP_PLAN = [
  ['build', 'pad-gate-w', 'obelisk'], ['buy', 'hide'], ['buy', 'lance'], ['build', 'pad-gate-e', 'chainimp'], ['buy', 'kestrel'], ['buy', 'gate'],
  ['buy', 'blunderbuss'], ['upgrade', 'pad-gate-w'], ['buy', 'hide'], ['buy', 'lance'],
  ['upgrade', 'pad-gate-e'], ['buy', 'bombs'], ['buy', 'kestrel'], ['buy', 'gate'],
  // DESIGN §4.2: the core upgrades (Hide 2, Lance 2, Kestrel 2, Gate 2, the Blunderbuss, a Firebomb, two towers at 2),
  // then save for the THUNDER ORGAN (nothing else is bought until it is). (Saving right after Hide 2 / Lance 2 stalled
  // the bot at Night IV for 14–37 nights: the wall needs upgrades.)
  ['organ'],
  ['build', 'pad-road', 'obelisk'], ['upgrade', 'pad-gate-w'], ['upgrade', 'pad-gate-e'], ['buy', 'slots'], ['build', 'pad-west', 'chainimp'],
  ['buy', 'hide'], ['buy', 'lance'], ['buy', 'kestrel'], ['upgrade', 'pad-road'], ['buy', 'bombs'], ['buy', 'gate'], ['buy', 'blunderbuss'], ['buy', 'slots'],
  // DESIGN §9.6, §4.3: towers to 5, weapon lines to 10
  ['upgrade', 'pad-gate-w'], ['upgrade', 'pad-gate-e'], ['buy', 'kestrel'], ['buy', 'lance'], ['upgrade', 'pad-gate-w'], ['upgrade', 'pad-gate-e'],
  ['buy', 'kestrel'], ['buy', 'lance'], ['buy', 'organ'], ['buy', 'organ'], ['buy', 'kestrel'], ['buy', 'lance'], ['buy', 'blunderbuss'],
];
const CHARM_PREF = ['ember-tooth', 'cinder-ward', 'bellows-heart', 'coin-hook', 'spark-bead', 'kindle-knot', 'ashen-step', 'soot-lens', 'witchfire-wick'];
/** The next camp command for this save and run (or null when there is nothing worth buying). @param {any} st */
export function campChoice(st) {
  const meta = st.meta, run = st.run;
  if (!meta || !run) return null;
  const slots = BASE_CHARM_SLOTS + (meta.upgrades.slots || 0);
  if (meta.charms.equipped.length < slots) { const c = CHARM_PREF.find((id) => meta.charms.owned.includes(id) && !meta.charms.equipped.includes(id)); if (c) return { act: 'equip', charm: c, on: true }; }
  const seen = {};
  for (const [act, a, b] of SHOP_PLAN) {
    if (act === 'organ') {
      if (meta.organ?.owned) { if (!meta.organ.equipped) return { act: 'equipOrgan', on: true }; continue; }
      return meta.gold >= ORGAN.cost ? { act: 'buyOrgan' } : null;   // (saving)
    }
    if (act === 'buy') {
      const u = UPGRADES.find((x) => x.id === a); seen[a] = (seen[a] || 0) + 1;
      if (u.needs === 'organ' && !meta.organ?.owned) continue;
      const lv = meta.upgrades[a] || 0;
      if (lv >= seen[a] || lv >= u.max) continue;   // the plan's n-th level of this line is already bought
      if (meta.gold >= upgradeCost(u, lv)) return { act: 'buy', item: a };
    } else if (act === 'build') {
      if (run.towers.some((t) => t.pad === a)) continue;
      if (meta.gold >= TOWERS[b].cost[0]) return { act: 'build', pad: a, type: b };
    } else {
      const key = 'u:' + a; seen[key] = (seen[key] || 0) + 1;
      const t = run.towers.find((x) => x.pad === a); if (!t || t.level > seen[key] || t.level >= 3) continue;
      if (meta.gold >= TOWERS[t.type].cost[t.level]) return { act: 'upgrade', pad: a };
    }
  }
  // DESIGN §16: past the plan, keep spending — the cheapest affordable level of a permanent line (to its max), then
  // a run tower to level 5. (The plan alone stopped at Hide 3 / Kestrel 6 / Lance 6: every bot's power plateaued there
  // and the gold piled up unspent, 15–20k for the perfect bot, which made gold, and so skill, stop mattering.)
  let best = null, bestCost = Infinity;
  for (const id of TAIL_LINES) {
    const u = UPGRADES.find((x) => x.id === id), lv = meta.upgrades[id] || 0;
    if (!u || lv >= u.max || (u.needs === 'organ' && !meta.organ?.owned)) continue;
    const c = upgradeCost(u, lv); if (c < bestCost) { bestCost = c; best = { act: 'buy', item: id }; }
  }
  for (const t of run.towers) { if (t.level >= 5) continue; const c = TOWERS[t.type].cost[t.level]; if (c < bestCost) { bestCost = c; best = { act: 'upgrade', pad: t.pad }; } }
  return best && meta.gold >= bestCost ? best : null;
}
const TAIL_LINES = ['hide', 'lance', 'kestrel', 'blunderbuss', 'gate', 'bombs', 'organ'];

/** The human reference: 250 ms reaction lag, aim noise σ 2.5° (yaw) / 1.7° (pitch). */
export const HUMAN_NOISE = Object.freeze({ lag: 0.25, yaw: 2.5 * Math.PI / 180, pitch: 1.7 * Math.PI / 180 });

/** @param {{ seed?: number, useFire?: boolean, maxKindles?: number, post?: {x:number,z:number}, sorties?: boolean, ground?: boolean, noise?: boolean|{lag:number,yaw:number,pitch:number} }} [o] */
export function createBot(o = {}) {
  const noise = o.noise === true ? HUMAN_NOISE : o.noise || null;
  const drive = createPolicy(o);
  if (!noise) return drive;
  // the noisy bot: the same decisions, applied `lag` seconds late with aim noise (edges such as a bomb or a card arrive late too)
  const lagTicks = Math.max(0, Math.round(noise.lag * 60)), queue = [], nrng = createRng((o.seed || 1) * 104729 + 7);
  const noisy = function noisy(st) {
    queue.push(drive(st));
    const inp = queue.length > lagTicks ? queue.shift() : {};
    if (inp.yaw == null) return inp;
    const g = () => Math.sqrt(-2 * Math.log(nrng.next() + 1e-12)) * Math.cos(2 * Math.PI * nrng.next());   // unit normal
    return { ...inp, yaw: inp.yaw + g() * noise.yaw, pitch: inp.pitch + g() * noise.pitch };
  };
  noisy.stats = drive.stats;
  return noisy;
}

/** @param {{ seed?: number, useFire?: boolean, maxKindles?: number, post?: {x:number,z:number}, sorties?: boolean, ground?: boolean }} o */
function createPolicy(o) {
  const useFire = o.useFire !== false, useGuns = o.useGuns !== false, maxKindles = o.maxKindles ?? (useFire ? 2 : 0);
  const rng = createRng((o.seed || 1) * 7919 + 13);
  const post = o.post || { x: 1.5, z: -1.4 };
  let tick = 0, lancing = false, bombCd = 0, aim = { yaw: Math.PI / 2, pitch: 0 }, weapon = 'pistol', patrolDir = 1, patrolX = post.x;
  const sorties = o.sorties !== false;
  let sortie = null, sortieCd = 30;
  const botStats = { sorties: 0, gemsSeen: 0 };
  const stuck = { x: 0, z: 0, t: 0, detour: 0, dx: 0, dz: 0 };   // a quick trip down the stair to collect the XP gems on the plaza
  let dens = null, best = null, gatePile = 0, lastFire = false, reloadWant = false;
  const DC = 2, DX0 = -24, DZ0 = -2, DW = 40, DH = 34;   // density grid: 2 m cells over x −24..56, z −2..66

  function density(st) {
    const H = st.horde;
    dens = new Uint16Array(DW * DH);
    gatePile = 0;
    for (let i = 0; i < H.count; i++) {
      const s = H.state[i]; if (s === 0 || s === 4) continue;
      const gi = Math.floor((H.x[i] - DX0) / DC), gj = Math.floor((H.z[i] - DZ0) / DC);
      if (gi >= 0 && gj >= 0 && gi < DW && gj < DH) dens[gj * DW + gi]++;
      if (Math.hypot(H.x[i] - GT.x, H.z[i] - GT.z) < 4.5) gatePile++;
    }
  }
  /** The densest 3×3-cell spot whose centre lies between rMin and rMax (horizontal) from (px, pz). */
  function densest(px, pz, rMin, rMax) {
    let bestV = 0, bx = 0, bz = 0;
    for (let j = 1; j < DH - 1; j++) for (let i = 1; i < DW - 1; i++) {
      const cx = DX0 + (i + 0.5) * DC, cz = DZ0 + (j + 0.5) * DC, d = Math.hypot(cx - px, cz - pz);
      if (d < rMin || d > rMax) continue;
      let v = 0;
      for (let b = -1; b <= 1; b++) for (let a = -1; a <= 1; a++) v += dens[(j + b) * DW + i + a] * (a || b ? 0.5 : 1);
      v *= 1 + 0.6 * Math.max(0, 1 - Math.hypot(cx - GT.x, cz - GT.z) / 14);   // the crowd nearest the gate matters most
      if (v > bestV) { bestV = v; bx = cx; bz = cz; }
    }
    return bestV > 0 ? { x: bx, z: bz, v: bestV } : null;
  }

  function lancePitch(p, tx, tz, yaw) {
    const L = WEAPON.lance, fx = Math.sin(yaw), fz = Math.cos(yaw);
    const o = { x: p.x + fx * 0.55 - fz * 0.22, y: p.y + EYE - L.nozzleDrop, z: p.z + fz * 0.55 + fx * 0.22 };
    const want = Math.hypot(tx - o.x, tz - o.z);
    let lo = -1.4, hi = 0.35;
    for (let k = 0; k < 12; k++) {
      const m = (lo + hi) / 2, c = Math.cos(m);
      const arc = lanceArc(o, { x: fx * c, y: Math.sin(m), z: fz * c }, L.range * 1.8);
      const d = Math.hypot(arc.land.x - o.x, arc.land.z - o.z);
      if (d < want) lo = m; else hi = m;
    }
    return (lo + hi) / 2;
  }
  function bombPitch(p, tx, ty, tz) {
    const W = WEAPON.bomb, dh = Math.hypot(tx - p.x, tz - p.z), dy = ty - (p.y + EYE - 0.15), v = W.speed, g = W.gravity, v2 = v * v;
    const disc = v2 * v2 - g * (g * dh * dh + 2 * dy * v2);
    if (disc < 0) return 0.6;
    return Math.atan((v2 - Math.sqrt(disc)) / (g * dh)) - W.lift;
  }
  const aimAt = (p, x, y, z) => ({ yaw: Math.atan2(x - p.x, z - p.z), pitch: Math.atan2(y - (p.y + EYE), Math.hypot(x - p.x, z - p.z)) });

  function moveTo(p, tx, tz, yaw, sprint = false) {
    const dx = tx - p.x, dz = tz - p.z, d = Math.hypot(dx, dz);
    if (d < 0.25) return { fwd: 0, right: 0, sprint: false, arrived: true };
    const ux = dx / d, uz = dz / d, fx = Math.sin(yaw), fz = Math.cos(yaw), rx = -fz, rz = fx;
    const k = Math.min(1, d / 0.8);
    return { fwd: (ux * fx + uz * fz) * k, right: (ux * rx + uz * rz) * k, sprint, arrived: false };
  }
  /** The next waypoint toward a goal on the ground (down the stair from the walk). */
  function routeToGround(p, gx, gz) {
    if (p.where === 'walk') return Math.abs(p.x - STAIR_X) > 0.5 && p.z < -0.6 ? [STAIR_X, -1.2] : [STAIR_X, 0.6];
    if (p.where === 'stair') return [STAIR_X, S.zBottom + 1.2];
    return [gx, gz];
  }
  /** Gems lying on the plaza: their centroid and count. */
  function plazaGems(st) {
    let n = 0, sx = 0, sz = 0;
    for (const g of st.pickups) if (!g.fly && g.kind !== 'gold' && g.x > -8 && g.x < 16 && g.z > 1.5 && g.z < 12) { n++; sx += g.x; sz += g.z; }
    return n ? { n, x: sx / n, z: sz / n } : { n: 0, x: 0, z: 0 };
  }
  function enemiesNear(st, x, z, r) {
    const H = st.horde; let c = 0;
    for (let i = 0; i < H.count; i++) { const s = H.state[i]; if (s === 0 || s === 4) continue; if (Math.abs(H.x[i] - x) < r && Math.abs(H.z[i] - z) < r && Math.hypot(H.x[i] - x, H.z[i] - z) < r) c++; }
    return c;
  }
  /** The next waypoint toward a goal on the walk (via the stair) or on the ground. */
  function routeToWalk(p, gx, gz) {
    if (p.where === 'walk') return [gx, gz];
    if (p.where === 'stair') return [STAIR_X, -1.2];
    // at the foot of the stair (or on its first treads): straight up; else to its foot first
    if (p.z < S.zBottom + 1.6 && p.x > S.x0 - 0.2 && p.x < S.x1 + 0.2) return [STAIR_X, 0];
    return [STAIR_X, S.zBottom + 1.2];
  }

  function pickCard(st) {
    const pref = useFire ? PREF : PREF_NOFIRE, p = st.player;
    let order = pref.slice();
    if (p.hp < p.hpMax * 0.45) order = ['iron-skin', 'vigour', ...order];   // (DESIGN §16: no healing card)
    if (st.gate.hp < st.gate.hpMax * 0.5) order = ['mason', ...order];
    let bestK = 1, bestR = 1e9;
    st.cards.forEach((id, k) => { const r = order.indexOf(id); const rr = r < 0 ? 999 : r; if (rr < bestR) { bestR = rr; bestK = k + 1; } });
    return bestK;
  }

  const drive = function drive(st) {
    tick++;
    if (st.mode === 'cards' && st.cards) return { card: pickCard(st) };
    // the roguelite loop (DESIGN §9.1): past the dawn / fallen card, shop at the camp, then kindle the lamp
    // (it waits past the card's beat: in the browser the dawn / fallen card holds the sim there, so the card, a click or
    // a tool goes on; the bot only does so where no card holds the sim, i.e. in Node)
    if (st.mode === 'victory') return st.victoryShown && st.modeT >= 8.5 ? { cmds: [{ act: 'continue' }] } : {};
    if (st.mode === 'fallen') return st.modeT >= 3 ? { cmds: [{ act: 'continue' }] } : {};
    if (st.mode === 'camp') return campDrive(st);
    if (st.mode !== 'play') return {};
    const p = st.player;
    if (!p.alive) return {};
    if (tick % 6 === 1 || !dens) { density(st); best = null; }
    bombCd = Math.max(0, bombCd - 1 / 60);
    const inp = /** @type {any} */ ({ yaw: aim.yaw, pitch: aim.pitch });
    const H = st.horde, tr = st.troll, n = st.night;

    // ---------------------------------------------------------------------------------- where to stand
    let goal = { x: patrolX, z: post.z };
    const wantKindle = n.kindleCd <= 0 && n.kindle < maxKindles && st.gate.hp > st.gate.hpMax * 0.6 && n.clock < 185 && !tr && p.hp > p.hpMax * 0.5;
    if (wantKindle) goal = { x: PAN.x - 0.6, z: PAN.z };
    if (p.where === 'walk' && !wantKindle) {
      // patrol along the walk (spears and boulders land where the player was)
      if (Math.abs(p.x - patrolX) < 0.3) { patrolDir = -patrolDir; patrolX = post.x + patrolDir * (1.6 + rng.next() * 1.6); }
      for (const b of st.boulders) if (Math.hypot(b.tx - p.x, b.tz - p.z) < b.r + 1.5) { patrolX = b.tx > p.x ? Math.max(WALK.x0 + 1, b.tx - 6) : Math.min(WALK.x1 - 1, b.tx + 6); }
      goal = { x: patrolX, z: post.z };
    }
    // a sortie for the gems on the plaza when it is quiet down there
    sortieCd = Math.max(0, sortieCd - 1 / 60);
    if (sorties && !sortie && sortieCd <= 0 && p.where === 'walk' && !wantKindle && !(tr && tr.alive) && tick % 30 === 0 && p.hp >= p.hpMax * 0.7 && gatePile < 6) {
      const g = plazaGems(st);
      if (g.n >= 10 && n.clock < 150 && enemiesNear(st, g.x, g.z, 12) <= 1 && enemiesNear(st, STAIR_X, S.zBottom + 1, 9) === 0) { sortie = { x: g.x, z: g.z, t: 0 }; botStats.sorties++; }
    }
    if (sortie) {
      sortie.t += 1 / 60;
      if (tick % 15 === 0) {   // walk from gem to gem (the nearest one lying on the plaza)
        let best = null, bd = 1e9;
        for (const g of st.pickups) if (!g.fly && g.kind !== 'gold' && g.x > -8 && g.x < 16 && g.z > 1.5 && g.z < 12) { const d = Math.hypot(g.x - p.x, g.z - p.z); if (d < bd) { bd = d; best = g; } }
        if (best) { sortie.x = best.x; sortie.z = best.z; } else sortie.done = true;
      }
      const threat = p.where !== 'walk' && enemiesNear(st, p.x, p.z, 8) >= 2;
      if (sortie.done || threat || sortie.t > 10 || p.hp < p.hpMax * 0.7 || (tr && tr.alive)) { sortie = null; sortieCd = 20; }
    }
    // DESIGN §16 Hearthblood: on the ground in fire, hurt and unthreatened → stand in it and heal (the sortie waits)
    if (sortie && st.mods.regen > 0 && p.inFire && p.hp < p.hpMax * 0.9 && enemiesNear(st, p.x, p.z, 4) <= 1) { sortie.x = p.x; sortie.z = p.z; sortie.t = Math.max(0, sortie.t - 1 / 60); botStats.fireHeal = (botStats.fireHeal || 0) + 1 / 60; }
    let [wx, wz] = sortie ? routeToGround(p, sortie.x, sortie.z) : routeToWalk(p, goal.x, goal.z);
    if (o.ground) { [wx, wz] = routeToGround(p, ARENA.playerSpawn.x, ARENA.playerSpawn.z); if (p.where === 'ground') { inp.kindle = false; } }   // experiment: hold the plaza like M1
    if (wantKindle && Math.hypot(p.x - PAN.x, p.z - PAN.z) < 1.6 && p.where === 'walk') inp.kindle = true;

    // ---------------------------------------------------------------------------------- what to shoot
    let mode = 'gun', target = null;
    const fx = p.x, fz = p.z;
    // the troll: glowing → guns; near → fire at its feet
    if (tr && tr.alive) {
      const dT = Math.hypot(tr.x - fx, tr.z - fz);
      if (tr.glowing && dT < 45) { mode = 'gun'; target = { x: tr.x, y: tr.y + TROLL.height * 0.78, z: tr.z, troll: true }; }
      else if (useFire && dT < 12.5 && p.fuel > 8) { mode = 'lance'; target = { x: tr.x, y: tr.y, z: tr.z, troll: true }; }
      else if (useFire && dT < 24 && p.bombs > 0 && bombCd <= 0) { mode = 'bomb'; target = { x: tr.x, y: tr.y + 1, z: tr.z, troll: true }; }
    }
    // DESIGN §8: the Rainmother — guns while she is cracked; else fire at her feet (Lance in range, bombs within 24 m) to
    // crack her; between, shoot out her lanterns
    const B = st.boss;
    if (!target && B && B.alive && B.mode !== 'rise') {
      const dB = Math.hypot(B.x - fx, B.z - fz);
      if (B.cracked && dB < 55) { mode = 'gun'; target = { x: B.x, y: B.y + 7, z: B.z, troll: true }; }
      else if (useFire && dB < 12.5 && p.fuel > 8) { mode = 'lance'; target = { x: B.x, y: B.y, z: B.z, troll: true }; }
      else if (useFire && dB < 24 && p.bombs > 0 && bombCd <= 0) { mode = 'bomb'; target = { x: B.x, y: B.y + 1, z: B.z, troll: true }; }
      else if (dB < 50 && (tick >> 6) % 3 === 0) { const L = B.lanterns.find((l) => l.alive); if (L) { mode = 'gun'; target = { x: L.x, y: L.y, z: L.z, troll: true }; } }
    }
    // DESIGN §5.6: a Siege Ram — fire on its crew (bombs, then the Lance), guns when it is at the gate
    if (!target && st.rams && st.rams.length) {
      let rb = null, rd = 1e9; for (const r of st.rams) { if (r.mode === 'fall') continue; const d = Math.hypot(r.x - fx, r.z - fz); if (d < rd) { rd = d; rb = r; } }
      if (rb) {
        if (useFire && !rb.stalled && rd < 24 && p.bombs > 0 && bombCd <= 0) { mode = 'bomb'; target = { x: rb.x, y: rb.y + 0.5, z: rb.z, troll: true }; }
        else if (useFire && !rb.stalled && rd < 12 && p.fuel > 8) { mode = 'lance'; target = { x: rb.x, y: rb.y, z: rb.z, troll: true }; }
        else if (rb.mode === 'swing' || rd < 14) { mode = 'gun'; target = { x: rb.x, y: rb.y + 1.2, z: rb.z, troll: true }; }
      }
    }
    // DESIGN §8 Night VII: a chanting coven — guns on one of its Hexers (killing one breaks the chant)
    if (!target && st.coven && st.coven.length) {
      const H2 = st.horde; for (const g of st.coven) for (const i of g.ids) if (H2.state[i] && H2.state[i] !== 4 && H2.kind[i] === 5 && !target) target = { x: H2.x[i], y: H2.y[i] + 0.8, z: H2.z[i], troll: true };
      if (target) mode = 'gun';
    }
    // DESIGN §5.5: a Bat Gremlin diving at us comes first (a gun; a small lead along its dive)
    if (!target && st.air && st.air.length) {
      let bb = null, bd = 1e9;
      for (const b of st.air) { if (!b.alive || (b.mode !== 'dive' && !(b.mode === 'circle' && Math.hypot(b.x - fx, b.z - fz) < 9))) continue; const d = Math.hypot(b.x - fx, b.y - p.y, b.z - fz); if (d < bd) { bd = d; bb = b; } }
      if (bb && bd < 30) { target = { x: bb.x + bb.vx * 0.08, y: bb.y + bb.vy * 0.08, z: bb.z + bb.vz * 0.08, troll: true, air: true }; mode = 'gun'; }
    }
    if (!target && useFire) {
      // sunburst into a big pile
      if (p.sunburst >= 1) { let c = 0; for (let i = 0; i < H.count; i++) if (H.state[i] && H.state[i] !== 4 && Math.hypot(H.x[i] - fx, H.z[i] - fz) < 12) c++; if (c >= 40) inp.ult = true; }
      // the Lance across the densest crowd below (hysteresis on fuel)
      if (lancing && p.fuel < 3) lancing = false;
      if (!lancing && p.fuel >= 30) lancing = true;
      best ??= densest(fx, fz, 3.5, WEAPON.lance.range * (st.mods?.lanceRange || 1) - 0.5);
      if (lancing && best && best.v >= 3) { mode = 'lance'; target = { x: best.x, y: 0, z: best.z }; }
      // firebombs at the gate pile or a dense cluster further out
      if (p.bombs > 0 && bombCd <= 0 && (!target || p.bombs >= 2)) {
        if (gatePile >= 8) { mode = 'bomb'; target = { x: GT.x + rng.range(-1.5, 1.5), y: 0, z: GT.z + 2 + rng.range(0, 2) }; }
        else { const far = densest(fx, fz, 8, 24); if (far && far.v >= 10) { mode = 'bomb'; target = { x: far.x, y: 0, z: far.z }; } }
      }
      // a barrel with a crowd round it
      if (!target) {
        ARENA.oil.barrels.forEach(([bx, bz], k) => {
          if (target || !st.barrels[k].alive || Math.hypot(bx - fx, bz - fz) > 40) return;
          let c = 0; for (let i = 0; i < H.count; i++) if (H.state[i] && H.state[i] !== 4 && Math.abs(H.x[i] - bx) < 3 && Math.abs(H.z[i] - bz) < 3) c++;
          if (c >= 6) { mode = 'gun'; target = { x: bx, y: 0.6, z: bz }; }
        });
      }
    }
    if (!target) {
      // guns: spear-chuckers aiming at us first, then whatever is nearest the gate within range
      let bi = -1, bs = 1e9;
      for (let i = 0; i < H.count; i++) {
        const s = H.state[i]; if (s === 0 || s === 4) continue;
        const dx = H.x[i] - fx, dz = H.z[i] - fz, d = Math.hypot(dx, dz);
        if (d > 30) continue;
        const dg = Math.hypot(H.x[i] - GT.x, H.z[i] - GT.z);
        let score = dg + d * 0.4;
        if (H.kind[i] === 2 && H.target[i] === 2) score -= 25;
        if (H.kind[i] === 3 && H.state[i] === 2) score -= 18;   // a brute at the gate stands still: full gun damage, and fire does ×0.5
        if (H.burn[i] > 0) score += 12;   // already doomed
        if (H.kind[i] === 4 || H.kind[i] === 5) score -= 20;   // elites (DESIGN §5.4): a charm and a gold pile
        if (H.kind[i] === 6) score -= 8;   // Dousers put the fire out
        if (score < bs) { bs = score; bi = i; }
      }
      if (bi >= 0) { const K = ENEMY[H.kind[bi]]; target = { x: H.x[bi], y: H.y[bi] + K.height * 0.55, z: H.z[bi] }; mode = 'gun'; }
      else if (tr && tr.alive) { target = { x: tr.x, y: tr.y + 3.5, z: tr.z, troll: true }; mode = 'gun'; }
    }

    // ---------------------------------------------------------------------------------- aim and press
    inp.fire = false;
    if (target) {
      if (mode === 'lance') {
        const yaw = Math.atan2(target.x - p.x, target.z - p.z) + (target.troll ? 0 : Math.sin(tick * 0.09) * 0.2);
        aim = { yaw, pitch: lancePitch(p, target.x, target.z, yaw) };
        weapon = 'lance'; inp.fire = p.weapon === 'lance';
      } else if (mode === 'bomb') {
        aim = { yaw: Math.atan2(target.x - p.x, target.z - p.z), pitch: bombPitch(p, target.x, target.y, target.z) };
        inp.bomb = true; bombCd = 0.7;
      } else {
        aim = aimAt(p, target.x, target.y, target.z);
        const near = Math.hypot(target.x - p.x, target.z - p.z) < 9;
        weapon = p.unlocked.organ ? (target.air ? 'pistol' : 'organ') : p.unlocked.blunderbuss && near && !target.troll ? 'blunderbuss' : 'pistol';
        inp.fire = useGuns && p.weapon === weapon && p.switchT >= 1;
      }
    } else if (p.weapon !== 'pistol' && p.ammo.pistol < 8) weapon = 'pistol';
    if (weapon !== p.weapon && p.unlocked[weapon]) inp.weapon = weapon === 'pistol' ? 1 : weapon === 'blunderbuss' || weapon === 'organ' ? 2 : 3;
    // reload in a lull
    reloadWant = !target && (p.weapon === 'pistol' ? p.ammo.pistol < 5 : p.weapon === 'blunderbuss' ? p.ammo.blunderbuss < 2 : false);
    if (reloadWant) inp.reload = true;
    inp.yaw = aim.yaw; inp.pitch = aim.pitch;
    // unstick: wanting to move but not moving for 2 s → a short detour to the side
    const far = Math.hypot(wx - p.x, wz - p.z) > 1;
    if (far && Math.hypot(p.x - stuck.x, p.z - stuck.z) < 0.3) stuck.t += 1 / 60; else { stuck.t = 0; stuck.x = p.x; stuck.z = p.z; }
    if (stuck.t > 2) { stuck.t = 0; stuck.detour = 50; stuck.dx = p.x + rng.range(-2.5, 2.5); stuck.dz = p.z + rng.range(-2.5, 2.5); }
    if (stuck.detour > 0) { stuck.detour--; Object.assign(inp, moveTo(p, stuck.dx, stuck.dz, aim.yaw, false)); }
    else Object.assign(inp, moveTo(p, wx, wz, aim.yaw, p.where !== 'walk'));
    inp.firePress = inp.fire && !lastFire; lastFire = inp.fire;
    return inp;
  };
  /** At the camp: one purchase per tick while anything is worth buying, then up the stair to the pan and E. */
  function campDrive(st) {
    const p = st.player;
    if (o.shop !== false) { const c = campChoice(st); if (c) { botStats.bought = (botStats.bought || 0) + 1; return { cmds: [c], yaw: p.yaw, pitch: 0 }; } }
    const [wx, wz] = routeToWalk(p, PAN.x - 0.6, PAN.z);
    const yaw = Math.atan2(wx - p.x, wz - p.z);
    const inp = /** @type {any} */ ({ yaw, pitch: 0, ...moveTo(p, wx, wz, yaw, true) });
    if (p.where === 'walk' && Math.hypot(p.x - PAN.x, p.z - PAN.z) < 1.6) inp.kindle = tick % 20 === 0;
    return inp;
  }
  drive.stats = botStats;
  return drive;
}
