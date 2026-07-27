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
import { isPassable, terrainAt } from "../src/sim/grid.js";
import { RAW_KINDS, resourceOfTerrain, RESOURCE_NAMES } from "../src/sim/resources.js";
import { computeFlowField, isReachable } from "../src/sim/pathing.js";
import { createWorld, type World } from "../src/sim/world.js";

// Seeds 1 to 8 are the ones the headless match runner uses, so a map that
// cannot be played shows up here rather than as a nil-all twenty minutes later.
const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8, 42, 20260727, 31337];

/**
 * How far a worker can reasonably be sent from home for a seam.
 *
 * Beyond this the round trip costs more than the load is worth, and the answer
 * stops being "walk further" and becomes "build a depot out there" — which is a
 * decision, not an opening.
 */
const REACH_TILES = 14;

function headquartersOf(world: World, playerId: number): Entity | undefined {
  return world.entities.list.find(
    (entity) =>
      isBuilding(entity) && entity.typeId === BuildingType.Headquarters && entity.owner === playerId,
  );
}

function unitsOf(world: World, playerId: number): Entity[] {
  return world.entities.list.filter((entity) => isUnit(entity) && entity.owner === playerId);
}

/** The tile a unit is standing on — always walkable, unlike a building's centre. */
function standsOn(world: World, unit: Entity): { x: number; y: number } {
  return { x: Math.floor(toTiles(unit.x)), y: Math.floor(toTiles(unit.y)) };
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
    // property a generated map can quietly break, and it broke: two twenty
    // minute bot matches out of eight ended nil-all because one base sat on a
    // six-by-four island that nothing could ever walk to.
    //
    // Measured between the tiles the *units* start on, deliberately. An earlier
    // version of this test probed outward from each base for any walkable tile,
    // which happily found mainland grass diagonally across a corner of water —
    // ground beside the base that nobody standing at the base can get to. It
    // passed on every marooned seed.
    const world = createWorld({ seed, width: 64, height: 64 });
    const from = standsOn(world, unitsOf(world, 0)[0]!);
    const to = standsOn(world, unitsOf(world, 1)[0]!);
    const field = computeFlowField(world.grid, to.x, to.y);

    expect(
      isReachable(field, from.x, from.y),
      `seed ${seed}: the two bases are on separate land masses`,
    ).toBe(true);
  });

  it.each(SEEDS)("starts every unit where it can reach its own base on seed %i", (seed) => {
    const world = createWorld({ seed, width: 64, height: 64 });

    for (const playerId of [0, 1]) {
      const anchor = standsOn(world, unitsOf(world, playerId)[0]!);
      const field = computeFlowField(world.grid, anchor.x, anchor.y);

      for (const unit of unitsOf(world, playerId)) {
        const tile = standsOn(world, unit);
        expect(
          isReachable(field, tile.x, tile.y),
          `seed ${seed}: player ${playerId} has a unit cut off from its own opening`,
        ).toBe(true);
      }
    }
  });

  it.each(SEEDS)("opens with room to grow into on seed %i", (seed) => {
    // A start hemmed into a pocket is a loss dealt out by the map generator: no
    // deposits to fall back on, and nowhere to put the third building.
    const world = createWorld({ seed, width: 64, height: 64 });

    for (const playerId of [0, 1]) {
      const anchor = standsOn(world, unitsOf(world, playerId)[0]!);
      const field = computeFlowField(world.grid, anchor.x, anchor.y);

      let ground = 0;
      for (let y = 0; y < world.grid.height; y++) {
        for (let x = 0; x < world.grid.width; x++) {
          if (isReachable(field, x, y)) ground++;
        }
      }

      expect(ground, `seed ${seed}: player ${playerId} opens in a pocket`).toBeGreaterThan(400);
    }
  });

  it.each(SEEDS)("puts every raw resource within reach of both starts on seed %i", (seed) => {
    // "Some deposit nearby" is not enough, and believing it was cost an hour.
    // Forest is terrain and is everywhere; stone comes in a handful of scattered
    // clusters, and on most maps there was none within walking distance of
    // either base. Nearly every building in the game costs stone, so both bots
    // banked thousands of ore they could never spend, never built a second
    // refinery, and looked broken — while the fault was in the map.
    const world = createWorld({ seed, width: 64, height: 64 });

    for (const playerId of [0, 1]) {
      const origin = buildingOrigin(headquartersOf(world, playerId)!);
      const nearby = new Map<number, number>();

      for (let dy = -REACH_TILES; dy <= REACH_TILES; dy++) {
        for (let dx = -REACH_TILES; dx <= REACH_TILES; dx++) {
          const tileX = origin.tileX + dx;
          const tileY = origin.tileY + dy;
          const kind = resourceOfTerrain(terrainAt(world.grid, tileX, tileY));
          if (kind === null) continue;
          const index = tileY * world.grid.width + tileX;
          if ((world.deposits[index] ?? 0) <= 0) continue;
          nearby.set(kind, (nearby.get(kind) ?? 0) + 1);
        }
      }

      for (const kind of RAW_KINDS) {
        expect(
          nearby.get(kind) ?? 0,
          `seed ${seed}: player ${playerId} has no ${RESOURCE_NAMES[kind]} within ${REACH_TILES} tiles`,
        ).toBeGreaterThan(2);
      }
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
