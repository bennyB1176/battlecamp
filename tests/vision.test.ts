/**
 * Who can see what.
 *
 * Two layers, and the difference between them is the whole design:
 *
 * - **explored** is memory. Once a tile has been looked at it stays known, and
 *   the terrain there is drawn from then on. Nobody forgets where the mountains
 *   were.
 * - **visible** is now. It is recomputed every tick from what is standing
 *   where, and it is what decides whether an enemy is drawn at all.
 *
 * Keeping them apart is what makes scouting worth doing twice: the first trip
 * tells you the shape of the map forever, and only a second one tells you what
 * is on it today.
 */

import { describe, expect, it } from "vitest";

import { BuildingType } from "../src/content/buildings.js";
import { UnitType, unitDef } from "../src/content/units.js";
import { placeBuildingAt } from "../src/sim/construction.js";
import { addEntity, removeEntity, type Entity } from "../src/sim/entities.js";
import { fromTiles, toTiles } from "../src/sim/fixed.js";
import { createGrid, Terrain } from "../src/sim/grid.js";
import { hashWorld } from "../src/sim/hash.js";
import { isExplored, isVisible, visibleTo } from "../src/sim/vision.js";
import { createWorld, tickWorld, type World } from "../src/sim/world.js";

function arena(size = 48): World {
  const world = createWorld({ seed: 8, width: size, height: size, startingUnits: 0 });
  world.grid.tiles.set(createGrid(size, size, Terrain.Grass).tiles);
  world.grid.blocked.fill(0);
  world.deposits.fill(0);
  return world;
}

function unit(world: World, typeId: number, owner: number, tileX: number, tileY: number): Entity {
  return addEntity(world.entities, {
    typeId: typeId as never,
    owner,
    x: fromTiles(tileX),
    y: fromTiles(tileY),
  });
}

describe("what a unit reveals", () => {
  it("sees the ground it is standing on", () => {
    const world = arena();
    unit(world, UnitType.Soldier, 0, 20, 20);
    tickWorld(world);

    expect(isVisible(world, 0, 20, 20)).toBe(true);
    expect(isExplored(world, 0, 20, 20)).toBe(true);
  });

  it("sees as far as the unit table says and no further", () => {
    const world = arena();
    unit(world, UnitType.Soldier, 0, 20, 20);
    tickWorld(world);

    const range = Math.floor(toTiles(unitDef(UnitType.Soldier).sight));
    expect(isVisible(world, 0, 20 + range, 20)).toBe(true);
    expect(isVisible(world, 0, 20 + range + 2, 20)).toBe(false);
  });

  it("gives the scout the widest view, because that is its job", () => {
    // The scout costs as much as a soldier and fights worse. Sight is the
    // entire reason to build one, so the table's number has to reach the map.
    const world = arena();
    unit(world, UnitType.Scout, 0, 10, 10);
    unit(world, UnitType.Soldier, 1, 30, 30);
    tickWorld(world);

    const soldierRange = Math.floor(toTiles(unitDef(UnitType.Soldier).sight));
    expect(isVisible(world, 0, 10 + soldierRange + 2, 10)).toBe(true);
    expect(isVisible(world, 1, 30 + soldierRange + 2, 30)).toBe(false);
  });

  it("keeps each player's view to themselves", () => {
    const world = arena();
    unit(world, UnitType.Soldier, 0, 5, 5);
    tickWorld(world);

    expect(isVisible(world, 0, 5, 5)).toBe(true);
    expect(isVisible(world, 1, 5, 5)).toBe(false);
    expect(isExplored(world, 1, 5, 5)).toBe(false);
  });

  it("lets a building see around itself too", () => {
    const world = arena();
    placeBuildingAt(world, 0, BuildingType.Headquarters, 20, 20, {
      free: true,
      finished: true,
      ignoreRadius: true,
    });
    tickWorld(world);

    expect(isVisible(world, 0, 21, 21)).toBe(true);
    expect(isVisible(world, 0, 26, 21)).toBe(true);
  });
});

describe("memory against sight", () => {
  it("forgets what is happening once the unit walks away, but not the map", () => {
    const world = arena();
    const scout = unit(world, UnitType.Scout, 0, 20, 20);
    tickWorld(world);
    expect(isVisible(world, 0, 20, 20)).toBe(true);

    removeEntity(world.entities, scout.id);
    // Something must stay alive, or the match ends and the tick stops mattering.
    unit(world, UnitType.Soldier, 0, 45, 45);
    tickWorld(world);

    expect(isVisible(world, 0, 20, 20), "the tile is still lit with nobody there").toBe(false);
    expect(isExplored(world, 0, 20, 20), "the player forgot where they had been").toBe(true);
  });
});

describe("what the fog hides", () => {
  it("hides an enemy standing in the dark", () => {
    const world = arena();
    unit(world, UnitType.Soldier, 0, 5, 5);
    const hidden = unit(world, UnitType.Soldier, 1, 40, 40);
    tickWorld(world);

    expect(visibleTo(world, 0, hidden)).toBe(false);
  });

  it("shows an enemy that walked into the light", () => {
    const world = arena();
    unit(world, UnitType.Soldier, 0, 20, 20);
    const spotted = unit(world, UnitType.Soldier, 1, 22, 20);
    tickWorld(world);

    expect(visibleTo(world, 0, spotted)).toBe(true);
  });

  it("never hides a player's own units from themselves", () => {
    const world = arena();
    const mine = unit(world, UnitType.Soldier, 0, 40, 40);
    unit(world, UnitType.Soldier, 0, 5, 5);
    tickWorld(world);

    expect(visibleTo(world, 0, mine)).toBe(true);
  });
});

describe("vision is simulation truth", () => {
  it("comes out identical from the same seed", () => {
    const hashes = [0, 1].map(() => {
      const world = createWorld({ seed: 909, width: 48, height: 48 });
      for (let i = 0; i < 200; i++) tickWorld(world);
      return hashWorld(world);
    });

    expect(hashes[1]).toBe(hashes[0]);
  });

  it("puts what has been explored into the world hash", () => {
    // Explored ground is history, not something recomputable from where the
    // units happen to stand now — so it has to be hashed like any other state.
    const world = createWorld({ seed: 7, width: 32, height: 32, startingUnits: 0 });
    const before = hashWorld(world);
    world.vision[0]!.explored[17] = 1;

    expect(hashWorld(world)).not.toBe(before);
  });
});
