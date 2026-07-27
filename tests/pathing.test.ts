/**
 * Flow-field pathfinding.
 *
 * Running A* per unit is the classic reason mobile RTS games stutter: a hundred
 * units ordered to one point means a hundred nearly identical searches. A flow
 * field inverts that — one Dijkstra sweep from the *goal* produces a direction
 * for every tile on the map, and any number of units can follow it for free.
 *
 * The test that matters most is the last kind: from every reachable tile,
 * following the arrows must actually arrive at the goal. A field can look
 * plausible and still contain a two-tile cycle that traps units forever.
 */

import { describe, expect, it } from "vitest";

import { createGrid, isPassable, setTerrain, Terrain, type TileGrid } from "../src/sim/grid.js";
import { generateMap } from "../src/sim/mapgen.js";
import {
  computeFlowField,
  flowDirectionAt,
  getFlowField,
  createFlowFieldCache,
  invalidateFlowFields,
  isReachable,
  UNREACHABLE,
  costAt,
} from "../src/sim/pathing.js";
import { createRng } from "../src/sim/rng.js";

/** Build a grid from ASCII art: '.' grass, '#' rock, 'f' forest, 'w' water. */
function gridFromRows(rows: readonly string[]): TileGrid {
  const grid = createGrid(rows[0]!.length, rows.length, Terrain.Grass);
  rows.forEach((row, y) => {
    [...row].forEach((char, x) => {
      const terrain =
        char === "#" ? Terrain.Rock : char === "f" ? Terrain.Forest : char === "w" ? Terrain.Water : Terrain.Grass;
      setTerrain(grid, x, y, terrain);
    });
  });
  return grid;
}

/**
 * Follow the arrows from a starting tile and report where we end up.
 * Returns null if we loop, stall, or run out of patience.
 */
function walkToGoal(
  field: ReturnType<typeof computeFlowField>,
  startX: number,
  startY: number,
  maxSteps = 4096,
): { x: number; y: number } | null {
  let x = startX;
  let y = startY;

  for (let step = 0; step < maxSteps; step++) {
    if (x === field.goalX && y === field.goalY) return { x, y };

    const direction = flowDirectionAt(field, x, y);
    if (!direction) return null;

    x += direction.dx;
    y += direction.dy;
  }

  return null;
}

describe("flow field", () => {
  it("costs nothing to stand on the goal", () => {
    const grid = createGrid(8, 8);
    const field = computeFlowField(grid, 3, 3);
    expect(costAt(field, 3, 3)).toBe(0);
  });

  it("has no direction at the goal itself", () => {
    const grid = createGrid(8, 8);
    const field = computeFlowField(grid, 3, 3);
    expect(flowDirectionAt(field, 3, 3)).toBeNull();
  });

  it("points a neighbouring tile at the goal", () => {
    const grid = createGrid(8, 8);
    const field = computeFlowField(grid, 3, 3);
    expect(flowDirectionAt(field, 4, 3)).toEqual({ dx: -1, dy: 0 });
  });

  it("grows more expensive with distance", () => {
    const grid = createGrid(16, 16);
    const field = computeFlowField(grid, 0, 0);
    expect(costAt(field, 5, 0)).toBeGreaterThan(costAt(field, 2, 0));
  });

  it("charges more for diagonal steps than orthogonal ones", () => {
    const grid = createGrid(16, 16);
    const field = computeFlowField(grid, 0, 0);
    // Same tile count, longer real distance — otherwise units prefer staircases.
    expect(costAt(field, 1, 1)).toBeGreaterThan(costAt(field, 1, 0));
  });

  it("marks impassable tiles unreachable", () => {
    const grid = gridFromRows(["....", ".#..", "....", "...."]);
    const field = computeFlowField(grid, 0, 0);
    expect(isReachable(field, 1, 1)).toBe(false);
    expect(costAt(field, 1, 1)).toBe(UNREACHABLE);
  });

  it("marks a walled-off region unreachable", () => {
    const grid = gridFromRows([
      ".....#...",
      ".....#...",
      ".....#...",
      ".....#...",
      ".....#...",
    ]);
    const field = computeFlowField(grid, 0, 0);

    expect(isReachable(field, 4, 2)).toBe(true);
    expect(isReachable(field, 6, 2)).toBe(false);
    expect(flowDirectionAt(field, 6, 2)).toBeNull();
  });

  it("refuses to squeeze diagonally between two blocked corners", () => {
    // Goal at (0,0); the only diagonal link is pinched shut by two rocks. A
    // field that allows the squeeze walks units straight through solid rock.
    const grid = gridFromRows([".#", "#."]);
    const field = computeFlowField(grid, 0, 0);
    expect(isReachable(field, 1, 1)).toBe(false);
  });

  it("prefers a longer cheap route over a short expensive one", () => {
    // Goal at (0,0). Reaching (8,0) means either ploughing along a row of
    // forest, or dropping onto open grass and coming back up.
    const grid = gridFromRows([".ffffffff", "........."]);
    const field = computeFlowField(grid, 0, 0);

    const straightThroughForest = 8 * 160; // eight forest tiles at cost 160
    expect(costAt(field, 8, 0)).toBeLessThan(straightThroughForest);

    // And it genuinely routes around rather than sliding along the forest row.
    expect(flowDirectionAt(field, 8, 0)?.dy).toBe(1);
  });

  it("treats water as impassable", () => {
    const grid = gridFromRows(["...", ".w.", "..."]);
    const field = computeFlowField(grid, 0, 0);
    expect(isReachable(field, 1, 1)).toBe(false);
  });

  it("is unreachable everywhere when the goal itself is blocked", () => {
    const grid = gridFromRows(["...", ".#.", "..."]);
    const field = computeFlowField(grid, 1, 1);
    expect(isReachable(field, 0, 0)).toBe(false);
  });

  it("is deterministic for the same grid and goal", () => {
    const grid = generateMap(createRng(31337), 40, 40);
    const a = computeFlowField(grid, 20, 20);
    const b = computeFlowField(grid, 20, 20);

    expect(Array.from(b.cost)).toEqual(Array.from(a.cost));
    expect(Array.from(b.dir)).toEqual(Array.from(a.dir));
  });

  it("leads every reachable tile to the goal, on real generated maps", () => {
    // The property that actually matters. A cycle anywhere in the field means
    // units orbiting forever instead of arriving.
    for (const seed of [1, 7, 99, 2024, 31337]) {
      const grid = generateMap(createRng(seed), 48, 48);

      // Pick a goal that is actually walkable.
      let goalX = 24;
      let goalY = 24;
      if (!isPassable(grid, goalX, goalY)) {
        outer: for (let y = 0; y < grid.height; y++) {
          for (let x = 0; x < grid.width; x++) {
            if (isPassable(grid, x, y)) {
              goalX = x;
              goalY = y;
              break outer;
            }
          }
        }
      }

      const field = computeFlowField(grid, goalX, goalY);

      for (let y = 0; y < grid.height; y++) {
        for (let x = 0; x < grid.width; x++) {
          if (!isReachable(field, x, y)) continue;
          expect(walkToGoal(field, x, y), `seed ${seed}, tile ${x},${y}`).toEqual({ x: goalX, y: goalY });
        }
      }
    }
  });

  it("reports no direction outside the map", () => {
    const grid = createGrid(8, 8);
    const field = computeFlowField(grid, 3, 3);
    expect(flowDirectionAt(field, -1, 3)).toBeNull();
    expect(flowDirectionAt(field, 8, 3)).toBeNull();
  });
});

describe("flow field cache", () => {
  it("reuses the field for a repeated goal", () => {
    const grid = createGrid(16, 16);
    const cache = createFlowFieldCache(4);

    // The whole point: a hundred units ordered to one tile pay for one sweep.
    expect(getFlowField(cache, grid, 5, 5)).toBe(getFlowField(cache, grid, 5, 5));
  });

  it("computes a separate field per goal", () => {
    const grid = createGrid(16, 16);
    const cache = createFlowFieldCache(4);
    expect(getFlowField(cache, grid, 5, 5)).not.toBe(getFlowField(cache, grid, 6, 6));
  });

  it("evicts the least recently used field when full", () => {
    const grid = createGrid(16, 16);
    const cache = createFlowFieldCache(2);

    const first = getFlowField(cache, grid, 1, 1);
    getFlowField(cache, grid, 2, 2);
    getFlowField(cache, grid, 1, 1); // refresh: 2,2 is now the oldest
    getFlowField(cache, grid, 3, 3); // evicts 2,2

    expect(getFlowField(cache, grid, 1, 1)).toBe(first);
    expect(cache.fields.size).toBeLessThanOrEqual(2);
  });

  it("recomputes after the terrain changes", () => {
    const grid = createGrid(16, 16);
    const cache = createFlowFieldCache(4);
    const before = getFlowField(cache, grid, 5, 5);

    setTerrain(grid, 4, 5, Terrain.Rock);
    invalidateFlowFields(cache);

    const after = getFlowField(cache, grid, 5, 5);
    expect(after).not.toBe(before);
    expect(isReachable(after, 4, 5)).toBe(false);
  });
});
