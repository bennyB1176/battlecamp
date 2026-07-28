/**
 * What the legend says, derived from the game's own tables.
 *
 * Every number and every matchup here is *computed* from `content/`, never
 * written out by hand. Change a unit's cost, retune the damage matrix, add a
 * building — the help page follows automatically.
 *
 * This is the whole reason the legend lives inside the game rather than in a
 * wiki: hand-maintained documentation of a system that is still being balanced
 * is wrong within a week, and worse than none, because it is believed.
 *
 * Pure data, no DOM, so it can be tested directly.
 */

import {
  BUILDING_DEFS,
  buildingDef,
  type BuildingGlyphId,
  type BuildingTypeId,
  type Recipe,
} from "../content/buildings.js";
import {
  ARMOR_KINDS,
  ARMOR_NAMES,
  DAMAGE_MULTIPLIERS,
  DAMAGE_TYPE_NAMES,
  type ArmorId,
} from "../content/combat.js";
import { UNIT_DEFS, unitDef, type UnitTypeId } from "../content/units.js";
import { TICKS_PER_SECOND } from "../sim/constants.js";
import { toTiles } from "../sim/fixed.js";
import {
  resourceOfTerrain,
  RESOURCE_COLORS,
  RESOURCE_KINDS,
  RESOURCE_NAMES,
  type Cost,
  type ResourceKind,
} from "../sim/resources.js";
import { TERRAIN_INFO, type TerrainType } from "../sim/grid.js";

/** A multiplier at or above this reads as "this is what the weapon is for". */
const STRONG = 110;
/** At or below this, the weapon is being wasted. */
const WEAK = 60;

export interface UnitEntry {
  readonly typeId: UnitTypeId;
  readonly name: string;
  readonly shape: string;
  readonly hp: number;
  readonly armorName: string;
  readonly costText: string;
  /** Tiles per second, rounded for reading. */
  readonly speedText: string;
  readonly sightText: string;
  /** Null for anything that cannot fight. */
  readonly weaponText: string | null;
  /** Armour classes this unit's weapon is made for. */
  readonly strongAgainst: readonly string[];
  /** Armour classes it is wasted on. */
  readonly weakAgainst: readonly string[];
  readonly role: string;
}

export interface BuildingEntry {
  readonly typeId: BuildingTypeId;
  readonly name: string;
  readonly footprint: number;
  readonly glyph: BuildingGlyphId;
  readonly hp: number;
  readonly costText: string;
  readonly buildRadius: number;
  readonly trains: readonly string[];
  readonly acceptsDeliveries: boolean;
  readonly weaponText: string | null;
  /** What it converts, or null when it converts nothing. */
  readonly refinesText: string | null;
  /** How many units it feeds, or null when it feeds none. */
  readonly foodText: string | null;
  /** How far its power reaches, or null when it generates none. */
  readonly powerText: string | null;
}

/**
 * A recipe in one line: "30 Holz → 10 Bretter, alle 12 s".
 *
 * Worth spelling out because refining is the one mechanic with no feedback on
 * the map at all — no worker walks anywhere, the goods simply appear in a
 * number at the top of the screen. A player who cannot see the rate cannot
 * judge whether a second sawmill is worth more than ten more soldiers.
 */
function describeRecipe(recipe: Recipe): string {
  const seconds = (recipe.ticks / TICKS_PER_SECOND).toFixed(0);
  return (
    `${recipe.inputAmount} ${RESOURCE_NAMES[recipe.input]} → ` +
    `${recipe.outputAmount} ${RESOURCE_NAMES[recipe.output]}, alle ${seconds} s`
  );
}

export function formatCost(cost: Cost): string {
  const parts = RESOURCE_KINDS.filter((kind) => (cost[kind] ?? 0) > 0).map(
    (kind) => `${cost[kind]} ${RESOURCE_NAMES[kind]}`,
  );
  return parts.length > 0 ? parts.join(" · ") : "kostenlos";
}

/** A one-line description of what a weapon does, in the player's units. */
function describeWeapon(damage: number, damageType: number, range: number, cooldownTicks: number): string {
  const perSecond = ((damage * TICKS_PER_SECOND) / cooldownTicks).toFixed(1);
  return `${damage} ${DAMAGE_TYPE_NAMES[damageType as never]} · ${toTiles(range).toFixed(1)} Kacheln · ≈${perSecond}/s`;
}

function armorNamesWhere(damageType: number, predicate: (multiplier: number) => boolean): string[] {
  const row = DAMAGE_MULTIPLIERS[damageType as never] as Readonly<Record<ArmorId, number>>;
  return ARMOR_KINDS.filter((armor) => predicate(row[armor])).map((armor) => ARMOR_NAMES[armor]);
}

/**
 * A short plain-language role, decided by what the unit can actually do rather
 * than by a label someone typed next to it.
 */
function roleOf(typeId: UnitTypeId): string {
  const def = unitDef(typeId);
  if (!def.weapon) return "kämpft nicht";

  const canGather = typeId === 0;
  if (canGather) return "baut ab und baut auf, wehrt sich notdürftig";

  // A scout sees *far* beyond its reach. The threshold has to be strict: at a
  // ratio of three, a vehicle qualifies too, and calling the heaviest unit in
  // the game a scout is exactly the kind of wrong the legend must never be.
  if (def.sight >= def.weapon.range * 4) return "Aufklärung — sieht viel weiter, als er schießt";
  if (armorNamesWhere(def.weapon.damageType, (m) => m >= STRONG).length === 0) return "Allzweck-Infanterie";
  return `stark gegen ${armorNamesWhere(def.weapon.damageType, (m) => m >= STRONG).join(" und ")}`;
}

export function unitEntries(): UnitEntry[] {
  return (Object.keys(UNIT_DEFS) as unknown as UnitTypeId[])
    .map((key) => Number(key) as UnitTypeId)
    .map((typeId) => {
      const def = unitDef(typeId);
      return {
        typeId,
        name: def.name,
        shape: def.shape,
        hp: def.maxHp,
        armorName: ARMOR_NAMES[def.armor],
        costText: formatCost(def.cost),
        speedText: `${((def.speed * TICKS_PER_SECOND) / 256).toFixed(1)} Kacheln/s`,
        sightText: `${toTiles(def.sight).toFixed(0)} Kacheln`,
        weaponText: def.weapon
          ? describeWeapon(def.weapon.damage, def.weapon.damageType, def.weapon.range, def.weapon.cooldownTicks)
          : null,
        strongAgainst: def.weapon ? armorNamesWhere(def.weapon.damageType, (m) => m >= STRONG) : [],
        weakAgainst: def.weapon ? armorNamesWhere(def.weapon.damageType, (m) => m <= WEAK) : [],
        role: roleOf(typeId),
      };
    });
}

export function buildingEntries(): BuildingEntry[] {
  return (Object.keys(BUILDING_DEFS) as unknown as BuildingTypeId[])
    .map((key) => Number(key) as BuildingTypeId)
    .map((typeId) => {
      const def = buildingDef(typeId);
      return {
        typeId,
        name: def.name,
        footprint: def.footprint,
        glyph: def.glyph,
        hp: def.maxHp,
        costText: formatCost(def.cost),
        buildRadius: def.buildRadius,
        trains: def.produces.map((unitType) => unitDef(unitType).name),
        acceptsDeliveries: def.acceptsDeliveries,
        weaponText: def.weapon
          ? describeWeapon(def.weapon.damage, def.weapon.damageType, def.weapon.range, def.weapon.cooldownTicks)
          : null,
        refinesText: def.refines ? describeRecipe(def.refines) : null,
        foodText: def.foodSupply > 0 ? `versorgt ${def.foodSupply} Nahrung` : null,
        powerText:
          def.powerRadius > 0 ? `${toTiles(def.powerRadius).toFixed(0)} Kacheln Umkreis` : null,
      };
    });
}

export interface ResourceEntry {
  readonly name: string;
  readonly color: string;
  /** Where it comes from: the terrain that holds it, or the building that makes it. */
  readonly from: string;
}

/**
 * Every resource, with its swatch and its source.
 *
 * Derived rather than listed. The hand-written version of this was three
 * entries with the colours copied out of the stylesheet by hand; the moment
 * planks and steel existed it was silently two short and two colours out of
 * date, while still looking authoritative. That is the failure mode this whole
 * file exists to prevent.
 */
export function resourceEntries(): ResourceEntry[] {
  return RESOURCE_KINDS.map((kind) => ({
    name: RESOURCE_NAMES[kind],
    color: RESOURCE_COLORS[kind],
    from: sourceOf(kind),
  }));
}

/** The terrain a resource is dug out of, or the building that refines it. */
function sourceOf(kind: ResourceKind): string {
  for (const terrain of Object.keys(TERRAIN_INFO).map(Number) as TerrainType[]) {
    if (resourceOfTerrain(terrain) === kind) return TERRAIN_INFO[terrain].name;
  }

  for (const typeId of Object.keys(BUILDING_DEFS).map(Number) as BuildingTypeId[]) {
    if (buildingDef(typeId).refines?.output === kind) return buildingDef(typeId).name;
  }

  return "—";
}

export interface CounterEntry {
  readonly attacker: string;
  readonly beats: string;
  readonly losesTo: string;
}

/**
 * The counter triangle, worked out from the matrix rather than stated.
 *
 * If somebody retunes the numbers so a matchup flips, this page flips with it
 * — which is exactly what documentation of a system under balancing has to do.
 */
export function counterTriangle(fighters: readonly UnitTypeId[]): CounterEntry[] {
  const effectiveness = (attacker: UnitTypeId, defender: UnitTypeId): number => {
    const weapon = unitDef(attacker).weapon;
    if (!weapon) return 0;
    return DAMAGE_MULTIPLIERS[weapon.damageType][unitDef(defender).armor];
  };

  return fighters.map((attacker) => {
    let beats: UnitTypeId | null = null;
    let losesTo: UnitTypeId | null = null;

    for (const other of fighters) {
      if (other === attacker) continue;
      const mine = effectiveness(attacker, other);
      const theirs = effectiveness(other, attacker);

      if (mine > theirs && (beats === null || mine - theirs > effectiveness(attacker, beats) - effectiveness(beats, attacker))) {
        beats = other;
      }
      if (theirs > mine && (losesTo === null || theirs - mine > effectiveness(losesTo, attacker) - effectiveness(attacker, losesTo))) {
        losesTo = other;
      }
    }

    return {
      attacker: unitDef(attacker).name,
      beats: beats === null ? "—" : unitDef(beats).name,
      losesTo: losesTo === null ? "—" : unitDef(losesTo).name,
    };
  });
}
