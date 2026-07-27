/**
 * Seeded pseudo-random number generator (mulberry32).
 *
 * The simulation must never call `Math.random()` — every random decision goes
 * through an `Rng` whose state lives inside the world. That is what makes a
 * match reproducible from nothing but its seed and its command list.
 *
 * The state is a single uint32, so snapshots and replays stay tiny.
 */
export interface Rng {
  state: number;
}

export function createRng(seed: number): Rng {
  // Force to uint32 so `createRng(-1)` and `createRng(0xffffffff)` behave alike.
  return { state: seed >>> 0 };
}

export function cloneRng(rng: Rng): Rng {
  return { state: rng.state };
}

/** Next float in [0, 1). */
export function nextFloat(rng: Rng): number {
  rng.state = (rng.state + 0x6d2b79f5) >>> 0;
  let t = rng.state;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Next integer in [0, bound). Returns 0 for a bound of 0 or less. */
export function nextInt(rng: Rng, bound: number): number {
  if (bound <= 0) return 0;
  return Math.floor(nextFloat(rng) * bound);
}

/** Next integer in [min, max], both inclusive. */
export function nextRange(rng: Rng, min: number, max: number): number {
  if (max <= min) return min;
  return min + nextInt(rng, max - min + 1);
}

/** True with the given probability (0..1). */
export function nextChance(rng: Rng, probability: number): boolean {
  return nextFloat(rng) < probability;
}
