/**
 * Damage types, armour classes, and the matrix between them.
 *
 * This table is where the game's strategic depth lives. Without it, an RTS
 * collapses into "build more of the strong unit"; with it, every composition
 * has an answer, and scouting matters because you have to know *which* answer
 * to build. Deliberately, the depth comes from these numbers rather than from
 * art — a counter you can feel is worth more than a model you can admire.
 *
 * Multipliers are percentages and damage is applied in integers, so combat
 * stays exact and reproducible.
 */

export const DamageType = {
  /** Rifles and fists. Solid against soft targets, poor against armour. */
  Normal: 0,
  /** Shells and charges. Made for armour and walls, wasteful on infantry. */
  Explosive: 1,
  /** High-velocity rounds. Punch through infantry, glance off structures. */
  Piercing: 2,
} as const;

export type DamageTypeId = (typeof DamageType)[keyof typeof DamageType];

export const Armor = {
  Light: 0,
  Medium: 1,
  Heavy: 2,
  Building: 3,
} as const;

export type ArmorId = (typeof Armor)[keyof typeof Armor];

/** Explicit order, so anything iterating armour classes stays predictable. */
export const ARMOR_KINDS: readonly ArmorId[] = [Armor.Light, Armor.Medium, Armor.Heavy, Armor.Building];

export const DAMAGE_TYPE_NAMES: Readonly<Record<DamageTypeId, string>> = {
  [DamageType.Normal]: "normal",
  [DamageType.Explosive]: "explosiv",
  [DamageType.Piercing]: "durchschlagend",
};

export const ARMOR_NAMES: Readonly<Record<ArmorId, string>> = {
  [Armor.Light]: "leicht",
  [Armor.Medium]: "mittel",
  [Armor.Heavy]: "schwer",
  [Armor.Building]: "Gebäude",
};

/**
 * Percent of base damage dealt, by damage type against armour class.
 *
 * Read across a row to see what a weapon is for. The numbers are chosen so the
 * counter triangle closes:
 *
 *   infantry (light)  <- vehicles (piercing)
 *   vehicles (heavy)  <- grenadiers (explosive)
 *   grenadiers (med.) <- infantry (normal)
 *
 * Each class therefore has something it beats and something it loses to, and
 * none of them is a general answer.
 */
export const DAMAGE_MULTIPLIERS: Readonly<Record<DamageTypeId, Readonly<Record<ArmorId, number>>>> = {
  [DamageType.Normal]: {
    [Armor.Light]: 100,
    [Armor.Medium]: 80,
    [Armor.Heavy]: 55,
    [Armor.Building]: 40,
  },
  [DamageType.Explosive]: {
    [Armor.Light]: 55,
    [Armor.Medium]: 90,
    [Armor.Heavy]: 130,
    [Armor.Building]: 150,
  },
  [DamageType.Piercing]: {
    [Armor.Light]: 130,
    [Armor.Medium]: 70,
    [Armor.Heavy]: 45,
    [Armor.Building]: 25,
  },
};

export interface Weapon {
  readonly damage: number;
  readonly damageType: DamageTypeId;
  /** Reach in fixed-point units. */
  readonly range: number;
  /** Ticks between shots. */
  readonly cooldownTicks: number;
}

/**
 * Damage actually dealt.
 *
 * Floors to an integer, but never below one: a hard counter should feel bad,
 * not be literally harmless. An attack that rounded to zero would let a unit
 * stand in front of an enemy indefinitely, which reads as a bug rather than as
 * a bad matchup.
 */
export function damageAgainst(base: number, damageType: DamageTypeId, armor: ArmorId): number {
  if (base <= 0) return 0;
  const multiplier = DAMAGE_MULTIPLIERS[damageType][armor];
  return Math.max(1, Math.floor((base * multiplier) / 100));
}
