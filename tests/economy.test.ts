/**
 * The gathering loop.
 *
 * A worker walks to a deposit, works it, carries a load to the nearest
 * drop-off, and goes back. That round trip is the only journey in the whole
 * economy — no carts, no supply lines — and it is deliberately the one thing
 * that *is* modelled, because it is what gives placing a depot a consequence.
 * A depot near a rich seam shortens every future trip; a depot far from home is
 * a fragile, valuable thing sitting where the enemy can reach it.
 */

import { describe, expect, it } from "vitest";

import { BuildingType } from "../src/content/buildings.js";
import { UnitType } from "../src/content/units.js";
import { addBuilding, addEntity, type Entity } from "../src/sim/entities.js";
import { fromTiles, ONE } from "../src/sim/fixed.js";
import { createGrid, setTerrain, Terrain } from "../src/sim/grid.js";
import { nearestDropOff, WORKER_CAPACITY } from "../src/sim/economy.js";
import { Resource, stockDeposits, depositAt } from "../src/sim/resources.js";
import { createWorld, tickWorld, type World } from "../src/sim/world.js";

/** A flat grass world with nothing on it but what a test puts there. */
function blankWorld(size = 40): World {
  const world = createWorld({ seed: 4, width: size, height: size, startingUnits: 0 });
  world.grid.tiles.set(createGrid(size, size, Terrain.Grass).tiles);
  stockDeposits(world);
  for (const player of world.players) {
    player.resources[Resource.Wood] = 0;
    player.resources[Resource.Stone] = 0;
    player.resources[Resource.Ore] = 0;
  }
  return world;
}

function worker(world: World, tileX: number, tileY: number, owner = 0): Entity {
  return addEntity(world.entities, {
    typeId: UnitType.Worker,
    owner,
    x: fromTiles(tileX + 0.5),
    y: fromTiles(tileY + 0.5),
  });
}

function forest(world: World, tileX: number, tileY: number, amount = 240): void {
  setTerrain(world.grid, tileX, tileY, Terrain.Forest);
  world.deposits[tileY * world.grid.width + tileX] = amount;
}

function gather(world: World, entity: Entity, tileX: number, tileY: number): void {
  tickWorld(world, [
    { type: "gather", playerId: entity.owner, entityIds: [entity.id], tileX, tileY },
  ]);
}

describe("gather orders", () => {
  it("sends the worker to the deposit", () => {
    const world = blankWorld();
    forest(world, 12, 6);
    const unit = worker(world, 6, 6);

    gather(world, unit, 12, 6);

    expect(unit.job).not.toBeNull();
    expect(unit.job?.nodeX).toBe(12);
    for (let i = 0; i < 40; i++) tickWorld(world);
    expect(unit.x).toBeGreaterThan(fromTiles(8));
  });

  it("refuses an order for another player's worker", () => {
    const world = blankWorld();
    forest(world, 12, 6);
    const enemy = worker(world, 6, 6, 1);

    tickWorld(world, [
      { type: "gather", playerId: 0, entityIds: [enemy.id], tileX: 12, tileY: 6 },
    ]);
    expect(enemy.job).toBeNull();
  });

  it("ignores an order to gather from bare ground", () => {
    const world = blankWorld();
    const unit = worker(world, 6, 6);
    gather(world, unit, 12, 6);
    expect(unit.job).toBeNull();
  });

  it("only workers gather", () => {
    // A soldier told to mine should simply not, rather than silently becoming
    // an economy unit.
    const world = blankWorld();
    forest(world, 12, 6);
    const soldier = addEntity(world.entities, {
      typeId: UnitType.Soldier,
      owner: 0,
      x: fromTiles(6),
      y: fromTiles(6),
    });

    gather(world, soldier, 12, 6);
    expect(soldier.job).toBeNull();
  });
});

describe("deposits nobody can reach", () => {
  /** A world split down the middle by water, with woods on the far side. */
  function dividedWorld(): World {
    const world = blankWorld();
    for (let tileY = 0; tileY < world.grid.height; tileY++) {
      setTerrain(world.grid, 20, tileY, Terrain.Water);
    }
    forest(world, 30, 6);
    return world;
  }

  it("gives up on a deposit across the water instead of standing there forever", () => {
    // The failure this prevents is silent and total: movement refuses a goal it
    // cannot route to and clears it, gathering notices no goal and sets the same
    // one again, and the worker stands pinned for the rest of the match. A whole
    // bot economy died this way — thirteen workers, none of them moving.
    const world = dividedWorld();
    const unit = worker(world, 6, 6);

    gather(world, unit, 30, 6);
    for (let i = 0; i < 60; i++) tickWorld(world);

    expect(unit.job).toBeNull();
    expect(unit.goalX).toBeNull();
  });

  it("switches to a reachable deposit rather than one across the water", () => {
    const world = dividedWorld();
    forest(world, 14, 6);
    const unit = worker(world, 6, 6);

    gather(world, unit, 30, 6);
    for (let i = 0; i < 60; i++) tickWorld(world);

    // Re-seeking must not simply walk the search sideways into more of the same
    // unreachable patch, so the near side is the only acceptable answer.
    expect(unit.job?.nodeX).toBe(14);
  });

  it("leaves a reachable deposit alone", () => {
    const world = dividedWorld();
    forest(world, 14, 6);
    const unit = worker(world, 6, 6);

    gather(world, unit, 14, 6);
    for (let i = 0; i < 60; i++) tickWorld(world);

    expect(unit.job?.nodeX).toBe(14);
  });
});

describe("the round trip", () => {
  it("harvests a load, carries it home, and banks it", () => {
    const world = blankWorld();
    forest(world, 12, 6);
    addBuilding(world.entities, { typeId: BuildingType.Headquarters, owner: 0, tileX: 5, tileY: 5 });
    const unit = worker(world, 8, 6);

    gather(world, unit, 12, 6);
    for (let i = 0; i < 400; i++) tickWorld(world);

    expect(world.players[0]!.resources[Resource.Wood]).toBeGreaterThan(0);
  });

  it("never carries more than one load", () => {
    const world = blankWorld();
    forest(world, 12, 6);
    addBuilding(world.entities, { typeId: BuildingType.Headquarters, owner: 0, tileX: 5, tileY: 5 });
    const unit = worker(world, 11, 6);

    gather(world, unit, 12, 6);
    for (let i = 0; i < 400; i++) {
      tickWorld(world);
      expect(unit.job?.carried ?? 0).toBeLessThanOrEqual(WORKER_CAPACITY);
    }
  });

  it("keeps cycling instead of stopping after one trip", () => {
    const world = blankWorld();
    forest(world, 12, 6);
    addBuilding(world.entities, { typeId: BuildingType.Headquarters, owner: 0, tileX: 5, tileY: 5 });
    const unit = worker(world, 11, 6);

    gather(world, unit, 12, 6);
    for (let i = 0; i < 400; i++) tickWorld(world);
    const afterFirst = world.players[0]!.resources[Resource.Wood];

    for (let i = 0; i < 600; i++) tickWorld(world);
    expect(world.players[0]!.resources[Resource.Wood]).toBeGreaterThan(afterFirst);
  });

  it("draws the banked wood out of the ground it came from", () => {
    const world = blankWorld();
    forest(world, 12, 6, 240);
    addBuilding(world.entities, { typeId: BuildingType.Headquarters, owner: 0, tileX: 5, tileY: 5 });
    const unit = worker(world, 11, 6);

    gather(world, unit, 12, 6);
    for (let i = 0; i < 600; i++) tickWorld(world);

    // Resources are conserved: what the player banked plus what the worker is
    // still holding equals what the tile lost.
    const taken = 240 - depositAt(world, 12, 6);
    const banked = world.players[0]!.resources[Resource.Wood];
    expect(taken).toBe(banked + (unit.job?.carried ?? 0));
  });

  it("moves to a nearby deposit when its own runs out", () => {
    const world = blankWorld();
    forest(world, 12, 6, 10);
    forest(world, 13, 6, 240);
    addBuilding(world.entities, { typeId: BuildingType.Headquarters, owner: 0, tileX: 5, tileY: 5 });
    const unit = worker(world, 11, 6);

    gather(world, unit, 12, 6);
    for (let i = 0; i < 800; i++) tickWorld(world);

    // The first tile is stripped and the worker carried on rather than idling.
    expect(depositAt(world, 12, 6)).toBe(0);
    expect(world.players[0]!.resources[Resource.Wood]).toBeGreaterThan(10);
  });

  it("stops when there is nothing left anywhere near", () => {
    const world = blankWorld();
    forest(world, 12, 6, 5);
    addBuilding(world.entities, { typeId: BuildingType.Headquarters, owner: 0, tileX: 5, tileY: 5 });
    const unit = worker(world, 11, 6);

    gather(world, unit, 12, 6);
    for (let i = 0; i < 800; i++) tickWorld(world);

    expect(unit.job).toBeNull();
    expect(world.players[0]!.resources[Resource.Wood]).toBe(5);
  });

  it("holds its load when there is nowhere to deliver", () => {
    // No drop-off built yet. The worker should keep what it dug rather than
    // dropping it, so the load is not silently destroyed.
    const world = blankWorld();
    forest(world, 12, 6);
    const unit = worker(world, 11, 6);

    gather(world, unit, 12, 6);
    for (let i = 0; i < 200; i++) tickWorld(world);

    expect(unit.job?.carried).toBeGreaterThan(0);
    expect(world.players[0]!.resources[Resource.Wood]).toBe(0);
  });
});

describe("choosing a drop-off", () => {
  it("delivers to the nearest one", () => {
    // The reason a depot is worth building at all.
    const world = blankWorld();
    const hq = addBuilding(world.entities, {
      typeId: BuildingType.Headquarters,
      owner: 0,
      tileX: 2,
      tileY: 2,
    });
    const depot = addBuilding(world.entities, {
      typeId: BuildingType.Depot,
      owner: 0,
      tileX: 20,
      tileY: 20,
    });
    const unit = worker(world, 22, 22);

    expect(nearestDropOff(world, unit)?.id).toBe(depot.id);

    const distant = worker(world, 3, 3);
    expect(nearestDropOff(world, distant)?.id).toBe(hq.id);
  });

  it("ignores another player's buildings", () => {
    const world = blankWorld();
    addBuilding(world.entities, { typeId: BuildingType.Depot, owner: 1, tileX: 10, tileY: 10 });
    const unit = worker(world, 11, 11);

    expect(nearestDropOff(world, unit)).toBeNull();
  });

  it("ignores a building that is still a construction site", () => {
    // Delivering into a half-built shell would let a player bank resources
    // through something that does not exist yet.
    const world = blankWorld();
    addBuilding(world.entities, {
      typeId: BuildingType.Depot,
      owner: 0,
      tileX: 10,
      tileY: 10,
      underConstruction: true,
    });
    const unit = worker(world, 11, 11);

    expect(nearestDropOff(world, unit)).toBeNull();
  });

  it("shortens the trip once a closer depot exists", () => {
    const measure = (withDepot: boolean): number => {
      const world = blankWorld();
      for (let i = 0; i < 6; i++) forest(world, 24 + i, 24);
      addBuilding(world.entities, { typeId: BuildingType.Headquarters, owner: 0, tileX: 2, tileY: 2 });
      if (withDepot) {
        addBuilding(world.entities, { typeId: BuildingType.Depot, owner: 0, tileX: 22, tileY: 23 });
      }
      const unit = worker(world, 23, 24);
      gather(world, unit, 24, 24);
      for (let i = 0; i < 900; i++) tickWorld(world);
      return world.players[0]!.resources[Resource.Wood];
    };

    expect(measure(true)).toBeGreaterThan(measure(false));
  });
});

describe("determinism", () => {
  it("runs the whole economy identically twice", () => {
    const run = (): number[] => {
      const world = blankWorld();
      for (let i = 0; i < 5; i++) forest(world, 12 + i, 6);
      addBuilding(world.entities, { typeId: BuildingType.Headquarters, owner: 0, tileX: 5, tileY: 5 });
      const units = Array.from({ length: 6 }, (_, i) => worker(world, 8 + i, 8));
      tickWorld(world, [
        {
          type: "gather",
          playerId: 0,
          entityIds: units.map((u) => u.id),
          tileX: 12,
          tileY: 6,
        },
      ]);
      for (let i = 0; i < 500; i++) tickWorld(world);
      return [world.players[0]!.resources[Resource.Wood], ...units.flatMap((u) => [u.x, u.y])];
    };

    expect(run()).toEqual(run());
  });

  it("keeps positions in fixed point", () => {
    const world = blankWorld();
    forest(world, 12, 6);
    addBuilding(world.entities, { typeId: BuildingType.Headquarters, owner: 0, tileX: 5, tileY: 5 });
    const unit = worker(world, 11, 6);
    gather(world, unit, 12, 6);
    for (let i = 0; i < 300; i++) tickWorld(world);

    expect(Number.isInteger(unit.x)).toBe(true);
    expect(Number.isInteger(unit.y)).toBe(true);
    expect(unit.x % 1).toBe(0);
    expect(ONE).toBe(256);
  });
});
