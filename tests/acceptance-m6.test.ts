/**
 * The M6 acceptance criterion, as an executable test.
 *
 * The milestone is fog of war, and the risk it carries is not that the fog
 * fails to draw — it is that the game quietly stops working underneath it. Two
 * opponents that can no longer find each other produce twenty minutes of two
 * economies humming and nothing else, and every unit test still passes.
 *
 * So this asks the three things that would actually be broken:
 *
 *   1. the fog really hides the opponent at the start
 *   2. scouting really pays — a scout uncovers more than a soldier
 *   3. matches between honest bots still go somewhere
 */

import { describe, expect, it } from "vitest";

import { UnitType } from "../src/content/units.js";
import { opponentCommands } from "../src/ai/opponents.js";
import { createBot, Difficulty } from "../src/ai/bot.js";
import { addEntity } from "../src/sim/entities.js";
import { fromTiles } from "../src/sim/fixed.js";
import { statsFor } from "../src/sim/stats.js";
import { isExplored, isVisible, visibleTo } from "../src/sim/vision.js";
import { createWorld, tickWorld, TICKS_PER_SECOND, type World } from "../src/sim/world.js";

const SEEDS = [1, 2, 3, 4];
const TWENTY_MINUTES = TICKS_PER_SECOND * 60 * 20;

function match(seed: number): World {
  return createWorld({ seed, width: 64, height: 64 });
}

function litTiles(world: World, playerId: number): number {
  let count = 0;
  const vision = world.vision[playerId]!;
  for (let i = 0; i < vision.explored.length; i++) count += vision.explored[i]!;
  return count;
}

describe("M6 acceptance: the fog does its job", () => {
  it("hides the opponent's base at the start of every seed", () => {
    for (const seed of SEEDS) {
      const world = match(seed);
      const theirs = world.entities.list.filter((entity) => entity.owner === 1);

      expect(theirs.length, `seed ${seed} gave player 1 nothing`).toBeGreaterThan(0);
      expect(
        theirs.some((entity) => visibleTo(world, 0, entity)),
        `seed ${seed}: the opponent was on screen from the first frame`,
      ).toBe(false);
    }
  });

  it("lights the ground a player is standing on, and only that", () => {
    const world = match(1);
    const mine = world.entities.list.find((entity) => entity.owner === 0)!;
    const home = { tileX: Math.floor(mine.x / 256), tileY: Math.floor(mine.y / 256) };

    expect(isVisible(world, 0, home.tileX, home.tileY)).toBe(true);
    // The far corner, which nobody has been anywhere near.
    expect(isExplored(world, 0, 62, 62)).toBe(false);
  });
});

describe("M6 acceptance: scouting pays", () => {
  it("uncovers more map with a scout than with a soldier", () => {
    // If it did not, the scout would be a worse soldier for the same price and
    // there would be no reason ever to build one.
    const seen = [UnitType.Scout, UnitType.Soldier].map((typeId) => {
      const world = createWorld({ seed: 6, width: 64, height: 64, startingUnits: 0 });
      const unit = addEntity(world.entities, {
        typeId,
        owner: 0,
        x: fromTiles(32),
        y: fromTiles(32),
      });
      unit.goalX = fromTiles(58);
      unit.goalY = fromTiles(32);

      for (let i = 0; i < 400; i++) tickWorld(world);
      return litTiles(world, 0);
    });

    const [scout, soldier] = seen as [number, number];
    expect(scout, "the scout revealed no more than a soldier").toBeGreaterThan(soldier);
  });
});

describe("M6 acceptance: a match under fog still goes somewhere", () => {
  for (const seed of SEEDS) {
    it(`resolves or contests seed ${seed} within twenty minutes`, () => {
      const world = match(seed);
      // Both sides honest about the fog, which is the case that could break:
      // two bots that never find each other.
      const bots = [
        createBot(0, Difficulty.Easy, seed),
        createBot(1, Difficulty.Normal, seed),
      ];

      for (let i = 0; i < TWENTY_MINUTES && !world.matchOver; i++) {
        tickWorld(world, opponentCommands(bots, world));
      }

      const damageDone = world.players.some(
        (player) => statsFor(world, player.id).unitsLost + statsFor(world, player.id).buildingsLost > 0,
      );

      // Either somebody won, or the two sides at least met — anything else means
      // they spent twenty minutes on opposite corners of the map.
      expect(
        world.matchOver || damageDone,
        `seed ${seed}: nobody ever found anybody`,
      ).toBe(true);
    });
  }

  it("still lets each side build an economy while blind", () => {
    const world = match(2);
    const bots = [createBot(0, Difficulty.Easy, 2), createBot(1, Difficulty.Normal, 2)];

    for (let i = 0; i < TICKS_PER_SECOND * 60 * 5 && !world.matchOver; i++) {
      tickWorld(world, opponentCommands(bots, world));
    }

    for (const player of world.players) {
      const stats = statsFor(world, player.id);
      expect(stats.unitsTrained, `player ${player.id} trained nothing`).toBeGreaterThan(0);
    }
  });
});
