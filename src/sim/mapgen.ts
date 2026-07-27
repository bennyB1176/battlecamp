/**
 * Placeholder map generator.
 *
 * M0 only needs *something* worth panning across, so this is deliberately
 * simple: two octaves of integer value noise for elevation and moisture, a few
 * thresholds, then scattered resource clusters. The real generator — biomes,
 * rotationally symmetric start positions, guaranteed-fair resource budgets —
 * lands in M8 and will replace this file wholesale.
 *
 * All arithmetic is integer so the same seed yields the same map everywhere.
 */

import { createGrid, setTerrain, Terrain, terrainAt, type TerrainType, type TileGrid } from "./grid.js";
import { nextInt, nextRange, type Rng } from "./rng.js";

/** Noise values live on 0..NOISE_ONE, mirroring a 0..1 float range. */
const NOISE_ONE = 1024;

interface Lattice {
  readonly width: number;
  readonly height: number;
  readonly values: Int32Array;
  readonly cellSize: number;
}

function makeLattice(rng: Rng, mapWidth: number, mapHeight: number, cellSize: number): Lattice {
  // +2 so bilinear sampling at the far edge always has a right/bottom neighbour.
  const width = Math.ceil(mapWidth / cellSize) + 2;
  const height = Math.ceil(mapHeight / cellSize) + 2;
  const values = new Int32Array(width * height);
  for (let i = 0; i < values.length; i++) {
    values[i] = nextInt(rng, NOISE_ONE + 1);
  }
  return { width, height, values, cellSize };
}

/** Hermite smoothstep on 0..NOISE_ONE, keeping everything in integers. */
function smoothstep(t: number): number {
  const t2 = (t * t) >> 10;
  return (t2 * (3 * NOISE_ONE - 2 * t)) >> 20;
}

function latticeAt(lattice: Lattice, gx: number, gy: number): number {
  const x = Math.min(gx, lattice.width - 1);
  const y = Math.min(gy, lattice.height - 1);
  return lattice.values[y * lattice.width + x] ?? 0;
}

/** Bilinearly interpolated noise at a tile coordinate. Returns 0..NOISE_ONE. */
function sampleLattice(lattice: Lattice, x: number, y: number): number {
  const cell = lattice.cellSize;
  const gx = Math.floor(x / cell);
  const gy = Math.floor(y / cell);
  const tx = smoothstep(Math.floor(((x - gx * cell) * NOISE_ONE) / cell));
  const ty = smoothstep(Math.floor(((y - gy * cell) * NOISE_ONE) / cell));

  const v00 = latticeAt(lattice, gx, gy);
  const v10 = latticeAt(lattice, gx + 1, gy);
  const v01 = latticeAt(lattice, gx, gy + 1);
  const v11 = latticeAt(lattice, gx + 1, gy + 1);

  const top = v00 + (((v10 - v00) * tx) >> 10);
  const bottom = v01 + (((v11 - v01) * tx) >> 10);
  return top + (((bottom - top) * ty) >> 10);
}

/** Two octaves: broad shapes from the coarse lattice, detail from the fine one. */
function sampleFbm(coarse: Lattice, fine: Lattice, x: number, y: number): number {
  return (sampleLattice(coarse, x, y) * 2 + sampleLattice(fine, x, y)) / 3;
}

/** Scatter roughly `count` blobs of `terrain` onto tiles that are currently grass or sand. */
function scatterClusters(
  grid: TileGrid,
  rng: Rng,
  terrain: TerrainType,
  count: number,
  minRadius: number,
  maxRadius: number,
): void {
  for (let i = 0; i < count; i++) {
    const cx = nextInt(rng, grid.width);
    const cy = nextInt(rng, grid.height);
    const radius = nextRange(rng, minRadius, maxRadius);
    const radiusSq = radius * radius;

    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (dx * dx + dy * dy > radiusSq) continue;
        const tx = cx + dx;
        const ty = cy + dy;
        const existing = terrainAt(grid, tx, ty);
        if (existing !== Terrain.Grass && existing !== Terrain.Sand) continue;
        // Ragged edges: the further from the centre, the likelier we skip.
        if (nextInt(rng, radiusSq + 1) < dx * dx + dy * dy) continue;
        setTerrain(grid, tx, ty, terrain);
      }
    }
  }
}

export function generateMap(rng: Rng, width: number, height: number): TileGrid {
  const grid = createGrid(width, height, Terrain.Grass);

  const elevationCoarse = makeLattice(rng, width, height, 16);
  const elevationFine = makeLattice(rng, width, height, 6);
  const moistureCoarse = makeLattice(rng, width, height, 12);
  const moistureFine = makeLattice(rng, width, height, 5);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const elevation = sampleFbm(elevationCoarse, elevationFine, x, y);

      let terrain: TerrainType;
      if (elevation < 320) {
        terrain = Terrain.Water;
      } else if (elevation < 380) {
        terrain = Terrain.Sand;
      } else if (elevation > 800) {
        terrain = Terrain.Rock;
      } else {
        const moisture = sampleFbm(moistureCoarse, moistureFine, x, y);
        terrain = moisture > 620 ? Terrain.Forest : Terrain.Grass;
      }

      setTerrain(grid, x, y, terrain);
    }
  }

  const area = width * height;
  scatterClusters(grid, rng, Terrain.Ore, Math.max(4, Math.round(area / 900)), 2, 4);
  scatterClusters(grid, rng, Terrain.Stone, Math.max(3, Math.round(area / 1400)), 2, 3);

  return grid;
}
