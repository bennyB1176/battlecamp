/**
 * Camera and touch controls.
 *
 * Everything here is view-only: the camera never touches world state, and the
 * gestures it recognises turn into commands rather than direct mutations.
 *
 * Gestures (identical on mouse and touch, since we use pointer events):
 *   - one finger drag  => pan
 *   - two finger pinch => zoom around the midpoint, pan with the midpoint
 *   - tap              => onTap(tileX, tileY)
 *   - wheel            => zoom around the cursor (desktop convenience)
 */

/** Camera position is the world point at the centre of the viewport, in tiles. */
export interface Camera {
  centerX: number;
  centerY: number;
  /** CSS pixels per tile. This is the zoom level. */
  tileSize: number;
  viewportWidth: number;
  viewportHeight: number;
  /** Map bounds, used for clamping. */
  mapWidth: number;
  mapHeight: number;
}

/** Never zoom in past this — tiles become comically large and lose context. */
const MAX_TILE_SIZE = 72;
/** Never zoom out past this, regardless of map size — tiles become unreadable. */
const ABSOLUTE_MIN_TILE_SIZE = 4;

/** A drag beyond this many CSS pixels is a pan, not a tap. */
const TAP_MOVE_TOLERANCE = 12;
/** A press held longer than this is not a tap either. */
const TAP_TIME_TOLERANCE_MS = 350;

export function createCamera(mapWidth: number, mapHeight: number): Camera {
  return {
    centerX: mapWidth / 2,
    centerY: mapHeight / 2,
    tileSize: 24,
    viewportWidth: 1,
    viewportHeight: 1,
    mapWidth,
    mapHeight,
  };
}

/**
 * Smallest tile size that still makes sense: enough to fit the whole map, so
 * zooming out never leaves the map floating in a sea of background.
 */
function minTileSize(camera: Camera): number {
  const fit = Math.min(camera.viewportWidth / camera.mapWidth, camera.viewportHeight / camera.mapHeight);
  return Math.max(ABSOLUTE_MIN_TILE_SIZE, fit);
}

/**
 * Keep the camera somewhere sensible.
 *
 * The rule is **any tile can reach the middle of the screen**, not "the
 * viewport stays inside the map". The difference is the whole point: pinning
 * the viewport to the map means a base in a corner is stuck in a corner of the
 * *screen*, which on a phone is exactly where the status bar and the button row
 * are. Zooming in on your own headquarters put it under the HUD with no way to
 * push it out — you were fighting the map border, not looking at your base.
 *
 * So the centre is clamped to the map's own bounds instead. At worst three
 * quarters of the screen is background, which reads clearly as the edge of the
 * world (the border is drawn) and always leaves the map in view.
 */
export function clampCamera(camera: Camera): void {
  camera.tileSize = Math.min(MAX_TILE_SIZE, Math.max(minTileSize(camera), camera.tileSize));

  const visibleX = camera.viewportWidth / camera.tileSize;
  const visibleY = camera.viewportHeight / camera.tileSize;

  // If the map is narrower than the viewport, centre it: there is nothing to
  // pan to, and letting it drift would just move the map around under the HUD.
  camera.centerX =
    visibleX >= camera.mapWidth
      ? camera.mapWidth / 2
      : Math.min(camera.mapWidth, Math.max(0, camera.centerX));

  camera.centerY =
    visibleY >= camera.mapHeight
      ? camera.mapHeight / 2
      : Math.min(camera.mapHeight, Math.max(0, camera.centerY));
}

export function resizeCamera(camera: Camera, width: number, height: number): void {
  camera.viewportWidth = width;
  camera.viewportHeight = height;
  clampCamera(camera);
}

/** Screen (CSS pixels, canvas-relative) -> world tiles, fractional. */
export function screenToWorld(camera: Camera, screenX: number, screenY: number): { x: number; y: number } {
  return {
    x: camera.centerX + (screenX - camera.viewportWidth / 2) / camera.tileSize,
    y: camera.centerY + (screenY - camera.viewportHeight / 2) / camera.tileSize,
  };
}

/** World tiles -> screen (CSS pixels, canvas-relative). */
export function worldToScreen(camera: Camera, worldX: number, worldY: number): { x: number; y: number } {
  return {
    x: (worldX - camera.centerX) * camera.tileSize + camera.viewportWidth / 2,
    y: (worldY - camera.centerY) * camera.tileSize + camera.viewportHeight / 2,
  };
}

/** The tile range currently on screen, so the renderer only draws what is visible. */
export function visibleTileBounds(camera: Camera): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} {
  const topLeft = screenToWorld(camera, 0, 0);
  const bottomRight = screenToWorld(camera, camera.viewportWidth, camera.viewportHeight);
  return {
    minX: Math.max(0, Math.floor(topLeft.x)),
    minY: Math.max(0, Math.floor(topLeft.y)),
    maxX: Math.min(camera.mapWidth - 1, Math.ceil(bottomRight.x)),
    maxY: Math.min(camera.mapHeight - 1, Math.ceil(bottomRight.y)),
  };
}

/** Zoom while keeping the world point under (anchorX, anchorY) pinned in place. */
export function zoomAt(camera: Camera, factor: number, anchorX: number, anchorY: number): void {
  const before = screenToWorld(camera, anchorX, anchorY);
  camera.tileSize = Math.min(MAX_TILE_SIZE, Math.max(minTileSize(camera), camera.tileSize * factor));
  // Solve screenToWorld(anchor) == before for the new centre.
  camera.centerX = before.x - (anchorX - camera.viewportWidth / 2) / camera.tileSize;
  camera.centerY = before.y - (anchorY - camera.viewportHeight / 2) / camera.tileSize;
  clampCamera(camera);
}

export function centerOn(camera: Camera, worldX: number, worldY: number): void {
  camera.centerX = worldX;
  camera.centerY = worldY;
  clampCamera(camera);
}

/** A rectangle in fractional world-tile coordinates. */
export interface WorldBox {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

export interface CameraControlOptions {
  /**
   * Fired when a press was short and still enough to count as a tap.
   * Coordinates are fractional world tiles, so callers can hit-test units
   * precisely rather than only to the nearest tile.
   */
  onTap?: (worldX: number, worldY: number) => void;

  /**
   * When this returns true, a one-finger drag rubber-bands a selection box
   * instead of panning.
   *
   * On a phone there is no right mouse button and no spare modifier key, and
   * one-finger drag is already spoken for by panning — the map has to be
   * movable. An explicit mode toggle is the honest solution: it costs one
   * button and works identically under a thumb and under a mouse.
   */
  isBoxSelectMode?: () => boolean;
  /** Called continuously during a box drag, and once with null when it ends. */
  onBoxUpdate?: (box: WorldBox | null) => void;
  /** Called once when a box drag completes. */
  onBoxCommit?: (box: WorldBox) => void;
}

interface PointerState {
  x: number;
  y: number;
  startX: number;
  startY: number;
  startTime: number;
  moved: number;
}

/**
 * Wire pointer events on the canvas to the camera.
 * Returns a teardown function that removes every listener it added.
 */
export function attachCameraControls(
  canvas: HTMLCanvasElement,
  camera: Camera,
  options: CameraControlOptions = {},
): () => void {
  const pointers = new Map<number, PointerState>();
  /** Distance between the two fingers on the previous move, for pinch scaling. */
  let pinchDistance = 0;
  /** Set once two fingers touch, so lifting them does not fire a stray tap. */
  let gestureWasPinch = false;
  /** Anchor of an in-progress selection box, in world tiles. */
  let boxAnchor: { x: number; y: number } | null = null;

  const cancelBox = (): void => {
    if (!boxAnchor) return;
    boxAnchor = null;
    options.onBoxUpdate?.(null);
  };

  const localPoint = (event: PointerEvent): { x: number; y: number } => {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const twoPointers = (): [PointerState, PointerState] | null => {
    if (pointers.size !== 2) return null;
    const [a, b] = [...pointers.values()];
    return a && b ? [a, b] : null;
  };

  const onPointerDown = (event: PointerEvent): void => {
    const point = localPoint(event);
    canvas.setPointerCapture(event.pointerId);
    pointers.set(event.pointerId, {
      x: point.x,
      y: point.y,
      startX: point.x,
      startY: point.y,
      // performance.now() is view-side only; the sim never sees wall-clock time.
      startTime: performance.now(),
      moved: 0,
    });

    const pair = twoPointers();
    if (pair) {
      gestureWasPinch = true;
      pinchDistance = Math.hypot(pair[0].x - pair[1].x, pair[0].y - pair[1].y);
      // A second finger means the player wants to zoom, not to select.
      cancelBox();
      return;
    }

    if (pointers.size === 1 && options.isBoxSelectMode?.()) {
      boxAnchor = screenToWorld(camera, point.x, point.y);
    }
  };

  const onPointerMove = (event: PointerEvent): void => {
    const state = pointers.get(event.pointerId);
    if (!state) return;

    const point = localPoint(event);
    const dx = point.x - state.x;
    const dy = point.y - state.y;
    state.x = point.x;
    state.y = point.y;
    state.moved += Math.abs(dx) + Math.abs(dy);

    const pair = twoPointers();
    if (pair) {
      // Two fingers: pinch to zoom, and pan by however far the midpoint moved.
      const distance = Math.hypot(pair[0].x - pair[1].x, pair[0].y - pair[1].y);
      const midX = (pair[0].x + pair[1].x) / 2;
      const midY = (pair[0].y + pair[1].y) / 2;

      if (pinchDistance > 0 && distance > 0) {
        zoomAt(camera, distance / pinchDistance, midX, midY);
      }
      pinchDistance = distance;

      camera.centerX -= dx / 2 / camera.tileSize;
      camera.centerY -= dy / 2 / camera.tileSize;
      clampCamera(camera);
      return;
    }

    if (boxAnchor) {
      // Rubber-banding a selection box: the camera stays put.
      const corner = screenToWorld(camera, point.x, point.y);
      options.onBoxUpdate?.({ x0: boxAnchor.x, y0: boxAnchor.y, x1: corner.x, y1: corner.y });
      return;
    }

    if (pointers.size === 1) {
      // One finger: drag the map so the world follows the finger exactly.
      camera.centerX -= dx / camera.tileSize;
      camera.centerY -= dy / camera.tileSize;
      clampCamera(camera);
    }
  };

  const onPointerUp = (event: PointerEvent): void => {
    const state = pointers.get(event.pointerId);
    pointers.delete(event.pointerId);
    if (canvas.hasPointerCapture(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }

    if (pointers.size < 2) pinchDistance = 0;

    const wasTap =
      state !== undefined &&
      !gestureWasPinch &&
      Math.hypot(state.x - state.startX, state.y - state.startY) <= TAP_MOVE_TOLERANCE &&
      performance.now() - state.startTime <= TAP_TIME_TOLERANCE_MS;

    if (boxAnchor && state) {
      const corner = screenToWorld(camera, state.x, state.y);
      // A tap in select mode is still a tap — a zero-area box would just
      // clear the selection, which is not what the player meant.
      if (!wasTap) {
        options.onBoxCommit?.({ x0: boxAnchor.x, y0: boxAnchor.y, x1: corner.x, y1: corner.y });
      }
      cancelBox();
    }

    if (state && wasTap && options.onTap) {
      const world = screenToWorld(camera, state.x, state.y);
      options.onTap(world.x, world.y);
    }

    if (pointers.size === 0) gestureWasPinch = false;
  };

  const onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    const rect = canvas.getBoundingClientRect();
    // Exponential so each notch feels like the same relative step.
    zoomAt(camera, Math.exp(-event.deltaY * 0.0015), event.clientX - rect.left, event.clientY - rect.top);
  };

  // Stop the browser from turning our gestures into scrolling or page zoom.
  const onContextMenu = (event: Event): void => event.preventDefault();

  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerUp);
  canvas.addEventListener("wheel", onWheel, { passive: false });
  canvas.addEventListener("contextmenu", onContextMenu);

  return () => {
    canvas.removeEventListener("pointerdown", onPointerDown);
    canvas.removeEventListener("pointermove", onPointerMove);
    canvas.removeEventListener("pointerup", onPointerUp);
    canvas.removeEventListener("pointercancel", onPointerUp);
    canvas.removeEventListener("wheel", onWheel);
    canvas.removeEventListener("contextmenu", onContextMenu);
  };
}
