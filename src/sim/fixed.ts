/**
 * Fixed-point arithmetic for every position, speed and distance in the sim.
 *
 * JavaScript doubles are not guaranteed bit-identical across engines, which
 * would break lockstep multiplayer later on. Rather than rewrite half the
 * project at that point, all sim-space maths goes through this module from day
 * one: positions are plain integers, so two machines always agree.
 *
 * One tile is `ONE` (256) fixed units. A unit walking at 3 tiles/second covers
 * 3 * 256 / TICKS_PER_SECOND fixed units per tick.
 *
 * Rendering may convert to floats freely — only the simulation must stay exact.
 */

/** Fixed-point units per tile. Power of two so multiply/divide stay exact. */
export const ONE = 256;
export const HALF = ONE / 2;

/** Convert tiles (possibly fractional) to fixed units. */
export function fromTiles(tiles: number): number {
  return Math.round(tiles * ONE);
}

/** Convert fixed units back to tiles as a float — for rendering only. */
export function toTiles(fixed: number): number {
  return fixed / ONE;
}

/** Tile index containing the given fixed coordinate. */
export function toTileIndex(fixed: number): number {
  return Math.floor(fixed / ONE);
}

/** Centre of the given tile index, in fixed units. */
export function tileCenter(tileIndex: number): number {
  return tileIndex * ONE + HALF;
}

/** Multiply two fixed-point numbers. */
export function mul(a: number, b: number): number {
  return Math.floor((a * b) / ONE);
}

/** Divide two fixed-point numbers. Guards against division by zero. */
export function div(a: number, b: number): number {
  if (b === 0) return 0;
  return Math.floor((a * ONE) / b);
}

/** Squared distance — the cheap comparison; avoid sqrt wherever possible. */
export function distSq(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

/**
 * Exact integer square root via Newton's method.
 *
 * `Math.sqrt` is correctly rounded per IEEE-754 and would be fine in practice,
 * but staying in integer land keeps the "no floats in sim" rule simple to check.
 */
export function isqrt(value: number): number {
  if (value <= 0) return 0;
  if (value < 2) return value;
  let x = Math.floor(Math.sqrt(value));
  // Correct any rounding slip in either direction.
  while (x * x > value) x--;
  while ((x + 1) * (x + 1) <= value) x++;
  return x;
}

/** Euclidean distance between two fixed-point points. */
export function dist(ax: number, ay: number, bx: number, by: number): number {
  return isqrt(distSq(ax, ay, bx, by));
}

export function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}
