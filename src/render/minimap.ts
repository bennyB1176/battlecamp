/**
 * The minimap.
 *
 * It became necessary the moment fog of war arrived. Before that a player could
 * pinch out and see the whole board; now zooming out shows a mostly black
 * screen, and without an overview there is no way to answer "where am I", "where
 * is my base" or "is something attacking me" — which turns the fog from tension
 * into simple disorientation.
 *
 * It shows exactly what the player is entitled to know, drawn from the same
 * vision layers the fog uses: remembered terrain where they have been, live
 * units only where they can currently see. A minimap that quietly reveals the
 * whole map would undo the milestone that made it necessary.
 *
 * The terrain image is rebuilt on the simulation's clock rather than every
 * frame — vision changes ten times a second — while the dots and the viewport
 * marker are redrawn each frame, because they follow the camera.
 */

import { playerColors } from "../content/players.js";
import type { Camera } from "../input/camera.js";
import { isBuilding, type PlayerId } from "../sim/entities.js";
import { toTiles } from "../sim/fixed.js";
import { TERRAIN_INFO, terrainAt } from "../sim/grid.js";
import { visibleTo } from "../sim/vision.js";
import type { World } from "../sim/world.js";

export interface MinimapRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Which tile a point on the minimap refers to.
 *
 * Clamped, because fingers overshoot a small square constantly and a tap two
 * pixels off the edge should still go where it obviously meant.
 */
export function minimapTileAt(
  width: number,
  height: number,
  mapWidth: number,
  mapHeight: number,
  x: number,
  y: number,
): { tileX: number; tileY: number } {
  const clampedX = Math.min(width, Math.max(0, x));
  const clampedY = Math.min(height, Math.max(0, y));
  return {
    tileX: (clampedX / width) * mapWidth,
    tileY: (clampedY / height) * mapHeight,
  };
}

/**
 * Where the current view sits on the overview, in minimap pixels.
 *
 * Clipped to the minimap's own box: the camera may overscroll past the map
 * border, and an unclipped marker would draw outside the panel and over the
 * game behind it.
 */
export function minimapViewport(camera: Camera, width: number, height: number): MinimapRect {
  const scaleX = width / camera.mapWidth;
  const scaleY = height / camera.mapHeight;

  const halfX = camera.viewportWidth / camera.tileSize / 2;
  const halfY = camera.viewportHeight / camera.tileSize / 2;

  const left = Math.max(0, (camera.centerX - halfX) * scaleX);
  const top = Math.max(0, (camera.centerY - halfY) * scaleY);
  const right = Math.min(width, (camera.centerX + halfX) * scaleX);
  const bottom = Math.min(height, (camera.centerY + halfY) * scaleY);

  return {
    x: left,
    y: top,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
  };
}

/** Never-seen ground. Solid, so the shape of what you know is legible. */
const UNSEEN = "#0b0e13";

/** How much remembered-but-unwatched ground is dimmed. Matches the fog's veil. */
const VEIL_FACTOR = 0.55;

export interface Minimap {
  readonly canvas: HTMLCanvasElement;
  /** Redraw. Cheap enough for every frame; the terrain half caches itself. */
  draw: (world: World, camera: Camera, localPlayer: PlayerId) => void;
  /** Where a tap at these panel coordinates wants the camera to go. */
  tileAt: (x: number, y: number) => { tileX: number; tileY: number };
}

export function createMinimap(world: World, size: number): Minimap {
  const canvas = document.createElement("canvas");
  canvas.id = "minimap";
  canvas.setAttribute("aria-label", "Übersichtskarte — antippen, um dorthin zu springen");

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = size * dpr;
  canvas.height = size * dpr;
  canvas.style.width = `${size}px`;
  canvas.style.height = `${size}px`;

  const ctx = canvas.getContext("2d");
  ctx?.scale(dpr, dpr);

  // One pixel per tile, blown up on draw. Same trick as the fog: the scaling is
  // free, and building a 64×64 image is nothing next to 4096 rectangle fills.
  const terrain = document.createElement("canvas");
  terrain.width = world.grid.width;
  terrain.height = world.grid.height;
  const terrainCtx = terrain.getContext("2d");
  const terrainImage = terrainCtx?.createImageData(world.grid.width, world.grid.height) ?? null;

  /** Tick the terrain image was built from; -1 while it has never been built. */
  let terrainTick = -1;

  const rebuildTerrain = (w: World, localPlayer: PlayerId): void => {
    const vision = w.vision[localPlayer];
    if (!terrainCtx || !terrainImage || !vision) return;

    const data = terrainImage.data;
    for (let tileY = 0; tileY < w.grid.height; tileY++) {
      for (let tileX = 0; tileX < w.grid.width; tileX++) {
        const index = tileY * w.grid.width + tileX;
        const offset = index * 4;

        if (vision.explored[index] !== 1) {
          data[offset] = 0x0b;
          data[offset + 1] = 0x0e;
          data[offset + 2] = 0x13;
          data[offset + 3] = 255;
          continue;
        }

        const color = TERRAIN_INFO[terrainAt(w.grid, tileX, tileY)].color;
        // "#rrggbb" straight out of the same table the map is drawn from, so a
        // retuned terrain colour moves both at once.
        const rgb = parseInt(color.slice(1), 16);
        const dim = vision.visible[index] === 1 ? 1 : VEIL_FACTOR;
        data[offset] = ((rgb >> 16) & 0xff) * dim;
        data[offset + 1] = ((rgb >> 8) & 0xff) * dim;
        data[offset + 2] = (rgb & 0xff) * dim;
        data[offset + 3] = 255;
      }
    }

    terrainCtx.putImageData(terrainImage, 0, 0);
    terrainTick = w.tick;
  };

  return {
    canvas,
    tileAt: (x, y) => minimapTileAt(size, size, world.grid.width, world.grid.height, x, y),
    draw: (w, camera, localPlayer) => {
      if (!ctx) return;
      if (terrainTick !== w.tick) rebuildTerrain(w, localPlayer);

      ctx.fillStyle = UNSEEN;
      ctx.fillRect(0, 0, size, size);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(terrain, 0, 0, size, size);

      const scaleX = size / w.grid.width;
      const scaleY = size / w.grid.height;

      // Buildings before units, and both as squares of at least two pixels: a
      // single pixel on a 128-wide overview is invisible on a phone.
      const dot = Math.max(2, Math.round(scaleX * 1.5));
      for (const pass of [true, false]) {
        for (const entity of w.entities.list) {
          if (isBuilding(entity) !== pass) continue;
          if (!visibleTo(w, localPlayer, entity)) continue;

          ctx.fillStyle = playerColors(entity.owner).body;
          const px = toTiles(entity.x) * scaleX;
          const py = toTiles(entity.y) * scaleY;
          const radius = isBuilding(entity) ? dot + 1 : dot;
          ctx.fillRect(px - radius / 2, py - radius / 2, radius, radius);
        }
      }

      const view = minimapViewport(camera, size, size);
      if (view.width > 0 && view.height > 0) {
        ctx.strokeStyle = "rgba(255,255,255,0.85)";
        ctx.lineWidth = 1;
        ctx.strokeRect(
          Math.round(view.x) + 0.5,
          Math.round(view.y) + 0.5,
          Math.max(1, Math.round(view.width) - 1),
          Math.max(1, Math.round(view.height) - 1),
        );
      }
    },
  };
}
