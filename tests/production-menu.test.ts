/**
 * What a production building offers.
 *
 * Pulled out of `main.ts` so it can be tested at all. The menu used to be built
 * inline in the frame loop, which meant the one property that matters — that
 * the buttons say what the *table* says, not what somebody typed once — had
 * nothing watching it.
 */

import { describe, expect, it } from "vitest";

import { BuildingType, buildingDef } from "../src/content/buildings.js";
import { UNIT_DEFS, UnitType, unitDef } from "../src/content/units.js";
import { createPlayer, Resource } from "../src/sim/resources.js";
import { trainOptions } from "../src/ui/production-menu.js";

/** A player who can pay for anything. */
function rich() {
  return createPlayer(0, {
    [Resource.Wood]: 9999,
    [Resource.Stone]: 9999,
    [Resource.Ore]: 9999,
    [Resource.Planks]: 9999,
    [Resource.Steel]: 9999,
  });
}

describe("what a building offers to train", () => {
  it("offers exactly what the building table says it produces", () => {
    for (const typeId of [BuildingType.Headquarters, BuildingType.Barracks]) {
      const def = buildingDef(typeId);
      const offered = trainOptions(def, rich()).map((option) => option.unitType);
      expect(offered).toEqual([...def.produces]);
    }
  });

  it("carries the unit's silhouette, so the button can show what it makes", () => {
    // The reason this exists: colour says whose, shape says what. A row that
    // only names a unit teaches nothing about what will be on the map.
    const worker = trainOptions(buildingDef(BuildingType.Headquarters), rich())[0]!;
    expect(worker.unitType).toBe(UnitType.Worker);
    expect(worker.shape).toBe(unitDef(UnitType.Worker).shape);
  });

  it("takes name and price straight from the unit table", () => {
    for (const option of trainOptions(buildingDef(BuildingType.Barracks), rich())) {
      const def = unitDef(option.unitType);
      expect(option.name).toBe(def.name);
      expect(option.cost).toEqual(def.cost);
    }
  });

  it("marks what the player cannot pay for", () => {
    const broke = createPlayer(0);
    const options = trainOptions(buildingDef(BuildingType.Barracks), broke);

    expect(options.length).toBeGreaterThan(0);
    expect(options.every((option) => !option.affordable)).toBe(true);
    expect(trainOptions(buildingDef(BuildingType.Barracks), rich()).every((o) => o.affordable)).toBe(
      true,
    );
  });

  it("offers nothing for a building that trains nothing", () => {
    expect(trainOptions(buildingDef(BuildingType.Farm), rich())).toEqual([]);
  });

  it("knows a shape for every unit in the game", () => {
    // Guards against a new unit type arriving without a silhouette: the button
    // would render an empty box, which reads as a bug rather than as a unit.
    for (const def of Object.values(UNIT_DEFS)) {
      expect(def.shape, `${def.name} has no shape`).toBeTruthy();
    }
  });
});
