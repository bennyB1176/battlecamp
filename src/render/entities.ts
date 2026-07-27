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

import { buildingDef, type BuildingTypeId } from "../content/buildings.js";
import type { Camera } from "../input/camera.js";
import { visibleTileBounds, worldToScreen } from "../input/camera.js";
import { canPlace, PlacementError } from "../sim/construction.js";
import type { Selection } from "../input/selection.js";
import {
  buildingDefOf,
  buildingOrigin,
  isBuilding,
  isComplete,
  unitDefOf,
  type Entity,
} from "../sim/entities.js";
import { toTiles } from "../sim/fixed.js";
import { Resource } from "../sim/resources.js";
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

    const screen = worldToScreen(camera, worldX, worldY);
    const selected = selection.ids.has(entity.id);

    if (isBuilding(entity)) {
      drawBuilding(ctx, entity, camera, selected, detailed);
      continue;
    }

    const def = unitDefOf(entity);
    const radius = Math.max(2, toTiles(def.radius) * camera.tileSize);

    ctx.fillStyle = def.color;
    ctx.beginPath();
    ctx.arc(screen.x, screen.y, radius, 0, Math.PI * 2);
    ctx.fill();

    if (detailed) {
      ctx.strokeStyle = "rgba(0,0,0,0.65)";
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // A worker carrying a load gets a dot in its resource's colour, so the
      // economy is legible at a glance instead of only in the numbers.
      if (entity.job?.carrying !== null && entity.job !== null && entity.job.carried > 0) {
        ctx.fillStyle = RESOURCE_COLORS[entity.job.carrying] ?? "#ffffff";
        ctx.beginPath();
        ctx.arc(screen.x, screen.y - radius - 3, Math.max(1.5, radius * 0.35), 0, Math.PI * 2);
        ctx.fill();
      }
    }

    if (selected) {
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(screen.x, screen.y, radius + 4, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
}

const RESOURCE_COLORS: Record<number, string> = {
  [Resource.Wood]: "#6ba85a",
  [Resource.Stone]: "#c9c6bd",
  [Resource.Ore]: "#d69a4c",
};

/**
 * Buildings are drawn as squares on their real footprint, which matters for
 * more than looks: the shape on screen is exactly the ground they block, so a
 * player can see why a unit walks around rather than through.
 */
function drawBuilding(
  ctx: CanvasRenderingContext2D,
  entity: Entity,
  camera: Camera,
  selected: boolean,
  detailed: boolean,
): void {
  const def = buildingDefOf(entity);
  const origin = buildingOrigin(entity);
  const topLeft = worldToScreen(camera, origin.tileX, origin.tileY);
  const size = def.footprint * camera.tileSize;

  const underConstruction = !isComplete(entity);

  ctx.fillStyle = def.color;
  ctx.globalAlpha = underConstruction ? 0.45 : 1;
  ctx.fillRect(topLeft.x, topLeft.y, size, size);
  ctx.globalAlpha = 1;

  if (detailed) {
    ctx.strokeStyle = "rgba(0,0,0,0.7)";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(topLeft.x, topLeft.y, size, size);
  }

  if (underConstruction && entity.construction !== null) {
    // A scaffolding bar, filling as the work is done.
    const done = 1 - entity.construction / def.buildWork;
    const barHeight = Math.max(3, size * 0.12);
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.fillRect(topLeft.x, topLeft.y + size - barHeight, size, barHeight);
    ctx.fillStyle = "#ffd666";
    ctx.fillRect(topLeft.x, topLeft.y + size - barHeight, size * done, barHeight);
  }

  if (selected) {
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2;
    ctx.strokeRect(topLeft.x - 3, topLeft.y - 3, size + 6, size + 6);
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

/**
 * While a building is armed, tint every tile it could legally stand on.
 *
 * This is the affordance that makes the build-radius rule teachable. Without
 * it, a player taps somewhere reasonable, gets refused, and has to infer an
 * invisible rule from failures; with it, the rule is simply visible before the
 * first tap.
 *
 * Cost is deliberately not part of the tint — that is what the greyed-out
 * button in the menu says. Mixing the two would make "you cannot afford this"
 * look like "you cannot build here".
 */
export function drawBuildOverlay(
  ctx: CanvasRenderingContext2D,
  world: World,
  camera: Camera,
  playerId: number,
  typeId: BuildingTypeId,
): void {
  const bounds = visibleTileBounds(camera);

  // Amber, not green. The map is mostly grass and forest, and a green "you may
  // build here" tint over green ground is invisible — which makes the whole
  // affordance worthless. Amber is the HUD's accent and reads against every
  // terrain in the palette.
  const legal = (tileX: number, tileY: number): boolean => {
    const check = canPlace(world, playerId, typeId, tileX, tileY);
    // A position is legal even when the bank is short; affordability is the
    // button's job to communicate, not the map's.
    return check.ok || check.error === PlacementError.TooExpensive;
  };

  ctx.save();
  ctx.fillStyle = "rgba(255, 214, 102, 0.22)";

  const valid: boolean[][] = [];
  for (let tileY = bounds.minY; tileY <= bounds.maxY; tileY++) {
    const row: boolean[] = [];
    for (let tileX = bounds.minX; tileX <= bounds.maxX; tileX++) {
      const ok = legal(tileX, tileY);
      row.push(ok);
      if (!ok) continue;

      const topLeft = worldToScreen(camera, tileX, tileY);
      ctx.fillRect(topLeft.x, topLeft.y, camera.tileSize + 1, camera.tileSize + 1);
    }
    valid.push(row);
  }

  // Outline the edge of the buildable area. A filled region alone still blends
  // on busy terrain; a hard border makes the boundary unmistakable.
  ctx.strokeStyle = "rgba(255, 214, 102, 0.95)";
  ctx.lineWidth = 2;
  ctx.beginPath();

  for (let row = 0; row < valid.length; row++) {
    for (let column = 0; column < valid[row]!.length; column++) {
      if (!valid[row]![column]) continue;

      const tileX = bounds.minX + column;
      const tileY = bounds.minY + row;
      const topLeft = worldToScreen(camera, tileX, tileY);
      const size = camera.tileSize;

      // Tiles outside the visible slice count as invalid, so the border also
      // traces the screen edge — which is honest: we do not know what is there.
      const up = row > 0 && valid[row - 1]![column];
      const down = row + 1 < valid.length && valid[row + 1]![column];
      const left = column > 0 && valid[row]![column - 1];
      const right = column + 1 < valid[row]!.length && valid[row]![column + 1];

      if (!up) {
        ctx.moveTo(topLeft.x, topLeft.y);
        ctx.lineTo(topLeft.x + size, topLeft.y);
      }
      if (!down) {
        ctx.moveTo(topLeft.x, topLeft.y + size);
        ctx.lineTo(topLeft.x + size, topLeft.y + size);
      }
      if (!left) {
        ctx.moveTo(topLeft.x, topLeft.y);
        ctx.lineTo(topLeft.x, topLeft.y + size);
      }
      if (!right) {
        ctx.moveTo(topLeft.x + size, topLeft.y);
        ctx.lineTo(topLeft.x + size, topLeft.y + size);
      }
    }
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
