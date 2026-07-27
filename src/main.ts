/**
 * Entry point: wires the deterministic simulation to the renderer, the camera,
 * the selection and the HUD, and runs the game loop.
 *
 * The loop uses a fixed-timestep accumulator. Rendering happens as fast as the
 * display allows; the simulation advances in whole 100 ms ticks and never in
 * fractions. That separation is what keeps a match reproducible regardless of
 * whether it ran at 30, 60 or 120 fps.
 *
 * This file also owns *interpretation*: one tap can mean select, move, gather,
 * help build, or place a building, and deciding which is a question about
 * intent rather than about rules. Keeping that decision here leaves the
 * simulation to enforce what is legal and the HUD to draw buttons.
 */

import { BUILDABLE, buildingDef, type BuildingTypeId } from "./content/buildings.js";
import { unitDef, UnitType } from "./content/units.js";
import { attachCameraControls, centerOn, createCamera, type Camera, type WorldBox } from "./input/camera.js";
import { createSelection, pruneSelection, selectAt, selectInBox, selectedEntities } from "./input/selection.js";
import { createRenderer, renderFrame, resizeRenderer } from "./render/renderer.js";
import { canPlace, PlacementError, type PlacementErrorKind } from "./sim/construction.js";
import type { Command } from "./sim/commands.js";
import { isWorker } from "./sim/economy.js";
import { buildingDefOf, isBuilding, isComplete, type Entity } from "./sim/entities.js";
import { fromTiles } from "./sim/fixed.js";
import { terrainAt } from "./sim/grid.js";
import { Resource, resourceOfTerrain, RESOURCE_NAMES, type Cost } from "./sim/resources.js";
import { createWorld, MS_PER_TICK, TICKS_PER_SECOND, tickWorld, type World } from "./sim/world.js";
import { createHud, type HudAction } from "./ui/hud.js";

/** Available time multipliers. */
const SPEEDS = [1, 2, 4] as const;

/** Until multiplayer, the human is always player 0. */
const LOCAL_PLAYER = 0;

/**
 * Cap on how many ticks a single frame may simulate. Without it, a phone that
 * was backgrounded for a minute would try to catch up 600 ticks in one frame
 * and lock up — the classic "spiral of death".
 */
const MAX_TICKS_PER_FRAME = 5;

/** Ignore frame gaps longer than this (tab switch, screen lock). */
const MAX_FRAME_DELTA_MS = 250;

/** How long a placement refusal stays on screen. */
const NOTICE_TICKS = 25;

/** Workers sent automatically when a building is placed with none selected. */
const AUTO_BUILDERS = 3;

function formatClock(tick: number): string {
  const totalSeconds = Math.floor(tick / TICKS_PER_SECOND);
  return `${Math.floor(totalSeconds / 60)}:${(totalSeconds % 60).toString().padStart(2, "0")}`;
}

function formatCost(cost: Cost): string {
  const parts: string[] = [];
  if (cost[Resource.Wood]) parts.push(`${cost[Resource.Wood]} ${RESOURCE_NAMES[Resource.Wood]}`);
  if (cost[Resource.Stone]) parts.push(`${cost[Resource.Stone]} ${RESOURCE_NAMES[Resource.Stone]}`);
  if (cost[Resource.Ore]) parts.push(`${cost[Resource.Ore]} ${RESOURCE_NAMES[Resource.Ore]}`);
  return parts.join(" · ");
}

/** Say why a placement was refused, in words a player can act on. */
function placementMessage(error: PlacementErrorKind | undefined): string {
  switch (error) {
    case PlacementError.OutOfRange:
      return "Zu weit von der Basis entfernt";
    case PlacementError.Occupied:
      return "Da steht schon etwas";
    case PlacementError.BadTerrain:
      return "Untergrund ungeeignet";
    case PlacementError.TooExpensive:
      return "Nicht genug Rohstoffe";
    case PlacementError.OutOfMap:
      return "Außerhalb der Karte";
    default:
      return "Hier geht das nicht";
  }
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
   * Commands issued since the last tick. Everything — taps now, bot decisions
   * later — lands here and is drained at the next tick boundary. While paused
   * it simply grows, and the renderer draws it dashed so the player can see
   * their queued intent.
   */
  let pendingCommands: Command[] = [];

  let paused = false;
  let speed: number = SPEEDS[0];

  /** Which of my units are highlighted. Never enters the world. */
  const selection = createSelection();
  let selectMode = false;
  let selectionBox: WorldBox | null = null;

  /** Build menu state: open, and which type is waiting to be placed. */
  let buildMenuOpen = false;
  let armedBuilding: BuildingTypeId | null = null;

  /** A short-lived message, e.g. why a placement was refused. */
  let notice = "";
  let noticeUntilTick = 0;

  const showNotice = (text: string): void => {
    notice = text;
    noticeUntilTick = world.tick + NOTICE_TICKS;
  };

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
    onToggleSelectMode: () => {
      selectMode = !selectMode;
      // The two drag modes are mutually exclusive; arming both would make a
      // drag ambiguous.
      if (selectMode) closeBuildMenu();
      hud.setSelectMode(selectMode);
    },
    onToggleBuildMenu: () => {
      if (buildMenuOpen) {
        closeBuildMenu();
      } else {
        buildMenuOpen = true;
        selectMode = false;
        hud.setSelectMode(false);
      }
      hud.setBuildMode(buildMenuOpen);
    },
  });

  function closeBuildMenu(): void {
    buildMenuOpen = false;
    armedBuilding = null;
    hud.setBuildMode(false);
  }

  hud.setPaused(paused);
  hud.setSpeed(speed);
  hud.setSelectMode(selectMode);
  hud.setBuildMode(buildMenuOpen);

  /** Own entity under a point, if any. */
  function entityAt(x: number, y: number): Entity | null {
    let best: Entity | null = null;
    let bestDistanceSq = Number.POSITIVE_INFINITY;

    for (const entity of world.entities.list) {
      if (entity.owner !== LOCAL_PLAYER) continue;

      if (isBuilding(entity)) {
        const def = buildingDefOf(entity);
        const half = (def.footprint * fromTiles(1)) / 2;
        if (Math.abs(entity.x - x) <= half && Math.abs(entity.y - y) <= half) return entity;
        continue;
      }

      const reach = Math.max(unitDef(entity.typeId as never).radius, fromTiles(0.7));
      const dx = entity.x - x;
      const dy = entity.y - y;
      const separationSq = dx * dx + dy * dy;
      if (separationSq <= reach * reach && separationSq < bestDistanceSq) {
        bestDistanceSq = separationSq;
        best = entity;
      }
    }

    return best;
  }

  /**
   * The workers best placed to raise something at this tile.
   *
   * Idle ones first — pulling someone off a full load of wood to walk across
   * the map is worse than sending someone standing around doing nothing — then
   * by distance.
   */
  function nearestWorkers(tileX: number, tileY: number, count: number): Entity[] {
    const targetX = fromTiles(tileX + 0.5);
    const targetY = fromTiles(tileY + 0.5);

    return world.entities.list
      .filter((entity) => entity.owner === LOCAL_PLAYER && isWorker(entity))
      .map((entity) => {
        const dx = entity.x - targetX;
        const dy = entity.y - targetY;
        return { entity, busy: entity.job !== null ? 1 : 0, distanceSq: dx * dx + dy * dy };
      })
      .sort((a, b) => a.busy - b.busy || a.distanceSq - b.distanceSq)
      .slice(0, count)
      .map((scored) => scored.entity);
  }

  /**
   * One tap, several meanings. Resolved in the order a player expects:
   * placing a building beats everything; then giving my selected workers a job
   * on what I tapped; then selecting; then plain movement.
   */
  function handleTap(worldX: number, worldY: number): void {
    const x = fromTiles(worldX);
    const y = fromTiles(worldY);
    const tileX = Math.floor(worldX);
    const tileY = Math.floor(worldY);

    if (armedBuilding !== null) {
      const check = canPlace(world, LOCAL_PLAYER, armedBuilding, tileX, tileY);
      if (!check.ok) {
        showNotice(placementMessage(check.error));
        return;
      }

      // Whoever is selected does the work — but if that is nobody (the player
      // had the headquarters selected while browsing the menu, say), send the
      // nearest workers anyway. Charging for a building and then leaving it as
      // a shell nobody touches is the worst possible answer.
      const selectedWorkers = selectedEntities(selection, world).filter(isWorker);
      const builders =
        selectedWorkers.length > 0 ? selectedWorkers : nearestWorkers(tileX, tileY, AUTO_BUILDERS);

      if (builders.length === 0) {
        showNotice("Keine Arbeiter verfügbar");
        return;
      }

      pendingCommands.push({
        type: "build",
        playerId: LOCAL_PLAYER,
        entityIds: builders.map((entity) => entity.id),
        buildingType: armedBuilding,
        tileX,
        tileY,
      });
      closeBuildMenu();
      return;
    }

    const chosen = selectedEntities(selection, world);
    const workers = chosen.filter(isWorker);
    const target = entityAt(x, y);

    // Workers plus an unfinished building of mine means "go help", not "select".
    if (workers.length > 0 && target && isBuilding(target) && !isComplete(target)) {
      pendingCommands.push({
        type: "assist",
        playerId: LOCAL_PLAYER,
        entityIds: workers.map((entity) => entity.id),
        targetId: target.id,
      });
      return;
    }

    // Workers plus a resource tile means "harvest that".
    if (workers.length > 0 && resourceOfTerrain(terrainAt(world.grid, tileX, tileY)) !== null) {
      pendingCommands.push({
        type: "gather",
        playerId: LOCAL_PLAYER,
        entityIds: workers.map((entity) => entity.id),
        tileX,
        tileY,
      });
      return;
    }

    if (selectAt(selection, world, x, y, LOCAL_PLAYER)) return;

    if (chosen.length > 0) {
      pendingCommands.push({
        type: "move",
        playerId: LOCAL_PLAYER,
        entityIds: chosen.filter((entity) => !isBuilding(entity)).map((entity) => entity.id),
        targetX: x,
        targetY: y,
      });
      return;
    }

    pendingCommands.push({ type: "ping", playerId: LOCAL_PLAYER, tileX, tileY });
  }

  attachCameraControls(canvas, camera, {
    onTap: handleTap,
    isBoxSelectMode: () => selectMode,
    onBoxUpdate: (box) => {
      selectionBox = box;
    },
    onBoxCommit: (box) => {
      selectInBox(
        selection,
        world,
        fromTiles(box.x0),
        fromTiles(box.y0),
        fromTiles(box.x1),
        fromTiles(box.y1),
        LOCAL_PLAYER,
      );
      // Selecting is the point of the mode; staying in it would block panning.
      selectMode = false;
      hud.setSelectMode(false);
    },
  });

  /** Build the context panel from whatever is currently selected. */
  function contextForSelection(): { title: string; actions: HudAction[] } {
    const player = world.players[LOCAL_PLAYER]!;

    if (buildMenuOpen) {
      const actions = BUILDABLE.map((typeId) => {
        const def = buildingDef(typeId);
        const affordable = canPlace(world, LOCAL_PLAYER, typeId, -1, -1).error !== PlacementError.TooExpensive;
        return {
          id: `build-${typeId}`,
          label: def.name,
          detail: formatCost(def.cost),
          armed: armedBuilding === typeId,
          disabled: !affordable,
          onSelect: () => {
            armedBuilding = armedBuilding === typeId ? null : typeId;
          },
        };
      });

      const title =
        armedBuilding !== null
          ? `${buildingDef(armedBuilding).name}: Stelle antippen`
          : "Bauen — grün markierte Fläche ist erlaubt";
      return { title, actions };
    }

    const chosen = selectedEntities(selection, world);
    if (chosen.length === 0) return { title: "", actions: [] };

    // A single production building: offer what it trains.
    const producer = chosen.find((entity) => entity.production !== null && isComplete(entity));
    if (producer && chosen.length === 1) {
      const def = buildingDefOf(producer);
      const queued = producer.production?.queue.length ?? 0;
      const actions: HudAction[] = def.produces.map((unitType) => {
        const unit = unitDef(unitType);
        const affordable =
          (player.resources[Resource.Wood] ?? 0) >= (unit.cost[Resource.Wood] ?? 0) &&
          (player.resources[Resource.Stone] ?? 0) >= (unit.cost[Resource.Stone] ?? 0) &&
          (player.resources[Resource.Ore] ?? 0) >= (unit.cost[Resource.Ore] ?? 0);

        return {
          id: `train-${unitType}`,
          label: `${unit.name} +`,
          detail: formatCost(unit.cost),
          disabled: !affordable,
          onSelect: () => {
            pendingCommands.push({
              type: "train",
              playerId: LOCAL_PLAYER,
              buildingId: producer.id,
              unitType,
            });
          },
        };
      });

      if (queued > 0) {
        actions.push({
          id: "cancel-train",
          label: "Abbrechen",
          detail: `${queued} in Arbeit`,
          onSelect: () => {
            pendingCommands.push({
              type: "cancel-train",
              playerId: LOCAL_PLAYER,
              buildingId: producer.id,
            });
          },
        });
      }

      return { title: `${def.name}${queued > 0 ? ` — ${queued} in der Warteschlange` : ""}`, actions };
    }

    const workers = chosen.filter(isWorker).length;
    const title =
      chosen.length === 1
        ? isBuilding(chosen[0]!)
          ? buildingDefOf(chosen[0]!).name
          : unitDef(chosen[0]!.typeId as never).name
        : `${chosen.length} ausgewählt${workers > 0 ? ` (${workers} Arbeiter)` : ""}`;

    return { title, actions: [] };
  }

  const handleResize = (): void => resizeRenderer(renderer, camera);
  window.addEventListener("resize", handleResize);
  window.addEventListener("orientationchange", handleResize);
  handleResize();
  centerOn(camera, world.grid.width / 2, world.grid.height / 2);

  // Development-only handle for poking at the running game from the console or
  // from a browser-automation smoke test. Stripped from production builds.
  if (import.meta.env.DEV) {
    (window as unknown as Record<string, unknown>)["__battlecamp"] = {
      world,
      camera,
      renderer,
      selection,
      arm: (typeId: BuildingTypeId) => {
        buildMenuOpen = true;
        armedBuilding = typeId;
        hud.setBuildMode(true);
      },
      queue: (command: Command) => pendingCommands.push(command),
    };
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

      // Units die; the ids we are holding must not outlive them.
      if (ticksThisFrame > 0) pruneSelection(selection, world);
    }

    const alpha = paused ? 0 : accumulator / MS_PER_TICK;
    renderFrame(renderer, world, camera, {
      alpha,
      pending: pendingCommands,
      selection,
      selectionBox,
      buildPreview: armedBuilding,
      localPlayer: LOCAL_PLAYER,
    });

    const player = world.players[LOCAL_PLAYER]!;
    hud.setResources(
      player.resources[Resource.Wood],
      player.resources[Resource.Stone],
      player.resources[Resource.Ore],
    );

    const context = contextForSelection();
    const showNoticeNow = world.tick < noticeUntilTick && notice !== "";
    hud.setContext(showNoticeNow ? notice : context.title, context.actions);

    framesSinceReport++;
    if (now - fpsWindowStart >= 500) {
      fps = Math.round((framesSinceReport * 1000) / (now - fpsWindowStart));
      framesSinceReport = 0;
      fpsWindowStart = now;

      hud.setClock(`${formatClock(world.tick)}${paused ? " ⏸" : ""}`);
      hud.setStats(
        `${fps} fps · ${world.entities.list.length} Obj. · ` +
          `Sim ${lastTickMs.toFixed(2)} ms · Frame ${renderer.lastFrameMs.toFixed(2)} ms`,
      );
    }
  };

  requestAnimationFrame(frame);
}

// The bundle may be inlined ahead of the markup (single-file builds), so wait
// for the DOM rather than assuming the canvas already exists.
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", start, { once: true });
} else {
  start();
}
