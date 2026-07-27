/**
 * Flow-field pathfinding.
 *
 * A* finds one unit's path. A flow field finds *everyone's* path to a shared
 * goal in a single sweep: one Dijkstra pass outward from the goal labels every
 * tile with the direction of its cheapest step, and any number of units then
 * follow the arrows for the cost of an array lookup each.
 *
 * That asymmetry is the whole reason this exists. Ordering a hundred units to
 * one point runs one search here, versus a hundred nearly identical searches
 * with per-unit A* — which is exactly the workload that makes mobile RTS games
 * stutter.
 *
 * Fields are cached per goal tile (LRU) and invalidated when terrain changes.
 */

import { isPassable, moveCostAt, isInside, type TileGrid } from "./grid.js";

/** Cost value meaning "no route from here". */
export const UNREACHABLE = 0x7fffffff;

/** Stored in `dir` for tiles with nowhere to go (the goal, and dead ends). */
const NO_DIRECTION = -1;

/**
 * Orthogonals first, then diagonals. A diagonal covers √2 as much ground, so it
 * costs 141/100 as much — without that, units prefer staircase paths that look
 * visibly wrong.
 */
const DIRECTIONS = [
  { dx: 0, dy: -1, weight: 100 },
  { dx: 1, dy: 0, weight: 100 },
  { dx: 0, dy: 1, weight: 100 },
  { dx: -1, dy: 0, weight: 100 },
  { dx: 1, dy: -1, weight: 141 },
  { dx: 1, dy: 1, weight: 141 },
  { dx: -1, dy: 1, weight: 141 },
  { dx: -1, dy: -1, weight: 141 },
] as const;

export interface FlowField {
  readonly goalX: number;
  readonly goalY: number;
  readonly width: number;
  readonly height: number;
  /** Accumulated travel cost to the goal, or UNREACHABLE. */
  readonly cost: Int32Array;
  /** Index into DIRECTIONS for the next step, or NO_DIRECTION. */
  readonly dir: Int8Array;
}

export function costAt(field: FlowField, tileX: number, tileY: number): number {
  if (tileX < 0 || tileY < 0 || tileX >= field.width || tileY >= field.height) return UNREACHABLE;
  return field.cost[tileY * field.width + tileX]!;
}

export function isReachable(field: FlowField, tileX: number, tileY: number): boolean {
  return costAt(field, tileX, tileY) !== UNREACHABLE;
}

/** The step to take from this tile, or null at the goal and on unreachable tiles. */
export function flowDirectionAt(
  field: FlowField,
  tileX: number,
  tileY: number,
): { dx: number; dy: number } | null {
  if (tileX < 0 || tileY < 0 || tileX >= field.width || tileY >= field.height) return null;

  const direction = field.dir[tileY * field.width + tileX]!;
  if (direction === NO_DIRECTION) return null;

  const step = DIRECTIONS[direction]!;
  return { dx: step.dx, dy: step.dy };
}

/**
 * A diagonal step is only legal when both orthogonal tiles beside it are open.
 * Without this check units slip through the corner where two rocks touch —
 * visibly walking through solid terrain.
 */
function diagonalIsClear(grid: TileGrid, fromX: number, fromY: number, toX: number, toY: number): boolean {
  return isPassable(grid, toX, fromY) && isPassable(grid, fromX, toY);
}

/**
 * Binary min-heap over tile indices, ordered by cost with the tile index as a
 * tie-break. The tie-break is not cosmetic: without it, equal-cost tiles could
 * pop in an order that depends on heap internals, and two machines running the
 * same match would produce different fields.
 */
interface Heap {
  readonly tiles: number[];
  readonly costs: number[];
}

function heapPush(heap: Heap, tile: number, cost: number): void {
  heap.tiles.push(tile);
  heap.costs.push(cost);

  let child = heap.tiles.length - 1;
  while (child > 0) {
    const parent = (child - 1) >> 1;
    if (!heapLess(heap, child, parent)) break;
    heapSwap(heap, child, parent);
    child = parent;
  }
}

function heapLess(heap: Heap, a: number, b: number): boolean {
  const costA = heap.costs[a]!;
  const costB = heap.costs[b]!;
  if (costA !== costB) return costA < costB;
  return heap.tiles[a]! < heap.tiles[b]!;
}

function heapSwap(heap: Heap, a: number, b: number): void {
  const tile = heap.tiles[a]!;
  heap.tiles[a] = heap.tiles[b]!;
  heap.tiles[b] = tile;

  const cost = heap.costs[a]!;
  heap.costs[a] = heap.costs[b]!;
  heap.costs[b] = cost;
}

function heapPop(heap: Heap): { tile: number; cost: number } | null {
  if (heap.tiles.length === 0) return null;

  const tile = heap.tiles[0]!;
  const cost = heap.costs[0]!;

  const lastTile = heap.tiles.pop()!;
  const lastCost = heap.costs.pop()!;

  if (heap.tiles.length > 0) {
    heap.tiles[0] = lastTile;
    heap.costs[0] = lastCost;

    let parent = 0;
    for (;;) {
      const left = parent * 2 + 1;
      const right = left + 1;
      let smallest = parent;

      if (left < heap.tiles.length && heapLess(heap, left, smallest)) smallest = left;
      if (right < heap.tiles.length && heapLess(heap, right, smallest)) smallest = right;
      if (smallest === parent) break;

      heapSwap(heap, parent, smallest);
      parent = smallest;
    }
  }

  return { tile, cost };
}

/**
 * Dijkstra outward from the goal.
 *
 * We search *backwards* — from the goal to everywhere — which is what makes one
 * sweep serve every unit. Each tile records the direction back toward the goal.
 */
export function computeFlowField(grid: TileGrid, goalX: number, goalY: number): FlowField {
  const { width, height } = grid;
  const cost = new Int32Array(width * height).fill(UNREACHABLE);
  const dir = new Int8Array(width * height).fill(NO_DIRECTION);

  const field: FlowField = { goalX, goalY, width, height, cost, dir };

  // Standing on rock is not a destination; nothing can reach it.
  if (!isInside(grid, goalX, goalY) || !isPassable(grid, goalX, goalY)) return field;

  const heap: Heap = { tiles: [], costs: [] };
  const goalIndex = goalY * width + goalX;
  cost[goalIndex] = 0;
  heapPush(heap, goalIndex, 0);

  for (;;) {
    const current = heapPop(heap);
    if (!current) break;

    // Stale heap entry from a tile we have since improved.
    if (current.cost > cost[current.tile]!) continue;

    const x = current.tile % width;
    const y = (current.tile - x) / width;

    for (let d = 0; d < DIRECTIONS.length; d++) {
      const step = DIRECTIONS[d]!;
      // Neighbour of the tile we are expanding *from*; the unit will travel the
      // other way, from the neighbour toward here.
      const nx = x + step.dx;
      const ny = y + step.dy;

      if (!isInside(grid, nx, ny) || !isPassable(grid, nx, ny)) continue;
      if (step.weight !== 100 && !diagonalIsClear(grid, nx, ny, x, y)) continue;

      // Terrain cost of the tile being left behind, scaled by step length.
      const stepCost = Math.floor((moveCostAt(grid, nx, ny) * step.weight) / 100);
      const candidate = current.cost + stepCost;
      const neighbourIndex = ny * width + nx;

      if (candidate < cost[neighbourIndex]!) {
        cost[neighbourIndex] = candidate;
        // The unit at the neighbour steps the opposite way, toward us.
        dir[neighbourIndex] = oppositeDirection(d);
        heapPush(heap, neighbourIndex, candidate);
      }
    }
  }

  return field;
}

/** Index of the direction pointing the other way. Orthogonals and diagonals each form a ring of four. */
function oppositeDirection(direction: number): number {
  return direction < 4 ? (direction + 2) % 4 : ((direction - 4 + 2) % 4) + 4;
}

export interface FlowFieldCache {
  readonly fields: Map<number, FlowField>;
  readonly maxEntries: number;
}

export function createFlowFieldCache(maxEntries = 8): FlowFieldCache {
  return { fields: new Map(), maxEntries };
}

/**
 * Fetch (or compute) the field for a goal tile.
 *
 * A `Map` preserves insertion order, so re-inserting on every hit turns it into
 * an LRU list for free: the first key is always the least recently used.
 */
export function getFlowField(
  cache: FlowFieldCache,
  grid: TileGrid,
  goalX: number,
  goalY: number,
): FlowField {
  const key = goalY * grid.width + goalX;

  const existing = cache.fields.get(key);
  if (existing) {
    cache.fields.delete(key);
    cache.fields.set(key, existing);
    return existing;
  }

  const field = computeFlowField(grid, goalX, goalY);
  cache.fields.set(key, field);

  while (cache.fields.size > cache.maxEntries) {
    const oldest = cache.fields.keys().next();
    if (oldest.done) break;
    cache.fields.delete(oldest.value);
  }

  return field;
}

/** Call whenever terrain changes — a new building, a destroyed bridge, a new map. */
export function invalidateFlowFields(cache: FlowFieldCache): void {
  cache.fields.clear();
}
