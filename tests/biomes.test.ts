/**
 * Biomes.
 *
 * The generator was one fixed set of thresholds, so every map ever produced was
 * the same kind of place with the lakes moved around. A biome is that set of
 * thresholds lifted into a table — which means the interesting question is not
 * "does it generate" but "is each of them actually a different game".
 *
 * So these tests measure the maps rather than the table: a desert has to be
 * short of wood, a tundra short of open ground, the badlands full of walls.
 * A biome that reads differently but plays identically is decoration.
 */

import { describe, expect, it } from "vitest";

import { BIOMES, BIOME_LIST, biomeDef, Biome, type BiomeId } from "../src/content/biomes.js";
import { generateMap } from "../src/sim/mapgen.js";
import { Terrain, terrainAt, TERRAIN_INFO, type TerrainType } from "../src/sim/grid.js";
import { createRng } from "../src/sim/rng.js";

const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];
const SIZE = 64;

/** Share of the map covered by each terrain, averaged over the seeds. */
function shares(biome: BiomeId): Map<TerrainType, number> {
  const totals = new Map<TerrainType, number>();

  for (const seed of SEEDS) {
    const grid = generateMap(createRng(seed), SIZE, SIZE, biomeDef(biome));
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const terrain = terrainAt(grid, x, y);
        totals.set(terrain, (totals.get(terrain) ?? 0) + 1);
      }
    }
  }

  const area = SIZE * SIZE * SEEDS.length;
  const result = new Map<TerrainType, number>();
  for (const [terrain, count] of totals) result.set(terrain, count / area);
  return result;
}

function share(map: Map<TerrainType, number>, terrain: TerrainType): number {
  return map.get(terrain) ?? 0;
}

/** How much of the map a unit can stand on. */
function walkable(map: Map<TerrainType, number>): number {
  let total = 0;
  for (const [terrain, value] of map) {
    if (TERRAIN_INFO[terrain].passable) total += value;
  }
  return total;
}

describe("the biome table", () => {
  it("lists every biome the game has, with no hand-maintained second list", () => {
    expect(BIOME_LIST).toHaveLength(Object.keys(BIOMES).length);
  });

  it("gives each one a name and a line saying what it costs you", () => {
    for (const biome of BIOME_LIST) {
      expect(biomeDef(biome).name).toBeTruthy();
      expect(biomeDef(biome).blurb).toBeTruthy();
    }
  });

  it("names them all differently", () => {
    const names = BIOME_LIST.map((biome) => biomeDef(biome).name);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("every biome is playable at all", () => {
  it.each(BIOME_LIST)("leaves enough walkable ground on biome %i", (biome) => {
    // Below about half the map, a generated world starts producing pockets that
    // strand a base — and the fun of a hostile map ends where the match does.
    expect(walkable(shares(biome))).toBeGreaterThan(0.5);
  });

  it.each(BIOME_LIST)("puts all three raw resources on biome %i", (biome) => {
    const map = shares(biome);
    expect(share(map, Terrain.Forest), "no wood at all").toBeGreaterThan(0);
    expect(share(map, Terrain.Stone), "no stone at all").toBeGreaterThan(0);
    expect(share(map, Terrain.Ore), "no ore at all").toBeGreaterThan(0);
  });
});

describe("each biome is a different game", () => {
  it("makes the desert short of wood and rich in ore", () => {
    const desert = shares(Biome.Desert);
    const grass = shares(Biome.Grassland);

    expect(share(desert, Terrain.Forest)).toBeLessThan(share(grass, Terrain.Forest) / 2);
    expect(share(desert, Terrain.Ore)).toBeGreaterThan(share(grass, Terrain.Ore));
    expect(share(desert, Terrain.Sand)).toBeGreaterThan(share(grass, Terrain.Sand));
  });

  it("makes the tundra cold ground and plenty of stone", () => {
    const tundra = shares(Biome.Tundra);
    const grass = shares(Biome.Grassland);

    expect(share(tundra, Terrain.Snow)).toBeGreaterThan(0.2);
    expect(share(tundra, Terrain.Forest)).toBeLessThan(share(grass, Terrain.Forest));
    expect(share(tundra, Terrain.Stone)).toBeGreaterThan(share(grass, Terrain.Stone));
  });

  it("makes the badlands cramped, with lava for walls", () => {
    const badlands = shares(Biome.Badlands);
    const grass = shares(Biome.Grassland);

    expect(share(badlands, Terrain.Lava)).toBeGreaterThan(0.03);
    expect(walkable(badlands)).toBeLessThan(walkable(grass));
  });

  it("keeps grassland the balanced one", () => {
    // The yardstick every other biome is described against, so it must not
    // itself be extreme in any direction.
    const grass = shares(Biome.Grassland);
    expect(walkable(grass)).toBeGreaterThan(0.65);
    expect(share(grass, Terrain.Forest)).toBeGreaterThan(0.1);
  });

  it("gives no two biomes the same terrain mix", () => {
    const seen = BIOME_LIST.map((biome) => {
      const map = shares(biome);
      return [...map.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([terrain, value]) => `${terrain}:${value.toFixed(2)}`)
        .join(",");
    });

    expect(new Set(seen).size, "two biomes generate the same kind of map").toBe(seen.length);
  });
});

describe("generation stays deterministic", () => {
  it("produces the same map from the same seed and biome", () => {
    for (const biome of BIOME_LIST) {
      const a = generateMap(createRng(99), SIZE, SIZE, biomeDef(biome));
      const b = generateMap(createRng(99), SIZE, SIZE, biomeDef(biome));
      expect(Array.from(a.tiles)).toEqual(Array.from(b.tiles));
    }
  });

  it("produces different maps for different biomes from one seed", () => {
    const grass = generateMap(createRng(99), SIZE, SIZE, biomeDef(Biome.Grassland));
    const desert = generateMap(createRng(99), SIZE, SIZE, biomeDef(Biome.Desert));
    expect(Array.from(grass.tiles)).not.toEqual(Array.from(desert.tiles));
  });
});
