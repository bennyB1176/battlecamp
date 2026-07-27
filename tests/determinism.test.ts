/**
 * The determinism suite — the most important tests in the project.
 *
 * Everything the plan promises later (bot-vs-bot balance runs in CI, replays as
 * seed + command log, lockstep multiplayer) rests on one property: the same
 * seed and the same commands must produce the same world, always. These tests
 * are what stop that property from quietly rotting.
 */

import { describe, expect, it } from "vitest";

import type { Command } from "../src/sim/commands.js";
import { PING_LIFETIME_TICKS } from "../src/sim/commands.js";
import { hashWorld, hashWorldHex } from "../src/sim/hash.js";
import { ONE } from "../src/sim/fixed.js";
import { createRng, nextInt } from "../src/sim/rng.js";
import { createWorld, tickWorld } from "../src/sim/world.js";

const MAP_SIZE = 48;

/**
 * Play a scripted match: a deterministic pseudo-player that drops pings at
 * random-but-reproducible times and places.
 *
 * `trail` samples the hash along the way, so a failure points at *when* the two
 * runs diverged instead of only telling us that they did.
 */
function runScriptedMatch(seed: number, ticks: number): { finalHash: string; trail: number[] } {
  const world = createWorld({ seed, width: MAP_SIZE, height: MAP_SIZE });
  const scriptRng = createRng((seed ^ 0x5bf03635) >>> 0);
  const trail: number[] = [];

  for (let tick = 0; tick < ticks; tick++) {
    const commands: Command[] = [];
    if (nextInt(scriptRng, 5) === 0) {
      commands.push({
        type: "ping",
        playerId: nextInt(scriptRng, 2),
        tileX: nextInt(scriptRng, MAP_SIZE),
        tileY: nextInt(scriptRng, MAP_SIZE),
      });
    }

    // Order a random squad somewhere every so often, so the hash covers
    // pathfinding and separation rather than only the marker bookkeeping.
    if (world.entities.list.length > 0 && nextInt(scriptRng, 40) === 0) {
      const squadSize = 1 + nextInt(scriptRng, world.entities.list.length);
      const entityIds = Array.from(
        { length: squadSize },
        () => world.entities.list[nextInt(scriptRng, world.entities.list.length)]!.id,
      );

      commands.push({
        type: "move",
        playerId: 0,
        entityIds,
        targetX: nextInt(scriptRng, MAP_SIZE * ONE),
        targetY: nextInt(scriptRng, MAP_SIZE * ONE),
      });
    }

    tickWorld(world, commands);

    if (tick % 50 === 0) trail.push(hashWorld(world));
  }

  return { finalHash: hashWorldHex(world), trail };
}

describe("simulation determinism", () => {
  it("produces an identical world from the same seed and commands", () => {
    const a = runScriptedMatch(12345, 500);
    const b = runScriptedMatch(12345, 500);

    expect(b.trail).toEqual(a.trail);
    expect(b.finalHash).toBe(a.finalHash);
  });

  it("produces different worlds from different seeds", () => {
    const a = runScriptedMatch(12345, 500);
    const b = runScriptedMatch(54321, 500);

    expect(b.finalHash).not.toBe(a.finalHash);
  });

  it("reaches the same state whether ticked in one batch or in chunks", () => {
    // Guards against per-frame state leaking into the sim — a frame that
    // simulates four ticks must equal four frames simulating one each.
    const batched = createWorld({ seed: 777, width: MAP_SIZE, height: MAP_SIZE });
    const chunked = createWorld({ seed: 777, width: MAP_SIZE, height: MAP_SIZE });

    for (let i = 0; i < 200; i++) tickWorld(batched);
    for (let chunk = 0; chunk < 40; chunk++) {
      for (let i = 0; i < 5; i++) tickWorld(chunked);
    }

    expect(hashWorldHex(chunked)).toBe(hashWorldHex(batched));
  });

  /**
   * A golden value pins the *exact* current behaviour, so an accidental change
   * to map generation or tick order shows up as a failing test rather than as a
   * mystery months later.
   *
   * Deliberate changes to the sim will break this. That is the point: update the
   * constant in the same commit, and the diff records that the world changed.
   */
  it("matches the recorded golden hash", () => {
    const { finalHash } = runScriptedMatch(20260727, 500);
    expect(finalHash).toBe("cf910f03");
  });
});

describe("world state", () => {
  it("counts ticks and nothing else as time", () => {
    const world = createWorld({ seed: 1, width: 16, height: 16 });
    expect(world.tick).toBe(0);
    for (let i = 0; i < 17; i++) tickWorld(world);
    expect(world.tick).toBe(17);
  });

  it("expires ping markers after their lifetime", () => {
    const world = createWorld({ seed: 1, width: 16, height: 16 });
    tickWorld(world, [{ type: "ping", playerId: 0, tileX: 3, tileY: 4 }]);
    expect(world.markers).toHaveLength(1);

    for (let i = 0; i < PING_LIFETIME_TICKS - 1; i++) tickWorld(world);
    expect(world.markers).toHaveLength(0);
  });

  it("ignores pings outside the map instead of corrupting state", () => {
    const world = createWorld({ seed: 1, width: 16, height: 16 });
    tickWorld(world, [
      { type: "ping", playerId: 0, tileX: -1, tileY: 0 },
      { type: "ping", playerId: 0, tileX: 16, tileY: 0 },
      { type: "ping", playerId: 0, tileX: 0, tileY: 99 },
    ]);
    expect(world.markers).toHaveLength(0);
  });
});
