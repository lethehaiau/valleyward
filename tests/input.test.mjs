import test from 'node:test';
import assert from 'node:assert/strict';
import { createInput } from '../src/core/input.js';

function setup(t) {
  const doc = new EventTarget(), canvas = new EventTarget(), win = new EventTarget();
  globalThis.document = doc;
  globalThis.addEventListener = win.addEventListener.bind(win);
  t.after(() => { delete globalThis.document; delete globalThis.addEventListener; });
  const mouseDown = () => canvas.dispatchEvent(Object.assign(new Event('mousedown'), { button: 0, clientX: 0, clientY: 0 }));
  const mouseUp = () => win.dispatchEvent(Object.assign(new Event('mouseup'), { button: 0 }));
  const move = (fields) => win.dispatchEvent(Object.assign(new Event('mousemove'), fields));
  const changeLock = (element) => {
    doc.pointerLockElement = element;
    doc.dispatchEvent(new Event('pointerlockchange'));
  };
  doc.exitPointerLock = () => changeLock(null);
  return { doc, canvas, mouseDown, mouseUp, move, changeLock };
}

test('a rejected pointer lock is retryable and a successful retry restores relative mouse look', async (t) => {
  const { canvas, mouseDown, mouseUp, move, changeLock } = setup(t);
  let attempts = 0, grant;
  canvas.requestPointerLock = async () => {
    if (++attempts === 1) throw new Error('temporary denial');
    await new Promise((resolve) => { grant = resolve; });
    changeLock(canvas);
  };
  const input = createInput({ canvas });

  mouseDown(); mouseUp();
  await Promise.resolve();
  assert.equal(input.lockRefused, true);
  mouseDown(); mouseUp();
  assert.equal(attempts, 2);
  assert.equal(input.poll().edges.has('fire'), false, 'a pending retry does not fire');
  grant();
  await Promise.resolve();
  assert.equal(input.locked, true);
  assert.equal(input.lockRefused, false);
  move({ movementX: 8, movementY: -4 });
  const frame = input.poll();
  assert.deepEqual([frame.lookX, frame.lookY], [8, -4]);
  assert.equal(frame.edges.has('fire'), false);
});

test('a denied retry keeps click-to-fire and drag-to-look available', async (t) => {
  const { canvas, mouseDown, mouseUp, move } = setup(t);
  canvas.requestPointerLock = async () => { throw new Error('denied'); };
  const input = createInput({ canvas });
  mouseDown(); mouseUp();
  await Promise.resolve();
  assert.equal(input.poll().edges.has('fire'), false, 'the first click is for capture');
  mouseDown(); mouseUp();
  await Promise.resolve();
  assert.equal(input.poll().edges.has('fire'), true);
  mouseDown();
  move({ buttons: 1, clientX: 18, clientY: 0 });
  mouseUp();
  await Promise.resolve();
  const frame = input.poll();
  assert.equal(frame.lookX, 18);
  assert.equal(frame.edges.has('fire'), false);
});

test('legacy pointer lock errors allow another request', (t) => {
  const { doc, canvas, changeLock } = setup(t);
  let attempts = 0;
  canvas.requestPointerLock = () => { attempts++; };
  const input = createInput({ canvas });
  input.tryLock();
  input.tryLock();
  assert.equal(attempts, 1, 'one browser request at a time');
  doc.dispatchEvent(new Event('pointerlockerror'));
  assert.equal(input.lockRefused, true);
  input.tryLock();
  changeLock(canvas);
  assert.equal(attempts, 2);
  assert.equal(input.locked, true);
});

test('opening a modal releases lock even when the browser grants a pending request late', (t) => {
  const { canvas, changeLock } = setup(t);
  canvas.requestPointerLock = () => {};
  const input = createInput({ canvas });
  input.tryLock();
  assert.equal(input.releaseLock(), true);
  changeLock(canvas);
  assert.equal(input.locked, false);
  assert.equal(input.releaseLock(), false);
});

test('click and drag remain usable without the Pointer Lock API', (t) => {
  const { canvas, mouseDown, mouseUp, move } = setup(t);
  const input = createInput({ canvas });
  mouseDown(); mouseUp();
  assert.equal(input.poll().edges.has('fire'), true);
  mouseDown();
  move({ buttons: 1, clientX: 12, clientY: -6 });
  const frame = input.poll();
  assert.deepEqual([frame.lookX, frame.lookY], [12, -6]);
  assert.equal(frame.held.has('fire'), false);
  assert.equal(frame.edges.has('fire'), false);
  mouseUp();
});

test('compatibility mouse events from touch do not request desktop pointer lock', (t) => {
  const { canvas } = setup(t);
  let attempts = 0;
  canvas.requestPointerLock = () => { attempts++; };
  const input = createInput({ canvas });
  canvas.dispatchEvent(Object.assign(new Event('mousedown'), { button: 0, sourceCapabilities: { firesTouchEvents: true } }));
  assert.equal(attempts, 0);
  assert.equal(input.poll().held.has('fire'), false);
});
