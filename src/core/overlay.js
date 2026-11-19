// The text overlays: ?perf=1 (frame times, draw calls, triangles, pixel ratio, lights) and ?debug=1 (the sim's state, the
// fire provider, the parts). Plain text redrawn at 6 Hz, so the overlay itself costs nothing.
const KEEP = 240, REDRAW = 1 / 6;
const STYLE = {
  position: 'fixed', right: '8px', top: '64px', margin: '0', padding: '6px 8px', background: 'rgba(0,0,0,.6)',
  color: '#cfe3e6', font: '11px/1.35 ui-monospace,Menlo,monospace', zIndex: '90', pointerEvents: 'none', whiteSpace: 'pre',
};
const f1 = (v) => v.toFixed(1);

/** The frame-time headline: fps from the mean, the mean, p95, the sim's ms. */
function timingLine(recent, simMs) {
  const sorted = recent.slice().sort((a, b) => a - b), n = sorted.length;
  const mean = n ? sorted.reduce((s, v) => s + v, 0) / n : 0;
  const p95 = n ? sorted[Math.floor(n * 0.95)] : 0;
  const sim = simMs?.toFixed?.(2) ?? '?';
  return [`fps ${(1000 / Math.max(1, mean)).toFixed(0)}`, `avg ${f1(mean)}`, `p95 ${f1(p95)} ms`, `sim ${sim} ms`].join('  ');
}

/** The sim's state, a few lines of it (?debug=1); fields are separated by two spaces. */
function stateLines(st, extra) {
  const { player: pl, night, troll, gate, horde, stats, wind } = st;
  const f0 = (v) => v.toFixed(0), row = (...fields) => fields.join('  ');
  const trollText = troll
    ? `${troll.action}/${troll.stage} hp ${f0(troll.hp)} heat ${troll.heat.toFixed(2)}${troll.glowing ? ' GLOW' : ''}` : '-';
  const lines = [
    row(`mode ${st.mode} ${f1(st.modeT)}s`, `clock ${f1(night.clock)}`, `kindle ${night.kindle} cd ${f0(night.kindleCd)}`,
      `wave ${night.waveN}`),
    row(`player ${pl.where} (${f1(pl.x)}, ${f1(pl.y)}, ${f1(pl.z)}) hp ${f0(pl.hp)}/${pl.hpMax}`, `${pl.weapon}`, `fuel ${f0(pl.fuel)}`,
      `bombs ${pl.bombs}`, `lv ${pl.level} xp ${f0(pl.xp)}/${pl.xpNext}`),
    row(`gate ${f0(gate.hp)}`, `horde ${horde.alive}/${horde.cap}`, `at gate ${horde.nearGate}`,
      `kills ${stats.kills} burned ${stats.burned}`),
    row(`troll ${trollText}`, `wind ${f1(wind.x)},${f1(wind.z)}`),
    row(`fire: ${extra.fireSource || st.fireSource}`, `ops/frame ${extra.ops ?? 0}`, `view ${extra.view}`,
      `bot ${extra.bot ? 'on' : 'off'}`),
  ];
  if (extra.modules) lines.push(Object.keys(extra.modules).map((lane) => `${lane}:${extra.modules[lane].state}`).join(' '));
  return lines;
}

export function createOverlay({ debug, perf }) {
  if (!(debug || perf)) return { frame() {}, update() {} };   // (neither asked for: nothing on screen)
  const pre = document.createElement('pre');
  Object.assign(pre.style, STYLE);
  document.body.appendChild(pre);
  const recent = [];
  let sinceDraw = 0;
  return {
    frame(ms) {
      recent.push(ms);
      if (recent.length > KEEP) recent.shift();
    },
    update(dt, st, renderInfo, extra = {}) {
      sinceDraw += dt;
      if (sinceDraw < REDRAW) return;
      sinceDraw = 0;
      const text = [timingLine(recent, extra.simMs)];
      if (perf) {
        const kTris = (renderInfo.triangles / 1000).toFixed(0);
        const fields = [`calls ${renderInfo.calls}`, `tris ${kTris}k`, `dpr ${extra.dpr}`, `lights ${extra.lights ?? '?'}`];
        text.push(fields.join('  '));
      }
      if (debug && st) text.push(...stateLines(st, extra));
      pre.textContent = text.join('\n');
    },
  };
}
