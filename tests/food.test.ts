/**
 * Food: the bill that keeps arriving.
 *
 * Every other cost in this game is paid once. Food is paid every tick, by every
 * unit, for as long as it lives — and that single difference is the game's main
 * anti-rush lever. An army built by stripping the economy bare wins the fight it
 * starts and then starves on the way home, so "how big an army can I raise?"
 * becomes "how big an army can I *keep*?", which is a question about the base
 * rather than about the last two minutes.
 *
 * Starvation costs health rather than units. Deleting a soldier the player paid
 * for reads as the game cheating; watching the whole army get weaker reads as a
 * warning, and leaves time to act on it.
 */

import { describe, expect, it } from "vitest";

import { BuildingType, buildingDef } from "../src/content/buildings.js";
import { UnitType, unitDef } from "../src/content/units.js";
import { placeBuildingAt } from "../src/sim/construction.js";
import { addEntity, type Entity } from "../src/sim/entities.js";
import { fromTiles } from "../src/sim/fixed.js";
import { foodDemand, foodSupply } from "../src/sim/food.js";
import { createGrid, Terrain } from "../src/sim/grid.js";
import { RESOURCE_KINDS } from "../src/sim/resources.js";
import { createWorld, tickWorld, type World } from "../src/sim/world.js";

function blankWorld(): World {
  const world = createWorld({ seed: 11, width: 40, height: 40, startingUnits: 0 });
  world.grid.tiles.set(createGrid(40, 40, Terrain.Grass).tiles);
  world.grid.blocked.fill(0);
  world.deposits.fill(0);
  for (const player of world.players) {
    for (const kind of RESOURCE_KINDS) player.resources[kind] = 0;
  }
  return world;
}

/** A block of soldiers, kept well clear of the other player's — they shoot. */
function soldiers(world: World, count: number, owner = 0): Entity[] {
  const originX = owner === 0 ? 4 : 30;
  const originY = owner === 0 ? 4 : 30;
  return Array.from({ length: count }, (_, i) =>
    addEntity(world.entities, {
      typeId: UnitType.Soldier,
      owner,
      x: fromTiles(originX + (i % 4)),
      y: fromTiles(originY + Math.floor(i / 4)),
    }),
  );
}

function farm(world: World, tileX = 20, tileY = 20, owner = 0): Entity {
  const building = placeBuildingAt(world, owner, BuildingType.Farm, tileX, tileY, {
    free: true,
    finished: true,
    ignoreRadius: true,
  });
  if (!building) throw new Error("farm could not be placed");
  return building;
}

describe("what an army costs to keep", () => {
  it("counts every living unit against the supply", () => {
    const world = blankWorld();
    soldiers(world, 5);

    expect(foodDemand(world, 0)).toBe(5 * unitDef(UnitType.Soldier).upkeep);
  });

  it("counts nothing for a player with no units", () => {
    const world = blankWorld();
    expect(foodDemand(world, 0)).toBe(0);
  });

  it("counts a farm's output as supply, and only finished ones", () => {
    const world = blankWorld();
    const supplyPerFarm = buildingDef(BuildingType.Farm).foodSupply;
    const foraged = foodSupply(world, 0);

    farm(world);
    expect(foodSupply(world, 0)).toBe(foraged + supplyPerFarm);

    placeBuildingAt(world, 0, BuildingType.Farm, 26, 20, { free: true, ignoreRadius: true });
    expect(foodSupply(world, 0), "a building site is not yet a farm").toBe(foraged + supplyPerFarm);
  });

  it("feeds the opening army from the headquarters alone", () => {
    // The first minutes must not be a food puzzle. A base you already have
    // covers the units you already have; the bill only bites when you grow.
    const world = createWorld({ seed: 11, width: 64, height: 64 });

    for (const player of world.players) {
      expect(
        foodSupply(world, player.id),
        `player ${player.id} starts short of food before doing anything`,
      ).toBeGreaterThanOrEqual(foodDemand(world, player.id));
    }
  });
});

describe("going hungry", () => {
  it("wears the army down when supply falls short", () => {
    const world = blankWorld();
    const army = soldiers(world, 12);
    const before = army[0]!.hp;

    for (let tick = 0; tick < 600; tick++) tickWorld(world);

    expect(foodDemand(world, 0)).toBeGreaterThan(foodSupply(world, 0));
    expect(army[0]!.hp, "a starving army took no damage at all").toBeLessThan(before);
  });

  it("never starves anybody to death", () => {
    // Attrition is a warning, not an execution. A player who loses paid-for
    // units to a number in the corner of the screen reads it as the game
    // cheating — and it would hand a stalled opponent a free win.
    const world = blankWorld();
    const army = soldiers(world, 20);

    for (let tick = 0; tick < 4000; tick++) tickWorld(world);

    for (const unit of army) {
      expect(unit.hp, "starvation killed a unit outright").toBeGreaterThan(0);
    }
  });

  it("leaves a fed army alone", () => {
    const world = blankWorld();
    const supplyPerFarm = buildingDef(BuildingType.Farm).foodSupply;
    const upkeep = unitDef(UnitType.Soldier).upkeep;
    farm(world);
    const army = soldiers(world, Math.floor(foodSupply(world, 0) / upkeep));

    const before = army.map((unit) => unit.hp);
    for (let tick = 0; tick < 600; tick++) tickWorld(world);

    expect(army.map((unit) => unit.hp)).toEqual(before);
  });

  it("recovers once a farm goes up", () => {
    const world = blankWorld();
    const army = soldiers(world, 12);

    for (let tick = 0; tick < 300; tick++) tickWorld(world);
    const starved = army[0]!.hp;

    farm(world, 20, 20);
    farm(world, 26, 20);
    farm(world, 32, 20);
    for (let tick = 0; tick < 600; tick++) tickWorld(world);

    expect(foodSupply(world, 0)).toBeGreaterThanOrEqual(foodDemand(world, 0));
    expect(army[0]!.hp, "the army did not recover after the farms went up").toBeGreaterThan(starved);
  });

  it("does not heal a unit past full health", () => {
    const world = blankWorld();
    const army = soldiers(world, 1);
    farm(world);
    army[0]!.hp = unitDef(UnitType.Soldier).maxHp;

    for (let tick = 0; tick < 600; tick++) tickWorld(world);

    expect(army[0]!.hp).toBe(unitDef(UnitType.Soldier).maxHp);
  });

  it("starves only the player who is short", () => {
    const world = blankWorld();
    const mine = soldiers(world, 12, 0);
    const theirs = soldiers(world, 2, 1);
    farm(world, 20, 20, 1);

    const theirHp = theirs[0]!.hp;
    for (let tick = 0; tick < 600; tick++) tickWorld(world);

    expect(mine[0]!.hp).toBeLessThan(unitDef(UnitType.Soldier).maxHp);
    expect(theirs[0]!.hp).toBe(theirHp);
  });
});

describe("what food is for", () => {
  it("makes the farm the cheapest thing in the build menu", () => {
    // If a farm costs about what a barracks costs, feeding an army stops being
    // a decision and becomes a tax. It has to be the easy answer to a real
    // problem, not another thing competing for the same wood.
    const farmCost = buildingDef(BuildingType.Farm).cost;
    const barracksCost = buildingDef(BuildingType.Barracks).cost;
    const total = (cost: Record<number, number | undefined>): number =>
      Object.values(cost).reduce<number>((sum, amount) => sum + (amount ?? 0), 0);

    expect(total(farmCost)).toBeLessThan(total(barracksCost));
  });

  it("gives workers a smaller appetite than soldiers", () => {
    // Otherwise the food rule punishes building an economy, which is the exact
    // opposite of what it is for.
    expect(unitDef(UnitType.Worker).upkeep).toBeLessThan(unitDef(UnitType.Soldier).upkeep);
  });
});
