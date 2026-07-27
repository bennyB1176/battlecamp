/**
 * Unit movement: steering along a flow field, separation between bodies, and
 * the arrival rules that stop a crowd from grinding against itself forever.
 *
 * The hard part of RTS movement is not getting a unit to the goal — it is
 * getting the *twentieth* unit to accept that the goal is full and stop
 * shoving. Most of these tests are about that.
 */

import { describe, expect, it } from "vitest";

import { UnitType, type UnitTypeId } from "../src/content/units.js";
import { addEntity, createEntityStore, type Entity, type EntityStore } from "../src/sim/entities.js";
import { dist, fromTiles, ONE, toTiles } from "../src/sim/fixed.js";
import { createGrid, setTerrain, Terrain, type TileGrid } from "../src/sim/grid.js";
import { createFlowFieldCache, type FlowFieldCache } from "../src/sim/pathing.js";
import { createSpatialHash, type SpatialHash } from "../src/sim/spatial.js";
import { ARRIVAL_TOLERANCE, updateMovement } from "../src/sim/movement.js";

interface Harness {
  grid: TileGrid;
  store: EntityStore;
  fields: FlowFieldCache;
  spatial: SpatialHash;
  step: (ticks?: number) => void;
}

function harness(grid: TileGrid = createGrid(32, 32)): Harness {
  const store = createEntityStore();
  const fields = createFlowFieldCache(8);
  const spatial = createSpatialHash(2 * ONE);

  return {
    grid,
    store,
    fields,
    spatial,
    step(ticks = 1) {
      for (let i = 0; i < ticks; i++) {
        updateMovement(grid, store.list, fields, spatial);
      }
    },
  };
}

function spawn(h: Harness, tileX: number, tileY: number, typeId: UnitTypeId = UnitType.Soldier): Entity {
  return addEntity(h.store, {
    typeId,
    owner: 0,
    x: fromTiles(tileX),
    y: fromTiles(tileY),
  });
}

function order(entity: Entity, tileX: number, tileY: number): void {
  entity.goalX = fromTiles(tileX);
  entity.goalY = fromTiles(tileY);
}

function distanceToTiles(entity: Entity, tileX: number, tileY: number): number {
  return toTiles(dist(entity.x, entity.y, fromTiles(tileX), fromTiles(tileY)));
}

describe("movement", () => {
  it("leaves an idle unit exactly where it stands", () => {
    const h = harness();
    const unit = spawn(h, 5, 5);
    h.step(10);

    expect(unit.x).toBe(fromTiles(5));
    expect(unit.y).toBe(fromTiles(5));
  });

  it("moves a unit toward its goal", () => {
    const h = harness();
    const unit = spawn(h, 5, 5);
    order(unit, 15, 5);

    const before = distanceToTiles(unit, 15, 5);
    h.step(5);
    expect(distanceToTiles(unit, 15, 5)).toBeLessThan(before);
  });

  it("records the previous position so the renderer can interpolate", () => {
    const h = harness();
    const unit = spawn(h, 5, 5);
    order(unit, 15, 5);
    h.step();

    expect(unit.prevX).toBe(fromTiles(5));
    expect(unit.x).toBeGreaterThan(unit.prevX);
  });

  it("never moves further in one tick than its speed allows", () => {
    const h = harness();
    const unit = spawn(h, 5, 5, UnitType.Scout);
    order(unit, 25, 25);

    for (let i = 0; i < 30; i++) {
      const fromX = unit.x;
      const fromY = unit.y;
      h.step();
      // One pixel of slack for fixed-point rounding.
      expect(dist(fromX, fromY, unit.x, unit.y)).toBeLessThanOrEqual(fromTiles(0.45) + 1);
    }
  });

  it("arrives and goes idle instead of orbiting the goal", () => {
    const h = harness();
    const unit = spawn(h, 5, 5);
    order(unit, 12, 5);
    h.step(120);

    expect(unit.goalX).toBeNull();
    expect(distanceToTiles(unit, 12, 5)).toBeLessThanOrEqual(toTiles(ARRIVAL_TOLERANCE));
  });

  it("walks around an obstacle rather than into it", () => {
    const grid = createGrid(32, 32);
    for (let y = 0; y < 20; y++) setTerrain(grid, 10, y, Terrain.Rock);

    const h = harness(grid);
    const unit = spawn(h, 5, 5);
    order(unit, 15, 5);
    h.step(400);

    expect(distanceToTiles(unit, 15, 5)).toBeLessThan(1.5);
  });

  it("never ends a tick standing inside impassable terrain", () => {
    const grid = createGrid(32, 32);
    for (let y = 0; y < 20; y++) setTerrain(grid, 10, y, Terrain.Rock);

    const h = harness(grid);
    const unit = spawn(h, 5, 5);
    order(unit, 15, 5);

    for (let i = 0; i < 400; i++) {
      h.step();
      const tileX = Math.floor(toTiles(unit.x));
      const tileY = Math.floor(toTiles(unit.y));
      expect(grid.tiles[tileY * grid.width + tileX]).not.toBe(Terrain.Rock);
    }
  });

  it("gives up on an unreachable goal instead of jittering forever", () => {
    // A unit sealed inside a rock box, ordered somewhere it can never reach.
    const grid = createGrid(32, 32);
    for (const [x, y] of [
      [4, 4], [5, 4], [6, 4],
      [4, 5], [6, 5],
      [4, 6], [5, 6], [6, 6],
    ] as const) {
      setTerrain(grid, x, y, Terrain.Rock);
    }

    const h = harness(grid);
    const unit = spawn(h, 5, 5);
    order(unit, 25, 25);
    h.step(60);

    expect(unit.goalX).toBeNull();
  });

  it("pushes two overlapping units apart", () => {
    const h = harness();
    // Spawned on the same spot — a building can produce two units before either
    // has moved, so this state is reachable in normal play.
    const a = spawn(h, 5, 5);
    const b = spawn(h, 5, 5);
    h.step(20);

    expect(dist(a.x, a.y, b.x, b.y)).toBeGreaterThan(0);
  });

  it("does not let separation shove a unit into a wall", () => {
    const grid = createGrid(32, 32);
    for (let y = 0; y < 32; y++) setTerrain(grid, 6, y, Terrain.Rock);

    const h = harness(grid);
    const pinned = spawn(h, 5.6, 5);
    // A crowd pressing the pinned unit toward the rock wall at x = 6.
    for (let i = 0; i < 6; i++) spawn(h, 4.6, 5 + i * 0.1);

    h.step(40);

    expect(Math.floor(toTiles(pinned.x))).toBeLessThan(6);
  });

  it("settles a crowd ordered onto a single tile", () => {
    // Twenty units cannot stand on one tile. They must arrange themselves
    // around it and stop, not shove each other indefinitely.
    const h = harness();
    const units = Array.from({ length: 20 }, (_, i) => spawn(h, 3 + (i % 5) * 0.6, 3 + Math.floor(i / 5) * 0.6));
    for (const unit of units) order(unit, 20, 20);

    h.step(600);

    expect(units.every((unit) => unit.goalX === null)).toBe(true);
    for (const unit of units) {
      expect(distanceToTiles(unit, 20, 20)).toBeLessThan(4);
    }
  });

  it("is deterministic", () => {
    const run = (): number[] => {
      const h = harness();
      const units = Array.from({ length: 12 }, (_, i) => spawn(h, 3 + (i % 4), 3 + Math.floor(i / 4)));
      for (const unit of units) order(unit, 18, 14);
      h.step(200);
      return units.flatMap((unit) => [unit.x, unit.y]);
    };

    expect(run()).toEqual(run());
  });
});
