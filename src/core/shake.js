// Camera shake and hit-stop (DESIGN §14.3). Impacts add "trauma" (0..1) that drains over time; the camera offset is
// trauma² times the maximum, swayed by smooth sines rather than per-frame noise (noise buzzes). It moves the lens only,
// never a body. `hitStop(ev, now)` asks for a short sim freeze on heavy hits: seconds, or 0.
import { EV } from '../shared/events.js';

/** Trauma added by an event that needs no look at its fields; distance from the listener scales it down. */
const FLAT_KICK = new Map([
  [EV.BOMB_BURST, 0.32], [EV.BARREL_BURST, 0.45], [EV.SUNBURST, 0.5], [EV.KINDLE, 0.25], [EV.GATE_BREACH, 0.6],
  [EV.T_STOMP, 0.55], [EV.T_BOULDER, 0.45], [EV.T_SMASH, 0.4], [EV.T_STEP, 0.08], [EV.T_ARRIVE, 0.2], [EV.T_DEATH, 0.6],
]);

function kickOf(ev) {
  switch (ev.type) {
    case EV.SHOT: return ev.weapon === 'blunderbuss' ? 0.14 : 0.05;
    case EV.P_LAND: return ev.fall > 2 ? Math.min(0.3, ev.fall * 0.05) : 0;   // only a real drop
    case EV.P_HURT: if (ev.source === 'fire') return 0.06; return ev.dmg >= 15 ? 0.42 : 0.2;
    default: return FLAT_KICK.get(ev.type);
  }
}

/** The hit-stop an event asks for, in seconds (0: none). */
function freezeOf(ev) {
  switch (ev.type) {
    case EV.E_DEATH: return ev.kind === 'brute' ? 0.05 : 0;
    case EV.T_HURT: return ev.crit ? 0.03 : 0;
    case EV.BARREL_BURST: case EV.T_STOMP: return 0.06;
    case EV.T_DEATH: return 0.14;
    case EV.P_HURT: return ev.dmg >= 15 ? 0.06 : 0;
    default: return 0;
  }
}

const HIT_STOP_GAP = 0.15;   // s of wall time between two hit-stops

/** @param {{ maxOffset?: number, maxRoll?: number, decay?: number }} [options] metres, radians, trauma per second */
export function createShake(options = {}) {
  const { maxOffset = 0.16, maxRoll = 0.03, decay = 1.6 } = options;
  let level = 0, clock = 0, lastFreeze = -1;
  const offset = { x: 0, y: 0, z: 0, roll: 0, pitch: 0 };
  const bump = (amount) => { level = Math.min(1, level + amount); };

  return {
    /** @param {any} ev @param {{x:number,y:number,z:number}|null} listener the camera position (distance falloff) */
    onEvent(ev, listener) {
      let amount = kickOf(ev);
      if (!amount) return;
      // the player's own hurt and shots are felt in full; a world event fades with distance
      const at = ev.pos, personal = ev.type === EV.P_HURT || ev.type === EV.SHOT;
      if (at && listener && !personal) {
        const dist = Math.hypot(at.x - listener.x, (at.y || 0) - listener.y, at.z - listener.z);
        amount *= Math.max(0.12, Math.min(1, 10 / Math.max(dist, 1)));
      }
      bump(amount);
    },
    /** Seconds of hit-stop for this event (0 = none); at most one every 0.15 s of wall time. */
    hitStop(ev, now) {
      const secs = freezeOf(ev);
      if (!secs || now - lastFreeze < HIT_STOP_GAP) return 0;
      lastFreeze = now;
      return secs;
    },
    add: bump,
    update(dt) {
      clock += dt;
      level = Math.max(0, level - dt * decay);
      const k = level * level, c = clock;
      offset.x = maxOffset * k * Math.sin(c * 37.1) * Math.sin(c * 7.3 + 1.1);
      offset.y = maxOffset * k * Math.sin(c * 43.7 + 2.3);
      offset.z = maxOffset * 0.6 * k * Math.sin(c * 31.3 + 4.1);
      offset.roll = maxRoll * k * Math.sin(c * 23.9 + 0.7);
      offset.pitch = maxRoll * 0.8 * k * Math.sin(c * 29.3 + 1.9);
      return offset;
    },
    get trauma() { return level; },
    reset() { level = 0; },
  };
}
