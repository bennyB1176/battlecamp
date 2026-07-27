/**
 * Unit definitions — pure data, no behaviour.
 *
 * Keeping stats in a table rather than in code is what makes the later
 * milestones cheap: a new faction (M7) is largely a new content file, and
 * balance passes (M5) are edits here rather than edits to systems.
 *
 * Distances and speeds are expressed in tiles for readability and converted to
 * fixed-point units at load time, so nobody has to write `768` when they mean
 * "three tiles".
 */

import { fromTiles } from "../sim/fixed.js";
import { TICKS_PER_SECOND } from "../sim/constants.js";
import { Resource, type Cost } from "../sim/resources.js";

export const UnitType = {
  Worker: 0,
  Soldier: 1,
  Scout: 2,
} as const;

export type UnitTypeId = (typeof UnitType)[keyof typeof UnitType];

export interface UnitDef {
  readonly name: string;
  readonly maxHp: number;
  /** Body radius in fixed units — drives separation and, later, formations. */
  readonly radius: number;
  /** Movement speed in fixed units per tick. */
  readonly speed: number;
  /** Vision radius in fixed units. Unused until fog of war in M6. */
  readonly sight: number;
  readonly cost: Cost;
  /** Ticks of training before the unit walks out. */
  readonly trainTicks: number;
  /**
   * Which silhouette the renderer draws.
   *
   * Shape carries the unit's identity, not colour — colour is reserved for
   * whose side it is on. Swapping in real sprites later means changing what
   * this field selects, and nothing else.
   */
  readonly shape: UnitShape;
}

/** Drawn silhouettes. Each must be recognisable at a glance and from a distance. */
export const UnitShape = {
  /** Round and soft — reads as civilian. */
  Round: "round",
  /** Pointed — reads as fast. */
  Arrow: "arrow",
  /** Broad and flat-fronted — reads as a soldier behind a shield. */
  Shield: "shield",
} as const;

export type UnitShape = (typeof UnitShape)[keyof typeof UnitShape];

/** Helper so the table below can be written in tiles and tiles/second. */
function def(
  name: string,
  maxHp: number,
  radiusTiles: number,
  tilesPerSecond: number,
  sightTiles: number,
  cost: Cost,
  trainSeconds: number,
  shape: UnitShape,
): UnitDef {
  return {
    name,
    maxHp,
    radius: fromTiles(radiusTiles),
    speed: Math.max(1, Math.round(fromTiles(tilesPerSecond) / TICKS_PER_SECOND)),
    sight: fromTiles(sightTiles),
    cost,
    trainTicks: Math.max(1, Math.round(trainSeconds * TICKS_PER_SECOND)),
    shape,
  };
}

export const UNIT_DEFS: Readonly<Record<UnitTypeId, UnitDef>> = {
  // A worker has to pay for itself, or there is no reason ever to stop making
  // them — the cost is what makes "more workers or a forward depot?" a question.
  [UnitType.Worker]: def("Arbeiter", 40, 0.3, 2.4, 5, { [Resource.Wood]: 50 }, 8, UnitShape.Round),
  [UnitType.Soldier]: def(
    "Soldat",
    80,
    0.32,
    3.0,
    6,
    { [Resource.Wood]: 40, [Resource.Ore]: 20 },
    12,
    UnitShape.Shield,
  ),
  [UnitType.Scout]: def("Späher", 50, 0.28, 4.5, 9, { [Resource.Wood]: 60 }, 10, UnitShape.Arrow),
};

export function unitDef(typeId: UnitTypeId): UnitDef {
  return UNIT_DEFS[typeId];
}
