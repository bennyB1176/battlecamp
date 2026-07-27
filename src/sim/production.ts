/**
 * Training units.
 *
 * Resources are charged when an order is *queued*, not when the unit walks out.
 * That is the convention nearly every RTS uses, and for a good reason: paying on
 * completion lets a player queue ten units they cannot afford and pick which to
 * keep, which turns the queue into a free option. Charging up front makes
 * cancelling the honest reverse — the refund goes straight back.
 */

import { unitDef, type UnitTypeId } from "../content/units.js";
import { buildingDefOf, addEntity, buildingTiles, isComplete, type Entity } from "./entities.js";
import { tileCenter } from "./fixed.js";
import { isPassable } from "./grid.js";
import { canAfford, credit, debit, RESOURCE_KINDS } from "./resources.js";
import type { World } from "./world.js";

/** Add a unit to a building's training queue. Returns false if refused. */
export function queueUnit(world: World, building: Entity, unitType: UnitTypeId): boolean {
  const production = building.production;
  if (!production) return false;
  // A half-built headquarters trains nothing.
  if (!isComplete(building)) return false;
  if (!buildingDefOf(building).produces.includes(unitType)) return false;

  const player = world.players[building.owner];
  if (!player) return false;

  const cost = unitDef(unitType).cost;
  if (!canAfford(player, cost)) return false;
  if (!debit(player, cost)) return false;

  production.queue.push(unitType);
  return true;
}

/** Remove the most recently queued unit and refund it. */
export function cancelLastQueued(world: World, building: Entity): boolean {
  const production = building.production;
  if (!production || production.queue.length === 0) return false;

  const removed = production.queue.pop()!;
  // Cancelling the item being worked on also discards its progress; anything
  // else would let a player park a nearly finished unit for free.
  if (production.queue.length === 0) production.progress = 0;

  const player = world.players[building.owner];
  if (player) {
    const cost = unitDef(removed).cost;
    for (const kind of RESOURCE_KINDS) {
      credit(player, kind, cost[kind] ?? 0);
    }
  }
  return true;
}

export function updateProduction(world: World): void {
  for (const building of world.entities.list) {
    const production = building.production;
    if (!production || production.queue.length === 0) continue;
    if (!isComplete(building)) continue;

    const unitType = production.queue[0]!;
    production.progress++;

    if (production.progress < unitDef(unitType).trainTicks) continue;

    const spawn = spawnPoint(world, building);
    if (!spawn) {
      // Completely walled in. Hold the finished unit rather than losing it, and
      // try again next tick.
      production.progress = unitDef(unitType).trainTicks;
      continue;
    }

    production.queue.shift();
    production.progress = 0;

    const unit = addEntity(world.entities, {
      typeId: unitType,
      owner: building.owner,
      x: spawn.x,
      y: spawn.y,
    });

    if (production.rallyX !== null && production.rallyY !== null) {
      unit.goalX = production.rallyX;
      unit.goalY = production.rallyY;
    }
  }
}

/**
 * A walkable tile just outside the building.
 *
 * Spawning on the footprint would put the unit inside blocked ground, where it
 * cannot path out of its own home.
 */
function spawnPoint(world: World, building: Entity): { x: number; y: number } | null {
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

  // Widen the ring until something is free, so a building hemmed in on one side
  // still produces.
  for (let ring = 1; ring <= 4; ring++) {
    for (let tileY = minTileY - ring; tileY <= maxTileY + ring; tileY++) {
      for (let tileX = minTileX - ring; tileX <= maxTileX + ring; tileX++) {
        const onRing =
          tileX === minTileX - ring ||
          tileX === maxTileX + ring ||
          tileY === minTileY - ring ||
          tileY === maxTileY + ring;
        if (!onRing) continue;
        if (!isPassable(world.grid, tileX, tileY)) continue;
        return { x: tileCenter(tileX), y: tileCenter(tileY) };
      }
    }
  }

  return null;
}

/** Where units produced here should head once trained. */
export function setRallyPoint(building: Entity, x: number | null, y: number | null): void {
  if (!building.production) return;
  building.production.rallyX = x;
  building.production.rallyY = y;
}
