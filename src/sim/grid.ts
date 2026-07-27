/**
 * The tile map: terrain types plus the queries the rest of the sim asks about
 * them (can I walk here? can I build here? how slow is it?).
 *
 * Terrain is stored as one byte per tile in a flat `Uint8Array`, so a 128x128
 * map is 16 KB and snapshots stay cheap.
 */

export const Terrain = {
  Grass: 0,
  Sand: 1,
  Water: 2,
  Rock: 3,
  Forest: 4,
  Ore: 5,
  Stone: 6,
} as const;

export type TerrainType = (typeof Terrain)[keyof typeof Terrain];

export interface TerrainInfo {
  readonly name: string;
  /** Can ground units walk across it? */
  readonly passable: boolean;
  /** Can a building be placed on it? */
  readonly buildable: boolean;
  /**
   * Movement cost, where 100 is normal speed. Higher is slower.
   * Pathfinding (M1) uses this; impassable tiles are excluded outright.
   */
  readonly moveCost: number;
  /** Base colour used by the placeholder renderer until we have sprites. */
  readonly color: string;
}

export const TERRAIN_INFO: Readonly<Record<TerrainType, TerrainInfo>> = {
  [Terrain.Grass]: { name: "Grasland", passable: true, buildable: true, moveCost: 100, color: "#4a6b3a" },
  [Terrain.Sand]: { name: "Sand", passable: true, buildable: true, moveCost: 120, color: "#b3a06a" },
  [Terrain.Water]: { name: "Wasser", passable: false, buildable: false, moveCost: 0, color: "#2a4d6e" },
  [Terrain.Rock]: { name: "Fels", passable: false, buildable: false, moveCost: 0, color: "#5a5750" },
  [Terrain.Forest]: { name: "Wald", passable: true, buildable: false, moveCost: 160, color: "#2f4a26" },
  [Terrain.Ore]: { name: "Erzader", passable: true, buildable: false, moveCost: 130, color: "#8a6a3f" },
  [Terrain.Stone]: { name: "Steinbruch", passable: true, buildable: false, moveCost: 130, color: "#7d7a72" },
};

export interface TileGrid {
  readonly width: number;
  readonly height: number;
  /** Row-major terrain bytes, length = width * height. */
  readonly tiles: Uint8Array;
}

export function createGrid(width: number, height: number, fill: TerrainType = Terrain.Grass): TileGrid {
  const tiles = new Uint8Array(width * height);
  if (fill !== 0) tiles.fill(fill);
  return { width, height, tiles };
}

export function isInside(grid: TileGrid, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < grid.width && y < grid.height;
}

/** Terrain at a tile. Out-of-bounds reads as Rock so units never walk off the map. */
export function terrainAt(grid: TileGrid, x: number, y: number): TerrainType {
  if (!isInside(grid, x, y)) return Terrain.Rock;
  return grid.tiles[y * grid.width + x] as TerrainType;
}

export function setTerrain(grid: TileGrid, x: number, y: number, terrain: TerrainType): void {
  if (!isInside(grid, x, y)) return;
  grid.tiles[y * grid.width + x] = terrain;
}

export function isPassable(grid: TileGrid, x: number, y: number): boolean {
  return TERRAIN_INFO[terrainAt(grid, x, y)].passable;
}

export function moveCostAt(grid: TileGrid, x: number, y: number): number {
  return TERRAIN_INFO[terrainAt(grid, x, y)].moveCost;
}

/**
 * Can a building of the given footprint be placed with its top-left corner here?
 *
 * Terrain-only check. The build-radius rule ("must touch your own base") and
 * the "no overlapping buildings" rule arrive in M2, where entities exist.
 */
export function isBuildable(grid: TileGrid, x: number, y: number, footprint = 1): boolean {
  for (let dy = 0; dy < footprint; dy++) {
    for (let dx = 0; dx < footprint; dx++) {
      const tx = x + dx;
      const ty = y + dy;
      if (!isInside(grid, tx, ty)) return false;
      if (!TERRAIN_INFO[terrainAt(grid, tx, ty)].buildable) return false;
    }
  }
  return true;
}
