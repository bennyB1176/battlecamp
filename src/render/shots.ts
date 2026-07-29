/**
 * Tracers: the little dots that fly when something shoots.
 *
 * Before this, a battle was two clumps of shapes standing still while health
 * bars quietly went down. Nothing on screen said a fight was happening, let
 * alone who was shooting whom — and combat is the one system in the game with
 * no other visible sign of itself.
 *
 * The animation lives here rather than in the world for the usual reason: it is
 * cosmetic, and putting it in the simulation would mean saved games stored it
 * and multiplayer clients had to agree on it. The simulation only reports *that*
 * a shot happened; how long a dot takes to cross the gap is a drawing question.
 *
 * The clocks are the interesting part. The simulation fires at 10 Hz and the
 * screen refreshes at 60, so a tracer that lived exactly one tick would blink
 * for a single frame at best. They are given a fixed lifetime in milliseconds
 * instead, and the store keeps its own list — which also means a burst of fire
 * during one tick still draws as separate shots rather than one flicker.
 */

import { worldToScreen, type Camera } from "../input/camera.js";
import { playerColors } from "../content/players.js";
import type { PlayerId } from "../sim/entities.js";
import { toTiles } from "../sim/fixed.js";
import { isVisible } from "../sim/vision.js";
import type { Shot, World } from "../sim/world.js";

/**
 * How long a dot takes to cross the gap, in milliseconds.
 *
 * Just over one simulation tick. Shorter and it is a flicker nobody can follow;
 * much longer and a fast-firing unit has three dots in the air at once, which
 * reads as a stream rather than as individual shots.
 */
export const TRACER_FLIGHT_MS = 150;

interface Tracer {
  readonly fromX: number;
  readonly fromY: number;
  readonly toX: number;
  readonly toY: number;
  readonly playerId: PlayerId;
  /** Milliseconds this tracer has been in the air. */
  age: number;
}

export interface TracerStore {
  readonly live: Tracer[];
  /** Tick whose shots have already been taken, so none is added twice. */
  lastTick: number;
}

export function createTracerStore(): TracerStore {
  return { live: [], lastTick: -1 };
}

/**
 * How far along its flight a tracer is, from 0 to 1.
 *
 * Clamped at both ends: a negative age would put a dot behind the shooter, and
 * a frame that arrives late must not throw it past the target.
 */
export function tracerProgress(age: number, flightMs: number = TRACER_FLIGHT_MS): number {
  if (flightMs <= 0) return 1;
  return Math.min(1, Math.max(0, age / flightMs));
}

/** Where a tracer is right now, in world tiles. */
export function tracerPosition(
  tracer: { fromX: number; fromY: number; toX: number; toY: number; age: number },
  flightMs: number = TRACER_FLIGHT_MS,
): { x: number; y: number } {
  const t = tracerProgress(tracer.age, flightMs);
  return {
    x: toTiles(tracer.fromX + (tracer.toX - tracer.fromX) * t),
    y: toTiles(tracer.fromY + (tracer.toY - tracer.fromY) * t),
  };
}

/**
 * Should the player see this shot at all?
 *
 * Judged on where it *lands*. Anything shooting at something the player can see
 * is worth showing — including fire coming out of the fog, which is exactly the
 * warning a player wants. Judging it on the shooter instead would reveal an
 * ambush the moment it opened up, which is the one thing the fog is for.
 */
export function shotIsVisible(world: World, playerId: PlayerId, shot: Shot): boolean {
  return isVisible(world, playerId, Math.floor(toTiles(shot.toX)), Math.floor(toTiles(shot.toY)));
}

/** Take this tick's shots, and age the ones already flying. */
export function updateTracers(
  store: TracerStore,
  world: World,
  localPlayer: PlayerId,
  deltaMs: number,
): void {
  if (world.tick !== store.lastTick) {
    store.lastTick = world.tick;
    for (const shot of world.shots) {
      if (!shotIsVisible(world, localPlayer, shot)) continue;
      store.live.push({ ...shot, age: 0 });
    }
  }

  for (const tracer of store.live) tracer.age += deltaMs;
  // Filtered in place rather than reallocated: a busy battle produces dozens a
  // second, and this runs on every frame.
  let kept = 0;
  for (const tracer of store.live) {
    if (tracer.age < TRACER_FLIGHT_MS) store.live[kept++] = tracer;
  }
  store.live.length = kept;
}

export function drawTracers(
  ctx: CanvasRenderingContext2D,
  store: TracerStore,
  camera: Camera,
): void {
  if (store.live.length === 0) return;

  // Sized against the zoom but never below a pixel and a half: at the zoom
  // levels where a whole battle fits on screen, a dot scaled honestly would be
  // invisible — and that is exactly when you most want to see one.
  const radius = Math.max(1.5, camera.tileSize * 0.09);

  for (const tracer of store.live) {
    const world = tracerPosition(tracer);
    const screen = worldToScreen(camera, world.x, world.y);
    const colors = playerColors(tracer.playerId);

    // A short trail behind the dot: at this size a bare point gives no sense of
    // direction, and direction is what says who is shooting at whom.
    const tail = tracerPosition({ ...tracer, age: tracer.age - TRACER_FLIGHT_MS * 0.25 });
    const tailScreen = worldToScreen(camera, tail.x, tail.y);

    ctx.strokeStyle = colors.dark;
    ctx.lineWidth = Math.max(1, radius * 0.9);
    ctx.beginPath();
    ctx.moveTo(tailScreen.x, tailScreen.y);
    ctx.lineTo(screen.x, screen.y);
    ctx.stroke();

    ctx.fillStyle = colors.light;
    ctx.beginPath();
    ctx.arc(screen.x, screen.y, radius, 0, Math.PI * 2);
    ctx.fill();
  }
}
