/**
 * Fog of war: who can see what.
 *
 * Two layers per player, and the difference between them is the design:
 *
 * - **explored** is memory. A tile looked at once stays known, and its terrain
 *   is drawn from then on. Nobody forgets where the mountains were.
 * - **visible** is now. Recomputed every tick from what is standing where, and
 *   it decides whether an enemy is drawn at all.
 *
 * Keeping them apart is what makes scouting worth doing twice. The first trip
 * tells you the shape of the map forever; only a second one tells you what is
 * standing on it today. Collapse the two and scouting becomes a chore you do
 * once at the start and never again.
 *
 * Sight is a circle, not a line of sight: no shadow-casting behind ridges. That
 * is a deliberate omission rather than an unfinished one. Blocking terrain would
 * mean a raycast per tile per unit per tick, on a phone, to produce an effect
 * most players read as "the fog is buggy" when a unit fails to see over a rock.
 *
 * The obvious cost worry is recomputing `visible` every tick. It is a stamp of
 * one disc per entity — a few thousand byte writes for a full two-player match —
 * against the alternative of tracking movement deltas, which is more code and
 * more ways to be subtly wrong.
 */

import { buildingDef, type BuildingTypeId } from "../content/buildings.js";
import { unitDef, type UnitTypeId } from "../content/units.js";
import { isBuilding, type Entity, type PlayerId } from "./entities.js";
import { toTiles } from "./fixed.js";
import type { World } from "./world.js";

export interface PlayerVision {
  /** 1 where this player has ever seen the ground. */
  readonly explored: Uint8Array;
  /** 1 where this player can see the ground right now. */
  readonly visible: Uint8Array;
}

export function createVision(width: number, height: number): PlayerVision {
  return { explored: new Uint8Array(width * height), visible: new Uint8Array(width * height) };
}

/** How far this entity sees, in whole tiles. */
export function sightTilesOf(entity: Entity): number {
  if (isBuilding(entity)) {
    const def = buildingDef(entity.typeId as BuildingTypeId);
    // Measured from the footprint's centre, so a wide building has to reach
    // past its own walls before it sees anything at all.
    return Math.floor(toTiles(def.sight) + def.footprint / 2);
  }
  return Math.floor(toTiles(unitDef(entity.typeId as UnitTypeId).sight));
}

export function isVisible(world: World, playerId: PlayerId, tileX: number, tileY: number): boolean {
  const vision = world.vision[playerId];
  if (!vision) return false;
  if (tileX < 0 || tileY < 0 || tileX >= world.grid.width || tileY >= world.grid.height) return false;
  return vision.visible[tileY * world.grid.width + tileX] === 1;
}

export function isExplored(world: World, playerId: PlayerId, tileX: number, tileY: number): boolean {
  const vision = world.vision[playerId];
  if (!vision) return false;
  if (tileX < 0 || tileY < 0 || tileX >= world.grid.width || tileY >= world.grid.height) return false;
  return vision.explored[tileY * world.grid.width + tileX] === 1;
}

/**
 * Can this player see that entity right now?
 *
 * Own things always, unconditionally: a player who cannot find their own army
 * because it walked out of everyone else's sight has been handed a bug, not a
 * rule. Everything else has to be standing on a lit tile.
 */
export function visibleTo(world: World, playerId: PlayerId, entity: Entity): boolean {
  if (entity.owner === playerId) return true;
  return isVisible(world, playerId, toTileIndex(entity.x), toTileIndex(entity.y));
}

function toTileIndex(fixed: number): number {
  return Math.floor(toTiles(fixed));
}

/**
 * Recompute every player's `visible` layer and fold it into `explored`.
 *
 * Cleared and restamped rather than updated in place: a unit that died, was
 * sold, or simply walked must not leave a lit patch behind, and working that
 * out incrementally is where fog-of-war bugs live.
 */
export function updateVision(world: World): void {
  for (const vision of world.vision) vision.visible.fill(0);

  const { width, height } = world.grid;

  for (const entity of world.entities.list) {
    const vision = world.vision[entity.owner];
    if (!vision) continue;

    const radius = sightTilesOf(entity);
    const centreX = toTileIndex(entity.x);
    const centreY = toTileIndex(entity.y);

    const minY = Math.max(0, centreY - radius);
    const maxY = Math.min(height - 1, centreY + radius);
    const minX = Math.max(0, centreX - radius);
    const maxX = Math.min(width - 1, centreX + radius);
    const radiusSq = radius * radius;

    for (let tileY = minY; tileY <= maxY; tileY++) {
      const dy = tileY - centreY;
      const rowStart = tileY * width;
      for (let tileX = minX; tileX <= maxX; tileX++) {
        const dx = tileX - centreX;
        if (dx * dx + dy * dy > radiusSq) continue;

        const index = rowStart + tileX;
        vision.visible[index] = 1;
        vision.explored[index] = 1;
      }
    }
  }
}
