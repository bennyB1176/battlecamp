/**
 * Power: the rule that makes base *layout* a decision.
 *
 * Everything else in the economy is a shopping list — enough wood, enough
 * stone, press the button. Power is the one rule that cares *where* things
 * stand: a plant lights a circle, and a refinery outside every circle crawls.
 * That turns a base from a heap of buildings into a shape somebody chose, and
 * it hands the attacker a target worth more than its hit points, because one
 * plant is several buildings' output.
 *
 * Slower, never stopped. A building that simply switches off when a plant dies
 * takes the game away from the player at the exact moment they most need
 * something to do; one that halves in speed is a problem they can still play
 * their way out of.
 */

import { describe, expect, it } from "vitest";

import { BuildingType, buildingDef } from "../src/content/buildings.js";
import { placeBuildingAt } from "../src/sim/construction.js";
import { buildingOrigin, type Entity } from "../src/sim/entities.js";
import { createGrid, Terrain } from "../src/sim/grid.js";
import { isPowered, poweredFraction } from "../src/sim/power.js";
import { RESOURCE_KINDS, Resource } from "../src/sim/resources.js";
import { createWorld, tickWorld, type World } from "../src/sim/world.js";

function blankWorld(): World {
  const world = createWorld({ seed: 13, width: 48, height: 48, startingUnits: 0 });
  world.grid.tiles.set(createGrid(48, 48, Terrain.Grass).tiles);
  world.grid.blocked.fill(0);
  world.deposits.fill(0);
  for (const player of world.players) {
    for (const kind of RESOURCE_KINDS) player.resources[kind] = 0;
  }
  return world;
}

function place(world: World, typeId: number, tileX: number, tileY: number, owner = 0): Entity {
  const building = placeBuildingAt(world, owner, typeId as never, tileX, tileY, {
    free: true,
    finished: true,
    ignoreRadius: true,
  });
  if (!building) throw new Error("building could not be placed");
  return building;
}

describe("what a plant reaches", () => {
  it("powers a building standing beside it", () => {
    const world = blankWorld();
    place(world, BuildingType.PowerPlant, 10, 10);
    const mill = place(world, BuildingType.Sawmill, 14, 10);

    expect(isPowered(world, mill)).toBe(true);
  });

  it("leaves one on the far side of the map cold", () => {
    const world = blankWorld();
    place(world, BuildingType.PowerPlant, 4, 4);
    const mill = place(world, BuildingType.Sawmill, 40, 40);

    expect(isPowered(world, mill)).toBe(false);
  });

  it("does not run on somebody else's grid", () => {
    // Otherwise the answer to a power shortage would be to stand next to the
    // enemy's plant, which is funny once and broken forever.
    const world = blankWorld();
    place(world, BuildingType.PowerPlant, 10, 10, 1);
    const mill = place(world, BuildingType.Sawmill, 14, 10, 0);

    expect(isPowered(world, mill)).toBe(false);
  });

  it("needs the plant finished", () => {
    const world = blankWorld();
    placeBuildingAt(world, 0, BuildingType.PowerPlant, 10, 10, { free: true, ignoreRadius: true });
    const mill = place(world, BuildingType.Sawmill, 14, 10);

    expect(isPowered(world, mill)).toBe(false);
  });

  it("goes dark when the plant is destroyed", () => {
    // The whole reason a plant is worth attacking.
    const world = blankWorld();
    const plant = place(world, BuildingType.PowerPlant, 10, 10);
    const mill = place(world, BuildingType.Sawmill, 14, 10);
    expect(isPowered(world, mill)).toBe(true);

    plant.hp = 0;
    tickWorld(world);

    expect(isPowered(world, mill)).toBe(false);
  });
});

describe("what being cold costs", () => {
  it("runs a refinery slower off the grid than on it", () => {
    const runFor = (powered: boolean): number => {
      const world = blankWorld();
      place(world, BuildingType.Sawmill, 14, 10);
      if (powered) place(world, BuildingType.PowerPlant, 10, 10);
      world.players[0]!.resources[Resource.Wood] = 5000;

      for (let tick = 0; tick < 1200; tick++) tickWorld(world);
      return world.players[0]!.resources[Resource.Planks];
    };

    const cold = runFor(false);
    const lit = runFor(true);

    expect(cold, "an unpowered refinery produced nothing at all").toBeGreaterThan(0);
    expect(lit, "power made no difference").toBeGreaterThan(cold);
  });

  it("slows training the same way", () => {
    // One rule, everywhere it makes sense. A player who learns that power
    // matters for planks should not have to learn separately that it also
    // matters for soldiers.
    const trainedBy = (powered: boolean): number => {
      const world = blankWorld();
      const barracks = place(world, BuildingType.Barracks, 14, 10);
      if (powered) place(world, BuildingType.PowerPlant, 10, 10);
      for (const kind of RESOURCE_KINDS) world.players[0]!.resources[kind] = 5000;

      tickWorld(world, [
        { type: "train", playerId: 0, buildingId: barracks.id, unitType: 1 },
        { type: "train", playerId: 0, buildingId: barracks.id, unitType: 1 },
      ]);
      for (let tick = 0; tick < 200; tick++) tickWorld(world);
      return world.entities.list.filter((entity) => entity.owner === 0 && entity.kind === 0).length;
    };

    expect(trainedBy(true)).toBeGreaterThan(trainedBy(false));
  });

  it("never stops a building outright", () => {
    // A base that switches off has taken the game away from the player at the
    // exact moment they most need something to do.
    expect(poweredFraction(false)).toBeGreaterThan(0);
    expect(poweredFraction(false)).toBeLessThan(poweredFraction(true));
  });
});

describe("what the plant costs to have", () => {
  it("reaches further than it can defend", () => {
    // The point of the rule: a grid worth having is a grid stretched wider than
    // the base around it, which is what makes it a target rather than a chore.
    const plant = buildingDef(BuildingType.PowerPlant);
    expect(plant.powerRadius).toBeGreaterThan(plant.buildRadius);
  });

  it("is worth less than the buildings it serves", () => {
    // If a plant costs more than two refineries, nobody builds the plant.
    const plant = buildingDef(BuildingType.PowerPlant).cost;
    const mill = buildingDef(BuildingType.Sawmill).cost;
    const total = (cost: Record<number, number | undefined>): number =>
      Object.values(cost).reduce<number>((sum, amount) => sum + (amount ?? 0), 0);

    expect(total(plant)).toBeLessThan(total(mill) * 2);
  });

  it("stands on the map as a building anyone can burn down", () => {
    const world = blankWorld();
    const plant = place(world, BuildingType.PowerPlant, 10, 10);
    const origin = buildingOrigin(plant);

    expect(world.grid.blocked[origin.tileY * world.grid.width + origin.tileX]).toBe(1);
    expect(plant.hp).toBeLessThan(buildingDef(BuildingType.Headquarters).maxHp);
  });
});

describe("the base's own yard", () => {
  it("runs a barracks beside the headquarters at full speed", () => {
    // Otherwise a power plant is not a decision but a mandatory first building,
    // and the whole opening gets slower for no gain in depth.
    const world = blankWorld();
    place(world, BuildingType.Headquarters, 10, 10);
    const barracks = place(world, BuildingType.Barracks, 14, 11);

    expect(isPowered(world, barracks)).toBe(true);
  });

  it("leaves an expansion out in the fields cold", () => {
    // Which is where the plant earns its keep: near the seams, not at home.
    const world = blankWorld();
    place(world, BuildingType.Headquarters, 10, 10);
    const mill = place(world, BuildingType.Sawmill, 30, 30);

    expect(isPowered(world, mill)).toBe(false);
  });
});
