/**
 * Terrain is drawn once into an offscreen canvas and then blitted as a single
 * scaled image each frame.
 *
 * Drawing tiles individually every frame is the classic mobile framerate killer
 * — a fully zoomed-out 128x128 map is 16k fill operations, sixty times a
 * second. The cache turns that into one `drawImage`. It is rebuilt only when
 * terrain actually changes (M2's building placement, M8's map generation).
 */

import { Terrain, TERRAIN_INFO, terrainAt, type TerrainType, type TileGrid } from "../sim/grid.js";
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
  return hash(x, y, 0);
}

/**
 * A number in [0, 1) from three integers.
 *
 * Every scrap of decoration below is placed with this rather than with
 * `Math.random`, and the reason is not purity: the cache is rebuilt whenever
 * terrain changes, so a random tree would jump to a different corner of its
 * tile every time somebody finished a building. Same tile, same detail, always.
 */
function hash(x: number, y: number, salt: number): number {
  let h = Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1) ^ Math.imul(salt + 1, 0x9e3779b9);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2545f491);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
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

      drawTileDetail(ctx, terrain, x, y, px, py, tileSize);
    }
  }

  cache.dirty = false;
}

/**
 * The decoration that makes a tile read as *something* rather than as a colour.
 *
 * All of it lands in the offscreen cache, so it is drawn once per terrain
 * change rather than once per frame — the same reason the cache exists at all.
 * Which means detail here is nearly free, while the same marks drawn live would
 * be tens of thousands of operations a frame on a zoomed-out map.
 *
 * Kept to a few shapes per tile on purpose. Terrain is the backdrop: it has to
 * say "forest" at a glance and then get out of the way of the units, which are
 * the things the player is actually reading.
 */
function drawTileDetail(
  ctx: CanvasRenderingContext2D,
  terrain: TerrainType,
  tileX: number,
  tileY: number,
  px: number,
  py: number,
  size: number,
): void {
  switch (terrain) {
    case Terrain.Grass: {
      // A couple of blades, and only on some tiles: grass covers half the map,
      // so decorating every tile would read as texture noise rather than grass.
      if (hash(tileX, tileY, 1) > 0.45) return;
      ctx.strokeStyle = "rgba(255,255,255,0.10)";
      ctx.lineWidth = Math.max(1, size * 0.05);
      ctx.beginPath();
      for (let blade = 0; blade < 3; blade++) {
        const bx = px + hash(tileX, tileY, 2 + blade) * size * 0.8 + size * 0.1;
        const by = py + hash(tileX, tileY, 5 + blade) * size * 0.7 + size * 0.2;
        ctx.moveTo(bx, by);
        ctx.lineTo(bx + size * 0.06, by - size * 0.18);
      }
      ctx.stroke();
      break;
    }
    case Terrain.Sand: {
      ctx.fillStyle = "rgba(255,255,255,0.12)";
      for (let grain = 0; grain < 3; grain++) {
        const gx = px + hash(tileX, tileY, 10 + grain) * size * 0.85;
        const gy = py + hash(tileX, tileY, 13 + grain) * size * 0.85;
        ctx.fillRect(gx, gy, Math.max(1, size * 0.07), Math.max(1, size * 0.07));
      }
      break;
    }
    case Terrain.Water: {
      // Ripples, offset per tile so they do not line up into stripes across
      // a whole lake.
      ctx.strokeStyle = "rgba(255,255,255,0.13)";
      ctx.lineWidth = Math.max(1, size * 0.055);
      const drift = hash(tileX, tileY, 20) * size * 0.4;
      ctx.beginPath();
      for (let ripple = 0; ripple < 2; ripple++) {
        const ry = py + size * (0.3 + ripple * 0.35) + drift * 0.2;
        ctx.moveTo(px + size * 0.15, ry);
        ctx.lineTo(px + size * 0.5, ry);
        ctx.moveTo(px + size * 0.6, ry + size * 0.1);
        ctx.lineTo(px + size * 0.85, ry + size * 0.1);
      }
      ctx.stroke();
      break;
    }
    case Terrain.Rock: {
      // An angular boulder, lit from the top left like everything else.
      const cx = px + size / 2;
      const cy = py + size / 2;
      const r = size * (0.24 + hash(tileX, tileY, 30) * 0.1);
      ctx.fillStyle = "rgba(255,255,255,0.10)";
      ctx.beginPath();
      ctx.moveTo(cx - r, cy + r * 0.6);
      ctx.lineTo(cx - r * 0.45, cy - r);
      ctx.lineTo(cx + r * 0.7, cy - r * 0.5);
      ctx.lineTo(cx + r, cy + r * 0.7);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "rgba(0,0,0,0.18)";
      ctx.fillRect(cx - r, cy + r * 0.6, r * 2, Math.max(1, size * 0.08));
      break;
    }
    case Terrain.Forest: {
      // Two or three crowns. Forest is the one terrain a player reads from
      // across the map — it is where the wood is — so it gets the most.
      const trees = 2 + (hash(tileX, tileY, 40) > 0.55 ? 1 : 0);
      for (let tree = 0; tree < trees; tree++) {
        const cx = px + size * (0.22 + hash(tileX, tileY, 41 + tree) * 0.56);
        const cy = py + size * (0.25 + hash(tileX, tileY, 45 + tree) * 0.5);
        const r = size * 0.19;

        ctx.fillStyle = "rgba(0,0,0,0.28)";
        ctx.beginPath();
        ctx.arc(cx + r * 0.25, cy + r * 0.3, r, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = "rgba(150, 200, 120, 0.30)";
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case Terrain.Ore: {
      // Bright specks in the rock face: this is the one terrain whose whole
      // job is to catch the eye from a distance.
      ctx.fillStyle = "rgba(255, 226, 150, 0.55)";
      for (let vein = 0; vein < 4; vein++) {
        const vx = px + hash(tileX, tileY, 50 + vein) * size * 0.8 + size * 0.1;
        const vy = py + hash(tileX, tileY, 55 + vein) * size * 0.8 + size * 0.1;
        const s = Math.max(1, size * 0.1);
        ctx.fillRect(vx, vy, s, s);
      }
      break;
    }
    case Terrain.Stone: {
      // Cut blocks, so a quarry does not read as plain rock.
      ctx.fillStyle = "rgba(255,255,255,0.16)";
      ctx.fillRect(px + size * 0.12, py + size * 0.16, size * 0.34, size * 0.28);
      ctx.fillRect(px + size * 0.54, py + size * 0.5, size * 0.32, size * 0.3);
      ctx.fillStyle = "rgba(0,0,0,0.2)";
      ctx.fillRect(px + size * 0.12, py + size * 0.44, size * 0.34, Math.max(1, size * 0.07));
      ctx.fillRect(px + size * 0.54, py + size * 0.8, size * 0.32, Math.max(1, size * 0.07));
      break;
    }
    default:
      break;
  }
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
