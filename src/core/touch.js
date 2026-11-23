// Phone input produces the same held actions, presses, and look deltas as desktop input.
export const phoneTouches = () => matchMedia('(pointer: coarse) and (hover: none)').matches;

const ACTIONS = [
  ['sprint', 'Sprint'], ['weapon', 'Weapon'], ['reload', 'Reload'], ['bomb', 'Bomb'],
  ['ult', 'Sunburst'], ['kindle', 'Interact'], ['jump', 'Jump'], ['fire', 'Fire'], ['pause', 'Pause'],
];

export function createTouch({ canvas, root, pause, unlock }) {
  const hud = document.createElement('div');
  hud.className = 'ew-touch-hud';
  hud.hidden = true;
  const stick = document.createElement('div');
  stick.className = 'ew-touch-stick';
  stick.setAttribute('aria-label', 'Movement stick');
  const knob = document.createElement('span');
  stick.append(knob);
  hud.append(stick);
  const buttons = new Map(ACTIONS.map(([action, label]) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'ew-touch-button';
    button.dataset.touch = action;
    button.textContent = label;
    hud.append(button);
    return [action, button];
  }));
  buttons.get('sprint').setAttribute('aria-pressed', 'false');
  root.append(hud);

  let active = false, move = null, look = null, sprint = false;
  let x = 0, y = 0, dx = 0, dy = 0, wheel = 0;
  const edges = new Set();

  function setSprint(on) {
    sprint = on;
    buttons.get('sprint').setAttribute('aria-pressed', String(on));
  }
  function setMove(nextX, nextY) {
    x = nextX; y = nextY;
    knob.style.transform = `translate(${x * 32}%, ${y * 32}%)`;
  }
  function clear() {
    const contacts = [move, look];
    move = look = null;
    setMove(0, 0);
    setSprint(false);
    buttons.get('fire').classList.remove('held');
    edges.clear();
    dx = dy = wheel = 0;
    for (const contact of contacts) {
      if (contact?.target.hasPointerCapture(contact.id)) contact.target.releasePointerCapture(contact.id);
    }
  }
  function accept(event) {
    if (!active || event.pointerType !== 'touch') return false;
    event.preventDefault(); // suppress compatibility mouse events and pointer-lock requests
    return true;
  }
  function point(event, target) {
    target.setPointerCapture(event.pointerId);
    return { id: event.pointerId, target, x: event.clientX, y: event.clientY };
  }
  function slide(event) {
    const rect = stick.getBoundingClientRect();
    const x = (event.clientX - (rect.left + rect.width / 2)) / (rect.width * 0.38);
    const y = (event.clientY - (rect.top + rect.height / 2)) / (rect.height * 0.38);
    const scale = Math.max(1, Math.hypot(x, y));
    setMove(x / scale, y / scale);
  }
  stick.addEventListener('pointerdown', (event) => {
    if (!accept(event) || move) return;
    unlock();
    move = point(event, stick);
    slide(event);
  });

  function startLook(event, target, fire) {
    if (!accept(event) || look) return;
    unlock();
    look = { ...point(event, target), fire };
    if (fire) {
      edges.add('fire');
      target.classList.add('held');
    }
  }
  canvas.addEventListener('pointerdown', (event) => {
    if (event.pointerType !== 'touch') return;
    event.preventDefault(); // also prevent synthesized clicks during the intro
    startLook(event, canvas, false);
  });
  buttons.get('fire').addEventListener('pointerdown', (event) => startLook(event, buttons.get('fire'), true));
  for (const [action, button] of buttons) {
    if (action === 'fire') continue;
    function activate() {
      if (!active || button.hidden || button.disabled) return;
      unlock();
      if (action === 'pause') pause();
      else if (action === 'sprint') setSprint(!sprint);
      else if (action === 'weapon') wheel = 1; // cycle the unlocked slots using the existing weapon path
      else edges.add(action);
    }
    button.addEventListener('pointerdown', (event) => {
      if (accept(event)) activate();
    });
    button.addEventListener('click', (event) => {
      if (event.detail === 0) activate(); // keyboard and assistive technology
    });
  }

  function moved(event) {
    if (event.pointerId === move?.id) slide(event);
    if (event.pointerId !== look?.id) return;
    // Scale sensitivity by the viewport width so a similar swipe turns a similar amount across phones.
    const scale = 2.5 * 800 / Math.max(480, innerWidth);
    dx += (event.clientX - look.x) * scale;
    dy += (event.clientY - look.y) * scale;
    look.x = event.clientX; look.y = event.clientY;
  }
  function ended(event) {
    if (event.pointerId === move?.id) { move = null; setMove(0, 0); }
    if (event.pointerId === look?.id) {
      if (event.type !== 'pointerup') {
        edges.delete('fire');
        dx = dy = 0;
      }
      look = null;
      buttons.get('fire').classList.remove('held');
    }
  }
  for (const target of [stick, canvas, buttons.get('fire')]) {
    target.addEventListener('pointermove', moved);
    target.addEventListener('pointerup', ended);
    target.addEventListener('pointercancel', ended);
    target.addEventListener('lostpointercapture', ended);
  }

  return {
    clear,
    update(mode, allowed, { interact, reload, bombs, sunburst }) {
      const deactivated = active && !allowed;
      if (deactivated) clear();
      const combat = mode === 'play';
      if (active !== allowed) hud.hidden = !allowed;
      active = allowed;
      if (!active) return deactivated;
      if (hud.dataset.mode !== mode) hud.dataset.mode = mode;
      for (const action of ['weapon', 'reload', 'bomb', 'ult', 'fire']) buttons.get(action).hidden = !combat;
      const use = buttons.get('kindle'), label = combat ? 'Kindle' : 'Interact';
      use.hidden = !interact;
      if (use.textContent !== label) use.textContent = label;
      buttons.get('reload').disabled = !reload;
      buttons.get('bomb').disabled = !bombs;
      buttons.get('ult').disabled = !sunburst;
      return deactivated;
    },
    merge(frame) {
      if (!active) return frame;
      const { held } = frame;
      if (look?.fire) held.add('fire');
      if (sprint) held.add('sprint');
      for (const action of edges) frame.edges.add(action);
      const result = { ...frame, moveX: x, moveY: -y || 0, lookX: frame.lookX + dx, lookY: frame.lookY + dy, wheel: frame.wheel + wheel };
      edges.clear();
      dx = dy = wheel = 0;
      return result;
    },
  };
}

export function createFullscreenControl() {
  const root = document.documentElement;
  if (!document.fullscreenEnabled || !root.requestFullscreen) return null;
  function paint() {
    const active = document.fullscreenElement === root;
    for (const button of document.querySelectorAll('[data-touch-fullscreen]')) {
      button.textContent = active ? 'Exit fullscreen' : 'Fullscreen';
      button.setAttribute('aria-pressed', String(active));
    }
  }
  document.addEventListener('fullscreenchange', paint);
  return (parent, className) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    button.dataset.touchFullscreen = '';
    button.addEventListener('click', async () => {
      try {
        if (document.fullscreenElement === root) await document.exitFullscreen();
        else await root.requestFullscreen();
      } catch {
        // Keep the game in the tab if the browser declines the request.
        paint();
      }
    });
    parent.append(button);
    paint();
  };
}
