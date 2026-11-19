// The Lamplighter's keyboard and mouse (docs/DESIGN.md §3.2).
// - Keys are heard on the window, so they work from the first frame whatever has focus. A press of a one-shot action is
//   latched until the next poll (a tap shorter than a frame is never lost); held keys clear on blur or a hidden tab.
// - Look: pointer lock on a canvas click (SENS rad/px). Where the lock is refused or lost, a click-drag looks and a
//   click without a drag fires. A two-finger touchpad swipe turns too; a mouse-wheel notch switches weapons.
//     const input = createInput({ canvas });   per frame: input.poll() -> { held, edges, lookX, lookY, wheel }
// - `enabled = false` (a modal is up, the game is not ready) drops gameplay presses.

export const SENS = 0.0022;

/** KeyboardEvent.code -> action */
const BINDINGS = new Map();
const bind = (action, ...codes) => { for (const c of codes) BINDINGS.set(c, action); };
bind('up', 'KeyW', 'ArrowUp'); bind('down', 'KeyS', 'ArrowDown'); bind('left', 'KeyA', 'ArrowLeft'); bind('right', 'KeyD', 'ArrowRight');
bind('sprint', 'ShiftLeft', 'ShiftRight'); bind('jump', 'Space'); bind('bomb', 'KeyG'); bind('reload', 'KeyR');
bind('kindle', 'KeyE'); bind('ult', 'KeyQ');
bind('w1', 'Digit1', 'Numpad1'); bind('w2', 'Digit2', 'Numpad2'); bind('w3', 'Digit3', 'Numpad3');

/** Actions that fire once per press (an "edge"); the rest are read as held. */
const ONE_SHOT = new Set(['fire', 'jump', 'bomb', 'reload', 'kindle', 'ult', 'w1', 'w2', 'w3']);

const LOCK_SETTLE_MS = 300, LOCK_CHECKED = 3, LOCK_HISTORY = 31;   // DESIGN §15: the first deltas after a lock
const DRAG_FIRE_PX = 6, NOTCH_GAP_MS = 120, SWIPE_SCALE = 0.8;
const LEFT = 0, RIGHT = 2;

/** Is this wheel event a mouse-wheel notch (not a touchpad swipe)? Line mode (Firefox), Chrome's legacy wheelDelta in
 *  steps of 120, else a whole vertical delta of at least 50 px. */
function isNotch(e) {
  if (e.deltaMode === 1) return true;
  if (e.deltaX !== 0) return false;
  const legacy = /** @type {any} */ (e).wheelDeltaY;
  if (legacy) return Math.abs(legacy) % 120 === 0;
  return Math.abs(e.deltaY) >= 50 && Number.isInteger(e.deltaY);
}

/** @param {{ canvas: HTMLCanvasElement, onGesture?: () => void, onKey?: (e: KeyboardEvent) => void }} o */
export function createInput(o) {
  const { canvas, onGesture, onKey } = o;
  const down = new Set(), pressed = new Set();
  let dx = 0, dy = 0, notches = 0, lastNotch = 0;
  let active = true, refused = false;
  /** @type {{ x: number, y: number, moved: number } | null} */
  let drag = null;
  // DESIGN §15: right after a pointer lock some systems send one huge jump (a Chrome quirk)
  let lockedAt = -1e9, checkedSinceLock = 0;
  const recentMoves = /** @type {number[]} */ ([]);

  const lockedHere = () => document.pointerLockElement === canvas;
  const userGesture = () => { try { onGesture?.(); } catch { /* the audio unlock is best effort */ } };
  const resetMotion = () => { dx = 0; dy = 0; notches = 0; };
  const look = (x, y) => { dx += x; dy += y; };
  function hold(action) {
    if (down.has(action)) return;
    down.add(action);
    if (ONE_SHOT.has(action)) pressed.add(action);
  }
  function clear() { down.clear(); pressed.clear(); resetMotion(); drag = null; }

  function tryLock() {
    if (refused || lockedHere() || !canvas.requestPointerLock) return;
    try {
      const ask = canvas.requestPointerLock();
      if (ask && typeof ask.catch === 'function') ask.catch(() => { refused = true; });
    } catch { refused = true; }
  }

  function keyDown(e) {
    userGesture();
    onKey?.(e);
    if (e.defaultPrevented) return;
    const code = e.code, action = BINDINGS.get(code);
    if (!action) return;
    if (code === 'Space' || code.startsWith('Arrow')) e.preventDefault();   // no page scroll
    const steady = !ONE_SHOT.has(action);
    // paused: a movement key counts as held once play resumes, but no one-shot is latched
    if (!active) { if (steady) down.add(action); return; }
    if (e.repeat) { if (steady && !down.has(action)) down.add(action); return; }
    hold(action);
  }
  function keyUp(e) {
    const action = BINDINGS.get(e.code);
    if (action) down.delete(action);
  }
  function buttonDown(e) {
    userGesture(); canvas.focus?.({ preventScroll: true });
    if (!active) return;
    if (e.button === RIGHT) { pressed.add('bomb'); return; }   // RMB: a firebomb
    if (e.button !== LEFT) return;
    if (lockedHere()) { hold('fire'); return; }
    // unlocked: the first click asks for the lock and does not shoot; once refused, a drag looks and a click fires
    drag = { x: e.clientX, y: e.clientY, moved: 0 };
    if (refused) hold('fire'); else tryLock();
  }
  function buttonUp(e) {
    if (e.button !== LEFT) return;
    down.delete('fire');
    drag = null;
  }
  function moved(e) {
    if (lockedHere()) {
      const step = { x: e.movementX || 0, y: e.movementY || 0 }, size = Math.hypot(step.x, step.y);
      if (checkedSinceLock < LOCK_CHECKED && performance.now() - lockedAt < LOCK_SETTLE_MS) {
        checkedSinceLock++;
        if (lockOutlier(size, recentMoves)) return;   // dropped, and not remembered
      }
      recentMoves.push(size);
      if (recentMoves.length > LOCK_HISTORY) recentMoves.shift();
      look(step.x, step.y);
      return;
    }
    if (!drag || !(e.buttons & 1)) return;
    const ddx = e.clientX - drag.x, ddy = e.clientY - drag.y;
    drag.moved += Math.abs(ddx) + Math.abs(ddy);
    drag.x = e.clientX; drag.y = e.clientY;
    look(ddx, ddy);
    if (refused && drag.moved > DRAG_FIRE_PX) down.delete('fire');   // it was a look, not a shot
  }
  function wheeled(e) {
    if (e.ctrlKey) return;   // (pinch zoom)
    e.preventDefault();
    if (!isNotch(e)) { look(e.deltaX * SWIPE_SCALE, e.deltaY * SWIPE_SCALE); return; }
    const t = performance.now();
    if (!active || t - lastNotch <= NOTCH_GAP_MS) return;
    notches += Math.sign(e.deltaY);
    lastNotch = t;
  }
  function lockChanged() {
    if (!lockedHere()) return;
    lockedAt = performance.now();
    checkedSinceLock = 0;
  }

  // (window: keys and moves count whatever has focus; registered in this order)
  for (const [target, type, fn, opts] of [
    [globalThis, 'keydown', keyDown], [globalThis, 'keyup', keyUp], [globalThis, 'blur', () => clear()],
    [document, 'visibilitychange', () => { if (document.hidden) clear(); }],
    [document, 'pointerlockerror', () => { refused = true; }],
    [canvas, 'contextmenu', (e) => { e.preventDefault(); }], [canvas, 'mousedown', buttonDown], [globalThis, 'mouseup', buttonUp],
    [document, 'pointerlockchange', lockChanged], [globalThis, 'mousemove', moved],
    [canvas, 'wheel', wheeled, { passive: false }],
  ]) target.addEventListener(type, fn, opts);

  return {
    /** This frame's input: the held actions, the one-shots since the last poll, the look delta in px, wheel notches. */
    poll() {
      const frame = active
        ? { held: new Set(down), edges: new Set(pressed), lookX: dx, lookY: dy, wheel: notches }
        : { held: new Set(), edges: new Set(), lookX: 0, lookY: 0, wheel: 0 };
      pressed.clear();
      resetMotion();
      return frame;
    },
    clear,
    get enabled() { return active; },
    set enabled(on) {
      if (active && !on) { pressed.clear(); resetMotion(); drag = null; down.delete('fire'); }
      active = !!on;
    },
    get locked() { return lockedHere(); },
    get lockRefused() { return refused; },
    releaseLock() { try { if (lockedHere()) document.exitPointerLock(); } catch { /* not locked after all */ } },
    tryLock,
  };
}

/** DESIGN §15: is a mouse delta of `m` px an outlier against the recent ones (`history`)? Over 10 × their median (and over
 *  40 px), or over 120 px while fewer than 5 are known. Pure (the tests call it). */
export function lockOutlier(m, history) {
  const n = history.length;
  if (n < 5) return m > 120;
  const median = history.slice().sort((a, b) => a - b)[n >> 1];
  return m > Math.max(40, 10 * median);
}
