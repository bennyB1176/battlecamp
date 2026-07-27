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
import { tileCenter, toTileIndex } from "./fixed.js";
import {
  findRegionFrom,
  isBuildable,
  isInside,
  isPassable,
  regionAtLeast,
  setBlocked,
} from "./grid.js";
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
  Severs: "severs",
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

  // Checked before the price, so a player is told the site is impossible rather
  // than being told to come back with more wood for a site that will never work.
  if (seversMap(world, tileX, tileY, def.footprint)) {
    return { ok: false, error: PlacementError.Severs };
  }

  const player = world.players[playerId];
  if (!player || !canAfford(player, def.cost)) {
    return { ok: false, error: PlacementError.TooExpensive };
  }

  return { ok: true };
}

/**
 * Would this footprint close the last route between two parts of the map?
 *
 * A building is not a wall. Allowing one to become a wall costs more than it
 * sounds: three of eight twenty-minute bot matches ended nil-all with both
 * economies humming, because a barracks had been dropped across a two-tile neck
 * and neither army could ever reach the other again. Whether a player *should*
 * be able to seal a choke is a fair question for a later milestone; a match
 * nobody can win is not a matter of taste.
 *
 * Any severing has to separate two tiles adjacent to the footprint — everywhere
 * else the map is untouched. So it is enough to walk outward from one of them
 * and check the rest are still there: one flood fill, and only on placement.
 */
function seversMap(world: World, tileX: number, tileY: number, footprint: number): boolean {
  const neighbours: Array<[number, number]> = [];
  for (let dy = -1; dy <= footprint; dy++) {
    for (let dx = -1; dx <= footprint; dx++) {
      const insideX = dx >= 0 && dx < footprint;
      const insideY = dy >= 0 && dy < footprint;
      if (insideX && insideY) continue;

      const x = tileX + dx;
      const y = tileY + dy;
      if (isPassable(world.grid, x, y)) neighbours.push([x, y]);
    }
  }

  if (neighbours.length < 2) return false;

  const [startX, startY] = neighbours[0]!;
  const reachable = findRegionFrom(world.grid, startX, startY, {
    tileX,
    tileY,
    size: footprint,
  });

  for (let index = 1; index < neighbours.length; index++) {
    const [x, y] = neighbours[index]!;
    if (reachable[y * world.grid.width + x] !== 1) return true;
  }

  return false;
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

  evictUnits(world, entity);

  return entity;
}

/**
 * Move anyone standing where the building just went.
 *
 * Nothing stops a player — or a bot — from putting a barracks down on top of
 * their own workers, and movement will not carry a unit out of solid ground
 * once it is in there: every step is refused, so it is walled in for good. In a
 * headless match this showed up as an opponent that could not be finished off,
 * because the last two units were sealed inside their own building where no
 * enemy could reach them.
 */
function evictUnits(world: World, building: Entity): void {
  const origin = buildingOrigin(building);
  const footprint = buildingDef(building.typeId as BuildingTypeId).footprint;

  for (const entity of world.entities.list) {
    if (isBuilding(entity)) continue;

    const tileX = toTileIndex(entity.x);
    const tileY = toTileIndex(entity.y);
    const insideX = tileX >= origin.tileX && tileX < origin.tileX + footprint;
    const insideY = tileY >= origin.tileY && tileY < origin.tileY + footprint;
    if (!insideX || !insideY) continue;

    const spot = nearestOpenTile(world, tileX, tileY);
    if (!spot) continue;

    entity.x = tileCenter(spot.tileX);
    entity.y = tileCenter(spot.tileY);
    entity.prevX = entity.x;
    entity.prevY = entity.y;
  }
}

/** The closest walkable tile with room to move on from, spiralling outward. */
function nearestOpenTile(
  world: World,
  fromX: number,
  fromY: number,
): { tileX: number; tileY: number } | null {
  for (let radius = 1; radius <= 6; radius++) {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;

        const tileX = fromX + dx;
        const tileY = fromY + dy;
        if (!isPassable(world.grid, tileX, tileY)) continue;
        // Somewhere with a way out, not the next dead end along.
        if (!regionAtLeast(world.grid, tileX, tileY, EVICTION_ROOM_TILES)) continue;
        return { tileX, tileY };
      }
    }
  }
  return null;
}

/** Open ground an evicted unit must be able to reach from where it is put. */
const EVICTION_ROOM_TILES = 8;

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
