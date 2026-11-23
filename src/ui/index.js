// @ts-check
// The DOM HUD over the canvas (docs/DESIGN.md §14.3 createUI, §2.3–§2.5, §3; docs/ART-DIRECTION.md §3, §8). Layout
// after docs/mockups/M1_hybrid.jpg: top-centre the night clock + dawn bar + gate bar + beacon line (+ the troll's bar),
// top-left LV + the XP bar + the gold count, bottom-left the HP bar, bottom-right the weapon block (slots, name, rounds or
// the fuel gauge, firebomb pips, the Sunburst meter); NO crosshair (DESIGN §13: the hit marker is a small world-space flash,
// src/fx); the beacon / camp prompts; banners, toasts, subtitles; elite name plates; the level-up cards, the P menu, the H
// controls, Brother Cinder's panel and the pad panel (./panels.js), the night / dawn / coming-soon / fallen cards;
// letterbox, fade and the caption for the cinema.
// DOM writes happen only when a value changes; motion uses transforms and CSS animations.
import { EV } from '../shared/events.js';
import { ARENA, groundHeight } from '../shared/arena.js';
import * as TL from '../shared/timeline.js';
import { buildCss } from './style.js';
import { buildCssV2 } from './style2.js';
import { cardDef, SKILL_CARDS, skillBase } from './cards.js';
import { createPanels, saveOf, runGold, towersOf, towerName, padOf, CINDER_LINES, iconCss, ICON, towerMax, minigunDef, minigunOf } from './panels.js';
import { NIGHTS, NIGHTS_PLANNED, CHARMS, TOWERS, UPGRADES, upgradeCost } from '../shared/meta.js';
import { createMenuSelect, createMenuToggle } from '../core/menu-select.js';

const STYLE_ID = 'ew-ui-style';
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : Number.isFinite(x) ? x : 0);
const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
const WEAPON_NAME = Object.freeze({ pistol: 'KESTREL', blunderbuss: 'BLUNDERBUSS', lance: 'EMBER LANCE', organ: 'THUNDER ORGAN', minigun: 'THUNDER ORGAN' });
const MAG = Object.freeze({ pistol: 8, blunderbuss: 4, organ: 240, minigun: 240 });
const RELOAD_S = Object.freeze({ pistol: 1.2, blunderbuss: 1.6, organ: 2.2, minigun: 2.2 });
const isOrgan = (w) => w === 'organ' || w === 'minigun';
const KINDLE_S = 40;
const n0 = (st) => clamp01((st?.night?.clock || 0) / (st?.night?.dawnAt || 300));

/** @param {string} tag @param {string} [cls] @param {HTMLElement|null} [parent] @param {string} [html] */
function h(tag, cls, parent, html) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (html != null) el.innerHTML = html;
  if (parent) parent.appendChild(el);
  return el;
}
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
/** Keep short tokens on one line with their number: "+20 %" never wraps a lone "%", "×3" stays with its word. */
export const fitText = (s) => String(s ?? '').replace(/\s+%/g, '\u00a0%').replace(/([+×−-])\s+(?=\d)/g, '$1\u00a0').replace(/(\d)\s+(s|m|HP)\b/g, '$1\u00a0$2');
export const fmtTime = (s) => { s = Math.max(0, Math.floor(s || 0)); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };

/** A pixel bar: fill + trailing chip (damage) + flash. */
function makeBar(parent, cls) {
  const el = h('div', `ew-bar ${cls}`, parent);
  const track = h('div', 'ew-track', el);
  const chip = h('div', 'ew-chip', track);
  const fill = h('div', 'ew-fill', track);
  const flash = h('div', 'ew-flash', track);
  return { el, track, chip, fill, flash, target: 1, fillV: 1, chipV: 1, hold: 0, wf: -1, wc: -1, flashT: 0 };
}
/** Damage snaps the fill and leaves a chip that drains after a hold; gains grow smoothly. */
function stepBar(bar, target, dt, hold = 0.45, drain = 0.9, grow = 2.5) {
  target = clamp01(target);
  if (target < bar.target - 1e-4) { bar.fillV = target; bar.hold = hold; if (bar.chipV < bar.target) bar.chipV = bar.target; }
  bar.target = target;
  if (bar.fillV < target) bar.fillV = Math.min(target, bar.fillV + grow * dt);
  if (bar.fillV > target) bar.fillV = target;
  if (bar.hold > 0) bar.hold -= dt;
  else if (bar.chipV > bar.fillV) bar.chipV = Math.max(bar.fillV, bar.chipV - drain * dt);
  if (bar.chipV < bar.fillV) bar.chipV = bar.fillV;
  const wf = Math.round(bar.fillV * 1000) / 1000, wc = Math.round(bar.chipV * 1000) / 1000;
  if (wf !== bar.wf) { bar.wf = wf; bar.fill.style.transform = `scaleX(${wf})`; }
  if (wc !== bar.wc) { bar.wc = wc; bar.chip.style.transform = `scaleX(${wc})`; }
  if (bar.flashT > 0) { bar.flashT -= dt; if (bar.flashT <= 0) bar.flash.classList.remove('on'); }
}
function snapBar(bar, v) { bar.target = bar.fillV = bar.chipV = clamp01(v); bar.hold = 0; bar.wf = bar.wc = -1; }
function flashBar(bar) { bar.flash.classList.add('on'); bar.flashT = 0.07; }

/** Where the game's source and the fire modules live (the title and the pause menu link to them). */
const LINKS = Object.freeze({
  repo: 'https://github.com/lethehaiau/valleyward',
  fire: 'https://github.com/lethehaiau/firewraith/blob/main/CONTRIBUTING.md',
});
/** The GitHub mark (Octicons `mark-github`, MIT, GitHub Inc.), drawn with crisp edges to sit with the pixel HUD. */
const GH_MARK = '<svg class="ew-ghmark" viewBox="0 0 16 16" aria-hidden="true" shape-rendering="crispEdges"><path fill="currentColor" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>';
const outLink = (href, html, cls = '') => `<a class="${cls}" href="${href}" target="_blank" rel="noopener noreferrer">${html}</a>`;

/** The VALLEYWARD pixel wordmark (the night card and the standalone cover share it). */
const LOGO_HTML = '<div class="ew-logo" aria-label="Valleyward"><span class="ew-logo-x" aria-hidden="true">VALLEYWARD</span><span class="ew-logo-t">VALLEYWARD</span></div>';

/**
 * Fill the standalone cover (index.html's #loading) with the wordmark and the "click to begin" line in the HUD
 * fonts. Safe to call more than once; the stylesheet also restyles the plain markup main.js writes.
 * @param {HTMLElement | null} el @param {string} [line]
 */
export function titleCover(el, line = 'CLICK TO BEGIN') {
  if (!el) return;
  el.classList.add('ew-cover');
  el.innerHTML = `<div class="ew-coverc">${LOGO_HTML}<div class="ew-coversub">THE NIGHT WATCH OF THE LAST LAMPLIGHTER</div><div class="ew-coverline">${esc(line)}</div></div>`
    + `<nav class="ew-coverlinks" aria-label="Links">${outLink(LINKS.repo, `${GH_MARK}<span>GITHUB</span>`)}`
    + `${outLink(LINKS.fire, '<span>BUILD YOUR OWN FIRE</span>')}</nav>`;
}

const CONTROLS = [
  ['Move', ['W', 'A', 'S', 'D'], 'Shift sprint'],
  ['Jump', ['Space']],
  ['Look', ['Mouse'], 'click to lock'],
  ['Fire', ['Left click'], 'hold for the Lance'],
  ['Firebomb', ['Right click', 'G']],
  ['Weapons', ['1', '2', '3'], 'or the wheel'],
  ['Reload', ['R']],
  ['Kindle the beacon', ['E'], 'at the pan on the wall'],
  ['Sunburst', ['Q'], 'when charged'],
  ['Pick a card', ['1', '2', '3'], 'or click'],
  ['Menu', ['P']],
  ['Controls', ['H']],
  ['Menu', ['Esc']],
];

/**
 * @param {{ root?: HTMLElement|null, assetsBase?: string, noui?: boolean, keys?: boolean,
 *           fireStyle?: 'smooth'|'hybrid', cardDefs?: Record<string, any>,
 *           menuSettings?: import('../core/menu-select.js').MenuSetting[],
 *           onAction?: (a: string, detail?: any) => void, onFireStyle?: (s: 'smooth'|'hybrid') => void }} [opts]
 */
export function createUI(opts = {}) {
  const root = opts.root || document.getElementById('ui') || document.body;
  const listenKeys = opts.keys !== false;
  let noui = opts.noui;
  if (noui == null) { try { noui = new URLSearchParams(location.search).get('noui') === '1'; } catch { noui = false; } }

  let base = opts.assetsBase;
  if (!base) { try { base = (import.meta.env?.BASE_URL ?? './') + 'assets/'; } catch { base = './assets/'; } }
  if (!document.getElementById(STYLE_ID)) {
    const st = document.createElement('style');
    st.id = STYLE_ID;
    st.textContent = buildCss(base + 'fonts/') + buildCssV2();
    document.head.appendChild(st);
  }

  // ------------------------------------------------------------------------------------------------ DOM
  const ui = h('div', 'ewui' + (noui ? ' ew-noui' : ''), root);
  ui.setAttribute('aria-live', 'polite');
  const lbTop = h('div', 'ew-lb top', ui), lbBot = h('div', 'ew-lb bot', ui); void lbTop; void lbBot;

  // top-left: LV + XP
  const tl = h('div', 'ew-hud ew-tl', ui);
  const lvRow = h('div', 'ew-lvrow', tl);
  const lvEl = h('div', 'ew-lv ew-ts', lvRow, 'LV 1');
  const xp = makeBar(lvRow, 'ew-xp');
  const goldRow = h('div', 'ew-goldrow ew-ts', tl, '<i class="ew-coin"></i><b>0</b><em></em>');
  const goldNum = /** @type {HTMLElement} */ (goldRow.children[1]), goldRun = /** @type {HTMLElement} */ (goldRow.children[2]);
  // the camp's top line (DESIGN §9.2): replaces the night bars at the camp
  const campTop = h('div', 'ew-hud ew-camptop ew-ts', ui, '<b>THE CAMP · DUSK</b><span></span>');
  const campNext = /** @type {HTMLElement} */ (campTop.lastChild);
  // Siege Ram plates (DESIGN §5.6: HP + crew pips; ≤ 3)
  const ramPlates = Array.from({ length: 3 }, () => {
    const el = h('div', 'ew-plate ram ew-ts', null, '<b>SIEGE RAM</b>');
    const bar = makeBar(el, 'ew-pbar'); const crew = h('div', 'ew-crew', el);
    return { el, bar, crew, ck: '' };
  });
  // elite name plates (projected each frame; ≤ 4)
  const platesEl = h('div', 'ew-plates', ui);
  ramPlates.forEach((r) => platesEl.appendChild(r.el));
  const plates = Array.from({ length: 4 }, () => {
    const el = h('div', 'ew-plate ew-ts', platesEl, '<b></b>');
    return { el, name: /** @type {HTMLElement} */ (el.firstChild), bar: makeBar(el, 'ew-pbar'), kind: '', id: -1, on: false };
  });

  // top-centre: clock, dawn bar, gate, beacon, troll
  const top = h('div', 'ew-hud ew-top', ui);
  const clockEl = h('div', 'ew-clock ew-ts', top, '<span>NIGHT I</span><b>00:00</b>');
  const nightLbl = /** @type {HTMLElement} */ (clockEl.firstChild), timeLbl = /** @type {HTMLElement} */ (clockEl.lastChild);
  const dawn = makeBar(top, 'ew-dawn');
  // the troll markers on the dawn bar (Night I one at 3:30, Night II two: NIGHTS[n].trolls)
  const trollMarks = [0, 1].map(() => h('div', 'ew-mark', dawn.el, '<i></i>'));
  const trollMark = trollMarks[0];
  trollMark.style.left = `${(210 / 300) * 100}%`;
  const row2 = h('div', 'ew-row2 ew-ts', top);
  h('span', '', row2, 'GATE');
  const gate = makeBar(row2, 'ew-gate');
  const gatePct = h('span', 'ew-gatepct', row2, '100%');
  const beaconEl = h('div', 'ew-beacon ew-ts', top, '');
  const trollEl = h('div', 'ew-troll', top);
  h('div', 'ew-tname ew-ts', trollEl, 'THE ASH TROLL<em>RED-HOT · GUNS ×3</em>');
  const trollBar = makeBar(trollEl, 'ew-tbar');
  // DESIGN §8: the Rainmother's bar (phase ticks at 66 % / 33 %, the crown's lanterns, the climb), the coven's chant, rain
  const bossEl = h('div', 'ew-boss', top);
  h('div', 'ew-tname ew-ts', bossEl, 'THE RAINMOTHER');
  const bossBar = makeBar(bossEl, 'ew-bbar');
  h('i', 'ew-btick', bossBar.track).style.left = '66%'; h('i', 'ew-btick', bossBar.track).style.left = '33%';
  const bossInfo = h('div', 'ew-binfo ew-ts', bossEl, '<span class="ew-bphase"></span><span class="ew-bcrown"></span>');
  const bossPhase = /** @type {HTMLElement} */ (bossInfo.firstChild), bossCrown = /** @type {HTMLElement} */ (bossInfo.lastChild);
  const bossClimb = h('div', 'ew-bclimb ew-ts', bossEl, '<span>SHE CLIMBS TO THE GATE</span><div class="ew-cltrack"><div class="ew-clfill"></div></div>');
  const bossClimbFill = /** @type {HTMLElement} */ (bossClimb.querySelector('.ew-clfill'));
  const covenEl = h('div', 'ew-coven ew-ts', top, '<span>THE COVEN CHANTS · THE LAMP DIMS</span><div class="ew-cltrack"><div class="ew-clfill"></div></div>');
  const covenFill = /** @type {HTMLElement} */ (covenEl.querySelector('.ew-clfill'));
  const rainEl = h('div', 'ew-rain ew-ts', top, 'RAIN · FIRE WEAK');

  // bottom-left: HP
  const bl = h('div', 'ew-hud ew-bl', ui);
  const hpRow = h('div', 'ew-hprow', bl);
  const hpNum = h('div', 'ew-hpnum ew-ts', hpRow, '100');
  const hp = makeBar(hpRow, 'ew-hp');

  // bottom-right: weapon block
  const br = h('div', 'ew-hud ew-br', ui);
  const extras = h('div', 'ew-extras', br);
  const bombsEl = h('div', 'ew-bombs', extras);
  h('span', 'ew-bkey ew-ts', bombsEl, 'G');
  /** @type {HTMLElement[]} */ let bombEls = [];
  const sunEl = h('div', 'ew-sun', extras);
  h('span', 'ew-qkey', sunEl, 'Q');
  const sun = makeBar(sunEl, 'ew-sunbar');
  const slotsEl = h('div', 'ew-slots ew-ts', br);
  const slotEls = ['pistol', 'blunderbuss', 'lance'].map((w, i) => h('span', 'ew-slot', slotsEl, String(i + 1)));
  const wname = h('div', 'ew-wname ew-ts', br, 'KESTREL');
  const gauge = h('div', 'ew-gauge', br);
  const ammoEl = h('div', 'ew-ammo', gauge);
  const roundsEl = h('div', 'ew-rounds', ammoEl);
  const reload = makeBar(ammoEl, 'ew-reload');
  const acount = h('div', 'ew-acount ew-ts', ammoEl, '8');
  const fuel = makeBar(gauge, 'ew-fuel');
  const heat = makeBar(gauge, 'ew-heat');   // the THUNDER ORGAN's heat (DESIGN §4.2)
  const rhint = h('div', 'ew-rhint ew-ts', br, '');
  // the camp (DESIGN §9.2): BEGIN NIGHT button + tip, a pulsing marker at the pan, the marker over Brother Cinder
  const beginEl = h('div', 'ew-begin', ui, '<button type="button" class="ew-beginbtn ew-ts"><span class="ew-key">N</span><b>BEGIN NIGHT I</b></button>'
    + '<div class="ew-begintip ew-ts">Ready? Begin the night here — or kindle the lamp at the pan on the wall walk (E).</div>');
  const beginBtn = /** @type {HTMLButtonElement} */ (beginEl.firstChild), beginLbl = /** @type {HTMLElement} */ (beginBtn.lastChild);
  const panMark = h('div', 'ew-wmark pan', ui, `<div class="ew-wbob"><i class="ew-wicon" style="${iconCss(ICON.lampUp, base + 'ui/')}"></i></div><b class="ew-ts">THE LAMP · E</b>`);
  const npcMark = h('div', 'ew-wmark npc', ui, `<div class="ew-wbob"><i class="ew-wicon" style="${iconCss(ICON.coinAnvil, base + 'ui/')}"></i></div><b class="ew-ts">BROTHER CINDER · UPGRADES</b>`);

  // no crosshair and no hit marker at the screen centre (DESIGN §13): src/fx flashes the impact point instead

  // prompt, banners, toasts, subtitles, hint strip
  const promptEl = h('div', 'ew-prompt ew-ts', ui);
  const pMain = h('div', 'ew-pmain', promptEl, '<span class="ew-key">E</span><span class="ew-ptext"></span>');
  const pText = /** @type {HTMLElement} */ (pMain.lastChild);
  const pSub = h('div', 'ew-psub', promptEl, '');
  const bannerEl = h('div', 'ew-banner ew-ts', ui, '<div class="ew-btitle"></div><div class="ew-bsub"></div>');
  const bTitle = /** @type {HTMLElement} */ (bannerEl.firstChild), bSub = /** @type {HTMLElement} */ (bannerEl.lastChild);
  const toastsEl = h('div', 'ew-toasts ew-ts', ui);
  const toastEl = h('div', 'ew-toast', toastsEl, '<b></b><span></span>');
  const toastT = /** @type {HTMLElement} */ (toastEl.firstChild), toastS = /** @type {HTMLElement} */ (toastEl.lastChild);
  const subEl = h('div', 'ew-sub ew-ts', ui);
  const hintsEl = h('div', 'ew-hints ew-ts', ui,
    '<span><span class="ew-key">H</span>CONTROLS</span><span><span class="ew-key">P</span>MENU</span><span><span class="ew-key">E</span>KINDLE AT THE BEACON</span>');
  const fadeEl = h('div', 'ew-fade', ui);
  const captionEl = h('div', 'ew-caption ew-ts', ui, '');
  const creditsEl = h('div', 'ew-credits', ui, '');
  const skipEl = h('div', 'ew-skip ew-ts', ui, '<span class="ew-key">SPACE</span>SKIP');

  // level-up cards
  const cardsEl = h('div', 'ew-modal ew-cards', ui);
  h('div', 'ew-dim', cardsEl);
  const cwrap = h('div', 'ew-cwrap', cardsEl);
  h('div', 'ew-chead', cwrap, 'LEVEL UP!');
  const csub = h('div', 'ew-csub ew-ts', cwrap, 'Choose one');
  const crow = h('div', 'ew-crow', cwrap);

  // menu
  const menuEl = h('div', 'ew-modal ew-menu', ui);
  h('div', 'ew-dim', menuEl);
  const menuPanel = h('div', 'ew-panel', menuEl);
  h('div', 'ew-pkick', menuPanel, 'VALLEYWARD');
  h('div', 'ew-ptitle ew-ts', menuPanel, 'PAUSED');
  const menuItems = h('div', 'ew-items', menuPanel);
  /** @type {Map<string, ReturnType<typeof createMenuSelect>>} */
  const menuSelects = new Map();
  const menuBtns = [['resume', 'RESUME'], ['restart', 'RESTART NIGHT'], ['style', 'FIRE STYLE']].map(([id, label]) => {
    const b = /** @type {HTMLButtonElement} */ (h('button', 'ew-item ew-ts', menuItems, label));
    b.type = 'button'; b.dataset.act = id; b.dataset.label = label; return b;
  });
  const restartBtn = menuBtns[1], styleBtn = menuBtns[2];
  const styleTog = h('span', 'ew-style', styleBtn, '<span data-s="smooth">SMOOTH</span><span data-s="hybrid">HYBRID</span>');
  /** @type {HTMLElement[]} */
  const menuRows = [...menuBtns];
  const rendererSetting = opts.menuSettings?.find(({ id }) => id === 'renderer');
  const rendererDialog = rendererSetting ? /** @type {HTMLDialogElement} */ (h('dialog', 'ew-panel ew-renderer-dialog', menuEl)) : null;
  if (rendererDialog) h('h2', 'ew-ptitle ew-ts', rendererDialog, 'SWITCH RENDERER?');
  const rendererPrompt = rendererDialog ? h('p', 'ew-body', rendererDialog) : null;
  if (rendererDialog && rendererSetting) {
    rendererDialog.setAttribute('aria-label', 'Switch renderer?');
    const actions = h('form', 'ew-renderer-actions', rendererDialog,
      '<button type="submit" class="ew-btn ew-ts" value="cancel" autofocus>Cancel</button><button type="submit" class="ew-btn ew-ts" value="switch">Switch</button>');
    actions.setAttribute('method', 'dialog');
    actions.addEventListener('submit', (e) => {
      const button = /** @type {HTMLButtonElement|null} */ (/** @type {SubmitEvent} */ (e).submitter);
      if (button?.value === 'switch') rendererSetting.choose(rendererDialog.dataset.renderer ?? '');
    });
  }

  /** @param {import('../core/menu-select.js').MenuChoice | undefined} choice */
  function confirmRenderer(choice) {
    if (!rendererDialog || !rendererPrompt || !choice || choice.disabled || choice.id === rendererSetting?.selected()) return;
    rendererDialog.dataset.renderer = choice.id;
    rendererPrompt.textContent = `The game will reload to switch to ${choice.label}.`;
    rendererDialog.setAttribute('aria-description', rendererPrompt.textContent);
    rendererDialog.showModal();
  }

  for (const setting of opts.menuSettings ?? []) {
    if (setting === rendererSetting) {
      const row = h('div', 'ew-item ew-ts', menuItems, 'RENDERER');
      row.dataset.act = setting.id;
      const toggle = createMenuToggle(setting, confirmRenderer);
      toggle.className = 'ew-style ew-renderer-options';
      row.append(toggle);
      menuRows.push(row);
      continue;
    }
    const row = h('label', 'ew-item ew-menu-setting ew-ts', menuItems);
    row.dataset.act = setting.id;
    const name = h('span', '', row);
    name.textContent = setting.label;
    const control = createMenuSelect(setting);
    row.append(control.select);
    menuRows.push(row);
    menuSelects.set(setting.id, control);
  }
  const controlsBtn = /** @type {HTMLButtonElement} */ (h('button', 'ew-item ew-ts', menuItems, 'CONTROLS'));
  controlsBtn.type = 'button';
  controlsBtn.dataset.act = 'controls';
  menuRows.push(controlsBtn);
  if (menuSelects.size) h('div', 'ew-hint ew-reload-hint', menuPanel, 'Module changes reload the game.');
  h('div', 'ew-hint', menuPanel, 'P or Esc to resume');
  h('div', 'ew-menulinks', menuPanel, outLink(LINKS.repo, `${GH_MARK}<span>SOURCE ON GITHUB</span>`) + outLink(LINKS.fire, '<span>BUILD YOUR OWN FIRE</span>'));

  // controls overlay
  const ctlEl = h('div', 'ew-modal ew-controls', ui);
  h('div', 'ew-dim', ctlEl);
  const ctlPanel = h('div', 'ew-panel', ctlEl);
  h('div', 'ew-pkick', ctlPanel, 'THE LAMPLIGHTER');
  h('div', 'ew-ptitle ew-ts', ctlPanel, 'CONTROLS');
  const grid = h('div', 'ew-ctl', ctlPanel);
  for (const [action, keys, note] of CONTROLS) {
    h('div', 'k', grid, /** @type {string[]} */ (keys).map((k) => `<span class="ew-key">${k}</span>`).join(''));
    h('div', 'a', grid, `${action}${note ? `<i>${note}</i>` : ''}`);
  }
  const ctlHint = h('div', 'ew-hint', ctlPanel, 'H or Esc to close');

  // end cards (night / dawn / fallen)
  const endEl = h('div', 'ew-modal ew-end', ui);
  h('div', 'ew-dim', endEl);
  const endC = h('div', 'ew-endc', endEl);

  // Brother Cinder's panel and the pad panel (./panels.js); created after the helpers below exist (see `panels`)
  /** @type {ReturnType<typeof createPanels>} */ let panels;

  // ------------------------------------------------------------------------------------------------ state
  let clock = now(), lastNow = clock;
  let hudOn = false, letterbox = false, lastMode = '', lastState = /** @type {any} */ (null);
  let lastLv = -1, lastHp = -1, lastWeapon = '', lastRounds = -1, lastMag = -1, lastBombs = -1, lastBombsMax = -1;
  let lastClockS = -1, lastNight = -1, lastGatePct = -1, lastBeaconTxt = '', lastPrompt = '', lowOn = false, gateLow = false;
  let sunReady = false, trollOn = false, trollGlow = false, lowFuel = false, lastRhint = '', lastSlots = '';
  let reloadDur = 1.2, kindledUntil = 0, blunderUnlocked = false;
  let hintsUntil = 0, lastWaveToast = -99, lastGlowToast = -99, gateWarned = 0;
  let fireStyle = opts.fireStyle === 'smooth' ? 'smooth' : 'hybrid';
  let fallenCause = 'gate', lastStats = /** @type {any} */ (null);
  /** @type {{ title: string, sub: string, cls: string, dur: number }[]} */ const bannerQ = [];
  let bannerUntil = 0, bannerOutAt = 0;
  /** Transient messages: ONE on screen at a time (a band above the HUD's bottom edge, never on the crosshair), a short
   *  queue behind it; a queued message shortens the one showing; repeats refresh instead of stacking. */
  /** @type {{ text: string, sub: string, cls: string, dur: number }[]} */ const toastQ = [];
  /** @type {null | { text: string, shownAt: number, until: number, out: boolean, goneAt: number }} */ let toastCur = null;
  let modalOn = false, xpTickAt = 0, lastXpV = -1, lastXpLv = -1, glanceOn = false;
  let subUntil = 0;
  let menuOpen = false, ctlOpen = false, menuSel = 0, hoverArmed = false, restartArmedUntil = 0;
  /** @type {((v: string) => void) | null} */ let menuResolve = null;
  /** @type {null | { ids: string[], els: HTMLElement[], sel: number, resolve: (id: string) => void, onPick?: (id: string, event: Event) => void, openedAt: number, done: boolean }} */
  let cardsState = null;
  /** @type {null | { kind: string, resolve: (v: any) => void, buttons: HTMLButtonElement[], sel: number, auto: number, done: boolean }} */
  let endState = null;
  /** @type {{ at: number, run: () => void }[]} */ const later = [];

  const setClass = (el, cls, on) => { if (el.classList.contains(cls) !== on) el.classList.toggle(cls, on); };
  const restart = (el, cls) => { el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); };
  const emit = (a, d) => { try { opts.onAction?.(a, d); } catch (err) { console.error('[ew-ui] onAction', err); } };
  /** UI sounds for the audio code: window event 'ew:ui', detail.sound 'hover'|'click'|'open'|'close'. The card
   *  pick and level-up sounds come from EV.CARD_PICK / EV.LEVEL_UP, so 'pick' is not sent. */
  const SOUND = { move: 'hover', select: 'click', back: 'click', open: 'open', close: 'close', card: 'open', pick: '' };
  const sound = (s) => { const n = SOUND[s] ?? s; if (!n) return; try { window.dispatchEvent(new CustomEvent('ew:ui', { detail: { sound: n } })); } catch { /* ignore */ } };
  const freePointer = () => { try { if (document.pointerLockElement) document.exitPointerLock(); } catch { /* ignore */ } };
  const schedule = (delay, run) => later.push({ at: now() + delay, run });
  panels = createPanels({ root: ui, uiBase: base + 'ui/', h, esc, fitText, emit, sound, freePointer, now });

  // DESIGN §9 state: the camera for the name plates (opts.camera or setCamera, the cinema passes it), the gold counter,
  // the camp, the run's end, Brother Cinder's lines
  /** @type {any} */ let cam = opts.camera || null;
  let lastGold = -1, lastRunGold = -1, campOn = false, lastCampNext = -1, lastTrollKey = '';
  let campLeftAt = -99, panelGoneT = 0, hearthOn = false;   // the camp HUD and its prompts stand down for the camp-leave cinema even if the mode lags
  let goldBanked = null, runEndReason = '', lastNightCard = { n: 0, at: -99 }, campReason = '', campLineAt = -99, lastNpcLineAt = -99;
  const projV = { x: 0, y: 0, z: 0 };

  // ------------------------------------------------------------------------------------------------ scale (resize only)
  function resize() {
    const w = root.clientWidth || window.innerWidth, hh = root.clientHeight || window.innerHeight;
    const s = Math.min(w / 1920, hh / 1080);
    const k = Math.max(2, Math.round(s * 3.5 * 2) / 2);
    ui.style.setProperty('--k', String(k));
  }
  resize();
  window.addEventListener('resize', resize);

  // ------------------------------------------------------------------------------------------------ small surfaces
  /** @param {string} text @param {number} [seconds] @param {string} [cls] 'cool' | 'warn' | '' @param {string} [sub] a second, smaller line */
  function toast(text, seconds = 2.4, cls = '', sub = '') {
    if (!text) return;
    text = String(text); sub = String(sub || '');
    const t = now();
    if (toastCur && !toastCur.out && toastCur.text === text) { toastCur.until = Math.max(toastCur.until, t + Math.min(seconds, 1.6)); return; }
    if (toastQ.some((q) => q.text === text)) return;
    if (toastQ.length >= 3) toastQ.shift();
    toastQ.push({ text, sub, cls, dur: Math.max(0.8, seconds) });
    // a waiting message cuts the current one short (it keeps at least 1.1 s on screen)
    if (toastCur && !toastCur.out) toastCur.until = Math.min(toastCur.until, Math.max(t + 0.35, toastCur.shownAt + 1.1));
  }
  function showToast(q) {
    toastT.textContent = q.text; toastS.textContent = q.sub;
    toastEl.className = `ew-toast ${q.cls}${q.sub ? ' two' : ''}`;
    void toastEl.offsetWidth;
    toastEl.classList.add('on');
    const t = now();
    toastCur = { text: q.text, shownAt: t, until: t + q.dur, out: false, goneAt: 0 };
  }
  function clearToasts() { toastQ.length = 0; toastCur = null; toastEl.className = 'ew-toast'; }
  function subtitle(text, seconds) {
    if (!text) { subUntil = 0; setClass(subEl, 'on', false); return; }
    subEl.textContent = String(text);
    setClass(subEl, 'on', true);
    subUntil = now() + (seconds > 0 ? seconds : Math.max(2, 0.8 + String(text).length * 0.06));
  }
  /** A centre banner (queued: one at a time). cls: 'kindle' | 'troll' | 'lvl' | 'unlock' | '' */
  function banner(title, sub = '', cls = '', dur = 2.4) {
    if (bannerQ.length >= 3) bannerQ.shift();
    bannerQ.push({ title: String(title), sub: String(sub || ''), cls, dur });
    if (!bannerUntil) nextBanner();
  }
  function nextBanner() {
    const b = bannerQ.shift();
    if (!b) { bannerUntil = 0; bannerOutAt = 0; bannerEl.className = 'ew-banner ew-ts'; return; }
    bTitle.textContent = b.title; bSub.textContent = b.sub;
    bannerEl.className = `ew-banner ew-ts ${b.cls}`;
    void bannerEl.offsetWidth;
    bannerEl.classList.add('on');
    const t = now();
    bannerOutAt = t + b.dur; bannerUntil = t + b.dur + 0.45;
  }
  function setLetterbox(on) { letterbox = !!on; setClass(ui, 'ew-lbon', letterbox); }
  /** Fade to black: alpha 0..1 over seconds. */
  function fade(alpha, seconds = 0.6) {
    fadeEl.style.transitionDuration = `${Math.max(0, seconds)}s`;
    if (!(seconds > 0)) void fadeEl.offsetWidth;
    fadeEl.style.opacity = String(clamp01(alpha));
  }
  function setFireStyle(style) {
    fireStyle = style === 'smooth' ? 'smooth' : 'hybrid';
    for (const s of styleTog.children) setClass(/** @type {HTMLElement} */ (s), 'on', /** @type {HTMLElement} */ (s).dataset.s === fireStyle);
  }
  setFireStyle(fireStyle);
  function chooseStyle(style) {
    if (style === fireStyle) return;
    setFireStyle(style);
    sound('move');
    try { opts.onFireStyle?.(/** @type {any} */ (fireStyle)); } catch (err) { console.error('[ew-ui] onFireStyle', err); }
    emit('fire-style', fireStyle);
  }

  // ------------------------------------------------------------------------------------------------ menu + controls
  function paintMenu() { menuRows.forEach((b, i) => setClass(b, 'sel', i === menuSel)); }
  function armRestart(on) {
    restartArmedUntil = on ? now() + 3 : 0;
    restartBtn.textContent = on ? 'RESTART? PRESS AGAIN' : /** @type {string} */ (restartBtn.dataset.label);
    setClass(restartBtn, 'confirm', on);
  }
  function menuAct(act) {
    const setting = menuSelects.get(act);
    if (setting) {
      setting.select.focus();
      try { setting.select.showPicker?.(); } catch { /* keyboard can operate the focused select */ }
      return;
    }
    if (act === 'restart' && !(restartArmedUntil > now())) { armRestart(true); sound('move'); return; }
    if (act === 'style') { chooseStyle(fireStyle === 'smooth' ? 'hybrid' : 'smooth'); return; }
    if (act === 'renderer') {
      confirmRenderer(rendererSetting?.choices.find(({ id }) => id !== rendererSetting.selected()));
      return;
    }
    sound(act === 'resume' ? 'back' : 'select');
    if (act === 'controls') { controls.open(); return; }
    menu.close(act);
  }
  menuEl.addEventListener('mousemove', (e) => { if (Math.abs(e.movementX) + Math.abs(e.movementY) > 0) hoverArmed = true; });
  menuRows.forEach((b, i) => {
    b.addEventListener('mousemove', () => { if (!hoverArmed || menuSel === i) return; menuSel = i; paintMenu(); sound('move'); });
    if (b.dataset.act === 'renderer' || menuSelects.has(b.dataset.act ?? '')) {
      b.addEventListener('focusin', () => { menuSel = i; paintMenu(); });
      return;
    }
    b.addEventListener('click', (e) => {
      e.stopPropagation(); menuSel = i; paintMenu();
      const t = /** @type {HTMLElement} */ (e.target);
      if (b.dataset.act === 'style' && t?.dataset?.s) { chooseStyle(t.dataset.s); return; }
      menuAct(/** @type {string} */ (b.dataset.act));
    });
  });
  menuEl.addEventListener('pointerdown', (e) => { if (/** @type {HTMLElement} */ (e.target).classList.contains('ew-dim')) menu.close('resume'); });
  const menu = {
    /** @returns {Promise<string>} 'resume' | 'restart' */
    open() {
      if (menuOpen) return new Promise((r) => { const prev = menuResolve; menuResolve = (v) => { prev?.(v); r(v); }; });
      if (cardsState || endState) return Promise.resolve('resume');
      for (const setting of menuSelects.values()) setting.refresh();
      menuOpen = true; menuSel = 0; hoverArmed = false; armRestart(false); paintMenu(); freePointer();
      setClass(menuEl, 'on', true);
      emit('menu-open'); sound('open');
      return new Promise((r) => { menuResolve = r; });
    },
    close(result = 'resume') {
      if (!menuOpen) return;
      if (rendererDialog?.open) rendererDialog.close();
      if (ctlOpen) controls.close();
      menuOpen = false; armRestart(false);
      setClass(menuEl, 'on', false);
      if (result === 'resume') sound('close');
      const r = menuResolve; menuResolve = null;
      emit(result === 'resume' ? 'resume' : result);
      emit('menu-close', result);
      r?.(result);
    },
    toggle() { if (menuOpen) menu.close('resume'); else menu.open(); },
    get isOpen() { return menuOpen; },
  };
  const controls = {
    open() { if (ctlOpen) return; ctlOpen = true; freePointer(); setClass(ctlEl, 'on', true); emit('controls-open'); sound('open'); },
    close() {
      if (!ctlOpen) return; ctlOpen = false; setClass(ctlEl, 'on', false); emit('controls-close'); sound('close');
      if (ctlFirst) { ctlFirst = false; ctlHint.textContent = 'H or Esc to close'; }
      if (nightCardHeld) { const a = nightCardHeld; nightCardHeld = null; card('night', a[0], a[1]); }   // the night's title, held behind the panel
      if (!helpSeen) { helpSeen = true; try { localStorage.setItem(HELP_KEY, '1'); } catch { /* a blocked store: this session only */ } }
    },
    toggle() { if (ctlOpen) controls.close(); else controls.open(); },
    get isOpen() { return ctlOpen; },
  };
  ctlEl.addEventListener('pointerdown', (e) => { e.stopPropagation(); controls.close(); });
  // A first launch opens the controls once, when the player first has control after Night I's intro. Only a natural
  // start counts (the title's click, then the intro: no save yet); URL shortcuts and the camp never open it. H / Esc / a click close it, and so does any game key,
  // which then goes on to the game, so the first step is not lost. Once closed it never opens again (a localStorage flag,
  // try/catch: a blocked store shows it once a session).
  const HELP_KEY = 'valleyward.controlsSeen.v1';
  let helpSeen = false; try { helpSeen = localStorage.getItem(HELP_KEY) === '1'; } catch { helpSeen = false; }
  let helpStage = 0, ctlFirst = false;   // 0 nothing yet · 1 the title seen · 2 its intro seen · 3 done
  /** @type {null | [any, any]} */ let nightCardHeld = null;   // a night title card that came while the first-launch panel was up
  const helpUrlSkip = (() => { try { return /[?&](night|camp|ending|skipintro|autoplay|clock)=/.test(location.search); } catch { return true; } })();
  const PASS_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'ShiftLeft', 'ShiftRight',
    'KeyE', 'KeyQ', 'KeyR', 'KeyG', 'Digit1', 'Digit2', 'Digit3', 'Numpad1', 'Numpad2', 'Numpad3']);
  function stepFirstHelp(mode, state) {
    if (helpStage >= 3) return;
    if (opts.noui || helpSeen || helpUrlSkip) { helpStage = 3; return; }
    if (mode === 'title') { helpStage = 1; return; }
    if (mode === 'camp') { helpStage = 3; return; }   // a save: the game starts at the camp
    if (mode === 'intro') { if (helpStage === 1 && !state?.night?.fromCamp) helpStage = 2; return; }
    if (mode !== 'play') return;
    if (helpStage !== 2) { helpStage = 3; return; }
    if (menuOpen || ctlOpen || panels.isOpen || (cardsState && !cardsState.done) || (endState && !endState.done && endState.kind !== 'night') || letterbox) return;
    // at the first moment of control a night title card still up gives way to the panel: the intro's (seen for a second)
    // just closes; one that only just opened (a skipped intro's) comes back when the panel closes
    if (endState && !endState.done && endState.kind === 'night') {
      if (now() - lastNightCard.at < 0.6) { nightCardHeld = [state, { night: state?.night?.n || lastNightCard.n || 1 }]; lastNightCard = { n: -1, at: -99 }; }
      closeEnd(null);
    }
    helpStage = 3; ctlFirst = true; ctlHint.textContent = 'WASD to start · H, Esc or a click to close';
    controls.open();
  }

  // ------------------------------------------------------------------------------------------------ level-up cards
  function paintCards() { if (cardsState) cardsState.els.forEach((el, i) => setClass(el, 'sel', i === cardsState?.sel)); }
  /** @param {number} i @param {Event} [event] */
  function pickCard(i, event = undefined) {
    const c = cardsState;
    if (!c || c.done || i < 0 || i >= c.ids.length) return;
    if (now() - c.openedAt < 0.3) return; // a held key or click from play must not pick
    c.done = true;
    cardsEl.inert = true;
    c.els.forEach((el, j) => el.classList.add(j === i ? 'picked' : 'gone'));
    sound('pick');
    const id = c.ids[i];
    emit('card-picked', id);
    schedule(0.3, () => { if (cardsState === c) setClass(cardsEl, 'on', false); });
    schedule(0.65, () => { if (cardsState === c) { cardsState = null; crow.innerHTML = ''; } });
    c.resolve(id);
    if (event) c.onPick?.(id, event);
  }
  /** DESIGN §10.2: { lv, max } for a skill card (null for a stat card). The level the player has now: state.player.skills,
   *  .cardLevels, or the count of picks in state.stats.cards; the class and max: the sim's cardDefs, else SKILL_CARDS. */
  function skillOf(id) {
    const def = opts.cardDefs?.[id] || opts.cardDefs?.[skillBase(id)];
    const b = typeof def?.skill === 'string' ? def.skill : skillBase(id);   // the sim: unlock id = the skill, upgrade id = '<skill>-up'
    const isSkill = def ? def.cls === 'skill' || def.skill === true : b in SKILL_CARDS;
    if (!isSkill) return null;
    const tk = lastState?.taken, p = lastState?.player, picks = lastState?.stats?.cards;
    let lv = tk ? (Number(tk[b]) || 0) + (Number(tk[`${b}-up`]) || 0) : Number(p?.skills?.[b] ?? p?.cardLevels?.[b]);   // the sim's skillLevel(taken, skill)
    if (!Number.isFinite(lv)) lv = Array.isArray(picks) ? picks.filter((c) => skillBase(c?.id ?? c) === b).length : 0;
    const max = Math.max(1, Number(def?.levels) || SKILL_CARDS[b] || 3);
    if (def?.kind === 'unlock') lv = 0; else if (def?.kind === 'upgrade') lv = Math.max(1, lv);
    return { lv: Math.max(0, lv | 0), max };
  }
  /** @param {string[]} ids @param {(id: string, event: Event) => void} [onPick] @returns {Promise<string>} */
  function cards(ids, onPick) {
    ids = (Array.isArray(ids) ? ids : []).slice(0, 3).map(String);
    if (!ids.length) return Promise.resolve('');
    if (cardsState && !cardsState.done) { const prev = cardsState; prev.done = true; prev.resolve(prev.ids[0]); }
    if (menuOpen) menu.close('resume');
    crow.innerHTML = '';
    const lv = lastState?.player?.level;
    csub.textContent = lv ? `LV ${lv} · choose one (1 2 3 or click)` : 'Choose one (1 2 3 or click)';
    return new Promise((resolve) => {
      const els = ids.map((id, i) => {
        const d = cardDef(id, opts.cardDefs);
        const el = /** @type {HTMLButtonElement} */ (h('button', `ew-card ${d.kind === 'unlock' ? 'unlock' : ''}`, crow));
        el.type = 'button';
        // DESIGN §10.2: a skill card is NEW SKILL (gold tag) until owned, then UPGRADE · LV n → n+1 with level pips
        const sk = skillOf(id);
        const tag = sk ? (sk.lv <= 0 ? '<div class="ew-ctag new ew-ts">NEW SKILL</div>'
          : `<div class="ew-ctag up ew-ts">UPGRADE · LV ${sk.lv} → ${Math.min(sk.max, sk.lv + 1)}</div><div class="ew-cpips">${Array.from({ length: sk.max }, (_, k) => `<i class="${k < sk.lv ? 'on' : k === sk.lv ? 'next' : ''}"></i>`).join('')}</div>`) : '';
        if (sk) el.classList.add(sk.lv <= 0 ? 'skill-new' : 'skill-up');
        el.innerHTML = `<div class="ew-cicon" style="${iconCss(d.icon, base + 'ui/')}"></div>`
          + (tag || `<div class="ew-ckind">${d.kind === 'unlock' ? 'NEW WEAPON' : d.kind === 'fire' ? 'FIRE' : d.kind === 'weapon' ? 'GUNS' : d.kind === 'keep' ? 'THE KEEP' : 'BODY'}</div>`)
          + `<div class="ew-cname ew-ts">${esc(fitText(d.name.toUpperCase()))}</div><div class="ew-ctext">${esc(fitText(d.text))}</div>`
          + `<div class="ew-ckey"><span class="ew-key">${i + 1}</span></div>`;
        el.addEventListener('mousemove', (e) => { if (!cardsState || cardsState.sel === i || Math.abs(e.movementX) + Math.abs(e.movementY) === 0) return; cardsState.sel = i; paintCards(); sound('move'); });
        el.addEventListener('click', (e) => { e.stopPropagation(); if (cardsState) { cardsState.sel = i; pickCard(i, e); } });
        return el;
      });
      cardsState = { ids, els, sel: 0, resolve, onPick, openedAt: now(), done: false };
      paintCards();
      cardsEl.inert = false;
      setClass(cardsEl, 'on', false); void cardsEl.offsetWidth; setClass(cardsEl, 'on', true);
      sound('card');
    });
  }

  // ------------------------------------------------------------------------------------------------ end cards
  function statsHtml(stats, state) {
    const s = stats || state?.stats || {};
    const g = state?.gate;
    const gatePctV = g && g.hpMax ? Math.round((g.hp / g.hpMax) * 100) : (Number.isFinite(s.gatePct) ? Math.round(s.gatePct) : null);
    const t = Number.isFinite(s.timeAlive) ? s.timeAlive : state?.night?.clock;
    const items = [
      ['TIME', fmtTime(t || 0)], ['KILLS', String(s.kills ?? 0)], ['BURNED', String(s.burned ?? 0)],
      ['GATE', gatePctV == null ? '—' : `${Math.max(0, gatePctV)}%`], ['LEVEL', String(s.level ?? state?.player?.level ?? 1)],
    ];
    return `<div class="ew-estats ew-ts">${items.map(([k, v]) => `<div><b>${esc(v)}</b><span>${k}</span></div>`).join('')}</div>`;
  }
  function paintEnd() { if (endState) endState.buttons.forEach((b, i) => setClass(b, 'sel', i === endState?.sel)); }
  function closeEnd(result) {
    const e = endState;
    if (!e || e.done) return;
    e.done = true;
    if (result) emit(`card-${result}`, e.kind); // 'card-retry', inside the gesture (pointer lock)
    if (e.kind === 'ending' && result === 'retry') emit('continue', { act: 'continue' });   // DESIGN §12.8
    setClass(endEl, 'on', false);
    schedule(0.35, () => { if (endState === e) { endState = null; endC.innerHTML = ''; } });
    e.resolve(result);
  }
  /** DESIGN §8.1: the night's title (meta.js NIGHTS[n].title when the sim has it) */
  const NIGHT_TITLES = ['', '', 'BLOOD MOON', 'THE RAM', 'WET WIND', 'THE SHIELD WALL', 'THE SWARM', 'THE COVEN', 'RAM AND ROAR', 'THE LAST WATCH', 'THE RAINMOTHER'];
  function nightTitle(n) {
    const nd = NIGHTS[n - 1];
    const t = nd?.title ?? (nd?.name && !/^NIGHT\s/i.test(nd.name) ? nd.name : null) ?? NIGHT_TITLES[n] ?? '';
    return String(t || '').toUpperCase();
  }
  /** the night a card is about: an explicit number, the camp's next night, or the night being played */
  function nightOf(st, extra) {
    const x = Number(extra?.night ?? extra?.n);
    if (x > 0) return x;
    if (st?.mode === 'camp') return Number(st?.camp?.nextNight) || ((st?.night?.n || 0) + 1) || 1;
    return st?.night?.n || st?.night?.index || 1;
  }
  const goldLine = (st) => {
    const sv = saveOf(st), gb = Number.isFinite(goldBanked) ? goldBanked : runGold(st);
    return `<div class="ew-egold ew-ts"><i class="ew-coin"></i>GOLD BANKED <b>+${Math.max(0, gb | 0)}</b>${sv.raw ? ` · <b>${sv.gold + (Number.isFinite(goldBanked) ? 0 : gb | 0)}</b> IN ALL` : ''}</div>`;
  };
  const roman = (n) => ROMAN[n] || String(n);
  /**
   * @param {'night'|'dawn'|'coming'|'fallen'|'ending'} kind @param {any} [stIn] @param {{ night?: number }} [extra]
   * @returns {Promise<'retry'|null>} the primary button ('TO THE CAMP' / 'RETURN TO THE CAMP') resolves 'retry'
   */
  function card(kind, stIn, extra) {
    const st = stIn && typeof stIn === 'object' && stIn.mode ? stIn : lastState;
    if (stIn && !(stIn && stIn.mode) && typeof stIn === 'object') extra = /** @type {any} */ (stIn);
    if (kind === 'night' && ctlFirst && ctlOpen) { nightCardHeld = [stIn, extra]; return Promise.resolve(null); }   // shown when the panel closes
    const nightN = nightOf(st, extra);
    if (kind === 'night') { // the same title twice within 4 s (the cinema's beat and EV.NIGHT_TITLE) shows once
      if (lastNightCard.n === nightN && now() - lastNightCard.at < 4) return Promise.resolve(null);
      lastNightCard = { n: nightN, at: now() };
    }
    if (kind === 'coming') kind = 'dawn';   // DESIGN §8.1: the coming-soon card is gone (ten nights are built)
    if (endState && !endState.done) closeEnd(endState.kind === 'night' ? null : 'retry');
    if (menuOpen) menu.close('resume');
    if (ctlOpen) controls.close();
    if (panels.isOpen) panels.close('card', true);
    endEl.className = `ew-modal ew-end ${kind}`;
    let html = '';
    if (kind === 'night') {
      // the title card: the VALLEYWARD pixel wordmark, NIGHT n between two pixel rules with a flame, the night's title
      // (DESIGN §8.1: "NIGHT III · THE RAM"), then the order
      const title = nightTitle(nightN);
      html = `${LOGO_HTML}<div class="ew-nightrow ew-ts${nightN >= 2 ? ' ew-moonred' : ''}"><i class="ew-prule"></i><i class="ew-flame"></i><span>NIGHT <b>${roman(nightN)}</b></span><i class="ew-flame"></i><i class="ew-prule r"></i></div>`
        + (title ? `<div class="ew-ntitle ew-ts${nightN >= 10 ? ' last' : ''}">${esc(title)}</div>` : '')
        + `<div class="ew-ekick ew-ts ew-order">${nightN >= 10 ? 'HOLD THE LAMP UNTIL THE WATER FALLS' : 'HOLD THE GATE UNTIL DAWN'}</div>`;
    } else if (kind === 'dawn') {
      // STORY.md hint 6: Night I "DAWN · THE WATCH HOLDS / The valley is quieter tonight."; Nights II–IX "THE LAMP DRINKS
      // THE NIGHT / <n> more nights, and it will be bright enough." (DESIGN §8.1)
      const left = Math.max(1, 10 - nightN), words = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'];
      const t1 = nightN <= 1 ? 'THE WATCH HOLDS' : 'THE LAMP DRINKS THE NIGHT';
      const l1 = nightN <= 1 ? 'The valley is quieter tonight.' : `${words[left] || left} more night${left > 1 ? 's' : ''}, and it will be bright enough.`;
      html = `<div class="ew-ekick ew-ts">DAWN · NIGHT ${roman(nightN)}</div><div class="ew-etitle ew-ts">${t1}</div><div class="ew-eline">${l1}</div><div class="ew-erule"></div>${statsHtml(lastStats, st)}${goldLine(st)}`
        + `<div class="ew-ebtns"><button class="ew-btn ew-ts" type="button" data-act="retry">TO THE CAMP</button></div>`;
    } else if (kind === 'ending') {
      // DESIGN §12.8: the end card (from here on the story may say "demon"; this card does not need to)
      html = `<div class="ew-ekick ew-ts">NIGHT X</div><div class="ew-etitle ew-ts">THE WAY IS OPEN</div><div class="ew-eline">Ten nights. The lamp will never go out.</div><div class="ew-erule"></div>${statsHtml(lastStats, st)}`
        + `<div class="ew-ebtns"><button class="ew-btn ew-ts" type="button" data-act="retry">PLAY AGAIN</button></div>`;
    } else {
      const cause = st?.player && st.player.hp <= 0 ? 'player' : fallenCause;
      const title = cause === 'player' ? 'THE LAMPLIGHTER FALLS' : 'THE GATE IS BREACHED';
      html = `<div class="ew-ekick ew-ts">NIGHT ${roman(nightN)} · ${fmtTime(st?.night?.clock || 0)}</div><div class="ew-etitle ew-ts">${title}</div><div class="ew-erule"></div>${statsHtml(lastStats, st)}${goldLine(st)}`
        + `<div class="ew-ebtns"><button class="ew-btn ew-ts" type="button" data-act="retry">RETURN TO THE CAMP</button></div>`;
    }
    endC.innerHTML = html;
    return new Promise((resolve) => {
      const buttons = /** @type {HTMLButtonElement[]} */ ([...endC.querySelectorAll('button')]);
      const e = { kind, resolve, buttons, sel: 0, auto: kind === 'night' ? now() + 2.8 : 0, done: false };
      buttons.forEach((b, i) => {
        b.addEventListener('mousemove', (ev) => { if (Math.abs(ev.movementX) + Math.abs(ev.movementY) === 0 || e.sel === i) return; e.sel = i; paintEnd(); sound('move'); });
        b.addEventListener('click', (ev) => { ev.stopPropagation(); if (now() - openedAt < 0.9) return; sound('select'); closeEnd(b.dataset.act); });
      });
      const openedAt = now();
      endState = e;
      if (buttons.length) freePointer();
      setClass(endEl, 'interactive', buttons.length > 0);
      endEl.style.pointerEvents = buttons.length ? '' : 'none';
      paintEnd();
      void endEl.offsetWidth;
      setClass(endEl, 'on', true);
      sound(kind === 'night' ? 'open' : 'card');
    });
  }

  /** the caption of the camp cinemas ("THE DAY PASSES"); '' hides it */
  function caption(text, sub = '') {
    if (!text) { setClass(captionEl, 'on', false); return; }
    captionEl.innerHTML = `${esc(text)}${sub ? `<i>${esc(sub)}</i>` : ''}`;
    setClass(captionEl, 'on', true);
  }
  /** Brother Cinder's line as a subtitle (when his panel is not up) or in his panel */
  function npcLine(line) {
    const txt = CINDER_LINES[line] || (typeof line === 'string' && line.length > 8 ? line : '');
    if (!txt) return;
    lastNpcLineAt = now();
    panels.say(line);
    if (!panels.isOpen) subtitle(`BROTHER CINDER: \u201c${txt}\u201d`, Math.max(3.2, 1 + txt.length * 0.055));
  }

  // ------------------------------------------------------------------------------------------------ keys
  function onKey(e) {
    const k = e.code || e.key;
    if (rendererDialog?.open) { e.stopPropagation(); return; }
    if (panels.isOpen && !(endState && !endState.done) && !(cardsState && !cardsState.done) && panels.onKey(e)) return;
    if (cardsState && !cardsState.done) {
      const n = k === 'Digit1' || k === 'Numpad1' ? 0 : k === 'Digit2' || k === 'Numpad2' ? 1 : k === 'Digit3' || k === 'Numpad3' ? 2 : -1;
      if (n >= 0) { e.preventDefault(); e.stopPropagation(); if (!e.repeat) { cardsState.sel = n; paintCards(); pickCard(n, e); } return; }
      if (k === 'ArrowLeft' || k === 'KeyA' || k === 'ArrowRight' || k === 'KeyD') {
        e.preventDefault(); e.stopPropagation();
        const d = k === 'ArrowLeft' || k === 'KeyA' ? -1 : 1;
        cardsState.sel = (cardsState.sel + d + cardsState.ids.length) % cardsState.ids.length; paintCards(); sound('move'); return;
      }
      if (k === 'Enter' || k === 'NumpadEnter') { e.preventDefault(); e.stopPropagation(); if (!e.repeat) pickCard(cardsState.sel, e); return; }
      if (k === 'KeyP' || k === 'KeyH' || k === 'Space' || k === 'KeyE' || k === 'KeyQ' || k === 'KeyR' || k === 'KeyG') { e.preventDefault(); e.stopPropagation(); return; }
      return;
    }
    if (endState && !endState.done && endState.buttons.length) {
      if (k === 'ArrowLeft' || k === 'KeyA' || k === 'ArrowRight' || k === 'KeyD' || k === 'Tab') {
        e.preventDefault(); e.stopPropagation();
        endState.sel = (endState.sel + 1) % endState.buttons.length; paintEnd(); sound('move'); return;
      }
      if (k === 'Enter' || k === 'NumpadEnter') { e.preventDefault(); e.stopPropagation(); if (!e.repeat) endState.buttons[endState.sel]?.click(); return; }
      if (k !== 'Escape') { e.stopPropagation(); }
      return;
    }
    if (ctlOpen) {
      if (ctlFirst && PASS_KEYS.has(k)) { controls.close(); return; }   // the first-launch panel: a game key closes it and goes on to the game
      if (k === 'KeyH' && listenKeys) { e.preventDefault(); e.stopPropagation(); controls.close(); return; }
      if (k === 'Escape' || k === 'Enter' || k === 'Backspace') { e.preventDefault(); e.stopPropagation(); controls.close(); return; }
      if (k === 'KeyP' && listenKeys && menuOpen) { e.preventDefault(); e.stopPropagation(); controls.close(); menu.close('resume'); return; }
      e.stopPropagation();
      return;
    }
    if (menuOpen) {
      const nativeSelect = e.target instanceof HTMLSelectElement ? e.target : null;
      if (nativeSelect && /^(Arrow|Home$|End$|Page|Enter$|Space$|NumpadEnter$)/.test(k)) return;
      const rendererButton = e.target instanceof HTMLButtonElement && e.target.closest('.ew-renderer-options') ? e.target : null;
      const up = k === 'ArrowUp' || k === 'KeyW', down = k === 'ArrowDown' || k === 'KeyS' || k === 'Tab';
      if (up || down) {
        e.preventDefault(); e.stopPropagation(); (nativeSelect ?? rendererButton)?.blur();
        const move = up || (k === 'Tab' && e.shiftKey) ? -1 : 1;
        menuSel = (menuSel + move + menuRows.length) % menuRows.length; paintMenu(); sound('move'); return;
      }
      const action = menuRows[menuSel].dataset.act ?? '';
      if ((k === 'ArrowLeft' || k === 'ArrowRight' || k === 'KeyA' || k === 'KeyD') && (action === 'style' || action === 'renderer')) {
        e.preventDefault(); e.stopPropagation();
        const left = k === 'ArrowLeft' || k === 'KeyA';
        if (action === 'style') chooseStyle(left ? 'smooth' : 'hybrid');
        else confirmRenderer(rendererSetting?.choices[left ? 0 : 1]);
        return;
      }
      if (k === 'Enter' || k === 'NumpadEnter' || k === 'Space') {
        e.preventDefault(); e.stopPropagation();
        if (!e.repeat) { if (rendererButton) rendererButton.click(); else menuAct(action); }
        return;
      }
      if ((k === 'KeyP' && listenKeys) || k === 'Escape') { e.preventDefault(); e.stopPropagation(); menu.close('resume'); return; }
      if (k === 'KeyH' && listenKeys) { e.preventDefault(); e.stopPropagation(); controls.open(); return; }
      if (k !== 'Escape') e.stopPropagation();
      return;
    }
    if (lastState?.mode === 'ending' && !(endState && !endState.done)) {   // DESIGN §12: no menu in the ending; skip when allowed
      if (k === 'Space' || k === 'Enter' || k === 'NumpadEnter' || k === 'Escape') { e.preventDefault(); e.stopPropagation(); if (endingSkippable(lastState)) skipEnding(); }
      else if (k === 'KeyP' || k === 'KeyH') { e.preventDefault(); e.stopPropagation(); }
      return;
    }
    if (!listenKeys || e.repeat) return;
    const mode = lastState?.mode;
    if ((k === 'KeyN' || k === 'Enter' || k === 'NumpadEnter') && campReady()) { e.preventDefault(); e.stopPropagation(); beginNight('key'); return; }
    if (k === 'KeyP' || k === 'Escape') {
      if (mode === 'title' || mode === 'intro') return; // the 6 s intro is skipped with Space / Enter / a click instead
      e.preventDefault(); e.stopPropagation(); menu.open(); return;
    }
    if (k === 'KeyH') { e.preventDefault(); controls.open(); return; }
    if ((k === 'Digit2' || k === 'Numpad2') && mode === 'play' && !blunderOk(lastState) && !slot2Organ(lastState)) { // say why nothing happens
      toast('BLUNDERBUSS · LOCKED', 2.2, 'cool', 'pick it from a level-up card');
    }
    if (k === 'KeyE') { // say why the beacon cannot be kindled (the sim does the kindling)
      const pr = promptInfo(lastState);
      if (pr && pr.locked) toast(pr.reason, 2.2, 'cool');
    }
  }
  window.addEventListener('keydown', onKey, true);

  /** the Blunderbuss is unlocked (the sim's flag when present, else what the cards said) */
  function blunderOk(state) {
    const p = state?.player;
    if (p?.unlocked && typeof p.unlocked.blunderbuss === 'boolean') return p.unlocked.blunderbuss;
    if (p && Array.isArray(p.weapons)) return p.weapons.includes('blunderbuss');
    return blunderUnlocked;
  }

  // ------------------------------------------------------------------------------------------------ the beacon prompt
  /** @returns {null | { text: string, sub: string, locked: boolean, reason: string }} */
  function promptInfo(state) {
    if (state?.mode === 'camp') return now() - campLeftAt > 4.5 ? campPrompt(state) : null;
    const p = state?.player, n = state?.night;
    if (!p || !n || (state.mode && state.mode !== 'play')) return null;
    const pan = ARENA.beacon.pan;
    const dx = p.x - pan.x, dz = p.z - pan.z;
    if (dx * dx + dz * dz > ARENA.beacon.useRadius * ARENA.beacon.useRadius || Math.abs((p.y ?? 0) - pan.y) > 1.8) return null;
    // Night VII's coven lock (state.night.kindleLockT, the sim refuses E while it runs) says so, with the seconds
    const lock = n.kindleLockT || 0;
    if (lock > 0.05) {
      const s = Math.ceil(lock);
      return { text: `THE LAMP IS DIMMED · ${s} s`, sub: 'The coven\u2019s chant has locked the kindle', locked: true, reason: `The lamp is dimmed: ${s} s until it can be kindled` };
    }
    const cd = n.kindleCd || 0;
    if (cd > 0.05) {
      return { text: `BEACON COOLING · ${fmtTime(cd)}`, sub: 'The embers must settle before the next kindle', locked: true, reason: `The beacon needs ${Math.ceil(cd)} s more to settle` };
    }
    const k = n.kindle || 0;
    const sub = !state.troll && k === 2 ? 'The third kindle wakes the Ash Troll' : 'A bigger wave · XP ×1.5 · the Lance refilled';
    return { text: 'KINDLE THE BEACON', sub, locked: false, reason: '' };
  }

  /** the camp's E prompts (DESIGN §9.2, §13): Brother Cinder, a build pad, the lamp's pan; the nearest wins */
  function campPrompt(state) {
    const p = state?.player; if (!p || !Number.isFinite(p.x)) return null;
    const C = ARENA.camp, d2 = (x, z) => (p.x - x) * (p.x - x) + (p.z - z) * (p.z - z);
    const near = state.camp && 'near' in state.camp ? state.camp.near : undefined;   // 'npc' | padId | 'lamp' | null
    if (near !== undefined) {
      if (!near) return null;
      const nx = nightOf(state);
      if (near === 'npc') return { text: 'TALK', sub: 'Brother Cinder · upgrades and charms', locked: false, reason: '', camp: true, d: 0 };
      if (near === 'lamp') return { text: `KINDLE THE LAMP TO BEGIN NIGHT ${ROMAN[nx] || nx}`, sub: nx === 1 ? 'a new run · your gold, upgrades and charms are kept' : '', locked: false, reason: '', camp: true, d: 0 };
      const tw = towersOf(state).find((t) => t.pad === near);
      if (tw) return { text: tw.level >= towerMax(tw.type) ? `${towerName(tw.type).toUpperCase()} · LV ${towerMax(tw.type)}` : `UPGRADE · ${towerName(tw.type).toUpperCase()}`, sub: tw.level >= towerMax(tw.type) ? 'fully upgraded' : `LV ${tw.level} \u2192 ${tw.level + 1}`, locked: false, reason: '', camp: true, d: 0 };
      return { text: 'BUILD', sub: 'a tower for this run', locked: false, reason: '', camp: true, d: 0 };
    }
    /** @type {null | { text: string, sub: string, locked: boolean, reason: string, camp: boolean, d: number }} */ let best = null;
    const offer = (d, text, sub) => { if (!best || d < best.d) best = { text, sub, locked: false, reason: '', camp: true, d }; };
    const npcD = d2(C.npc.x, C.npc.z);
    if (npcD < C.npc.useRadius * C.npc.useRadius) offer(npcD, 'TALK', 'Brother Cinder · upgrades and charms');
    const tws = towersOf(state);
    for (const pd of C.pads) {
      const d = d2(pd.x, pd.z);
      if (d > C.padUseRadius * C.padUseRadius) continue;
      const tw = tws.find((t) => t.pad === pd.id);
      if (tw) offer(d, tw.level >= towerMax(tw.type) ? `${towerName(tw.type).toUpperCase()} · LV ${towerMax(tw.type)}` : `UPGRADE · ${towerName(tw.type).toUpperCase()}`, tw.level >= towerMax(tw.type) ? 'fully upgraded' : `LV ${tw.level} \u2192 ${tw.level + 1}`);
      else offer(d, 'BUILD', 'a tower for this run');
    }
    const pan = ARENA.beacon.pan, pd2 = d2(pan.x, pan.z);
    if (pd2 < ARENA.beacon.useRadius * ARENA.beacon.useRadius && Math.abs((p.y ?? 0) - pan.y) < 1.8) {
      const nx = nightOf(state);
      offer(pd2 - 0.01, `KINDLE THE LAMP TO BEGIN NIGHT ${ROMAN[nx] || nx}`, nx === 1 ? 'a new run · your gold, upgrades and charms are kept' : '');
    }
    return best;
  }
  /** open a panel: 'npc' (Brother Cinder) or 'pad' ({ pad: id | index }); resolves when it closes */
  function panel(kind, st, detail) {
    if (cardsState && !cardsState.done) return Promise.resolve('busy');
    if (endState && !endState.done && endState.buttons.length) return Promise.resolve('busy');
    if (menuOpen) menu.close('resume');
    if (ctlOpen) controls.close();
    clearToasts(); subtitle('');   // a line that came just before the panel shows in the panel instead
    emit('panel-open', { panel: kind === 'pad' ? 'pad' : 'npc', pad: detail?.pad });
    return panels.open(kind === 'pad' ? 'pad' : 'npc', st || lastState, detail || {});
  }
  /** project a world point with the camera (no three.js import): { x, y } in px, d in metres; null behind the lens */
  function project(x, y, z) {
    const c = cam; if (!c || !c.matrixWorldInverse || !c.projectionMatrix) return null;
    const e = c.matrixWorldInverse.elements, P = c.projectionMatrix.elements;
    const vx = e[0] * x + e[4] * y + e[8] * z + e[12], vy = e[1] * x + e[5] * y + e[9] * z + e[13], vz = e[2] * x + e[6] * y + e[10] * z + e[14];
    if (vz > -0.6) return null;
    const cx = P[0] * vx + P[4] * vy + P[8] * vz + P[12], cy = P[1] * vx + P[5] * vy + P[9] * vz + P[13], cw = P[3] * vx + P[7] * vy + P[11] * vz + P[15];
    if (!(cw > 0)) return null;
    const W = ui.clientWidth || window.innerWidth, H = ui.clientHeight || window.innerHeight;
    projV.x = (cx / cw * 0.5 + 0.5) * W; projV.y = (0.5 - cy / cw * 0.5) * H; projV.z = -vz;
    return projV;
  }
  const ELITE_NAME = { chief: 'GOBLIN CHIEFTAIN', hexer: 'HEXER' }, ELITE_HP = { chief: 220, hexer: 140 }, ELITE_TOP = { chief: 2.7, hexer: 2.2 };
  /** the live elites: state.elites, or a scan of the horde for chiefs and hexers */
  function elitesOf(st) {
    if (Array.isArray(st?.elites)) return st.elites.filter((e) => e && Number.isFinite(e.x) && (e.hp ?? 1) > 0);
    const H = st?.horde; if (!H || !H.kind || !H.count) return [];
    const out = [];
    for (let i = 0; i < H.count && out.length < 4; i++) {
      const kd = H.kind[i]; if ((kd !== 4 && kd !== 5) || !(H.state ? H.state[i] : 1) || !(H.hp[i] > 0)) continue;
      const kind = kd === 4 ? 'chief' : 'hexer';
      out.push({ id: i, kind, x: H.x[i], y: H.y[i], z: H.z[i], hp: H.hp[i], hpMax: H.hpMax ? H.hpMax[i] : ELITE_HP[kind] });
    }
    return out;
  }
  function stepPlates(st, dt) {
    const list = cam && st && st.mode === 'play' && !letterbox && !modalOn ? elitesOf(st) : [];
    for (let i = 0; i < plates.length; i++) {
      const pl = plates[i], e = list[i];
      const q = e ? project(e.x, (e.y ?? 0) + (ELITE_TOP[e.kind] || 2.4), e.z) : null;
      const vis = !!(q && q.z < 70 && q.x > -40 && q.y > -20 && q.x < (ui.clientWidth || 1e4) + 40 && q.y < (ui.clientHeight || 1e4) + 20);
      if (vis !== pl.on) { pl.on = vis; setClass(pl.el, 'on', vis); }
      if (!vis || !e || !q) continue;
      if (pl.kind !== e.kind || pl.id !== e.id) {
        pl.kind = e.kind; pl.id = e.id; pl.name.textContent = String(e.name || ELITE_NAME[e.kind] || e.kind).toUpperCase();
        pl.el.className = `ew-plate ew-ts ${e.kind} on`; snapBar(pl.bar, (e.hp ?? 1) / (e.hpMax || ELITE_HP[e.kind] || 200));
      }
      stepBar(pl.bar, (e.hp ?? 1) / (e.hpMax || ELITE_HP[e.kind] || 200), dt, 0.4, 0.8);
      const sc = Math.max(0.6, Math.min(1.1, 16 / q.z));
      pl.el.style.transform = `translate(${(q.x).toFixed(1)}px,${(q.y).toFixed(1)}px) translate(-50%,-100%) scale(${sc.toFixed(3)})`;
    }
  }

  // --------------------------------------------------------------------------------------------------------- DESIGN §8
  /** the credits on black (DESIGN §12.8): the VALLEYWARD wordmark, then "Directed by AL" */
  function credits(on) {
    if (!on) { setClass(creditsEl, 'on', false); return; }
    creditsEl.innerHTML = `${LOGO_HTML}<div class="ew-credline ew-ts"><span>DIRECTED BY</span><b>AL</b></div>`;
    setClass(creditsEl, 'on', false); void creditsEl.offsetWidth; setClass(creditsEl, 'on', true);
  }
  /** the ending: skip (not the first time, after TIMELINE.ending.skippableAfter) goes to the sim */
  let endingFirst = true, endingSeen = false, lastSkipAt = -9;
  function endingSkippable(st) {
    if (st?.mode !== 'ending') return false;
    if (st.ending && typeof st.ending.skippable === 'boolean' ? !st.ending.skippable : endingFirst) return false;   // the sim: state.ending.skippable
    const T = /** @type {any} */ (TL).TIMELINE?.ending, at = Number(T?.skippableAfter) || 3;
    const card = (T?.beats || []).find((b) => b.id === 'card')?.at ?? 56, et = st.ending?.t ?? st.modeT ?? 0;
    return et >= at && et < card;
  }
  function skipEnding() { if (now() - lastSkipAt < 1) return; lastSkipAt = now(); sound('select'); emit('skipEnding', { act: 'skipEnding' }); }
  /** Night X: the Rainmother's bar (phase ticks, the crown's lanterns, cracked), the ram plate, the coven, the rain line */
  let lastBossKey = '', bossOn = false, ramWarned = new Set(), lastCovenK = -1, lastRainOn = null, lastPhase = 0, lastClimbWarn = 0;
  const PHASE_NAME = ['', 'TIDE', 'DOWNPOUR', 'THE CLIMB'];
  function stepNightX(st, dt) {
    const bo = st?.boss && (st.boss.kind === 'rainmother' || st.boss.name || st.boss.hpMax) && (st.boss.hp ?? 1) > 0 ? st.boss : null;
    const on = !!bo && st.mode === 'play';
    if (on !== bossOn) { bossOn = on; setClass(bossEl, 'on', on); if (on) snapBar(bossBar, bo.hp / (bo.hpMax || 12000)); }
    if (on && bo) {
      const f = bo.hp / (bo.hpMax || 12000);
      stepBar(bossBar, f, dt, 0.6, 0.5);
      const ph = Math.max(1, Math.min(3, bo.phase | 0 || (f > 0.66 ? 1 : f > 0.33 ? 2 : 3)));
      // the sim: lanterns = [{ alive, … }] (shot out one by one), shamans = how many still ride her
      const lanMax = Array.isArray(bo.lanterns) && bo.lanterns.length ? bo.lanterns.length : Number(bo.lanternsMax) || 6;
      const lan = Array.isArray(bo.lanterns) ? (bo.lanterns.length ? bo.lanterns.filter((l) => l && l.alive !== false).length : Math.max(0, lanMax - (bo.lanternsOut | 0))) : Math.max(0, Number(bo.lanterns) || 0);
      const key = `${ph}|${lan}|${lanMax}|${!!bo.cracked}`;
      if (key !== lastBossKey) {
        lastBossKey = key;
        bossPhase.textContent = `${PHASE_NAME[ph]}${bo.cracked ? ' · CRACKED · GUNS ×3' : ''}`;
        setClass(bossEl, 'cracked', !!bo.cracked); setClass(bossEl, 'p3', ph === 3);
        bossCrown.innerHTML = lanMax ? `<span>CROWN</span>${Array.from({ length: lanMax }, (_, i) => `<i class="${i < lan ? 'on' : ''}"></i>`).join('')}` : '';
      }
      if (ph !== lastPhase && lastPhase) { banner(ph === 2 ? 'THE DOWNPOUR' : ph === 3 ? 'SHE CLIMBS TO THE GATE' : 'THE TIDE', ph === 3 ? 'Burn her: fire cracks her stone (guns ×3)' : ph === 2 ? 'Whirlpools pull · shoot out her crown' : '', 'troll', 2.8); }
      lastPhase = ph;
      // the climb: how far she is from the gate (state.boss.gateDist, metres; or from her position)
      const gd = Number.isFinite(bo.gateDist) ? bo.gateDist : Number.isFinite(bo.x) ? Math.hypot(bo.x - ARENA.gate.target.x, bo.z - ARENA.gate.target.z) : NaN;
      const climbing = ph === 3 && Number.isFinite(gd);
      setClass(bossClimb, 'on', climbing);
      if (climbing) { const k = clamp01(1 - gd / 60); bossClimbFill.style.transform = `scaleX(${k.toFixed(3)})`; setClass(bossClimb, 'near', gd < 18);
        if (gd < 18 && now() - lastClimbWarn > 12) { lastClimbWarn = now(); toast('SHE IS AT THE GATE', 2.6, 'warn', 'burn her now'); } }
    } else lastPhase = 0;
    // the Siege Ram: a plate over each ram (HP + crew pips), "THE RAM IS AT THE GATE" once per ram
    const rams = Array.isArray(st?.rams) ? st.rams.filter((r) => r && Number.isFinite(r.x) && (r.hp ?? 1) > 0) : [];
    for (let i = 0; i < ramPlates.length; i++) {
      const pl = ramPlates[i], r = rams[i];
      const q = r && st.mode === 'play' && !letterbox && !modalOn ? project(r.x, (r.y ?? groundHeight(r.x, r.z)) + 3.2, r.z) : null;
      const vis = !!(q && q.z < 90);
      setClass(pl.el, 'on', vis);
      if (!vis || !r || !q) continue;
      stepBar(pl.bar, r.hp / (r.hpMax || 600), dt, 0.4, 0.8);
      const crew = Math.max(0, r.crew ?? 8), cm = Math.max(crew, r.crewMax ?? 8), ck = `${crew}/${cm}`;
      if (pl.ck !== ck) { pl.ck = ck; pl.crew.innerHTML = Array.from({ length: cm }, (_, k) => `<i class="${k < crew ? 'on' : ''}"></i>`).join(''); }
      const sc = Math.max(0.7, Math.min(1.1, 18 / q.z));
      pl.el.style.transform = `translate(${q.x.toFixed(1)}px,${q.y.toFixed(1)}px) translate(-50%,-100%) scale(${sc.toFixed(3)})`;
      const id = r.id ?? i;
      if ((r.atGate || r.mode === 'swing') && !ramWarned.has(id)) { ramWarned.add(id); banner('THE RAM IS AT THE GATE', 'Burn its crew · every carrier is its strength', 'troll', 2.8); }
    }
    // the coven's chant (Night VII): a warning bar while it lasts
    // the sim: state.coven = [{ state: 'walk' | 'chant' | 'done', chantT }] (a 20 s chant)
    const cg = Array.isArray(st?.coven) ? st.coven.find((g) => g && g.state === 'chant') : null;
    const ck2 = cg && st.mode === 'play' ? clamp01((Number(cg.chantT) || 0) / covenDur) : (covenUntil > now() ? clamp01(1 - (covenUntil - now()) / covenDur) : -1);
    if (ck2 !== lastCovenK) { lastCovenK = ck2; setClass(covenEl, 'on', ck2 > 0 && ck2 < 1); covenFill.style.transform = `scaleX(${Math.max(0, ck2).toFixed(3)})`; }
    // rain (Night IV squalls, Night X storm): a line under the beacon status
    const rain = Number(st?.weather?.rain) || 0, rOn = rain > 0.3 && st.mode === 'play';
    if (rOn !== lastRainOn) { lastRainOn = rOn; setClass(rainEl, 'on', rOn); }
    // the ending: first time or not, the skip hint
    if (st?.mode === 'ending' && !endingSeen) { endingSeen = true; endingFirst = !(st.meta?.ended ?? st.save?.ended); }
    if (st?.mode !== 'ending') endingSeen = false;
    setClass(skipEl, 'on', endingSkippable(st));
  }
  let covenUntil = 0, covenDur = 20;

  // -------------------------------------------------------------------------------------------------------- the camp
  /** the THUNDER ORGAN holds slot 2 (owned and chosen; or the player carries it) */
  function slot2Organ(st) {
    const p = st?.player;
    if (isOrgan(p?.weapon) || p?.unlocked?.organ) return true;
    return minigunOf(st).equipped;
  }
  /** the BEGIN NIGHT button / N / Enter may act: the camp, no panel, menu, card or cinema up */
  function campReady() {
    const st = lastState;
    return !!st && st.mode === 'camp' && now() - campLeftAt > 4.5 && !panels.isOpen && !menuOpen && !ctlOpen
      && !(cardsState && !cardsState.done) && !(endState && !endState.done) && !letterbox && !glanceOn;
  }
  let beginAt = -9;
  function beginNight(how) {
    if (!campReady() || now() - beginAt < 1.2) return;
    beginAt = now();
    sound('select');
    restart(beginBtn, 'press');
    emit('beginNight', { act: 'beginNight', how });   // the sim: the same campLeave flow as E at the pan
  }
  beginBtn.addEventListener('click', (e) => { e.stopPropagation(); beginNight('click'); });
  beginBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
  // walls that hide a marker: the keep's towers and walls as boxes (the player never stands inside the keep)
  const OCC = (() => {
    const k = ARENA.keep, out = [], wh = k.wallHeight + (k.parapetH || 1.1);
    for (const tw of k.towers || []) out.push([tw.x - tw.half, 0, tw.z - tw.half, tw.x + tw.half, tw.height + 1.5, tw.z + tw.half]);
    out.push([k.x0, 0, k.z1 - k.wallThick, k.x1, wh, k.z1], [k.x0, 0, k.z0, k.x1, wh, k.z0 + k.wallThick],
      [k.x0, 0, k.z0, k.x0 + k.wallThick, wh, k.z1], [k.x1 - k.wallThick, 0, k.z0, k.x1, wh, k.z1]);
    return out;
  })();
  const OCC_TOWERS = OCC.slice(0, (ARENA.keep.towers || []).length);
  /** true when the segment camera → (x, y, z) passes through a keep box (slab test); `towersOnly` for the pan's marker,
   *  which floats over the wall walk (the parapet below it must not hide it) */
  function occluded(x, y, z, towersOnly = false) {
    const c = cam; if (!c) return false;
    const e = c.matrixWorld?.elements; if (!e) return false;
    const ox = e[12], oy = e[13], oz = e[14], dx = x - ox, dy = y - oy, dz = z - oz;
    for (const b of towersOnly ? OCC_TOWERS : OCC) {
      let t0 = 0.02, t1 = 0.98, ok = true;
      for (let a = 0; a < 3 && ok; a++) {
        const o = a === 0 ? ox : a === 1 ? oy : oz, d = a === 0 ? dx : a === 1 ? dy : dz, lo = b[a], hi = b[a + 3];
        if (Math.abs(d) < 1e-6) { if (o < lo || o > hi) ok = false; continue; }
        let ta = (lo - o) / d, tb = (hi - o) / d; if (ta > tb) { const q = ta; ta = tb; tb = q; }
        if (ta > t0) t0 = ta; if (tb < t1) t1 = tb; if (t0 > t1) ok = false;
      }
      if (ok) return true;
    }
    return false;
  }
  /** the cheapest thing Brother Cinder sells right now (to brighten his marker when the gold covers it) */
  function cheapest(st) {
    const sv = saveOf(st); let best = Infinity;
    const mgo = minigunOf(st).owned;
    for (const u of UPGRADES) { if (u.id === 'minigun' || (u.needs && !mgo)) continue; const lv = sv.upgrades[u.id] | 0; if (lv < u.max) best = Math.min(best, upgradeCost(u, lv)); }
    const M = minigunDef(), mg = minigunOf(st);
    best = Math.min(best, mg.owned ? (mg.level < (M.max || 10) ? upgradeCost(M, mg.level) : Infinity) : M.unlock);
    return best;
  }
  let lastBegin = '', lastAfford = null, tipShownFor = -1, campVisit = 0;
  /** place one world marker (screen-projected, occluded, scaled within limits); returns whether it shows */
  function placeMark(el, x, y, z, show, towersOnly = false) {
    const q = show ? project(x, y, z) : null;
    const W = ui.clientWidth || innerWidth, H = ui.clientHeight || innerHeight;
    const vis = !!(q && q.z < 80 && q.x > -20 && q.x < W + 20 && q.y > 10 && q.y < H - 10) && !occluded(x, y, z, towersOnly);
    setClass(el, 'on', vis);
    if (vis && q) { const sc = Math.max(0.7, Math.min(1.15, 12 / q.z)); el.style.transform = `translate(${q.x.toFixed(1)}px,${q.y.toFixed(1)}px) translate(-50%,-100%) scale(${sc.toFixed(3)})`; }
    return vis;
  }
  function stepCamp(st) {
    const on = !!st && st.mode === 'camp' && now() - campLeftAt > 4.5 && !letterbox && !panels.isOpen && !modalOn;
    setClass(beginEl, 'on', on);
    if (on) {
      const nx = nightOf(st), lbl = `BEGIN NIGHT ${ROMAN[nx] || nx}`;
      if (lbl !== lastBegin) { lastBegin = lbl; beginLbl.textContent = lbl; }
      // the first camp of a save: a 3-step tip (state.camp.tip, from the sim), once per camp visit
      if (st.camp?.tip && tipShownFor !== campVisit) { tipShownFor = campVisit; toast('THE CAMP · THREE STEPS', 9, 'warn', '1 talk to Brother Cinder · 2 build on a glowing pad · 3 begin the night'); }
    }
    const pan = ARENA.beacon.pan, npc = ARENA.camp.npc, gy = groundHeight(npc.x, npc.z);
    placeMark(panMark, pan.x, pan.y + 2.2, pan.z, on, true);
    const nVis = placeMark(npcMark, npc.x, gy + 2.15, npc.z, on);
    if (nVis) { const af = saveOf(st).gold >= cheapest(st); if (af !== lastAfford) { lastAfford = af; setClass(npcMark, 'afford', af); } }
  }

  // ------------------------------------------------------------------------------------------------ events
  function onEvent(ev, state) {
    if (!ev || !ev.type) return;
    switch (ev.type) {
      case EV.NIGHT_START: hintsUntil = now() + 10; setClass(hintsEl, 'on', true); break;
      case EV.WAVE: {
        if (ev.kindled) break;
        const n = ev.n | 0;
        if (n > 1 && now() - lastWaveToast > 25) { lastWaveToast = now(); toast(`WAVE ${n} · THE HORDE SWELLS`, 2.2); }
        break;
      }
      // after the 1 s kindle glance, in the toast band: a centre banner sat right over the flaring basket
      case EV.KINDLE: kindledUntil = now() + KINDLE_S; schedule(0.95, () => toast('THE BEACON BURNS', 2.6, 'warn', 'they come · XP ×1.5 · the Lance refilled')); break;
      case EV.BEACON_READY: toast('THE BEACON IS READY', 2.4, 'cool'); break;
      case EV.LEVEL_UP: restart(lvEl, 'bump'); flashBar(xp); break;
      case EV.CARD_PICK: {
        const d = cardDef(String(ev.cardId), opts.cardDefs);
        if (d.kind === 'unlock' || /blunder/.test(String(ev.cardId)) && !/pellet/.test(String(ev.cardId))) {
          blunderUnlocked = true;
          banner('NEW WEAPON', `${d.name.toUpperCase()} · press 2`, 'unlock', 2.2);
        } else toast(d.name.toUpperCase(), 1.8, 'cool');
        break;
      }
      case EV.T_ARRIVE: banner('THE ASH TROLL', 'Burn it red-hot, then shoot', 'troll', 3.0); break;
      case EV.T_GLOW: if (ev.on && now() - lastGlowToast > 8) { lastGlowToast = now(); toast('ITS HIDE GLOWS · GUNS ×3', 2.0, 'cool'); } break;
      case EV.T_HURT: flashBar(trollBar); break;
      case EV.T_DEATH: banner('THE ASH TROLL FALLS', 'Hold until dawn', 'troll', 2.6); break;
      case EV.GATE_HIT: {
        flashBar(gate);
        const f = Number(ev.hpFrac);
        if (f < 0.5 && gateWarned < 1) { gateWarned = 1; toast('THE GATE IS WEAKENING', 2.2); }
        if (f < 0.25 && gateWarned < 2) { gateWarned = 2; toast('THE GATE IS FAILING', 2.6); }
        break;
      }
      case EV.P_HURT: flashBar(hp); restart(hpNum, 'bump'); break;
      case EV.P_HEAL: restart(hpNum, 'bump'); break;
      case EV.RELOAD: reloadDur = Math.max(0.2, Number(ev.seconds) || RELOAD_S[ev.weapon] || 1.2); break;
      case EV.DRY: if (ev.weapon === 'lance') flashBar(fuel); else restart(acount, 'bump'); break;
      case EV.WEAPON_SWITCH: restart(wname, 'bump'); break;
      case EV.BOMB_THROW: if (bombEls.length) { const b = bombEls[Math.max(0, Math.min(bombEls.length - 1, (state?.player?.bombs ?? 1)))]; if (b) restart(b, 'bump'); } break;
      case EV.SUNBURST: flashBar(sun); break;
      case EV.VICTORY: lastStats = ev.stats || null; break;
      case EV.FALLEN: fallenCause = ev.cause === 'player' ? 'player' : 'gate'; lastStats = ev.stats || null; break;
      case EV.RETRY: resetRun(state); break;
      // ---- DESIGN §9
      case EV.NPC_OPEN: if (ev.panel === 'pad') panel('pad', state, { pad: ev.pad }); else panel('npc', state, { line: ev.line, reason: campReason }); break;
      case EV.NPC_CLOSE: if (panels.isOpen && (!ev.panel || ev.panel === panels.kind)) panels.close('sim', true); break;
      case EV.NPC_LINE: npcLine(ev.line); break;
      case EV.BUY: panels.onEvent(ev); restart(goldRow, 'bump'); break;
      case EV.CHARM_PICKUP: {
        const c = CHARMS.find((x) => x.id === ev.charm), nm = String(c?.name || ev.charm || 'A CHARM').toUpperCase();
        if (ev.dup) toast(`CHARM FOUND · ${nm}`, 2.8, 'warn', `you have one · +${Number(ev.gold) || 30} gold`);
        else toast(`CHARM FOUND · ${nm}`, 3.4, 'warn', `${c?.text || ''}${c ? ' · ' : ''}equip it at the camp`);
        break;
      }
      case EV.ELITE_SPAWN: banner(ev.kind === 'hexer' ? 'A HEXER' : 'A GOBLIN CHIEFTAIN', ev.kind === 'hexer' ? 'Its hex chokes the Lance' : 'It carries a charm', 'troll', 2.4); break;
      case EV.HEX: if (ev.hit) toast('HEXED · THE LANCE SPUTTERS', 2.0, 'cool'); break;
      // the tower kind is `tower` (a payload `type` would overwrite the event's own type)
      case EV.TOWER_BUILD: if (ev.tower) toast(`${towerName(ev.tower).toUpperCase()} RAISED`, 2.0, 'warn', 'it stands until the run ends'); break;
      case EV.TOWER_UPGRADE: if (ev.tower) toast(`${towerName(ev.tower).toUpperCase()} · LV ${ev.level | 0}`, 1.8, 'warn'); break;
      case 'pad.open': panel('pad', state, { pad: ev.pad }); break;      // (main.js may also call ui.panel: the same panel is not opened twice)
      case 'pad.close': if (panels.isOpen && panels.kind === 'pad') panels.close('sim', true); break;
      case EV.RUN_END: goldBanked = Number(ev.goldBanked); runEndReason = String(ev.reason || ''); if (ev.stats) lastStats = ev.stats; break;
      case EV.RUN_START: goldBanked = null; runEndReason = ''; break;
      case EV.CAMP_ENTER: {
        campReason = String(ev.reason || ''); resetRun(state); campLineAt = now(); campLeftAt = -99; campVisit++;
        const line = ev.reason === 'fall' ? 'fall' : ev.reason === 'complete' ? 'eight' : !saveOf(state).nightsCompleted && !saveOf(state).runN ? 'home' : '';
        if (line) schedule(2.6, () => { if (now() - lastNpcLineAt > 2.4 && !panels.isOpen && lastState?.mode === 'camp') npcLine(line); });
        break;
      }
      case EV.CAMP_LEAVE: campLeftAt = now(); if (panels.isOpen) panels.close('leave', true); subtitle(''); clearToasts(); break;   // no camp message follows into the night
      case EV.NIGHT_TITLE: card('night', state, { night: ev.night }); break;
      // ---- DESIGN §8 (the sim's own names are accepted too)
      case 'coven.chant': if (ev.on === false) { covenUntil = 0; if (ev.broken) toast('THE CHANT IS BROKEN', 2.0, 'cool'); break; } covenDur = Math.max(1, Number(ev.seconds) || 20); covenUntil = now() + covenDur; toast('THE COVEN CHANTS', 2.6, 'warn', 'kill the Hexers before the lamp dims'); break;
      case 'coven.lock': case 'coven.dim': covenUntil = 0; toast('THE LAMP IS DIMMED', 2.6, 'cool', `the kindle is locked for ${Math.round(Number(ev.seconds) || 30)} s`); break;
      case 'ram.gate': if (!ramWarned.has(ev.id ?? 'ev')) { ramWarned.add(ev.id ?? 'ev'); banner('THE RAM IS AT THE GATE', 'Burn its crew · every carrier is its strength', 'troll', 2.8); } break;
      case 'ram.spawn': toast('A SIEGE RAM', 2.2, 'warn', 'the war drum: it comes up the road'); break;
      case 'boss.crack': if (ev.on) toast('HER STONE CRACKS · GUNS ×3', 2.0, 'cool'); break;
      case 'boss.hex': if (ev.hit) toast('HEXED · THE LANCE SPUTTERS', 2.0, 'cool'); break;
      case 'weather.squall': if (ev.on) toast('A SQUALL', 2.2, 'cool', 'the rain weakens every fire'); break;
      case 'ram.stall': if (ev.on) toast('THE RAM STALLS', 1.6, 'warn', 'its crew burns'); break;
      case 'ending.start': endingFirst = !ev.seen; break;
      case 'boss.rise': banner('THE RAINMOTHER', 'She rises from the river', 'troll', 3.2); break;
      case 'boss.lantern': toast('A LANTERN GOES OUT', 1.8, 'cool', `${Math.max(0, ev.left | 0)} left in her crown`); break;
      case 'ending.beat': if (ev.id === 'cinder') schedule(0.6, () => { if (now() - lastNpcLineAt > 1.5) npcLine('master'); }); break;
      default: break;
    }
  }

  function resetRun(state) {
    bannerQ.length = 0; bannerUntil = 0; bannerEl.className = 'ew-banner ew-ts';
    clearToasts(); lastXpV = -1; lastXpLv = -1;
    subtitle('');
    kindledUntil = 0; blunderUnlocked = false; gateWarned = 0; lastStats = null; fallenCause = 'gate';
    const p = state?.player, g = state?.gate;
    snapBar(hp, p ? p.hp / (p.hpMax || 100) : 1);
    snapBar(xp, p ? (p.xp || 0) / (p.xpNext || 1) : 0);
    snapBar(gate, g ? g.hp / (g.hpMax || 1000) : 1);
    snapBar(trollBar, 1);
    snapBar(dawn, n0(state));
    lastLv = lastHp = lastRounds = lastMag = lastBombs = lastBombsMax = lastClockS = lastGatePct = -1;
    lastWeapon = lastBeaconTxt = lastPrompt = lastRhint = lastSlots = '';
  }

  // ------------------------------------------------------------------------------------------------ per frame
  /** @param {any} state @param {number} [dtIn] seconds (default: wall time since the last call) */
  function update(state, dtIn) {
    const t = now();
    const dt = Number.isFinite(dtIn) ? Math.min(0.1, Math.max(0, /** @type {number} */ (dtIn))) : Math.min(0.1, Math.max(0, t - lastNow));
    lastNow = t; clock = t;
    if (state) lastState = state;

    // timers
    for (let i = later.length - 1; i >= 0; i--) if (t >= later[i].at) { const j = later[i]; later.splice(i, 1); j.run(); }
    setClass(ui, 'ew-banneron', !!bannerUntil);   // world plates step back under a banner
    if (bannerUntil) {
      if (bannerOutAt && t >= bannerOutAt) { bannerOutAt = 0; bannerEl.classList.remove('on'); bannerEl.classList.add('out'); }
      if (t >= bannerUntil) nextBanner();
    }
    // while a modal (menu, controls, cards, an end card) is up, transient messages hide and their clocks stop
    const modalNow = menuOpen || ctlOpen || panels.isOpen || !!(cardsState && !cardsState.done) || !!(endState && !endState.done && endState.buttons.length);
    if (modalNow !== modalOn) { modalOn = modalNow; setClass(ui, 'ew-modalon', modalOn); }
    // stale messages never outlive the night: the dawn / fallen flows clear them; a letterboxed cinema holds them
    if ((state?.mode === 'fallen' || state?.mode === 'victory') && (toastCur || toastQ.length)) clearToasts();
    if (modalOn) { // banners and subtitles belong to cinemas too, so only a modal stops their clocks
      if (bannerUntil) { bannerUntil += dt; if (bannerOutAt) bannerOutAt += dt; }
      if (subUntil) subUntil += dt;
    }
    if (modalOn || letterbox) {
      if (toastCur) { toastCur.until += dt; toastCur.goneAt += dt; }
    } else {
      if (toastCur && !toastCur.out && t >= toastCur.until) { toastCur.out = true; toastCur.goneAt = t + 0.32; toastEl.classList.remove('on'); toastEl.classList.add('out'); }
      else if (toastCur && toastCur.out && t >= toastCur.goneAt) { toastCur = null; toastEl.className = 'ew-toast'; }
      if (!toastCur && toastQ.length) showToast(/** @type {any} */ (toastQ.shift()));
    }
    if (subUntil && t >= subUntil) { subUntil = 0; setClass(subEl, 'on', false); }
    if (hintsUntil && t >= hintsUntil) { hintsUntil = 0; setClass(hintsEl, 'on', false); }
    if (restartArmedUntil && t >= restartArmedUntil) armRestart(false);
    if (endState && endState.auto && t >= endState.auto && !endState.done) closeEnd(null);

    const mode = state?.mode || '';
    if (mode !== lastMode) lastMode = mode;
    stepFirstHelp(mode, state);
    const wantHud = !letterbox && !!state && (mode === 'play' || mode === 'cards' || (mode === 'camp' && t - campLeftAt > 4.5) || mode === '');
    if (wantHud !== hudOn) { hudOn = wantHud; setClass(ui, 'ew-hudon', hudOn); }
    const isCamp = mode === 'camp' && t - campLeftAt > 4.5;
    if (isCamp !== campOn) { campOn = isCamp; setClass(ui, 'ew-camp', isCamp); lastPrompt = '_'; }
    panels.update(state);
    if (panels.isOpen && state?.camp && 'panel' in state.camp && !state.camp.panel && state.mode === 'camp') { if ((panelGoneT += dt) > 0.8) panels.close('sim', true); } else panelGoneT = 0;
    stepPlates(state, dt);
    stepCamp(state);
    stepNightX(state, dt);
    if (!state) return;
    // --- gold: banked + picked up this night (DESIGN §9.3: banked at dawn and on a fall)
    {
      const bank = saveOf(state).gold, run = isCamp ? 0 : runGold(state), tot = bank + run;
      if (tot !== lastGold) { if (tot > lastGold && lastGold >= 0) restart(goldRow, 'bump'); lastGold = tot; goldNum.textContent = String(tot); }
      if (run !== lastRunGold) { lastRunGold = run; goldRun.textContent = run > 0 ? `+${run} TONIGHT` : ''; }
      if (isCamp) { const nx = nightOf(state); if (nx !== lastCampNext) { lastCampNext = nx; campNext.textContent = nx === 1 ? 'THE LAMP SMOULDERS · NEXT: NIGHT I' : `THE LAMP SMOULDERS · NEXT: NIGHT ${ROMAN[nx] || nx}`; } }
    }

    const p = state.player, n = state.night, g = state.gate;
    // --- top-left: LV + XP
    if (p) {
      const lv = p.level | 0 || 1;
      if (lv !== lastLv) { lastLv = lv; lvEl.textContent = `LV ${lv}`; }
      const xf = clamp01((p.xp || 0) / (p.xpNext || 1));
      // XP arrives on every kill: a small tick on the bar whenever it grows (throttled)
      if (lv === lastXpLv && (p.xp || 0) > lastXpV + 1e-6 && t - xpTickAt > 0.14) { xpTickAt = t; restart(xp.el, 'tick'); }
      lastXpLv = lv; lastXpV = p.xp || 0;
      if (xf < xp.target - 0.05) snapBar(xp, xf); // a level-up wraps the bar: no damage chip
      stepBar(xp, xf, dt, 0.1, 2, 1.6);
    }
    // --- top-centre
    if (n) {
      const nightN = n.n || n.index || 1;
      if (nightN !== lastNight) { lastNight = nightN; nightLbl.textContent = `NIGHT ${ROMAN[nightN] || nightN}`; }
      const dawnAt = n.dawnAt || 300;
      const c = Math.min(n.clock || 0, dawnAt);
      const cs = Math.floor(c);
      if (cs !== lastClockS) { lastClockS = cs; timeLbl.textContent = fmtTime(cs); setClass(clockEl, 'warn', dawnAt - c < 10 && c < dawnAt); }
      if (c / dawnAt < dawn.target - 0.02) snapBar(dawn, c / dawnAt);
      stepBar(dawn, c / dawnAt, dt, 0, 1, 0.5);
      // the troll marks: NIGHTS[n].trolls (Night II has two); a mark goes once its troll has come
      const nd = NIGHTS[nightN - 1], tts = nd?.trolls?.length ? nd.trolls : [210];
      const tkey = `${nightN}|${dawnAt}`;
      if (tkey !== lastTrollKey) { lastTrollKey = tkey; trollMarks.forEach((m, i) => { if (tts[i] != null) m.style.left = `${(tts[i] / dawnAt) * 100}%`; }); }
      trollMarks.forEach((m, i) => { const on = tts[i] != null && (n.clock || 0) < tts[i] - 0.5 && !(i === 0 && tts.length === 1 && trollOn); if ((m.style.display !== 'none') !== on) m.style.display = on ? '' : 'none'; });
      // beacon status line
      const cd = n.kindleCd || 0;
      let btxt, bcls = '';
      const lockT = n.kindleLockT || 0;   // the coven's lock outranks "ready"
      if (kindledUntil > t) { btxt = `BEACON BURNS ×${n.kindle || 1} · ${fmtTime(kindledUntil - t)}`; bcls = 'kindled'; }
      else if (lockT > 0.05) { btxt = `THE LAMP IS DIMMED · ${Math.ceil(lockT)} s`; bcls = 'locked'; }
      else if (cd > 0.05) btxt = `BEACON · ${fmtTime(cd)}`;
      else { btxt = 'BEACON READY · E AT THE PAN'; bcls = 'ready'; }
      if (btxt !== lastBeaconTxt) {
        lastBeaconTxt = btxt; beaconEl.textContent = btxt;
        setClass(beaconEl, 'ready', bcls === 'ready'); setClass(beaconEl, 'kindled', bcls === 'kindled'); setClass(beaconEl, 'locked', bcls === 'locked');
      }
    }
    if (g) {
      const f = clamp01(g.hp / (g.hpMax || 1000));
      stepBar(gate, f, dt);
      const pct = Math.ceil(f * 100);
      if (pct !== lastGatePct) { lastGatePct = pct; gatePct.textContent = `${pct}%`; }
      const low = f < 0.25 && f > 0;
      if (low !== gateLow) { gateLow = low; setClass(gate.el, 'low', low); }
    }
    const tr = state.troll;
    const tOn = !!tr && tr.hp > 0;
    if (tOn !== trollOn) { trollOn = tOn; setClass(trollEl, 'on', tOn); if (tOn) snapBar(trollBar, tr.hp / (tr.hpMax || 2400)); }
    if (tOn) {
      stepBar(trollBar, tr.hp / (tr.hpMax || 2400), dt, 0.6, 0.5);
      const glow = !!tr.glowing;
      if (glow !== trollGlow) { trollGlow = glow; setClass(trollEl, 'glow', glow); }
    }
    // --- bottom-left: HP
    if (p) {
      const hpv = Math.max(0, Math.ceil(p.hp || 0));
      if (hpv !== lastHp) { lastHp = hpv; hpNum.textContent = String(hpv); }
      stepBar(hp, (p.hp || 0) / (p.hpMax || 100), dt, 0.5, 0.7);
      const low = p.hp > 0 && p.hp / (p.hpMax || 100) < 0.3;
      if (low !== lowOn) { lowOn = low; setClass(ui, 'ew-low', low); }
      // DESIGN §3.4: Hearthblood heals only while you stand in fire on the ground: a warm glow at the HP bar while it does
      const tk = state.taken, hb = !!tk && ((tk.hearthblood || 0) + (tk['hearthblood-up'] || 0)) > 0;
      const hOn = hb && !!p.inFire && p.hp < (p.hpMax || 100) && state.mode === 'play';
      if (hOn !== hearthOn) { hearthOn = hOn; setClass(ui, 'ew-hearth', hOn); }
    }
    // --- bottom-right: weapon block
    if (p) {
      const w = p.weapon || 'pistol';
      if (w === 'blunderbuss') blunderUnlocked = true;
      if (p.unlocked?.blunderbuss || (Array.isArray(p.weapons) && p.weapons.includes('blunderbuss'))) blunderUnlocked = true;
      const organ = slot2Organ(state);   // the THUNDER ORGAN holds slot 2 (DESIGN §4.2)
      const slotsKey = `${w}|${blunderUnlocked}|${organ}`;
      if (slotsKey !== lastSlots) {
        lastSlots = slotsKey;
        slotEls[1].textContent = organ ? '2 ORGAN' : '2';
        ['pistol', organ ? 'organ' : 'blunderbuss', 'lance'].forEach((id, i) => { setClass(slotEls[i], 'cur', id === w || (i === 1 && isOrgan(w))); setClass(slotEls[i], 'lock', i === 1 && !organ && !blunderUnlocked); });
      }
      if (w !== lastWeapon) {
        lastWeapon = w; wname.textContent = WEAPON_NAME[w] || String(w).toUpperCase();
        setClass(gauge, 'lance', w === 'lance'); setClass(gauge, 'organ', isOrgan(w)); lastRounds = lastMag = -1;
      }
      if (isOrgan(w)) { // the sim: player.organ { heat, lockT, drum, drumMax, reloadT, spin }
        const o = p.organ || {}, hv = clamp01(Number(o.heat ?? p.heat) || 0), over = (Number(o.lockT ?? p.overheatT) || 0) > 0;
        stepBar(heat, over ? 1 : hv, dt, 0, 1, 6);
        setClass(heat.el, 'hot', hv > 0.7 && !over); setClass(heat.el, 'over', over);
      }
      if (w === 'lance') {
        const f = (p.fuel ?? 0) / (p.fuelMax || 100);
        stepBar(fuel, f, dt, 0, 1, 3);
        const lf = f < 0.15;
        if (lf !== lowFuel) { lowFuel = lf; setClass(fuel.el, 'low', lf); }
      } else {
        const og = isOrgan(w) ? p.organ : null;
        const mag = og?.drumMax ?? p.ammoMax?.[w] ?? p.mag?.[w] ?? p.magSize?.[w] ?? MAG[w] ?? 8;
        const r = Math.max(0, Math.min(mag, (og ? og.drum : p.ammo?.[w] ?? mag) | 0));
        if (mag !== lastMag) {
          lastMag = mag; roundsEl.innerHTML = '';
          if (mag <= 16) for (let i = 0; i < mag; i++) h('i', `ew-round${w === 'blunderbuss' ? ' shell' : ''}`, roundsEl);   // a 240-round drum shows a count
          lastRounds = -1;
        }
        if (r !== lastRounds) {
          lastRounds = r; acount.textContent = mag > 16 ? `${r}/${mag}` : String(r);
          const els = roundsEl.children;
          for (let i = 0; i < els.length; i++) setClass(/** @type {HTMLElement} */ (els[i]), 'spent', i >= r);
        }
        const rT = og ? (og.reloadT || 0) : (p.reloadT || 0), rel = rT > 0;
        setClass(gauge, 'reloading', rel);
        if (rel) stepBar(reload, 1 - rT / reloadDur, dt, 0, 1, 99);
      }
      // reload / fuel hint
      let rh = '';
      if (isOrgan(w) && (Number(p.organ?.lockT ?? p.overheatT) || 0) > 0) rh = 'OVERHEATED · LET IT COOL';
      else if (isOrgan(w) && (p.organ?.reloadT || 0) > 0) rh = 'RELOADING';
      else if (isOrgan(w)) rh = (p.organ?.drum ?? 1) === 0 ? 'R · RELOAD' : '';
      else if (w !== 'lance' && (p.reloadT || 0) > 0) rh = 'RELOADING';
      else if (w !== 'lance' && (p.ammo?.[w] ?? 1) === 0) rh = 'R · RELOAD';
      else if (w === 'lance' && (p.fuel ?? 1) <= 0.5) rh = 'NO FUEL · STAND BY A BRAZIER';
      if (rh !== lastRhint) { lastRhint = rh; rhint.textContent = rh; }
      // bombs
      const bm = p.bombsMax || 3, bn = Math.max(0, Math.min(bm, (p.bombs ?? bm) | 0));
      if (bm !== lastBombsMax) {
        lastBombsMax = bm; bombEls.forEach((b) => b.remove()); bombEls = [];
        for (let i = 0; i < bm; i++) bombEls.push(h('i', 'ew-bomb', bombsEl));
        lastBombs = -1;
      }
      if (bn !== lastBombs) { lastBombs = bn; bombEls.forEach((b, i) => { setClass(b, 'full', i < bn); setClass(b, 'empty', i >= bn); }); }
      // sunburst
      const sb = clamp01(p.sunburst || 0);
      stepBar(sun, sb, dt, 0, 1, 2);
      const ready = sb >= 0.999;
      if (ready !== sunReady) { sunReady = ready; setClass(sunEl, 'ready', ready); if (ready) toast('SUNBURST READY · Q', 2.0, 'cool'); }
    }
    // --- the beacon prompt
    const pr = hudOn && !glanceOn ? promptInfo(state) : null;   // no pan prompt mid-frame during the kindle glance
    const pkey = pr ? `${pr.locked}|${pr.text}|${pr.sub}|${!!pr.camp}` : '';
    if (pkey !== lastPrompt) {
      lastPrompt = pkey;
      if (pr) { pText.textContent = pr.text; pSub.textContent = pr.sub; setClass(promptEl, 'locked', pr.locked); setClass(promptEl, 'camp', !!pr.camp); }
      setClass(promptEl, 'on', !!pr);
    }
  }

  function dispose() {
    window.removeEventListener('resize', resize);
    window.removeEventListener('keydown', onKey, true);
    if (cardsState && !cardsState.done) { cardsState.done = true; cardsState.resolve(cardsState.ids[0]); }
    if (endState && !endState.done) closeEnd(null);
    if (panels.isOpen) panels.close('dispose', true);
    if (menuOpen) menu.close('resume');
    ui.remove();
  }

  /** Test / hook helper: resolve the open cards, end card or menu with a choice (a card index 0..2 or id, 'retry', ...). */
  function choose(choice) {
    if (cardsState && !cardsState.done) {
      const i = typeof choice === 'number' ? choice : Math.max(0, cardsState.ids.indexOf(String(choice)));
      cardsState.openedAt = -1; pickCard(i); return true;
    }
    if (endState && !endState.done) { closeEnd(choice ?? null); return true; }
    if (panels.isOpen) { if (choice === 'close' || choice == null) panels.close('choose'); else panels.choose(choice); return true; }
    if (menuOpen) { menu.close(choice || 'resume'); return true; }
    return false;
  }

  return {
    update, onEvent, cards, card, menu, controls, setFireStyle, toast, subtitle, banner, setLetterbox, fade, choose,
    // DESIGN §9: panels, the caption, Brother Cinder's lines, the camera for the elite name plates
    panel, caption, npcLine,
    closePanel(reason) { if (panels.isOpen) panels.close(reason || 'close', true); },
    setPanelTab(tab) { panels.setTab(tab); },
    get panelOpen() { return panels.isOpen; },
    get panelKind() { return panels.kind; },
    setCamera(c) { cam = c || null; },
    setHidden(on) { setClass(ui, 'ew-noui', !!on); },
    /** the cinema's kindle glance is running: the pan prompt hides for its second */
    setGlance(on) { glanceOn = !!on; },
    /** dress the standalone cover (#loading) as the title */
    titleCover(el, line) { titleCover(el || document.getElementById('loading'), line); },
    get modal() { return menuOpen || ctlOpen || panels.isOpen || !!(cardsState && !cardsState.done) || !!(endState && !endState.done && endState.buttons.length); },
    get cardsOpen() { return !!(cardsState && !cardsState.done); },
    get letterbox() { return letterbox; },
    credits, skipEnding,
    get fireStyle() { return fireStyle; },
    el: ui,
    dispose,
  };
}
