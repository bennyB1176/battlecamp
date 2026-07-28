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
  /** Frozen ground. Walkable and buildable, but slow going. */
  Snow: 7,
  /** Molten rock. A wall you can see across — the badlands' answer to water. */
  Lava: 8,
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
  // Snow is grass with a tax: everything works, everything is slower. That is
  // the whole character of the tundra — no hard walls, just less of everything.
  [Terrain.Snow]: { name: "Schnee", passable: true, buildable: true, moveCost: 145, color: "#c3ccd6" },
  // Lava behaves exactly like water and reads nothing like it, which is the
  // point: the badlands need a barrier that says "this map is hostile".
  [Terrain.Lava]: { name: "Lava", passable: false, buildable: false, moveCost: 0, color: "#83321c" },
};

export interface TileGrid {
  readonly width: number;
  readonly height: number;
  /** Row-major terrain bytes, length = width * height. */
  readonly tiles: Uint8Array;
  /**
   * Tiles occupied by a building, parallel to `tiles`.
   *
   * Kept separate from terrain rather than overwriting it: a building can be
   * destroyed, and the grass underneath has to come back. Pathing and placement
   * both consult it, so a unit walks around a headquarters without any system
   * needing to know what a headquarters is.
   */
  readonly blocked: Uint8Array;
}

export function createGrid(width: number, height: number, fill: TerrainType = Terrain.Grass): TileGrid {
  const tiles = new Uint8Array(width * height);
  if (fill !== 0) tiles.fill(fill);
  return { width, height, tiles, blocked: new Uint8Array(width * height) };
}

/** True when a building stands here. */
export function isBlocked(grid: TileGrid, x: number, y: number): boolean {
  if (!isInside(grid, x, y)) return false;
  return grid.blocked[y * grid.width + x] === 1;
}

export function setBlocked(grid: TileGrid, x: number, y: number, blocked: boolean): void {
  if (!isInside(grid, x, y)) return;
  grid.blocked[y * grid.width + x] = blocked ? 1 : 0;
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
  if (isBlocked(grid, x, y)) return false;
  return TERRAIN_INFO[terrainAt(grid, x, y)].passable;
}

export function moveCostAt(grid: TileGrid, x: number, y: number): number {
  return TERRAIN_INFO[terrainAt(grid, x, y)].moveCost;
}

/**
 * Mark every tile belonging to the map's largest connected walkable region.
 *
 * Generated maps produce islands and pockets. A start position dropped into one
 * is a match nobody can play: the two armies never meet, and on a small enough
 * pocket the economy suffocates too. Rather than hoping the anchors miss them,
 * start placement asks this which ground is the real map.
 *
 * One breadth-first pass over the grid, four-connected — the same connectivity
 * a unit actually has, since diagonal moves need both orthogonal neighbours
 * open anyway.
 */
export function findLargestRegion(grid: TileGrid): Uint8Array {
  const size = grid.width * grid.height;
  const component = new Int32Array(size).fill(-1);
  const queue = new Int32Array(size);

  let bestId = -1;
  let bestSize = 0;
  let nextId = 0;

  for (let start = 0; start < size; start++) {
    if (component[start] !== -1) continue;

    const startX = start % grid.width;
    const startY = (start - startX) / grid.width;
    if (!isPassable(grid, startX, startY)) continue;

    const id = nextId++;
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    component[start] = id;
    let count = 0;

    while (head < tail) {
      const index = queue[head++]!;
      count++;

      const x = index % grid.width;
      const y = (index - x) / grid.width;

      for (const [dx, dy] of ORTHOGONAL) {
        const nx = x + dx;
        const ny = y + dy;
        if (!isInside(grid, nx, ny)) continue;

        const neighbour = ny * grid.width + nx;
        if (component[neighbour] !== -1) continue;
        if (!isPassable(grid, nx, ny)) continue;

        component[neighbour] = id;
        queue[tail++] = neighbour;
      }
    }

    if (count > bestSize) {
      bestSize = count;
      bestId = id;
    }
  }

  const mask = new Uint8Array(size);
  if (bestId === -1) return mask;
  for (let index = 0; index < size; index++) {
    if (component[index] === bestId) mask[index] = 1;
  }
  return mask;
}

/**
 * Every tile walkable from one starting tile, as a mask.
 *
 * The companion to `findLargestRegion`: that one answers "which land mass is
 * the map", this one answers "which land mass is *this*". Placing a base blocks
 * the ground under it and can cut a map in two, so the region a later start has
 * to touch is the one measured from the first start — not the biggest one on a
 * map that no longer exists.
 */
export function findRegionFrom(
  grid: TileGrid,
  startX: number,
  startY: number,
  /** A square treated as solid, for asking "what if I built here?". */
  pretendBlocked?: { tileX: number; tileY: number; size: number },
): Uint8Array {
  const solid = (x: number, y: number): boolean => {
    if (
      pretendBlocked &&
      x >= pretendBlocked.tileX &&
      x < pretendBlocked.tileX + pretendBlocked.size &&
      y >= pretendBlocked.tileY &&
      y < pretendBlocked.tileY + pretendBlocked.size
    ) {
      return true;
    }
    return !isPassable(grid, x, y);
  };

  const mask = new Uint8Array(grid.width * grid.height);
  if (solid(startX, startY)) return mask;

  const queue = new Int32Array(grid.width * grid.height);
  let head = 0;
  let tail = 0;

  const start = startY * grid.width + startX;
  mask[start] = 1;
  queue[tail++] = start;

  while (head < tail) {
    const index = queue[head++]!;
    const x = index % grid.width;
    const y = (index - x) / grid.width;

    for (const [dx, dy] of ORTHOGONAL) {
      const nx = x + dx;
      const ny = y + dy;
      if (!isInside(grid, nx, ny)) continue;

      const neighbour = ny * grid.width + nx;
      if (mask[neighbour] === 1) continue;
      if (solid(nx, ny)) continue;

      mask[neighbour] = 1;
      queue[tail++] = neighbour;
    }
  }

  return mask;
}

/**
 * Does at least `minTiles` of walkable ground connect to this tile?
 *
 * The cheap version of `findRegionFrom` for the only question most callers ask:
 * "is there room here, or is this a nook?". Stops as soon as the answer is yes,
 * so the common case walks a handful of tiles rather than the whole map.
 */
export function regionAtLeast(
  grid: TileGrid,
  startX: number,
  startY: number,
  minTiles: number,
): boolean {
  if (!isPassable(grid, startX, startY)) return false;
  if (minTiles <= 1) return true;

  const seen = new Set<number>();
  const queue: number[] = [startY * grid.width + startX];
  seen.add(queue[0]!);

  for (let head = 0; head < queue.length; head++) {
    if (seen.size >= minTiles) return true;

    const index = queue[head]!;
    const x = index % grid.width;
    const y = (index - x) / grid.width;

    for (const [dx, dy] of ORTHOGONAL) {
      const nx = x + dx;
      const ny = y + dy;
      if (!isInside(grid, nx, ny)) continue;
      if (!isPassable(grid, nx, ny)) continue;

      const neighbour = ny * grid.width + nx;
      if (seen.has(neighbour)) continue;
      seen.add(neighbour);
      queue.push(neighbour);
    }
  }

  return seen.size >= minTiles;
}

/**
 * Four-connected, not eight. Two tiles touching only at a corner are *not*
 * neighbours here, and must not be: movement refuses a diagonal step unless
 * both tiles beside it are open, so a corner touch across water is a join that
 * pathfinding will never honour.
 */
const ORTHOGONAL = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

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
      if (isBlocked(grid, tx, ty)) return false;
      if (!TERRAIN_INFO[terrainAt(grid, tx, ty)].buildable) return false;
    }
  }
  return true;
}
