// @ts-check
// The camp panels (docs/DESIGN.md §9.2, §9.6, §5.4, §13): Brother Cinder's panel (two tabs: Upgrades and Charms) and the build
// pad's panel (build the Black Obelisk or the Chain Imp, or upgrade the tower that stands there). Pixel style like the
// menu and the cards. The panels keep NO shop state: every frame they re-read the state (state.save, the run's towers)
// and repaint when it changed, so a buy shows as soon as the sim applies it. Choices go out through onAction(act, detail)
// with detail.act set: 'buy' { item } · 'equip' { charm, on } · 'build' { pad, type } · 'upgrade' { pad } · 'close' { panel }.
// Every on-screen line of Brother Cinder is from docs/STORY.md hint 4; nothing says "demon", "hell" or "summon".
import * as META from '../shared/meta.js';
const { UPGRADES, upgradeCost, BASE_CHARM_SLOTS, TOWERS, CHARMS } = META;
import { ARENA } from '../shared/arena.js';

/** Brother Cinder's lines (docs/STORY.md hint 4, verbatim), by the ids EV.NPC_LINE carries. */
export const CINDER_LINES = Object.freeze({
  home: "You're home, Lamplighter. The lamp missed you.",
  hide: 'Coin for the hide? It wears thin on you. Always has.',
  afraid: "They climb because they're afraid. Afraid is good. Afraid is loud.",
  gloves: "Don't mind the gloves. They smoke when you're cross.",
  eight: 'Eight more nights. Then we can all go out.',
  eat: 'Odd. I never see you eat.',
  fall: "You'll be back. You always are. That's rather the point of you.",
  master: 'Welcome home, Master.',   // DESIGN §12.6 (the ending: the rule against the word ends here)
});
const ROTATE = ['afraid', 'gloves', 'eat', 'hide'];

/** On-screen tower names: STORY.md forbids "hell" on screen, so the Hellfire Obelisk shows as the Black Obelisk. */
export const TOWER_NAME = Object.freeze({ obelisk: 'Black Obelisk', chainimp: 'Chain Imp' });
export const towerName = (type) => TOWER_NAME[type] || String(TOWERS[type]?.name || type).replace(/hell\s*fire/ig, 'Black').replace(/\b(hell|demon|summon)\w*/ig, '').trim();
const PAD_NAME = Object.freeze({ 'pad-gate-w': 'BY THE GATE · WEST', 'pad-gate-e': 'BY THE GATE · EAST', 'pad-road': 'THE ROAD', 'pad-west': 'THE WEST YARD', 'pad-slope': 'THE SLOPE', 'pad-bend': 'THE BEND' });

/** Icon indices across the three atlases: 0–15 card-icons.png, 16–31 v2-icons-a.png, 32–47 v2-icons-b.png. */
export const ICON = Object.freeze({
  charm: Object.freeze({ 'ember-tooth': 16, 'coin-hook': 17, 'ashen-step': 18, 'bellows-heart': 19, 'cinder-ward': 20, 'soot-lens': 21, 'kindle-knot': 22, 'spark-bead': 23, 'witchfire-wick': 24 }),
  tower: Object.freeze({ obelisk: 25, chainimp: 26 }),
  upgrade: Object.freeze({ hide: 27, kestrel: 0, blunderbuss: 2, lance: 5, bombs: 6, gate: 13, slots: 46, minigun: 49, organ: 49 }),
  coin: 28, goldHeap: 36, lamp: 37, lock: 38, moon: 39, build: 40, up: 41, chain: 42, banner: 43, bucket: 44, hex: 45, rune: 46, cinder: 47,
  // icons 48–63 (v3-icons-c.png)
  pyre: 48, minigun: 49, coinAnvil: 50, bat: 51, drum: 52, hotBarrel: 53, lampUp: 54, moonTower: 55, swap: 59, star: 62, coins: 63,
});
const SHEETS = ['card-icons.png', 'v2-icons-a.png', 'v2-icons-b.png', 'v3-icons-c.png', 'v5-icons-d.png'];   // v5: 64–79 (DESIGN §16 cards)
/** CSS for an atlas icon (each sheet is 4 × 4). @param {number} i @param {string} uiBase folder URL of public/assets/ui/ */
export function iconCss(i, uiBase) {
  i = Math.max(0, i | 0);
  const sheet = SHEETS[Math.min(SHEETS.length - 1, (i / 16) | 0)], c = i % 16, ix = c % 4, iy = (c / 4) | 0;
  return `background-image:url('${uiBase}${sheet}');background-position:${(ix / 3) * 100}% ${(iy / 3) * 100}%`;
}

// ------------------------------------------------------------------------------------------------ state readers
/** the permanent save the sim keeps (meta.js freshSave shape), or an empty one */
export function saveOf(st) {
  const s = st?.save || st?.meta || null;
  return {
    gold: Number(s?.gold) || 0,
    upgrades: s?.upgrades || {},
    charms: { owned: Array.isArray(s?.charms?.owned) ? s.charms.owned : [], equipped: Array.isArray(s?.charms?.equipped) ? s.charms.equipped : [] },
    nightsCompleted: Number(s?.nightsCompleted) || 0, runN: Number(s?.runN) || 0, raw: s,
  };
}
/** gold picked up this night and not banked yet */
export function runGold(st) {
  if (!st) return 0;
  const v = st.run?.gold ?? st.runGold ?? (st.mode !== 'camp' ? st.stats?.gold : 0);
  return Number(v) || 0;
}
/** @returns {{ pad: string, type: string, level: number }[]} */
export function towersOf(st) {
  const t = st?.towers || st?.camp?.towers || st?.run?.towers;
  if (!t) return [];
  const arr = Array.isArray(t) ? t : Object.entries(t).map(([pad, v]) => ({ pad, ...(/** @type {any} */ (v)) }));
  return arr.filter((x) => x && x.type).map((x) => ({ pad: padId(x.pad), type: String(x.type), level: Math.max(1, x.level | 0 || 1) }));
}
/** pad id from an id or an index */
export function padId(p) {
  if (typeof p === 'number' || /^\d+$/.test(String(p))) return ARENA.camp.pads[Number(p)]?.id || String(p);
  return String(p ?? '');
}
export const padOf = (p) => ARENA.camp.pads.find((x) => x.id === padId(p)) || null;
export const charmSlots = (save) => BASE_CHARM_SLOTS + Math.max(0, save.upgrades?.slots | 0);
export const charmDef = (id) => CHARMS.find((c) => c.id === id) || null;

/** the one-line stats of a tower at level index li (0-based) */
export function towerStats(type, li) {
  const T = TOWERS[type]; if (!T) return '';
  const i = Math.max(0, Math.min(T.cost.length - 1, li));
  const at = (v) => (Array.isArray(v) ? v[Math.min(i, v.length - 1)] : v);
  if (type === 'obelisk') return `every ${Number(at(T.every)).toFixed(1)} s · radius ${at(T.radius)} m · ${at(T.dmg)} dmg`;
  const n = at(T.targets), pull = at(T.pull);
  return `every ${Number(at(T.every)).toFixed(1)} s · ${n} hook${n > 1 ? 's' : ''} · slow ${Math.round(at(T.slow) * 100)} %${pull ? ` · pull ${pull} m` : ''}`;
}
export const towerMax = (type) => TOWERS[type]?.cost?.length || 3;

/** The THUNDER ORGAN (DESIGN §4.2): meta.js `ORGAN` (the 100,000 purchase) + its `UPGRADES` line `organ` (10 levels). */
const ORGAN = /** @type {any} */ (META).ORGAN || { id: 'organ', name: 'Thunder Organ', cost: 100000 };
const ORGAN_ID = ORGAN.id || 'organ';
export function minigunDef() {
  const u = UPGRADES.find((x) => x.id === ORGAN_ID) || { id: ORGAN_ID, name: 'Thunder Organ', max: 10, base: 2500, growth: 1.45, text: '+10 % damage, +4 % rate, +8 % drum' };
  return { ...u, name: ORGAN.name || u.name, unlock: ORGAN.cost || 100000 };
}
/** owned / equipped (it holds slot 2) / level, from the save's `organ { owned, equipped }` and `upgrades.organ` */
export function minigunOf(st) {
  const sv = saveOf(st), raw = sv.raw || {};
  const owned = !!(raw.organ?.owned || st?.player?.unlocked?.organ);
  const equipped = owned && (raw.organ ? raw.organ.equipped !== false : !!st?.player?.unlocked?.organ);
  return { owned, level: Math.max(0, sv.upgrades[ORGAN_ID] | 0), equipped, slot2: equipped ? 'organ' : 'blunderbuss' };
}

/**
 * @param {{ root: HTMLElement, uiBase: string, h: Function, esc: (s: any) => string, fitText: (s: any) => string,
 *           emit: (a: string, d?: any) => void, sound: (s: string) => void, freePointer: () => void, now: () => number }} ctx
 */
export function createPanels(ctx) {
  const { h, esc, fitText, emit, sound, now } = ctx;
  const ic = (i) => iconCss(i, ctx.uiBase);
  const el = h('div', 'ew-modal ew-shop', ctx.root);
  h('div', 'ew-dim', el);
  const panel = h('div', 'ew-panel ew-spanel', el);
  const head = h('div', 'ew-shead', panel);
  const portrait = h('div', 'ew-portrait', head);
  portrait.style.backgroundImage = `url('${ctx.uiBase}cinder-portrait.png')`;
  const htxt = h('div', 'ew-shtxt', head);
  const kickEl = h('div', 'ew-pkick ew-skick', htxt, 'BROTHER CINDER');
  const sayEl = h('div', 'ew-say', htxt, '');
  const goldEl = h('div', 'ew-sgold ew-ts', head, '<i class="ew-coin"></i><b>0</b>');
  const goldNum = /** @type {HTMLElement} */ (goldEl.lastChild);
  const tabsEl = h('div', 'ew-tabs ew-ts', panel);
  const tabBtns = [['up', 'UPGRADES'], ['ch', 'CHARMS']].map(([id, label]) => {
    const b = /** @type {HTMLButtonElement} */ (h('button', 'ew-tab', tabsEl, label)); b.type = 'button'; b.dataset.tab = id; return b;
  });
  const body = h('div', 'ew-sbody', panel);
  const hintEl = h('div', 'ew-hint ew-shint', panel, '');

  /** @type {null | { kind: 'npc'|'pad', pad: string, tab: 'up'|'ch', sel: number, sig: string, resolve: (v: any) => void, openedAt: number, rows: HTMLElement[], acts: (null | (() => void))[], confirm: string, confirmUntil: number }} */
  let S = null;
  let lastState = /** @type {any} */ (null), lastLineAt = -99, lastLine = '', hoverArmed = false;

  function pickLine(st, reason) {
    const sv = saveOf(st);
    if (reason === 'fall') return CINDER_LINES.fall;
    if (reason === 'complete' || (st?.night?.n === 2 && st?.mode === 'camp' && sv.nightsCompleted >= 2 && reason === 'dawn2')) return CINDER_LINES.eight;
    if (!sv.runN && !sv.nightsCompleted) return CINDER_LINES.home;
    return CINDER_LINES[ROTATE[(sv.runN + sv.nightsCompleted + ((now() / 30) | 0)) % ROTATE.length]];
  }
  /** a line id or text from EV.NPC_LINE */
  function say(line) {
    const txt = CINDER_LINES[line] || (typeof line === 'string' && line.length > 8 ? line : '');
    if (!txt) return;
    lastLine = txt; lastLineAt = now();
    sayEl.textContent = `“${txt}”`;
    sayEl.classList.remove('in'); void sayEl.offsetWidth; sayEl.classList.add('in');
  }

  // ---------------------------------------------------------------------------------------------- rendering
  function signature(st) {
    const sv = saveOf(st);
    const armed = S && S.confirm && now() < S.confirmUntil ? S.confirm : '';
    return JSON.stringify([S?.kind, S?.tab, S?.pad, sv.gold, sv.upgrades, sv.charms.owned, sv.charms.equipped, towersOf(st).filter((t) => t.pad === S?.pad), minigunOf(st), armed]);
  }
  function render(st) {
    if (!S) return;
    const sv = saveOf(st), gold = sv.gold;
    goldNum.textContent = String(gold);
    S.rows = []; S.acts = [];
    let html = '';
    if (S.kind === 'npc') {
      tabsEl.style.display = '';
      tabBtns.forEach((b) => b.classList.toggle('on', b.dataset.tab === S?.tab));
      if (S.tab === 'up') {
        const pipsOf = (lv, max) => `<em class="ew-pips${max > 5 ? ' many' : ''}">${Array.from({ length: max }, (_, k) => `<i class="${k < lv ? 'on' : ''}"></i>`).join('')}</em>`;
        const rows = [];
        for (const u of UPGRADES) {
          if (u.id === ORGAN_ID || u.needs === ORGAN_ID) continue;   // the THUNDER ORGAN's rows follow
          const lv = Math.max(0, sv.upgrades[u.id] | 0), maxed = lv >= u.max, cost = maxed ? 0 : upgradeCost(u, lv);
          const short = !maxed && gold < cost;
          const right = maxed ? '<span class="ew-scost max">MAXED</span>' : `<span class="ew-scost${short ? ' short' : ''}"><i class="ew-coin"></i>${cost}</span>`;
          const why = maxed ? '' : short ? `<span class="ew-sreason">NEED ${cost - gold} MORE</span>` : `<span class="ew-sreason ok">LV ${lv} → ${lv + 1}</span>`;
          rows.push({ dis: maxed || short, icon: ICON.upgrade[u.id] ?? 15, name: u.name, pips: pipsOf(lv, u.max), text: fitText(u.text), why, right,
            run: () => emit('buy', { act: 'buy', item: u.id }) });
        }
        // the THUNDER ORGAN: 100,000 to own (a CONFIRM step), then 10 levels, then the slot-2 toggle (DESIGN §4.2)
        const M = minigunDef(), mg = minigunOf(lastState);
        if (!mg.owned) {
          const short = gold < M.unlock, armed = S.confirm === 'minigun' && now() < S.confirmUntil;
          rows.push({ dis: short, icon: ICON.minigun, name: M.name, pips: '', cls: 'organ' + (armed ? ' armed' : ''),
            text: 'A six-barrel rotary gun · replaces the Blunderbuss in slot 2', right: `<span class="ew-scost${short ? ' short' : ''}"><i class="ew-coin"></i>${M.unlock.toLocaleString('en-US')}</span>`,
            why: short ? `<span class="ew-sreason">NEED ${(M.unlock - gold).toLocaleString('en-US')} MORE</span>` : armed ? '<span class="ew-sreason warn">CONFIRM · PRESS AGAIN TO BUY</span>' : '<span class="ew-sreason ok">ENTER, THEN ENTER AGAIN TO CONFIRM</span>',
            run: () => { if (S && S.confirm === 'minigun' && now() < S.confirmUntil) { S.confirm = ''; S.sig = ''; emit('buyOrgan', { act: 'buyOrgan' }); } else if (S) { S.confirm = 'minigun'; S.confirmUntil = now() + 3; S.sig = ''; } } });
        } else {
          const lv = mg.level, maxed = lv >= (M.max || 10), cost = maxed ? 0 : upgradeCost(M, lv), short = !maxed && gold < cost;
          rows.push({ dis: maxed || short, icon: ICON.minigun, name: M.name, pips: pipsOf(lv, M.max || 10), cls: 'organ', text: fitText(M.text || ''),
            right: maxed ? '<span class="ew-scost max">MAXED</span>' : `<span class="ew-scost${short ? ' short' : ''}"><i class="ew-coin"></i>${cost}</span>`,
            why: maxed ? '' : short ? `<span class="ew-sreason">NEED ${cost - gold} MORE</span>` : `<span class="ew-sreason ok">LV ${lv} → ${lv + 1}</span>`,
            run: () => emit('buy', { act: 'buy', item: ORGAN_ID }) });
          rows.push({ dis: false, icon: ICON.swap, name: 'Slot 2', pips: '', cls: 'swap',
            text: `Carried: ${mg.equipped ? 'the Thunder Organ' : 'the Blunderbuss'} · both keep their upgrades`, why: `<span class="ew-sreason ok">ENTER TO CARRY THE ${mg.equipped ? 'BLUNDERBUSS' : 'THUNDER ORGAN'}</span>`,
            right: '<span class="ew-scost max">⇄</span>',
            run: () => emit('equipOrgan', { act: 'equipOrgan', on: !mg.equipped }) });
        }
        html = rows.map((r, i) => `<button type="button" class="ew-srow ${r.cls || ''}${r.dis ? ' dis' : ''}" data-i="${i}"><span class="ew-key">${i + 1}</span>`
          + `<span class="ew-sicon" style="${ic(r.icon)}"></span><span class="ew-sname ew-ts">${esc(String(r.name).toUpperCase())}${r.pips}</span>`
          + `<span class="ew-stext">${esc(r.text)}${r.why}</span>${r.right}</button>`).join('');
        S.acts = rows.map((r) => r.run);
        hintEl.textContent = `1–${S.acts.length} BUY · ↑↓ SELECT · ←→ TABS · ENTER · E / ESC CLOSE`;
      } else {
        const slots = charmSlots(sv), eq = sv.charms.equipped, owned = sv.charms.owned;
        let slotHtml = '';
        for (let k = 0; k < BASE_CHARM_SLOTS + 2; k++) {
          const id = eq[k], locked = k >= slots;
          slotHtml += `<span class="ew-cslot${locked ? ' lock' : id ? ' full' : ''}">${id ? `<i style="${ic(ICON.charm[id] ?? 15)}"></i>` : locked ? `<i class="lk" style="${ic(ICON.lock)}"></i>` : ''}</span>`;
        }
        html = `<div class="ew-cslots ew-ts"><span>SLOTS ${eq.length}/${slots}</span>${slotHtml}${slots < BASE_CHARM_SLOTS + 2 ? '<em>more slots: Charm slot upgrade</em>' : ''}</div><div class="ew-cgrid">`
          + CHARMS.map((c, i) => {
            const has = owned.includes(c.id), on = eq.includes(c.id), full = !on && eq.length >= slots;
            const cls = !has ? ' unk dis' : on ? ' on' : full ? ' dis' : '';
            const why = !has ? 'NOT FOUND YET' : on ? 'EQUIPPED' : full ? 'NO FREE SLOT' : 'ENTER TO EQUIP';
            return `<button type="button" class="ew-crow2${cls}" data-i="${i}"><span class="ew-key">${i + 1}</span>`
              + `<span class="ew-sicon" style="${has ? ic(ICON.charm[c.id] ?? 15) : ''}">${has ? '' : '?'}</span>`
              + `<span class="ew-cbody"><span class="ew-sname ew-ts">${has ? esc(c.name.toUpperCase()) : '? ? ?'}</span>`
              + `<span class="ew-stext">${has ? esc(fitText(c.text)) : 'Some goblin chiefs carry one.'}</span><span class="ew-sreason${on ? ' ok' : ''}">${why}</span></span></button>`;
          }).join('') + '</div>';
        hintEl.textContent = '1–9 EQUIP · ↑↓ SELECT · ←→ TABS · ENTER · E / ESC CLOSE';
      }
    } else {
      tabsEl.style.display = 'none';
      const tw = towersOf(st).find((t) => t.pad === S.pad) || null;
      if (!tw) {
        html = '<div class="ew-tcards">' + ['obelisk', 'chainimp'].map((type, i) => {
          const T = TOWERS[type], cost = T.cost[0], short = gold < cost;
          return `<button type="button" class="ew-tcard${short ? ' dis' : ''} ${type}" data-i="${i}"><span class="ew-key">${i + 1}</span>`
            + `<span class="ew-ticon" style="${ic(ICON.tower[type])}"></span><span class="ew-tname ew-ts">${esc(towerName(type).toUpperCase())}</span>`
            + `<span class="ew-stext">${esc(fitText(T.text))}</span><span class="ew-tstat">${esc(towerStats(type, 0))}</span>`
            + `<span class="ew-scost${short ? ' short' : ''}"><i class="ew-coin"></i>${cost}</span><span class="ew-sreason${short ? '' : ' ok'}">${short ? `NEED ${cost - gold} MORE` : 'ENTER TO BUILD'}</span></button>`;
        }).join('') + '</div>';
        hintEl.textContent = '1 2 BUILD · ←→ SELECT · ENTER · E / ESC CLOSE';
      } else {
        const T = TOWERS[tw.type], lv = Math.min(T.cost.length, tw.level), maxed = lv >= T.cost.length, cost = maxed ? 0 : T.cost[lv], short = !maxed && gold < cost;
        const pips = T.cost.map((_, k) => `<i class="${k < lv ? 'on' : ''}"></i>`).join('');
        html = `<div class="ew-tcards one"><button type="button" class="ew-tcard${maxed || short ? ' dis' : ''} ${tw.type}" data-i="0"><span class="ew-key">1</span>`
          + `<span class="ew-ticon" style="${ic(ICON.tower[tw.type] ?? 15)}"></span><span class="ew-tname ew-ts">${esc(towerName(tw.type).toUpperCase())}<em class="ew-pips">${pips}</em></span>`
          + `<span class="ew-tstat now">NOW: ${esc(towerStats(tw.type, lv - 1))}</span>`
          + (maxed ? '<span class="ew-scost max">MAXED</span>' : `<span class="ew-tstat">LV ${lv + 1}: ${esc(towerStats(tw.type, lv))}</span><span class="ew-scost${short ? ' short' : ''}"><i class="ew-coin"></i>${cost}</span>`
            + `<span class="ew-sreason${short ? '' : ' ok'}">${short ? `NEED ${cost - gold} MORE` : 'ENTER TO UPGRADE'}</span>`)
          + '</button></div>';
        hintEl.textContent = '1 UPGRADE · ENTER · E / ESC CLOSE';
      }
    }
    body.innerHTML = html;
    S.rows = /** @type {HTMLElement[]} */ ([...body.querySelectorAll('button')]);
    S.rows.forEach((r, i) => {
      r.addEventListener('mousemove', (e) => { if (!S || !hoverArmed || S.sel === i || Math.abs(e.movementX) + Math.abs(e.movementY) === 0) return; S.sel = i; paintSel(); sound('move'); });
      r.addEventListener('click', (e) => { e.stopPropagation(); if (!S) return; S.sel = i; paintSel(); act(i); });
    });
    if (S.sel >= S.rows.length) S.sel = Math.max(0, S.rows.length - 1);
    paintSel();
  }
  function paintSel() { if (S) S.rows.forEach((r, i) => r.classList.toggle('sel', i === S?.sel)); }
  function pulse(i) { const r = S?.rows[i]; if (!r) return; r.classList.remove('bump'); void r.offsetWidth; r.classList.add('bump'); }
  function deny(i) { const r = S?.rows[i]; if (!r) return; r.classList.remove('deny'); void r.offsetWidth; r.classList.add('deny'); sound('back'); }

  /** act on row i (buy / equip / build / upgrade), or deny with a shake when it is disabled */
  function act(i) {
    if (!S || i < 0 || i >= S.rows.length) return;
    if (now() - S.openedAt < 0.25) return;   // the E that opened the panel must not buy
    const st = lastState, sv = saveOf(st), r = S.rows[i];
    if (r.classList.contains('dis')) { deny(i); return; }   // the sim's 'shop.denied' is for a buy the sim refuses; a greyed line only shakes
    if (S.kind === 'npc' && S.tab === 'up') {
      const run = S.acts[i]; if (!run) return;
      run(); sound('select'); pulse(i);
      if (S && S.sig === '') update(lastState);   // a CONFIRM step repaints at once
    } else if (S.kind === 'npc') {
      const c = CHARMS[i]; if (!c) return;
      const on = !sv.charms.equipped.includes(c.id);
      emit('equip', { act: 'equip', charm: c.id, on }); sound('select'); pulse(i);
    } else {
      const tw = towersOf(st).find((t) => t.pad === S?.pad);
      if (tw) emit('upgrade', { act: 'upgrade', pad: S.pad });
      else emit('build', { act: 'build', pad: S.pad, type: i === 0 ? 'obelisk' : 'chainimp' });
      sound('select'); pulse(i);
    }
  }
  function setTab(tab) {
    if (!S || S.kind !== 'npc' || S.tab === tab) return;
    S.tab = tab; S.sel = 0; S.sig = ''; sound('tab');
    update(lastState);
  }

  tabBtns.forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); setTab(/** @type {any} */ (b.dataset.tab)); }));
  el.addEventListener('mousemove', (e) => { if (Math.abs(e.movementX) + Math.abs(e.movementY) > 0) hoverArmed = true; });
  el.addEventListener('pointerdown', (e) => { if (/** @type {HTMLElement} */ (e.target).classList.contains('ew-dim')) close('click'); });

  // ---------------------------------------------------------------------------------------------- API
  /** @param {'npc'|'pad'} kind @param {any} st @param {{ pad?: any, tab?: 'up'|'ch', reason?: string, line?: string }} [detail] */
  function open(kind, st, detail = {}) {
    if (st) lastState = st;
    kind = kind === 'pad' ? 'pad' : 'npc';
    const pad = kind === 'pad' ? padId(detail.pad ?? 0) : '';
    if (S && S.kind === kind && S.pad === pad) return new Promise((r) => { const prev = S?.resolve; if (S) S.resolve = (v) => { prev?.(v); r(v); }; });
    if (S) close('replace', true);
    return new Promise((resolve) => {
      S = { kind, pad, tab: detail.tab === 'ch' ? 'ch' : 'up', sel: 0, sig: '', resolve, openedAt: now(), rows: [], acts: [], confirm: '', confirmUntil: 0 };
      hoverArmed = false;
      el.classList.toggle('pad', kind === 'pad');
      if (kind === 'npc') {
        kickEl.textContent = 'BROTHER CINDER';
        portrait.style.display = '';
        if (detail.line) say(detail.line);
        else if (now() - lastLineAt > 2.5 || !lastLine) say(pickLine(lastState, detail.reason));
        else { sayEl.textContent = `“${lastLine}”`; }
        sayEl.style.display = '';
      } else {
        const pd = padOf(pad);
        kickEl.textContent = `BUILD PAD · ${PAD_NAME[pad] || String(pad).replace(/^pad-/, '').toUpperCase()}`;
        portrait.style.display = 'none';
        sayEl.style.display = 'none';
        void pd;
      }
      ctx.freePointer();
      update(lastState);
      el.classList.remove('on'); void el.offsetWidth; el.classList.add('on');   // no 'open' sound: the audio code sounds NPC_OPEN / pad.open
    });
  }
  /** @param {string} [reason] @param {boolean} [silent] true when the sim closed it (no 'close' action back) */
  function close(reason = 'close', silent = false) {
    if (!S) return;
    const s = S; S = null;
    el.classList.remove('on');
    if (!silent) emit('close', { act: 'close', panel: s.kind, pad: s.pad || undefined, reason });
    s.resolve(reason);
  }
  function update(st) {
    if (st) lastState = st;
    if (!S) return;
    const sig = signature(lastState);
    if (sig !== S.sig) { S.sig = sig; render(lastState); }
  }
  /** keys while a panel is open; returns true when the key was taken */
  function onKey(e) {
    if (!S) return false;
    const k = e.code || e.key;
    const take = () => { e.preventDefault(); e.stopPropagation(); };
    const dm = /^(Digit|Numpad)([1-9])$/.exec(k);
    if (dm) { take(); if (!e.repeat) { const i = Number(dm[2]) - 1; if (i < S.rows.length) { S.sel = i; paintSel(); act(i); } } return true; }
    const n = S.rows.length || 1;
    const two = S.kind === 'pad';
    if (k === 'ArrowUp' || k === 'KeyW' || (two && (k === 'ArrowLeft' || k === 'KeyA'))) { take(); S.sel = (S.sel - 1 + n) % n; paintSel(); sound('move'); return true; }
    if (k === 'ArrowDown' || k === 'KeyS' || (two && (k === 'ArrowRight' || k === 'KeyD'))) { take(); S.sel = (S.sel + 1) % n; paintSel(); sound('move'); return true; }
    if (!two && (k === 'ArrowLeft' || k === 'ArrowRight' || k === 'KeyA' || k === 'KeyD' || k === 'Tab' || k === 'KeyQ')) { take(); setTab(S.tab === 'up' ? 'ch' : 'up'); return true; }
    if (k === 'Enter' || k === 'NumpadEnter' || k === 'Space') { take(); if (!e.repeat) act(S.sel); return true; }
    if (k === 'Escape' || k === 'KeyE' || k === 'Backspace') { take(); if (!e.repeat && now() - S.openedAt > 0.25) close(k === 'Escape' ? 'esc' : 'key'); return true; }
    take();   // everything else is swallowed while the panel is up (no weapon switch, no jump)
    return true;
  }
  /** a sim event while the panel is up: a buy / equip / build pulses its row */
  function onEvent(ev) {
    if (!S || !ev) return;
    if (ev.type === 'shop.buy') { const i = UPGRADES.filter((u) => u.id !== ORGAN_ID).findIndex((u) => u.id === ev.item); if (i >= 0 && S.tab === 'up') pulse(i); goldEl.classList.remove('bump'); void goldEl.offsetWidth; goldEl.classList.add('bump'); }
  }

  return {
    open, close, update, onKey, onEvent, say, pickLine,
    /** test hook: act on row i as if picked (bypasses the open guard) */
    choose(i) { if (!S) return false; S.openedAt = -9; if (typeof i === 'string') { const ups = UPGRADES.filter((u) => u.id !== ORGAN_ID); const j = S.kind === 'npc' ? (S.tab === 'up' ? (i === 'minigun' || i === ORGAN_ID ? ups.length : ups.findIndex((x) => x.id === i)) : CHARMS.findIndex((x) => x.id === i)) : ['obelisk', 'chainimp'].indexOf(i); i = j; } act(Number(i)); return true; },
    setTab,
    get isOpen() { return !!S; },
    get kind() { return S?.kind || ''; },
    get pad() { return S?.pad || ''; },
    el,
  };
}
