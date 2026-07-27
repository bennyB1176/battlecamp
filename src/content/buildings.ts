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

import { fromTiles } from "../sim/fixed.js";
import { Resource, type Cost, type ResourceKind } from "../sim/resources.js";
import { Armor, DamageType, type ArmorId, type Weapon } from "./combat.js";
import { UnitType, type UnitTypeId } from "./units.js";

export const BuildingType = {
  Headquarters: 0,
  Depot: 1,
  /** Static defence: out-ranges infantry, cannot chase anything. */
  Tower: 2,
  /** Trains fighting units. */
  Barracks: 3,
  /** Refines wood into planks. */
  Sawmill: 4,
  /** Refines ore into steel. */
  Smelter: 5,
} as const;

export type BuildingTypeId = (typeof BuildingType)[keyof typeof BuildingType];

/**
 * A standing order this building works through, over and over.
 *
 * Both sides of it are the player's single global pool: no carts, no storage to
 * route between. What makes a refinery a decision is therefore not logistics but
 * *opportunity* — the wood it eats is wood not spent on units, and the building
 * itself is more ground to defend.
 */
export interface Recipe {
  readonly input: ResourceKind;
  readonly inputAmount: number;
  readonly output: ResourceKind;
  readonly outputAmount: number;
  /** Ticks per batch. */
  readonly ticks: number;
}

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
  readonly armor: ArmorId;
  /** Null for anything that cannot shoot back. */
  readonly weapon: Weapon | null;
  /** What this building converts, or null if it converts nothing. */
  readonly refines: Recipe | null;
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
    armor: Armor.Building,
    weapon: null,
    refines: null,
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
    armor: Armor.Building,
    weapon: null,
    refines: null,
  },
  [BuildingType.Barracks]: {
    name: "Kaserne",
    footprint: 2,
    maxHp: 700,
    cost: { [Resource.Wood]: 180, [Resource.Stone]: 60 },
    buildWork: 220,
    buildRadius: 4,
    acceptsDeliveries: false,
    produces: [UnitType.Soldier, UnitType.Grenadier, UnitType.Vehicle],
    armor: Armor.Building,
    weapon: null,
    refines: null,
  },
  [BuildingType.Tower]: {
    name: "Turm",
    footprint: 1,
    maxHp: 420,
    cost: { [Resource.Wood]: 60, [Resource.Stone]: 110 },
    buildWork: 180,
    // A small radius: a tower defends ground you already hold, it does not
    // claim new ground. Otherwise towers become a creeping siege weapon.
    buildRadius: 2,
    acceptsDeliveries: false,
    produces: [],
    armor: Armor.Building,
    // Out-ranges infantry on purpose. A tower a soldier can stand outside of
    // and shoot is not a defence, it is a target.
    weapon: { damage: 12, damageType: DamageType.Piercing, range: fromTiles(4.5), cooldownTicks: 8 },
    refines: null,
  },
  [BuildingType.Sawmill]: {
    name: "Sägewerk",
    footprint: 2,
    maxHp: 480,
    cost: { [Resource.Wood]: 140, [Resource.Stone]: 60 },
    buildWork: 200,
    buildRadius: 3,
    acceptsDeliveries: false,
    produces: [],
    armor: Armor.Building,
    weapon: null,
    // Twelve seconds a batch. Slow enough that one sawmill is a commitment
    // rather than a formality, fast enough to matter inside a fifteen-minute
    // match.
    refines: {
      input: Resource.Wood,
      inputAmount: 30,
      output: Resource.Planks,
      outputAmount: 10,
      ticks: 120,
    },
  },
  [BuildingType.Smelter]: {
    name: "Schmelze",
    footprint: 2,
    maxHp: 520,
    cost: { [Resource.Wood]: 120, [Resource.Stone]: 120 },
    buildWork: 240,
    buildRadius: 3,
    acceptsDeliveries: false,
    produces: [],
    armor: Armor.Building,
    weapon: null,
    refines: {
      input: Resource.Ore,
      inputAmount: 30,
      output: Resource.Steel,
      outputAmount: 10,
      ticks: 150,
    },
  },
};

export function buildingDef(typeId: BuildingTypeId): BuildingDef {
  return BUILDING_DEFS[typeId];
}

/** Build menu order. Explicit so the UI does not depend on object key order. */
export const BUILDABLE: readonly BuildingTypeId[] = [
  BuildingType.Depot,
  BuildingType.Barracks,
  BuildingType.Sawmill,
  BuildingType.Smelter,
  BuildingType.Tower,
];
