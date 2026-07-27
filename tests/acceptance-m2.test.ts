/**
 * The M2 acceptance criterion, as an executable test.
 *
 * The milestone is: "you can raise a small working base from a headquarters."
 * That means the whole loop has to close — gather, bank, spend, produce, build,
 * gather faster — on a *generated* map, not a hand-made flat one. Anything less
 * is a set of features that each work alone.
 */

import { describe, expect, it } from "vitest";

import { BuildingType } from "../src/content/buildings.js";
import { UnitType } from "../src/content/units.js";
import type { Command } from "../src/sim/commands.js";
import { canPlace } from "../src/sim/construction.js";
import { isWorker } from "../src/sim/economy.js";
import { isBuilding, isComplete, isUnit, type Entity } from "../src/sim/entities.js";
import { terrainAt } from "../src/sim/grid.js";
import { Resource, resourceOfTerrain } from "../src/sim/resources.js";
import { createWorld, tickWorld, type World } from "../src/sim/world.js";

const SEEDS = [20260727, 31337, 7];

function headquarters(world: World): Entity {
  const hq = world.entities.list.find(
    (entity) => isBuilding(entity) && entity.typeId === BuildingType.Headquarters && entity.owner === 0,
  );
  if (!hq) throw new Error("no headquarters in the starting position");
  return hq;
}

function workers(world: World): Entity[] {
  return world.entities.list.filter((entity) => isWorker(entity) && entity.owner === 0);
}

/** The closest tile to the headquarters that yields the given resource. */
function nearestDeposit(world: World, resource: number): { tileX: number; tileY: number } | null {
  const hq = headquarters(world);
  const fromX = Math.floor(hq.x / 256);
  const fromY = Math.floor(hq.y / 256);

  for (let radius = 1; radius < 30; radius++) {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
        const tileX = fromX + dx;
        const tileY = fromY + dy;
        if (resourceOfTerrain(terrainAt(world.grid, tileX, tileY)) === resource) {
          return { tileX, tileY };
        }
      }
    }
  }
  return null;
}

function run(world: World, ticks: number, commands: Command[] = []): void {
  tickWorld(world, commands);
  for (let i = 1; i < ticks; i++) tickWorld(world);
}

describe("M2 acceptance: raising a base", () => {
  it.each(SEEDS)("starts with a headquarters and workers on seed %i", (seed) => {
    const world = createWorld({ seed, width: 64, height: 64 });

    expect(headquarters(world)).toBeDefined();
    expect(workers(world).length).toBeGreaterThan(0);
    // The opening position must be usable: a headquarters standing in a lake
    // would make the seed unplayable.
    expect(isComplete(headquarters(world))).toBe(true);
  });

  it.each(SEEDS)("closes the whole economic loop on seed %i", (seed) => {
    const world = createWorld({ seed, width: 64, height: 64 });
    const hq = headquarters(world);
    const wood = nearestDeposit(world, Resource.Wood);
    expect(wood, `seed ${seed} has no wood near the start`).not.toBeNull();

    const startingWorkers = workers(world).length;
    const startingWood = world.players[0]!.resources[Resource.Wood];

    // 1. Put everyone to work.
    run(world, 1, [
      {
        type: "gather",
        playerId: 0,
        entityIds: workers(world).map((entity) => entity.id),
        tileX: wood!.tileX,
        tileY: wood!.tileY,
      },
    ]);

    // 2. Spend the opening stock on more workers.
    run(world, 1, [
      { type: "train", playerId: 0, buildingId: hq.id, unitType: UnitType.Worker },
      { type: "train", playerId: 0, buildingId: hq.id, unitType: UnitType.Worker },
      { type: "train", playerId: 0, buildingId: hq.id, unitType: UnitType.Worker },
    ]);

    // Three minutes of simulated time.
    run(world, 1800);

    // The loop closed: wood came out of the ground faster than it was spent.
    expect(world.players[0]!.resources[Resource.Wood]).toBeGreaterThan(startingWood / 2);
    expect(workers(world).length).toBe(startingWorkers + 3);
  });

  it("banks more wood with more workers on it", () => {
    // The economy has to actually reward investment, or none of the decisions
    // above mean anything.
    const measure = (workerLimit: number): number => {
      const world = createWorld({ seed: 20260727, width: 64, height: 64 });
      const wood = nearestDeposit(world, Resource.Wood)!;
      const crew = workers(world).slice(0, workerLimit);

      run(world, 900, [
        {
          type: "gather",
          playerId: 0,
          entityIds: crew.map((entity) => entity.id),
          tileX: wood.tileX,
          tileY: wood.tileY,
        },
      ]);
      return world.players[0]!.resources[Resource.Wood];
    };

    expect(measure(6)).toBeGreaterThan(measure(2));
  });

  it("builds a depot and uses it", () => {
    const world = createWorld({ seed: 20260727, width: 64, height: 64 });
    const wood = nearestDeposit(world, Resource.Wood)!;

    // Find a legal spot for a depot, working outward from the deposit so it
    // lands between the trees and home — the placement a player would choose.
    let site: { tileX: number; tileY: number } | null = null;
    outer: for (let radius = 1; radius < 12 && !site; radius++) {
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const tileX = wood.tileX + dx;
          const tileY = wood.tileY + dy;
          if (canPlace(world, 0, BuildingType.Depot, tileX, tileY).ok) {
            site = { tileX, tileY };
            break outer;
          }
        }
      }
    }
    expect(site, "nowhere legal to put a depot near the start").not.toBeNull();

    const crew = workers(world);
    run(world, 1, [
      {
        type: "build",
        playerId: 0,
        entityIds: crew.map((entity) => entity.id),
        buildingType: BuildingType.Depot,
        tileX: site!.tileX,
        tileY: site!.tileY,
      },
    ]);

    run(world, 600);

    const depot = world.entities.list.find(
      (entity) => isBuilding(entity) && entity.typeId === BuildingType.Depot,
    );
    expect(depot, "the depot was never placed").toBeDefined();
    expect(isComplete(depot!), "the depot was never finished").toBe(true);
  });

  it("keeps the simulation cheap enough for a phone", () => {
    const world = createWorld({ seed: 20260727, width: 64, height: 64 });
    const wood = nearestDeposit(world, Resource.Wood)!;
    run(world, 1, [
      {
        type: "gather",
        playerId: 0,
        entityIds: workers(world).map((entity) => entity.id),
        tileX: wood.tileX,
        tileY: wood.tileY,
      },
    ]);

    const started = performance.now();
    for (let i = 0; i < 600; i++) tickWorld(world);
    const averageMs = (performance.now() - started) / 600;

    // Loose on purpose: CI hardware varies far too much to police
    // milliseconds. This exists to catch an algorithmic regression.
    expect(averageMs, `average tick ${averageMs.toFixed(3)} ms`).toBeLessThan(20);
  });

  it("runs the whole base-building sequence identically twice", () => {
    const play = (): number[] => {
      const world = createWorld({ seed: 20260727, width: 64, height: 64 });
      const hq = headquarters(world);
      const wood = nearestDeposit(world, Resource.Wood)!;

      run(world, 1, [
        {
          type: "gather",
          playerId: 0,
          entityIds: workers(world).map((entity) => entity.id),
          tileX: wood.tileX,
          tileY: wood.tileY,
        },
        { type: "train", playerId: 0, buildingId: hq.id, unitType: UnitType.Worker },
      ]);
      run(world, 800);

      return [
        world.players[0]!.resources[Resource.Wood],
        world.entities.list.length,
        ...world.entities.list.flatMap((entity) => [entity.x, entity.y, entity.hp]),
      ];
    };

    expect(play()).toEqual(play());
  });

  it("never leaves a unit standing inside a building", () => {
    const world = createWorld({ seed: 20260727, width: 64, height: 64 });
    const wood = nearestDeposit(world, Resource.Wood)!;
    run(world, 1, [
      {
        type: "gather",
        playerId: 0,
        entityIds: workers(world).map((entity) => entity.id),
        tileX: wood.tileX,
        tileY: wood.tileY,
      },
    ]);

    for (let tick = 0; tick < 900; tick++) {
      tickWorld(world);
      if (tick % 50 !== 0) continue;

      for (const entity of world.entities.list) {
        if (!isUnit(entity)) continue;
        const tileX = Math.floor(entity.x / 256);
        const tileY = Math.floor(entity.y / 256);
        expect(
          world.grid.blocked[tileY * world.grid.width + tileX],
          `unit ${entity.id} is inside a building at tick ${tick}`,
        ).toBe(0);
      }
    }
  });
});
