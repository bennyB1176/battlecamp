import { describe, expect, it } from "vitest";

import {
  isBuildable,
  isInside,
  isPassable,
  moveCostAt,
  setTerrain,
  Terrain,
  terrainAt,
  TERRAIN_INFO,
  createGrid,
  type TerrainType,
} from "../src/sim/grid.js";
import { generateMap } from "../src/sim/mapgen.js";
import { createRng } from "../src/sim/rng.js";

describe("tile grid", () => {
  it("treats out-of-bounds as impassable rock so units cannot leave the map", () => {
    const grid = createGrid(8, 8, Terrain.Grass);
    expect(isInside(grid, -1, 0)).toBe(false);
    expect(terrainAt(grid, -1, 0)).toBe(Terrain.Rock);
    expect(isPassable(grid, -1, 0)).toBe(false);
    expect(isPassable(grid, 8, 8)).toBe(false);
  });

  it("reads back what it writes", () => {
    const grid = createGrid(8, 8, Terrain.Grass);
    setTerrain(grid, 3, 5, Terrain.Water);
    expect(terrainAt(grid, 3, 5)).toBe(Terrain.Water);
    expect(isPassable(grid, 3, 5)).toBe(false);
  });

  it("ignores writes outside the map instead of corrupting neighbours", () => {
    const grid = createGrid(4, 4, Terrain.Grass);
    setTerrain(grid, 4, 0, Terrain.Water);
    expect(grid.tiles.every((tile) => tile === Terrain.Grass)).toBe(true);
  });

  it("rejects multi-tile footprints that hang off the map or cross bad terrain", () => {
    const grid = createGrid(8, 8, Terrain.Grass);
    expect(isBuildable(grid, 2, 2, 3)).toBe(true);
    expect(isBuildable(grid, 6, 6, 3)).toBe(false);

    setTerrain(grid, 4, 3, Terrain.Water);
    expect(isBuildable(grid, 3, 2, 3)).toBe(false);
  });

  it("gives every terrain type a movement cost consistent with passability", () => {
    for (const terrain of Object.values(Terrain) as TerrainType[]) {
      const info = TERRAIN_INFO[terrain];
      if (info.passable) {
        expect(info.moveCost).toBeGreaterThan(0);
      }
      // Buildable terrain must also be walkable, or workers could never reach
      // the site to construct anything on it.
      if (info.buildable) {
        expect(info.passable).toBe(true);
      }
    }
  });

  it("reports movement cost from the terrain table", () => {
    const grid = createGrid(4, 4, Terrain.Forest);
    expect(moveCostAt(grid, 1, 1)).toBe(TERRAIN_INFO[Terrain.Forest].moveCost);
  });
});

describe("map generation", () => {
  it("is reproducible for a given seed", () => {
    const a = generateMap(createRng(2024), 64, 64);
    const b = generateMap(createRng(2024), 64, 64);
    expect(Array.from(b.tiles)).toEqual(Array.from(a.tiles));
  });

  it("differs between seeds", () => {
    const a = generateMap(createRng(1), 64, 64);
    const b = generateMap(createRng(2), 64, 64);
    expect(Array.from(b.tiles)).not.toEqual(Array.from(a.tiles));
  });

  it("emits only known terrain types", () => {
    const grid = generateMap(createRng(9), 48, 48);
    const known = new Set<number>(Object.values(Terrain));
    for (const tile of grid.tiles) {
      expect(known.has(tile)).toBe(true);
    }
  });

  it("leaves enough buildable ground to start a base on", () => {
    // A map that is 95% water would technically be valid and completely
    // unplayable. M8 will enforce real fairness guarantees; this is the floor.
    for (const seed of [1, 2, 3, 4, 5]) {
      const grid = generateMap(createRng(seed), 64, 64);
      let buildable = 0;
      for (const tile of grid.tiles) {
        if (TERRAIN_INFO[tile as TerrainType].buildable) buildable++;
      }
      expect(buildable / grid.tiles.length).toBeGreaterThan(0.25);
    }
  });

  it("produces resources to mine", () => {
    const grid = generateMap(createRng(11), 64, 64);
    expect(grid.tiles.includes(Terrain.Ore)).toBe(true);
    expect(grid.tiles.includes(Terrain.Stone)).toBe(true);
  });
});
