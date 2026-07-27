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
import { Armor, DamageType, type ArmorId, type DamageTypeId, type Weapon } from "./combat.js";

export const UnitType = {
  Worker: 0,
  Soldier: 1,
  Scout: 2,
  /** Anti-armour and anti-building. Slow, explosive, poor against infantry. */
  Grenadier: 3,
  /** Heavy and fast, tears through infantry, helpless against grenadiers. */
  Vehicle: 4,
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
  /**
   * Food owed every tick for as long as this unit lives.
   *
   * The only recurring cost in the game. Workers eat least on purpose: a rule
   * that punished building an economy would be the exact opposite of what this
   * one is for.
   */
  readonly upkeep: number;
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
  readonly armor: ArmorId;
  /** Null for anything that cannot fight at all. */
  readonly weapon: Weapon | null;
}

/** Drawn silhouettes. Each must be recognisable at a glance and from a distance. */
export const UnitShape = {
  /** Round and soft — reads as civilian. */
  Round: "round",
  /** Pointed — reads as fast. */
  Arrow: "arrow",
  /** Broad and flat-fronted — reads as a soldier behind a shield. */
  Shield: "shield",
  /** Blunt and heavy-set — reads as someone carrying something explosive. */
  Wedge: "wedge",
  /** Angular hull — reads as a machine, not a person. */
  Hull: "hull",
} as const;

export type UnitShape = (typeof UnitShape)[keyof typeof UnitShape];

/** Build a weapon, taking reach in tiles and rate of fire in seconds. */
function weapon(
  damage: number,
  damageType: DamageTypeId,
  rangeTiles: number,
  cooldownSeconds: number,
): Weapon {
  return {
    damage,
    damageType,
    range: fromTiles(rangeTiles),
    cooldownTicks: Math.max(1, Math.round(cooldownSeconds * TICKS_PER_SECOND)),
  };
}

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
  armor: ArmorId,
  weaponDef: Weapon | null,
  /** Food owed per tick. Last because it is the newest, not the least important. */
  upkeep: number,
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
    armor,
    weapon: weaponDef,
    upkeep,
  };
}

export const UNIT_DEFS: Readonly<Record<UnitTypeId, UnitDef>> = {
  // A worker has to pay for itself, or there is no reason ever to stop making
  // them — the cost is what makes "more workers or a forward depot?" a question.
  // It also carries a feeble weapon: an economy that cannot defend itself at all
  // means one raider ends the game.
  [UnitType.Worker]: def(
    "Arbeiter",
    40,
    0.3,
    2.4,
    5,
    { [Resource.Wood]: 50 },
    8,
    UnitShape.Round,
    Armor.Light,
    weapon(3, DamageType.Normal, 0.8, 1.2),
    // eats least: the rule must not punish building an economy
    1,
  ),
  [UnitType.Soldier]: def(
    "Soldat",
    80,
    0.32,
    3.0,
    6,
    { [Resource.Wood]: 40, [Resource.Ore]: 20 },
    12,
    UnitShape.Shield,
    Armor.Light,
    weapon(9, DamageType.Normal, 1.6, 0.8),
    2,
  ),
  // Sight far beyond its reach: the scout's job is to find things, not fight.
  [UnitType.Scout]: def(
    "Späher",
    50,
    0.28,
    4.5,
    9,
    { [Resource.Wood]: 60 },
    10,
    UnitShape.Arrow,
    Armor.Light,
    weapon(5, DamageType.Piercing, 1.4, 1.0),
    // cheap to keep, so scouting stays affordable
    1,
  ),
  [UnitType.Grenadier]: def(
    "Grenadier",
    90,
    0.34,
    2.2,
    6,
    { [Resource.Wood]: 50, [Resource.Ore]: 45 },
    18,
    UnitShape.Wedge,
    Armor.Medium,
    weapon(16, DamageType.Explosive, 2.2, 1.8),
    2,
  ),
  [UnitType.Vehicle]: def(
    "Panzerwagen",
    180,
    0.42,
    3.6,
    7,
    // Steel, not ore: the heaviest thing in the game is the one that has to be
    // planned for. A player who never built a smelter simply cannot field it,
    // however much raw ore they are sitting on.
    { [Resource.Wood]: 60, [Resource.Stone]: 30, [Resource.Steel]: 40 },
    26,
    UnitShape.Hull,
    Armor.Heavy,
    weapon(14, DamageType.Piercing, 2.0, 0.9),
    // the heaviest thing in the game is also the hungriest
    4,
  ),
};

export function unitDef(typeId: UnitTypeId): UnitDef {
  return UNIT_DEFS[typeId];
}
