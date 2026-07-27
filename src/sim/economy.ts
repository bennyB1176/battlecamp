/**
 * Gathering: the loop that turns ground into resources.
 *
 * A worker walks to a deposit, works it, carries a load to the nearest
 * drop-off, banks it, and walks back. That round trip is the *only* journey in
 * the economy — this game has no carts and no supply lines, on purpose. But
 * modelling this one journey is what gives the depot a reason to exist: putting
 * one near a rich seam shortens every future trip, at the price of a fragile,
 * valuable building far from home.
 *
 * Workers do not steer themselves. They set a goal and let `movement.ts` do the
 * walking, which means gathering inherits flow-field pathing and separation for
 * free, and there is exactly one place in the codebase that moves anything.
 */

import { buildingDef, type BuildingTypeId } from "../content/buildings.js";
import { UnitType } from "../content/units.js";
import {
  buildingTiles,
  EntityKind,
  isBuilding,
  isComplete,
  isUnit,
  type Entity,
  type WorkerJob,
} from "./entities.js";
import { dist, distSq, fromTiles, tileCenter, toTileIndex } from "./fixed.js";
import { computeFlowField, getFlowField, isReachable, type FlowField } from "./pathing.js";
import { credit, harvestFrom, resourceOfTerrain } from "./resources.js";
import { isPassable, terrainAt } from "./grid.js";
import type { World } from "./world.js";

/** How much a worker carries per trip. */
export const WORKER_CAPACITY = 10;

/** Ticks of work to fill that load — two seconds at 10 Hz. */
export const HARVEST_TICKS = 20;

/** How close a worker must be to work a tile or hand over a load. */
const INTERACT_RANGE = fromTiles(1.4);

/** How far a worker will look for a replacement when its deposit runs dry. */
const RESEEK_RADIUS_TILES = 8;

/** Only workers gather; a soldier told to mine simply does not. */
export function isWorker(entity: Entity): boolean {
  return isUnit(entity) && entity.typeId === UnitType.Worker;
}

export function updateEconomy(world: World): void {
  for (const entity of world.entities.list) {
    if (entity.job === null) continue;
    if (!isWorker(entity)) continue;
    stepWorker(world, entity, entity.job);
  }
}

function stepWorker(world: World, worker: Entity, job: WorkerJob): void {
  if (job.returning) {
    deliver(world, worker, job);
  } else {
    harvest(world, worker, job);
  }
}

/** Walk to the deposit and work it until a load is full. */
function harvest(world: World, worker: Entity, job: WorkerJob): void {
  const nodeX = tileCenter(job.nodeX);
  const nodeY = tileCenter(job.nodeY);

  // The tile may have been stripped by someone else while we walked.
  if (resourceOfTerrain(terrainAt(world.grid, job.nodeX, job.nodeY)) === null) {
    if (!reseek(world, worker, job, job.nodeX, job.nodeY)) finishJob(worker, job);
    return;
  }

  if (dist(worker.x, worker.y, nodeX, nodeY) > INTERACT_RANGE) {
    // Nothing on this side of the map connects to that seam. Left alone this is
    // a *silent* deadlock rather than a slow worker: movement refuses a goal it
    // cannot route to and clears it, this function sees no goal and sets the
    // same one again, and the worker stands pinned until the match ends. Cheap
    // to check, because the field is the very one movement is about to use.
    if (!canReach(world, worker, job.nodeX, job.nodeY)) {
      // Search around the *worker*, not the seam — everything near the seam is
      // just as cut off, and walking the search sideways finds more of it.
      const fromX = toTileIndex(worker.x);
      const fromY = toTileIndex(worker.y);
      if (!reseek(world, worker, job, fromX, fromY)) finishJob(worker, job);
      return;
    }

    // Still on the way. Re-issuing the same goal is harmless and re-arms a
    // worker that gave up after being jostled by the crowd.
    if (worker.goalX === null) {
      worker.goalX = nodeX;
      worker.goalY = nodeY;
      worker.blockedTicks = 0;
    }
    return;
  }

  // Arrived: stop walking and start working.
  worker.goalX = null;
  worker.goalY = null;
  job.harvestTicks++;

  if (job.harvestTicks < HARVEST_TICKS) return;
  job.harvestTicks = 0;

  const taken = harvestFrom(world, job.nodeX, job.nodeY, WORKER_CAPACITY - job.carried);
  if (!taken) {
    if (!reseek(world, worker, job, job.nodeX, job.nodeY)) finishJob(worker, job);
    return;
  }

  job.carrying = taken.resource;
  job.carried += taken.amount;

  if (job.carried >= WORKER_CAPACITY || resourceOfTerrain(terrainAt(world.grid, job.nodeX, job.nodeY)) === null) {
    job.returning = true;
    worker.goalX = null;
  }
}

/** Carry the load to the nearest drop-off and bank it. */
function deliver(world: World, worker: Entity, job: WorkerJob): void {
  const target = nearestDropOff(world, worker);
  if (!target) {
    // Nowhere to put it. Hold the load rather than destroying it — the player
    // may be about to finish a depot.
    worker.goalX = null;
    worker.goalY = null;
    return;
  }

  if (!withinDeliveryRange(worker, target)) {
    if (worker.goalX === null) {
      const approach = approachPoint(world, worker, target);
      if (!approach) return;
      worker.goalX = approach.x;
      worker.goalY = approach.y;
      worker.blockedTicks = 0;
    }
    return;
  }

  if (job.carrying !== null && job.carried > 0) {
    const player = world.players[worker.owner];
    if (player) credit(player, job.carrying, job.carried);
  }

  job.carried = 0;
  job.carrying = null;
  job.returning = false;
  worker.goalX = null;
  worker.goalY = null;

  // Back to the seam — unless it is gone, in which case look for another.
  if (resourceOfTerrain(terrainAt(world.grid, job.nodeX, job.nodeY)) === null) {
    if (!reseek(world, worker, job, job.nodeX, job.nodeY)) finishJob(worker, job);
  }
}

/**
 * Is there a route from where this worker stands to that tile?
 *
 * Uses the shared flow-field cache, so asking costs a lookup for any goal
 * something is already walking to — and reachability is symmetric, so a field
 * built towards the tile answers the question from any starting point.
 */
export function canReach(world: World, worker: Entity, tileX: number, tileY: number): boolean {
  const field = getFlowField(world.fields, world.grid, tileX, tileY);
  return isReachable(field, toTileIndex(worker.x), toTileIndex(worker.y));
}

/**
 * A building counts as reached when the worker touches any tile of its
 * footprint, not its centre — otherwise workers would try to walk *into* a
 * 3x3 headquarters and jam against its edge forever.
 */
function withinDeliveryRange(worker: Entity, building: Entity): boolean {
  const workerTileX = toTileIndex(worker.x);
  const workerTileY = toTileIndex(worker.y);

  for (const tile of buildingTiles(building)) {
    const dx = Math.abs(tile.tileX - workerTileX);
    const dy = Math.abs(tile.tileY - workerTileY);
    if (dx <= 1 && dy <= 1) return true;
  }
  return false;
}

/**
 * The nearest walkable tile touching a building's footprint.
 *
 * Buildings block the ground they stand on, so ordering a worker to a
 * building's centre asks it to walk somewhere it can never reach — the flow
 * field says "unreachable", the worker gives up, and the job silently stalls.
 * Every approach to a building goes through here instead.
 */
export function approachPoint(
  world: World,
  worker: Entity,
  building: Entity,
): { x: number; y: number } | null {
  const tiles = buildingTiles(building);
  let minTileX = Number.POSITIVE_INFINITY;
  let minTileY = Number.POSITIVE_INFINITY;
  let maxTileX = Number.NEGATIVE_INFINITY;
  let maxTileY = Number.NEGATIVE_INFINITY;

  for (const tile of tiles) {
    minTileX = Math.min(minTileX, tile.tileX);
    minTileY = Math.min(minTileY, tile.tileY);
    maxTileX = Math.max(maxTileX, tile.tileX);
    maxTileY = Math.max(maxTileY, tile.tileY);
  }

  let best: { x: number; y: number } | null = null;
  let bestDistanceSq = Number.POSITIVE_INFINITY;

  for (let tileY = minTileY - 1; tileY <= maxTileY + 1; tileY++) {
    for (let tileX = minTileX - 1; tileX <= maxTileX + 1; tileX++) {
      // Only the ring around the footprint, not the footprint itself.
      const insideX = tileX >= minTileX && tileX <= maxTileX;
      const insideY = tileY >= minTileY && tileY <= maxTileY;
      if (insideX && insideY) continue;
      if (!isPassable(world.grid, tileX, tileY)) continue;

      const x = tileCenter(tileX);
      const y = tileCenter(tileY);
      const separationSq = distSq(worker.x, worker.y, x, y);
      if (separationSq < bestDistanceSq) {
        bestDistanceSq = separationSq;
        best = { x, y };
      }
    }
  }

  return best;
}

/** The player's closest finished building that accepts deliveries. */
export function nearestDropOff(world: World, worker: Entity): Entity | null {
  let best: Entity | null = null;
  let bestDistanceSq = Number.POSITIVE_INFINITY;

  for (const entity of world.entities.list) {
    if (!isBuilding(entity)) continue;
    if (entity.owner !== worker.owner) continue;
    // A half-built shell is not a warehouse.
    if (!isComplete(entity)) continue;
    if (!buildingDef(entity.typeId as BuildingTypeId).acceptsDeliveries) continue;

    const separationSq = distSq(worker.x, worker.y, entity.x, entity.y);
    if (separationSq < bestDistanceSq) {
      bestDistanceSq = separationSq;
      best = entity;
    }
  }

  return best;
}

/**
 * Find another deposit of the same resource near a given tile.
 *
 * Without this, felling one tree sends the whole workforce idle and the player
 * has to re-issue orders constantly — busywork that tests nothing but patience.
 * The search is a bounded spiral so it stays cheap and deterministic.
 *
 * The origin is a parameter because the two reasons to re-seek want different
 * ones: an exhausted seam means "more of the same, nearby", while an
 * unreachable seam means "something I can actually walk to from here".
 */
function reseek(
  world: World,
  worker: Entity,
  job: WorkerJob,
  fromX: number,
  fromY: number,
): boolean {
  const wanted = job.carrying;

  // One sweep outward from the worker answers "can I get there?" for every
  // candidate at once. Asking the shared cache per candidate would evict the
  // fields the rest of the army is walking on — that mistake once cost a
  // hundredfold in tick time.
  let routes: FlowField | null = null;
  const reachable = (tileX: number, tileY: number): boolean => {
    routes ??= computeFlowField(world.grid, toTileIndex(worker.x), toTileIndex(worker.y));
    return isReachable(routes, tileX, tileY);
  };

  for (let radius = 1; radius <= RESEEK_RADIUS_TILES; radius++) {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;

        const tileX = fromX + dx;
        const tileY = fromY + dy;
        const resource = resourceOfTerrain(terrainAt(world.grid, tileX, tileY));
        if (resource === null) continue;
        // Prefer the same resource, so a lumberjack does not wander into a mine
        // and quietly change what the player's economy produces.
        if (wanted !== null && resource !== wanted) continue;
        // No point trading one seam we cannot reach for another.
        if (!reachable(tileX, tileY)) continue;

        job.nodeX = tileX;
        job.nodeY = tileY;
        job.harvestTicks = 0;
        worker.goalX = null;
        worker.goalY = null;
        return true;
      }
    }
  }

  return false;
}

/** Drop the job, but keep any load so it can still be delivered. */
function finishJob(worker: Entity, job: WorkerJob): void {
  if (job.carried > 0 && job.carrying !== null) {
    job.returning = true;
    return;
  }
  worker.job = null;
  worker.goalX = null;
  worker.goalY = null;
}

/** Start (or redirect) a gathering job. Returns false if the tile yields nothing. */
export function assignGatherJob(world: World, worker: Entity, tileX: number, tileY: number): boolean {
  if (resourceOfTerrain(terrainAt(world.grid, tileX, tileY)) === null) return false;

  worker.job = {
    nodeX: tileX,
    nodeY: tileY,
    carrying: worker.job?.carrying ?? null,
    carried: worker.job?.carried ?? 0,
    harvestTicks: 0,
    // If the worker is already carrying, let it bank that load first.
    returning: (worker.job?.carried ?? 0) > 0,
  };
  worker.goalX = null;
  worker.goalY = null;
  worker.blockedTicks = 0;
  return true;
}
