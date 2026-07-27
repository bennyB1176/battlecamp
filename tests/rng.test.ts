import { describe, expect, it } from "vitest";

import { cloneRng, createRng, nextChance, nextFloat, nextInt, nextRange } from "../src/sim/rng.js";

describe("seeded rng", () => {
  it("replays the same sequence from the same seed", () => {
    const a = createRng(42);
    const b = createRng(42);
    const sequenceA = Array.from({ length: 100 }, () => nextFloat(a));
    const sequenceB = Array.from({ length: 100 }, () => nextFloat(b));
    expect(sequenceB).toEqual(sequenceA);
  });

  it("diverges for different seeds", () => {
    const a = createRng(42);
    const b = createRng(43);
    expect(nextFloat(b)).not.toBe(nextFloat(a));
  });

  it("resumes identically from a cloned state", () => {
    const original = createRng(7);
    for (let i = 0; i < 10; i++) nextFloat(original);

    const clone = cloneRng(original);
    expect(nextFloat(clone)).toBe(nextFloat(original));
  });

  it("stays inside its documented ranges", () => {
    const rng = createRng(2024);
    for (let i = 0; i < 5000; i++) {
      const f = nextFloat(rng);
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThan(1);

      const n = nextInt(rng, 6);
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThan(6);

      const r = nextRange(rng, 3, 5);
      expect(r).toBeGreaterThanOrEqual(3);
      expect(r).toBeLessThanOrEqual(5);
    }
  });

  it("handles degenerate bounds without looping or throwing", () => {
    const rng = createRng(1);
    expect(nextInt(rng, 0)).toBe(0);
    expect(nextInt(rng, -5)).toBe(0);
    expect(nextRange(rng, 4, 4)).toBe(4);
    expect(nextRange(rng, 9, 2)).toBe(9);
  });

  it("respects probabilities well enough to balance with", () => {
    const rng = createRng(5);
    let hits = 0;
    const trials = 20000;
    for (let i = 0; i < trials; i++) {
      if (nextChance(rng, 0.25)) hits++;
    }
    expect(hits / trials).toBeGreaterThan(0.23);
    expect(hits / trials).toBeLessThan(0.27);
  });
});
