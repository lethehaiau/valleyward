// @ts-check
// Environment · the scene's mood, shared by the environment (which drives it from state.mode / state.night.n and the
// camp events) and the look (which reads it every frame): no extra wiring in main.js. DESIGN §9.2, §8.1.
//   camp   0 night .. 1 the camp at dusk (low warm sun in the west-south-west, long shadows, no torches)
//   red    0 Night I's teal-white moon .. 1 a full blood moon (Night II ≈ 0.85; it reddens each night)
//   dawn   the env's dawn (0..1), already masked by the camp (dawn never shows in the camp)
//   sunDir the key light's direction toward the light (the moon by night, the low sun at dusk), for the look's rays
export const MOOD = {
  camp: 0, red: 0, dawn: 0,
  /** bumped by the env on EV.CAMP_ENTER: the look drops its held dawn grade (the cinema may keep setDawn(1) after dawn) */
  dawnReset: 0,
  sunDir: { x: 0, y: 1, z: 0 },
  // DESIGN §8: rain 0..1 (cooler, darker grade), world 0..1 (the ending's red-black grade), flash 0..1 (lightning),
  // lightning (a strike counter the audio code may follow), night (1..10, fractional while the palette ramps)
  rain: 0, world: 0, flash: 0, lightning: 0, night: 1,
};

/** Night n → moon redness (Night I 0, Night II 0.85, then creeping to 1 by Night X). @param {number} n */
export function nightRed(n) {
  if (!(n > 1)) return 0;
  return Math.min(1, 0.85 + 0.15 * (n - 2) / 8);
}
