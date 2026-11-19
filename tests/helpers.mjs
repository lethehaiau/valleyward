// Test helpers: whole nights played by the self-play bot in the pure sim (no DOM, no three.js), with the CPU fire proxy
// providing the fire.
import { createSim } from '../src/sim/sim.js';
import { createBot } from '../src/bot/bot.js';
import { EV } from '../src/shared/events.js';

const TICKS_PER_SECOND = 60;

/**
 * Play one night from the moment control starts until it is won (EV.VICTORY, or Night X's 'ending.start'), the
 * Lamplighter or the gate falls, or `maxSeconds` of sim time pass. `night` picks a night of the save's run; otherwise the
 * save's next night starts. `onTick(sim)` runs after every tick.
 * @returns {{ won: boolean, dawn: boolean, fell: string|null, night: number, clock: number, ticks: number, sim: any,
 *   stats: any, gateHp: number, hp: number, troll: { hp: number, alive: boolean } | null, counts: Record<string, number>,
 *   level: number }}
 */
export function runNight(options = {}) {
  const { seed = 1, bot = {}, maxSeconds = 420, god = false, quality = 'high', onTick = null, save = undefined } = options;
  const { night = 0 } = options;
  const sim = createSim({ seed, quality, god, save });
  if (night) sim.goto(`night${night}`); else sim.startNight();
  const pilot = createBot({ seed, ...bot });

  const counts = {};   // event type → how many
  const outcome = { won: false, dawn: false, fell: null };
  const budget = Math.round(maxSeconds * TICKS_PER_SECOND);
  let ticks = 0;
  // every event of a tick is counted before the loop stops on its result
  while (ticks < budget && !outcome.won && !outcome.fell) {
    sim.step(pilot(sim.state));
    ticks += 1;
    for (const ev of sim.drainEvents()) {
      counts[ev.type] = (counts[ev.type] ?? 0) + 1;
      if (ev.type === EV.FALLEN) outcome.fell = ev.cause;
      else if (ev.type === EV.DAWN) outcome.dawn = true;
      if (ev.type === EV.VICTORY || ev.type === 'ending.start') outcome.won = true;
    }
    if (onTick) onTick(sim);
  }

  const { night: nightState, stats, gate, player, troll } = sim.state;
  return {
    ...outcome, night: nightState.n, clock: nightState.clock, ticks, sim, stats, gateHp: gate.hp, hp: player.hp,
    troll: troll ? { hp: troll.hp, alive: troll.alive } : null, counts, level: player.level,
  };
}
