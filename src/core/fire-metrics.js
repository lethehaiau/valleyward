// The game owns both scopes. The update and composite queries never overlap and are paired by rendered frame.
const LIMIT = 360, MAX_PENDING = 24;

function distribution(times) {
  times.sort((a, b) => a - b);
  const quantile = (q) => times.length ? +times[Math.ceil(times.length * q) - 1].toFixed(3) : null;
  return { samples: times.length, p50: quantile(0.5), p95: quantile(0.95) };
}

function fireScopes(rows, kind) {
  const values = rows.map((row) => row[kind]);
  const paired = values.filter(({ update, composite }) => Number.isFinite(update) && Number.isFinite(composite));
  return {
    update: distribution(values.map(({ update }) => update).filter(Number.isFinite)),
    composite: distribution(values.map(({ composite }) => composite).filter(Number.isFinite)),
    combined: distribution(paired.map(({ update, composite }) => update + composite)),
  };
}

export function createFireMetrics(renderer, enabled) {
  if (!enabled) return null;
  const gl = renderer.isWebGLRenderer ? renderer.getContext() : null;
  const ext = gl?.getExtension('EXT_disjoint_timer_query_webgl2');
  const frames = [], pending = [];
  let current = null, lastAt = null, dropped = 0;

  function collect() {
    if (!ext || !pending.length) return;
    if (gl.getParameter(ext.GPU_DISJOINT_EXT)) {
      dropped += pending.length;
      for (const { query } of pending.splice(0)) gl.deleteQuery(query);
      return;
    }
    while (pending.length && gl.getQueryParameter(pending[0].query, gl.QUERY_RESULT_AVAILABLE)) {
      const { query, frame, scope } = pending.shift();
      frame.gpu[scope] = gl.getQueryParameter(query, gl.QUERY_RESULT) / 1e6;
      gl.deleteQuery(query);
    }
  }

  return {
    beginFrame(now) {
      collect();
      const interval = lastAt === null ? null : now - lastAt;
      lastAt = now;
      current = { interval, cpu: {}, gpu: {} };
    },
    measure(scope, run) {
      const frame = current;
      if (!frame) return run();
      let query = null;
      if (ext) {
        if (pending.length < MAX_PENDING && !gl.getQuery(ext.TIME_ELAPSED_EXT, gl.CURRENT_QUERY)) {
          query = gl.createQuery();
          if (query) gl.beginQuery(ext.TIME_ELAPSED_EXT, query);
        }
        if (!query) dropped++;
      }
      const started = performance.now();
      try { return run(); }
      finally {
        frame.cpu[scope] = performance.now() - started;
        if (query) {
          gl.endQuery(ext.TIME_ELAPSED_EXT);
          pending.push({ query, frame, scope });
        }
      }
    },
    endFrame() {
      if (!current) return;
      frames.push(current);
      if (frames.length > LIMIT) frames.shift();
      current = null;
    },
    report() {
      collect();
      return {
        cpuSubmissionMs: fireScopes(frames, 'cpu'),
        gpuMs: ext ? fireScopes(frames, 'gpu') : null,
        gpuSource: ext ? 'EXT_disjoint_timer_query_webgl2' : null,
        frameIntervalsMs: distribution(frames.map(({ interval }) => interval).filter(Number.isFinite)),
        queriesPending: pending.length, droppedQueries: dropped,
      };
    },
    reset() {
      for (const { query } of pending.splice(0)) gl.deleteQuery(query);
      frames.length = 0;
      current = lastAt = null;
      dropped = 0;
    },
  };
}
