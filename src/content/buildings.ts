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
  /** Feeds an army. Produces no goods; it raises the food ceiling. */
  Farm: 6,
  /** Lights a circle. Everything of yours inside it works at full speed. */
  PowerPlant: 7,
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
/**
 * The mark drawn on a building's roof.
 *
 * Colour already says *whose* and cannot be spent on anything else, and a
 * footprint is only two sizes — so with seven building types a base was seven
 * identical coloured blocks. The glyph is the only channel left that says
 * *what*, which makes it the difference between reading a base at a glance and
 * tapping every block to find the smelter.
 *
 * Chosen to be legible as a silhouette at a dozen pixels: no letters, no fine
 * detail, and no two that share an outline.
 */
export const BuildingGlyph = {
  /** A banner: the seat of things. */
  Banner: "banner",
  /** A crate. */
  Crate: "crate",
  /** Rank chevrons. */
  Chevrons: "chevrons",
  /** Battlements. */
  Merlons: "merlons",
  /** An axe. */
  Axe: "axe",
  /** An anvil. */
  Anvil: "anvil",
  /** Three ears of grain. */
  Grain: "grain",
  /** A lightning bolt. */
  Bolt: "bolt",
} as const;

export type BuildingGlyphId = (typeof BuildingGlyph)[keyof typeof BuildingGlyph];

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
  /**
   * How many units this building can feed.
   *
   * A ceiling, not a stock: see `src/sim/food.ts` for why nothing accumulates.
   */
  readonly foodSupply: number;
  /**
   * How far this building's power reaches, in fixed point. Zero for anything
   * that generates none.
   *
   * Deliberately larger than the build radius: a grid worth having stretches
   * wider than the base around it, which is exactly what makes it a target.
   */
  readonly powerRadius: number;
  /** The mark drawn on its roof, so a base can be read without tapping it. */
  readonly glyph: BuildingGlyphId;
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
    // Enough for the opening dozen, and no more. The first minutes must not be
    // a food puzzle; the bill starts biting the moment a player grows.
    foodSupply: 16,
    // The base lights its own yard. Without this every barracks would train at
    // half speed from the first minute, which makes a power plant a mandatory
    // opening rather than a decision — a tax, not a choice. Power starts
    // mattering exactly where a base stops: expansions, forward refineries, and
    // the moment somebody levels the headquarters.
    powerRadius: fromTiles(6),
    glyph: BuildingGlyph.Banner,
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
    foodSupply: 0,
    powerRadius: 0,
    glyph: BuildingGlyph.Crate,
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
    foodSupply: 0,
    powerRadius: 0,
    glyph: BuildingGlyph.Chevrons,
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
    foodSupply: 0,
    powerRadius: 0,
    glyph: BuildingGlyph.Merlons,
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
    powerRadius: 0,
    foodSupply: 0,
    refines: {
      input: Resource.Wood,
      inputAmount: 30,
      output: Resource.Planks,
      outputAmount: 10,
      ticks: 120,
    },
    glyph: BuildingGlyph.Axe,
  },
  [BuildingType.Farm]: {
    name: "Farm",
    footprint: 2,
    maxHp: 380,
    // The cheapest thing in the menu on purpose. Feeding an army has to be the
    // easy answer to a real problem, not another claimant on the same wood.
    cost: { [Resource.Wood]: 80, [Resource.Stone]: 20 },
    buildWork: 140,
    buildRadius: 3,
    acceptsDeliveries: false,
    produces: [],
    armor: Armor.Building,
    weapon: null,
    refines: null,
    foodSupply: 12,
    powerRadius: 0,
    glyph: BuildingGlyph.Grain,
  },
  [BuildingType.PowerPlant]: {
    name: "Kraftwerk",
    footprint: 2,
    maxHp: 440,
    // Cheaper than the two refineries it typically serves, or nobody would ever
    // choose it over simply building a second smelter.
    cost: { [Resource.Wood]: 100, [Resource.Stone]: 90 },
    buildWork: 210,
    buildRadius: 3,
    acceptsDeliveries: false,
    produces: [],
    armor: Armor.Building,
    weapon: null,
    refines: null,
    foodSupply: 0,
    powerRadius: fromTiles(9),
    glyph: BuildingGlyph.Bolt,
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
    powerRadius: 0,
    foodSupply: 0,
    refines: {
      input: Resource.Ore,
      inputAmount: 30,
      output: Resource.Steel,
      outputAmount: 10,
      ticks: 150,
    },
    glyph: BuildingGlyph.Anvil,
  },
};

export function buildingDef(typeId: BuildingTypeId): BuildingDef {
  return BUILDING_DEFS[typeId];
}

/** Build menu order. Explicit so the UI does not depend on object key order. */
export const BUILDABLE: readonly BuildingTypeId[] = [
  BuildingType.Farm,
  BuildingType.Depot,
  BuildingType.Barracks,
  BuildingType.PowerPlant,
  BuildingType.Sawmill,
  BuildingType.Smelter,
  BuildingType.Tower,
];
