/**
 * Opening positions.
 *
 * Until now only player zero had a base, which was fine while the second slot
 * was inert. A bot match needs both sides to start from something comparable —
 * and "comparable" has to hold on *generated* maps, where one anchor may land
 * in a lake and the other in open grass.
 *
 * The properties that matter: everyone gets a headquarters and workers,
 * everyone can reach everyone (a match where the armies cannot meet is not a
 * match), and nobody starts on top of somebody else.
 */

import { describe, expect, it } from "vitest";

import { BuildingType } from "../src/content/buildings.js";
import { UnitType } from "../src/content/units.js";
import { buildingOrigin, isBuilding, isUnit, type Entity } from "../src/sim/entities.js";
import { dist, ONE, toTiles } from "../src/sim/fixed.js";
import { isPassable } from "../src/sim/grid.js";
import { computeFlowField, isReachable } from "../src/sim/pathing.js";
import { createWorld, type World } from "../src/sim/world.js";

const SEEDS = [1, 7, 42, 20260727, 31337];

function headquartersOf(world: World, playerId: number): Entity | undefined {
  return world.entities.list.find(
    (entity) =>
      isBuilding(entity) && entity.typeId === BuildingType.Headquarters && entity.owner === playerId,
  );
}

function unitsOf(world: World, playerId: number): Entity[] {
  return world.entities.list.filter((entity) => isUnit(entity) && entity.owner === playerId);
}

describe("two-player starts", () => {
  it.each(SEEDS)("gives both players a headquarters on seed %i", (seed) => {
    const world = createWorld({ seed, width: 64, height: 64 });

    for (const playerId of [0, 1]) {
      const hq = headquartersOf(world, playerId);
      expect(hq, `player ${playerId} has no headquarters`).toBeDefined();
      expect(hq!.construction, "the opening headquarters must be finished").toBeNull();
    }
  });

  it.each(SEEDS)("gives both players the same number of workers on seed %i", (seed) => {
    const world = createWorld({ seed, width: 64, height: 64 });
    const counts = [0, 1].map((playerId) => unitsOf(world, playerId).length);

    expect(counts[0]).toBeGreaterThan(0);
    // Anything else is an unearned advantage decided by map generation.
    expect(counts[1]).toBe(counts[0]);
  });

  it.each(SEEDS)("starts every unit on ground it can stand on, seed %i", (seed) => {
    const world = createWorld({ seed, width: 64, height: 64 });

    for (const entity of world.entities.list) {
      if (!isUnit(entity)) continue;
      const tileX = Math.floor(toTiles(entity.x));
      const tileY = Math.floor(toTiles(entity.y));
      expect(isPassable(world.grid, tileX, tileY), `unit ${entity.id} starts inside terrain`).toBe(true);
    }
  });

  it.each(SEEDS)("keeps the two bases well apart on seed %i", (seed) => {
    const world = createWorld({ seed, width: 64, height: 64 });
    const a = headquartersOf(world, 0)!;
    const b = headquartersOf(world, 1)!;

    // Far enough that neither opens inside the other's build radius.
    expect(toTiles(dist(a.x, a.y, b.x, b.y))).toBeGreaterThan(20);
  });

  it.each(SEEDS)("lets the two sides actually reach each other on seed %i", (seed) => {
    // A match where the armies cannot meet is not a match. This is the one
    // property a generated map can quietly break.
    const world = createWorld({ seed, width: 64, height: 64 });
    const a = headquartersOf(world, 0)!;
    const b = headquartersOf(world, 1)!;

    // Probe from walkable ground beside each base — the building's own tiles
    // are blocked, and a flow field aimed at blocked ground is unreachable
    // everywhere, which would make this test pass or fail for the wrong reason.
    const beside = (entity: Entity): { x: number; y: number } => {
      const origin = buildingOrigin(entity);
      for (let radius = 1; radius < 10; radius++) {
        for (let dy = -radius; dy <= radius; dy++) {
          for (let dx = -radius; dx <= radius; dx++) {
            if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
            const x = origin.tileX + dx;
            const y = origin.tileY + dy;
            if (isPassable(world.grid, x, y)) return { x, y };
          }
        }
      }
      throw new Error("no walkable ground beside the base");
    };

    const from = beside(a);
    const to = beside(b);
    const field = computeFlowField(world.grid, to.x, to.y);

    expect(
      isReachable(field, from.x, from.y),
      `seed ${seed}: the two bases are on separate land masses`,
    ).toBe(true);
  });

  it.each(SEEDS)("puts resources within reach of both starts on seed %i", (seed) => {
    // A base that opens with no wood nearby has lost before the first order.
    const world = createWorld({ seed, width: 64, height: 64 });

    for (const playerId of [0, 1]) {
      const hq = headquartersOf(world, playerId)!;
      const origin = buildingOrigin(hq);

      let found = 0;
      for (let dy = -14; dy <= 14; dy++) {
        for (let dx = -14; dx <= 14; dx++) {
          const index = (origin.tileY + dy) * world.grid.width + (origin.tileX + dx);
          if (index < 0 || index >= world.deposits.length) continue;
          if (world.deposits[index]! > 0) found++;
        }
      }

      expect(found, `player ${playerId} starts with nothing to harvest`).toBeGreaterThan(10);
    }
  });
});

describe("determinism and configuration", () => {
  it("places everything identically for the same seed", () => {
    const snapshot = (): number[] => {
      const world = createWorld({ seed: 4242, width: 64, height: 64 });
      return world.entities.list.flatMap((entity) => [entity.owner, entity.typeId, entity.x, entity.y]);
    };
    expect(snapshot()).toEqual(snapshot());
  });

  it("can be asked for an empty world", () => {
    const world = createWorld({ seed: 1, width: 32, height: 32, startingUnits: 0 });
    expect(world.entities.list).toHaveLength(0);
  });

  it("gives the first player a scout among the workers", () => {
    const world = createWorld({ seed: 1, width: 64, height: 64 });
    const types = unitsOf(world, 0).map((entity) => entity.typeId);
    expect(types).toContain(UnitType.Worker);
    expect(types).toContain(UnitType.Scout);
  });

  it("charges nobody for their opening base", () => {
    const world = createWorld({ seed: 1, width: 64, height: 64 });
    // Both start on the same books; the opening position is a gift, not a purchase.
    expect(world.players[0]!.resources).toEqual(world.players[1]!.resources);
  });

  it("keeps starting units clear of every building footprint", () => {
    for (const seed of SEEDS) {
      const world = createWorld({ seed, width: 64, height: 64 });
      for (const entity of world.entities.list) {
        if (!isUnit(entity)) continue;
        const tileX = Math.floor(entity.x / ONE);
        const tileY = Math.floor(entity.y / ONE);
        expect(world.grid.blocked[tileY * world.grid.width + tileX]).toBe(0);
      }
    }
  });
});
