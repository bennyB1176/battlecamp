/**
 * The world: all simulation state, and the single `tick` function that advances
 * it.
 *
 * Rules this module lives by, enforced by tests in `tests/determinism.test.ts`:
 *
 *   - no DOM, no `window`, no `Date.now()`, no `Math.random()`
 *   - time is measured in ticks, never in milliseconds
 *   - every mutation happens inside `tick`, driven by commands
 *
 * Keeping the sim this pure is what lets it run headless in CI (bot-vs-bot
 * balance matches from M4) and in a worker or on a server later on.
 */

import { applyCommand, type Command } from "./commands.js";
import { generateMap } from "./mapgen.js";
import type { TileGrid } from "./grid.js";
import { createRng, type Rng } from "./rng.js";

/** Simulation rate. Rendering runs faster and interpolates between ticks. */
export const TICKS_PER_SECOND = 10;
export const MS_PER_TICK = 1000 / TICKS_PER_SECOND;

export interface Marker {
  readonly playerId: number;
  readonly tileX: number;
  readonly tileY: number;
  /** Counts down each tick; the marker is removed when it reaches zero. */
  ticksLeft: number;
}

export interface WorldConfig {
  readonly seed: number;
  readonly width: number;
  readonly height: number;
}

export const DEFAULT_WORLD_CONFIG: WorldConfig = {
  seed: 1,
  width: 64,
  height: 64,
};

export interface World {
  readonly seed: number;
  /** Ticks elapsed since the start of the match. The sim's only clock. */
  tick: number;
  readonly rng: Rng;
  readonly grid: TileGrid;
  markers: Marker[];
}

export function createWorld(config: Partial<WorldConfig> = {}): World {
  const { seed, width, height } = { ...DEFAULT_WORLD_CONFIG, ...config };

  // Map generation gets its own generator so that later changes to how many
  // random numbers the runtime sim draws cannot alter the map for a given seed.
  const mapRng = createRng(seed);
  const grid = generateMap(mapRng, width, height);

  return {
    seed,
    tick: 0,
    rng: createRng((seed ^ 0x9e3779b9) >>> 0),
    grid,
    markers: [],
  };
}

/**
 * Advance the world by exactly one tick.
 *
 * Commands are applied first so a command issued during the previous frame
 * takes effect before the systems that react to it run.
 */
export function tickWorld(world: World, commands: readonly Command[] = []): void {
  for (const command of commands) {
    applyCommand(world, command);
  }

  updateMarkers(world);

  world.tick++;
}

function updateMarkers(world: World): void {
  if (world.markers.length === 0) return;

  // Filter in place to avoid allocating a new array every tick.
  let write = 0;
  for (let read = 0; read < world.markers.length; read++) {
    const marker = world.markers[read]!;
    marker.ticksLeft--;
    if (marker.ticksLeft > 0) {
      world.markers[write++] = marker;
    }
  }
  world.markers.length = write;
}

/** Convenience for tests and the headless match runner. */
export function runTicks(world: World, count: number, commands: readonly Command[] = []): void {
  for (let i = 0; i < count; i++) {
    tickWorld(world, i === 0 ? commands : []);
  }
}
