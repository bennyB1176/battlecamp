/**
 * Small canvas icons of units and buildings, drawn with the renderer's own
 * shape code.
 *
 * The rule this file exists to keep: **one piece of code decides what a thing
 * looks like.** A hand-drawn copy of a silhouette for the legend, and another
 * for the build menu, would be two more answers to a question the renderer
 * already answers — and all three would part ways the first time a shape was
 * retuned. So the icons here trace exactly what the map draws, only smaller.
 *
 * They also do real work beyond decoration. Colour says whose, shape says what;
 * a menu row that names a unit without showing its shape teaches nothing about
 * what will be on the map afterwards, which is the one thing the player has to
 * read at a glance during a fight.
 */

import { playerColors } from "../content/players.js";
import { drawBuildingGlyph, traceUnitShape } from "../render/entities.js";

/** Edge length in CSS pixels of the icons the legend uses. */
export const ICON_SIZE = 34;

/**
 * A canvas at the given CSS size, backed at device resolution.
 *
 * Capped at 2×: beyond that the extra pixels cost memory on exactly the phones
 * that have least of it, and nobody can see the difference on a 34-pixel icon.
 */
function iconCanvas(size: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D | null } {
  const canvas = document.createElement("canvas");
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = size * dpr;
  canvas.height = size * dpr;
  canvas.style.width = `${size}px`;
  canvas.style.height = `${size}px`;

  const ctx = canvas.getContext("2d");
  if (ctx) ctx.scale(dpr, dpr);
  return { canvas, ctx };
}

/** A unit silhouette in a player's colours, exactly as the game draws it. */
export function unitIcon(shape: string, playerId: number, size: number = ICON_SIZE): HTMLCanvasElement {
  const { canvas, ctx } = iconCanvas(size);
  if (!ctx) return canvas;

  const colors = playerColors(playerId);
  const radius = size * 0.32;

  ctx.translate(size / 2, size / 2);
  ctx.fillStyle = colors.body;
  ctx.strokeStyle = colors.dark;
  ctx.lineWidth = Math.max(1, radius * 0.22);
  traceUnitShape(ctx, shape, radius);
  ctx.fill();
  ctx.stroke();

  // The facing pip. Without it a silhouette at this size reads as a symbol
  // rather than as the thing standing on the map.
  ctx.fillStyle = colors.light;
  ctx.beginPath();
  ctx.arc(radius * 0.42, 0, Math.max(1, radius * 0.22), 0, Math.PI * 2);
  ctx.fill();

  return canvas;
}

/** A building block carrying its glyph, in a player's colours. */
export function buildingIcon(playerId: number, glyph: string, size: number = ICON_SIZE): HTMLCanvasElement {
  const { canvas, ctx } = iconCanvas(size);
  if (!ctx) return canvas;

  const colors = playerColors(playerId);
  const inset = size * 0.12;

  ctx.fillStyle = colors.body;
  ctx.fillRect(inset, inset, size - inset * 2, size - inset * 2);
  ctx.fillStyle = colors.dark;
  ctx.fillRect(inset, inset, size - inset * 2, (size - inset * 2) * 0.34);
  ctx.strokeStyle = "rgba(0,0,0,0.75)";
  ctx.lineWidth = 1.5;
  ctx.strokeRect(inset, inset, size - inset * 2, size - inset * 2);

  drawBuildingGlyph(ctx, glyph, size / 2, size * 0.58, size * 0.24, colors.light);
  return canvas;
}
