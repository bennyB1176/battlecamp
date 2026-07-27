/**
 * Canvas renderer.
 *
 * Strictly read-only with respect to the world: it takes a `World` and a
 * `Camera` and draws a frame. It never mutates simulation state, which is what
 * allows the sim to run headless (CI balance matches) with no renderer at all.
 *
 * Rendering runs at display rate while the sim ticks at 10 Hz, so every frame
 * receives an `alpha` in [0, 1) describing how far we are between the previous
 * tick and the next. From M1 that drives position interpolation; for now it
 * only smooths the marker pulse.
 */

import type { Camera } from "../input/camera.js";
import { resizeCamera, visibleTileBounds, worldToScreen } from "../input/camera.js";
import { PING_LIFETIME_TICKS, type Command } from "../sim/commands.js";
import type { World } from "../sim/world.js";
import { createTerrainCache, drawTerrain, type TerrainCache } from "./terrain.js";

/** Below this zoom the tile grid becomes visual noise, so we stop drawing it. */
const GRID_LINES_MIN_TILE_SIZE = 18;

export interface Renderer {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  readonly terrain: TerrainCache;
  /** Milliseconds the last frame spent drawing, for the debug overlay. */
  lastFrameMs: number;
}

export function createRenderer(canvas: HTMLCanvasElement, world: World): Renderer {
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) throw new Error("2D context is unavailable");

  return {
    canvas,
    ctx,
    terrain: createTerrainCache(world.grid),
    lastFrameMs: 0,
  };
}

/**
 * Match the canvas backing store to its CSS size times the device pixel ratio,
 * then scale the context so all drawing code can work in CSS pixels.
 *
 * DPR is capped at 2: a 3x phone screen triples the fill rate for a difference
 * nobody can see on flat-coloured tiles.
 */
export function resizeRenderer(renderer: Renderer, camera: Camera): void {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const cssWidth = renderer.canvas.clientWidth || window.innerWidth;
  const cssHeight = renderer.canvas.clientHeight || window.innerHeight;

  const backingWidth = Math.round(cssWidth * dpr);
  const backingHeight = Math.round(cssHeight * dpr);

  if (renderer.canvas.width !== backingWidth || renderer.canvas.height !== backingHeight) {
    renderer.canvas.width = backingWidth;
    renderer.canvas.height = backingHeight;
  }

  renderer.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  // Goes through resizeCamera rather than assigning the fields directly: a
  // rotation changes both the zoom floor and the pan limits, so the camera has
  // to be re-clamped or the map ends up half off-screen after turning the phone.
  resizeCamera(camera, cssWidth, cssHeight);
}

/**
 * @param alpha   Progress between the last tick and the next, in [0, 1).
 * @param pending Commands queued but not yet applied — while the game is
 *                paused these can sit around for a while, and drawing them
 *                faintly is what keeps the UI feeling responsive without
 *                letting the renderer touch world state.
 */
export function renderFrame(
  renderer: Renderer,
  world: World,
  camera: Camera,
  alpha: number,
  pending: readonly Command[] = [],
): void {
  const started = performance.now();
  const { ctx } = renderer;

  ctx.fillStyle = "#12161c";
  ctx.fillRect(0, 0, camera.viewportWidth, camera.viewportHeight);

  drawTerrain(ctx, renderer.terrain, camera, world.grid);
  drawGridLines(ctx, camera);
  drawMapBorder(ctx, camera, world);
  drawMarkers(ctx, world, camera, alpha);
  drawPendingCommands(ctx, camera, pending);

  renderer.lastFrameMs = performance.now() - started;
}

function drawGridLines(ctx: CanvasRenderingContext2D, camera: Camera): void {
  if (camera.tileSize < GRID_LINES_MIN_TILE_SIZE) return;

  const bounds = visibleTileBounds(camera);
  ctx.strokeStyle = "rgba(0,0,0,0.12)";
  ctx.lineWidth = 1;
  ctx.beginPath();

  for (let x = bounds.minX; x <= bounds.maxX + 1; x++) {
    const screen = worldToScreen(camera, x, 0);
    // The 0.5 offset puts the stroke on a pixel centre so it stays crisp.
    const px = Math.round(screen.x) + 0.5;
    ctx.moveTo(px, worldToScreen(camera, x, bounds.minY).y);
    ctx.lineTo(px, worldToScreen(camera, x, bounds.maxY + 1).y);
  }
  for (let y = bounds.minY; y <= bounds.maxY + 1; y++) {
    const screen = worldToScreen(camera, 0, y);
    const py = Math.round(screen.y) + 0.5;
    ctx.moveTo(worldToScreen(camera, bounds.minX, y).x, py);
    ctx.lineTo(worldToScreen(camera, bounds.maxX + 1, y).x, py);
  }

  ctx.stroke();
}

function drawMapBorder(ctx: CanvasRenderingContext2D, camera: Camera, world: World): void {
  const topLeft = worldToScreen(camera, 0, 0);
  ctx.strokeStyle = "rgba(255,255,255,0.25)";
  ctx.lineWidth = 2;
  ctx.strokeRect(
    topLeft.x,
    topLeft.y,
    world.grid.width * camera.tileSize,
    world.grid.height * camera.tileSize,
  );
}

function drawMarkers(ctx: CanvasRenderingContext2D, world: World, camera: Camera, alpha: number): void {
  if (world.markers.length === 0) return;

  ctx.lineWidth = 2;
  for (const marker of world.markers) {
    // Interpolate the countdown so the ring expands smoothly at 60 fps rather
    // than stepping ten times a second.
    const remaining = Math.max(0, marker.ticksLeft - alpha);
    const progress = 1 - remaining / PING_LIFETIME_TICKS;

    const center = worldToScreen(camera, marker.tileX + 0.5, marker.tileY + 0.5);
    const radius = camera.tileSize * (0.25 + progress * 0.6);

    ctx.strokeStyle = `rgba(255, 214, 102, ${(1 - progress).toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
    ctx.stroke();
  }
}

/** Queued-but-unapplied commands, drawn dashed so they read as "not yet real". */
function drawPendingCommands(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  pending: readonly Command[],
): void {
  if (pending.length === 0) return;

  ctx.save();
  ctx.setLineDash([4, 4]);
  ctx.strokeStyle = "rgba(255, 214, 102, 0.55)";
  ctx.lineWidth = 2;

  for (const command of pending) {
    if (command.type !== "ping") continue;
    const center = worldToScreen(camera, command.tileX + 0.5, command.tileY + 0.5);
    ctx.beginPath();
    ctx.arc(center.x, center.y, camera.tileSize * 0.35, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.restore();
}
