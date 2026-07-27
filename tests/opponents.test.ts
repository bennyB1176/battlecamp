/**
 * Wiring the bots into a running game.
 *
 * This module exists because of a plain omission: the bot was written, tested
 * against eight seeds, tuned over five defects — and never called from
 * `main.ts`. Every test passed, the headless runner played hundreds of matches,
 * and the actual game shipped with an opponent that stood still. The gap was
 * exactly the glue below.
 *
 * So the glue gets its own module and its own tests, rather than living as a
 * few lines in the entry point where nothing can reach it.
 */

import { describe, expect, it } from "vitest";

import { Difficulty } from "../src/ai/bot.js";
import { createOpponents, difficultyFromName, opponentCommands } from "../src/ai/opponents.js";
import { isBuilding, isUnit } from "../src/sim/entities.js";
import { isWorker } from "../src/sim/economy.js";
import { createWorld, tickWorld, type World } from "../src/sim/world.js";

const LOCAL = 0;

function game(): World {
  return createWorld({ seed: 20260727, width: 64, height: 64 });
}

describe("choosing an opponent", () => {
  it("reads the German difficulty names", () => {
    expect(difficultyFromName("leicht")).toBe(Difficulty.Easy);
    expect(difficultyFromName("normal")).toBe(Difficulty.Normal);
    expect(difficultyFromName("schwer")).toBe(Difficulty.Hard);
  });

  it("is forgiving about case and stray spaces", () => {
    expect(difficultyFromName("  Schwer ")).toBe(Difficulty.Hard);
  });

  it("falls back to normal for anything else", () => {
    // A typo in a URL must not decide the match, and must not throw either.
    expect(difficultyFromName(null)).toBe(Difficulty.Normal);
    expect(difficultyFromName("")).toBe(Difficulty.Normal);
    expect(difficultyFromName("unmöglich")).toBe(Difficulty.Normal);
  });
});

describe("opponents in a live game", () => {
  it("gives every player but the local one a bot", () => {
    const world = game();
    const bots = createOpponents(world, LOCAL, Difficulty.Hard);

    expect(bots).toHaveLength(world.players.length - 1);
    expect(bots.every((bot) => bot.playerId !== LOCAL)).toBe(true);
  });

  it("never issues a command for the human", () => {
    // The property that makes this safe to call every tick: the bots drive
    // their own players and nobody else's.
    const world = game();
    const bots = createOpponents(world, LOCAL, Difficulty.Hard);

    for (let tick = 0; tick < 400; tick++) {
      const commands = opponentCommands(bots, world);
      for (const command of commands) {
        expect(command.playerId, "a bot issued a command for the human").not.toBe(LOCAL);
      }
      tickWorld(world, commands);
    }
  });

  it("actually builds something when nobody plays against it", () => {
    // The failing case reported from the phone, as a test: start a real game,
    // touch nothing, and the opponent should still raise a base and an army.
    const world = game();
    const bots = createOpponents(world, LOCAL, Difficulty.Hard);

    for (let tick = 0; tick < 3000; tick++) {
      tickWorld(world, opponentCommands(bots, world));
    }

    const theirs = world.entities.list.filter((entity) => entity.owner === 1);
    const buildings = theirs.filter(isBuilding).length;
    const fighters = theirs.filter((entity) => isUnit(entity) && !isWorker(entity)).length;
    const workers = theirs.filter(isWorker).length;

    expect(buildings, "the opponent built nothing at all").toBeGreaterThan(1);
    expect(workers, "the opponent never grew its economy").toBeGreaterThan(4);
    expect(fighters, "the opponent never made an army").toBeGreaterThan(0);
  });

  it("leaves the human's own base alone until it is attacked", () => {
    // Sanity check that the local player is genuinely inert here: nothing in
    // this module may move the human's units.
    const world = game();
    const bots = createOpponents(world, LOCAL, Difficulty.Normal);

    const mine = world.entities.list.filter((entity) => entity.owner === LOCAL);
    const before = mine.map((entity) => `${entity.id}:${entity.x},${entity.y}`);

    for (let tick = 0; tick < 60; tick++) tickWorld(world, opponentCommands(bots, world));

    const after = mine.map((entity) => `${entity.id}:${entity.x},${entity.y}`);
    expect(after).toEqual(before);
  });

  it("plays the same game twice from the same world seed", () => {
    // The bots take their seed from the world, so one number still reproduces
    // the whole match — the property replays will rest on.
    const run = (): string => {
      const world = game();
      const bots = createOpponents(world, LOCAL, Difficulty.Hard);
      for (let tick = 0; tick < 600; tick++) tickWorld(world, opponentCommands(bots, world));
      return world.entities.list.map((entity) => `${entity.typeId}@${entity.x},${entity.y}`).join("|");
    };

    expect(run()).toBe(run());
  });
});
