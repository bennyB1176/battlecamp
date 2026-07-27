/**
 * Simulation constants with no dependencies.
 *
 * These live apart from `world.ts` so that content tables can express speeds in
 * tiles per second without importing the world — which would create a cycle,
 * since the world will import content from M2 onwards.
 */

/** Simulation rate. Rendering runs faster and interpolates between ticks. */
export const TICKS_PER_SECOND = 10;
export const MS_PER_TICK = 1000 / TICKS_PER_SECOND;
