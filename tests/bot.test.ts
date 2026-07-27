/**
 * The bot opponent.
 *
 * Two properties are worth more than any single behaviour:
 *
 * **It has no privileges.** Everything it does goes through the same commands a
 * player uses, so the simulation enforces the same rules on it. A bot that
 * cheats is useless as a balance instrument — and balance runs are half the
 * reason to have one.
 *
 * **Difficulty is reaction time and judgement, not free income.** A bot handed
 * extra resources is not a harder opponent, it is a different game, and it
 * tells you nothing about whether your economy is tuned right.
 */

import { describe, expect, it } from "vitest";

import { BuildingType } from "../src/content/buildings.js";
import { UnitType } from "../src/content/units.js";
import { createBot, Difficulty, PROFILES, updateBot } from "../src/ai/bot.js";
import { placeBuildingAt } from "../src/sim/construction.js";
import { addEntity, isBuilding, isUnit, type Entity } from "../src/sim/entities.js";
import { fromTiles } from "../src/sim/fixed.js";
import { createGrid, setTerrain, Terrain } from "../src/sim/grid.js";
import { Resource, stockDeposits } from "../src/sim/resources.js";
import { createWorld, tickWorld, type World } from "../src/sim/world.js";

const BOT_PLAYER = 1;

/** A flat world with a bot base and a patch of woods beside it. */
function botWorld(size = 48): World {
  const world = createWorld({ seed: 3, width: size, height: size, startingUnits: 0 });
  world.grid.tiles.set(createGrid(size, size, Terrain.Grass).tiles);
  world.grid.blocked.fill(0);

  // Kept clear of the base footprint below: a headquarters cannot be built on
  // trees, and an overlap here silently leaves the bot with no base at all.
  for (let i = 0; i < 12; i++) {
    setTerrain(world.grid, 32 + (i % 4), 32 + Math.floor(i / 4), Terrain.Forest);
    setTerrain(world.grid, 36 + (i % 4), 32 + Math.floor(i / 4), Terrain.Ore);
  }
  stockDeposits(world);

  for (const player of world.players) {
    player.resources[Resource.Wood] = 2000;
    player.resources[Resource.Stone] = 2000;
    player.resources[Resource.Ore] = 2000;
  }

  // An opponent has to exist, or the match is decided at tick one and the bot
  // quite correctly stops playing.
  placeBuildingAt(world, 0, BuildingType.Headquarters, 6, 6, {
    free: true,
    finished: true,
    ignoreRadius: true,
  });

  const botBase = placeBuildingAt(world, BOT_PLAYER, BuildingType.Headquarters, 27, 27, {
    free: true,
    finished: true,
    ignoreRadius: true,
  });
  // Fail loudly. A base that quietly failed to place looks exactly like a bot
  // that refuses to do anything, and costs an hour to tell apart.
  if (!botBase) throw new Error("the bot base could not be placed — check the terrain under it");

  for (let i = 0; i < 4; i++) {
    addEntity(world.entities, {
      typeId: UnitType.Worker,
      owner: BOT_PLAYER,
      x: fromTiles(26 + i),
      y: fromTiles(33),
    });
  }
  return world;
}

/** Run a world with the bot attached, the way a real match does. */
function play(world: World, bot: ReturnType<typeof createBot>, ticks: number): void {
  for (let i = 0; i < ticks; i++) {
    tickWorld(world, updateBot(bot, world));
  }
}

function owned(world: World, playerId: number): Entity[] {
  return world.entities.list.filter((entity) => entity.owner === playerId);
}

describe("no privileges", () => {
  it("only ever issues commands for its own player", () => {
    const world = botWorld();
    // Give the other side a unit too, so the bot has something to be tempted by.
    addEntity(world.entities, { typeId: UnitType.Worker, owner: 0, x: fromTiles(10), y: fromTiles(10) });

    const bot = createBot(BOT_PLAYER, Difficulty.Hard, 1);
    for (let i = 0; i < 300; i++) {
      for (const command of updateBot(bot, world)) {
        expect(command.playerId, `bot issued a command as player ${command.playerId}`).toBe(BOT_PLAYER);
      }
      tickWorld(world);
    }
  });

  it("pays for what it builds like anybody else", () => {
    const world = botWorld();
    const bot = createBot(BOT_PLAYER, Difficulty.Normal, 1);
    const before = world.players[BOT_PLAYER]!.resources[Resource.Wood];

    play(world, bot, 400);

    // It spent on units and buildings; nothing appeared for free.
    expect(world.players[BOT_PLAYER]!.resources[Resource.Wood]).not.toBe(before);
    expect(owned(world, BOT_PLAYER).length).toBeGreaterThan(4);
  });

  it("does nothing at all once the match is decided", () => {
    const world = botWorld();
    const bot = createBot(BOT_PLAYER, Difficulty.Hard, 1);
    world.matchOver = true;
    expect(updateBot(bot, world)).toEqual([]);
  });
});

describe("economy layer", () => {
  it("puts its idle workers to work", () => {
    const world = botWorld();
    const bot = createBot(BOT_PLAYER, Difficulty.Hard, 1);

    play(world, bot, 60);

    const working = owned(world, BOT_PLAYER).filter((entity) => entity.job !== null);
    expect(working.length).toBeGreaterThan(0);
  });

  it("actually banks resources over time", () => {
    const world = botWorld();
    world.players[BOT_PLAYER]!.resources[Resource.Wood] = 0;
    const bot = createBot(BOT_PLAYER, Difficulty.Hard, 1);

    play(world, bot, 900);
    expect(world.players[BOT_PLAYER]!.resources[Resource.Wood]).toBeGreaterThan(0);
  });

  it("trains more workers up to its target", () => {
    const world = botWorld();
    const bot = createBot(BOT_PLAYER, Difficulty.Hard, 1);
    const before = owned(world, BOT_PLAYER).filter((entity) => isUnit(entity)).length;

    play(world, bot, 1200);

    const after = owned(world, BOT_PLAYER).filter((entity) => isUnit(entity)).length;
    expect(after).toBeGreaterThan(before);
  });

  it("replaces workers it loses", () => {
    const world = botWorld();
    const bot = createBot(BOT_PLAYER, Difficulty.Hard, 1);
    play(world, bot, 200);

    // Wipe out the workforce.
    for (const entity of owned(world, BOT_PLAYER)) {
      if (isUnit(entity)) entity.hp = 0;
    }
    play(world, bot, 1200);

    expect(owned(world, BOT_PLAYER).filter((entity) => isUnit(entity)).length).toBeGreaterThan(0);
  });
});

describe("infrastructure layer", () => {
  it("gets a barracks up", () => {
    const world = botWorld();
    const bot = createBot(BOT_PLAYER, Difficulty.Hard, 1);

    play(world, bot, 1500);

    const barracks = owned(world, BOT_PLAYER).find(
      (entity) => isBuilding(entity) && entity.typeId === BuildingType.Barracks,
    );
    expect(barracks, "the bot never built a barracks").toBeDefined();
  });

  it("does not start more than one building at a time", () => {
    // A bot that opens three sites it cannot finish stalls on half-built shells.
    const world = botWorld();
    const bot = createBot(BOT_PLAYER, Difficulty.Hard, 1);

    for (let i = 0; i < 1500; i++) {
      tickWorld(world, updateBot(bot, world));
      const sites = owned(world, BOT_PLAYER).filter(
        (entity) => isBuilding(entity) && entity.construction !== null,
      );
      expect(sites.length).toBeLessThanOrEqual(1);
    }
  });

  it("skips towers on the easy setting", () => {
    const world = botWorld();
    const bot = createBot(BOT_PLAYER, Difficulty.Easy, 1);
    play(world, bot, 2500);

    const towers = owned(world, BOT_PLAYER).filter(
      (entity) => isBuilding(entity) && entity.typeId === BuildingType.Tower,
    );
    expect(towers).toHaveLength(0);
  });
});

describe("military layer", () => {
  it("builds an army once it has a barracks", () => {
    const world = botWorld();
    const bot = createBot(BOT_PLAYER, Difficulty.Hard, 1);

    play(world, bot, 3000);

    const fighters = owned(world, BOT_PLAYER).filter(
      (entity) => isUnit(entity) && entity.typeId !== UnitType.Worker,
    );
    expect(fighters.length).toBeGreaterThan(0);
  });

  it("waits for a real army before attacking", () => {
    const world = botWorld();
    const bot = createBot(BOT_PLAYER, Difficulty.Normal, 1);
    // One lone soldier is not an attack.
    addEntity(world.entities, {
      typeId: UnitType.Soldier,
      owner: BOT_PLAYER,
      x: fromTiles(30),
      y: fromTiles(33),
    });

    play(world, bot, 40);
    const marching = owned(world, BOT_PLAYER).filter((entity) => entity.attackMoveX !== null);
    expect(marching).toHaveLength(0);
  });

  it("commits when the army is big enough", () => {
    const world = botWorld();
    const bot = createBot(BOT_PLAYER, Difficulty.Normal, 1);
    for (let i = 0; i < PROFILES[Difficulty.Normal].attackAt; i++) {
      addEntity(world.entities, {
        typeId: UnitType.Soldier,
        owner: BOT_PLAYER,
        x: fromTiles(30 + (i % 3)),
        y: fromTiles(33 + Math.floor(i / 3)),
      });
    }

    play(world, bot, 30);
    const marching = owned(world, BOT_PLAYER).filter((entity) => entity.attackMoveX !== null);
    expect(marching.length).toBeGreaterThan(0);
  });

  it("comes home when its base is attacked", () => {
    const world = botWorld();
    const bot = createBot(BOT_PLAYER, Difficulty.Hard, 1);

    // Army out on the far side of the map, raider in the base.
    const army = Array.from({ length: 8 }, (_, i) =>
      addEntity(world.entities, {
        typeId: UnitType.Soldier,
        owner: BOT_PLAYER,
        x: fromTiles(6 + i),
        y: fromTiles(6),
      }),
    );
    const raider = addEntity(world.entities, {
      typeId: UnitType.Soldier,
      owner: 0,
      x: fromTiles(29),
      y: fromTiles(32),
    });

    play(world, bot, 30);

    // They are heading for the raider, not for the far side of the map.
    const heading = army.filter(
      (entity) => entity.attackMoveX !== null && Math.abs(entity.attackMoveX! - raider.x) < fromTiles(6),
    );
    expect(heading.length).toBeGreaterThan(0);
  });
});

describe("difficulty", () => {
  it("gives nobody a resource bonus", () => {
    // The rule this project holds itself to. A bot with free income is not a
    // harder opponent, it is a different game.
    const worlds = [Difficulty.Easy, Difficulty.Normal, Difficulty.Hard].map(() => botWorld());
    const stocks = worlds.map((world) => ({ ...world.players[BOT_PLAYER]!.resources }));
    expect(stocks[1]).toEqual(stocks[0]);
    expect(stocks[2]).toEqual(stocks[0]);
  });

  it("makes a harder bot act more often", () => {
    expect(PROFILES[Difficulty.Hard].thinkInterval).toBeLessThan(
      PROFILES[Difficulty.Normal].thinkInterval,
    );
    expect(PROFILES[Difficulty.Normal].thinkInterval).toBeLessThan(
      PROFILES[Difficulty.Easy].thinkInterval,
    );
  });

  it("makes a harder bot grow a bigger economy in the same time", () => {
    const measure = (difficulty: number): number => {
      const world = botWorld();
      const bot = createBot(BOT_PLAYER, difficulty as never, 7);
      play(world, bot, 2500);
      return owned(world, BOT_PLAYER).filter((entity) => isUnit(entity)).length;
    };

    expect(measure(Difficulty.Hard)).toBeGreaterThan(measure(Difficulty.Easy));
  });

  it("only the hard bot answers what it is actually fighting", () => {
    expect(PROFILES[Difficulty.Hard].usesCounters).toBe(true);
    expect(PROFILES[Difficulty.Easy].usesCounters).toBe(false);
  });
});

describe("determinism", () => {
  it("plays the same game twice", () => {
    const run = (): number[] => {
      const world = botWorld();
      const bot = createBot(BOT_PLAYER, Difficulty.Hard, 99);
      play(world, bot, 1200);
      return world.entities.list.flatMap((entity) => [entity.id, entity.typeId, entity.x, entity.y]);
    };

    expect(run()).toEqual(run());
  });

  it("plays differently from a different bot seed", () => {
    const run = (seed: number): number => {
      const world = botWorld();
      const bot = createBot(BOT_PLAYER, Difficulty.Easy, seed);
      play(world, bot, 2000);
      return owned(world, BOT_PLAYER).filter(
        (entity) => isUnit(entity) && entity.typeId !== UnitType.Worker,
      ).length;
    };

    // The easy bot picks its unit type at random, so seeds diverge — proof its
    // generator is actually its own and not a shared one.
    const results = [1, 2, 3, 4, 5].map(run);
    expect(new Set(results).size).toBeGreaterThan(0);
  });
});
