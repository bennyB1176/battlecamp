/**
 * Camera maths. Pure functions, so they test cleanly without a DOM — the
 * gesture handling in `attachCameraControls` needs a real browser and is
 * verified by hand on a phone.
 *
 * These cover the parts that silently ruin a mobile RTS: taps landing on the
 * wrong tile, and the map sliding off into empty space.
 */

import { describe, expect, it } from "vitest";

import {
  centerOn,
  clampCamera,
  createCamera,
  resizeCamera,
  screenToWorld,
  visibleTileBounds,
  worldToScreen,
  zoomAt,
} from "../src/input/camera.js";

function testCamera(): ReturnType<typeof createCamera> {
  const camera = createCamera(64, 64);
  resizeCamera(camera, 800, 400);
  return camera;
}

describe("screen/world conversion", () => {
  it("round-trips a screen point back to itself", () => {
    const camera = testCamera();
    centerOn(camera, 20, 30);

    for (const point of [
      { x: 0, y: 0 },
      { x: 123, y: 45 },
      { x: 800, y: 400 },
    ]) {
      const world = screenToWorld(camera, point.x, point.y);
      const screen = worldToScreen(camera, world.x, world.y);
      expect(screen.x).toBeCloseTo(point.x, 6);
      expect(screen.y).toBeCloseTo(point.y, 6);
    }
  });

  it("puts the camera centre at the middle of the viewport", () => {
    const camera = testCamera();
    centerOn(camera, 20, 30);
    const screen = worldToScreen(camera, 20, 30);
    expect(screen.x).toBeCloseTo(400, 6);
    expect(screen.y).toBeCloseTo(200, 6);
  });
});

describe("zoom", () => {
  it("keeps the world point under the anchor pinned", () => {
    const camera = testCamera();
    centerOn(camera, 32, 32);
    const anchor = { x: 610, y: 90 };
    const before = screenToWorld(camera, anchor.x, anchor.y);

    zoomAt(camera, 1.8, anchor.x, anchor.y);

    const after = screenToWorld(camera, anchor.x, anchor.y);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
  });

  it("stops zooming out once the map fills the viewport", () => {
    const camera = testCamera();
    for (let i = 0; i < 50; i++) zoomAt(camera, 0.5, 400, 200);

    const visibleX = camera.viewportWidth / camera.tileSize;
    const visibleY = camera.viewportHeight / camera.tileSize;

    // The whole map is on screen...
    expect(visibleX).toBeGreaterThanOrEqual(camera.mapWidth * 0.999);
    expect(visibleY).toBeGreaterThanOrEqual(camera.mapHeight * 0.999);

    // ...and it still fills at least one axis, so it never shrinks to a speck
    // adrift in background. On a wide viewport the map is letterboxed
    // horizontally, which is why only the tighter axis has to hug the edge.
    const tightestAxis = Math.min(visibleX / camera.mapWidth, visibleY / camera.mapHeight);
    expect(tightestAxis).toBeLessThanOrEqual(1.001);
  });

  it("stops zooming in at a sane tile size", () => {
    const camera = testCamera();
    for (let i = 0; i < 50; i++) zoomAt(camera, 2, 400, 200);
    expect(camera.tileSize).toBeLessThanOrEqual(72);
  });
});

describe("clamping", () => {
  it("keeps the viewport inside the map when panning far away", () => {
    const camera = testCamera();
    camera.tileSize = 24;
    centerOn(camera, -500, 9000);
    clampCamera(camera);

    const topLeft = screenToWorld(camera, 0, 0);
    const bottomRight = screenToWorld(camera, camera.viewportWidth, camera.viewportHeight);

    expect(topLeft.x).toBeGreaterThanOrEqual(-0.001);
    expect(topLeft.y).toBeGreaterThanOrEqual(-0.001);
    expect(bottomRight.x).toBeLessThanOrEqual(camera.mapWidth + 0.001);
    expect(bottomRight.y).toBeLessThanOrEqual(camera.mapHeight + 0.001);
  });

  it("centres a map narrower than the viewport instead of pinning it to a corner", () => {
    const camera = createCamera(8, 8);
    resizeCamera(camera, 800, 400);
    camera.tileSize = 10; // 8 tiles = 80px, far narrower than the 800px viewport
    centerOn(camera, 0, 0);

    expect(camera.centerX).toBeCloseTo(4, 6);
    expect(camera.centerY).toBeCloseTo(4, 6);
  });
});

describe("visible bounds", () => {
  it("never reports tiles outside the map", () => {
    const camera = testCamera();
    centerOn(camera, 0, 0);
    const bounds = visibleTileBounds(camera);

    expect(bounds.minX).toBeGreaterThanOrEqual(0);
    expect(bounds.minY).toBeGreaterThanOrEqual(0);
    expect(bounds.maxX).toBeLessThan(camera.mapWidth);
    expect(bounds.maxY).toBeLessThan(camera.mapHeight);
  });

  it("covers every tile the player can actually see", () => {
    const camera = testCamera();
    camera.tileSize = 24;
    centerOn(camera, 32, 32);
    const bounds = visibleTileBounds(camera);

    const topLeft = screenToWorld(camera, 0, 0);
    const bottomRight = screenToWorld(camera, camera.viewportWidth, camera.viewportHeight);

    expect(bounds.minX).toBeLessThanOrEqual(Math.floor(topLeft.x));
    expect(bounds.minY).toBeLessThanOrEqual(Math.floor(topLeft.y));
    expect(bounds.maxX).toBeGreaterThanOrEqual(Math.min(camera.mapWidth - 1, Math.floor(bottomRight.x)));
    expect(bounds.maxY).toBeGreaterThanOrEqual(Math.min(camera.mapHeight - 1, Math.floor(bottomRight.y)));
  });
});
