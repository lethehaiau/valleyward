// @ts-check
// VALLEYWARD · the level-up card pool (docs/DESIGN.md §10, ≥ 16 cards). Each level pauses the sim (mode 'cards') on 3
// distinct eligible cards drawn with the seeded RNG; pick with 1/2/3, a click (UI) or the bot. Pure JS.
// `max` = how many times a card can be taken; `when` = eligibility; `apply(sim ctx)` changes state.player / ctx.mods.

// DESIGN §10.2: two classes. `cls: 'stat'` cards work as before (`max` takes). `cls: 'skill'` cards come in pairs: the
// unlock card (id = the skill id, max 1, "NEW SKILL") is offered only while the skill is not owned; then its upgrade
// card (id = `<skill>-up`, "<SKILL> · LV n → n+1") until the skill's level max. One offer never holds two cards of the
// same skill. `skillLevel(taken, skill)` = the skill's level (0 = not owned).
const BASE_CARDS = [
  { id: 'kestrel-dmg', name: 'Heavy Shot', text: 'Kestrel damage +25 %', max: 4, apply: (c) => { c.mods.kestrelDmg *= 1.25; } },
  { id: 'kestrel-rate', name: 'Quick Hammer', text: 'Kestrel fire rate +20 %', max: 4, apply: (c) => { c.mods.kestrelRate *= 1.2; } },
  { id: 'blunderbuss', name: 'Blunderbuss', text: 'Unlock the Blunderbuss (2)', max: 1, when: (c) => !c.state.player.unlocked.blunderbuss && !c.state.player.unlocked.organ,
    apply: (c) => { c.state.player.unlocked.blunderbuss = true; } },
  { id: 'pellets', name: 'Grapeshot', text: 'Blunderbuss pellets +3', max: 3, when: (c) => c.state.player.unlocked.blunderbuss && !c.state.player.unlocked.organ, apply: (c) => { c.mods.pellets += 3; } },
  { id: 'lance-range', name: 'Long Nozzle', text: 'Ember Lance range +20 %', max: 3, apply: (c) => { c.mods.lanceRange *= 1.2; } },
  { id: 'lance-tank', name: 'Deep Tank', text: 'Ember Lance tank +30 %', max: 3, apply: (c) => { const p = c.state.player; p.fuelMax = Math.round(p.fuelMax * 1.3); p.fuel = p.fuelMax; } },
  { id: 'bomb-charge', name: 'Bandolier', text: 'Firebomb +1 charge', max: 3, apply: (c) => { const p = c.state.player; p.bombsMax++; p.bombs++; } },
  { id: 'bomb-radius', name: 'Black Powder', text: 'Firebomb radius +25 %', max: 3, apply: (c) => { c.mods.bombRadius *= 1.25; } },
  { id: 'contagion', name: 'Contagion', cls: 'skill', levels: 1, text: 'Burning goblins drop embers twice as often', max: 1, apply: (c) => { c.mods.contagion = true; } },
  { id: 'pitch', name: 'Pitch-soaked', cls: 'skill', levels: 1, text: 'Bullets coat goblins in oil: they burn ×2', max: 1, apply: (c) => { c.mods.pitch = true; } },
  { id: 'wildfire', name: 'Wildfire', cls: 'skill', levels: 1, text: 'Fire lasts longer and spreads faster', max: 1,
    apply: (c) => { c.mods.wildfire = true; c.mods.fireAmount *= 1.35; c.mods.burnSeconds *= 1.4; c.proxyMods({ decay: 1.35, spread: 1.6 }); } },
  { id: 'magnet', name: 'Magnetism', text: 'Pickup reach +50 %', max: 3, apply: (c) => { c.state.player.magnet *= 1.5; } },
  { id: 'vigour', name: 'Vigour', text: '+20 max HP', max: 4, apply: (c) => { const p = c.state.player; p.hpMax += 20; } },   // (DESIGN §3.4: no heal)
  { id: 'mason', name: 'Mason', text: 'Gate +25 % HP', max: 3, apply: (c) => { const g = c.state.gate, add = Math.round(g.hpMax * 0.25); g.hpMax += add; g.hp = Math.min(g.hpMax, g.hp + add); } },
  { id: 'sunburst-rate', name: 'Kindled Heart', text: 'Sunburst charges 30 % faster', max: 3, apply: (c) => { c.mods.sunburstRate *= 1.3; } },
  // DESIGN §3.4: no healing cards (Kindled Flesh, Soul Feast and Hearthblood removed); three non-healing cards in their place
  { id: 'iron-skin', name: 'Iron Skin', text: 'Damage taken −8 %', max: 3, apply: (c) => { c.mods.dmgTaken *= 0.92; } },
  { id: 'kindling', name: 'Kindling', text: 'Fire damage +12 %', max: 3, apply: (c) => { c.mods.fireDmg *= 1.12; } },
  { id: 'fleet', name: 'Fleet Foot', text: 'Move speed +8 %', max: 2, apply: (c) => { c.mods.speed += 0.08; } },
  // DESIGN §10.4 skills; DESIGN §10.2 makes them unlock-once (numbers in src/sim/constants.js SKILL)
  // DESIGN §10.4: Cinder Trail remade as CINDER STEPS (id kept); Windward remade as EMBER GALE; Hearthblood back as a fire-only heal
  { id: 'cinder-trail', name: 'Cinder Steps', cls: 'skill', levels: 3, text: 'Your steps burn: a wake of fire on the ground; on the wall walk, cinders fall and light the foot of the wall', up: ['a wider, hotter wake', 'the hottest wake'], apply: (c) => { c.mods.trail++; } },
  { id: 'ember-gale', name: 'Ember Gale', cls: 'skill', levels: 3, text: 'Every 14 s a hot gust from the keep fans your fire down the hill and drives the goblins back', up: ['every 11 s, pushes 1.5 m', 'every 8 s, pushes 2 m'], apply: (c) => { c.mods.gale++; } },
  { id: 'hearthblood', name: 'Hearthblood', cls: 'skill', levels: 3, text: 'Standing in fire on the ground heals you 2 HP/s (only in fire)', up: ['3 HP/s in fire', '4 HP/s in fire'], apply: (c) => { c.mods.regen++; } },
  { id: 'ember-orbit', name: 'Ember Orbit', cls: 'skill', levels: 3, text: 'A fireball circles you: it burns what it touches', up: ['+1 fireball (2)', '+1 fireball (3)'], apply: (c) => { c.mods.orbit++; } },
  { id: 'bellows', name: 'Bellows', text: 'Ember Lance refill speed +35 %', max: 3, apply: (c) => { c.mods.lanceRefill *= 1.35; } },
  { id: 'brimstone', name: 'Brimstone Rain', cls: 'skill', levels: 2, text: 'A burning meteor falls on the densest crowd every 8 s', up: ['every 6 s'], apply: (c) => { c.mods.meteor++; } },
  // DESIGN §10.4: Pyre Burst
  { id: 'pyre-burst', name: 'Pyre Burst', cls: 'skill', levels: 3, text: 'Enemies killed by fire burst (50 %): r 1.6 m, 6 dmg, they ignite', up: ['75 %, r 2.2 m, 10 dmg', '100 %, r 2.8 m, 14 dmg'], apply: (c) => { c.mods.pyre++; } },
];
/** The pool: stat cards as they are; each skill as its unlock card (+ its upgrade card when it has levels). */
export const CARDS = Object.freeze(BASE_CARDS.flatMap((k) => {
  if (k.cls !== 'skill') return [Object.freeze({ cls: 'stat', ...k })];
  const unlock = Object.freeze({ ...k, cls: 'skill', kind: 'unlock', skill: k.id, max: 1, when: (c) => skillLevel(c.state.taken, k.id) === 0 });
  if (!(k.levels > 1)) return [unlock];
  const upgrade = Object.freeze({ ...k, id: `${k.id}-up`, cls: 'skill', kind: 'upgrade', skill: k.id, max: k.levels - 1,
    text: `${k.name} · ${(k.up || []).join(' → ')}`, when: (c) => { const lv = skillLevel(c.state.taken, k.id); return lv >= 1 && lv < k.levels; } });
  return [unlock, upgrade];
}));
/** A skill's level from the cards taken this run (0 = not owned). */
export function skillLevel(taken, skill) { return (taken?.[skill] || 0) + (taken?.[`${skill}-up`] || 0); }
/** The upgrade text for the next level of a skill (for the UI: "LV n → n+1 · …"). */
export function skillNext(taken, skill) { const k = BASE_CARDS.find((x) => x.id === skill); const lv = skillLevel(taken, skill); return k && lv >= 1 && lv < (k.levels || 1) ? { from: lv, to: lv + 1, max: k.levels, text: (k.up || [])[lv - 1] || '' } : null; }
export const CARD_BY_ID = Object.freeze(Object.fromEntries(CARDS.map((c) => [c.id, c])));

/** Draw 3 distinct eligible card ids. @param {any} c ctx @param {Record<string, number>} taken */
export function drawCards(c, taken) {
  let pool = CARDS.filter((k) => (taken[k.id] || 0) < k.max && (!k.when || k.when(c)));
  const out = [];
  while (out.length < 3 && pool.length) {
    const k = pool.splice(c.rng.int(pool.length), 1)[0];
    out.push(k.id);
    if (k.skill) pool = pool.filter((x) => x.skill !== k.skill);   // one card per skill in an offer (DESIGN §10.2)
  }
  return out;
}

/** The run's multipliers. Cards, NPC upgrades and charms all write here; the sim rebuilds it at every nightfall
 *  (applyLoadout in src/sim/run.js: upgrades + charms, then every card taken this run replayed, `instant` cards skipped). */
export function newMods() {
  return { kestrelDmg: 1, kestrelRate: 1, pellets: 0, lanceRange: 1, bombRadius: 1, contagion: false, pitch: false, wildfire: false,
    fireAmount: 1, burnSeconds: 1, sunburstRate: 1,
    // DESIGN §9: skills (levels), upgrades and charms
    soulFeast: 0, trail: 0, gale: 0, orbit: 0, regen: 0, meteor: 0, pyre: 0, lanceRefill: 1, fireDmg: 1, dmgTaken: 1, gold: 1, speed: 1, kindleCd: 1,
    bombsStart: 0, lanceHue: 'orange' };
}
