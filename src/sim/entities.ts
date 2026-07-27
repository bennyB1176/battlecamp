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

import { buildingDef, type BuildingDef, type BuildingTypeId } from "../content/buildings.js";
import { unitDef, type UnitDef, type UnitTypeId } from "../content/units.js";
import { ONE } from "./fixed.js";
import type { ResourceKind } from "./resources.js";

export type EntityId = number;
export type PlayerId = number;

export const EntityKind = {
  Unit: 0,
  Building: 1,
} as const;

export type EntityKindId = (typeof EntityKind)[keyof typeof EntityKind];

/** Health a fresh entity of this kind and type starts with. */
export function maxHpOf(kind: EntityKindId, typeId: number): number {
  return kind === EntityKind.Building
    ? buildingDef(typeId as BuildingTypeId).maxHp
    : unitDef(typeId as UnitTypeId).maxHp;
}

/** What a worker is currently doing. Null for anything that is not gathering. */
export interface WorkerJob {
  /** Tile being harvested. */
  nodeX: number;
  nodeY: number;
  /** What is in the worker's hands right now. */
  carrying: ResourceKind | null;
  carried: number;
  /** Ticks spent swinging at the current node. */
  harvestTicks: number;
  /** Set while walking a load home, so the worker knows which leg it is on. */
  returning: boolean;
}

/** A building's training queue. Null for buildings that train nothing. */
export interface ProductionState {
  /** Unit types waiting to be trained, in order. */
  queue: UnitTypeId[];
  /** Ticks of work already put into the item at the front. */
  progress: number;
  /** Where finished units are sent, in fixed point. Null means "just outside". */
  rallyX: number | null;
  rallyY: number | null;
}

/** What the caller must supply to create a unit. */
export interface EntitySpec {
  readonly typeId: UnitTypeId;
  readonly owner: PlayerId;
  /** Fixed-point position. */
  readonly x: number;
  readonly y: number;
}

/** What the caller must supply to place a building. */
export interface BuildingSpec {
  readonly typeId: BuildingTypeId;
  readonly owner: PlayerId;
  /** Top-left tile of the footprint. */
  readonly tileX: number;
  readonly tileY: number;
  /** Start as a building site that has to be worked on. Defaults to false. */
  readonly underConstruction?: boolean;
}

export interface Entity {
  readonly id: EntityId;
  readonly kind: EntityKindId;
  /** Indexes UNIT_DEFS or BUILDING_DEFS, depending on `kind`. */
  readonly typeId: number;
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

  /**
   * Remaining build work while this is a construction site; null once finished.
   * Only buildings ever carry a value here.
   */
  construction: number | null;

  /** Gathering state, for workers. Null for everything else. */
  job: WorkerJob | null;

  /** Construction site this worker is helping to finish, if any. */
  buildTargetId: EntityId | null;

  /** Training queue, for buildings that produce units. Null otherwise. */
  production: ProductionState | null;

  /** Standing-order progress, for buildings that refine. Null otherwise. */
  refinery: RefineryState | null;

  /** Enemy this entity was explicitly ordered to attack. */
  attackTargetId: EntityId | null;

  /** Ticks until the weapon can fire again. */
  weaponCooldown: number;

  /**
   * Destination of an attack-move, in fixed point.
   *
   * Distinct from `goalX`/`goalY`: the goal changes constantly as the unit
   * detours to engage things, while this remembers where it was actually
   * heading so it can carry on afterwards.
   */
  attackMoveX: number | null;
  attackMoveY: number | null;
}

export interface RefineryState {
  /** Ticks of work put into the current batch. */
  progress: number;
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
  return push(store, {
    id: store.nextId++,
    kind: EntityKind.Unit,
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
    construction: null,
    job: null,
    buildTargetId: null,
    production: null,
    refinery: null,
    attackTargetId: null,
    weaponCooldown: 0,
    attackMoveX: null,
    attackMoveY: null,
  });
}

/**
 * Place a building, anchored at the top-left tile of its footprint.
 *
 * Its stored position is the centre of that footprint, which is what the
 * spatial hash, rendering and (from M3) targeting all want. Because footprints
 * are whole tiles, the conversion back to the origin tile is exact — see
 * `buildingOrigin`.
 */
export function addBuilding(store: EntityStore, spec: BuildingSpec): Entity {
  const def = buildingDef(spec.typeId);
  const half = (def.footprint * ONE) / 2;
  const x = spec.tileX * ONE + half;
  const y = spec.tileY * ONE + half;

  const underConstruction = spec.underConstruction ?? false;

  return push(store, {
    id: store.nextId++,
    kind: EntityKind.Building,
    typeId: spec.typeId,
    owner: spec.owner,
    x,
    y,
    // A site starts frail and gains health as it is built, so pushing an
    // expansion toward contested ground is a real risk rather than a formality.
    hp: underConstruction ? Math.max(1, Math.floor(def.maxHp / 10)) : def.maxHp,
    prevX: x,
    prevY: y,
    goalX: null,
    goalY: null,
    blockedTicks: 0,
    construction: underConstruction ? def.buildWork : null,
    job: null,
    buildTargetId: null,
    production: def.produces.length > 0 ? { queue: [], progress: 0, rallyX: null, rallyY: null } : null,
    refinery: def.refines ? { progress: 0 } : null,
    attackTargetId: null,
    weaponCooldown: 0,
    attackMoveX: null,
    attackMoveY: null,
  });
}

function push(store: EntityStore, entity: Entity): Entity {
  store.indexById.set(entity.id, store.list.length);
  store.list.push(entity);
  return entity;
}

export function isUnit(entity: Entity): boolean {
  return entity.kind === EntityKind.Unit;
}

export function isBuilding(entity: Entity): boolean {
  return entity.kind === EntityKind.Building;
}

/** True once a building site has been completed. Units are always "finished". */
export function isComplete(entity: Entity): boolean {
  return entity.construction === null;
}

/** The top-left tile of a building's footprint. */
export function buildingOrigin(entity: Entity): { tileX: number; tileY: number } {
  const def = buildingDef(entity.typeId as BuildingTypeId);
  const half = (def.footprint * ONE) / 2;
  return {
    tileX: (entity.x - half) / ONE,
    tileY: (entity.y - half) / ONE,
  };
}

/**
 * The unit definition for an entity that is a unit.
 *
 * `typeId` is a plain number because it indexes two different tables depending
 * on `kind`; these helpers put the narrowing in one place instead of scattering
 * casts across every system.
 */
export function unitDefOf(entity: Entity): UnitDef {
  return unitDef(entity.typeId as UnitTypeId);
}

export function buildingDefOf(entity: Entity): BuildingDef {
  return buildingDef(entity.typeId as BuildingTypeId);
}

/** Body radius in fixed point — a unit's own, or half a building's footprint. */
export function radiusOf(entity: Entity): number {
  return isBuilding(entity)
    ? (buildingDefOf(entity).footprint * ONE) / 2
    : unitDefOf(entity).radius;
}

/** Every tile a building stands on. */
export function buildingTiles(entity: Entity): Array<{ tileX: number; tileY: number }> {
  const def = buildingDef(entity.typeId as BuildingTypeId);
  const origin = buildingOrigin(entity);
  const tiles: Array<{ tileX: number; tileY: number }> = [];

  for (let dy = 0; dy < def.footprint; dy++) {
    for (let dx = 0; dx < def.footprint; dx++) {
      tiles.push({ tileX: origin.tileX + dx, tileY: origin.tileY + dy });
    }
  }
  return tiles;
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
