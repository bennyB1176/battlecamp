/**
 * Terrain is drawn once into an offscreen canvas and then blitted as a single
 * scaled image each frame.
 *
 * Drawing tiles individually every frame is the classic mobile framerate killer
 * — a fully zoomed-out 128x128 map is 16k fill operations, sixty times a
 * second. The cache turns that into one `drawImage`. It is rebuilt only when
 * terrain actually changes (M2's building placement, M8's map generation).
 */

import { TERRAIN_INFO, terrainAt, type TileGrid } from "../sim/grid.js";
import type { Camera } from "../input/camera.js";
import { worldToScreen } from "../input/camera.js";

/** Keep the cache texture within limits every mobile GPU is happy with. */
const MAX_CACHE_DIMENSION = 2048;
const MAX_CACHE_TILE_SIZE = 24;

export interface TerrainCache {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  /** Cache pixels per tile. Independent of the camera's zoom. */
  readonly tileSize: number;
  dirty: boolean;
}

/**
 * Stable per-tile brightness jitter so flat colours do not look like a
 * spreadsheet. Deterministic in (x, y), so the map never shimmers between
 * rebuilds.
 */
function tileJitter(x: number, y: number): number {
  let h = Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2545f491);
  h ^= h >>> 13;
  return ((h >>> 0) % 100) / 100;
}

export function createTerrainCache(grid: TileGrid): TerrainCache {
  const tileSize = Math.max(
    1,
    Math.min(MAX_CACHE_TILE_SIZE, Math.floor(MAX_CACHE_DIMENSION / Math.max(grid.width, grid.height))),
  );

  const canvas = document.createElement("canvas");
  canvas.width = grid.width * tileSize;
  canvas.height = grid.height * tileSize;

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D context for the terrain cache is unavailable");

  const cache: TerrainCache = { canvas, ctx, tileSize, dirty: true };
  rebuildTerrainCache(cache, grid);
  return cache;
}

export function rebuildTerrainCache(cache: TerrainCache, grid: TileGrid): void {
  const { ctx, tileSize } = cache;
  ctx.clearRect(0, 0, cache.canvas.width, cache.canvas.height);

  for (let y = 0; y < grid.height; y++) {
    for (let x = 0; x < grid.width; x++) {
      const terrain = terrainAt(grid, x, y);
      const px = x * tileSize;
      const py = y * tileSize;

      ctx.fillStyle = TERRAIN_INFO[terrain].color;
      ctx.fillRect(px, py, tileSize, tileSize);

      // Subtle light/dark speckle to break up large uniform areas.
      const jitter = tileJitter(x, y);
      ctx.fillStyle = jitter > 0.5 ? "rgba(255,255,255,0.045)" : "rgba(0,0,0,0.055)";
      ctx.fillRect(px, py, tileSize, tileSize);
    }
  }

  cache.dirty = false;
}

/**
 * Blit the visible part of the cache, scaled to the camera's zoom.
 *
 * Source and destination are both clamped to the map, so off-map area shows the
 * page background instead of stretched edge pixels.
 */
export function drawTerrain(
  ctx: CanvasRenderingContext2D,
  cache: TerrainCache,
  camera: Camera,
  grid: TileGrid,
): void {
  if (cache.dirty) rebuildTerrainCache(cache, grid);

  const topLeft = worldToScreen(camera, 0, 0);
  const size = { w: grid.width * camera.tileSize, h: grid.height * camera.tileSize };

  // Nearest-neighbour: the cache is flat-coloured tiles, and smoothing would
  // only blur the boundaries when zoomed in past the cache resolution.
  const previousSmoothing = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(cache.canvas, topLeft.x, topLeft.y, size.w, size.h);
  ctx.imageSmoothingEnabled = previousSmoothing;
}
