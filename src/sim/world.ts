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

import { BuildingType, buildingDef } from "../content/buildings.js";
import { UnitType } from "../content/units.js";
import { applyCommand, type Command } from "./commands.js";
import { addEntity, createEntityStore, type EntityStore } from "./entities.js";
import { placeBuildingAt, updateConstruction } from "./construction.js";
import { updateEconomy } from "./economy.js";
import { ONE, tileCenter } from "./fixed.js";
import { generateMap } from "./mapgen.js";
import { isBuildable, isPassable, type TileGrid } from "./grid.js";
import { updateMovement } from "./movement.js";
import { createFlowFieldCache, invalidateFlowFields, type FlowFieldCache } from "./pathing.js";
import { updateProduction } from "./production.js";
import { createPlayer, Resource, stockDeposits, type Player } from "./resources.js";
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

/**
 * Opening stock: enough for a depot and a few workers, not enough to skip
 * gathering. The point of a starting pile is to remove the first two dull
 * minutes, not to remove the first decision.
 */
const STARTING_STOCK = {
  [Resource.Wood]: 300,
  [Resource.Stone]: 150,
  [Resource.Ore]: 0,
};

export interface World {
  readonly seed: number;
  /** Ticks elapsed since the start of the match. The sim's only clock. */
  tick: number;
  readonly rng: Rng;
  readonly grid: TileGrid;
  /** Remaining yield per tile, parallel to grid.tiles. Zero where nothing grows. */
  readonly deposits: Int32Array;
  readonly players: Player[];
  readonly entities: EntityStore;
  /** Shared flow fields, keyed by goal tile. Invalidated when terrain changes. */
  readonly fields: FlowFieldCache;
  /** Rebuilt each tick; used for separation now, for combat from M3. */
  readonly spatial: SpatialHash;
  /**
   * Set by anything that changes terrain — a felled forest, a finished
   * building. The tick clears it after invalidating cached paths and telling
   * the renderer its terrain image is stale, so no caller has to remember both.
   */
  terrainDirty: boolean;
  /**
   * Bumped whenever terrain changed. The renderer keeps the version it last
   * drew and rebuilds its terrain image when the two differ — a pull, so the
   * simulation never needs to know a renderer exists.
   */
  terrainVersion: number;
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
    deposits: new Int32Array(width * height),
    // Two players from the start: the second is inert until M4's bots move in,
    // but having the slot means ownership checks are exercised from day one.
    players: [
      createPlayer(0, STARTING_STOCK),
      createPlayer(1, STARTING_STOCK),
    ],
    entities: createEntityStore(),
    // Eight goals is plenty while one player gives orders; M4's bots will want
    // more, and the LRU will size up with them.
    fields: createFlowFieldCache(8),
    // Cell size tracks the separation query radius — roughly two tiles.
    spatial: createSpatialHash(2 * ONE),
    terrainDirty: false,
    terrainVersion: 0,
    markers: [],
  };

  stockDeposits(world);

  if (startingUnits > 0) spawnStartingUnits(world, startingUnits);

  return world;
}

/**
 * Set up the opening position: a headquarters and a handful of workers on open
 * ground near the middle of the map.
 *
 * M8 replaces this with generated, symmetric start positions per player.
 */
function spawnStartingUnits(world: World, count: number): void {
  const { grid } = world;
  const centerX = Math.floor(grid.width / 2);
  const centerY = Math.floor(grid.height / 2);

  // The headquarters goes down first, so the workers spawn around it rather
  // than inside its footprint.
  placeStartingHeadquarters(world, centerX, centerY);

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
      // Mostly workers: M2 is about getting an economy running, and an idle
      // soldier contributes nothing to that. A scout comes along for scale.
      typeId: index === 0 ? UnitType.Scout : UnitType.Worker,
      owner: 0,
      x: tileCenter(spot.x),
      y: tileCenter(spot.y),
    });
  });
}

/** Find open ground near the centre and drop the opening headquarters on it. */
function placeStartingHeadquarters(world: World, centerX: number, centerY: number): void {
  const footprint = buildingDef(BuildingType.Headquarters).footprint;
  const maxRadius = Math.max(world.grid.width, world.grid.height);

  for (let radius = 0; radius < maxRadius; radius++) {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;

        const tileX = centerX + dx - Math.floor(footprint / 2);
        const tileY = centerY + dy - Math.floor(footprint / 2);
        if (!isBuildable(world.grid, tileX, tileY, footprint)) continue;

        placeBuildingAt(world, 0, BuildingType.Headquarters, tileX, tileY, {
          // Nothing exists yet to pay for it or to build within reach of.
          free: true,
          finished: true,
          ignoreRadius: true,
        });
        return;
      }
    }
  }
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

  // Economy first: it decides where workers want to be, then movement walks
  // them there. Running it the other way round would cost every worker a tick
  // of lag on every leg of every trip.
  updateProduction(world);
  updateEconomy(world);
  updateConstruction(world);
  updateMovement(world.grid, world.entities.list, world.fields, world.spatial);
  updateMarkers(world);

  // Terrain changed this tick (a forest felled, a building finished), so every
  // cached route across it is now a lie. Clearing here, once, means no system
  // has to remember to do it for itself.
  if (world.terrainDirty) {
    invalidateFlowFields(world.fields);
    world.terrainDirty = false;
    world.terrainVersion++;
  }

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
