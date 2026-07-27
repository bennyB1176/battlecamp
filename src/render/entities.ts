/**
 * Drawing units.
 *
 * The simulation ticks ten times a second; the display refreshes sixty. Drawing
 * raw simulation positions would therefore show visible stepping, so every unit
 * is drawn between where it was last tick and where it is now, using the
 * `alpha` the game loop provides. This is the entire reason entities carry a
 * `prevX`/`prevY`.
 *
 * Placeholder art: coloured discs with a dark outline. Silhouette and colour
 * carry the meaning, which is all strategy needs — sprites can replace this
 * without touching anything else.
 */

import { unitDef } from "../content/units.js";
import type { Camera } from "../input/camera.js";
import { visibleTileBounds, worldToScreen } from "../input/camera.js";
import type { Selection } from "../input/selection.js";
import { toTiles } from "../sim/fixed.js";
import type { World } from "../sim/world.js";

/** Below this zoom, units are drawn as plain dots — outlines just muddy them. */
const DETAIL_MIN_TILE_SIZE = 10;

export interface WorldBox {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

export function drawEntities(
  ctx: CanvasRenderingContext2D,
  world: World,
  camera: Camera,
  selection: Selection,
  alpha: number,
): void {
  const bounds = visibleTileBounds(camera);
  // A margin so a unit straddling the edge does not pop in and out.
  const margin = 2;
  const detailed = camera.tileSize >= DETAIL_MIN_TILE_SIZE;

  for (const entity of world.entities.list) {
    const worldX = toTiles(entity.prevX + (entity.x - entity.prevX) * alpha);
    const worldY = toTiles(entity.prevY + (entity.y - entity.prevY) * alpha);

    if (
      worldX < bounds.minX - margin ||
      worldX > bounds.maxX + margin ||
      worldY < bounds.minY - margin ||
      worldY > bounds.maxY + margin
    ) {
      continue;
    }

    const def = unitDef(entity.typeId);
    const screen = worldToScreen(camera, worldX, worldY);
    const radius = Math.max(2, toTiles(def.radius) * camera.tileSize);

    ctx.fillStyle = def.color;
    ctx.beginPath();
    ctx.arc(screen.x, screen.y, radius, 0, Math.PI * 2);
    ctx.fill();

    if (detailed) {
      ctx.strokeStyle = "rgba(0,0,0,0.65)";
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    if (selection.ids.has(entity.id)) {
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(screen.x, screen.y, radius + 4, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
}

/** A faint line from each selected unit to where it was told to go. */
export function drawOrders(
  ctx: CanvasRenderingContext2D,
  world: World,
  camera: Camera,
  selection: Selection,
): void {
  if (selection.ids.size === 0) return;

  ctx.save();
  ctx.strokeStyle = "rgba(255,255,255,0.28)";
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 5]);
  ctx.beginPath();

  for (const entity of world.entities.list) {
    if (!selection.ids.has(entity.id)) continue;
    if (entity.goalX === null || entity.goalY === null) continue;

    const from = worldToScreen(camera, toTiles(entity.x), toTiles(entity.y));
    const to = worldToScreen(camera, toTiles(entity.goalX), toTiles(entity.goalY));
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
  }

  ctx.stroke();
  ctx.restore();
}

/** The rubber-band rectangle while the player is dragging a selection box. */
export function drawSelectionBox(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  box: WorldBox | null,
): void {
  if (!box) return;

  const start = worldToScreen(camera, Math.min(box.x0, box.x1), Math.min(box.y0, box.y1));
  const end = worldToScreen(camera, Math.max(box.x0, box.x1), Math.max(box.y0, box.y1));
  const width = end.x - start.x;
  const height = end.y - start.y;

  ctx.save();
  ctx.fillStyle = "rgba(255, 214, 102, 0.12)";
  ctx.fillRect(start.x, start.y, width, height);
  ctx.strokeStyle = "rgba(255, 214, 102, 0.9)";
  ctx.lineWidth = 1.5;
  ctx.strokeRect(start.x, start.y, width, height);
  ctx.restore();
}
