/**
 * Resource deposits and player accounts.
 *
 * Deposits are finite. That single decision is what turns a map into a
 * strategic space: a base that has stripped its surroundings must expand toward
 * ground somebody else also wants. An infinite deposit would make the opening
 * position the only position that ever matters.
 */

import { describe, expect, it } from "vitest";

import {
  Resource,
  createPlayer,
  credit,
  debit,
  canAfford,
  resourceOfTerrain,
  depositAt,
  harvestFrom,
  totalDeposits,
  type Cost,
} from "../src/sim/resources.js";
import { createGrid, setTerrain, Terrain, terrainAt } from "../src/sim/grid.js";
import { createWorld } from "../src/sim/world.js";

describe("terrain to resource mapping", () => {
  it("maps harvestable terrain to its resource", () => {
    expect(resourceOfTerrain(Terrain.Forest)).toBe(Resource.Wood);
    expect(resourceOfTerrain(Terrain.Stone)).toBe(Resource.Stone);
    expect(resourceOfTerrain(Terrain.Ore)).toBe(Resource.Ore);
  });

  it("returns null for terrain that yields nothing", () => {
    expect(resourceOfTerrain(Terrain.Grass)).toBeNull();
    expect(resourceOfTerrain(Terrain.Water)).toBeNull();
    expect(resourceOfTerrain(Terrain.Rock)).toBeNull();
  });
});

describe("deposits", () => {
  it("stocks every harvestable tile when the world is created", () => {
    const world = createWorld({ seed: 11, width: 48, height: 48, startingUnits: 0 });
    expect(totalDeposits(world)).toBeGreaterThan(0);

    for (let y = 0; y < world.grid.height; y++) {
      for (let x = 0; x < world.grid.width; x++) {
        const amount = depositAt(world, x, y);
        const yields = resourceOfTerrain(terrainAt(world.grid, x, y)) !== null;
        expect(amount > 0).toBe(yields);
      }
    }
  });

  it("hands out what was asked for while stock lasts", () => {
    const world = createWorld({ seed: 12, width: 16, height: 16, startingUnits: 0 });
    setTerrain(world.grid, 4, 4, Terrain.Forest);
    world.deposits[4 * world.grid.width + 4] = 100;

    expect(harvestFrom(world, 4, 4, 30)).toEqual({ resource: Resource.Wood, amount: 30 });
    expect(depositAt(world, 4, 4)).toBe(70);
  });

  it("hands out the remainder when the deposit runs low", () => {
    const world = createWorld({ seed: 12, width: 16, height: 16, startingUnits: 0 });
    setTerrain(world.grid, 4, 4, Terrain.Forest);
    world.deposits[4 * world.grid.width + 4] = 10;

    expect(harvestFrom(world, 4, 4, 30)).toEqual({ resource: Resource.Wood, amount: 10 });
  });

  it("turns an exhausted tile back into open ground", () => {
    // The cleared-forest rule. It also frees the tile for building, which is
    // why the flow-field cache has to be invalidated when it happens.
    const world = createWorld({ seed: 12, width: 16, height: 16, startingUnits: 0 });
    setTerrain(world.grid, 4, 4, Terrain.Forest);
    world.deposits[4 * world.grid.width + 4] = 5;

    harvestFrom(world, 4, 4, 5);

    expect(depositAt(world, 4, 4)).toBe(0);
    expect(terrainAt(world.grid, 4, 4)).toBe(Terrain.Grass);
  });

  it("yields nothing from an empty or non-resource tile", () => {
    const world = createWorld({ seed: 12, width: 16, height: 16, startingUnits: 0 });
    setTerrain(world.grid, 5, 5, Terrain.Grass);

    expect(harvestFrom(world, 5, 5, 10)).toBeNull();
    expect(harvestFrom(world, -1, 0, 10)).toBeNull();
  });
});

describe("player accounts", () => {
  it("starts a player with the stock they were given", () => {
    const player = createPlayer(0, { [Resource.Wood]: 200, [Resource.Stone]: 50 });
    expect(player.resources[Resource.Wood]).toBe(200);
    expect(player.resources[Resource.Stone]).toBe(50);
    expect(player.resources[Resource.Ore]).toBe(0);
  });

  it("credits deposits", () => {
    const player = createPlayer(0);
    credit(player, Resource.Wood, 40);
    credit(player, Resource.Wood, 10);
    expect(player.resources[Resource.Wood]).toBe(50);
  });

  it("knows what the player can afford", () => {
    const player = createPlayer(0, { [Resource.Wood]: 100 });
    const cheap: Cost = { [Resource.Wood]: 60 };
    const dear: Cost = { [Resource.Wood]: 60, [Resource.Stone]: 20 };

    expect(canAfford(player, cheap)).toBe(true);
    expect(canAfford(player, dear)).toBe(false);
  });

  it("only debits when the whole cost is covered", () => {
    // Half-paying would leave a building half-ordered and the books wrong.
    const player = createPlayer(0, { [Resource.Wood]: 100 });
    const dear: Cost = { [Resource.Wood]: 60, [Resource.Stone]: 20 };

    expect(debit(player, dear)).toBe(false);
    expect(player.resources[Resource.Wood]).toBe(100);

    expect(debit(player, { [Resource.Wood]: 60 })).toBe(true);
    expect(player.resources[Resource.Wood]).toBe(40);
  });

  it("never lets an account go negative", () => {
    const player = createPlayer(0, { [Resource.Wood]: 10 });
    debit(player, { [Resource.Wood]: 50 });
    expect(player.resources[Resource.Wood]).toBeGreaterThanOrEqual(0);
  });
});

describe("world setup", () => {
  it("gives the local player an account and a starting stock", () => {
    const world = createWorld({ seed: 3, width: 32, height: 32 });
    expect(world.players.length).toBeGreaterThan(0);
    expect(world.players[0]!.resources[Resource.Wood]).toBeGreaterThan(0);
  });

  it("stocks deposits identically for the same seed", () => {
    const a = createWorld({ seed: 77, width: 32, height: 32, startingUnits: 0 });
    const b = createWorld({ seed: 77, width: 32, height: 32, startingUnits: 0 });
    expect(Array.from(b.deposits)).toEqual(Array.from(a.deposits));
  });
});

describe("grid helper used by deposits", () => {
  it("leaves unrelated tiles alone when one is cleared", () => {
    const grid = createGrid(8, 8, Terrain.Forest);
    setTerrain(grid, 3, 3, Terrain.Grass);
    expect(terrainAt(grid, 3, 4)).toBe(Terrain.Forest);
  });
});
