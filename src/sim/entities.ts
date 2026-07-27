/**
 * The entity store: every unit (and, from M2, every building) in the world.
 *
 * Two design choices worth stating:
 *
 * **Ids are never reused.** A monotonically increasing counter means an order
 * still holding the id of a destroyed unit resolves to `undefined` rather than
 * to whoever happened to take its slot. In a lockstep game that difference is
 * not a cosmetic bug — it is a desync.
 *
 * **The list stays dense.** Systems iterate `store.list` directly every tick,
 * so it must not develop holes. Removal swaps the last entity into the gap and
 * repairs the index map, which is O(1) and — crucially — deterministic: the same
 * sequence of operations always yields the same order, on every machine.
 */

import { unitDef, type UnitTypeId } from "../content/units.js";

export type EntityId = number;
export type PlayerId = number;

/** What the caller must supply to create an entity. */
export interface EntitySpec {
  readonly typeId: UnitTypeId;
  readonly owner: PlayerId;
  /** Fixed-point position. */
  readonly x: number;
  readonly y: number;
}

export interface Entity {
  readonly id: EntityId;
  readonly typeId: UnitTypeId;
  readonly owner: PlayerId;

  /** Fixed-point position. */
  x: number;
  y: number;

  hp: number;

  /**
   * Position at the end of the previous tick, used by the renderer to
   * interpolate at display rate. Cosmetic only — deliberately excluded from the
   * world hash, since it is fully derived from last tick's position.
   */
  prevX: number;
  prevY: number;

  /** Fixed-point movement target, or null when the unit is idle. */
  goalX: number | null;
  goalY: number | null;

  /**
   * Consecutive ticks this unit has failed to make meaningful progress.
   * Drives the "the spot is taken, stop shoving" rule in movement.ts.
   */
  blockedTicks: number;
}

export interface EntityStore {
  /** Dense, hole-free, deterministically ordered. Iterate this directly. */
  readonly list: Entity[];
  readonly indexById: Map<EntityId, number>;
  nextId: EntityId;
}

export function createEntityStore(): EntityStore {
  // Ids start at 1 so that 0 can mean "nothing" without ambiguity.
  return { list: [], indexById: new Map(), nextId: 1 };
}

export function addEntity(store: EntityStore, spec: EntitySpec): Entity {
  const entity: Entity = {
    id: store.nextId++,
    typeId: spec.typeId,
    owner: spec.owner,
    x: spec.x,
    y: spec.y,
    hp: unitDef(spec.typeId).maxHp,
    prevX: spec.x,
    prevY: spec.y,
    goalX: null,
    goalY: null,
    blockedTicks: 0,
  };

  store.indexById.set(entity.id, store.list.length);
  store.list.push(entity);
  return entity;
}

export function getEntity(store: EntityStore, id: EntityId): Entity | undefined {
  const index = store.indexById.get(id);
  return index === undefined ? undefined : store.list[index];
}

export function entityCount(store: EntityStore): number {
  return store.list.length;
}

/** Returns false when the id was already gone, so callers can stay quiet about it. */
export function removeEntity(store: EntityStore, id: EntityId): boolean {
  const index = store.indexById.get(id);
  if (index === undefined) return false;

  const last = store.list.length - 1;
  if (index !== last) {
    // Swap-remove: move the final entity into the gap and fix its index.
    const moved = store.list[last]!;
    store.list[index] = moved;
    store.indexById.set(moved.id, index);
  }

  store.list.pop();
  store.indexById.delete(id);
  return true;
}
