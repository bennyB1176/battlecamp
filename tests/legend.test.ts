/**
 * The in-game legend.
 *
 * The point of these tests is not that the help page renders — it is that the
 * page cannot drift away from the game. Every entry is derived from the content
 * tables, so a new unit shows up on its own and a retuned matrix rewrites the
 * counter list. These tests fail if somebody ever starts hand-writing it.
 */

import { describe, expect, it } from "vitest";

import { BUILDING_DEFS, BuildingType } from "../src/content/buildings.js";
import { UNIT_DEFS, UnitType, unitDef } from "../src/content/units.js";
import {
  buildingEntries,
  counterTriangle,
  formatCost,
  resourceEntries,
  unitEntries,
} from "../src/ui/legend-data.js";
import {
  Resource,
  RESOURCE_COLORS,
  RESOURCE_KINDS,
  RESOURCE_NAMES,
} from "../src/sim/resources.js";

describe("unit entries", () => {
  it("lists every unit the game has, with no hand-maintained list", () => {
    // Add a unit type and it appears here without anyone editing the legend.
    expect(unitEntries()).toHaveLength(Object.keys(UNIT_DEFS).length);
  });

  it("takes its numbers straight from the definitions", () => {
    const soldier = unitEntries().find((entry) => entry.typeId === UnitType.Soldier)!;
    expect(soldier.name).toBe(unitDef(UnitType.Soldier).name);
    expect(soldier.hp).toBe(unitDef(UnitType.Soldier).maxHp);
  });

  it("uses the same silhouette key the renderer draws with", () => {
    for (const entry of unitEntries()) {
      expect(entry.shape).toBe(unitDef(entry.typeId).shape);
    }
  });

  it("says what each weapon is for and what it wastes itself on", () => {
    const grenadier = unitEntries().find((entry) => entry.typeId === UnitType.Grenadier)!;
    expect(grenadier.weaponText).not.toBeNull();
    expect(grenadier.strongAgainst).toContain("Gebäude");
    expect(grenadier.weakAgainst).toContain("leicht");
  });

  it("gives every unit a readable role", () => {
    for (const entry of unitEntries()) {
      expect(entry.role.length).toBeGreaterThan(0);
      expect(entry.costText.length).toBeGreaterThan(0);
      expect(entry.speedText).toMatch(/Kacheln\/s$/);
    }
  });

  it("describes the scout by what it actually does", () => {
    // Derived from its stats, not from a label typed next to it.
    const scout = unitEntries().find((entry) => entry.typeId === UnitType.Scout)!;
    expect(scout.role).toMatch(/Aufkl/);
  });

  it("does not mistake the heaviest unit for a scout", () => {
    // A first attempt called the vehicle a scout, because its sight also
    // out-ranges its gun. Wrong help is worse than none, because it is believed.
    const vehicle = unitEntries().find((entry) => entry.typeId === UnitType.Vehicle)!;
    expect(vehicle.role).not.toMatch(/Aufkl/);
    expect(vehicle.role).toMatch(/leicht/);
  });

  it("gives every unit type its own silhouette", () => {
    // Two units that look alike make the legend useless — a player cannot act
    // on a distinction they cannot see.
    const shapes = unitEntries().map((entry) => entry.shape);
    expect(new Set(shapes).size).toBe(shapes.length);
  });
});

describe("building entries", () => {
  it("lists every building", () => {
    expect(buildingEntries()).toHaveLength(Object.keys(BUILDING_DEFS).length);
  });

  it("names what a building trains", () => {
    const barracks = buildingEntries().find((entry) => entry.typeId === BuildingType.Barracks)!;
    expect(barracks.trains).toContain(unitDef(UnitType.Soldier).name);
  });

  it("marks which buildings take deliveries", () => {
    const depot = buildingEntries().find((entry) => entry.typeId === BuildingType.Depot)!;
    const barracks = buildingEntries().find((entry) => entry.typeId === BuildingType.Barracks)!;
    expect(depot.acceptsDeliveries).toBe(true);
    expect(barracks.acceptsDeliveries).toBe(false);
  });

  it("describes the tower's weapon and leaves the others unarmed", () => {
    const tower = buildingEntries().find((entry) => entry.typeId === BuildingType.Tower)!;
    const hq = buildingEntries().find((entry) => entry.typeId === BuildingType.Headquarters)!;
    expect(tower.weaponText).not.toBeNull();
    expect(hq.weaponText).toBeNull();
  });
});

describe("counter triangle", () => {
  const fighters = [UnitType.Soldier, UnitType.Grenadier, UnitType.Vehicle] as const;

  it("works the matchups out from the matrix", () => {
    const rows = counterTriangle(fighters);
    const find = (name: string) => rows.find((row) => row.attacker === name)!;

    expect(find("Panzerwagen").beats).toBe("Soldat");
    expect(find("Grenadier").beats).toBe("Panzerwagen");
    expect(find("Soldat").beats).toBe("Grenadier");
  });

  it("gives every fighter something it loses to", () => {
    // If this ever fails, some unit has become a general answer and the whole
    // point of the matrix is gone.
    for (const row of counterTriangle(fighters)) {
      expect(row.losesTo, `${row.attacker} has no counter`).not.toBe("—");
    }
  });
});

describe("cost formatting", () => {
  it("names each resource and its amount", () => {
    expect(formatCost({ [Resource.Wood]: 120, [Resource.Stone]: 40 })).toBe("120 Holz · 40 Stein");
  });

  it("skips resources that are not charged", () => {
    expect(formatCost({ [Resource.Wood]: 50, [Resource.Ore]: 0 })).toBe("50 Holz");
  });

  it("says so when something is free", () => {
    expect(formatCost({})).toBe("kostenlos");
  });
});

describe("refineries in the legend", () => {
  it("says what each refinery turns into what", () => {
    // A chain the player cannot see is a chain the player cannot plan around,
    // and this is the one mechanic in the game with no visible feedback on the
    // map at all — the goods appear in a number at the top of the screen.
    const sawmill = buildingEntries().find((entry) => entry.typeId === BuildingType.Sawmill)!;

    expect(sawmill.refinesText, "the sawmill does not say what it makes").not.toBeNull();
    expect(sawmill.refinesText).toContain(RESOURCE_NAMES[Resource.Wood]);
    expect(sawmill.refinesText).toContain(RESOURCE_NAMES[Resource.Planks]);
  });

  it("leaves buildings that refine nothing without a line", () => {
    const barracks = buildingEntries().find((entry) => entry.typeId === BuildingType.Barracks)!;
    expect(barracks.refinesText).toBeNull();
  });

  it("derives the line from the recipe rather than from prose", () => {
    // Retune a recipe and this rewrites itself; that is the whole reason the
    // help lives in the game instead of in a wiki.
    const smelter = buildingEntries().find((entry) => entry.typeId === BuildingType.Smelter)!;
    const recipe = BUILDING_DEFS[BuildingType.Smelter].refines!;

    expect(smelter.refinesText).toContain(String(recipe.inputAmount));
    expect(smelter.refinesText).toContain(String(recipe.outputAmount));
  });
});

describe("the resource list", () => {
  it("covers every resource the game has, refined ones included", () => {
    // It used to be a hand-written list of three, with the colours copied by
    // hand from the stylesheet. Adding planks and steel left it silently two
    // short — the exact drift this project keeps the help in the game to avoid.
    expect(resourceEntries().map((entry) => entry.name)).toEqual(
      RESOURCE_KINDS.map((kind) => RESOURCE_NAMES[kind]),
    );
  });

  it("says where each one comes from", () => {
    const entries = resourceEntries();
    const wood = entries.find((entry) => entry.name === RESOURCE_NAMES[Resource.Wood])!;
    const planks = entries.find((entry) => entry.name === RESOURCE_NAMES[Resource.Planks])!;

    expect(wood.from, "wood should come from the terrain that holds it").toBe("Wald");
    expect(planks.from, "planks should name the building that makes them").toBe("Sägewerk");
  });

  it("takes its colours from the table, not from the stylesheet", () => {
    for (const entry of resourceEntries()) {
      expect(Object.values(RESOURCE_COLORS)).toContain(entry.color);
    }
  });
});
