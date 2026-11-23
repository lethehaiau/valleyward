import test from 'node:test';
import assert from 'node:assert/strict';
import { createTouch } from '../src/core/touch.js';

class Element extends EventTarget {
  children = [];
  dataset = {};
  style = {};
  captures = new Set();
  classList = new Set();
  constructor() {
    super();
    this.classList.remove = this.classList.delete;
  }
  append(child) { this.children.push(child); }
  setAttribute() {}
  setPointerCapture(id) { this.captures.add(id); }
  hasPointerCapture(id) { return this.captures.has(id); }
  releasePointerCapture(id) { this.captures.delete(id); }
  getBoundingClientRect() { return { left: 0, top: 0, width: 100, height: 100 }; }
}

function setup(t) {
  const document = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const innerWidth = Object.getOwnPropertyDescriptor(globalThis, 'innerWidth');
  globalThis.document = { createElement: () => new Element() };
  globalThis.innerWidth = 800;
  t.after(() => {
    if (document) Object.defineProperty(globalThis, 'document', document);
    else delete globalThis.document;
    if (innerWidth) Object.defineProperty(globalThis, 'innerWidth', innerWidth);
    else delete globalThis.innerWidth;
  });
  const canvas = new Element(), root = new Element();
  const touch = createTouch({ canvas, root, pause() {}, unlock() {} });
  const settings = { interact: true, reload: true, bombs: true, sunburst: true };
  const update = (allowed) => touch.update('play', allowed, settings);
  const [stick, ...buttons] = root.children[0].children;
  const button = (name) => buttons.find((element) => element.dataset.touch === name);
  const pointer = (target, type, id, x = 20, y = 20) => {
    const event = Object.assign(new Event(type, { cancelable: true }),
      { pointerType: 'touch', pointerId: id, clientX: x, clientY: y });
    target.dispatchEvent(event);
    return event;
  };
  const poll = () => touch.merge({ held: new Set(), edges: new Set(), lookX: 0, lookY: 0, wheel: 0 });
  update(true);
  return { canvas, stick, button, pointer, poll, update };
}

test('the stick and fire drag can move, turn and shoot in the same frame', (t) => {
  const { stick, button, pointer, poll } = setup(t);
  const fire = button('fire');
  assert.ok(pointer(stick, 'pointerdown', 1, 50, 10).defaultPrevented);
  pointer(fire, 'pointerdown', 2);
  pointer(fire, 'pointermove', 2, 60, 30);
  let frame = poll();
  assert.deepEqual([frame.moveX, frame.moveY, frame.lookX, frame.lookY], [0, 1, 100, 25]);
  assert.ok(frame.held.has('fire'));
  assert.ok(frame.edges.has('fire'));
  pointer(fire, 'pointerup', 2);
  frame = poll();
  assert.equal(frame.moveY, 1);
  assert.equal(frame.held.has('fire'), false);
  assert.equal(frame.edges.has('fire'), false);
});

test('a short fire tap is latched and cancelling a drag discards the press', (t) => {
  const { button, pointer, poll } = setup(t);
  const fire = button('fire');
  pointer(fire, 'pointerdown', 2);
  pointer(fire, 'pointerup', 2);
  let frame = poll();
  assert.ok(frame.edges.has('fire'));
  assert.equal(frame.held.has('fire'), false);
  pointer(fire, 'pointerdown', 3);
  pointer(fire, 'pointermove', 3, 60);
  pointer(fire, 'pointercancel', 3);
  frame = poll();
  assert.equal(frame.edges.has('fire'), false);
  assert.equal(frame.lookX, 0);
});

test('disabling the HUD clears held actions and an open-area drag never shoots', (t) => {
  const { canvas, stick, button, pointer, poll, update } = setup(t);
  const fire = button('fire');
  pointer(stick, 'pointerdown', 1, 50, 10);
  pointer(fire, 'pointerdown', 2);
  pointer(button('jump'), 'pointerdown', 3);
  assert.ok(poll().edges.has('jump'));
  assert.equal(update(false), true);
  assert.equal(stick.captures.size, 0);
  assert.equal(fire.captures.size, 0);

  update(true);
  pointer(stick, 'pointermove', 1, 50, 0);
  pointer(fire, 'pointermove', 2, 80);
  pointer(canvas, 'pointerdown', 4);
  pointer(canvas, 'pointermove', 4, 80);
  const frame = poll();
  assert.equal(frame.moveY, 0);
  assert.equal(frame.lookX, 150);
  assert.equal(frame.held.size, 0);
  assert.equal(frame.edges.size, 0);
});
