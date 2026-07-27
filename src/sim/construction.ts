/**
 * Placing buildings and putting them up.
 *
 * The rule that shapes play here is the **build radius**: you may only place
 * within reach of a finished building you already own. Without it, a player
 * sprinkles huts across the map and there is nothing to defend; with it, a base
 * is a connected shape, and pushing an expansion outward is a deliberate act of
 * stretching your territory toward contested ground.
 *
 * Two smaller decisions matter as much:
 *
 * - **Only finished buildings extend the radius.** Otherwise a player chains
 *   unfinished shells across the map for free reach — the very base-creep the
 *   rule exists to prevent.
 * - **A site starts frail and hardens as it goes up.** Forward expansion is
 *   then a genuine risk rather than a formality.
 */

import { buildingDef, type BuildingTypeId } from "../content/buildings.js";
import {
  addBuilding,
  buildingOrigin,
  buildingTiles,
  getEntity,
  isBuilding,
  isComplete,
  type Entity,
  type EntityId,
  type PlayerId,
} from "./entities.js";
import { approachPoint, isWorker } from "./economy.js";
import { toTileIndex } from "./fixed.js";
import { isBuildable, isInside, setBlocked } from "./grid.js";
import { canAfford, debit } from "./resources.js";
import type { World } from "./world.js";

/** Build work one worker contributes per tick. */
export const BUILD_WORK_PER_TICK = 2;

/** How close a builder must stand to contribute. */
const BUILD_RANGE_TILES = 1;

export const PlacementError = {
  OutOfMap: "out-of-map",
  BadTerrain: "bad-terrain",
  Occupied: "occupied",
  OutOfRange: "out-of-range",
  TooExpensive: "too-expensive",
} as const;

export type PlacementErrorKind = (typeof PlacementError)[keyof typeof PlacementError];

export interface PlacementResult {
  readonly ok: boolean;
  readonly error?: PlacementErrorKind;
}

/**
 * Is this footprint close enough to something the player already owns?
 *
 * Measured as a square (Chebyshev) reach from each finished building's
 * footprint, which matches how the preview reads on screen — a ring of tiles,
 * not a circle that clips corners in ways nobody can predict by eye.
 */
export function isWithinBuildRadius(
  world: World,
  playerId: PlayerId,
  tileX: number,
  tileY: number,
  footprint: number,
): boolean {
  for (const entity of world.entities.list) {
    if (!isBuilding(entity)) continue;
    if (entity.owner !== playerId) continue;
    if (!isComplete(entity)) continue;

    const def = buildingDef(entity.typeId as BuildingTypeId);
    const origin = buildingOrigin(entity);

    // Expand the existing footprint by its radius, then test for overlap with
    // the proposed footprint.
    const minX = origin.tileX - def.buildRadius;
    const minY = origin.tileY - def.buildRadius;
    const maxX = origin.tileX + def.footprint - 1 + def.buildRadius;
    const maxY = origin.tileY + def.footprint - 1 + def.buildRadius;

    const overlaps =
      tileX <= maxX && tileX + footprint - 1 >= minX && tileY <= maxY && tileY + footprint - 1 >= minY;

    if (overlaps) return true;
  }

  return false;
}

export function canPlace(
  world: World,
  playerId: PlayerId,
  typeId: BuildingTypeId,
  tileX: number,
  tileY: number,
): PlacementResult {
  const def = buildingDef(typeId);

  if (!isInside(world.grid, tileX, tileY) || !isInside(world.grid, tileX + def.footprint - 1, tileY + def.footprint - 1)) {
    return { ok: false, error: PlacementError.OutOfMap };
  }

  // `isBuildable` already rejects tiles a building stands on, so separate the
  // two cases to give the player a message that says which problem it is.
  for (const tile of footprintTiles(tileX, tileY, def.footprint)) {
    if (world.grid.blocked[tile.tileY * world.grid.width + tile.tileX] === 1) {
      return { ok: false, error: PlacementError.Occupied };
    }
  }

  if (!isBuildable(world.grid, tileX, tileY, def.footprint)) {
    return { ok: false, error: PlacementError.BadTerrain };
  }

  if (!isWithinBuildRadius(world, playerId, tileX, tileY, def.footprint)) {
    return { ok: false, error: PlacementError.OutOfRange };
  }

  const player = world.players[playerId];
  if (!player || !canAfford(player, def.cost)) {
    return { ok: false, error: PlacementError.TooExpensive };
  }

  return { ok: true };
}

export interface PlaceOptions {
  /** Skip the cost — used for the starting headquarters and by tests. */
  readonly free?: boolean;
  /** Place it already built, instead of as a site. */
  readonly finished?: boolean;
  /** Skip the build-radius check — the opening headquarters has nothing to grow from. */
  readonly ignoreRadius?: boolean;
}

/**
 * Place a building, or return null and change nothing.
 *
 * All-or-nothing on purpose: a partially applied placement would leave the
 * player charged for something that is not there.
 */
export function placeBuildingAt(
  world: World,
  playerId: PlayerId,
  typeId: BuildingTypeId,
  tileX: number,
  tileY: number,
  options: PlaceOptions = {},
): Entity | null {
  const def = buildingDef(typeId);

  const check = canPlace(world, playerId, typeId, tileX, tileY);
  if (!check.ok) {
    const forgivable =
      (options.free && check.error === PlacementError.TooExpensive) ||
      (options.ignoreRadius && check.error === PlacementError.OutOfRange) ||
      // A world-opening headquarters is placed before anything else exists.
      (options.free && options.finished && check.error === PlacementError.OutOfRange);
    if (!forgivable) return null;
  }

  const player = world.players[playerId];
  if (!options.free) {
    if (!player || !debit(player, def.cost)) return null;
  }

  const entity = addBuilding(world.entities, {
    typeId,
    owner: playerId,
    tileX,
    tileY,
    underConstruction: !options.finished,
  });

  for (const tile of buildingTiles(entity)) {
    setBlocked(world.grid, tile.tileX, tile.tileY, true);
  }
  // Routes that ran through this ground are now wrong.
  world.terrainDirty = true;

  return entity;
}

function footprintTiles(tileX: number, tileY: number, footprint: number): Array<{ tileX: number; tileY: number }> {
  const tiles: Array<{ tileX: number; tileY: number }> = [];
  for (let dy = 0; dy < footprint; dy++) {
    for (let dx = 0; dx < footprint; dx++) {
      tiles.push({ tileX: tileX + dx, tileY: tileY + dy });
    }
  }
  return tiles;
}

/** Send a worker to help finish a construction site. */
export function assignBuildJob(world: World, worker: Entity, targetId: EntityId): boolean {
  const target = getEntity(world.entities, targetId);
  if (!target || !isBuilding(target)) return false;
  if (target.owner !== worker.owner) return false;
  if (isComplete(target)) return false;

  worker.buildTargetId = targetId;
  // Building and gathering are different jobs; taking one drops the other.
  worker.job = null;
  worker.goalX = null;
  worker.goalY = null;
  worker.blockedTicks = 0;
  return true;
}

/** Advance every construction site that has builders standing at it. */
export function updateConstruction(world: World): void {
  for (const entity of world.entities.list) {
    if (entity.buildTargetId === null) continue;
    if (!isWorker(entity)) continue;

    const site = getEntity(world.entities, entity.buildTargetId);
    if (!site || isComplete(site)) {
      entity.buildTargetId = null;
      entity.goalX = null;
      entity.goalY = null;
      continue;
    }

    if (!inBuildRange(entity, site)) {
      if (entity.goalX === null) {
        // Walk to a tile beside the site, never onto it — the footprint is
        // blocked ground the moment the site exists.
        const approach = approachPoint(world, entity, site);
        if (!approach) continue;
        entity.goalX = approach.x;
        entity.goalY = approach.y;
        entity.blockedTicks = 0;
      }
      continue;
    }

    entity.goalX = null;
    entity.goalY = null;
    advanceConstruction(world, site);
  }
}

function advanceConstruction(world: World, site: Entity): void {
  if (site.construction === null) return;

  const def = buildingDef(site.typeId as BuildingTypeId);
  site.construction = Math.max(0, site.construction - BUILD_WORK_PER_TICK);

  // Health tracks progress, so a site is at its most vulnerable when it is
  // least useful.
  const done = 1 - site.construction / def.buildWork;
  site.hp = Math.max(1, Math.round(def.maxHp * (0.1 + 0.9 * done)));

  if (site.construction === 0) {
    site.construction = null;
    site.hp = def.maxHp;
    // A finished building may extend the build radius and change what workers
    // can deliver to, so let the renderer and pathing know.
    world.terrainDirty = true;

    for (const worker of world.entities.list) {
      if (worker.buildTargetId === site.id) {
        worker.buildTargetId = null;
        worker.goalX = null;
        worker.goalY = null;
      }
    }
  }
}

function inBuildRange(worker: Entity, site: Entity): boolean {
  const workerTileX = toTileIndex(worker.x);
  const workerTileY = toTileIndex(worker.y);

  for (const tile of buildingTiles(site)) {
    if (
      Math.abs(tile.tileX - workerTileX) <= BUILD_RANGE_TILES &&
      Math.abs(tile.tileY - workerTileY) <= BUILD_RANGE_TILES
    ) {
      return true;
    }
  }
  return false;
}
