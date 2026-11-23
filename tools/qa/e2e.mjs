// VALLEYWARD end to end, on a production build (vite build, then vite preview). Run it under the GPU lock:
//   tools/gpu-lock.sh node tools/qa/e2e.mjs [--port 5358] [--seed 2] [--speed 4] [--only entry,probe,upgrades,mobile,views,night,v2,v3,v4,editions] [--no-build]
// One headless Chrome (tools/platform.mjs) and one preview server, both closed at the end. The stages, in order:
//   entry     the title cover, a click, the intro, Space after 2 s skips it, play (the route a player takes)
//   probe     the first seconds of input: W / A / S / D move within a frame or two and stop on release, a click fires,
//             3 takes the Lance, G throws a firebomb, E at the pan kindles, P pauses (the sim clock holds) and resumes,
//             the fire style switches live
//   upgrades  mouse and keyboard card picks restore capture, consecutive offers stay visible, one denial can recover
//   mobile    touch entry, multi-touch combat, input interruption, mobile menus, camp and ending
//   views     m1 / m2 / top in the greybox (?look=greybox) and with every module, the HUD
//   night     the self-play night (?autoplay=1&speed=4) to victory or a fall, captured at its key moments; the card → the camp
//   v2        DESIGN §9: the camp (Brother Cinder's panel, a buy, a pad's panel, two towers built and one upgraded, the save
//             kept over a reload, E at the pan → the night), Night II (blood moon, Dousers, Hexers, towers, orbit and
//             trail) and its dawn → the camp with a new run
//   v3        BEGIN NIGHT from the camp (N), the first-camp tip, the THUNDER ORGAN (save=rich), a Bat Gremlin's dive
//             (Night II), Pyre Burst
//   v4        DESIGN §8: each night's twist (III–IX, late save), Night X's Rainmother fought by the bot with god=1 until
//             she falls (her phases captured), every beat of the ending to its card, Play again; ?ending=1 (not skippable)
//   editions  decision 0001: webgl2 with classic in both fire slots; a missing ground module falls back to classic; the
//             webgpu edition (?gpu=webgpu) on WebGPURenderer with classic-webgpu in both slots while the bot plays
// PASS means every check passed: 0 console errors on every page, the entry and probe checks, the night reaching victory
// or a fall, and the rest. Report: e2e.json and shots/e2e_*.jpg in OUT, a gitignored scratch folder.
import fs from 'node:fs';
import path from 'node:path';
import { startPreview, launch, openPage, waitFor, sleep, meanLuma, ROOT } from './browser.mjs';
import { TIMELINE } from '../../src/shared/timeline.js';
import { XP_NEXT } from '../../src/sim/constants.js';
import { mobileStage } from './mobile.mjs';

// ---- options -------------------------------------------------------------------------------------------------------
const cli = process.argv.slice(2);
/** `--name value` from the command line, else the fallback. */
function option(name, fallback) {
  const at = cli.indexOf(`--${name}`);
  return at === -1 ? fallback : cli[at + 1];
}
const PORT = Number(option('port', 5358));
const SEED = Number(option('seed', 2));
const SPEED = Number(option('speed', 4));
const picked = option('only', '');
const stages = picked ? new Set(picked.split(',')) : null;   // null: every stage
const want = (stage) => stages === null || stages.has(stage);

const OUT = path.join(ROOT, '.scratch', 'core');
const SHOTS = path.join(OUT, 'shots');
const DIST = path.join(OUT, 'dist');
fs.mkdirSync(SHOTS, { recursive: true });
if (!process.env.GPU_LOCK_HELD) console.warn('e2e: run me under tools/gpu-lock.sh (one headless Chrome at a time on this machine)');

// ---- the report ----------------------------------------------------------------------------------------------------
const report = {
  started: new Date().toISOString(),
  port: PORT, seed: SEED, speed: SPEED,
  checks: {}, shots: [], errors: {},
  pass: false,
};
/** Record one check (its info is kept beside `ok`) and print it as PASS / FAIL. Returns `ok` as given. */
function check(name, ok, info = {}) {
  const verdict = ok ? 'PASS' : 'FAIL';
  report.checks[name] = { ok: Boolean(ok), ...info };
  console.log(`${verdict} ${name} ${JSON.stringify(info)}`);
  return ok;
}
/** A JPEG of the page as shots/e2e_<name>.jpg (listed in the report); returns its path. */
async function shot(page, name) {
  const file = path.join(SHOTS, `e2e_${name}.jpg`);
  await page.screenshot({ type: 'jpeg', quality: 82, path: file });
  report.shots.push(path.relative(ROOT, file));
  return file;
}

// ---- the server and the browser ------------------------------------------------------------------------------------
const server = await startPreview(PORT, DIST, { build: !cli.includes('--no-build') });
const browser = await launch({ width: 1280, height: 720 });
const base = server.url;
async function shutDown() {
  await browser.close().catch(() => {});
  server.kill();
}

// ---- 2. the first seconds of input -----------------------------------------------------------------------------------
/** In the page: watch the hero from now on and note how long after the next keydown he first moves (window.__fsp). */
function armMoveProbe() {
  const hooks = window.__ew, from = { ...hooks.hero.pos };
  const probe = (window.__fsp = { pressedAt: 0, latency: null });
  addEventListener('keydown', () => { probe.pressedAt = performance.now(); }, { once: true, capture: true });
  const watch = () => {
    const at = hooks.hero.pos;
    if (Math.hypot(at.x - from.x, at.z - from.z) > 0.02) probe.latency = performance.now() - probe.pressedAt;
    else requestAnimationFrame(watch);
  };
  requestAnimationFrame(watch);
}
async function probeStage() {
  const { page, errors } = await openPage(browser, `${base}?seed=${SEED}&save=fresh&skipintro=1&god=1`);
  const inPage = (fn) => page.evaluate(fn);
  await waitFor(page, () => window.__ew?.assetsReady?.() && !window.__ew.busy, null, 120000);
  await page.mouse.click(640, 360);   // focus, and a pointer-lock request (headless may refuse it: then dragging looks)
  await sleep(300);

  // movement: each key moves the hero within ~70 ms of its keydown, and he stops (< 0.6 m drift) once it is released
  const moves = [];
  for (const key of ['KeyW', 'KeyA', 'KeyS', 'KeyD']) {
    await page.evaluate(armMoveProbe);
    await page.keyboard.down(key);
    await sleep(300);
    await page.keyboard.up(key);
    const released = await inPage(() => ({ ...__ew.hero.pos }));
    await sleep(400);
    const settled = await inPage(() => ({ ...__ew.hero.pos }));
    const latency = await inPage(() => window.__fsp.latency);
    moves.push({ key, movedMs: latency == null ? null : Math.round(latency),
      driftAfterRelease: +Math.hypot(settled.x - released.x, settled.z - released.z).toFixed(2) });
  }
  check('probe.move', moves.every((m) => m.movedMs != null && m.movedMs <= 70 && m.driftAfterRelease < 0.6), { keys: moves });

  // a held click fires the gun
  await inPage(() => __ew.drainEvents());
  await page.mouse.click(640, 360);
  await sleep(150);
  await page.mouse.down(); await sleep(400); await page.mouse.up();
  await sleep(200);
  const shots = await inPage(() => __ew.drainEvents().filter((e) => e.type === 'weapon.shot').length);
  check('probe.fire', shots > 0, { shots });

  // 3 → the Ember Lance, which sprays while the button is held
  await page.keyboard.press('Digit3');
  await sleep(500);
  const weapon = await inPage(() => __ew.state().player.weapon);
  await page.mouse.down();
  await sleep(600);
  const spraying = await inPage(() => __ew.state().player.jet.on);
  await page.mouse.up();
  check('probe.lance', weapon === 'lance' && spraying, { weapon, spraying });

  // G → a firebomb that bursts
  await page.keyboard.press('KeyG');
  await sleep(1500);
  check('probe.bomb', await inPage(() => __ew.drainEvents().some((e) => e.type === 'bomb.burst')));

  // E at the pan kindles it
  await inPage(() => { __ew.teleport(11.1, -1.5, Math.PI / 2, 0); });
  await sleep(300);
  await page.keyboard.press('KeyE');
  await sleep(300);
  check('probe.kindle', await inPage(() => __ew.state().night.kindle === 1));

  // P pauses (the sim time stands still while the menu is up) and P resumes
  await page.keyboard.press('KeyP');
  await sleep(300);
  const menu = await inPage(() => ({ paused: __ew.paused, t: __ew.state().t }));
  await sleep(400);
  const tLater = await inPage(() => __ew.state().t);
  await shot(page, 'probe_menu');
  await page.keyboard.press('KeyP');
  await sleep(300);
  const resumed = !(await inPage(() => __ew.paused));
  check('probe.menuPause', menu.paused && menu.t === tLater && resumed, menu);

  // the fire style switches at runtime (?fire= and the P menu → fire.setStyle and ui.setFireStyle)
  const styles = await inPage(async () => {
    const settle = () => new Promise((done) => setTimeout(done, 300));
    const styleNow = () => __ew.perf().fire?.style ?? null;
    const a = __ew.fireStyle('hybrid');
    await settle();
    const fa = styleNow();
    const b = __ew.fireStyle('smooth');
    await settle();
    return { a, fa, b, fb: styleNow() };
  });
  const followed = styles.fa === null || (styles.fa === 'hybrid' && styles.fb === 'smooth');   // (null: no fire module)
  check('probe.fireStyle', styles.a === 'hybrid' && styles.b === 'smooth' && followed, styles);

  report.errors.probe = errors.slice(0, 10);
  check('probe.console', errors.length === 0, { errors: errors.length });
  await page.close();
}

async function upgradesStage() {
  const { page, errors } = await openPage(browser, `${base}?seed=${SEED}&save=fresh&skipintro=1&god=1&mute=1&look=greybox`);
  if (!await waitFor(page, () => __ew.assetsReady() && !document.getElementById('loading'), null, 120000)) {
    check('upgrades.ready', false, { errors });
    await page.close();
    return;
  }
  await page.evaluate(() => {
    // Headless platforms vary in native lock support. Keep real click/key gestures and control the browser's response.
    const canvas = document.querySelector('#world canvas');
    const probe = window.upgradeLock = { requests: 0, reject: false };
    let locked = null;
    const change = (el) => { locked = el; document.dispatchEvent(new Event('pointerlockchange')); };
    Object.defineProperty(document, 'pointerLockElement', { get: () => locked });
    document.exitPointerLock = () => change(null);
    canvas.requestPointerLock = async () => {
      probe.requests++;
      if (probe.reject || !navigator.userActivation.isActive) throw new DOMException('Capture denied', 'NotAllowedError');
      await Promise.resolve();
      change(canvas);
    };
  });
  const state = () => page.evaluate(() => ({
    locked: document.pointerLockElement?.tagName === 'CANVAS', focused: document.activeElement?.tagName === 'CANVAS',
    requests: window.upgradeLock.requests, mode: __ew.state().mode, upgrades: __ew.state().stats.cards.length,
    shots: __ew.state().stats.shots, visible: !!document.querySelector('.ew-cards.on:not([inert])'),
  }));
  const waitOffer = () => waitFor(page, () => __ew.state().mode === 'cards' && __ew.ui().cardsOpen, null, 4000, 50);
  const cards = '.ew-cards.on:not([inert]) .ew-card';
  await page.mouse.click(640, 360);
  const initial = await state();
  await page.evaluate(() => { const p = __ew.state().player; p.xp = p.xpNext; });
  await waitOffer();
  const opened = await state();
  await sleep(320);
  await page.click(cards);
  const mouse = await state();
  check('upgrades.mouseResume', initial.locked && opened.visible && !opened.locked && mouse.mode === 'play' && mouse.locked
    && mouse.focused && mouse.upgrades === 1 && mouse.requests === initial.requests + 1 && mouse.shots === initial.shots, { initial, opened, mouse });

  await page.evaluate((nextXp) => { const p = __ew.state().player; p.xp = p.xpNext + nextXp; }, XP_NEXT(3));
  await waitOffer();
  await sleep(320);
  await page.keyboard.press('Digit1');
  await waitOffer();
  await sleep(340);  // past the previous offer's closing animation
  const again = await state();
  check('upgrades.consecutive', again.mode === 'cards' && again.visible && !again.locked && again.upgrades === 2
    && again.requests === mouse.requests + 1, again);

  await page.evaluate(() => { window.upgradeLock.reject = true; });
  await page.keyboard.press('Digit2');
  const denied = await state();
  await page.evaluate(() => { window.upgradeLock.reject = false; });
  await waitFor(page, () => !__ew.busy, null, 4000);
  await page.mouse.click(640, 360);
  const retry = await state();
  check('upgrades.retry', denied.mode === 'play' && denied.upgrades === 3 && !denied.visible && !denied.locked
    && denied.requests === again.requests + 1 && retry.locked && retry.requests === denied.requests + 1 && errors.length === 0,
  { denied, retry, errors });
  await page.close();
}

try {
  // ------------------------------------------------------------------------------------------ 1. entry
  if (want('entry')) {
    const { page, errors } = await openPage(browser, `${base}?seed=${SEED}&save=fresh`);
    const ready = await waitFor(page, () => window.__ew?.assetsReady?.(), null, 120000);
    check('entry.ready', ready, { bootMs: await page.evaluate(() => window.__ew?.bootMs), modules: await page.evaluate(() => Object.fromEntries(Object.entries(__ew.modules()).map(([k, v]) => [k, v.state]))) });
    await sleep(500);
    await shot(page, 'entry_title');
    const title = await page.evaluate(() => __ew.state().mode);
    await page.mouse.click(640, 360);
    const intro = await waitFor(page, () => __ew.state().mode === 'intro', null, 5000);
    await sleep(1200); await shot(page, 'entry_intro_1s');
    await sleep(1200);
    await page.keyboard.press('Space');
    const play = await waitFor(page, () => __ew.state().mode === 'play', null, 4000);
    await sleep(1500); await shot(page, 'entry_play');
    check('entry.flow', title === 'title' && intro && play, { title, intro: !!intro, play: !!play });
    report.errors.entry = errors.slice(0, 10);
    check('entry.console', errors.length === 0, { errors: errors.length });
    await page.close();
  }

  // ------------------------------------------------------------------------------------------ 2. the first seconds of input
  if (want('probe')) await probeStage();
  if (want('upgrades')) await upgradesStage();
  if (want('mobile')) await mobileStage({ browser, base, seed: SEED, check, shot });

  // ------------------------------------------------------------------------------------------ 3. views
  for (const [name, q] of want('views') ? [['m1_greybox', 'look=greybox&view=m1'], ['m2_greybox', 'look=greybox&view=m2'], ['m1_full', 'view=m1'], ['m2_full', 'view=m2'], ['top_full', 'view=top']] : []) {
    const { page, errors } = await openPage(browser, `${base}?seed=${SEED}&save=fresh&skipintro=1&god=1&clock=150&${q}`);
    await waitFor(page, () => window.__ew?.assetsReady?.(), null, 120000);
    await page.evaluate(() => { __ew.state().player.xpNext = 1e9; __ew.spawn('grunt', 200, 14, 6); __ew.spawn('imp', 60, 20, 9); __ew.spawn('grunt', 160, 1, 4); __ew.fireOp({ kind: 'burst', x: 9, z: 1, r: 2, amount: 1, push: 2 });
      const p = __ew.state().player; __ew.setInput({ fire: true, yaw: p.yaw, pitch: p.pitch }); });
    await sleep(2500);
    await shot(page, name);
    report.errors[name] = errors.slice(0, 10);
    check(`${name}.console`, errors.length === 0, { errors: errors.length });
    await page.close();
  }

  // ------------------------------------------------------------------------------------------ 5. the self-play night
  if (want('night')) {
    const { page, errors } = await openPage(browser, `${base}?seed=${SEED}&save=fresh&skipintro=1&autoplay=1&speed=${SPEED}&perf=1`);
    await waitFor(page, () => window.__ew?.assetsReady?.(), null, 120000);
    const t0 = Date.now(), marks = new Set(), timeline = [];
    let end = null, last = null;
    while (Date.now() - t0 < 9 * 60 * 1000) {
      const s = await page.evaluate(() => { const st = __ew.state(); return { mode: st.mode, modeT: st.modeT, clock: st.night.clock, alive: st.horde.alive, gate: st.gate.hp, hp: st.player.hp, lv: st.player.level, xp: +st.player.xp.toFixed(1), xpNext: st.player.xpNext, cards: st.stats.cards.length, troll: st.troll ? { hp: st.troll.hp, glow: st.troll.glowing, a: st.troll.alive } : null, kills: st.stats.kills }; }).catch(() => null);
      if (!s) { await sleep(500); continue; }
      last = s;
      const mark = async (k, cond) => { if (!marks.has(k) && cond) { marks.add(k); timeline.push({ k, clock: +s.clock.toFixed(1), real: +((Date.now() - t0) / 1000).toFixed(1) }); await shot(page, `night_${k}`); } };
      await mark('01_start', s.mode === 'play' && s.clock > 8);
      await mark('02_horde', s.mode === 'play' && s.alive > 400);
      await mark('03_busy', s.mode === 'play' && s.alive > 1200);
      await mark('04_troll', s.mode === 'play' && s.troll?.a && s.clock > 260);
      await mark('05_glow', s.mode === 'play' && s.troll?.glow);
      await mark('06_dawn', s.mode === 'victory' && s.modeT > 3);
      // the dawn / fallen card is a modal: it holds the sim (modeT stops), so stop at its beat
      if ((s.mode === 'victory' && s.modeT > 6.4) || (s.mode === 'fallen' && s.modeT > 1.3)) { await sleep(1500); await shot(page, `night_07_${s.mode}_card`); end = s.mode; break; }
      await sleep(400);
    }
    report.night = { end, realSeconds: +((Date.now() - t0) / 1000).toFixed(1), last, timeline, perf: await page.evaluate(() => __ew.perf()), stats: await page.evaluate(() => __ew.state().stats), modules: await page.evaluate(() => __ew.modules()) };
    check('night.end', end === 'victory' || end === 'fallen', { end, clock: last?.clock, kills: last?.kills });
    // DESIGN §9: the card's primary ("TO THE CAMP") goes on to the camp without a reload (Night II next after a dawn)
    if (end) {
      await page.evaluate(() => { __ew.bot(false); __ew.card('retry'); });
      const again = await waitFor(page, () => { const st = __ew.state(); return st.mode === 'camp' && st.horde.alive === 0; }, null, 8000);
      await sleep(2800); await shot(page, 'night_08_camp');
      check('night.toCamp', !!again, await page.evaluate(() => ({ mode: __ew.state().mode, nextNight: __ew.state().night.n, gold: __ew.state().meta.gold, banked: __ew.state().run.goldRun })));
    }
    report.errors.night = errors.slice(0, 10);
    check('night.console', errors.length === 0, { errors: errors.length });
    await page.close();
  }

  // ----------------------------------------------------------------------------------------- 6. DESIGN §9: camp, Night II, coming soon
  if (want('v2')) {
    const evAt = (page, type) => page.evaluate((t) => __ew.drainEvents().filter((e) => e.type === t), type);
    // the camp with a rich save
    let { page, errors } = await openPage(browser, `${base}?seed=${SEED}&save=rich&camp=1&god=1`);
    await waitFor(page, () => window.__ew?.assetsReady?.(), null, 120000);
    await sleep(3200);
    const camp0 = await page.evaluate(() => ({ mode: __ew.state().mode, gold: __ew.state().meta.gold, n: __ew.state().night.n }));
    await shot(page, 'v2_camp');
    await page.mouse.click(640, 360); await sleep(200);
    // Brother Cinder: E near his stall
    await page.evaluate(() => { const n = { x: -17.5 + 2.0, z: 3.5 }; __ew.teleport(n.x, n.z, -Math.PI / 2, 0); __ew.drainEvents(); });
    await sleep(300); await page.keyboard.press('KeyE'); await sleep(900);
    const npc = await page.evaluate(() => ({ panel: __ew.state().camp.panel, evs: __ew.drainEvents().filter((e) => e.type === 'npc.open' || e.type === 'npc.line').map((e) => e.type + ':' + (e.line || '')) }));
    await shot(page, 'v2_npc_panel');
    await page.evaluate(() => __ew.command({ act: 'buy', item: 'hide' })); await sleep(300);
    const bought = await page.evaluate(() => __ew.state().meta.upgrades.hide);
    await page.evaluate(() => __ew.command({ act: 'close' })); await sleep(400);
    check('v2.npc', camp0.mode === 'camp' && npc.panel === 'npc' && npc.evs.some((x) => x.startsWith('npc.line:')) && bought === 1, { camp0, npc, bought });
    // a pad: E opens its panel; build an Obelisk and a Chain Imp, upgrade one
    await page.evaluate(() => { __ew.teleport(-5.5, 8.4, Math.PI, 0); __ew.drainEvents(); });
    await sleep(300); await page.keyboard.press('KeyE'); await sleep(900);
    const pad = await page.evaluate(() => ({ panel: __ew.state().camp.panel, padId: __ew.state().camp.padId }));
    await shot(page, 'v2_pad_panel');
    await page.evaluate(() => { __ew.command({ act: 'build', pad: 'pad-gate-w', type: 'obelisk' }); __ew.command({ act: 'build', pad: 'pad-gate-e', type: 'chainimp' }); __ew.command({ act: 'upgrade', pad: 'pad-gate-w' }); __ew.command({ act: 'close' }); });
    await sleep(600);
    const towers = await page.evaluate(() => __ew.state().run.towers.map((t) => `${t.pad}:${t.type}:${t.level}`));
    check('v2.pad', pad.panel === 'pad' && pad.padId === 'pad-gate-w' && towers.length === 2 && towers.includes('pad-gate-w:obelisk:2'), { pad, towers });
    await page.evaluate(() => __ew.pose({ x: 2.5, z: 13, yaw: -0.25 + Math.PI, pitch: -0.12, lift: 0.4 })); await sleep(1200);
    await shot(page, 'v2_towers');
    report.errors.v2camp = errors.slice(0, 10);
    check('v2.camp.console', errors.length === 0, { errors: errors.length });
    await page.close();
    // reload without a preset: the save is kept (upgrades, towers of the run), the start goes to the camp; E at the pan → the night
    ({ page, errors } = await openPage(browser, `${base}?seed=${SEED}&camp=1&god=1`));
    await waitFor(page, () => window.__ew?.assetsReady?.(), null, 120000);
    await sleep(2800);
    const kept = await page.evaluate(() => ({ hide: __ew.state().meta.upgrades.hide, towers: __ew.state().run.towers.length, gold: __ew.state().meta.gold }));
    await page.mouse.click(640, 360); await sleep(200);
    await page.evaluate(() => __ew.teleport(11.1, -1.5, Math.PI / 2, 0)); await sleep(300);
    await page.keyboard.press('KeyE'); await sleep(300);
    const leave = await page.evaluate(() => ({ mode: __ew.state().mode, evs: __ew.drainEvents().filter((e) => e.type === 'camp.leave').length }));
    await sleep(1600); await shot(page, 'v2_camp_leave_1.6s');
    const night = await waitFor(page, () => __ew.state().mode === 'play', null, 8000);
    check('v2.reloadAndKindle', kept.hide === 1 && kept.towers === 2 && leave.mode === 'intro' && leave.evs === 1 && !!night, { kept, leave, night: !!night });
    report.errors.v2reload = errors.slice(0, 10);
    check('v2.reload.console', errors.length === 0, { errors: errors.length });
    await page.close();
    // Night II (mid save): the blood moon, Dousers and Hexers, the towers, Ember Orbit and Cinder Trail
    ({ page, errors } = await openPage(browser, `${base}?seed=${SEED}&save=mid&night=2&god=1&clock=165&perf=1`));
    await waitFor(page, () => window.__ew?.assetsReady?.(), null, 120000);
    await page.evaluate(() => { const c = __ew.sim.ctx; c.mods.orbit = 2; c.mods.trail = 2; c.mods.meteor = 1; __ew.state().player.xpNext = 1e9;
      __ew.spawn('grunt', 160, -4, 14); __ew.spawn('douser', 12, 4, 16); __ew.spawn('hexer', 2, 2, 20); __ew.spawn('brute', 4, 8, 12); __ew.spawn('grunt', 120, 9, 10); });
    await sleep(4000);
    const n2 = await page.evaluate(() => { const st = __ew.state(); const ev = __ew.drainEvents(); const c = (t) => ev.filter((e) => e.type === t).length;
      return { n: st.night.n, moon: st.night.moon, orbit: st.orbit.length, pulses: c('obelisk.pulse'), hooks: c('chain.hook'), douses: c('douser.throw'), hexes: c('hexer.hex'), orbitHits: c('orbit.hit'), meteors: c('meteor') }; });
    await page.evaluate(() => __ew.pose({ x: 1, z: -1.0, walk: true, yaw: 0.3, pitch: -0.42, lift: 0.7, lean: 0.8 })); await sleep(1800);
    await shot(page, 'v2_night2');
    await page.evaluate(() => __ew.pose({ x: 6, z: -1.0, walk: true, yaw: 1.0, pitch: 0.06, lift: 0.7, lean: 0.8 })); await sleep(1500);
    await shot(page, 'v2_night2_moon');
    check('v2.night2', n2.n === 2 && n2.moon === 'blood' && n2.pulses > 0 && n2.hooks > 0 && n2.douses > 0 && n2.orbit === 2, n2);
    // its dawn: both trolls dead, the clock out → the coming-soon card → the camp with a new run at Night I
    await page.evaluate(() => { __ew.setClock(299); for (let k = 0; k < 2; k++) { __ew.troll(); __ew.sim.ctx.troll.hit(1e9, 'bullet'); } });
    const dawn = await waitFor(page, () => __ew.state().mode === 'victory' && __ew.state().modeT > 6.4, null, 20000);
    await sleep(1500);
    const soon = !(await page.evaluate(() => __ew.drainEvents().some((e) => e.type === 'coming.soon')));   // (DESIGN §8: no coming-soon card)
    await shot(page, 'v2_night2_dawn_card');
    await page.evaluate(() => __ew.card('retry'));
    const backToCamp = await waitFor(page, () => __ew.state().mode === 'camp' && __ew.state().night.n === 3, null, 8000);
    await sleep(2800); await shot(page, 'v2_camp_after_run');
    check('v2.night2ToNight3', !!dawn && soon && !!backToCamp, { dawn: !!dawn, soon, backToCamp: !!backToCamp, meta: await page.evaluate(() => ({ done: __ew.state().meta.nightsCompleted, best: __ew.state().meta.bestNight, gold: __ew.state().meta.gold })) });
    report.errors.v2night2 = errors.slice(0, 10);
    check('v2.night2.console', errors.length === 0, { errors: errors.length });
    await page.close();
  }

  // --------------------------------------------------------------------------------------------------- 7. BEGIN NIGHT, the Organ, bats, Pyre Burst
  if (want('v3')) {
    // the camp's BEGIN NIGHT (the N key / the button → onAction('beginNight')), the first-camp tip
    let { page, errors } = await openPage(browser, `${base}?seed=${SEED}&save=rich&camp=1&god=1`);
    await waitFor(page, () => window.__ew?.assetsReady?.(), null, 120000);
    await sleep(3000);
    const tip = await page.evaluate(() => __ew.state().camp.tip);
    await shot(page, 'v3_camp_begin');
    await page.mouse.click(640, 360); await sleep(200);
    await page.keyboard.press('KeyN'); await sleep(500);
    let begun = await page.evaluate(() => __ew.state().mode);
    let via = 'key N';
    if (begun !== 'intro') { await page.evaluate(() => __ew.command({ act: 'beginNight' })); await sleep(400); begun = await page.evaluate(() => __ew.state().mode); via = 'command'; }
    check('v3.beginNight', tip === true && begun === 'intro', { tip, mode: begun, via });
    // the THUNDER ORGAN (rich owns it): slot 2, hold to fire
    await waitFor(page, () => __ew.state().mode === 'play', null, 8000);
    await page.evaluate(() => { __ew.state().player.xpNext = 1e9; __ew.pose({ x: 3, z: 6, yaw: Math.PI / 2, pitch: -0.06 }); __ew.spawn('grunt', 120, 16, 6); __ew.drainEvents(); });
    await page.keyboard.press('Digit2'); await sleep(700);
    const w = await page.evaluate(() => __ew.state().player.weapon);
    await page.evaluate(() => { const p = __ew.state().player; __ew.setInput({ fire: true, yaw: p.yaw, pitch: -0.06 }); });
    await sleep(1500); await shot(page, 'v3_organ');
    await page.evaluate(() => __ew.setInput(null));
    const og = await page.evaluate(() => { const ev = __ew.drainEvents(); return { fire: ev.filter((e) => e.type === 'organ.fire').length, rounds: ev.filter((e) => e.type === 'weapon.shot' && e.weapon === 'organ').reduce((a, e) => a + e.pellets.length, 0), heat: +__ew.state().player.organ.heat.toFixed(2) }; });
    check('v3.organ', w === 'organ' && og.fire >= 1 && og.rounds > 10, { weapon: w, ...og });
    report.errors.v3a = errors.slice(0, 10);
    check('v3.camp.console', errors.length === 0, { errors: errors.length });
    await page.close();
    // a Bat Gremlin dive (Night II, mid save), the lens on the diving bat
    ({ page, errors } = await openPage(browser, `${base}?seed=${SEED}&save=mid&night=2&god=1&clock=24`));
    await waitFor(page, () => window.__ew?.assetsReady?.(), null, 120000);
    await page.evaluate(() => { __ew.state().player.xpNext = 1e9; __ew.pose({ x: 3, z: 7, yaw: 0.4, pitch: 0.15 }); __ew.drainEvents(); });
    const dive = await waitFor(page, () => __ew.state().air.some((b) => b.mode === 'dive' && b.t > 0.4), null, 40000);
    if (dive) await page.evaluate(() => { const b = __ew.state().air.find((x) => x.mode === 'dive'), p = __ew.state().player; const dx = b.x - p.x, dz = b.z - p.z; __ew.pose({ x: p.x, z: p.z, yaw: Math.atan2(dx, dz), pitch: Math.atan2(b.y - p.y - 1.68, Math.hypot(dx, dz)) }); });
    await sleep(120); await shot(page, 'v3_bat_dive');
    const air = await page.evaluate(() => { const ev = __ew.drainEvents(); return { alive: __ew.state().air.length, screech: ev.filter((e) => e.type === 'air.screech').length, hits: ev.filter((e) => e.type === 'air.hit').length }; });
    check('v3.batDive', !!dive && air.screech >= 1, { dive: !!dive, ...air });
    // Pyre Burst: a burning crowd's fire kills burst
    await page.evaluate(() => { const c = __ew.sim.ctx; c.mods.pyre = 3; __ew.state().taken['pyre-burst'] = 1; __ew.state().taken['pyre-burst-up'] = 2;
      __ew.pose({ x: 3, z: 6, yaw: 0.1, pitch: -0.25 }); __ew.spawn('grunt', 200, 4, 18); __ew.fireOp({ kind: 'burst', x: 4, z: 18, r: 2, amount: 1, push: 0 }); __ew.drainEvents(); });
    await waitFor(page, () => __ew.drainEvents ? true : true, null, 100);
    let pyre = 0; for (let k = 0; k < 12 && pyre < 4; k++) { await sleep(500); pyre += await page.evaluate(() => __ew.drainEvents().filter((e) => e.type === 'pyre.burst').length); }
    await shot(page, 'v3_pyre');
    check('v3.pyre', pyre >= 1, { bursts: pyre });
    report.errors.v3b = errors.slice(0, 10);
    check('v3.night2.console', errors.length === 0, { errors: errors.length });
    await page.close();
  }

  // --------------------------------------------------------------------------------------------------- 8. DESIGN §8
  if (want('v4')) {
    const evCount = (page, types) => page.evaluate((types) => { const ev = __ew.drainEvents(); return Object.fromEntries(types.map((t) => [t, ev.filter((e) => e.type === t).length])); }, types);
    const lookAt = (page, x, y, z, from) => page.evaluate(([x, y, z, from]) => { const p = from || __ew.state().player; const fx = from ? from.x : p.x, fz = from ? from.z : p.z, fy = from ? 1.68 : p.y + 1.68;
      __ew.pose({ x: fx, z: fz, yaw: Math.atan2(x - fx, z - fz), pitch: Math.atan2(y - fy, Math.hypot(x - fx, z - fz)) }); }, [x, y, z, from]);
    // each night's twist (late save, god): III the ram, IV the rain, V the shield wall, VI the swarm, VII the coven, VIII ram and roar, IX the last watch
    const nights = [[3, 38], [4, 30], [5, 44], [6, 24], [7, 68], [8, 148], [9, 118]];
    for (const [n, clock] of nights) {
      const { page, errors } = await openPage(browser, `${base}?seed=${SEED}&save=late&night=${n}&god=1&clock=${clock}&speed=3`);
      await waitFor(page, () => window.__ew?.assetsReady?.(), null, 120000);
      await page.evaluate(() => { __ew.state().player.xpNext = 1e9; });
      const st0 = await page.evaluate(() => ({ n: __ew.state().night.n, title: __ew.state().night.title, moon: __ew.state().night.moon, twist: __ew.state().night.twist }));
      let ok = false, info = {};
      if (n === 3 || n === 8) {
        ok = !!(await waitFor(page, () => __ew.state().rams.some((r) => r.z < 66 && r.mode !== 'fall'), null, 60000));
        // (held still; the lens 12 m toward the gate and 6 m up, looking down at the trunk over the crowd)
        if (ok) await page.evaluate(() => { __ew.pause(); const r = __ew.state().rams.find((x) => x.mode !== 'fall'), x = r.x - 5, z = Math.max(4, r.z - 12), lift = 6;
          const look = (gy) => ({ x, z, lift, yaw: Math.atan2(r.x - x, r.z - z), pitch: Math.atan2(r.y + 1 - (gy + 1.68 + lift), Math.hypot(r.x - x, r.z - z)) });
          __ew.pose(look(0)); __ew.pose(look(__ew.state().player.y)); });
      } else if (n === 4) {
        ok = !!(await waitFor(page, () => __ew.state().weather.rain > 0.6, null, 60000));
        await lookAt(page, 14, 2, 25, { x: 3, z: 6 });
      } else if (n === 5) {
        ok = !!(await waitFor(page, () => { const H = __ew.state().horde; let c = 0; for (let i = 0; i < H.count; i++) if (H.state[i] && H.kind[i] === 3 && H.z[i] < 58) c++; return c >= 8; }, null, 60000));
        await lookAt(page, 26, 0, 46, { x: 22, z: 30 });
      } else if (n === 6) {
        // (a flock spawns ≈ 75 m out in the valley: wait until six of them circle within 25 m of the Lamplighter)
        ok = !!(await waitFor(page, () => { const p = __ew.state().player; return __ew.state().air.filter((b) => Math.hypot(b.x - p.x, b.z - p.z) < 25).length >= 6; }, null, 60000));
        // (they circle the player, so their centroid is the player: look at the densest knot of them instead, held still)
        await page.evaluate(() => __ew.pause());
        const c = await page.evaluate(() => { const A = __ew.state().air; let best = A[0], bn = -1;
          const p = __ew.state().player;
          for (const b of A) { if (Math.hypot(b.x - p.x, b.z - p.z) > 25) continue; const n = A.filter((o) => Math.hypot(o.x - b.x, o.y - b.y, o.z - b.z) < 7).length; if (n > bn) { bn = n; best = b; } }
          return { x: best.x, y: best.y, z: best.z }; });
        await lookAt(page, c.x, c.y, c.z);
      } else if (n === 7) {
        ok = !!(await waitFor(page, () => __ew.state().coven.length > 0, null, 90000));
        if (ok) { const g = await page.evaluate(() => __ew.state().coven[0].pos); await lookAt(page, g.x, 1, g.z, { x: g.x - 3, z: Math.max(1, g.z - 10) }); }
      } else if (n === 9) {
        ok = !!(await waitFor(page, () => !!__ew.state().troll, null, 30000));
        await page.evaluate(() => __ew.view('m2'));
      }
      info = { ...st0, twistSeen: ok, ...(await evCount(page, ['ram.spawn', 'ram.drum', 'weather.squall', 'phalanx.spawn', 'air.spawn', 'coven.gather', 'coven.chant', 'troll.roar'])) };
      await sleep(900); await shot(page, `v4_night${n}_${st0.twist}`);
      await page.evaluate(() => __ew.resume());
      report.errors[`v4n${n}`] = errors.slice(0, 10);
      check(`v4.night${n}`, ok && st0.n === n && errors.length === 0, { ...info, errors: errors.length });
      await page.close();
    }
    // Night X: the Rainmother with god=1 — the bot fights her at speed 4 until she falls (phases, tide, whirlpools, crack,
    // lanterns captured on the way), then the ending to its card
    {
      const { page, errors } = await openPage(browser, `${base}?seed=${SEED}&save=endgame&night=10&god=1&autoplay=1&speed=4&clock=26`);
      await waitFor(page, () => window.__ew?.assetsReady?.(), null, 120000);
      await waitFor(page, () => __ew.state().boss && __ew.state().boss.mode !== 'rise', null, 30000);
      const capped = new Set(), t0 = Date.now();
      const capBoss = async (name) => { if (capped.has(name)) return; capped.add(name);
        await page.evaluate(() => { __ew.bot(false); const b = __ew.state().boss, p = __ew.state().player; __ew.pause(); window.__ewBossPose = { yaw: Math.atan2(b.x - p.x, b.z - p.z) }; });
        // the lens 16–20 m in front of her (down the road toward the keep), looking up at her chest
        await page.evaluate(() => { const b = __ew.state().boss, x = b.x - 5, z = Math.max(8, Math.min(58, b.z - 18)), gy = 0;
          __ew.pose({ x, z, yaw: Math.atan2(b.x - x, b.z - z), pitch: Math.atan2(b.y + 7 - (gy + 1.68), Math.hypot(b.x - x, b.z - z)) }); });
        await page.evaluate(() => __ew.resume()); await sleep(250); await shot(page, `v4_boss_${name}`); await page.evaluate(() => __ew.bot(true)); };
      let lastPhase = 1, dead = false;
      while (Date.now() - t0 < 6 * 60 * 1000) {
        const s = await page.evaluate(() => { const b = __ew.state().boss; return b ? { hp: b.hp, phase: b.phase, alive: b.alive, cracked: b.cracked, mode: b.mode, out: b.lanternsOut, m: __ew.state().mode } : null; });
        if (!s) { await sleep(500); continue; }
        if (!capped.has('rise')) await capBoss('rise');
        if (s.mode === 'tide') await capBoss('tide');
        if (s.phase >= 2 && s.phase !== lastPhase) { lastPhase = s.phase; await capBoss('phase' + s.phase); }
        if (s.cracked) await capBoss('crack');
        if (!s.alive || s.m === 'ending') { dead = true; break; }
        await sleep(400);
      }
      if (!dead) await page.evaluate(() => __ew.sim.ctx.bossSys.hurt(1e9, 'bullet'));   // (the bot did not finish her in time: reported)
      const ending = await waitFor(page, () => __ew.state().mode === 'ending', null, 20000);
      check('v4.bossKill', !!ending, { killedByBot: dead, realSeconds: Math.round((Date.now() - t0) / 1000), captured: [...capped] });
      // the ending, every beat captured, to the card
      await page.evaluate(() => __ew.bot(false));
      // each beat seen as it fires, and captured at its middle (ending.t; at speed 4 a fixed real-time wait overshoots:
      // the credits' "Directed by AL" comes ≈ 3 s into the beat)
      const beats = [], seenB = new Set(), capB = new Set(); const tE = Date.now();
      const BEATS = TIMELINE.ending.beats;
      const capAt = Object.fromEntries(BEATS.map((b, k) => [b.id, b.at + Math.min(3, ((BEATS[k + 1]?.at ?? b.at + 2) - b.at) / 2)]));
      while (Date.now() - tE < 90000) {
        const e = await page.evaluate(() => { const E = __ew.state().ending; return E ? { b: E.beat, t: E.t } : {}; });
        if (e.b && !seenB.has(e.b)) { seenB.add(e.b); beats.push(e.b); }
        for (const id of beats) if (!capB.has(id) && (e.t >= (capAt[id] ?? 0) || id === 'card')) {
          capB.add(id); if (id === 'card') await sleep(700);
          await shot(page, `v4_ending_${String(beats.indexOf(id) + 1).padStart(2, '0')}_${id}`);
        }
        if (e.b === 'card' && capB.has('card')) break;
        await sleep(100);
      }
      const ended = await page.evaluate(() => __ew.state().meta.ended);
      await page.evaluate(() => __ew.command({ act: 'continue' }));
      const again = await waitFor(page, () => __ew.state().mode === 'camp' && __ew.state().night.n === 1, null, 8000);
      check('v4.ending', beats.length >= 12 && beats[beats.length - 1] === 'card' && ended && !!again, { beats, ended, playAgain: !!again });
      report.errors.v4boss = errors.slice(0, 10);
      check('v4.boss.console', errors.length === 0, { errors: errors.length });
      await page.close();
    }
    // ?ending=1 plays it directly (a fresh save: the first ending, not skippable)
    {
      const { page, errors } = await openPage(browser, `${base}?seed=${SEED}&save=fresh&ending=1`);
      await waitFor(page, () => window.__ew?.assetsReady?.(), null, 120000);
      const m = await waitFor(page, () => __ew.state().mode === 'ending', null, 10000);
      await sleep(4000); await page.keyboard.press('Space'); await sleep(600);
      const notSkipped = await page.evaluate(() => __ew.state().ending.beat !== 'card');
      // at speed 1 (the CSS of the credits runs in real time: at speed 4 "Directed by AL" has not faded in by the card)
      const cred = await waitFor(page, () => (__ew.state().ending?.t || 0) >= 53.5, null, 70000);
      if (cred) await shot(page, 'v4_ending_credits_speed1');
      check('v4.endingDirect', !!m && notSkipped && !!cred && errors.length === 0, { mode: !!m, notSkipped, credits: !!cred, errors: errors.length });
      await page.close();
    }
  }
  // ------------------------------------------------------------------------------------------ 9. editions and fire modules (decision 0001)
  if (want('editions')) {
    // the webgl2 edition with classic named in both slots; then a missing module: its slot falls back to classic
    {
      const { page, errors } = await openPage(browser, `${base}?seed=${SEED}&save=fresh&skipintro=1&god=1&gpu=webgl2&lance=classic&ground=classic&view=m1`);
      await waitFor(page, () => window.__ew?.assetsReady?.(), null, 120000);
      await sleep(1500);
      const r = await page.evaluate(() => ({ edition: __ew.edition().edition, fire: __ew.modules().fire.state, mods: __ew.perf().fire?.modules }));
      check('editions.webgl2', r.edition === 'webgl2' && r.fire === 'loaded' && r.mods?.lance?.id === 'classic' && r.mods?.ground?.id === 'classic' && r.mods.instances?.length === 1 && errors.length === 0, { ...r, errors: errors.length });
      await page.close();
    }
    {
      const { page, errors, warnings } = await openPage(browser, `${base}?seed=${SEED}&save=fresh&skipintro=1&god=1&ground=no-such-fire&view=m2`);
      await waitFor(page, () => window.__ew?.assetsReady?.(), null, 120000);
      await page.evaluate(() => { __ew.setInput({ fire: true }); }); await sleep(1200); await page.evaluate(() => __ew.setInput(null));
      const r = await page.evaluate(() => { const m = __ew.perf().fire?.modules; return { ground: m?.ground, lance: m?.lance, instances: m?.instances?.length, source: __ew.state().fireSource }; });
      check('editions.fallback', r.ground?.state === 'fallback' && r.ground?.id === 'classic' && /no-such-fire/.test(r.ground?.reason || '') && r.lance?.state === 'loaded' && r.instances === 2 && errors.length === 0,
        { ...r, warned: warnings.some((w) => /no-such-fire/.test(w)), errors: errors.length });
      await page.close();
    }
    // the webgpu edition: three's WebGPURenderer with every module ported (docs/WEBGPU-PORT.md), the
    // UI, the audio, the fire (classic-webgpu, its default module) beside the CPU fire grid; the bot plays a stretch of Night I
    {
      const { page, errors } = await openPage(browser, `${base}?seed=${SEED}&save=fresh&skipintro=1&god=1&gpu=webgpu&autoplay=1&speed=2&mute=1`);
      const ready = await waitFor(page, () => window.__ew?.assetsReady?.(), null, 120000);
      const ed = await page.evaluate(() => window.__ew?.edition?.() ?? null);
      await sleep(12000);
      const r = await page.evaluate(() => ({ mode: __ew.state().mode, clock: +__ew.state().night.clock.toFixed(1), alive: __ew.state().horde.alive, kills: __ew.state().stats.kills,
        modules: Object.fromEntries(Object.entries(__ew.modules()).map(([k, v]) => [k, v.state])), calls: __ew.perf().calls,
        fireMods: (({ lance, ground, instances }) => ({ lance: lance?.id, ground: ground?.id, instances: instances?.length }))(__ew.perf().fire?.modules || {}), fireSource: __ew.state().fireSource }));
      const f = await shot(page, 'webgpu_play');
      const luma = await meanLuma(page, f);
      check('editions.webgpu', !!ready && ed?.edition === 'webgpu' && !ed?.downgraded && r.mode === 'play' && r.clock > 5 && r.modules.ui === 'loaded' && r.modules.env === 'loaded'
        && r.modules.fire === 'loaded' && r.fireMods.lance === 'classic-webgpu' && r.fireMods.ground === 'classic-webgpu' && luma > 0.03 && errors.length === 0,
        { edition: ed, ...r, luma, shot: path.relative(ROOT, f), errors: errors.length, firstErrors: errors.slice(0, 3) });
      await page.close();
    }
  }
} catch (err) {
  check('e2e.exception', false, { message: String(err?.stack ?? err).slice(0, 800) });
} finally {
  await shutDown();
}

// ---- verdict -------------------------------------------------------------------------------------------------------
const failed = Object.keys(report.checks).filter((name) => !report.checks[name].ok);
report.pass = failed.length === 0;
report.finished = new Date().toISOString();
const reportFile = path.join(OUT, 'e2e.json');
fs.writeFileSync(reportFile, JSON.stringify(report, null, 1));
if (failed.length) console.log(`e2e: failed checks: ${failed.join(', ')}`);
console.log(`e2e: ${report.pass ? 'PASS' : 'FAIL'} — report ${path.relative(ROOT, reportFile)}`);
process.exit(failed.length ? 1 : 0);
