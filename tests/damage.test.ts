/**
 * The damage/armour matrix — where the game's strategic depth actually lives.
 *
 * Without it, "build more of the strong unit" is the whole game. With it, every
 * army composition has an answer, scouting matters because you need to know
 * what the answer must be, and a fight is decided before it starts by what you
 * chose to build.
 *
 * The property that has to hold is the **counter triangle**: each unit class
 * beats one and loses to another, with no class dominating. These tests assert
 * that as a relationship between numbers rather than trusting the table to look
 * right by eye.
 */

import { describe, expect, it } from "vitest";

import {
  Armor,
  DamageType,
  DAMAGE_MULTIPLIERS,
  damageAgainst,
  ARMOR_NAMES,
  DAMAGE_TYPE_NAMES,
} from "../src/content/combat.js";
import { UnitType, unitDef } from "../src/content/units.js";
import { BuildingType, buildingDef } from "../src/content/buildings.js";

describe("the matrix", () => {
  it("covers every damage type against every armour class", () => {
    for (const damage of Object.values(DamageType)) {
      for (const armor of Object.values(Armor)) {
        const multiplier = DAMAGE_MULTIPLIERS[damage]?.[armor];
        expect(multiplier, `${DAMAGE_TYPE_NAMES[damage]} vs ${ARMOR_NAMES[armor]}`).toBeGreaterThan(0);
      }
    }
  });

  it("scales damage by the multiplier", () => {
    // Multipliers are percentages, applied in integers so the sim stays exact.
    const expected = Math.floor((100 * DAMAGE_MULTIPLIERS[DamageType.Normal]![Armor.Light]!) / 100);
    expect(damageAgainst(100, DamageType.Normal, Armor.Light)).toBe(expected);
  });

  it("never deals less than one point", () => {
    // A hard counter should feel bad, not be literally harmless — an attack
    // rounding to zero would let a unit stand in front of an enemy forever.
    expect(damageAgainst(1, DamageType.Piercing, Armor.Building)).toBeGreaterThanOrEqual(1);
  });

  it("deals nothing for a non-positive base", () => {
    expect(damageAgainst(0, DamageType.Normal, Armor.Light)).toBe(0);
  });
});

describe("the counter triangle", () => {
  /** How well one unit type's weapon fares against another's armour. */
  const effectiveness = (attacker: number, defender: number): number => {
    const weapon = unitDef(attacker as never).weapon!;
    return DAMAGE_MULTIPLIERS[weapon.damageType]![unitDef(defender as never).armor]!;
  };

  it("has vehicles beat infantry", () => {
    expect(effectiveness(UnitType.Vehicle, UnitType.Soldier)).toBeGreaterThan(
      effectiveness(UnitType.Soldier, UnitType.Vehicle),
    );
  });

  it("has grenadiers beat vehicles", () => {
    expect(effectiveness(UnitType.Grenadier, UnitType.Vehicle)).toBeGreaterThan(
      effectiveness(UnitType.Vehicle, UnitType.Grenadier),
    );
  });

  it("has infantry beat grenadiers", () => {
    expect(effectiveness(UnitType.Soldier, UnitType.Grenadier)).toBeGreaterThan(
      effectiveness(UnitType.Grenadier, UnitType.Soldier),
    );
  });

  it("lets no single unit type answer everything", () => {
    // The triangle only means something if each class has a matchup it loses.
    for (const attacker of [UnitType.Soldier, UnitType.Grenadier, UnitType.Vehicle]) {
      const losesToSomething = [UnitType.Soldier, UnitType.Grenadier, UnitType.Vehicle].some(
        (defender) => defender !== attacker && effectiveness(defender, attacker) > effectiveness(attacker, defender),
      );
      expect(losesToSomething, `${unitDef(attacker as never).name} has no counter`).toBe(true);
    }
  });
});

describe("unit combat stats", () => {
  it("arms every fighting unit and leaves the rest alone", () => {
    for (const typeId of Object.values(UnitType)) {
      const def = unitDef(typeId);
      expect(def.armor, `${def.name} has no armour class`).toBeDefined();

      if (def.weapon) {
        expect(def.weapon.damage, `${def.name} damage`).toBeGreaterThan(0);
        expect(def.weapon.range, `${def.name} range`).toBeGreaterThan(0);
        expect(def.weapon.cooldownTicks, `${def.name} cooldown`).toBeGreaterThan(0);
      }
    }
  });

  it("gives workers a weak weapon rather than none", () => {
    // A defenceless economy means a single raider ends the game. Workers should
    // be able to swarm an intruder, badly.
    const worker = unitDef(UnitType.Worker);
    const soldier = unitDef(UnitType.Soldier);
    expect(worker.weapon).not.toBeNull();
    expect(worker.weapon!.damage).toBeLessThan(soldier.weapon!.damage);
  });

  it("gives the scout more sight than reach, so scouting is its own job", () => {
    const scout = unitDef(UnitType.Scout);
    expect(scout.sight).toBeGreaterThan(scout.weapon!.range);
  });

  it("makes grenadiers the answer to buildings", () => {
    const vs = (typeId: number): number =>
      DAMAGE_MULTIPLIERS[unitDef(typeId as never).weapon!.damageType]![Armor.Building]!;

    expect(vs(UnitType.Grenadier)).toBeGreaterThan(vs(UnitType.Soldier));
    expect(vs(UnitType.Grenadier)).toBeGreaterThan(vs(UnitType.Vehicle));
  });
});

describe("building combat stats", () => {
  it("gives every building the building armour class", () => {
    for (const typeId of Object.values(BuildingType)) {
      expect(buildingDef(typeId).armor).toBe(Armor.Building);
    }
  });

  it("arms the tower and nothing else", () => {
    expect(buildingDef(BuildingType.Tower).weapon).not.toBeNull();
    expect(buildingDef(BuildingType.Headquarters).weapon).toBeNull();
    expect(buildingDef(BuildingType.Depot).weapon).toBeNull();
  });

  it("gives the tower more reach than any unit it defends against", () => {
    // A tower a soldier can out-range is not a defence, it is a target.
    const tower = buildingDef(BuildingType.Tower).weapon!;
    expect(tower.range).toBeGreaterThan(unitDef(UnitType.Soldier).weapon!.range);
  });
});
