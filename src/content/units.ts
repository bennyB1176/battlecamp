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
  /** Placeholder colour until sprites exist. */
  readonly color: string;
}

/** Helper so the table below can be written in tiles and tiles/second. */
function def(
  name: string,
  maxHp: number,
  radiusTiles: number,
  tilesPerSecond: number,
  sightTiles: number,
  color: string,
): UnitDef {
  return {
    name,
    maxHp,
    radius: fromTiles(radiusTiles),
    speed: Math.max(1, Math.round(fromTiles(tilesPerSecond) / TICKS_PER_SECOND)),
    sight: fromTiles(sightTiles),
    color,
  };
}

export const UNIT_DEFS: Readonly<Record<UnitTypeId, UnitDef>> = {
  [UnitType.Worker]: def("Arbeiter", 40, 0.3, 2.4, 5, "#d9c26a"),
  [UnitType.Soldier]: def("Soldat", 80, 0.32, 3.0, 6, "#c8553d"),
  [UnitType.Scout]: def("Späher", 50, 0.28, 4.5, 9, "#6fb3d9"),
};

export function unitDef(typeId: UnitTypeId): UnitDef {
  return UNIT_DEFS[typeId];
}
