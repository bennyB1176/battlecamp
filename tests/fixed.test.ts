/**
 * Fixed-point maths is load-bearing: from M1 on, every position and distance in
 * the sim goes through it, and lockstep multiplayer depends on it staying exact.
 */

import { describe, expect, it } from "vitest";

import {
  clamp,
  dist,
  distSq,
  div,
  fromTiles,
  isqrt,
  mul,
  ONE,
  tileCenter,
  toTileIndex,
  toTiles,
} from "../src/sim/fixed.js";
import { createRng, nextInt } from "../src/sim/rng.js";

describe("fixed-point conversion", () => {
  it("round-trips whole tiles exactly", () => {
    for (const tiles of [0, 1, 7, 63, 128]) {
      expect(toTiles(fromTiles(tiles))).toBe(tiles);
    }
  });

  it("maps fixed coordinates to the tile that contains them", () => {
    expect(toTileIndex(0)).toBe(0);
    expect(toTileIndex(ONE - 1)).toBe(0);
    expect(toTileIndex(ONE)).toBe(1);
    // Negative coordinates must floor, not truncate, or units would snap to the
    // wrong tile just left of the map origin.
    expect(toTileIndex(-1)).toBe(-1);
  });

  it("places tile centres half a tile in", () => {
    expect(tileCenter(0)).toBe(ONE / 2);
    expect(tileCenter(3)).toBe(3 * ONE + ONE / 2);
  });
});

describe("fixed-point arithmetic", () => {
  it("multiplies and divides consistently", () => {
    const three = fromTiles(3);
    const half = fromTiles(0.5);
    expect(mul(three, half)).toBe(fromTiles(1.5));
    expect(div(three, fromTiles(1.5))).toBe(fromTiles(2));
  });

  it("returns zero instead of throwing on division by zero", () => {
    expect(div(fromTiles(5), 0)).toBe(0);
  });

  it("clamps to the given range", () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-5, 0, 10)).toBe(0);
    expect(clamp(15, 0, 10)).toBe(10);
  });
});

describe("integer square root", () => {
  it("is exact for perfect squares", () => {
    for (let n = 0; n < 200; n++) {
      expect(isqrt(n * n)).toBe(n);
    }
  });

  it("floors for non-squares and never overshoots", () => {
    const rng = createRng(99);
    for (let i = 0; i < 2000; i++) {
      const value = nextInt(rng, 1 << 24);
      const root = isqrt(value);
      expect(root * root).toBeLessThanOrEqual(value);
      expect((root + 1) * (root + 1)).toBeGreaterThan(value);
    }
  });

  it("treats negative input as zero", () => {
    expect(isqrt(-7)).toBe(0);
  });
});

describe("distance", () => {
  it("measures axis-aligned distance exactly", () => {
    expect(dist(0, 0, fromTiles(3), 0)).toBe(fromTiles(3));
  });

  it("agrees with the squared form used for comparisons", () => {
    const d = dist(0, 0, fromTiles(3), fromTiles(4));
    expect(d).toBe(fromTiles(5));
    expect(distSq(0, 0, fromTiles(3), fromTiles(4))).toBe(fromTiles(5) * fromTiles(5));
  });
});
