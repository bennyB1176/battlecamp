/**
 * When a match is actually over.
 *
 * The rule used to be "nothing left at all", and on a phone that turned a won
 * game into a chore: every building of the opponent flattened, the base gone,
 * and the match still running because one scout was walking around a corner of
 * a 64×64 map. The player had won and the game would not say so.
 *
 * The rule that replaces it keeps the comeback the old one was protecting —
 * losing your buildings is not losing — while ending matches that are decided:
 * **you are out when you have nothing left that could rebuild.** A worker can
 * put a headquarters back up. A lone soldier never can, no matter how long the
 * winner spends hunting it.
 */

import { describe, expect, it } from "vitest";

import { BuildingType } from "../src/content/buildings.js";
import { UnitType } from "../src/content/units.js";
import { addEntity, type Entity } from "../src/sim/entities.js";
import { fromTiles } from "../src/sim/fixed.js";
import { placeBuildingAt } from "../src/sim/construction.js";
import { createGrid, Terrain } from "../src/sim/grid.js";
import { createWorld, tickWorld, type World } from "../src/sim/world.js";
import { canRebuild, isDefeated } from "../src/sim/victory.js";

/** Flat grass, no deposits: nothing here should depend on what a map generator
 *  happened to put under a test's chosen tile. */
function arena(size = 48): World {
  const world = createWorld({ seed: 11, width: size, height: size, startingUnits: 0 });
  world.grid.tiles.set(createGrid(size, size, Terrain.Grass).tiles);
  world.grid.blocked.fill(0);
  world.deposits.fill(0);
  return world;
}

function unit(world: World, typeId: number, owner: number, tileX = 20, tileY = 20): Entity {
  return addEntity(world.entities, {
    typeId: typeId as never,
    owner,
    x: fromTiles(tileX),
    y: fromTiles(tileY),
  });
}

function hq(world: World, owner: number, tileX: number, tileY: number): Entity {
  const built = placeBuildingAt(world, owner, BuildingType.Headquarters, tileX, tileY, {
    free: true,
    finished: true,
    ignoreRadius: true,
  });
  // Without this a refused placement would silently turn every assertion below
  // into a test of an empty world, which passes for the wrong reason.
  if (!built) throw new Error(`could not place a headquarters at ${tileX},${tileY}`);
  return built;
}

describe("who is still in the match", () => {
  it("counts a player with nothing at all as defeated", () => {
    const world = arena();
    hq(world, 0, 5, 5);
    expect(isDefeated(world, 1)).toBe(true);
  });

  it("keeps a player with a building in, even with no units", () => {
    // A headquarters trains workers. As long as one building stands, the
    // player has a way back and the match is not decided.
    const world = arena();
    hq(world, 1, 30, 30);
    expect(isDefeated(world, 1)).toBe(false);
  });

  it("keeps a player with a worker in, even with no buildings", () => {
    // The comeback the old rule was protecting, and it still holds.
    const world = arena();
    unit(world, UnitType.Worker, 1);
    expect(isDefeated(world, 1)).toBe(false);
  });

  it("counts an army with no base and no worker as beaten", () => {
    // This is the change. Soldiers cannot build; a side reduced to soldiers
    // can never put anything back up, so the match is settled whether or not
    // the winner ever finds the last one.
    const world = arena();
    for (const typeId of [UnitType.Soldier, UnitType.Scout, UnitType.Grenadier]) {
      unit(world, typeId, 1);
    }
    expect(isDefeated(world, 1)).toBe(true);
  });

  it("says plainly which units could rebuild", () => {
    const world = arena();
    const worker = unit(world, UnitType.Worker, 1);
    const soldier = unit(world, UnitType.Soldier, 1);

    expect(canRebuild(worker)).toBe(true);
    expect(canRebuild(soldier)).toBe(false);
  });
});

describe("settling the match", () => {
  it("ends it once the loser is down to soldiers", () => {
    const world = arena();
    hq(world, 0, 5, 5);
    unit(world, UnitType.Soldier, 1, 40, 40);

    tickWorld(world);

    expect(world.matchOver).toBe(true);
    expect(world.winner).toBe(0);
  });

  it("leaves it running while the loser still has a worker", () => {
    const world = arena();
    hq(world, 0, 5, 5);
    unit(world, UnitType.Worker, 1, 40, 40);

    tickWorld(world);

    expect(world.matchOver).toBe(false);
    expect(world.winner).toBeNull();
  });

  it("calls a draw when neither side can rebuild", () => {
    const world = arena();
    unit(world, UnitType.Soldier, 0, 5, 5);
    unit(world, UnitType.Soldier, 1, 40, 40);

    tickWorld(world);

    expect(world.matchOver).toBe(true);
    expect(world.winner).toBeNull();
  });

  it("leaves a freshly generated match alone", () => {
    // The guard that matters in practice: a real opening position, with both
    // sides set up by the generator, must not be settled before it starts.
    const world = createWorld({ seed: 20260727, width: 64, height: 64 });
    for (let i = 0; i < 10; i++) tickWorld(world);

    expect(world.matchOver).toBe(false);
    expect(world.winner).toBeNull();
  });
});
