/**
 * A uniform-grid spatial hash for neighbour queries.
 *
 * Combat targeting and unit separation both ask "who is near me?" every tick.
 * Answering that by scanning all entities is O(n²) — 250 000 checks at 500
 * units — which is exactly the budget a phone does not have. Bucketing entities
 * by cell turns it into a scan of the handful of cells the query circle covers.
 *
 * The index is rebuilt wholesale each tick rather than updated incrementally.
 * That sounds wasteful, but a full rebuild is a single linear pass, and it
 * removes an entire category of bug: an entity that moved without telling the
 * index, and is therefore invisible to everyone.
 *
 * Cell size should be roughly the largest query radius in use. Much smaller and
 * queries touch many cells; much larger and each cell holds too many entities.
 */

import type { Entity } from "./entities.js";
import { distSq } from "./fixed.js";

/**
 * Cell coordinates are offset before packing so that negative positions get
 * their own keys instead of folding onto positive ones.
 */
const COORD_OFFSET = 1 << 15;
const COORD_STRIDE = 1 << 16;

export interface SpatialHash {
  /** Cell edge length in fixed units. */
  readonly cellSize: number;
  readonly cells: Map<number, Entity[]>;
}

export function createSpatialHash(cellSize: number): SpatialHash {
  if (cellSize <= 0) throw new Error("Spatial hash cell size must be positive");
  return { cellSize, cells: new Map() };
}

function cellKey(cx: number, cy: number): number {
  return (cy + COORD_OFFSET) * COORD_STRIDE + (cx + COORD_OFFSET);
}

export function rebuildSpatialHash(hash: SpatialHash, entities: readonly Entity[]): void {
  // Keep the bucket arrays and empty them, rather than dropping the Map: after
  // the first few ticks this stops allocating entirely.
  for (const bucket of hash.cells.values()) {
    bucket.length = 0;
  }

  for (const entity of entities) {
    const cx = Math.floor(entity.x / hash.cellSize);
    const cy = Math.floor(entity.y / hash.cellSize);
    const key = cellKey(cx, cy);

    const bucket = hash.cells.get(key);
    if (bucket) {
      bucket.push(entity);
    } else {
      hash.cells.set(key, [entity]);
    }
  }
}

/**
 * Collect every entity whose centre lies within `radius` of (x, y).
 *
 * Body radii are deliberately not considered here: callers know their own
 * geometry and can widen the query. `out` is cleared and returned, so a single
 * scratch array can be reused across ticks without allocating.
 */
export function queryRadius(
  hash: SpatialHash,
  x: number,
  y: number,
  radius: number,
  out: Entity[],
): Entity[] {
  out.length = 0;
  if (radius < 0) return out;

  const minCx = Math.floor((x - radius) / hash.cellSize);
  const maxCx = Math.floor((x + radius) / hash.cellSize);
  const minCy = Math.floor((y - radius) / hash.cellSize);
  const maxCy = Math.floor((y + radius) / hash.cellSize);

  const radiusSq = radius * radius;

  for (let cy = minCy; cy <= maxCy; cy++) {
    for (let cx = minCx; cx <= maxCx; cx++) {
      const bucket = hash.cells.get(cellKey(cx, cy));
      if (!bucket) continue;

      for (const entity of bucket) {
        // Cells are squares, the query is a circle — the corners need trimming.
        if (distSq(entity.x, entity.y, x, y) <= radiusSq) {
          out.push(entity);
        }
      }
    }
  }

  return out;
}
