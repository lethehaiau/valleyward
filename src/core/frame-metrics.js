// Opt-in frame metrics (?perf=1; the console tags [ew:gpu] and [ew:perf]). GPU time comes from asynchronous timer
// queries read a few frames late; nothing here ever stalls the pipeline (no gl.finish, no readPixels).
const REPORT_EVERY_MS = 5000, MIN_INTERVALS = 30;
const QUERY_EVERY = 15, MAX_PENDING = 4;

/** a[floor(n·p)] of a sorted list, 2 decimals; null when empty. */
function pick(sorted, p) {
  if (!sorted.length) return null;
  const at = Math.min(sorted.length - 1, Math.floor(sorted.length * p));
  return +sorted[at].toFixed(2);
}
const ascending = (a, b) => a - b;

/** GPU frame time through EXT_disjoint_timer_query_webgl2: one query every 15th frame, up to 4 in flight. */
function gpuTimer(gl, ext, sink) {
  const inFlight = [];
  let open = null, frames = 0;
  return {
    collect() {
      const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT);   // a disjoint period spoils every pending result
      for (let k = inFlight.length - 1; k >= 0; k--) {
        const q = inFlight[k];
        if (!disjoint) {
          if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) continue;
          sink.push(gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6);
        }
        gl.deleteQuery(q);
        inFlight.splice(k, 1);
      }
      frames++;
      if (frames % QUERY_EVERY !== 0 || inFlight.length >= MAX_PENDING) return;
      open = gl.createQuery();
      gl.beginQuery(ext.TIME_ELAPSED_EXT, open);
    },
    close() {
      if (!open) return;
      gl.endQuery(ext.TIME_ELAPSED_EXT);
      inFlight.push(open);
      open = null;
    },
  };
}

export function createFrameMetrics(renderer, enabled = false, gpuTimers = false) {
  if (!enabled) return { begin() {}, end() {} };
  const info = renderer.info;
  info.autoReset = false;
  let intervals = [], cpu = [], gpu = [];
  let timer = null;
  if (!renderer.isWebGLRenderer) console.info('[ew:gpu]', 'webgpu edition');   // (no WebGL queries there)
  else {
    const gl = renderer.getContext();
    const ext = gpuTimers && gl.getExtension('EXT_disjoint_timer_query_webgl2');
    if (ext) timer = gpuTimer(gl, ext, { push: (ms) => gpu.push(ms) });
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    console.info('[ew:gpu]', gl.getParameter(dbg ? dbg.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
  }
  let workStart = 0, lastNow = 0, reportedAt = 0;

  function report(state) {
    // fps from the intervals in arrival order, then the percentiles from the sorted lists
    let total = 0;
    for (const ms of intervals) total += ms;
    const fps = +(1000 * intervals.length / total).toFixed(1);
    intervals.sort(ascending); cpu.sort(ascending); gpu.sort(ascending);
    const line = { ...state, samples: intervals.length, fps, p50: pick(intervals, 0.5), p95: pick(intervals, 0.95),
      p99: pick(intervals, 0.99), cpuP95: pick(cpu, 0.95), gpuP95: pick(gpu, 0.95), calls: info.render.calls,
      triangles: info.render.triangles, ...info.memory, programs: info.programs?.length };
    console.info('[ew:perf]', JSON.stringify(line));
  }

  return {
    begin(now) {
      workStart = performance.now();
      if (lastNow && now - lastNow < 1000) intervals.push(now - lastNow);   // (a gap over 1 s is a pause, not a frame)
      lastNow = now;
      info.reset();
      timer?.collect();
    },
    end(state) {
      timer?.close();
      cpu.push(performance.now() - workStart);
      if (lastNow - reportedAt < REPORT_EVERY_MS || intervals.length < MIN_INTERVALS) return;
      report(state);
      reportedAt = lastNow;
      intervals = []; cpu = []; gpu = [];
    },
  };
}
