// Adaptive resolution, with a floor below 1: on a 1× display the kit could never drop (its floor was min(1, maxDpr) = 1). The render
// scale may go down to max(MIN_SCALE, maxDpr × 0.5) in steps of 0.1 when the frames run long.
// GPU back-pressure stalls are not load. Uncapped, the main thread submits frames in ~1 ms
// and then blocks for 0.1–0.8 s on a full GPU queue; the old 2 s mean + missed-frame ratio read that as a slow GPU,
// dropped to 0.6 and climbed back only +0.1 per 12 s. Now:
//   - a frame ≥ `stall` (0.1 s) is a stall (a queue flush, a compile, a GC) and is ignored;
//   - each 2 s window is judged on its median frame and its share of frames > 22 ms (alternating 16/33 ms still counts);
//   - it takes `badWindows` (2) bad windows in a row to step down, so an isolated spike never drops the picture;
//   - it steps back up after `recoverAfter` (4) s of good windows instead of 12 s.
// DESIGN §15: judged against the frame cap's interval (`target`, s; the 60 fps cap by default, main.js ?fps=):
// slow = a median > 1.11 × target or > 15 % of frames > 1.32 × target (18.5 / 22 ms at 60 fps); recover below 1.038 ×.
// Uncapped (`target` 0, ?fps=0) frame times measure the display and the GPU queue's back-pressure, not load: the
// governor holds the full resolution there.
export const MIN_SCALE = 0.6;
export function createResolutionGovernor(maxDpr, { floor = Math.max(MIN_SCALE, maxDpr * 0.5), step = 0.1, window = 2, stall = 0.1, badWindows = 2, recoverAfter = 4, target = 1 / 60 } = {}) {
  const minDpr = Math.min(maxDpr, floor);
  let dpr = maxDpr, seconds = 0, bad = 0, good = 0;
  let times = /** @type {number[]} */ ([]);
  const slowMedian = target * 1.11, missedAt = target * 1.32, fastMedian = target * 1.038;
  const fn = (dt) => {
    if (!(target > 0)) return dpr;
    if (!(dt > 0) || dt >= 0.25) return dpr;
    seconds += dt;
    if (dt < stall) times.push(dt);
    if (seconds < window) return dpr;
    const n = times.length;
    if (n >= 10) {
      times.sort((a, b) => a - b);
      const median = times[n >> 1];
      let missed = 0; for (const t of times) if (t > missedAt) missed++;
      const dropRatio = missed / n;
      if (median > slowMedian || dropRatio > 0.15) {
        good = 0;
        if (++bad >= badWindows) { dpr = Math.max(minDpr, +(dpr - step).toFixed(3)); bad = 0; }
      } else if (median < fastMedian && dropRatio < 0.03) {
        bad = 0; good += seconds;
        if (good >= recoverAfter) { dpr = Math.min(maxDpr, +(dpr + step).toFixed(3)); good = 0; }
      } else { bad = 0; good = 0; }
    }
    seconds = 0; times = [];
    return dpr;
  };
  fn.floor = minDpr;
  return fn;
}

/** DESIGN §15: the device pixel ratio that keeps a quality inside its pixel budget (high: 1920 × 1080). */
export const PIXEL_BUDGET = Object.freeze({ high: 1920 * 1080, medium: 1600 * 900, low: 1280 * 720 });
export const DPR_CAP = Object.freeze({ high: 1.5, medium: 1.25, low: 1 });
export function budgetDpr(quality, devicePixelRatio, width, height) {
  const q = PIXEL_BUDGET[quality] ? quality : 'high';
  return Math.floor(Math.min(devicePixelRatio || 1, DPR_CAP[q], Math.sqrt(PIXEL_BUDGET[q] / Math.max(1, width * height))) * 1000) / 1000;   // (rounded down: never over the budget)
}

/** DESIGN §15: the frame cap with an accumulator. `draw(now, fps)` says whether this display frame is drawn
 *  (fps 0 = every frame). A 120 Hz display draws every other frame at 60, a 60 Hz one every frame (1 ms of slack). */
export function createFrameCap(now0 = 0) {
  let acc = 0, last = now0;
  return {
    draw(now, fps) {
      if (!(fps > 0)) { last = now; acc = 0; return true; }
      const iv = 1000 / fps;
      acc += now - last; last = now;
      if (acc < iv - 1) return false;
      acc = Math.min(acc - iv, iv);
      return true;
    },
    /** Skip the time that passed while nothing was drawn on purpose (hidden, not live, loading). */
    reset(now) { last = now; acc = 0; },
  };
}

/** DESIGN §15: call `onChange(dpr)` when only the device pixel ratio changes (the window moved to another display,
 *  a browser zoom), which fires no resize: a `(resolution: <dpr>dppx)` media query, re-armed at the new ratio on each
 *  change. Returns a stop function. `win` = window (a stub in the tests). */
export function watchDpr(win, onChange) {
  let mq = null, stopped = false;
  const handler = () => { arm(); onChange(win.devicePixelRatio); };
  function disarm() {
    if (!mq) return;
    if (mq.removeEventListener) mq.removeEventListener('change', handler); else mq.removeListener?.(handler);
    mq = null;
  }
  function arm() {
    disarm();
    if (stopped || typeof win?.matchMedia !== 'function') return;
    mq = win.matchMedia(`(resolution: ${win.devicePixelRatio || 1}dppx)`);
    if (mq.addEventListener) mq.addEventListener('change', handler); else mq.addListener?.(handler);
  }
  arm();
  return () => { stopped = true; disarm(); };
}
