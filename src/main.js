// VALLEYWARD · the entry: boot, the fixed-step loop, and the wiring of every part (docs/DESIGN.md §14, docs/CORE.md).
// The core owns the sim (src/sim/), the bot (src/bot/), input, the first-person camera, shake and hit-stop, the viewmodel's
// motion, the greybox view with its stand-ins, and the window.__ew hooks (§4.7).
// The eight parts (env, look, fire, actors, fx, cinema, ui, audio) arrive by dynamic import; one that is missing or throws
// is swapped for the greybox or a core stand-in, and __ew.modules() tells which and why. Without the look the greybox draws
// the frame itself. The fire part is the fire host (src/fire/, the Firewraith modules; decision docs/decisions/0001); when
// it fails, the CPU fire grid is the fire and the greybox draws it.
import * as THREE from 'three';
import { PARAMS as P } from './core/params.js';
import { createSim, DT } from './sim/sim.js';
import { createBot } from './bot/bot.js';
import { EV } from './shared/events.js';
import { TIMELINE } from './shared/timeline.js';
import { ARENA } from './shared/arena.js';
import { pickEdition, loadGfx } from './gfx/index.js';
import { setGfx } from './gfx/current.js';
import { CARD_BY_ID } from './sim/cards.js';
import { createInput, SENS } from './core/input.js';
import { createShake } from './core/shake.js';
import { createFrameMetrics } from './core/frame-metrics.js';
import { createResolutionGovernor, budgetDpr, createFrameCap, watchDpr } from './core/resolution.js';
import { createOverlay } from './core/overlay.js';
import { loadLane, failLane, present, report, prefetchLanes } from './core/modules.js';
import { createFallbackUI } from './core/fallback-ui.js';
import { createGreybox } from './view/greybox.js';
import { createCameraRig, VIEWS } from './view/camera.js';
import { createMotion, createGreyViewmodel } from './view/viewmodel.js';
import { createFallbackCinema } from './view/fallback-cinema.js';
import { createLocalStorage } from './core/save.js';

const STEPS_PER_FRAME = 8;       // the most sim steps one frame may run (a long frame drops the rest)
const MODAL_FPS = 30;            // DESIGN §15: the world's frame rate behind a modal
const GRID_STALE = 30, GRID_FRESH = 8;   // the gameplay grid's age in frames: handed back to the CPU grid / taken again
const TOOL_EVENTS = 6000;        // events kept for __ew.drainEvents()
const FRAME_SAMPLES = 6000;      // display-frame intervals kept for __ew.perf()
const EYE_HEIGHT = 1.68, NEAR = 0.05, FAR = 900;
const MAX_DT = 0.1;              // s: a longer frame (a stall, a breakpoint) counts as this long

// ================================================================================================ the cover and the edition
const bootT0 = performance.now();
const cover = document.getElementById('loading');
const uiRoot = document.getElementById('ui') || document.body;
if (P.noui) uiRoot.style.display = 'none';
// The loading bar (index.html's #loading .ld-bar). Each boot step sets where the bar is and where the next step will
// leave it; in between, the bar creeps toward that ceiling (never reaching it), so a long step such as the shader
// compile never looks frozen. The bar only moves forward.
const bar = cover?.querySelector('.ld-bar') ?? null;
const barStep = cover?.querySelector('.ld-step') ?? null;
const load = { shown: 0, done: 0, next: 0, timer: 0 };
function paintBar() {
  if (!bar) return;
  bar.style.setProperty('--f', load.shown.toFixed(4));
  bar.setAttribute('aria-valuenow', String(Math.round(load.shown * 100)));
}
/** @param {number} fraction reached now (0..1) @param {number} [next] where the step under way ends @param {string} [label] */
function setProgress(fraction, next = fraction, label) {
  load.done = Math.max(load.done, fraction);
  load.next = Math.max(load.done, next);
  load.shown = Math.max(load.shown, load.done);
  if (label && barStep) barStep.textContent = label;
  bar?.classList.add('live');
  paintBar();
  if (load.done >= 1) { clearInterval(load.timer); load.timer = 0; return; }
  load.timer ||= setInterval(() => { load.shown += (load.next - load.shown) * 0.05; paintBar(); }, 100);
}
setProgress(0.03, 0.12, 'LOADING');

// decision 0001: ?gpu= wins, then the backend of the fire modules picked, else webgl2 (src/gfx/index.js)
const query = new URLSearchParams(globalThis.location?.search || '');
const EDITION = pickEdition(query);
const gfx = await loadGfx(EDITION.edition);
setGfx(gfx);   // the shared world code asks it for the edition's materials (src/gfx/current.js)
const artOff = P.greybox ? 'look=greybox' : undefined;
/** Why a part stays off, if it does: the edition cannot run it yet, or (art parts) the greybox view was asked for. */
function offReason(lane, isArt = true) {
  if (!gfx.LANES[lane]) return String(gfx.LANE_OFF_REASON || 'not in this edition');
  return isArt ? artOff : undefined;
}

// ================================================================================================ renderer, scene, camera
// (the post look antialiases on its own; the plain path asks the canvas for it)
const lookWillDraw = gfx.LANES.look && present('look') && !P.greybox;
const renderer = await gfx.createRenderer({ antialias: !lookWillDraw });
// DESIGN §15: a pixel budget per quality (high: at most a 1920 × 1080 picture), followed on resize; the governor scales
// below that ceiling
const dprBudget = () => budgetDpr(P.quality, devicePixelRatio, innerWidth, innerHeight);
let ceilingDpr = dprBudget();
let dpr = ceilingDpr;
/** The greybox's grade (the look sets its own while it runs). */
function plainGrade() {
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
}
renderer.setPixelRatio(dpr);
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
plainGrade();
renderer.info.autoReset = false;
const canvas = renderer.domElement;
canvas.tabIndex = 0;
canvas.style.outline = 'none';
document.getElementById('world').appendChild(canvas);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(P.fov, innerWidth / innerHeight, NEAR, FAR);
camera.position.set(ARENA.playerSpawn.x, EYE_HEIGHT, ARENA.playerSpawn.z);

// ================================================================================================ the sim and the core's own pieces
// DESIGN §9: the save lives in localStorage (try/catch everywhere); ?save=<preset> replaces it at boot
const sim = createSim({
  seed: P.seed, god: P.god, quality: P.quality, storage: createLocalStorage(), save: P.save || undefined, cap: P.cap || undefined,
});
/** UI actions that become sim commands (applied at its next tick). */
const SIM_ACTS = new Set(['buy', 'equip', 'build', 'upgrade', 'close', 'open', 'kindle', 'continue', 'beginNight', 'buyOrgan',
  'equipOrgan', 'skipEnding']);
let botOn = P.autoplay;
let bot = createBot({ seed: P.seed, noise: P.noisy });
const greybox = createGreybox(scene, { patch: gfx.patchFireLight });
greybox.setParts({ world: true, actors: true, fire: true, debugFire: P.debug });
// the lens and what moves it: the rig (first person and the fixed views), shake, the viewmodel's motion, the box viewmodel
const rig = createCameraRig(camera, { fov: P.fov }), shake = createShake();
const motion = createMotion(), greyVM = createGreyViewmodel();
// diagnostics (?perf=1, ?gpuPerf=1, ?debug=1)
const metrics = createFrameMetrics(renderer, P.perf, P.gpuPerf), overlay = createOverlay({ debug: P.debug, perf: P.perf });
// the governor judges frames against the cap; uncapped (?fps=0) it keeps the full resolution
const governorTarget = () => ({ target: P.fps > 0 ? 1 / P.fps : 0 });
let governor = createResolutionGovernor(ceilingDpr, governorTarget());

// ---- everything the loop and the hooks share
let ready = false, fireStyle = P.fire, titleUp = false;
const hold = { menu: false, manual: false, modal: false };   // what pauses the sim: the menu, a tool, a UI modal
const isPaused = () => hold.menu || hold.manual || hold.modal;
let override = null;   // __ew.setInput(): a tool's sim input instead of the player's
let lastNow = performance.now(), raf = 0, acc = 0, wallT = 0, simMs = 0, opsN = 0, capFps = P.fps;
let hitStopT = 0, endCard = null, dawnT = -1, lastHurt = 0, cineOwned = false, vmShown = true, introCardShown = false;
let columnsOn = false, warmMs = null, bootMs = null, lightCount = null;
const toolQueue = [];   // every sim event, for __ew.drainEvents()
const opsQueue = [];    // this frame's fire events, for the fire host
const latched = { edges: new Set(), wheel: 0 };   // presses kept until a sim step reads them
const listener = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 };
const jet = { origin: new THREE.Vector3(), dir: new THREE.Vector3() };
/** DESIGN §15.4: CPU ms per frame by stage, an EMA (sim, events, env, actors, fx, audio, ui, render: the submit). */
const laneMs = { sim: 0, events: 0, env: 0, actors: 0, fx: 0, audio: 0, ui: 0, render: 0 };
const frameTimes = [];   // display-frame intervals for __ew.perf()

function syncPause() {
  sim.state.paused = isPaused();
  // the menu, the cards and the result cards hold the sim; the audio part muffles its own mix from state.paused and the
  // mode (docs/AUDIO.md)
  audioApi.resume();
}

// ================================================================================================ the parts and their stand-ins
const part = { env: null, look: null, fire: null, actors: null, fx: null, cinema: null, ui: null, audio: null };
const up = {};          // lane -> loaded and not failed since
let settled = false;    // every part loaded or replaced
let fallbackHud = null; // the core HUD, made the first time the UI is asked for without a live ui part

/** What replaces a part from the moment it throws (docs/CORE.md "Fallbacks"); fx and audio just go quiet. */
const standIn = {
  env: () => greybox.setParts({ world: true }),
  actors: () => {
    greybox.setParts({ actors: true });
    call('look', 'setViewmodel', { scene: greyVM.scene, camera: greyVM.camera });
  },
  fire: () => {
    sim.setFire(null);
    greybox.setParts({ fire: true });
    call('look', 'setFluidPass', null);
  },
  look: () => { plainGrade(); renderer.setRenderTarget(null); },
  ui: () => { try { part.ui?.dispose?.(); } catch { /* it is broken already */ } },
  cinema: () => { const st = sim.state; if (st.mode === 'intro') fallbackCinema.play('intro', st); },
};

/** Run `fn(instance)` on a live part. A throw marks the part failed for the session and hands over to its stand-in. */
function safe(lane, where, run) {
  if (!up[lane]) return undefined;
  try {
    return run(part[lane]);
  } catch (err) {
    failLane(lane, where, err);
    up[lane] = false;
    standIn[lane]?.();
    return undefined;
  }
}
/** safe() for a plain method call, labelled with the method's name. */
const call = (lane, method, ...args) => safe(lane, method, (p) => p[method](...args));
const liveOrNull = (lane) => (up[lane] ? part[lane] : null);

// before the parts settle a UI call shows nothing and its promises never resolve (a menu answers "resume")
const UI_STUB = {
  update() {}, onEvent() {}, setFireStyle() {}, dispose() {},
  cards: () => new Promise(() => {}), card: () => Promise.resolve(null), choose: () => false, modal: false,
  menu: { open: () => Promise.resolve('resume'), close() {}, get isOpen() { return false; } },
};
const AUDIO_CALLS = ['unlock', 'onEvent', 'update', 'music', 'pause', 'resume', 'setVolume', 'dispose'];
const SILENT = Object.fromEntries(AUDIO_CALLS.map((k) => [k, () => {}]));   // no audio part: every call is a no-op
function uiTarget() {
  if (up.ui) return part.ui;
  if (!settled) return UI_STUB;
  fallbackHud ??= createFallbackUI({ root: uiRoot, onAction: (a) => { if (a.startsWith('fire:')) setFireStyle(a.slice(5)); } });
  return fallbackHud;
}
/** One stable object for whichever implementation is current; a live part's methods run under safe(). */
function facade(lane, current) {
  return new Proxy({}, {
    get(_, key) {
      const target = current(), member = target[key];
      if (typeof member !== 'function') return member;
      if (target !== part[lane]) return (...args) => member.apply(target, args);
      return (...args) => safe(lane, String(key), () => member.apply(target, args));
    },
  });
}
const uiApi = facade('ui', uiTarget);
const audioApi = facade('audio', () => (up.audio ? part.audio : SILENT));

// ================================================================================================ input, pause, menus
const focusCanvas = () => canvas.focus({ preventScroll: true });
const input = createInput({ canvas, onGesture: () => audioApi.unlock(), onKey: gameKey });
canvas.addEventListener('pointerdown', () => { trySkip(); });   // (a click skips the intro once it may be skipped)

function gameKey(e) {
  if (e.repeat) return;
  const code = e.code, mode = sim.state.mode;
  if (mode === 'intro' && (code === 'Space' || code === 'Enter' || code === 'KeyE')) {
    if (trySkip()) e.preventDefault();
    return;
  }
  // DESIGN §12: the ending skips to its card only once it has been seen, after 3 s (the sim decides)
  const skipKey = code === 'Space' || code === 'Enter' || code === 'Escape';
  if (mode === 'ending' && skipKey && sim.state.ending?.beat !== 'card') sim.command({ act: 'skipEnding' });
  if (up.ui) return;   // the UI part owns P, Esc, H and the card keys (its onAction reports the choice)
  if (code === 'KeyP' || code === 'Escape') {
    if (mode !== 'title') { e.preventDefault(); toggleMenu(); }
    return;
  }
  if (code === 'KeyH' && fallbackHud) { e.preventDefault(); toggleMenu(); return; }
  if (mode !== 'cards' || !/^(Digit|Numpad)[123]$/.test(code)) return;
  e.preventDefault();
  const k = Number(code.at(-1));
  if (!uiApi.pickKey?.(k, e)) sim.pickCard(k);
}
function trySkip() {
  const st = sim.state;
  if (st.mode !== 'intro' || st.modeT < TIMELINE.intro.skippableAfter) return false;
  const skipped = sim.skipIntro();
  if (skipped) cinemaApi.skip();
  return skipped;
}
function toggleMenu() {
  const menu = uiApi.menu;
  if (menu.isOpen) { menu.close('resume'); return; }
  hold.menu = true;
  input.releaseLock();
  syncPause();
  Promise.resolve(menu.open()).then((choice) => {
    hold.menu = false;
    syncPause();
    menuChoice(choice);
    focusCanvas();
  });
}
function menuChoice(choice) {
  const mode = sim.state.mode;
  if (choice === 'restart' && mode !== 'camp' && mode !== 'title') sim.retry();   // (the camp has no night to restart)
}
function setFireStyle(s) {
  fireStyle = s === 'hybrid' ? 'hybrid' : 'smooth';
  call('fire', 'setStyle', fireStyle);
  if (up.ui) call('ui', 'setFireStyle', fireStyle);
  else fallbackHud?.setFireStyle(fireStyle);
  return fireStyle;
}

// ================================================================================================ the cinema, with its stand-in
const fallbackCinema = createFallbackCinema({ camera });
const cinemaApi = {
  play(name, st) { return up.cinema ? call('cinema', 'play', name, st) : fallbackCinema.play(name, st); },
  skip() { call('cinema', 'skip'); fallbackCinema.skip(); },
  /** true while a cutscene owns the lens; a cinema that throws here hands this very frame to the stand-in */
  update(dt, st) {
    if (up.cinema) {
      const owns = call('cinema', 'update', dt, st);
      if (up.cinema) return owns === true;
    }
    return fallbackCinema.update(dt, st);
  },
};
const playCinema = (name, st) => { Promise.resolve(cinemaApi.play(name, st)).catch(() => {}); };

// ================================================================================================ loading the parts
const assetsBase = `${import.meta.env.BASE_URL}assets/`;
const viewmodel = () => (up.actors && part.actors.viewmodel ? part.actors.viewmodel : greyVM);
const viewmodelPair = () => { const vm = viewmodel(); return { scene: vm.scene, camera: vm.camera }; };

function uiOptions() {
  return {
    root: uiRoot, noui: P.noui, assetsBase, fireStyle, cardDefs: CARD_BY_ID,
    onAction(act, detail) {
      if (act === 'restart') { menuChoice(act); return; }
      if (!SIM_ACTS.has(act)) return;
      const fields = detail && typeof detail === 'object' ? detail : {};
      sim.command({ ...fields, act });
    },
    onFireStyle: (s) => setFireStyle(s),
  };
}

async function loadParts() {
  setProgress(0.12, 0.6, 'LOADING THE VALLEY');
  // every chunk is requested now: fx and cinema are made after the first group, but need not download after it
  prefetchLanes(undefined, (lane) => !gfx.LANES[lane] || (!!artOff && lane !== 'ui' && lane !== 'audio'));
  const quality = P.quality;
  const first = [
    ['env', (m) => m.createEnvironment({ renderer, scene, camera, quality, assetsBase })],
    ['look', (m) => m.createLook({ renderer, scene, camera, quality })],
    ['fire', (m) => m.createFire({ renderer, edition: gfx.edition, quality, style: fireStyle, gpuTiming: P.gpuPerf })],
    ['actors', (m) => m.createActors({ scene, camera, quality, assetsBase, renderer })],
    ['ui', (m) => m.createUI(uiOptions()), false],
    ['audio', (m) => m.createAudio({ assetsBase }), false],
  ];
  let loaded = 0;   // the bar moves as each part arrives (they load in parallel)
  const loadOne = ([lane, make, art]) => loadLane(lane, make, { disabled: offReason(lane, art !== false) })
    .then((made) => { loaded++; setProgress(0.12 + 0.48 * (loaded / first.length), 0.6); return made; });
  const made = await Promise.all(first.map(loadOne));
  first.forEach(([lane], k) => { part[lane] = made[k]; });
  for (const [lane] of first) up[lane] = !!report[lane].ok;
  setProgress(0.6, 0.72, 'GATHERING THE HORDE');
  // fx and the cinema take the parts above as arguments
  const fxArgs = () => ({ scene, camera, quality, actors: liveOrNull('actors') });
  part.fx = await loadLane('fx', (m) => m.createFx(fxArgs()), { disabled: offReason('fx') });
  up.fx = !!part.fx;
  setProgress(0.66, 0.72);
  const cinemaArgs = () => ({
    camera, actors: liveOrNull('actors'), env: liveOrNull('env'), look: liveOrNull('look'), ui: uiApi, audio: audioApi,
  });
  part.cinema = await loadLane('cinema', (m) => m.createCinema(cinemaArgs()), { disabled: offReason('cinema') });
  up.cinema = !!part.cinema;
  settled = true;

  greybox.setParts({ world: !up.env, actors: !up.actors, fire: !up.fire || !part.fire.has('ground'), debugFire: P.debug });
  if (up.env && part.env.envMap) scene.environment = part.env.envMap;
  if (up.look) {
    safe('look', 'setFluidPass', (l) => l.setFluidPass(up.fire ? part.fire.pass : null));
    safe('look', 'setViewmodel', (l) => l.setViewmodel(viewmodelPair()));
  }
  if (P.mute) audioApi.setVolume(0);
  audioApi.setFire?.(sim.fire);
  setFireStyle(fireStyle);
  setProgress(0.72, 0.86, 'LIGHTING THE LAMPS');
}

// ================================================================================================ sim events -> everyone
// look flashes: [rgb, strength, seconds]
const FLASHES = new Map([
  [EV.KINDLE, [[1, 0.7, 0.35], 0.35, 0.6]],
  [EV.SUNBURST, [[1, 0.75, 0.4], 0.4, 0.5]],
  [EV.BARREL_BURST, [[1, 0.6, 0.3], 0.18, 0.3]],
]);
function showUpgrade(ev) {
  const st = sim.state;
  const offer = st.mode === 'cards' && st.player.level === ev.level ? st.cards : null;
  const restoreLock = !!offer && input.releaseLock();
  if (offer) input.enabled = false;

  function picked(id, event) {
    if (!offer || sim.state.cards !== offer || !sim.pickCard(id)) return;
    if (!event?.isTrusted) return;
    focusCanvas();
    if (restoreLock && !isPaused() && !uiApi.modal && !botOn && !override && rig.view === 'play') input.tryLock();
  }
  // A failed UI call switches the facade to the fallback HUD for the same offer.
  const choice = uiApi.cards(ev.cards, picked) ?? uiApi.cards(ev.cards, picked);
  Promise.resolve(choice).then((id) => { if (id) picked(id); });
}
/** The core's own reactions to an event: cutscenes, the cards, the camp's panels, the hurt time. */
const REACTIONS = new Map([
  [EV.MODE, (ev, st) => modeChanged(ev.mode, ev.prev, st)],
  [EV.LEVEL_UP, showUpgrade],
  [EV.CARD_PICK, (ev) => { if (uiApi.cardsOpen) uiApi.choose(ev.cardId); }],
  [EV.T_ARRIVE, (ev, st) => playCinema('troll', st)],
  [EV.DAWN, (ev, st) => { dawnT = 0; playCinema('dawn', st); }],
  [EV.VICTORY, () => showEnd('dawn')],
  [EV.FALLEN, (ev, st) => playCinema('fallen', st)],
  [EV.RETRY, (ev, st) => {
    dawnT = -1; setDawn(0); endCard = null;
    rig.syncTo(st.player);
    call('fire', 'reset');
    playCinema('retry', st);
  }],
  // DESIGN §9: the camp (its 'camp' / 'campLeave' cinemas start themselves from cinema.onEvent)
  [EV.CAMP_ENTER, (ev, st) => {
    dawnT = -1; endCard = null;
    rig.syncTo(st.player);
    call('fire', 'reset');
    if (!up.cinema) setDawn(0);
  }],
  ['pad.open', (ev, st) => { uiApi.panel?.('pad', st, { pad: ev.pad }); input.releaseLock(); }],
  [EV.NPC_OPEN, () => input.releaseLock()],
  [EV.P_HURT, (ev, st, now) => { lastHurt = now; }],
]);

function dispatch(events, st) {
  const wallNow = performance.now() / 1000;
  for (const ev of events) {
    toolQueue.push(ev);
    if (toolQueue.length > TOOL_EVENTS) toolQueue.splice(0, toolQueue.length - TOOL_EVENTS);
    shake.onEvent(ev, listener);
    hitStopT = Math.max(hitStopT, shake.hitStop(ev, wallNow));
    motion.onEvent(ev);
    call('env', 'onEvent', ev, st);
    if (up.actors) call('actors', 'onEvent', ev, st); else greyVM.onEvent(ev);
    call('fx', 'onEvent', ev, st);
    uiApi.onEvent(ev, st);
    audioApi.onEvent(ev, st);
    if (up.cinema) {
      if (part.cinema.onEvent) call('cinema', 'onEvent', ev, st);
      else if (ev.type === EV.FALLEN && part.cinema.setCause) call('cinema', 'setCause', ev.cause);
    }
    const flash = FLASHES.get(ev.type);
    if (flash) safe('look', 'flash', (l) => l.flash(flash[0].slice(), flash[1], flash[2]));
    REACTIONS.get(ev.type)?.(ev, st, wallNow);
  }
}
function modeChanged(mode, prev, st) {
  if (mode === 'intro') {
    // from the camp the night opens with the 'campLeave' cinema (EV.CAMP_LEAVE), not the valley intro
    if (prev !== 'camp') {
      Promise.resolve(cinemaApi.play('intro', st)).catch((e) => console.warn('[ew] cinema.play', e));
      introCardShown = false;
    } else if (!up.cinema) introCardShown = false;
  }
  if (mode === 'camp') rig.syncTo(st.player);
  if (mode !== 'play') return;
  if (prev === 'intro') { rig.syncTo(st.player); cinemaApi.skip(); }
  if (prev === 'title' || prev === 'fallen' || prev === 'victory' || prev === 'camp') rig.syncTo(st.player);
}
function showEnd(kind) {
  if (endCard === kind) return;
  endCard = kind;
  Promise.resolve(uiApi.card(kind, sim.state)).then((answer) => {
    // DESIGN §9: the primary button (still 'retry', now "TO THE CAMP") goes on to the camp; a fall ends the run there
    const mode = sim.state.mode;
    if (answer && (mode === 'victory' || mode === 'fallen')) sim.command({ act: 'continue' });
  });
}
function setDawn(x) {
  call('env', 'setDawn', x);
  call('look', 'setDawn', x);
}

// ================================================================================================ input -> sim
/** A tool's input on the later steps of a frame: held fields kept, presses only on the first. */
const NO_PRESSES = { firePress: false, jump: false, bomb: false, reload: false, kindle: false, ult: false, weapon: 0, wheel: 0,
  card: 0 };
const NO_INPUT = { held: new Set(), edges: new Set(), lookX: 0, lookY: 0, wheel: 0 };

function playerInput(frameIn, first) {
  const held = frameIn.held, edge = first ? frameIn.edges : null;
  const axis = (plus, minus) => (held.has(plus) ? 1 : 0) - (held.has(minus) ? 1 : 0);
  const once = (action) => !!edge?.has(action);
  const out = {
    fwd: axis('up', 'down'), right: axis('right', 'left'), sprint: held.has('sprint'), yaw: rig.look.yaw, pitch: rig.look.pitch,
    fire: held.has('fire'), firePress: once('fire'), jump: once('jump'), bomb: once('bomb'), reload: once('reload'),
    kindle: once('kindle'), ult: once('ult'), weapon: 0, wheel: first ? frameIn.wheel : 0, card: 0,
  };
  if (!edge) return out;
  const slot = ['w1', 'w2', 'w3'].findIndex((w) => edge.has(w)) + 1;   // 0: none
  if (sim.state.mode !== 'cards') out.weapon = slot;
  else if (slot && !up.ui && !fallbackHud?.pickKey?.(slot)) out.card = slot;   // 1/2/3 pick a level-up card
  return out;
}

/** One sim tick with the bot's, a tool's or the player's input; its fire events go to the fire host. */
function stepSim(first, frameIn) {
  let inp;
  if (botOn) inp = bot(sim.state);
  else if (override) inp = first ? override : { ...override, ...NO_PRESSES };
  else inp = playerInput(frameIn, first);
  sim.step(inp);
  const ops = sim.state.fireOps;
  if (up.fire) for (const op of ops) opsQueue.push(op);
  // the CPU fire grid (64 × 64, cheap) runs beside a fire module on the same ops: it can answer for a stale or missing
  // gameplay grid, and __ew.fireCompare() can measure how well the two agree (?debug=1)
  if (sim.fire !== sim.proxy) { sim.proxy.apply(ops, sim.state.wind); sim.proxy.step(DT); }
  if (botOn || override) rig.syncTo(sim.state.player);
}

// ================================================================================================ the frame
// DESIGN §15: the frame cap. ?fps= (60 by default; 0 = every display frame), MODAL_FPS behind a modal (the level-up cards,
// a camp panel, the P menu, the result cards). Its accumulator keeps the cadence even: a 120 Hz display draws every other
// frame, a 60 Hz one every frame.
const cap = createFrameCap(performance.now());
const behindModal = () => {
  const st = sim.state;
  return hold.menu || hold.modal || st.mode === 'cards' || (st.mode === 'camp' && !!st.camp?.panel);
};
function ema(stage, ms) { laneMs[stage] += (ms - laneMs[stage]) * 0.05; }
function timed(stage, fn) {
  const begun = performance.now();
  fn();
  ema(stage, performance.now() - begun);
}

/** The mouse turns the player in play, and at the camp while no panel is open. */
function lookIsFree() {
  const st = sim.state;
  return st.mode === 'play' || (st.mode === 'camp' && !st.camp.panel);
}
/** A UI modal over play or a result card holds the sim and frees the pointer. */
function syncUiModal() {
  const mode = sim.state.mode;
  const modal = !!uiApi.modal && (mode === 'play' || mode === 'victory' || mode === 'fallen') && !uiApi.cardsOpen;
  if (modal === hold.modal) return;
  hold.modal = modal;
  syncPause();
  if (modal) input.releaseLock();
}
/** This frame's input, with the presses latched until a sim step reads them (a frame without a step loses none). */
function gatherInput(paused) {
  const polled = input.poll();
  if (paused) { latched.edges.clear(); latched.wheel = 0; }
  for (const e of polled.edges) latched.edges.add(e);
  latched.wheel += polled.wheel;
  return { held: polled.held, edges: latched.edges, lookX: polled.lookX, lookY: polled.lookY, wheel: latched.wheel };
}
/** The fixed-step sim: game time = dt × ?speed × the sim's time scale, in DT steps; hit-stop holds it. */
function advance(dt, paused, frameIn) {
  const begun = performance.now();
  let steps = 0;
  if (ready && !paused) {
    wallT += dt;
    if (hitStopT > 0) hitStopT = Math.max(0, hitStopT - dt);
    else {
      acc += dt * P.speed * (sim.state.timeScale || 1);
      for (; acc >= DT && steps < STEPS_PER_FRAME; steps++, acc -= DT) stepSim(steps === 0, frameIn);
      if (steps >= STEPS_PER_FRAME) acc = Math.min(acc, DT);   // too far behind: drop the backlog
      if (steps > 0) { latched.edges = new Set(); latched.wheel = 0; }
    }
  }
  simMs = performance.now() - begun;
  ema('sim', simMs);
  return steps;
}

// the ground module's gameplay grid is the sim's fire once it lands; while it is stale (an overloaded GPU) or missing
// (a visual-only module) the CPU grid, kept fed beside it, answers; once fresh again the module's grid is back
function pickFireProvider() {
  const grid = up.fire ? part.fire.fire : null;
  let next;
  if (grid?.ready && !P.proxyFire) {
    const age = grid.ageFrames ?? 0;
    if (sim.fire === grid && age > GRID_STALE) next = null;
    else if (sim.fire !== grid && age <= GRID_FRESH) next = grid;
    else return;
  } else if (!grid && sim.fire !== sim.proxy) next = null;
  else return;
  sim.setFire(next);
  audioApi.setFire?.(sim.fire);
}
// DESIGN §12: from the 'reveal' beat the demon wears a sheath of fire (the lamp's pillar is the environment's); a module
// without columns shows none
function demonColumn(S) {
  const columns = up.fire ? part.fire.columns : null;
  if (!columns) return;
  safe('fire', 'columns', () => {
    if (S.mode !== 'ending' || !S.ending) {
      if (columnsOn) { columns.clear(); columnsOn = false; }
      return;
    }
    const t = S.ending.t, p = S.player, burning = t >= 29 && t < 50;
    const sheath = { preset: 'demon', x: p.x, y: ARENA.keep.walk.y, z: p.z, intensity: Math.min(1, (t - 29) / 1.5) };
    columns.set('demon', burning ? sheath : null);
    columnsOn = true;
  });
}
/** This frame's fire events and game time to the fire host, the provider swap, the Lance from the actors' muzzle. */
function driveFire(S, gameDt) {
  opsN = opsQueue.length;
  if (!up.fire) { opsQueue.length = 0; return; }
  call('fire', 'events', opsQueue.splice(0), S.wind);   // (a fresh array each frame: a module may keep it)
  call('fire', 'update', gameDt, { rain: S.weather?.rain ?? 0 });   // DESIGN §8.3: rain quenches
  pickFireProvider();
  const j = S.player.jet;
  if (j.on) {
    if (up.actors) safe('actors', 'muzzle', (a) => a.sockets.muzzle(jet.origin));
    else jet.origin.set(j.ox, j.oy, j.oz);
    jet.dir.set(j.dx, j.dy, j.dz);
  }
  demonColumn(S);
  const landing = j.on ? { x: j.lx, y: j.ly, z: j.lz } : null;
  const hue = j.hue || S.mods?.lanceHue || 'orange';
  call('fire', 'lance', { on: !!j.on && S.mode === 'play', origin: jet.origin, dir: jet.dir, range: j.range, t: j.t, hue, landing });
}
/** The beats the core plays itself when the cinema is not there to. */
function scriptedBeats(S, paused, dt) {
  if (S.mode === 'intro' && !up.cinema && !introCardShown && S.modeT >= 4.9) { introCardShown = true; uiApi.card('night', S); }
  if (S.mode === 'fallen' && S.modeT >= TIMELINE.fallen.beats.find((b) => b.id === 'card').at) showEnd('fallen');
  if (dawnT >= 0 && !paused && !up.cinema) {   // (the cinema ramps the dawn itself)
    dawnT += dt;
    setDawn(Math.min(1, dawnT / TIMELINE.dawn.rise));
  }
}
/** Is the first-person viewmodel wanted this frame (in the play view)? */
function handsWanted(S, cine) {
  switch (S.mode) {
    case 'play': case 'cards': case 'camp': return !cine;
    case 'intro': return S.night.fromCamp ? !cine : S.modeT >= 4.6;
    case 'ending': return up.cinema && !!part.cinema.hands;   // (the gloves burn in first person, 25–29 s)
    default: return false;
  }
}
/** The look's hurt vignette: low HP, plus a flash that fades over a third of a second after a hit. */
function hurtLevel(S) {
  const low = Math.max(0, Math.min(1, (0.4 - S.player.hp / S.player.hpMax) / 0.4));
  const recent = Math.max(0, 0.5 - (performance.now() / 1000 - lastHurt) * 1.5);
  return Math.max(low, recent);
}
/** The plain path: the scene, then the viewmodel over a cleared depth buffer. */
function drawPlain(withHands) {
  renderer.setRenderTarget(null);
  renderer.autoClear = true;
  renderer.render(scene, camera);
  if (!withHands) return;
  const vm = viewmodel();
  renderer.autoClear = false;
  renderer.clearDepth();
  renderer.render(vm.scene, vm.camera);
  renderer.autoClear = true;
}
/** Adaptive resolution: in play and at the camp, never paused, on frames the cap did not slow down. */
function adaptResolution(S, paused, elapsed) {
  if ((S.mode !== 'play' && S.mode !== 'camp') || paused || !ready || !(elapsed < 0.25) || capFps !== P.fps) return;
  const next = governor(elapsed);
  if (next === dpr) return;
  dpr = next;
  // with the look its render targets scale (no canvas resize, no flash); without it the canvas' pixel ratio changes
  if (up.look && part.look.setResolutionScale) call('look', 'setResolutionScale', dpr / ceilingDpr);
  else { renderer.setPixelRatio(dpr); renderer.setSize(innerWidth, innerHeight); }
}

const schedule = () => { raf = requestAnimationFrame(frame); };
function frame(now) {
  raf = 0;
  if (document.hidden) { lastNow = now; cap.reset(now); return; }   // wake() restarts the loop on the tab's return
  schedule();
  if (!settled) { lastNow = now; cap.reset(now); return; }
  capFps = behindModal() ? MODAL_FPS : P.fps;
  if (!cap.draw(now, capFps)) return;   // a skipped display frame: nothing drawn, the sim catches up on the next one
  metrics.begin(now);
  renderer.info.reset();
  const elapsed = Math.max(0, (now - lastNow) / 1000);
  lastNow = now;
  const dt = Math.min(MAX_DT, elapsed);
  overlay.frame(elapsed * 1000);
  syncUiModal();
  const paused = isPaused();
  input.enabled = ready && !paused && sim.state.mode !== 'cards';
  const f = gatherInput(paused);
  if (!botOn && !override && rig.view === 'play' && lookIsFree()) rig.turn(f.lookX, f.lookY, SENS);

  const steps = advance(dt, paused, f);
  const tEvents = performance.now();
  const events = sim.drainEvents();
  const S = sim.state;
  dispatch(events, S);
  ema('events', performance.now() - tEvents);
  const vdt = paused ? 0 : dt;            // presentation time
  const gameDt = paused ? 0 : steps * DT; // game time (speed, slow motion and hit-stop included)
  driveFire(S, gameDt);
  scriptedBeats(S, paused, dt);

  // ---- presentation
  gfx.frame();   // the edition's per-frame sync (the webgpu fire light's uniforms)
  timed('env', () => call('env', 'update', vdt, wallT, S));
  timed('actors', () => call('actors', 'update', vdt, S));
  timed('fx', () => call('fx', 'update', vdt, S));
  greybox.update(vdt, S, camera, sim.fire);
  // the lens: a fixed view, else the cinema while it owns it, else first person with the shake
  const sway = shake.update(vdt);
  let cine = false;
  if (rig.view !== 'play') rig.update(vdt, S, null);
  else {
    cine = paused ? cineOwned : cinemaApi.update(vdt, S) === true;
    if (!cine) rig.update(vdt, S, sway);
  }
  cineOwned = cine;
  camera.updateMatrixWorld();
  rig.listener(listener);
  timed('audio', () => audioApi.update(vdt, S, listener));
  const hands = rig.view === 'play' && handsWanted(S, cine);
  const vmMotion = motion.update(vdt, S, rig.bob, f.lookX, f.lookY);
  if (hands) {
    if (up.actors) safe('actors', 'viewmodel', (a) => a.viewmodel.update(vdt, S, vmMotion));
    else { greyVM.setAspect(camera.aspect); greyVM.update(vdt, S, vmMotion); }
  }
  if (hands !== vmShown) {
    vmShown = hands;
    safe('look', 'setViewmodel', (l) => l.setViewmodel(hands ? viewmodelPair() : null));
  }
  timed('ui', () => uiApi.update(S));
  safe('look', 'setHurt', (l) => l.setHurt(S.mode === 'play' ? hurtLevel(S) : 0));

  // ---- render: the look (it runs the fire pass and draws the viewmodel), else the plain path
  timed('render', () => {
    if (up.look) call('look', 'render', vdt);
    if (!up.look) drawPlain(hands);
  });

  adaptResolution(S, paused, elapsed);
  const info = { ...renderer.info.render, calls: drawCalls() };
  overlay.update(dt, S, info, {
    dpr, view: rig.view, bot: botOn, modules: report, lights: countLights(), simMs, ops: opsN, fireSource: S.fireSource,
  });
  metrics.end({ mode: S.mode, paused, dpr, width: innerWidth, height: innerHeight, horde: S.horde.alive });
}

// ================================================================================================ the warm-up
// four far-apart lenses: [position, target]
const WARM_LENSES = [[[3, 1.7, 5], [20, 1.5, 5]], [[-9, 6.5, 4.5], [8, 2, 0]], [[29, 2, 60], [0, 2, 0]], [[12, 78, 26], [12, 0, 25]]];
/**
 * DESIGN §15: whatever the first frames would do for the first time is done before control is given: every program
 * compiled, every texture uploaded, every part warmed (the fire modules too), a few frames drawn from far-apart lenses.
 */
async function warmUp() {
  const begun = performance.now();
  try {
    if (renderer.compileAsync) await renderer.compileAsync(scene, camera);
    else renderer.compile(scene, camera);
  } catch (e) { console.warn('[ew] shader warm-up', e); }
  setProgress(0.86, 0.94, 'KINDLING THE FIRE');
  const warmers = ['fire', 'fx', 'look', 'actors', 'env'];
  for (const [k, lane] of warmers.entries()) {
    const inst = part[lane];
    if (up[lane] && inst?.warm) {
      try { await inst.warm(renderer, camera); } catch (e) { console.warn(`[ew] ${lane}.warm`, e); }
    }
    setProgress(0.86 + 0.08 * ((k + 1) / warmers.length), 0.94);
  }
  const homePos = camera.position.clone(), homeQuat = camera.quaternion.clone();
  const draw = () => {
    camera.updateMatrixWorld();
    if (up.look) call('look', 'render', 0); else drawPlain(true);
  };
  if (!P.warmSkip.includes('lens')) {
    for (const [from, to] of WARM_LENSES) { camera.position.set(...from); camera.lookAt(...to); draw(); }
  }
  // a little fire, so the fire modules' paths and the greybox fire are compiled before play
  if (up.fire && !P.warmSkip.includes('fire')) {
    const calm = { x: 0, z: 0 };
    call('fire', 'events', [{ kind: 'burst', x: 12, z: 30, r: 2, amount: 0.6, push: 2 }], calm);
    for (let i = 0; i < 3; i++) { call('fire', 'update', 1 / 60); draw(); }
    call('fire', 'events', [{ kind: 'douse', x: 12, z: 30, r: 4 }], calm);
    call('fire', 'update', 1 / 60);
    // then a fresh fire: a gameplay grid read back from the warm-up fire (WebGPU's lands a few frames late) would
    // otherwise reach the sim and light the oil barrel at (12, 30)
    call('fire', 'reset');
  }
  camera.position.copy(homePos);
  camera.quaternion.copy(homeQuat);
  warmMs = Math.round(performance.now() - begun);
  setProgress(0.97, 0.99);
}

// ================================================================================================ visibility, resize, counters
/** Draw calls this frame (WebGPURenderer r186 never resets info.render.calls; its per-frame count is drawCalls). */
function drawCalls() {
  const r = renderer.info.render;
  return renderer.isWebGLRenderer ? r.calls : r.drawCalls ?? r.calls;
}
function visibleLights() {
  let n = 0;
  scene.traverseVisible((o) => { if (o.isLight) n++; });
  return n;
}
const countLights = () => (lightCount ??= visibleLights());
function wake() {
  if (raf || document.hidden) return;
  lastNow = performance.now();
  schedule();
}
document.addEventListener('visibilitychange', () => document.hidden || wake());
function onViewport() {
  // the pixel budget follows the window; a new ceiling restarts the governor at it
  const ceiling = dprBudget();
  if (Math.abs(ceiling - ceilingDpr) > 1e-3) {
    ceilingDpr = ceiling;
    dpr = ceiling;
    governor = createResolutionGovernor(ceilingDpr, governorTarget());
    renderer.setPixelRatio(dpr);
    if (up.look && part.look.setResolutionScale) call('look', 'setResolutionScale', 1);
  }
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  call('look', 'setSize', innerWidth, innerHeight);
}
addEventListener('resize', onViewport);
watchDpr(window, onViewport);   // a pixel-ratio change alone (another display, a zoom) fires no resize

// ================================================================================================ the hooks (DESIGN §14.8)
/** A first-person key-art pose: the player stands there (on the wall walk if `walk`) with the Lance, the lens at the pose. */
function standAt(x, z, yaw, pitch, walk, lift, lean) {
  if (walk) sim.teleportHigh(x, z, yaw, pitch); else sim.teleport(x, z, yaw, pitch);
  const p = sim.state.player;
  p.weapon = 'lance';
  p.switchT = 1;
  rig.look.yaw = yaw;
  rig.look.pitch = pitch;
  rig.setPose(x, z, lift, lean);
}
function setView(name) {
  if (name !== 'm1' && name !== 'm2') return rig.setView(name);
  const v = VIEWS[name];   // the first-person key-art views (the hands and the Lance in view)
  botOn = false;
  rig.setView('play');
  standAt(v.pos[0], v.pos[2], v.yaw, v.pitch, v.player === 'walk', v.lift || 0, v.lean || 0);
  return name;
}
const isBusy = () => !ready || (sim.state.mode !== 'play' && sim.state.mode !== 'camp') || cineOwned || isPaused();
const fixed = (value, digits) => +value.toFixed(digits);
function framePercentile(sorted, q) {
  return sorted.length ? fixed(sorted[Math.floor(sorted.length * q)], 2) : null;
}
function perfReport() {
  const sorted = frameTimes.slice().sort((a, b) => a - b), n = sorted.length;
  const total = sorted.reduce((s, ms) => s + ms, 0);
  const info = renderer.info;
  const lanes = {};
  for (const [stage, ms] of Object.entries(laneMs)) lanes[stage] = fixed(ms, 3);
  return {
    frames: n, avg: n ? fixed(total / n, 2) : null,
    p50: framePercentile(sorted, 0.5), p95: framePercentile(sorted, 0.95), p99: framePercentile(sorted, 0.99),
    over33: sorted.filter((ms) => ms > 33.4).length, over50: sorted.filter((ms) => ms > 50).length,
    max: n ? fixed(sorted[n - 1], 1) : null,
    calls: drawCalls(), triangles: info.render.triangles, dpr, simMs: fixed(simMs, 2),
    programs: info.programs?.length ?? null, geometries: info.memory.geometries, textures: info.memory.textures,
    horde: sim.state.horde.alive, lanes, fire: up.fire ? call('fire', 'stats') : null,
  };
}
/** ?debug=1: the ground module's gameplay grid against the CPU grid fed the same ops, sampled over ARENA.fluid at 64 × 64. */
function compareFires() {
  const F = ARENA.fluid, n = 64, cell = F.size / n, mod = sim.fire, cpu = sim.proxy;
  const sum = { a: 0, b: 0, aa: 0, bb: 0, ab: 0 }, lit = { module: 0, proxy: 0, both: 0 };
  for (let j = 0; j < n; j++) {
    const z = F.z0 + (j + 0.5) * cell;
    for (let i = 0; i < n; i++) {
      const x = F.x0 + (i + 0.5) * cell, u = mod.heat(x, z), v = cpu.heat(x, z);
      sum.a += u; sum.b += v; sum.aa += u * u; sum.bb += v * v; sum.ab += u * v;
      const hotA = u >= 0.22, hotB = v >= 0.22;
      lit.module += hotA; lit.proxy += hotB; lit.both += hotA && hotB;
    }
  }
  const N = n * n, meanA = sum.a / N, meanB = sum.b / N;
  const cov = sum.ab / N - meanA * meanB, varA = sum.aa / N - meanA ** 2, varB = sum.bb / N - meanB ** 2;
  const corr = varA > 0 && varB > 0 ? fixed(cov / Math.sqrt(varA * varB), 3) : null;
  return { source: sim.state.fireSource, moduleMean: fixed(meanA, 4), proxyMean: fixed(meanB, 4), corr, burningCells: lit };
}
function gpuName() {
  try { return gfx.describeGpu(renderer); } catch { return null; }
}

window.__ew = {
  state: () => sim.state,
  drainEvents: () => toolQueue.splice(0),
  /** A sim input object ({ fwd, right, yaw, pitch, fire, bomb, … }) for every step; null gives control back to the player. */
  setInput(x) {
    if (x == null) { override = null; return; }
    override = { ...x };
    override.yaw ??= rig.look.yaw;
    override.pitch ??= rig.look.pitch;
  },
  step(n = 1) {
    for (let i = 0; i < n; i++) stepSim(i === 0, NO_INPUT);
    return sim.state.tick;
  },
  pause() { hold.manual = true; syncPause(); },
  resume() { hold.manual = false; syncPause(); },
  god(on = true) { sim.setGod(on); return sim.god; },
  skipIntro() {
    if (sim.state.mode === 'title') sim.startIntro();
    const skipped = sim.skipIntro(true);
    if (skipped) cinemaApi.skip();
    hideTitle();
    return skipped;
  },
  teleport(x, z, yaw, pitch) {
    const onWalk = z <= 0.2 && x > -12.6 && x < 12.6;   // above the gate: the wall walk
    if (onWalk) sim.teleportHigh(x, z, yaw, pitch); else sim.teleport(x, z, yaw, pitch);
    rig.syncTo(sim.state.player);
  },
  bot(on = true) {
    botOn = !!on;
    if (on) bot = createBot({ seed: sim.state.seed, noise: on === 'noisy' || P.noisy });
    return botOn;
  },
  view: (name) => setView(name),
  /** A first-person key-art pose for framing captures: { x, z, yaw, pitch, lift, lean, walk } (walk: on the wall walk). */
  pose(v) {
    setView('play');
    botOn = false;
    standAt(v.x, v.z, v.yaw, v.pitch, v.walk, v.lift || 0, v.lean || 0);
    return true;
  },
  spawn: (kind, n = 1, x, z) => sim.spawn(kind, n, x, z),
  troll: () => !!sim.troll(),
  setClock: (seconds) => sim.setClock(seconds),
  fireOp: (op) => sim.fireOp(op),
  fireStyle: (s) => (s ? setFireStyle(s) : fireStyle),
  perf: () => perfReport(),
  resetPerf() { frameTimes.length = 0; },
  fireCompare: () => compareFires(),
  // DESIGN §9: the save and the loop
  save: () => sim.save(),
  resetSave: () => sim.resetSave(),
  setGold: (amount) => sim.setGold(amount),
  /** 'camp' | 'night1' | 'night2' … (the run in the save) */
  goto(where) {
    if (titleUp) { titleUp = false; retireCover(); }
    const ok = sim.goto(where);
    cinemaApi.skip();
    rig.syncTo(sim.state.player);
    return ok;
  },
  /** a camp or card command: { act: 'buy', item } | { act: 'build', pad, type } | … (applied at the next sim tick) */
  command: (cmd) => sim.command(cmd),
  assetsReady: () => ready,
  get busy() { return isBusy(); },
  modules: () => JSON.parse(JSON.stringify(report)),
  get hero() {
    const p = sim.state.player;
    return { pos: { x: p.x, y: p.y, z: p.z }, speed: p.speed, alive: p.alive, busy: isBusy() };
  },
  get paused() { return isPaused(); },
  ui: () => uiApi,
  card: (choice) => uiApi.choose?.(choice),
  sim, scene, camera, renderer,
  /** Which edition runs and why ({ edition, why, downgraded, gpu }). */
  edition: () => ({ ...EDITION, gpu: gpuName() }),
  get bootMs() { return bootMs; },
  get warmMs() { return warmMs; },
  lights: () => visibleLights(),
};
// display-frame intervals, whatever the cap draws
let sampledAt = performance.now();
function sampleFrame(t) {
  frameTimes.push(t - sampledAt);
  sampledAt = t;
  if (frameTimes.length > FRAME_SAMPLES) frameTimes.shift();
  requestAnimationFrame(sampleFrame);
}
requestAnimationFrame(sampleFrame);

// ================================================================================================ boot
function retireCover() {
  if (!cover) return;
  cover.classList.add('done');
  setTimeout(() => cover.remove(), 900);
}
function hideTitle() {
  if (!cover || !titleUp) return;
  titleUp = false;
  retireCover();
}
/** A first launch (an empty save) goes straight into Night I's intro; with a save, to the camp (DESIGN §9.1). */
function begin() {
  audioApi.unlock();
  hideTitle();
  if (sim.state.mode !== 'title') return;
  if (sim.hadSave) sim.toCamp('start'); else sim.startIntro();
}
const TITLE_HTML = '<div style="text-align:center"><div>VALLEYWARD</div>'
  + '<div style="font-size:12px;letter-spacing:.25em;margin-top:18px;opacity:.75">CLICK TO BEGIN</div></div>';
/** The loading cover becomes the title: its click (or a key) is the gesture that unlocks the audio and the pointer. */
function showTitle() {
  titleUp = true;
  if (cover) {
    cover.innerHTML = TITLE_HTML;
    cover.style.cursor = 'var(--ew-cursor-action, pointer)';
    try { uiApi.titleCover?.(cover); } catch (e) { console.warn('[ew] ui.titleCover', e); }
  }
  const go = (e) => {
    if (e?.type === 'keydown' && (e.code === 'Escape' || e.repeat)) return;
    // the title's links (the source, the fire-module guide) open in a new tab and do not start the game
    if (e?.target?.closest?.('a')) return;
    if (e?.type === 'keydown' && (e.code === 'Enter' || e.code === 'Space') && document.activeElement?.closest?.('#loading a')) return;
    removeEventListener('keydown', go, true);
    cover?.removeEventListener('pointerdown', go);
    begin();
    focusCanvas();
  };
  addEventListener('keydown', go, true);
  cover?.addEventListener('pointerdown', go);
}
/** The URL's start state, else the title. */
function start() {
  let jump = null;
  if (P.camp) jump = () => sim.toCamp('start');
  else if (P.ending) jump = () => sim.goto('ending');
  else if (P.night) jump = () => sim.goto(`night${P.night}`);
  else if (P.skipintro || P.autoplay) jump = () => sim.skipIntro(true);
  if (!jump) { showTitle(); return; }
  retireCover();
  jump();
}
const drained = () => new Promise((done) => { requestAnimationFrame(() => done()); setTimeout(done, 60); });

schedule();
await loadParts();
await warmUp();
for (let i = 0; i < 4; i++) await drained();   // the GPU drains the warm-up behind the cover
setProgress(1);
ready = true;
lightCount = null;
bootMs = Math.round(performance.now() - bootT0);
if (P.perf) {
  const states = {};
  for (const lane of Object.keys(report)) states[lane] = report[lane].state;
  console.info('[ew:load]', JSON.stringify({ readyMs: bootMs, warmMs, modules: states }));
}
focusCanvas();
start();
if (P.clock != null) sim.setClock(P.clock);   // (after ?night= / ?skipintro: a goto starts the night at 0)
if (P.troll) sim.troll();
if (P.view) setView(P.view);
if (P.autoplay) botOn = true;
wake();
