/**
 * The minimap's geometry.
 *
 * Two pure questions, and both of them are the kind that go wrong silently:
 * where a tap lands, and where the current view sits on the overview. Getting
 * the first one wrong sends the camera somewhere the player did not point at,
 * which on a phone reads as the game ignoring you.
 *
 * The drawing itself is checked in the browser, like the rest of the view code.
 */

import { describe, expect, it } from "vitest";

import { createCamera, resizeCamera } from "../src/input/camera.js";
import { minimapTileAt, minimapViewport } from "../src/render/minimap.js";

const MAP = { width: 64, height: 64 };
const SIZE = 128;

describe("where a tap lands", () => {
  it("puts the middle of the minimap at the middle of the map", () => {
    const tile = minimapTileAt(SIZE, SIZE, MAP.width, MAP.height, SIZE / 2, SIZE / 2);
    expect(tile.tileX).toBeCloseTo(32, 6);
    expect(tile.tileY).toBeCloseTo(32, 6);
  });

  it("maps the corners to the corners", () => {
    expect(minimapTileAt(SIZE, SIZE, MAP.width, MAP.height, 0, 0)).toEqual({ tileX: 0, tileY: 0 });

    const far = minimapTileAt(SIZE, SIZE, MAP.width, MAP.height, SIZE, SIZE);
    expect(far.tileX).toBeCloseTo(MAP.width, 6);
    expect(far.tileY).toBeCloseTo(MAP.height, 6);
  });

  it("keeps a sloppy tap on the map", () => {
    // Fingers overshoot the edge of a 128-pixel square constantly. Clamping
    // here means the camera still goes somewhere sensible instead of nowhere.
    const tile = minimapTileAt(SIZE, SIZE, MAP.width, MAP.height, -40, 900);
    expect(tile.tileX).toBe(0);
    expect(tile.tileY).toBe(MAP.height);
  });

  it("handles a map that is not square", () => {
    const tile = minimapTileAt(SIZE, 64, 128, 32, SIZE / 2, 32);
    expect(tile.tileX).toBeCloseTo(64, 6);
    expect(tile.tileY).toBeCloseTo(16, 6);
  });
});

describe("the viewport marker", () => {
  it("covers the middle of the minimap when the camera is centred", () => {
    const camera = createCamera(MAP.width, MAP.height);
    resizeCamera(camera, 400, 400);
    camera.tileSize = 25; // 16 tiles across, a quarter of the map
    camera.centerX = 32;
    camera.centerY = 32;

    const rect = minimapViewport(camera, SIZE, SIZE);
    expect(rect.x + rect.width / 2).toBeCloseTo(SIZE / 2, 6);
    expect(rect.y + rect.height / 2).toBeCloseTo(SIZE / 2, 6);
    expect(rect.width).toBeCloseTo(SIZE / 4, 6);
  });

  it("grows as the player zooms out", () => {
    const camera = createCamera(MAP.width, MAP.height);
    resizeCamera(camera, 400, 400);

    camera.tileSize = 40;
    const zoomedIn = minimapViewport(camera, SIZE, SIZE).width;
    camera.tileSize = 10;
    const zoomedOut = minimapViewport(camera, SIZE, SIZE).width;

    expect(zoomedOut).toBeGreaterThan(zoomedIn);
  });

  it("stays inside the minimap when the camera hangs over the map edge", () => {
    // The camera may now overscroll past the border, so the marker has to be
    // clipped or it draws outside its own box and over the map behind it.
    const camera = createCamera(MAP.width, MAP.height);
    resizeCamera(camera, 400, 400);
    camera.tileSize = 25;
    camera.centerX = 0;
    camera.centerY = MAP.height;

    const rect = minimapViewport(camera, SIZE, SIZE);
    expect(rect.x).toBeGreaterThanOrEqual(0);
    expect(rect.y).toBeGreaterThanOrEqual(0);
    expect(rect.x + rect.width).toBeLessThanOrEqual(SIZE + 0.001);
    expect(rect.y + rect.height).toBeLessThanOrEqual(SIZE + 0.001);
  });

  it("round-trips: tapping the marker's middle leaves the view where it is", () => {
    const camera = createCamera(MAP.width, MAP.height);
    resizeCamera(camera, 400, 400);
    camera.tileSize = 25;
    camera.centerX = 20;
    camera.centerY = 44;

    const rect = minimapViewport(camera, SIZE, SIZE);
    const tile = minimapTileAt(
      SIZE,
      SIZE,
      MAP.width,
      MAP.height,
      rect.x + rect.width / 2,
      rect.y + rect.height / 2,
    );

    expect(tile.tileX).toBeCloseTo(camera.centerX, 6);
    expect(tile.tileY).toBeCloseTo(camera.centerY, 6);
  });
});
