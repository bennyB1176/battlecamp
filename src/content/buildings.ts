/**
 * Building definitions — pure data, like `units.ts`.
 *
 * M2 keeps the list deliberately short. Two buildings are enough to create the
 * milestone's real decision: the headquarters you start with, and a depot you
 * choose where to put. Because gathering is a round trip, a depot near a rich
 * seam speeds the economy up — and puts a fragile, valuable thing far from
 * home. That trade-off is the whole point; more building types before it works
 * would just be more menu.
 *
 * Production buildings and defences arrive in M3, refinement chains in M5.
 */

import { Resource, type Cost } from "../sim/resources.js";
import { UnitType, type UnitTypeId } from "./units.js";

export const BuildingType = {
  Headquarters: 0,
  Depot: 1,
} as const;

export type BuildingTypeId = (typeof BuildingType)[keyof typeof BuildingType];

export interface BuildingDef {
  readonly name: string;
  /** Edge length in tiles. Buildings are square. */
  readonly footprint: number;
  readonly maxHp: number;
  readonly cost: Cost;
  /** Work units a builder must put in. Builders contribute one per tick. */
  readonly buildWork: number;
  /**
   * How far, in tiles beyond its own footprint, this building extends the area
   * where the player may place the next one.
   *
   * This is the rule that makes a base a connected, defensible thing instead of
   * huts scattered across the map — and it makes a forward depot the deliberate
   * act of stretching your territory toward something contested.
   */
  readonly buildRadius: number;
  /** Whether workers can deliver a load here. */
  readonly acceptsDeliveries: boolean;
  /** Unit types this building can train. */
  readonly produces: readonly UnitTypeId[];
  readonly color: string;
}

export const BUILDING_DEFS: Readonly<Record<BuildingTypeId, BuildingDef>> = {
  [BuildingType.Headquarters]: {
    name: "Hauptquartier",
    footprint: 3,
    maxHp: 1500,
    cost: { [Resource.Wood]: 400, [Resource.Stone]: 250 },
    buildWork: 400,
    buildRadius: 7,
    acceptsDeliveries: true,
    produces: [UnitType.Worker],
    color: "#8c7ab8",
  },
  [BuildingType.Depot]: {
    name: "Lager",
    footprint: 2,
    maxHp: 500,
    cost: { [Resource.Wood]: 120, [Resource.Stone]: 40 },
    buildWork: 150,
    buildRadius: 4,
    acceptsDeliveries: true,
    produces: [],
    color: "#b8975a",
  },
};

export function buildingDef(typeId: BuildingTypeId): BuildingDef {
  return BUILDING_DEFS[typeId];
}

/** Build menu order. Explicit so the UI does not depend on object key order. */
export const BUILDABLE: readonly BuildingTypeId[] = [BuildingType.Depot];
