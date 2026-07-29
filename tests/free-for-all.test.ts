/**
 * Three, four sides on one map, everybody against everybody.
 *
 * The simulation was written for two from the first commit, and almost all of
 * it turns out to be indifferent to the number — ownership checks do not care
 * how many owners there are. What is *not* indifferent is the opening: four
 * bases have to fit on a map sized for two, far enough apart that the match is
 * not decided in the first thirty seconds, and all on ground that connects.
 *
 * That is what these test. A fourth base wedged into a corner, or two of the
 * four sealed off behind a lake, is a broken match that no existing test would
 * notice — every two-player test still passes, because two is still fine.
 */

import { describe, expect, it } from "vitest";

import { BIOME_LIST } from "../src/content/biomes.js";
import { createBot, Difficulty, updateBot } from "../src/ai/bot.js";
import { opponentCommands } from "../src/ai/opponents.js";
import { BuildingType } from "../src/content/buildings.js";
import { isBuilding, isUnit, type Entity } from "../src/sim/entities.js";
import { dist, ONE, toTiles } from "../src/sim/fixed.js";
import { computeFlowField, isReachable } from "../src/sim/pathing.js";
import { statsFor } from "../src/sim/stats.js";
import { isDefeated } from "../src/sim/victory.js";
import {
  createWorld,
  floorSeparationTiles,
  MAX_PLAYERS,
  tickWorld,
  TICKS_PER_SECOND,
  type World,
} from "../src/sim/world.js";
import { MAP_SIZES } from "../src/ui/match-settings.js";

const SEEDS = [1, 2, 3, 4, 5, 6];
const COUNTS = [2, 3, 4];

function headquartersOf(world: World, playerId: number): Entity | undefined {
  return world.entities.list.find(
    (entity) =>
      isBuilding(entity) && entity.typeId === BuildingType.Headquarters && entity.owner === playerId,
  );
}

function unitsOf(world: World, playerId: number): Entity[] {
  return world.entities.list.filter((entity) => isUnit(entity) && entity.owner === playerId);
}

function standsOn(world: World, unit: Entity): { x: number; y: number } {
  return { x: Math.floor(toTiles(unit.x)), y: Math.floor(toTiles(unit.y)) };
}

describe("the world takes a player count", () => {
  it.each(COUNTS)("gives %i sides their own books and their own fog", (playerCount) => {
    const world = createWorld({ seed: 1, width: 64, height: 64, playerCount });

    expect(world.players).toHaveLength(playerCount);
    expect(world.stats).toHaveLength(playerCount);
    expect(world.vision).toHaveLength(playerCount);
    // Identical opening stock. With three opponents an uneven start would make
    // the result unreadable — you could never tell skill from the handout.
    for (const player of world.players) {
      expect(player.resources).toEqual(world.players[0]!.resources);
    }
  });

  it("refuses to seat more sides than the map has anchors for", () => {
    // A hand-edited link or an old save can ask for anything.
    const world = createWorld({ seed: 1, width: 64, height: 64, playerCount: 9 });
    expect(world.players).toHaveLength(MAX_PLAYERS);
  });

  it("refuses to run a match with fewer than two sides", () => {
    const world = createWorld({ seed: 1, width: 64, height: 64, playerCount: 1 });
    expect(world.players).toHaveLength(2);
  });
});

describe("four bases still fit", () => {
  for (const playerCount of COUNTS) {
    it.each(SEEDS)(`seats ${playerCount} sides on seed %i, on every map size`, (seed) => {
      for (const size of MAP_SIZES) {
        const world = createWorld({ seed, width: size.tiles, height: size.tiles, playerCount });

        for (const player of world.players) {
          expect(
            headquartersOf(world, player.id),
            `${playerCount} sides, ${size.tiles} tiles, seed ${seed}: player ${player.id} got no base`,
          ).toBeDefined();
          expect(unitsOf(world, player.id).length).toBeGreaterThan(0);
        }
      }
    });
  }

  it.each(SEEDS)("keeps every pair of bases out of each other's yard on seed %i", (seed) => {
    const world = createWorld({ seed, width: 64, height: 64, playerCount: 4 });
    const bases = world.players.map((player) => headquartersOf(world, player.id)!);

    for (let a = 0; a < bases.length; a++) {
      for (let b = a + 1; b < bases.length; b++) {
        const apart = dist(bases[a]!.x, bases[a]!.y, bases[b]!.x, bases[b]!.y) / ONE;
        // Against the rule the generator promises, not against a number typed
        // here as well — a bar maintained in two places stops meaning anything.
        expect(
          apart,
          `bases ${a} and ${b} are ${apart.toFixed(1)} tiles apart`,
        ).toBeGreaterThanOrEqual(floorSeparationTiles(4));
      }
    }
  });

  it.each(BIOME_LIST)("connects all four openings on biome %i", (biome) => {
    // Two sides sealed off behind a lake is twenty minutes of economies humming
    // and no match — and with four sides there are six pairs to get wrong.
    for (const seed of SEEDS) {
      const world = createWorld({ seed, width: 64, height: 64, playerCount: 4, biome });
      const from = standsOn(world, unitsOf(world, 0)[0]!);
      const field = computeFlowField(world.grid, from.x, from.y);

      for (const player of world.players) {
        const target = standsOn(world, unitsOf(world, player.id)[0]!);
        expect(
          isReachable(field, target.x, target.y),
          `biome ${biome}, seed ${seed}: player ${player.id} is on separate ground`,
        ).toBe(true);
      }
    }
  });
});

describe("everybody against everybody", () => {
  it("leaves the match undecided while three of four are still standing", () => {
    const world = createWorld({ seed: 2, width: 64, height: 64, playerCount: 4 });

    // Wipe one side out entirely.
    for (const entity of world.entities.list) {
      if (entity.owner === 3) entity.hp = -999;
    }
    tickWorld(world);

    expect(isDefeated(world, 3)).toBe(true);
    expect(world.matchOver, "the match ended when only one of four was out").toBe(false);
  });

  it("declares the last side standing the winner", () => {
    const world = createWorld({ seed: 2, width: 64, height: 64, playerCount: 4 });

    for (const entity of world.entities.list) {
      if (entity.owner !== 1) entity.hp = -999;
    }
    tickWorld(world);

    expect(world.matchOver).toBe(true);
    expect(world.winner).toBe(1);
  });

  it("makes every side an enemy of every other", () => {
    // The bots must fight each other, not gang up on the human by accident of
    // how targeting was written. Two bots left alone have to come to blows.
    const world = createWorld({ seed: 3, width: 64, height: 64, playerCount: 3 });
    const bots = [1, 2].map((id) => createBot(id, Difficulty.Normal, 5 + id));

    for (let i = 0; i < TICKS_PER_SECOND * 60 * 8 && !world.matchOver; i++) {
      tickWorld(world, bots.flatMap((bot) => updateBot(bot, world)));
    }

    const botLosses = statsFor(world, 1).unitsLost + statsFor(world, 2).unitsLost;
    expect(botLosses, "the two bots never touched each other").toBeGreaterThan(0);
  });
});

describe("a full free-for-all runs", () => {
  it.each([3, 4])("plays %i sides for ten minutes without falling over", (playerCount) => {
    const world = createWorld({ seed: 11, width: 64, height: 64, playerCount });
    const bots = Array.from({ length: playerCount - 1 }, (_, i) =>
      createBot(i + 1, Difficulty.Normal, 20 + i),
    );

    for (let i = 0; i < TICKS_PER_SECOND * 60 * 10 && !world.matchOver; i++) {
      tickWorld(world, opponentCommands(bots, world));
    }

    // Each bot has to have done something of its own. Three opponents that all
    // sit still is a match with one player in it.
    for (const bot of bots) {
      expect(
        statsFor(world, bot.playerId).buildingsBuilt + statsFor(world, bot.playerId).unitsTrained,
        `player ${bot.playerId} never built or trained anything`,
      ).toBeGreaterThan(0);
    }
  });
});
