/**
 * Which of my units are highlighted.
 *
 * This is view state, not world state, and deliberately so: a replay has no
 * reason to record what I had selected, and multiplayer clients have no reason
 * to agree on it. Keeping it out of the simulation also keeps the world hash
 * free of something that changes on every tap.
 *
 * Selection stores ids rather than entity references, so a unit that dies while
 * selected simply stops resolving instead of leaving a dangling object alive.
 */

import type { Entity, EntityId, PlayerId } from "../sim/entities.js";
import { getEntity, isBuilding, radiusOf } from "../sim/entities.js";
import { distSq, ONE } from "../sim/fixed.js";
import type { World } from "../sim/world.js";

/**
 * Minimum tap radius, regardless of how small the unit is.
 *
 * A soldier is roughly a third of a tile across; a fingertip on a phone covers
 * several. Requiring a pixel-accurate tap would make the game unplayable on the
 * device it is being built for.
 */
const MIN_TAP_RADIUS = Math.floor(ONE * 0.7);

export interface Selection {
  readonly ids: Set<EntityId>;
}

export function createSelection(): Selection {
  return { ids: new Set() };
}

export function clearSelection(selection: Selection): void {
  selection.ids.clear();
}

export function isSelected(selection: Selection, id: EntityId): boolean {
  return selection.ids.has(id);
}

/** Resolve the selection to live entities, skipping any that have died. */
export function selectedEntities(selection: Selection, world: World): Entity[] {
  const result: Entity[] = [];
  for (const id of selection.ids) {
    const entity = getEntity(world.entities, id);
    if (entity) result.push(entity);
  }
  return result;
}

/** Drop ids whose entities are gone. Cheap, and worth doing once per frame. */
export function pruneSelection(selection: Selection, world: World): void {
  for (const id of selection.ids) {
    if (!getEntity(world.entities, id)) selection.ids.delete(id);
  }
}

/**
 * Select the single unit under a tap, replacing whatever was selected.
 * Returns false when the tap hit no unit of the player's, so the caller can
 * treat it as a ground tap instead.
 */
export function selectAt(
  selection: Selection,
  world: World,
  x: number,
  y: number,
  playerId: PlayerId,
): boolean {
  let best: Entity | null = null;
  let bestDistanceSq = Number.POSITIVE_INFINITY;

  for (const entity of world.entities.list) {
    if (entity.owner !== playerId) continue;

    const reach = Math.max(radiusOf(entity), MIN_TAP_RADIUS);
    const separationSq = distSq(entity.x, entity.y, x, y);
    if (separationSq > reach * reach) continue;

    // Several units can sit under one fingertip; the closest is the one meant.
    if (separationSq < bestDistanceSq) {
      bestDistanceSq = separationSq;
      best = entity;
    }
  }

  if (!best) return false;

  selection.ids.clear();
  selection.ids.add(best.id);
  return true;
}

/**
 * Select every one of the player's units inside a rectangle.
 * Corners may arrive in any order — a drag up and to the left is just as valid.
 */
export function selectInBox(
  selection: Selection,
  world: World,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  playerId: PlayerId,
): void {
  const minX = Math.min(x0, x1);
  const maxX = Math.max(x0, x1);
  const minY = Math.min(y0, y1);
  const maxY = Math.max(y0, y1);

  selection.ids.clear();

  for (const entity of world.entities.list) {
    if (entity.owner !== playerId) continue;
    // A box drag means "these troops", not "and also the headquarters they
    // happened to be standing next to" — buildings are selected by tapping.
    if (isBuilding(entity)) continue;
    if (entity.x < minX || entity.x > maxX) continue;
    if (entity.y < minY || entity.y > maxY) continue;
    selection.ids.add(entity.id);
  }
}
