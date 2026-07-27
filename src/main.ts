/**
 * Entry point: wires the deterministic simulation to the renderer, the camera
 * and the HUD, and runs the game loop.
 *
 * The loop uses a fixed-timestep accumulator. Rendering happens as fast as the
 * display allows; the simulation advances in whole 100 ms ticks and never in
 * fractions. This separation is what keeps a match reproducible regardless of
 * whether it ran at 30, 60 or 120 fps.
 */

import { attachCameraControls, centerOn, createCamera, type Camera } from "./input/camera.js";
import { createRenderer, renderFrame, resizeRenderer } from "./render/renderer.js";
import type { Command } from "./sim/commands.js";
import { createWorld, MS_PER_TICK, TICKS_PER_SECOND, tickWorld, type World } from "./sim/world.js";
import { createHud } from "./ui/hud.js";

/** Available time multipliers. 0 is pause. */
const SPEEDS = [1, 2, 4] as const;

/**
 * Cap on how many ticks a single frame may simulate. Without it, a phone that
 * was backgrounded for a minute would try to catch up 600 ticks in one frame
 * and lock up — the classic "spiral of death".
 */
const MAX_TICKS_PER_FRAME = 5;

/** Ignore frame gaps longer than this (tab switch, screen lock). */
const MAX_FRAME_DELTA_MS = 250;

function formatClock(tick: number): string {
  const totalSeconds = Math.floor(tick / TICKS_PER_SECOND);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function start(): void {
  const canvas = document.getElementById("game");
  if (!(canvas instanceof HTMLCanvasElement)) {
    throw new Error("Canvas #game is missing from index.html");
  }

  // A fixed seed for now; M8's skirmish setup screen will let the player choose.
  const world: World = createWorld({ seed: 20260727, width: 64, height: 64 });
  const camera: Camera = createCamera(world.grid.width, world.grid.height);
  const renderer = createRenderer(canvas, world);

  /**
   * Commands issued since the last tick. Everything — taps now, unit orders and
   * bot decisions later — lands here and is drained at the next tick boundary.
   * While paused it simply grows, and the renderer draws it dashed so the
   * player can see their queued intent.
   */
  let pendingCommands: Command[] = [];

  let paused = false;
  let speed: number = SPEEDS[0];

  const hud = createHud({
    onTogglePause: () => {
      paused = !paused;
      hud.setPaused(paused);
    },
    onSetSpeed: (next) => {
      speed = next;
      // Choosing a speed is also the natural way to say "resume".
      if (paused) {
        paused = false;
        hud.setPaused(false);
      }
      hud.setSpeed(next);
    },
    onCenter: () => centerOn(camera, world.grid.width / 2, world.grid.height / 2),
  });
  hud.setPaused(paused);
  hud.setSpeed(speed);

  attachCameraControls(canvas, camera, {
    onTap: (tileX, tileY) => {
      pendingCommands.push({ type: "ping", playerId: 0, tileX, tileY });
    },
  });

  const handleResize = (): void => resizeRenderer(renderer, camera);
  window.addEventListener("resize", handleResize);
  window.addEventListener("orientationchange", handleResize);
  handleResize();
  centerOn(camera, world.grid.width / 2, world.grid.height / 2);

  // Development-only handle for poking at the running game from the console or
  // from a browser-automation smoke test. Stripped from production builds.
  if (import.meta.env.DEV) {
    (window as unknown as Record<string, unknown>)["__battlecamp"] = { world, camera, renderer };
  }

  let previousFrameTime = performance.now();
  let accumulator = 0;
  let framesSinceReport = 0;
  let fpsWindowStart = previousFrameTime;
  let fps = 0;
  let lastTickMs = 0;

  const frame = (now: number): void => {
    requestAnimationFrame(frame);

    const delta = Math.min(now - previousFrameTime, MAX_FRAME_DELTA_MS);
    previousFrameTime = now;

    if (!paused) {
      accumulator += delta * speed;

      let ticksThisFrame = 0;
      while (accumulator >= MS_PER_TICK && ticksThisFrame < MAX_TICKS_PER_FRAME) {
        const tickStarted = performance.now();
        tickWorld(world, pendingCommands);
        lastTickMs = performance.now() - tickStarted;

        // Fresh array rather than length = 0: the old one may still be
        // referenced by this frame's render call.
        pendingCommands = [];
        accumulator -= MS_PER_TICK;
        ticksThisFrame++;
      }

      // Hit the cap: we are behind and will never catch up. Drop the backlog
      // instead of accumulating it forever.
      if (ticksThisFrame === MAX_TICKS_PER_FRAME) accumulator = 0;
    }

    const alpha = paused ? 0 : accumulator / MS_PER_TICK;
    renderFrame(renderer, world, camera, alpha, pendingCommands);

    framesSinceReport++;
    if (now - fpsWindowStart >= 500) {
      fps = Math.round((framesSinceReport * 1000) / (now - fpsWindowStart));
      framesSinceReport = 0;
      fpsWindowStart = now;

      hud.setClock(`${formatClock(world.tick)}${paused ? " ⏸" : ""}`);
      hud.setStats(
        `${fps} fps · Tick ${world.tick} · Sim ${lastTickMs.toFixed(2)} ms · ` +
          `Frame ${renderer.lastFrameMs.toFixed(2)} ms`,
      );
    }
  };

  requestAnimationFrame(frame);
}

start();
