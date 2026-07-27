/**
 * Placing and erecting buildings.
 *
 * The build-radius rule is the important one: you may only build within reach
 * of something you already own. That is what makes a base a connected,
 * defensible shape instead of huts sprinkled across the map — and it turns
 * expansion into a deliberate act of stretching your territory toward ground
 * somebody else wants.
 */

import { describe, expect, it } from "vitest";

import { BuildingType, buildingDef } from "../src/content/buildings.js";
import { UnitType } from "../src/content/units.js";
import {
  canPlace,
  placeBuildingAt,
  PlacementError,
  isWithinBuildRadius,
} from "../src/sim/construction.js";
import { addEntity, isComplete, type Entity } from "../src/sim/entities.js";
import { fromTiles } from "../src/sim/fixed.js";
import { createGrid, isPassable, setTerrain, Terrain } from "../src/sim/grid.js";
import { Resource } from "../src/sim/resources.js";
import { createWorld, tickWorld, type World } from "../src/sim/world.js";

function blankWorld(size = 40): World {
  const world = createWorld({ seed: 4, width: size, height: size, startingUnits: 0 });
  world.grid.tiles.set(createGrid(size, size, Terrain.Grass).tiles);
  world.grid.blocked.fill(0);
  world.deposits.fill(0);
  return world;
}

/** A world with a headquarters at (5,5) and plenty in the bank. */
function baseWorld(size = 40): { world: World; hq: Entity } {
  const world = blankWorld(size);
  world.players[0]!.resources[Resource.Wood] = 5000;
  world.players[0]!.resources[Resource.Stone] = 5000;
  const hq = placeBuildingAt(world, 0, BuildingType.Headquarters, 5, 5, { free: true, finished: true });
  if (!hq) throw new Error("headquarters could not be placed");
  return { world, hq };
}

function worker(world: World, tileX: number, tileY: number, owner = 0): Entity {
  return addEntity(world.entities, {
    typeId: UnitType.Worker,
    owner,
    x: fromTiles(tileX + 0.5),
    y: fromTiles(tileY + 0.5),
  });
}

describe("build radius", () => {
  it("allows building next to something you own", () => {
    const { world } = baseWorld();
    expect(isWithinBuildRadius(world, 0, 9, 6, 2)).toBe(true);
  });

  it("refuses building out in the wilderness", () => {
    const { world } = baseWorld();
    expect(isWithinBuildRadius(world, 0, 30, 30, 2)).toBe(false);
    expect(canPlace(world, 0, BuildingType.Depot, 30, 30).error).toBe(PlacementError.OutOfRange);
  });

  it("does not extend from another player's buildings", () => {
    const { world } = baseWorld();
    placeBuildingAt(world, 1, BuildingType.Headquarters, 25, 25, { free: true, finished: true });
    expect(isWithinBuildRadius(world, 0, 27, 27, 2)).toBe(false);
  });

  it("does not extend from a building that is still a site", () => {
    // Otherwise a player could chain unfinished shells across the map for free
    // reach, which is exactly the base-creep the rule exists to prevent.
    const { world } = baseWorld();
    placeBuildingAt(world, 0, BuildingType.Depot, 11, 5, { free: true });
    expect(isWithinBuildRadius(world, 0, 18, 5, 2)).toBe(false);
  });

  it("grows the buildable area once a depot finishes", () => {
    const { world } = baseWorld();
    expect(isWithinBuildRadius(world, 0, 16, 6, 2)).toBe(false);

    placeBuildingAt(world, 0, BuildingType.Depot, 11, 6, { free: true, finished: true });
    expect(isWithinBuildRadius(world, 0, 16, 6, 2)).toBe(true);
  });
});

describe("placement rules", () => {
  it("accepts a clear, affordable, in-range site", () => {
    const { world } = baseWorld();
    expect(canPlace(world, 0, BuildingType.Depot, 9, 5).ok).toBe(true);
  });

  it("refuses terrain that cannot be built on", () => {
    const { world } = baseWorld();
    setTerrain(world.grid, 9, 5, Terrain.Water);
    expect(canPlace(world, 0, BuildingType.Depot, 9, 5).error).toBe(PlacementError.BadTerrain);
  });

  it("refuses a footprint that only partly fits", () => {
    // A 2x2 depot with one corner in the water is still in the water.
    const { world } = baseWorld();
    setTerrain(world.grid, 10, 6, Terrain.Rock);
    expect(canPlace(world, 0, BuildingType.Depot, 9, 5).error).toBe(PlacementError.BadTerrain);
  });

  it("refuses to overlap an existing building", () => {
    const { world } = baseWorld();
    expect(canPlace(world, 0, BuildingType.Depot, 5, 5).error).toBe(PlacementError.Occupied);
    expect(canPlace(world, 0, BuildingType.Depot, 7, 7).error).toBe(PlacementError.Occupied);
  });

  it("refuses a site hanging off the map", () => {
    const { world } = baseWorld();
    expect(canPlace(world, 0, BuildingType.Depot, -1, 5).ok).toBe(false);
  });

  it("refuses what the player cannot afford", () => {
    const { world } = baseWorld();
    world.players[0]!.resources[Resource.Wood] = 0;
    expect(canPlace(world, 0, BuildingType.Depot, 9, 5).error).toBe(PlacementError.TooExpensive);
  });

  it("charges for the building when placed", () => {
    const { world } = baseWorld();
    const before = world.players[0]!.resources[Resource.Wood];
    placeBuildingAt(world, 0, BuildingType.Depot, 9, 5);
    const cost = buildingDef(BuildingType.Depot).cost[Resource.Wood] ?? 0;
    expect(world.players[0]!.resources[Resource.Wood]).toBe(before - cost);
  });

  it("refunds nothing and places nothing when the site is invalid", () => {
    const { world } = baseWorld();
    const before = world.players[0]!.resources[Resource.Wood];
    expect(placeBuildingAt(world, 0, BuildingType.Depot, 30, 30)).toBeNull();
    expect(world.players[0]!.resources[Resource.Wood]).toBe(before);
  });
});

describe("buildings occupy ground", () => {
  it("blocks its tiles so units walk around it", () => {
    const { world } = baseWorld();
    expect(isPassable(world.grid, 5, 5)).toBe(false);
    expect(isPassable(world.grid, 7, 7)).toBe(false);
    expect(isPassable(world.grid, 8, 8)).toBe(true);
  });

  it("marks terrain dirty so cached routes are thrown away", () => {
    const world = blankWorld();
    world.players[0]!.resources[Resource.Wood] = 5000;
    world.players[0]!.resources[Resource.Stone] = 5000;
    placeBuildingAt(world, 0, BuildingType.Headquarters, 5, 5, { free: true, finished: true });
    expect(world.terrainDirty).toBe(true);
  });
});

describe("construction", () => {
  it("starts as a site with work outstanding", () => {
    const { world } = baseWorld();
    const site = placeBuildingAt(world, 0, BuildingType.Depot, 9, 5);
    expect(site).not.toBeNull();
    expect(isComplete(site!)).toBe(false);
    expect(site!.construction).toBe(buildingDef(BuildingType.Depot).buildWork);
  });

  it("makes no progress without a builder", () => {
    const { world } = baseWorld();
    const site = placeBuildingAt(world, 0, BuildingType.Depot, 9, 5)!;
    const before = site.construction;
    for (let i = 0; i < 100; i++) tickWorld(world);
    expect(site.construction).toBe(before);
  });

  it("is finished by a worker sent to build it", () => {
    const { world } = baseWorld();
    const builder = worker(world, 10, 8);
    const site = placeBuildingAt(world, 0, BuildingType.Depot, 9, 5)!;

    tickWorld(world, [
      { type: "assist", playerId: 0, entityIds: [builder.id], targetId: site.id },
    ]);
    for (let i = 0; i < 400; i++) tickWorld(world);

    expect(isComplete(site)).toBe(true);
    expect(site.hp).toBe(buildingDef(BuildingType.Depot).maxHp);
  });

  it("gains health as it goes up", () => {
    const { world } = baseWorld();
    const builder = worker(world, 10, 8);
    const site = placeBuildingAt(world, 0, BuildingType.Depot, 9, 5)!;
    const startingHp = site.hp;

    tickWorld(world, [
      { type: "assist", playerId: 0, entityIds: [builder.id], targetId: site.id },
    ]);
    for (let i = 0; i < 120; i++) tickWorld(world);

    expect(site.hp).toBeGreaterThan(startingHp);
  });

  it("goes up faster with more builders", () => {
    const measure = (builders: number): number => {
      const { world } = baseWorld();
      const crew = Array.from({ length: builders }, (_, i) => worker(world, 10 + i, 9));
      const site = placeBuildingAt(world, 0, BuildingType.Depot, 9, 5)!;
      tickWorld(world, [
        { type: "assist", playerId: 0, entityIds: crew.map((w) => w.id), targetId: site.id },
      ]);

      for (let tick = 0; tick < 600; tick++) {
        tickWorld(world);
        if (isComplete(site)) return tick;
      }
      return Number.POSITIVE_INFINITY;
    };

    expect(measure(3)).toBeLessThan(measure(1));
  });

  it("releases its builders when it is done", () => {
    const { world } = baseWorld();
    const builder = worker(world, 10, 8);
    const site = placeBuildingAt(world, 0, BuildingType.Depot, 9, 5)!;

    tickWorld(world, [
      { type: "assist", playerId: 0, entityIds: [builder.id], targetId: site.id },
    ]);
    for (let i = 0; i < 400; i++) tickWorld(world);

    expect(builder.buildTargetId).toBeNull();
  });

  it("will not let a player build another player's site", () => {
    const { world } = baseWorld();
    const enemyWorker = worker(world, 10, 8, 1);
    const site = placeBuildingAt(world, 0, BuildingType.Depot, 9, 5)!;

    tickWorld(world, [
      { type: "assist", playerId: 1, entityIds: [enemyWorker.id], targetId: site.id },
    ]);
    expect(enemyWorker.buildTargetId).toBeNull();
  });

  it("accepts deliveries only once complete", () => {
    const { world } = baseWorld();
    const site = placeBuildingAt(world, 0, BuildingType.Depot, 9, 5)!;
    expect(isComplete(site)).toBe(false);

    const builder = worker(world, 10, 8);
    tickWorld(world, [
      { type: "assist", playerId: 0, entityIds: [builder.id], targetId: site.id },
    ]);
    for (let i = 0; i < 400; i++) tickWorld(world);
    expect(isComplete(site)).toBe(true);
  });
});
