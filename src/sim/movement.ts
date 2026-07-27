/**
 * Unit movement: steering, separation, and arrival.
 *
 * Three forces decide where a unit ends up each tick:
 *
 *   1. **Steering** — follow the flow field toward the goal.
 *   2. **Separation** — push apart from anyone standing too close.
 *   3. **Terrain** — never end the tick inside something solid.
 *
 * The interesting problem is not reaching the goal, it is *stopping*. Twenty
 * units ordered onto one tile physically cannot all stand there, and a naive
 * implementation has them shoving each other around the destination forever —
 * burning CPU and looking broken. Two rules fix it: a unit that gets close
 * enough is done, and a unit that has been unable to make progress near the
 * destination accepts that the spot is taken and stops too.
 */

import { isUnit, unitDefOf, type Entity } from "./entities.js";
import { clamp, dist, distSq, isqrt, ONE, toTileIndex } from "./fixed.js";
import { isPassable, type TileGrid } from "./grid.js";
import { flowDirectionAt, getFlowField, isReachable, type FlowFieldCache } from "./pathing.js";
import { queryRadius, rebuildSpatialHash, type SpatialHash } from "./spatial.js";

/** Close enough to the goal to call it arrived. */
export const ARRIVAL_TOLERANCE = Math.floor(ONE * 0.35);

/** Within this range of the goal, a blocked unit accepts the spot is taken. */
const CROWD_RADIUS = ONE * 4;

/** Progress below this fraction of full speed counts as "blocked" for the tick. */
const BLOCKED_SPEED_NUMERATOR = 1;
const BLOCKED_SPEED_DENOMINATOR = 4;

/** Consecutive blocked ticks near the goal before a unit settles for its spot. */
const BLOCKED_TICKS_NEAR_GOAL = 8;

/** Consecutive blocked ticks anywhere before a unit gives up entirely. */
const BLOCKED_TICKS_ANYWHERE = 60;

/** How hard bodies push apart, as a fraction of their overlap. */
const SEPARATION_STRENGTH_NUMERATOR = 1;
const SEPARATION_STRENGTH_DENOMINATOR = 2;

/** Scratch buffers, reused across ticks so a busy sim allocates nothing. */
const neighbourScratch: Entity[] = [];
let pushX = new Int32Array(0);
let pushY = new Int32Array(0);

/**
 * Advance every unit by one tick.
 *
 * Separation is computed for all units *before* any of them move, so the result
 * does not depend on iteration order in a way that would feel arbitrary. (The
 * order is deterministic either way — this is about fairness, not repeatability.)
 */
export function updateMovement(
  grid: TileGrid,
  entities: readonly Entity[],
  fields: FlowFieldCache,
  spatial: SpatialHash,
): void {
  if (entities.length === 0) return;

  if (pushX.length < entities.length) {
    pushX = new Int32Array(entities.length);
    pushY = new Int32Array(entities.length);
  }

  rebuildSpatialHash(spatial, entities);
  computeSeparation(entities, spatial);

  for (let i = 0; i < entities.length; i++) {
    const entity = entities[i]!;
    // Buildings do not move, and must not be nudged by separation — they occupy
    // tiles in the grid instead, so units path around them.
    if (!isUnit(entity)) continue;

    entity.prevX = entity.x;
    entity.prevY = entity.y;

    const def = unitDefOf(entity);
    const startX = entity.x;
    const startY = entity.y;

    const steer = steerToward(grid, entity, fields, def.speed);
    // Separation applies even to idle units, so a crowd unpacks itself instead
    // of leaving bodies permanently stacked.
    const moveX = steer.x + pushX[i]!;
    const moveY = steer.y + pushY[i]!;

    applyMove(grid, entity, moveX, moveY, def.radius);

    if (entity.goalX !== null && entity.goalY !== null) {
      updateArrival(entity, def.speed, startX, startY);
    }
  }
}

/** Accumulate pairwise push-apart vectors for every overlapping pair. */
function computeSeparation(entities: readonly Entity[], spatial: SpatialHash): void {
  pushX.fill(0, 0, entities.length);
  pushY.fill(0, 0, entities.length);

  for (let i = 0; i < entities.length; i++) {
    const entity = entities[i]!;
    if (!isUnit(entity)) continue;

    const radius = unitDefOf(entity).radius;
    // Query wide enough to catch anyone whose body could overlap ours.
    const neighbours = queryRadius(spatial, entity.x, entity.y, radius * 3, neighbourScratch);

    let accumulatedX = 0;
    let accumulatedY = 0;

    for (const other of neighbours) {
      if (other === entity) continue;
      if (!isUnit(other)) continue;

      const minimumGap = radius + unitDefOf(other).radius;
      const separationSq = distSq(entity.x, entity.y, other.x, other.y);
      if (separationSq >= minimumGap * minimumGap) continue;

      let dx = entity.x - other.x;
      let dy = entity.y - other.y;

      if (dx === 0 && dy === 0) {
        // Exactly co-located (a building spawning two units on one spot).
        // Nudge along a deterministic axis derived from ids so the pair does
        // not sit locked together with a zero-length push vector.
        dx = entity.id < other.id ? -1 : 1;
        dy = 0;
      }

      const separation = isqrt(dx * dx + dy * dy);
      const overlap = minimumGap - separation;

      // Normalise, then scale by how deeply the bodies interpenetrate.
      accumulatedX += Math.floor((dx * overlap) / Math.max(1, separation));
      accumulatedY += Math.floor((dy * overlap) / Math.max(1, separation));
    }

    pushX[i] = Math.floor(
      (accumulatedX * SEPARATION_STRENGTH_NUMERATOR) / SEPARATION_STRENGTH_DENOMINATOR,
    );
    pushY[i] = Math.floor(
      (accumulatedY * SEPARATION_STRENGTH_NUMERATOR) / SEPARATION_STRENGTH_DENOMINATOR,
    );
  }
}

/** Velocity toward the goal for this tick, or zero when idle or stuck. */
function steerToward(
  grid: TileGrid,
  entity: Entity,
  fields: FlowFieldCache,
  speed: number,
): { x: number; y: number } {
  if (entity.goalX === null || entity.goalY === null) return { x: 0, y: 0 };

  const goalTileX = toTileIndex(entity.goalX);
  const goalTileY = toTileIndex(entity.goalY);
  const field = getFlowField(fields, grid, goalTileX, goalTileY);

  const tileX = toTileIndex(entity.x);
  const tileY = toTileIndex(entity.y);

  // Nothing connects us to the goal — stop rather than grind against a wall.
  if (!isReachable(field, tileX, tileY)) {
    entity.goalX = null;
    entity.goalY = null;
    entity.blockedTicks = 0;
    return { x: 0, y: 0 };
  }

  // In the goal tile already: steer at the precise point, not at a tile centre,
  // so units settle where they were told rather than snapping to a grid.
  const direction = flowDirectionAt(field, tileX, tileY);
  const targetX = direction ? (tileX + direction.dx) * ONE + ONE / 2 : entity.goalX;
  const targetY = direction ? (tileY + direction.dy) * ONE + ONE / 2 : entity.goalY;

  const dx = targetX - entity.x;
  const dy = targetY - entity.y;
  const length = isqrt(dx * dx + dy * dy);
  if (length === 0) return { x: 0, y: 0 };

  // Do not overshoot a target that is closer than one tick of travel.
  const step = Math.min(speed, length);
  return {
    x: Math.floor((dx * step) / length),
    y: Math.floor((dy * step) / length),
  };
}

/**
 * Apply a movement vector, refusing any component that would end the tick
 * inside impassable terrain.
 *
 * Axes are resolved independently so a unit brushing a wall slides along it
 * instead of stopping dead — and so a separation push can never be the thing
 * that shoves someone into rock.
 */
function applyMove(grid: TileGrid, entity: Entity, moveX: number, moveY: number, radius: number): void {
  if (moveX !== 0) {
    const candidate = entity.x + moveX;
    if (bodyFits(grid, candidate, entity.y, radius)) entity.x = candidate;
  }

  if (moveY !== 0) {
    const candidate = entity.y + moveY;
    if (bodyFits(grid, entity.x, candidate, radius)) entity.y = candidate;
  }
}

/** True when a body of the given radius at this position touches only open ground. */
function bodyFits(grid: TileGrid, x: number, y: number, radius: number): boolean {
  const minTileX = toTileIndex(x - radius);
  const maxTileX = toTileIndex(x + radius);
  const minTileY = toTileIndex(y - radius);
  const maxTileY = toTileIndex(y + radius);

  for (let tileY = minTileY; tileY <= maxTileY; tileY++) {
    for (let tileX = minTileX; tileX <= maxTileX; tileX++) {
      if (!isPassable(grid, tileX, tileY)) return false;
    }
  }
  return true;
}

/**
 * Decide whether the unit is done.
 *
 * Either it got close enough, or it has spent long enough making no progress
 * that continuing is pointless — the difference between a crowd that settles
 * and a crowd that mills around the destination forever.
 */
function updateArrival(entity: Entity, speed: number, startX: number, startY: number): void {
  if (entity.goalX === null || entity.goalY === null) return;

  const remaining = dist(entity.x, entity.y, entity.goalX, entity.goalY);
  if (remaining <= ARRIVAL_TOLERANCE) {
    entity.goalX = null;
    entity.goalY = null;
    entity.blockedTicks = 0;
    return;
  }

  const progress = dist(startX, startY, entity.x, entity.y);
  const threshold = Math.floor((speed * BLOCKED_SPEED_NUMERATOR) / BLOCKED_SPEED_DENOMINATOR);

  if (progress < threshold) {
    entity.blockedTicks++;
  } else {
    entity.blockedTicks = 0;
  }

  const nearGoal = remaining <= CROWD_RADIUS;
  const settled = nearGoal && entity.blockedTicks >= BLOCKED_TICKS_NEAR_GOAL;
  const givenUp = entity.blockedTicks >= BLOCKED_TICKS_ANYWHERE;

  if (settled || givenUp) {
    entity.goalX = null;
    entity.goalY = null;
    entity.blockedTicks = 0;
  }
}

/** Exposed for the world tick: clamp a goal to the map before storing it. */
export function clampGoalToMap(grid: TileGrid, x: number, y: number): { x: number; y: number } {
  return {
    x: clamp(x, 0, grid.width * ONE - 1),
    y: clamp(y, 0, grid.height * ONE - 1),
  };
}
