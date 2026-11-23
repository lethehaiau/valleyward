import test from 'node:test';
import assert from 'node:assert/strict';
import { createFireMetrics } from '../src/core/fire-metrics.js';

test('GPU fire reports pair only completed scopes from the same frame', () => {
  let open, ready = false, disjoint = false;
  const deleted = [];
  const gl = {
    getExtension: () => ({ TIME_ELAPSED_EXT: 1, GPU_DISJOINT_EXT: 2 }),
    CURRENT_QUERY: 3, QUERY_RESULT_AVAILABLE: 4, QUERY_RESULT: 5,
    getQuery: () => open,
    createQuery: () => ({}),
    beginQuery: (_target, query) => { assert.equal(open, undefined); open = query; },
    endQuery: () => { open = undefined; },
    getParameter: () => disjoint,
    getQueryParameter: (_query, key) => key === gl.QUERY_RESULT_AVAILABLE ? ready : 2e6,
    deleteQuery: (query) => deleted.push(query),
  };
  const metrics = createFireMetrics({ isWebGLRenderer: true, getContext: () => gl }, true);
  metrics.beginFrame(10);
  metrics.measure('update', () => {});
  metrics.measure('composite', () => {});
  metrics.endFrame();
  assert.equal(metrics.report().gpuMs.combined.samples, 0);
  ready = true;
  assert.deepEqual(metrics.report().gpuMs.combined, { samples: 1, p50: 4, p95: 4 });

  metrics.beginFrame(27);
  open = 'host';
  metrics.measure('update', () => {});
  assert.equal(open, 'host');
  open = undefined;
  metrics.measure('composite', () => {});
  metrics.endFrame();
  disjoint = true;
  const report = metrics.report();
  assert.equal(report.droppedQueries, 2);
  assert.equal(report.gpuMs.combined.samples, 1);
  assert.equal(report.cpuSubmissionMs.combined.samples, 2);
  assert.equal(report.frameIntervalsMs.p50, 17);
  assert.equal(deleted.length, 3);
  metrics.reset();
  assert.equal(metrics.report().cpuSubmissionMs.combined.samples, 0);
});

test('a backend without elapsed GPU queries still reports CPU scopes and intervals', () => {
  const metrics = createFireMetrics({}, true);
  metrics.beginFrame(10);
  metrics.measure('update', () => {});
  metrics.measure('composite', () => {});
  metrics.endFrame();
  assert.equal(metrics.report().gpuMs, null);
  assert.equal(metrics.report().cpuSubmissionMs.combined.samples, 1);
});
