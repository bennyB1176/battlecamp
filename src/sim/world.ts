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

import { UnitType } from "../content/units.js";
import { applyCommand, type Command } from "./commands.js";
import { addEntity, createEntityStore, type EntityStore } from "./entities.js";
import { ONE, tileCenter } from "./fixed.js";
import { generateMap } from "./mapgen.js";
import { isPassable, type TileGrid } from "./grid.js";
import { updateMovement } from "./movement.js";
import { createFlowFieldCache, type FlowFieldCache } from "./pathing.js";
import { createRng, type Rng } from "./rng.js";
import { createSpatialHash, type SpatialHash } from "./spatial.js";

// Re-exported so existing importers keep working; the definitions live in
// constants.ts to stay importable from content tables without a cycle.
export { MS_PER_TICK, TICKS_PER_SECOND } from "./constants.js";

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
  /**
   * Units handed to player 0 at the start.
   *
   * A placeholder for M2, where units come out of a headquarters instead. Tests
   * that want an empty world pass 0.
   */
  readonly startingUnits: number;
}

export const DEFAULT_WORLD_CONFIG: WorldConfig = {
  seed: 1,
  width: 64,
  height: 64,
  startingUnits: 12,
};

export interface World {
  readonly seed: number;
  /** Ticks elapsed since the start of the match. The sim's only clock. */
  tick: number;
  readonly rng: Rng;
  readonly grid: TileGrid;
  readonly entities: EntityStore;
  /** Shared flow fields, keyed by goal tile. Invalidated when terrain changes. */
  readonly fields: FlowFieldCache;
  /** Rebuilt each tick; used for separation now, for combat from M3. */
  readonly spatial: SpatialHash;
  markers: Marker[];
}

export function createWorld(config: Partial<WorldConfig> = {}): World {
  const { seed, width, height, startingUnits } = { ...DEFAULT_WORLD_CONFIG, ...config };

  // Map generation gets its own generator so that later changes to how many
  // random numbers the runtime sim draws cannot alter the map for a given seed.
  const mapRng = createRng(seed);
  const grid = generateMap(mapRng, width, height);

  const world: World = {
    seed,
    tick: 0,
    rng: createRng((seed ^ 0x9e3779b9) >>> 0),
    grid,
    entities: createEntityStore(),
    // Eight goals is plenty while one player gives orders; M4's bots will want
    // more, and the LRU will size up with them.
    fields: createFlowFieldCache(8),
    // Cell size tracks the separation query radius — roughly two tiles.
    spatial: createSpatialHash(2 * ONE),
    markers: [],
  };

  if (startingUnits > 0) spawnStartingUnits(world, startingUnits);

  return world;
}

/**
 * Drop a starting group on open ground near the middle of the map.
 *
 * Placeholder until M2 gives players a headquarters that produces units, and
 * M8 generates fair, symmetric start positions.
 */
function spawnStartingUnits(world: World, count: number): void {
  const { grid } = world;
  const centerX = Math.floor(grid.width / 2);
  const centerY = Math.floor(grid.height / 2);

  // Spiral outward from the centre until enough open tiles have been found, so
  // a map with a lake in the middle still produces a valid start.
  const spots: Array<{ x: number; y: number }> = [];
  const maxRadius = Math.max(grid.width, grid.height);

  for (let radius = 0; radius < maxRadius && spots.length < count; radius++) {
    for (let dy = -radius; dy <= radius && spots.length < count; dy++) {
      for (let dx = -radius; dx <= radius && spots.length < count; dx++) {
        // Only the newly added ring, not the filled square from previous rounds.
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;

        const x = centerX + dx;
        const y = centerY + dy;
        if (isPassable(grid, x, y)) spots.push({ x, y });
      }
    }
  }

  spots.forEach((spot, index) => {
    addEntity(world.entities, {
      // A mixed group so the differing speeds and radii get exercised early.
      typeId: index % 4 === 0 ? UnitType.Worker : index % 7 === 0 ? UnitType.Scout : UnitType.Soldier,
      owner: 0,
      x: tileCenter(spot.x),
      y: tileCenter(spot.y),
    });
  });
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

  updateMovement(world.grid, world.entities.list, world.fields, world.spatial);
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
