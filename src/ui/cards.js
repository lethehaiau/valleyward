// @ts-check
// The level-up card pool as the UI shows it (docs/DESIGN.md §10: ≥ 16 cards). The sim picks the ids and
// applies the effects (src/sim/cards.js; the ids and names here match it); this table only gives each id its name, its one-line text and its pixel icon (index into
// public/assets/ui/card-icons.png, a 4 × 4 atlas of 32 px icons made with Codex, see assets-src/ui/provenance.json).
// Unknown ids still render: the UI humanises the id and uses the generic icon. The caller may pass its own table to
// createUI({ cardDefs }) — { [id]: { name, text, icon?, kind? } } — and those entries win.

/** @typedef {{ name: string, text: string, icon: number, kind?: 'weapon'|'fire'|'body'|'keep'|'unlock' }} CardDef */

/** @type {Record<string, CardDef>} */
export const CARDS = Object.freeze({
  'kestrel-dmg': { name: 'Heavy Shot', text: 'Kestrel damage +25 %.', icon: 0, kind: 'weapon' },
  'kestrel-rate': { name: 'Quick Hammer', text: 'Kestrel fire rate +20 %.', icon: 1, kind: 'weapon' },
  'blunderbuss': { name: 'Blunderbuss', text: 'Unlock the Blunderbuss (2): ten pellets in a wide cone.', icon: 2, kind: 'unlock' },
  'pellets': { name: 'Grapeshot', text: 'Blunderbuss pellets +3.', icon: 3, kind: 'weapon' },
  'lance-range': { name: 'Long Nozzle', text: 'Ember Lance range +20 %.', icon: 4, kind: 'fire' },
  'lance-tank': { name: 'Deep Tank', text: 'Ember Lance tank +30 %, refilled.', icon: 5, kind: 'fire' },
  'bomb-charge': { name: 'Bandolier', text: 'Firebombs +1 charge.', icon: 6, kind: 'fire' },
  'bomb-radius': { name: 'Black Powder', text: 'Firebomb burst radius +25 %.', icon: 7, kind: 'fire' },
  'contagion': { name: 'Contagion', text: 'Burning goblins drop embers twice as often.', icon: 8, kind: 'fire' },
  'pitch': { name: 'Pitch-soaked', text: 'Bullets coat goblins in oil: they burn ×2.', icon: 9, kind: 'fire' },
  'wildfire': { name: 'Wildfire', text: 'Fire lasts longer and spreads faster.', icon: 10, kind: 'fire' },
  'magnet': { name: 'Magnetism', text: 'Pickup reach +50 %.', icon: 11, kind: 'body' },
  'vigour': { name: 'Vigour', text: '+20 max HP.', icon: 12, kind: 'body' },   // DESIGN §3.4: no heal
  'mason': { name: 'Mason', text: 'The gate gains +25 % health.', icon: 13, kind: 'keep' },
  'sunburst-rate': { name: 'Kindled Heart', text: 'The Sunburst charges 30 % faster.', icon: 15, kind: 'fire' },
  // DESIGN §10.4: icons 16–47 live in v2-icons-a.png / v2-icons-b.png (src/ui/panels.js ICON)
  // DESIGN §10.4: Cinder Trail → Cinder Steps (same id); the texts are the sim's (src/sim/cards.js), the sim's table wins
  'cinder-trail': { name: 'Cinder Steps', text: 'Your steps burn: a wake of fire on the ground; on the wall walk, cinders fall and light the foot of the wall', icon: 69, kind: 'fire' },
  'ember-orbit': { name: 'Ember Orbit', text: 'Blue fireballs circle you and burn the goblins they touch (+1 each level).', icon: 31, kind: 'fire' },
  'hearthblood': { name: 'Hearthblood', text: 'Standing in fire on the ground heals you 2 HP/s (only in fire)', icon: 68, kind: 'body' },
  'bellows': { name: 'Bellows', text: 'Ember Lance refills 35 % faster.', icon: 33, kind: 'fire' },
  'brimstone': { name: 'Brimstone Rain', text: 'A green meteor falls on the thickest crowd every 8 s (6 s at level 2).', icon: 34, kind: 'fire' },
  // DESIGN §10.4
  'pyre-burst': { name: 'Pyre Burst', text: 'Goblins killed by fire burst into flame and set their neighbours alight.', icon: 48, kind: 'fire' },
  // DESIGN §3.4, §10.4: new stat cards and Ember Gale (icons 64–69 in v5-icons-d.png); mend, soul-feast, windward removed
  'iron-skin': { name: 'Iron Skin', text: 'Damage taken −8 %', icon: 65, kind: 'body' },
  'kindling': { name: 'Kindling', text: 'Fire damage +12 %', icon: 66, kind: 'fire' },
  'fleet': { name: 'Fleet Foot', text: 'Move speed +8 %', icon: 67, kind: 'body' },
  'ember-gale': { name: 'Ember Gale', text: 'Every 14 s a hot gust from the keep fans your fire down the hill and drives the goblins back', icon: 64, kind: 'fire' },
});
/** DESIGN §10.2: skill cards are offered once as NEW SKILL, then as UPGRADE · LV n → n+1 up to their max (the sim's
 *  cardDefs[id].skill / .max win when present). */
export const SKILL_CARDS = Object.freeze({ 'cinder-trail': 3, 'ember-orbit': 3, 'hearthblood': 3, 'ember-gale': 3, 'brimstone': 2, 'pyre-burst': 3, 'contagion': 1, 'pitch': 1, 'wildfire': 1 });
/** the skill id behind an offer id ('ember-orbit:up' → 'ember-orbit') */
export const skillBase = (id) => String(id).replace(/(:up|\+|-up|:lv\d+)$/, '');
/** Old card names the UI shows under their DESIGN §9 name even when the sim's table still has the old one (DESIGN §10.4). */
const RENAMED = Object.freeze({ 'Cinder Trail': 'Cinder Steps' });

/** Ids the sim may use instead (aliases → canonical id), so small naming drifts still find their card. */
export const CARD_ALIASES = Object.freeze({
  kestrelDamage: 'kestrel-dmg', 'pistol-dmg': 'kestrel-dmg', pistolDamage: 'kestrel-dmg',
  kestrelRate: 'kestrel-rate', 'pistol-rate': 'kestrel-rate', pistolRate: 'kestrel-rate',
  unlockBlunderbuss: 'blunderbuss', 'unlock-blunderbuss': 'blunderbuss',
  blunderbussPellets: 'pellets', 'blunderbuss-pellets': 'pellets', 'blunder-pellets': 'pellets',
  lanceRange: 'lance-range', lanceTank: 'lance-tank', bombCharge: 'bomb-charge', 'bomb-charges': 'bomb-charge',
  bombRadius: 'bomb-radius', pitchSoaked: 'pitch', 'pitch-soaked': 'pitch', magnetism: 'magnet', sunburstRate: 'sunburst-rate',
  'sunburst-charge': 'sunburst-rate',
  cinderTrail: 'cinder-trail', trail: 'cinder-trail', 'cinder-steps': 'cinder-trail', cinderSteps: 'cinder-trail',
  emberGale: 'ember-gale', gale: 'ember-gale', ironSkin: 'iron-skin', 'fleet-foot': 'fleet', fleetFoot: 'fleet',
  emberOrbit: 'ember-orbit', orbit: 'ember-orbit', hearthBlood: 'hearthblood', 'hearth-blood': 'hearthblood', regen: 'hearthblood',
  'lance-refill': 'bellows', lanceRefill: 'bellows', brimstoneRain: 'brimstone', 'brimstone-rain': 'brimstone', meteor: 'brimstone',
  pyreBurst: 'pyre-burst', pyre: 'pyre-burst', 'pyre_burst': 'pyre-burst',
});

/** Human text for an unknown id ('lance-range' → 'Lance Range'). @param {string} id */
export function humanise(id) {
  return String(id).replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()).trim();
}

/** @param {string} id @param {Record<string, any>} [extra] @returns {CardDef & { id: string }} */
export function cardDef(id, extra) {
  const sb = skillBase(id);
  const key = CARDS[id] ? id : (CARD_ALIASES[id] || (CARDS[sb] ? sb : CARD_ALIASES[sb]) || id);
  const base = CARDS[key];
  const over = extra && (extra[id] || extra[key] || extra[sb]);
  const name0 = over?.name || base?.name || humanise(id);
  const name = RENAMED[name0] || name0;
  const text = over?.text || over?.desc || base?.text || '';
  const icon = Number.isInteger(over?.icon) && !base ? over.icon : base ? base.icon : 15;   // the UI's atlas indices win for known ids
  // the sim's skill cards carry kind 'unlock' | 'upgrade' (the card class, DESIGN §10.2), not the UI's kind: keep the UI's then
  const kind = over?.cls === 'skill' ? (base?.kind || 'fire') : (over?.kind || base?.kind || 'body');
  return { id, name, text, icon, kind };
}
