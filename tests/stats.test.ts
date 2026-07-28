/**
 * The match tally.
 *
 * Not a debug readout: it is what the result screen has to say when the match
 * ends. "You won" answers nothing on its own — whether the win came from a
 * bigger economy or from losing half an army to take a base is the whole story
 * of the game just played.
 *
 * The counters are simulation state, which means they are deterministic and
 * part of the world hash. A run that gathers a different amount of wood from
 * the same seed is a desync, and should read as one.
 */

import { describe, expect, it } from "vitest";

import { BuildingType } from "../src/content/buildings.js";
import { UnitType } from "../src/content/units.js";
import { placeBuildingAt } from "../src/sim/construction.js";
import { addEntity, type Entity } from "../src/sim/entities.js";
import { fromTiles, toTiles } from "../src/sim/fixed.js";
import { createGrid, Terrain, terrainAt } from "../src/sim/grid.js";
import { hashWorld } from "../src/sim/hash.js";
import { Resource } from "../src/sim/resources.js";
import { statsFor, totalGathered } from "../src/sim/stats.js";
import { createWorld, tickWorld, type World } from "../src/sim/world.js";

function arena(size = 48): World {
  const world = createWorld({ seed: 5, width: size, height: size, startingUnits: 0 });
  world.grid.tiles.set(createGrid(size, size, Terrain.Grass).tiles);
  world.grid.blocked.fill(0);
  world.deposits.fill(0);
  for (const player of world.players) {
    player.resources[Resource.Wood] = 4000;
    player.resources[Resource.Stone] = 4000;
    player.resources[Resource.Ore] = 4000;
  }
  return world;
}

/** The forest tile nearest player 0's opening position. */
function findWood(world: World): { tileX: number; tileY: number } {
  const home = world.entities.list.find((entity) => entity.owner === 0)!;
  let best: { tileX: number; tileY: number } | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (let tileY = 0; tileY < world.grid.height; tileY++) {
    for (let tileX = 0; tileX < world.grid.width; tileX++) {
      if (terrainAt(world.grid, tileX, tileY) !== Terrain.Forest) continue;
      const distance = Math.hypot(tileX - toTiles(home.x), tileY - toTiles(home.y));
      if (distance < bestDistance) {
        bestDistance = distance;
        best = { tileX, tileY };
      }
    }
  }

  if (!best) throw new Error("the generated map has no forest at all");
  return best;
}

function unit(world: World, typeId: number, owner: number, tileX: number, tileY: number): Entity {
  return addEntity(world.entities, {
    typeId: typeId as never,
    owner,
    x: fromTiles(tileX),
    y: fromTiles(tileY),
  });
}

describe("the tally starts empty", () => {
  it("gives every player a record of their own", () => {
    const world = arena();
    expect(world.stats).toHaveLength(world.players.length);
    for (const player of world.players) {
      const stats = statsFor(world, player.id);
      expect(totalGathered(stats)).toBe(0);
      expect(stats.unitsTrained).toBe(0);
      expect(stats.buildingsBuilt).toBe(0);
      expect(stats.unitsLost).toBe(0);
      expect(stats.buildingsLost).toBe(0);
    }
  });
});

describe("what the tally counts", () => {
  it("counts a trained unit for the player who trained it", () => {
    const world = arena();
    const hq = placeBuildingAt(world, 0, BuildingType.Headquarters, 5, 5, {
      free: true,
      finished: true,
      ignoreRadius: true,
    })!;

    hq.production!.queue.push(UnitType.Worker);
    for (let i = 0; i < 400 && statsFor(world, 0).unitsTrained === 0; i++) tickWorld(world);

    expect(statsFor(world, 0).unitsTrained).toBe(1);
    expect(statsFor(world, 1).unitsTrained).toBe(0);
  });

  it("counts a finished building, not a placed one", () => {
    // A shell somebody started and abandoned is not an achievement, and
    // counting it would let the number run away from what is on the map.
    const world = arena();
    placeBuildingAt(world, 0, BuildingType.Headquarters, 5, 5, {
      free: true,
      finished: true,
      ignoreRadius: true,
    });
    const builder = unit(world, UnitType.Worker, 0, 9, 6);
    const site = placeBuildingAt(world, 0, BuildingType.Depot, 8, 5, { free: true })!;
    builder.buildTargetId = site.id;

    expect(statsFor(world, 0).buildingsBuilt).toBe(0);

    for (let i = 0; i < 600 && site.construction !== null; i++) tickWorld(world);

    expect(site.construction, "the depot never got finished").toBeNull();
    // The headquarters was placed already built and is not the builder's doing.
    expect(statsFor(world, 0).buildingsBuilt).toBe(1);
  });

  it("counts losses on the side that lost them", () => {
    const world = arena();
    const doomed = unit(world, UnitType.Soldier, 1, 20, 20);
    const building = placeBuildingAt(world, 1, BuildingType.Depot, 30, 30, {
      free: true,
      finished: true,
      ignoreRadius: true,
    })!;
    // Keep player 0 in the match so the tick does not end it early.
    placeBuildingAt(world, 0, BuildingType.Headquarters, 5, 5, {
      free: true,
      finished: true,
      ignoreRadius: true,
    });

    // Below zero rather than at it: a well-fed unit recovers a point of health
    // before the reaper runs, and exactly zero would be nursed back to one.
    doomed.hp = -1;
    building.hp = -1;
    tickWorld(world);

    expect(statsFor(world, 1).unitsLost).toBe(1);
    expect(statsFor(world, 1).buildingsLost).toBe(1);
    expect(statsFor(world, 0).unitsLost).toBe(0);
  });

  it("counts what workers actually bring home", () => {
    const world = createWorld({ seed: 20260727, width: 64, height: 64 });
    const wood = findWood(world);
    const workers = world.entities.list
      .filter((entity) => entity.owner === 0 && entity.typeId === UnitType.Worker)
      .map((entity) => entity.id);

    tickWorld(world, [
      { type: "gather", playerId: 0, entityIds: workers, tileX: wood.tileX, tileY: wood.tileY },
    ]);
    for (let i = 0; i < 900 && totalGathered(statsFor(world, 0)) === 0; i++) tickWorld(world);

    const gathered = statsFor(world, 0).gathered;
    expect(gathered[Resource.Wood]).toBeGreaterThan(0);
    // Only raw resources are gathered; planks and steel are made, not carried.
    expect(gathered[Resource.Planks]).toBe(0);
    expect(gathered[Resource.Steel]).toBe(0);
    expect(statsFor(world, 1).gathered[Resource.Wood]).toBe(0);
  });
});

describe("the tally is simulation truth", () => {
  it("comes out identical from the same seed", () => {
    const runs = [0, 1].map(() => {
      const world = createWorld({ seed: 4242, width: 64, height: 64 });
      for (let i = 0; i < 400; i++) tickWorld(world);
      return world;
    });

    expect(statsFor(runs[1]!, 0)).toEqual(statsFor(runs[0]!, 0));
  });

  it("is part of the world hash", () => {
    // If the tally could drift without the hash noticing, the determinism test
    // would be blind to a whole category of divergence.
    const world = createWorld({ seed: 7, width: 32, height: 32, startingUnits: 0 });
    const before = hashWorld(world);
    statsFor(world, 0).unitsLost += 1;

    expect(hashWorld(world)).not.toBe(before);
  });
});
