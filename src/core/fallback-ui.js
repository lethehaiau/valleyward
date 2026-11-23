// VALLEYWARD · the plain DOM HUD that stands in while src/ui/ is missing or has thrown (docs/DESIGN.md §14.3). It offers
// src/ui/'s interface: the night clock and the dawn bar, gate HP, HP, XP and level, the weapon with its ammo or fuel, the
// beacon prompt, the level-up cards, the dawn / fallen cards, the P menu and the controls line.
import { ARENA } from '../shared/arena.js';
import { CARD_BY_ID } from '../sim/cards.js';
import { createMenuSelect, createMenuToggle } from './menu-select.js';

const STYLE_ID = 'ewf-style';
/** [selector under .ewf, declarations]: kept in this order (later rules win ties) */
const RULES = [
  ['', 'position:fixed;inset:0;pointer-events:none;font:600 14px/1.25 ui-monospace,Menlo,monospace;color:#eef6f7;text-shadow:0 1px 0 #000,0 0 3px #000'],
  [' .top', 'position:absolute;top:10px;left:50%;transform:translateX(-50%);text-align:center;letter-spacing:.12em'],
  [' .bar', 'height:6px;background:#0b1c24;border:1px solid #9ee1e9;margin-top:4px;width:260px'],
  [' .bar i', 'display:block;height:100%;transform-origin:0 50%'],
  [' .gate i', 'background:#c33'], [' .dawn i', 'background:#9ee1e9'], [' .hp i', 'background:#c33'],
  [' .xp i', 'background:#e8c860'], [' .ammo i', 'background:#e88a32'],
  [' .tl', 'position:absolute;top:10px;left:14px'], [' .bl', 'position:absolute;bottom:14px;left:14px'],
  [' .br', 'position:absolute;bottom:14px;right:14px;text-align:right'],
  [' .prompt', 'position:absolute;top:58%;left:50%;transform:translateX(-50%);opacity:0;transition:opacity .2s'],
  [' .prompt.on', 'opacity:1'],
  [' .xh', 'position:absolute;left:50%;top:50%;width:4px;height:4px;margin:-2px;background:#eef6f7;box-shadow:0 0 2px #000'],
  [' .card', 'position:absolute;inset:0;display:grid;place-content:center;text-align:center;background:rgba(5,14,20,.78);pointer-events:auto;gap:14px'],
  [' .card h1', 'font-weight:700;letter-spacing:.24em;font-size:30px;margin:0'],
  [' .card p', 'margin:0;opacity:.85'],
  [' .cards', 'display:flex;gap:14px;justify-content:center'],
  [' .cards button', 'width:190px;min-height:110px;text-align:left'],
  [' button', 'pointer-events:auto;font:inherit;color:#eef6f7;background:#16313d;border:1px solid #9ee1e9;padding:10px 16px;cursor:var(--ew-cursor-action,pointer)'],
  [' button:hover', 'background:#21495a'],
  [' .setting', 'display:inline-flex;gap:.5em;align-items:center;margin:0 .4em'],
  [' .setting select', 'font:inherit;color:#eef6f7;background:#16313d;border:1px solid #9ee1e9;padding:8px;color-scheme:dark'],
  [' .setting button[aria-pressed="true"]', 'background:#a4e6ee;color:#0a1115'],
  [' .setting button:disabled', 'opacity:.55;cursor:default'],
  [' .hud', 'transition:opacity .3s'],
  ['.nohud .hud', 'opacity:0'],
];
const WEAPON_NAME = { pistol: 'KESTREL', blunderbuss: 'BLUNDERBUSS', lance: 'EMBER LANCE' };
const MAG = { pistol: 8 };   // rounds per load; every other gun holds 4
const CONTROLS = 'WASD move · Shift sprint · Space jump · Mouse look · LMB fire · RMB/G firebomb · 1/2/3 or wheel weapons · R reload · E kindle · Q Sunburst · P menu · H controls';

const two = (n) => String(n).padStart(2, '0');
/** mm:ss of whole seconds (never negative) */
function clockText(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  return `${two(Math.floor(s / 60))}:${two(s % 60)}`;
}

/** A new element with a class list and an optional text. */
function make(tag, className = '', text = null) {
  const n = document.createElement(tag);
  if (className) n.className = className;
  if (text !== null) n.textContent = text;
  return n;
}
/** A progress bar (a box with a fill `i` scaled along x). */
function meter(kind, style = '') {
  const box = make('div', `bar ${kind}`);
  if (style) box.style.cssText = style;
  box.appendChild(make('i'));
  return box;
}
const group = (className, ...kids) => { const g = make('div', className); g.append(...kids); return g; };
const fill = (bar, f) => { bar.firstChild.style.transform = `scaleX(${f})`; };

export function createFallbackUI({ root, onAction, menuSettings = [], touch = false, addFullscreen = null } = {}) {
  if (!document.getElementById(STYLE_ID)) {
    const tag = make('style');
    tag.id = STYLE_ID;
    tag.textContent = RULES.map(([sel, body]) => `.ewf${sel}{${body}}`).join('\n');
    document.head.appendChild(tag);
  }
  const hud = {
    clock: make('div', 'clock', 'NIGHT I  00:00'), dawn: meter('dawn'), gate: meter('gate'),
    level: make('div', 'lv', 'LV 1'), xp: meter('xp', 'width:180px'),
    hpText: make('div', 'hpn', '100'), hp: meter('hp', 'width:220px'),
    weapon: make('div', 'wn', 'KESTREL'), ammoText: make('div', 'am'), ammo: meter('ammo', 'width:180px;margin-left:auto'),
    bombs: make('div', 'bm'), prompt: make('div', 'prompt', 'E · KINDLE THE BEACON'),
  };
  const shell = make('div', 'ewf nohud');
  shell.appendChild(group('hud',
    group('top', hud.clock, hud.dawn, hud.gate),
    group('tl', hud.level, hud.xp),
    group('bl', hud.hpText, hud.hp),
    group('br', hud.weapon, hud.ammoText, hud.ammo, hud.bombs),
    hud.prompt, make('div', 'xh')));
  (root || document.body).appendChild(shell);

  // ---- the cards: one open at a time; opening another resolves the first with null
  let open = null;   // { el, done(value), picks: the level-up buttons in order, onPick }
  function dismiss(value, event) {
    const was = open;
    if (!was) return;
    open = null;
    was.el.remove();
    was.done(value);
    if (event) was.onPick?.(value, event);
  }
  function showCard(build, onPick) {
    if (open) dismiss(null);
    return new Promise((resolve) => {
      const el = make('div', 'card'), picks = [];
      open = { el, done: resolve, picks, onPick };
      build(el, picks);
      shell.appendChild(el);
    });
  }
  /** Level-up: one button per card id; resolves the id picked. */
  const cards = (ids, onPick) => showCard((el, picks) => {
    const row = make('div', 'cards');
    ids.forEach((id, k) => {
      const def = CARD_BY_ID[id], button = make('button');
      button.dataset.id = id;
      button.append(make('b', '', `${k + 1} · ${def?.name || id}`), make('br'), make('br'), def?.text || '');
      button.onclick = (event) => dismiss(id, event);
      row.appendChild(button);
      picks.push(button);
    });
    el.append(make('h1', '', 'LEVEL UP'), row);
  }, onPick);
  /** The night card resolves at once; dawn and fallen show the stats and resolve 'retry'. */
  function card(kind, st) {
    if (open) dismiss(null);
    if (kind === 'night') return Promise.resolve(null);
    return showCard((el) => {
      const s = st?.stats || {}, gate = st?.gate;
      const heading = kind === 'dawn' ? 'DAWN · THE WATCH HOLDS' : gate?.hp <= 0 ? 'THE GATE IS BREACHED' : 'THE LAMPLIGHTER FALLS';
      const gatePct = Math.round(100 * (gate?.hp || 0) / (gate?.hpMax || 1));
      const line = [`time ${clockText(s.timeAlive || 0)}`, `kills ${s.kills || 0}`, `burned ${s.burned || 0}`, `gate ${gatePct} %`, `level ${s.level || 1}`];
      const again = make('button', '', 'Hold another night');
      again.dataset.a = 'retry';
      again.onclick = () => dismiss('retry');
      el.append(make('h1', '', heading), make('p', '', line.join(' · ')), group('', again));
    });
  }

  // ---- the P menu
  let menuShown = false, menuDone = null, style = 'smooth';
  const menuEl = make('div', 'card');
  const settings = menuSettings.map((setting) => {
    if (setting.id === 'renderer') {
      const toggle = createMenuToggle(setting, ({ id, label }) => {
        if (window.confirm(`Switch to ${label}? The game will reload.`)) setting.choose(id);
      });
      return { label: group('setting', make('span', '', setting.label), toggle) };
    }
    const control = createMenuSelect(setting);
    const label = make('label', 'setting', setting.label);
    label.append(control.select);
    return { label, refresh: control.refresh };
  });
  menuEl.style.display = 'none';
  shell.appendChild(menuEl);
  const menu = {
    open() {
      for (const setting of settings) setting.refresh?.();
      menuShown = true;
      menuEl.style.display = '';
      try { document.exitPointerLock?.(); } catch { /* not locked */ }
      return new Promise((resolve) => { menuDone = resolve; });
    },
    close(v = 'resume') {
      if (!menuShown) return;
      menuShown = false;
      menuEl.style.display = 'none';
      const done = menuDone;
      menuDone = null;
      done?.(v);
    },
    get isOpen() { return menuShown; },
  };
  function renderMenu() {
    const help = make('p', 'ctl', touch ? 'Left stick to move · Swipe to look · Hold and drag Fire · Tap Pause for the menu' : CONTROLS);
    help.style.display = 'none';
    // (the fire entry reads just "Fire style": the current style is not part of its label)
    const entries = [['resume', 'Resume'], ['restart', 'Restart night'], ['fire', 'Fire style'], ['controls', 'Controls']];
    const list = make('div');
    for (const [act, label] of entries) {
      const button = make('button', '', label);
      button.dataset.a = act;
      button.onclick = () => {
        if (act === 'controls') { help.style.display = help.style.display === 'none' ? '' : 'none'; return; }
        if (act !== 'fire') { menu.close(act); return; }
        style = style === 'smooth' ? 'hybrid' : 'smooth';
        onAction?.(`fire:${style}`);
        renderMenu();
      };
      list.appendChild(button);
    }
    menuEl.replaceChildren(make('h1', '', 'VALLEYWARD'), list);
    addFullscreen?.(list, 'ew-touch-button');
    if (settings.length) {
      menuEl.append(group('', ...settings.map(({ label }) => label)));
      if (settings.some(({ refresh }) => refresh)) menuEl.append(make('p', '', 'Module changes reload the game.'));
    }
    menuEl.append(help);
  }
  renderMenu();

  return {
    update(st) {
      if (!st) return;
      const p = st.player, inPlay = st.mode === 'play' || st.mode === 'cards';
      shell.classList.toggle('nohud', !inPlay);
      hud.clock.textContent = `NIGHT I  ${clockText(st.night.clock)}`;
      fill(hud.dawn, Math.min(1, st.night.clock / 300));
      fill(hud.gate, Math.max(0, st.gate.hp / st.gate.hpMax));
      hud.level.textContent = `LV ${p.level}`;
      fill(hud.xp, Math.min(1, p.xp / p.xpNext));
      hud.hpText.textContent = String(Math.ceil(p.hp));
      fill(hud.hp, Math.max(0, p.hp / p.hpMax));
      hud.weapon.textContent = WEAPON_NAME[p.weapon];
      if (p.weapon === 'lance') {
        hud.ammoText.textContent = '';
        fill(hud.ammo, p.fuel / p.fuelMax);
      } else {
        const rounds = p.ammo[p.weapon];
        hud.ammoText.textContent = p.reloadT > 0 ? 'RELOADING' : `${rounds}`;
        fill(hud.ammo, rounds / (MAG[p.weapon] || 4));
      }
      hud.bombs.textContent = `BOMBS ${p.bombs}  ·  SUNBURST ${Math.round(p.sunburst * 100)} %`;
      const { pan, useRadius } = ARENA.beacon;
      const atPan = Math.hypot(p.x - pan.x, p.y - pan.y, p.z - pan.z) < useRadius + 1;
      hud.prompt.classList.toggle('on', inPlay && atPan);
      hud.prompt.textContent = st.night.kindleCd > 0 ? `BEACON READY IN ${Math.ceil(st.night.kindleCd)}` : 'E · KINDLE THE BEACON';
    },
    onEvent() {},
    cards, card, menu,
    setFireStyle(s) { style = s; renderMenu(); },
    get modal() { return menuShown; },
    get cardsOpen() { return !!open?.picks.length; },
    /** Pick level-up card k (1..3) by key while the cards are up. */
    pickKey(k, event) {
      const button = open?.picks[k - 1];
      if (!button) return false;
      dismiss(button.dataset.id, event);
      return true;
    },
    choose(v) {
      if (open) { dismiss(v); return true; }
      if (menuShown) { menu.close(v); return true; }
      return false;
    },
    dispose() { shell.remove(); },
  };
}
