/**
 * Drawing the fog of war.
 *
 * One pixel per tile in an offscreen bitmap, drawn scaled up over the map with
 * smoothing on. The blur that a phone's GPU does for free while stretching a
 * 64×64 image across the screen *is* the soft edge — drawing feathered circles
 * per tile would cost hundreds of gradient fills a frame to look worse.
 *
 * Three states, and they are deliberately different in kind rather than in
 * degree:
 *
 * - **Never seen** — solid, the colour of the page background. There is no map
 *   there as far as the player is concerned.
 * - **Seen before, dark now** — a veil. The terrain shows through because the
 *   player remembers the ground; what they cannot see is what is standing on it.
 * - **Visible** — nothing drawn at all.
 *
 * Rebuilt on the simulation's clock, not the renderer's: sight changes ten
 * times a second, and redrawing it sixty would be five wasted passes out of six.
 */

import { visibleTileBounds, worldToScreen, type Camera } from "../input/camera.js";
import type { PlayerId } from "../sim/entities.js";
import type { World } from "../sim/world.js";

/** How dark ground the player has seen but cannot currently watch. */
const VEIL_ALPHA = 150;
/** Ground never visited: as good as not on the map. */
const UNSEEN_ALPHA = 255;

/** Matches the page background, so unexplored map reads as "nothing here". */
const FOG_RGB = [12, 15, 20] as const;

export interface FogCache {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D | null;
  readonly image: ImageData | null;
  /** Simulation tick the bitmap was built from; -1 while it has never been built. */
  tick: number;
  /** Whose fog is in the bitmap, so switching players cannot show a stale one. */
  playerId: PlayerId;
}

export function createFogCache(width: number, height: number): FogCache {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  return {
    canvas,
    ctx,
    image: ctx ? ctx.createImageData(width, height) : null,
    tick: -1,
    playerId: -1,
  };
}

function rebuild(cache: FogCache, world: World, playerId: PlayerId): void {
  const { ctx, image } = cache;
  const vision = world.vision[playerId];
  if (!ctx || !image || !vision) return;

  const data = image.data;
  const [r, g, b] = FOG_RGB;

  for (let i = 0; i < vision.explored.length; i++) {
    const offset = i * 4;
    data[offset] = r;
    data[offset + 1] = g;
    data[offset + 2] = b;
    data[offset + 3] =
      vision.visible[i] === 1 ? 0 : vision.explored[i] === 1 ? VEIL_ALPHA : UNSEEN_ALPHA;
  }

  ctx.putImageData(image, 0, 0);
  cache.tick = world.tick;
  cache.playerId = playerId;
}

/**
 * Lay the fog over everything drawn so far.
 *
 * Only the on-screen part is stretched, by taking the matching rectangle out of
 * the bitmap: blowing the whole map up and letting the canvas clip it would
 * hand the GPU a much larger image than the screen for no gain.
 */
export function drawFog(
  ctx: CanvasRenderingContext2D,
  cache: FogCache,
  world: World,
  camera: Camera,
  playerId: PlayerId,
): void {
  if (cache.tick !== world.tick || cache.playerId !== playerId) rebuild(cache, world, playerId);
  if (cache.tick < 0) return;

  const bounds = visibleTileBounds(camera);
  // One tile of overlap on each side, so the smoothed edge is fed by real
  // neighbours instead of fading into the border of the source rectangle.
  const minX = Math.max(0, bounds.minX - 1);
  const minY = Math.max(0, bounds.minY - 1);
  const maxX = Math.min(world.grid.width - 1, bounds.maxX + 1);
  const maxY = Math.min(world.grid.height - 1, bounds.maxY + 1);
  if (maxX < minX || maxY < minY) return;

  const topLeft = worldToScreen(camera, minX, minY);
  const bottomRight = worldToScreen(camera, maxX + 1, maxY + 1);

  const smoothing = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(
    cache.canvas,
    minX,
    minY,
    maxX - minX + 1,
    maxY - minY + 1,
    topLeft.x,
    topLeft.y,
    bottomRight.x - topLeft.x,
    bottomRight.y - topLeft.y,
  );
  ctx.imageSmoothingEnabled = smoothing;
}
