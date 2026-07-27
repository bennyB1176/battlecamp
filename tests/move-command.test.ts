/**
 * The move command.
 *
 * Commands are the only way anything enters the simulation, which makes this
 * the trust boundary. The ownership check in particular is not a nicety: once
 * commands travel over a network, "move that unit" arriving from the wrong
 * player must be rejected by the simulation itself, not by the UI that chose
 * not to offer the button.
 */

import { describe, expect, it } from "vitest";

import { UnitType } from "../src/content/units.js";
import { applyCommand } from "../src/sim/commands.js";
import { addEntity } from "../src/sim/entities.js";
import { fromTiles, ONE } from "../src/sim/fixed.js";
import { isPassable, setTerrain, Terrain } from "../src/sim/grid.js";
import { placeBuildingAt } from "../src/sim/construction.js";
import { BuildingType } from "../src/content/buildings.js";
import { createWorld, tickWorld, type World } from "../src/sim/world.js";

function emptyWorld(): World {
  const world = createWorld({ seed: 5, width: 32, height: 32, startingUnits: 0 });
  return world;
}

function spawn(world: World, tileX: number, tileY: number, owner = 0) {
  return addEntity(world.entities, {
    typeId: UnitType.Soldier,
    owner,
    x: fromTiles(tileX),
    y: fromTiles(tileY),
  });
}

describe("move command", () => {
  it("sets a goal at or beside the point that was tapped", () => {
    const world = emptyWorld();
    const unit = spawn(world, 5, 5);

    applyCommand(world, {
      type: "move",
      playerId: 0,
      entityIds: [unit.id],
      targetX: fromTiles(10),
      targetY: fromTiles(12),
    });

    // The order lands on walkable ground: tapping a tree or a wall means "get
    // as close to there as you can", not "stand still because that is
    // impossible". The goal may therefore be nudged to a neighbouring tile.
    expect(unit.goalX).not.toBeNull();
    const tileX = Math.floor(unit.goalX! / ONE);
    const tileY = Math.floor(unit.goalY! / ONE);
    expect(isPassable(world.grid, tileX, tileY)).toBe(true);
    expect(Math.abs(tileX - 10)).toBeLessThanOrEqual(2);
    expect(Math.abs(tileY - 12)).toBeLessThanOrEqual(2);
  });

  it("keeps the exact point when it is already walkable", () => {
    const world = emptyWorld();
    setTerrain(world.grid, 10, 12, Terrain.Grass);
    const unit = spawn(world, 5, 5);

    applyCommand(world, {
      type: "move",
      playerId: 0,
      entityIds: [unit.id],
      targetX: fromTiles(10),
      targetY: fromTiles(12),
    });

    expect(unit.goalX).toBe(fromTiles(10));
    expect(unit.goalY).toBe(fromTiles(12));
  });

  it("finds walkable ground when the tap lands on a building", () => {
    // Tapping an enemy headquarters is the most natural way to say "go there".
    // A flow field to blocked ground is unreachable everywhere, so without the
    // nudge the order would silently do nothing at all.
    const world = emptyWorld();
    const unit = spawn(world, 5, 5);
    placeBuildingAt(world, 1, BuildingType.Depot, 10, 12, {
      free: true,
      finished: true,
      ignoreRadius: true,
    });

    applyCommand(world, {
      type: "move",
      playerId: 0,
      entityIds: [unit.id],
      targetX: fromTiles(10.5),
      targetY: fromTiles(12.5),
    });

    const tileX = Math.floor(unit.goalX! / ONE);
    const tileY = Math.floor(unit.goalY! / ONE);
    expect(isPassable(world.grid, tileX, tileY)).toBe(true);
  });

  it("orders several units at once", () => {
    const world = emptyWorld();
    const units = [spawn(world, 5, 5), spawn(world, 6, 5), spawn(world, 7, 5)];

    applyCommand(world, {
      type: "move",
      playerId: 0,
      entityIds: units.map((unit) => unit.id),
      targetX: fromTiles(10),
      targetY: fromTiles(10),
    });

    expect(units.every((unit) => unit.goalX === fromTiles(10))).toBe(true);
  });

  it("refuses to move another player's units", () => {
    const world = emptyWorld();
    const enemy = spawn(world, 5, 5, 1);

    applyCommand(world, {
      type: "move",
      playerId: 0,
      entityIds: [enemy.id],
      targetX: fromTiles(10),
      targetY: fromTiles(10),
    });

    expect(enemy.goalX).toBeNull();
  });

  it("ignores ids that no longer exist", () => {
    const world = emptyWorld();
    const unit = spawn(world, 5, 5);

    expect(() =>
      applyCommand(world, {
        type: "move",
        playerId: 0,
        entityIds: [unit.id, 4242],
        targetX: fromTiles(10),
        targetY: fromTiles(10),
      }),
    ).not.toThrow();

    expect(unit.goalX).toBe(fromTiles(10));
  });

  it("clamps a target outside the map back inside it", () => {
    const world = emptyWorld();
    const unit = spawn(world, 5, 5);

    applyCommand(world, {
      type: "move",
      playerId: 0,
      entityIds: [unit.id],
      targetX: fromTiles(-40),
      targetY: fromTiles(9999),
    });

    expect(unit.goalX).toBeGreaterThanOrEqual(0);
    expect(unit.goalY).toBeLessThan(world.grid.height * ONE);
  });

  it("un-sticks a unit that had settled", () => {
    const world = emptyWorld();
    const unit = spawn(world, 5, 5);
    unit.blockedTicks = 30;

    applyCommand(world, {
      type: "move",
      playerId: 0,
      entityIds: [unit.id],
      targetX: fromTiles(10),
      targetY: fromTiles(10),
    });

    // A fresh order deserves a fresh chance to make progress; carrying the old
    // counter over would make the unit give up almost immediately.
    expect(unit.blockedTicks).toBe(0);
  });
});

describe("world with units", () => {
  it("moves ordered units as the world ticks", () => {
    const world = emptyWorld();
    const unit = spawn(world, 5, 5);

    tickWorld(world, [
      { type: "move", playerId: 0, entityIds: [unit.id], targetX: fromTiles(15), targetY: fromTiles(5) },
    ]);
    for (let i = 0; i < 40; i++) tickWorld(world);

    expect(unit.x).toBeGreaterThan(fromTiles(6));
  });

  it("spawns a starting group by default", () => {
    const world = createWorld({ seed: 7, width: 48, height: 48 });
    expect(world.entities.list.length).toBeGreaterThan(0);
    expect(world.entities.list.every((entity) => entity.owner === 0)).toBe(true);
  });

  it("places starting units on passable ground", () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const world = createWorld({ seed, width: 48, height: 48 });
      for (const unit of world.entities.list) {
        const tileX = Math.floor(unit.x / ONE);
        const tileY = Math.floor(unit.y / ONE);
        expect(world.grid.tiles[tileY * world.grid.width + tileX]).not.toBe(2 /* water */);
      }
    }
  });
});
