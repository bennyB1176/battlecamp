/**
 * Refinement: turning raw materials into the good stuff.
 *
 * This is the Siedler half of the design, and the reason it is worth having is
 * not that chains are charming — it is that they put a *second* decision behind
 * every advanced unit. Raw ore is not a tank; ore plus a smelter you had the
 * foresight to build and the ground to protect is a tank. That converts "do I
 * have the money?" into "did I plan for this five minutes ago?", which is the
 * question a strategy game wants to be asking.
 *
 * Deliberately without carts: a refinery pulls from the same global pool the
 * workers bank into, and pushes back into it. The only journey in this economy
 * remains the worker's round trip.
 */

import { describe, expect, it } from "vitest";

import { BuildingType, buildingDef } from "../src/content/buildings.js";
import { unitDef, UnitType } from "../src/content/units.js";
import { placeBuildingAt } from "../src/sim/construction.js";
import { createGrid, Terrain } from "../src/sim/grid.js";
import { Resource } from "../src/sim/resources.js";
import { createWorld, tickWorld, type World } from "../src/sim/world.js";

function blankWorld(): World {
  const world = createWorld({ seed: 9, width: 40, height: 40, startingUnits: 0 });
  world.grid.tiles.set(createGrid(40, 40, Terrain.Grass).tiles);
  world.grid.blocked.fill(0);
  world.deposits.fill(0);
  for (const player of world.players) {
    player.resources[Resource.Wood] = 0;
    player.resources[Resource.Stone] = 0;
    player.resources[Resource.Ore] = 0;
    player.resources[Resource.Planks] = 0;
    player.resources[Resource.Steel] = 0;
  }
  return world;
}

/**
 * A plant well clear of the refineries under test, so these measure refining at
 * full speed. Power has its own file; mixing the two here would mean every
 * recipe assertion silently depended on where the buildings happened to stand.
 */
function powerAll(world: World): void {
  place(world, BuildingType.PowerPlant, 12, 12);
}

function place(world: World, typeId: number, tileX = 10, tileY = 10) {
  const building = placeBuildingAt(world, 0, typeId as never, tileX, tileY, {
    free: true,
    finished: true,
    ignoreRadius: true,
  });
  if (!building) throw new Error("building could not be placed");
  return building;
}

describe("the sawmill", () => {
  it("turns wood into planks", () => {
    const world = blankWorld();
    place(world, BuildingType.Sawmill);
    powerAll(world);
    world.players[0]!.resources[Resource.Wood] = 500;

    const recipe = buildingDef(BuildingType.Sawmill).refines!;
    for (let tick = 0; tick < recipe.ticks; tick++) tickWorld(world);

    expect(world.players[0]!.resources[Resource.Planks]).toBe(recipe.outputAmount);
    expect(world.players[0]!.resources[Resource.Wood]).toBe(500 - recipe.inputAmount);
  });

  it("keeps going as long as there is wood", () => {
    const world = blankWorld();
    place(world, BuildingType.Sawmill);
    powerAll(world);
    world.players[0]!.resources[Resource.Wood] = 500;

    const recipe = buildingDef(BuildingType.Sawmill).refines!;
    for (let tick = 0; tick < recipe.ticks * 3; tick++) tickWorld(world);

    expect(world.players[0]!.resources[Resource.Planks]).toBe(recipe.outputAmount * 3);
  });

  it("stops when the wood runs out, and picks up again when it returns", () => {
    // Idling rather than going into debt: a refinery with no input is a
    // building waiting for work, not a hole in the economy.
    const world = blankWorld();
    place(world, BuildingType.Sawmill);
    powerAll(world);
    const recipe = buildingDef(BuildingType.Sawmill).refines!;

    for (let tick = 0; tick < recipe.ticks * 2; tick++) tickWorld(world);
    expect(world.players[0]!.resources[Resource.Planks]).toBe(0);
    expect(world.players[0]!.resources[Resource.Wood]).toBe(0);

    world.players[0]!.resources[Resource.Wood] = recipe.inputAmount;
    for (let tick = 0; tick < recipe.ticks; tick++) tickWorld(world);
    expect(world.players[0]!.resources[Resource.Planks]).toBe(recipe.outputAmount);
  });

  it("does nothing while it is still a building site", () => {
    // A half-built shell producing goods would make construction time free.
    const world = blankWorld();
    placeBuildingAt(world, 0, BuildingType.Sawmill, 10, 10, { free: true, ignoreRadius: true });
    world.players[0]!.resources[Resource.Wood] = 500;

    for (let tick = 0; tick < 200; tick++) tickWorld(world);

    expect(world.players[0]!.resources[Resource.Planks]).toBe(0);
    expect(world.players[0]!.resources[Resource.Wood]).toBe(500);
  });

  it("banks into the owner's pool and nobody else's", () => {
    const world = blankWorld();
    place(world, BuildingType.Sawmill);
    powerAll(world);
    world.players[0]!.resources[Resource.Wood] = 500;
    world.players[1]!.resources[Resource.Wood] = 500;

    const recipe = buildingDef(BuildingType.Sawmill).refines!;
    for (let tick = 0; tick < recipe.ticks; tick++) tickWorld(world);

    expect(world.players[0]!.resources[Resource.Planks]).toBeGreaterThan(0);
    expect(world.players[1]!.resources[Resource.Planks]).toBe(0);
    expect(world.players[1]!.resources[Resource.Wood]).toBe(500);
  });
});

describe("the smelter", () => {
  it("turns ore into steel", () => {
    const world = blankWorld();
    place(world, BuildingType.Smelter);
    powerAll(world);
    world.players[0]!.resources[Resource.Ore] = 500;

    const recipe = buildingDef(BuildingType.Smelter).refines!;
    for (let tick = 0; tick < recipe.ticks; tick++) tickWorld(world);

    expect(world.players[0]!.resources[Resource.Steel]).toBe(recipe.outputAmount);
    expect(world.players[0]!.resources[Resource.Ore]).toBe(500 - recipe.inputAmount);
  });

  it("runs two of them twice as fast", () => {
    // Refineries are the throughput knob: the answer to "I need more steel" is
    // another smelter, which is ground to defend and resources not spent on an
    // army right now.
    const world = blankWorld();
    place(world, BuildingType.Smelter, 10, 10);
    place(world, BuildingType.Smelter, 14, 10);
    powerAll(world);
    world.players[0]!.resources[Resource.Ore] = 900;

    const recipe = buildingDef(BuildingType.Smelter).refines!;
    for (let tick = 0; tick < recipe.ticks; tick++) tickWorld(world);

    expect(world.players[0]!.resources[Resource.Steel]).toBe(recipe.outputAmount * 2);
  });
});

describe("what the chains are for", () => {
  it("prices the heaviest unit in refined goods", () => {
    // Without this the chains are scenery. Something worth having has to be on
    // the far side of them.
    expect(unitDef(UnitType.Vehicle).cost[Resource.Steel] ?? 0).toBeGreaterThan(0);
  });

  it("leaves the opening buildings on raw materials", () => {
    // The first five minutes must not require a chain that takes five minutes
    // to set up.
    for (const typeId of [BuildingType.Headquarters, BuildingType.Depot, BuildingType.Barracks]) {
      const cost = buildingDef(typeId).cost;
      expect(cost[Resource.Planks] ?? 0, `${buildingDef(typeId).name} needs planks to exist`).toBe(0);
      expect(cost[Resource.Steel] ?? 0, `${buildingDef(typeId).name} needs steel to exist`).toBe(0);
    }
  });
});
