// DESIGN §16 (difficulty): goblins grow with the night, small goblins are tougher in fire, no healing but
// +10 % max HP on a level-up, the troll and the Rainmother punish tanking, fixed boss HP (no scaling by the save's power), and the wall
// a player meets who stops spending. Node, the CPU fire proxy.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSim, NO_INPUT } from '../src/sim/sim.js';
import { EV } from '../src/shared/events.js';
import { NIGHTS } from '../src/shared/meta.js';
import { ENEMY, K, nightScale, LEVEL_HEAL, TROLL } from '../src/sim/constants.js';
import { CARDS, CARD_BY_ID } from '../src/sim/cards.js';
import { campaign } from '../tools/qa/campaign.mjs';
import { createBot } from '../src/bot/bot.js';

const run = (sim, ticks, inp = NO_INPUT, onEv) => { for (let i = 0; i < ticks; i++) { sim.step(typeof inp === 'function' ? inp(sim.state) : inp); const ev = sim.drainEvents(); if (onEv) ev.forEach(onEv); } };

test('goblins grow with the night: HP, damage, speed, fire toughness (floor 0.5); elites, bats and the ram crew too', () => {
  assert.deepEqual({ ...nightScale(1) }, { n: 1, hp: 1, dmg: 1, speed: 1, burn: 1 });
  const s5 = nightScale(5); assert.ok(Math.abs(s5.hp - 3.0) < 1e-9 && Math.abs(s5.dmg - 2.0) < 1e-9 && Math.abs(s5.speed - 1.12) < 1e-9 && Math.abs(s5.burn - 0.72) < 1e-9, JSON.stringify(s5));
  assert.equal(nightScale(10).burn, 0.5);
  for (const n of [1, 5, 9]) {
    const sim = createSim({ seed: 4, spawnScale: 0, god: true, save: 'late' }); sim.goto(`night${n}`);
    const i = sim.ctx.horde.spawnAt(K.grunt, 3, 40); assert.ok(Math.abs(sim.state.horde.hp[i] - ENEMY[K.grunt].hp * nightScale(n).hp) < 1e-3);
    if (n === 5) { sim.ctx.rams.spawn(); const r = sim.state.rams[0]; assert.equal(r.hpMax, 600 * nightScale(5).hp); }
  }
});

test('a burning grunt lives ≈ 5–6 s on Night I and longer on later nights', () => {
  const life = (n) => {
    const sim = createSim({ seed: 5, spawnScale: 0, god: true, save: 'fresh' }); if (n > 1) sim.goto(`night${n}`); else sim.startNight();
    const i = sim.ctx.horde.spawnAt(K.grunt, 0, 70); const H = sim.state.horde;
    H.burn[i] = 99; H.vx[i] = H.vz[i] = 0;   // (alight for good; no fire to stand in, so only BURN.dps works)
    let t = 0; while (H.state[i] !== 0 && H.hp[i] > 0 && t < 30) { H.burn[i] = 99; run(sim, 1); t += 1 / 60; }
    return t;
  };
  const t1 = life(1), t5 = life(5);
  assert.ok(t1 >= 5 && t1 <= 6.2, `Night I: ${t1.toFixed(2)} s`);
  assert.ok(t5 > t1 * 2, `Night V: ${t5.toFixed(2)} s`);
});

test('no healing but the level-up: +10 % of max HP; no hearts, no healing cards, Vigour adds max HP only', () => {
  for (const id of ['mend', 'soul-feast', 'windward']) assert.equal(CARD_BY_ID[id], undefined);
  for (const id of ['iron-skin', 'kindling', 'fleet', 'ember-gale', 'hearthblood', 'cinder-trail']) assert.ok(CARD_BY_ID[id], `${id} in the pool`);
  assert.ok(CARDS.length >= 28, 'offers stay varied');
  const sim = createSim({ seed: 6, spawnScale: 0, god: true, save: 'fresh' }); sim.startNight();
  const p = sim.state.player; p.hp = 40;
  CARD_BY_ID.vigour.apply(sim.ctx); assert.equal(p.hp, 40); assert.equal(p.hpMax, 120);
  // a level-up heals 10 % of max HP (once), nothing else heals: a night of kills drops no heart
  const heals = []; p.xp = p.xpNext; run(sim, 2, NO_INPUT, (e) => { if (e.type === EV.P_HEAL) heals.push(e); });
  assert.ok(Math.abs(p.hp - (40 + 120 * LEVEL_HEAL)) < 1e-6, `hp ${p.hp}`); assert.equal(heals.length, 1); assert.equal(heals[0].source, 'level');
  const s2 = createSim({ seed: 7, save: 'fresh' }); s2.startNight(); s2.state.player.xpNext = 1e9;
  const ev = [], bot = createBot({ seed: 7 }); run(s2, 60 * 120, (st) => { st.player.xpNext = 1e9; return bot(st); }, (e) => ev.push(e));
  assert.ok(s2.state.stats.kills > 50, 'kills happened');
  assert.ok(!s2.state.pickups.some((g) => g.kind === 'heart') && !ev.some((e) => e.type === EV.P_HEAL), 'no heart, no heal');
});

test('no tanking: the troll walks on a Lamplighter on the ground within 8 m; 3–4 of its hits kill a Hide-2 player; fixed HP', () => {
  assert.ok(TROLL.stomp.dmg * 3 < 130 / 0.9 && TROLL.stomp.dmg * 4 >= 130 / 0.9 * 0.95, 'stomp: 4 hits');
  assert.ok(TROLL.throw.dmg * 4 >= 130 / 0.9 * 0.95, 'boulder: 3–4 hits');
  const sim = createSim({ seed: 8, spawnScale: 0, save: 'mid' }); sim.goto('night3');
  sim.setClock(209); run(sim, 60 * 3);
  const tr = sim.state.troll; assert.equal(tr.hpMax, NIGHTS[2].trollHp, 'fixed boss HP whatever the save (no power scaling)');
  run(sim, 60 * 6);   // (the arrival)
  tr.x = 6; tr.z = 14; sim.teleport(3, 7.5, 0, 0); const p = sim.state.player; p.hpMax = p.hp = 1e4;   // (7.2 m apart, outside the gate)
  const d0 = Math.hypot(p.x - tr.x, p.z - tr.z), hurts = [];
  run(sim, 60 * 5, NO_INPUT, (e) => { if (e.type === EV.P_HURT && e.source === 'stomp') hurts.push(e.dmg); });
  assert.ok(Math.hypot(p.x - tr.x, p.z - tr.z) < d0 || hurts.length > 0, 'it turned on the Lamplighter');
  assert.ok(hurts.length >= 1, 'stomped');
});

test('the wall: a save that stops spending after Night I does not clear the next three nights (DESIGN §16.2)', () => {
  let best = 0, total = 0;
  for (const seed of [1, 2, 3]) {
    const c = campaign(seed, { save: 'fresh', shop: false, maxNights: 4, stopOnFall: true });
    const clears = c.seq.filter((x) => x.endsWith('+')).length; best = Math.max(best, clears); total += clears;
  }
  assert.ok(best <= 3, `the best no-spend streak from a fresh save: ${best} nights`);
  assert.ok(total / 3 <= 2.4, `mean ${total / 3}`);
});

test('Hearthblood (DESIGN §3.4 exception): heals 2/3/4 HP/s only standing in fire on the ground; 0 out of fire, 0 on the wall walk', () => {
  const mk = () => { const sim = createSim({ seed: 9, spawnScale: 0, save: 'fresh' }); sim.startNight(); sim.state.player.xpNext = 1e9; return sim; };
  // out of fire, on the ground: nothing
  const a = mk(); CARD_BY_ID.hearthblood.apply(a.ctx); a.teleport(3, 6, 0, 0); a.state.player.hp = 50; run(a, 120); assert.equal(a.state.player.hp, 50);
  // in fire on the ground: 2 HP/s at level 1, 4 at level 3
  const b = mk(); CARD_BY_ID.hearthblood.apply(b.ctx); b.teleport(3, 6, 0, 0); b.state.player.hp = 50;
  const burn = (s, x, z) => { for (let k = 0; k < 3; k++) s.fireOp({ kind: 'burst', x, z, r: 2.5, amount: 1, push: 0 }); };
  burn(b, 3, 6); run(b, 30); const h0 = b.state.player.hp; burn(b, 3, 6); run(b, 60);
  assert.ok(b.state.player.inFire && Math.abs(b.state.player.hp - h0 - 2) < 0.2, `+${(b.state.player.hp - h0).toFixed(2)} in 1 s`);
  CARD_BY_ID['hearthblood-up'].apply(b.ctx); CARD_BY_ID['hearthblood-up'].apply(b.ctx); const h1 = b.state.player.hp; burn(b, 3, 6); run(b, 60);
  assert.ok(Math.abs(b.state.player.hp - h1 - 4) < 0.3, `level 3: +${(b.state.player.hp - h1).toFixed(2)}`);
  // on the wall walk, even with fire below: nothing
  const c = mk(); CARD_BY_ID.hearthblood.apply(c.ctx); c.teleportHigh(2, -1.5, 0, 0); c.state.player.hp = 50; burn(c, 2, 1); run(c, 120);
  assert.equal(c.state.player.where, 'walk'); assert.equal(c.state.player.hp, 50);
});

test('Ember Gale (DESIGN §10.4): every 14 s a 2.5 s gust downhill: EV.GALE, the wind points +z at gale strength, goblins pushed back 1 m', () => {
  const sim = createSim({ seed: 10, spawnScale: 0, god: true, save: 'fresh' }); sim.startNight(); sim.state.player.xpNext = 1e9;
  CARD_BY_ID['ember-gale'].apply(sim.ctx); sim.teleportHigh(2, -1.5, 0, 0);
  const i = sim.ctx.horde.spawnAt(K.grunt, 6, 10), H = sim.state.horde; H.slowT[i] = 99; H.slowK[i] = 0;   // (held in place)
  const ev = []; run(sim, Math.round(60 * 13.9), NO_INPUT, (e) => ev.push(e)); const z0 = H.z[i];
  assert.ok(!ev.some((e) => e.type === EV.GALE));
  run(sim, 12, NO_INPUT, (e) => ev.push(e));
  const g = ev.find((e) => e.type === EV.GALE); assert.ok(g && g.level === 1 && g.seconds === 2.5);
  assert.ok(Math.abs(H.z[i] - z0 - 1.0) < 0.05, `pushed ${(H.z[i] - z0).toFixed(2)} m`);
  assert.ok(sim.state.wind.z >= 4 && Math.abs(sim.state.wind.x) < 1e-6, 'downhill at gale strength');
  run(sim, 60 * 3); assert.ok(sim.state.wind.z < 4, 'it passes after 2.5 s');
  // the 'windward' card is gone
  assert.equal(CARD_BY_ID.windward, undefined);
});

test('Cinder Steps (DESIGN §10.4): fire at any walking speed; on the wall walk cinders fall to the wall\'s foot under the player', () => {
  const sim = createSim({ seed: 11, spawnScale: 0, god: true, save: 'fresh' }); sim.startNight(); sim.state.player.xpNext = 1e9;
  CARD_BY_ID['cinder-trail'].apply(sim.ctx);
  sim.teleport(3, 8, 0, 0);
  const ops = [], ev = [];
  for (let k = 0; k < 60; k++) { sim.step({ fwd: 0.4, yaw: Math.PI / 2 }); ops.push(...sim.state.fireOps); ev.push(...sim.drainEvents()); }   // a slow walk
  assert.ok(ops.filter((o) => o.kind === 'ember' && o.hue === 'lilac').length >= 6, 'a wake at a walk');
  assert.ok(ev.some((e) => e.type === EV.TRAIL && !e.wall));
  sim.teleportHigh(-4, -1.5, Math.PI / 2, 0);
  const w = [];
  for (let k = 0; k < 90; k++) { sim.step({ fwd: 0.6, yaw: Math.PI / 2 }); w.push(...sim.drainEvents().filter((e) => e.type === EV.TRAIL)); }
  const wall = w.filter((e) => e.wall); assert.ok(wall.length >= 3, 'cinders over the parapet');
  for (const e of wall) { assert.ok(e.pos.z >= 0.4 && e.pos.z <= 1.5 && e.from.y > e.pos.y + 3, JSON.stringify(e)); }
});
