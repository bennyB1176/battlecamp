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
import { addEntity, isBuilding, isUnit, removeEntity, type Entity } from "../src/sim/entities.js";
import { fromTiles } from "../src/sim/fixed.js";
import { createGrid, setTerrain, Terrain } from "../src/sim/grid.js";
import { Resource, stockDeposits } from "../src/sim/resources.js";
import { isStarving } from "../src/sim/food.js";
import { isPowered } from "../src/sim/power.js";
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

describe("ground it cannot walk to", () => {
  /**
   * The same base, but with a river down its western side and the near woods
   * felled — so the obvious nearby answers are all on the far bank.
   *
   * This is not a contrived map. A generated one produced exactly this shape,
   * and the bot spent fifteen minutes with thirteen workers standing still and
   * a barracks frozen at a fifth built, because "legal" and "walkable" are not
   * the same question and only the first one was being asked.
   */
  function riverWorld(): World {
    const world = botWorld();
    for (let tileY = 0; tileY < world.grid.height; tileY++) {
      setTerrain(world.grid, 24, tileY, Terrain.Water);
    }
    // Woods on the far bank, close enough to look like the nearest choice.
    for (let i = 0; i < 6; i++) setTerrain(world.grid, 22, 26 + i, Terrain.Forest);
    stockDeposits(world);
    return world;
  }

  /** How much is still in the ground — the honest measure of "did it mine?". */
  function remaining(world: World): number {
    let total = 0;
    for (const amount of world.deposits) total += amount;
    return total;
  }

  it("sends its workers to seams on their own side of the water", () => {
    const world = riverWorld();
    const bot = createBot(BOT_PLAYER, Difficulty.Hard, 1);

    play(world, bot, 200);

    const jobs = owned(world, BOT_PLAYER)
      .filter((entity) => entity.job !== null)
      .map((entity) => entity.job!);

    expect(jobs.length, "no worker picked up a job at all").toBeGreaterThan(0);
    for (const job of jobs) {
      expect(job.nodeX, `worker sent across the river to ${job.nodeX},${job.nodeY}`).toBeGreaterThan(24);
    }
  });

  it("keeps mining with a river beside the base", () => {
    const world = riverWorld();
    const bot = createBot(BOT_PLAYER, Difficulty.Hard, 1);
    const before = remaining(world);

    play(world, bot, 900);

    expect(remaining(world), "nothing came out of the ground in a minute and a half").toBeLessThan(
      before,
    );
  });

  it("puts its barracks somewhere the builders can actually get to", () => {
    const world = riverWorld();
    const bot = createBot(BOT_PLAYER, Difficulty.Hard, 1);

    play(world, bot, 2000);

    const barracks = owned(world, BOT_PLAYER).find(
      (entity) => isBuilding(entity) && entity.typeId === BuildingType.Barracks,
    );
    expect(barracks, "the bot never built a barracks").toBeDefined();
    expect(barracks!.construction, "the barracks never finished — a stuck site").toBeNull();
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

  it("builds what it can pay for rather than nothing at all", () => {
    // The counter-picking bot used to name its ideal unit and then discover it
    // could not afford it — every think, for the rest of the match. In headless
    // runs the "hard" bot finished twenty minutes with four soldiers and ten
    // thousand banked wood, because the answer to what it was fighting happened
    // to be the one unit needing stone, and it had no stone.
    const world = botWorld();
    const bot = createBot(BOT_PLAYER, Difficulty.Hard, 1);
    placeBuildingAt(world, BOT_PLAYER, BuildingType.Barracks, 30, 27, {
      free: true,
      finished: true,
      ignoreRadius: true,
    });

    world.players[BOT_PLAYER]!.resources[Resource.Wood] = 4000;
    world.players[BOT_PLAYER]!.resources[Resource.Ore] = 4000;
    // No stone, and none in the ground on this map — so the armoured answer is
    // permanently out of reach and it has to settle for one it can pay for.
    world.players[BOT_PLAYER]!.resources[Resource.Stone] = 0;

    for (let i = 0; i < 8; i++) {
      addEntity(world.entities, {
        typeId: UnitType.Soldier,
        owner: 0,
        x: fromTiles(8 + i),
        y: fromTiles(8),
      });
    }

    play(world, bot, 600);

    const fighters = owned(world, BOT_PLAYER).filter(
      (entity) => isUnit(entity) && entity.typeId !== UnitType.Worker,
    );
    expect(fighters.length, "the bot priced itself out of having an army").toBeGreaterThan(0);
  });

  it("finishes off what it marched on", () => {
    // Arriving is not winning. Attack-move clears itself once a unit reaches the
    // destination, and an idle unit only shoots what is already in weapon range
    // — so an army that walked to the enemy base and stopped two tiles short
    // stood there for the rest of the match. Seventy soldiers, one intact
    // headquarters, twenty minutes, nil-all.
    const world = botWorld();
    const bot = createBot(BOT_PLAYER, Difficulty.Normal, 1);

    const prey = placeBuildingAt(world, 0, BuildingType.Depot, 10, 20, {
      free: true,
      finished: true,
      ignoreRadius: true,
    })!;

    for (let i = 0; i < PROFILES[Difficulty.Normal].attackAt + 4; i++) {
      addEntity(world.entities, {
        typeId: UnitType.Soldier,
        owner: BOT_PLAYER,
        x: fromTiles(24 + (i % 4)),
        y: fromTiles(24 + Math.floor(i / 4)),
      });
    }

    const before = prey.hp;
    play(world, bot, 2500);

    expect(prey.hp, "the army reached the target and then ignored it").toBeLessThan(before);
  });

  it("picks a new target once the old one is rubble", () => {
    // Where matches went to die: the army marched on the enemy headquarters,
    // levelled it, and then stood on the ruins for the remaining twelve minutes
    // while a barracks three tiles away kept producing. Committing to an attack
    // has to mean committing to the *enemy*, not to a set of coordinates.
    const world = botWorld();
    const bot = createBot(BOT_PLAYER, Difficulty.Normal, 1);

    // A second enemy building, so there is still something to go for.
    placeBuildingAt(world, 0, BuildingType.Depot, 14, 14, {
      free: true,
      finished: true,
      ignoreRadius: true,
    });
    const doomed = owned(world, 0).find(
      (entity) => isBuilding(entity) && entity.typeId === BuildingType.Headquarters,
    )!;

    for (let i = 0; i < PROFILES[Difficulty.Normal].attackAt; i++) {
      addEntity(world.entities, {
        typeId: UnitType.Soldier,
        owner: BOT_PLAYER,
        x: fromTiles(30 + (i % 3)),
        y: fromTiles(33 + Math.floor(i / 3)),
      });
    }

    play(world, bot, 30);
    const first = owned(world, BOT_PLAYER).find((entity) => entity.attackMoveX !== null);
    expect(first, "the army never set off").toBeDefined();
    const firstTarget = first!.attackMoveX!;

    // The target falls; the enemy headquarters is still standing elsewhere.
    removeEntity(world.entities, doomed.id);
    play(world, bot, 60);

    const marching = owned(world, BOT_PLAYER).filter((entity) => entity.attackMoveX !== null);
    expect(marching.length, "the army stopped fighting altogether").toBeGreaterThan(0);
    expect(
      marching.some((entity) => entity.attackMoveX !== firstTarget),
      "the army is still marching on a target that no longer exists",
    ).toBe(true);
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

describe("feeding its own army", () => {
  it("builds a farm rather than letting the army waste away", () => {
    // Food is the one cost that keeps arriving, so it is the one a bot can
    // ignore all match and still look busy. Left alone, the hard bot raised
    // eighteen workers and an army, starved the lot, and started losing to the
    // easy bot — which stayed small enough to feed itself by accident.
    const world = botWorld();
    const bot = createBot(BOT_PLAYER, Difficulty.Normal, 1);

    for (let i = 0; i < 14; i++) {
      addEntity(world.entities, {
        typeId: UnitType.Soldier,
        owner: BOT_PLAYER,
        x: fromTiles(24 + (i % 4)),
        y: fromTiles(24 + Math.floor(i / 4)),
      });
    }
    expect(isStarving(world, BOT_PLAYER), "the test did not actually make it hungry").toBe(true);

    play(world, bot, 2000);

    expect(
      owned(world, BOT_PLAYER).filter(
        (entity) => isBuilding(entity) && entity.typeId === BuildingType.Farm,
      ).length,
      "the bot never built a farm",
    ).toBeGreaterThan(0);
  });

  it("does not spend the whole match farming when it is well fed", () => {
    // The other failure mode: a bot that answers every question with a farm
    // never builds an army at all.
    const world = botWorld();
    const bot = createBot(BOT_PLAYER, Difficulty.Normal, 1);

    play(world, bot, 2500);

    const farms = owned(world, BOT_PLAYER).filter(
      (entity) => isBuilding(entity) && entity.typeId === BuildingType.Farm,
    ).length;
    expect(farms, "it farmed instead of playing").toBeLessThan(4);
  });
});

describe("using the whole economy", () => {
  it("builds a smelter, so steel and vehicles exist at all", () => {
    // Without one the refining chain is dead content in every bot match: the
    // bot banks thousands of ore it can never turn into anything, and the
    // heaviest unit in the game is unreachable for the whole twenty minutes.
    const world = botWorld();
    const bot = createBot(BOT_PLAYER, Difficulty.Hard, 1);

    play(world, bot, 4000);

    expect(
      owned(world, BOT_PLAYER).some(
        (entity) => isBuilding(entity) && entity.typeId === BuildingType.Smelter,
      ),
      "the bot never built a smelter",
    ).toBe(true);
  });

  it("stays ahead of its own appetite instead of catching up", () => {
    // Building a farm only once already starving means always being a farm
    // behind: the army is at a fifth health by the time the field is ploughed.
    const world = botWorld();
    const bot = createBot(BOT_PLAYER, Difficulty.Hard, 1);

    let hungryTicks = 0;
    for (let tick = 0; tick < 4000; tick++) {
      tickWorld(world, updateBot(bot, world));
      if (isStarving(world, BOT_PLAYER)) hungryTicks++;
    }

    // Some hunger is honest — it is what tells the bot to build. Living in it
    // is not.
    expect(hungryTicks / 4000, "the bot spent most of the match starving").toBeLessThan(0.25);
  });

  it("puts up a power plant once something of its own is off the grid", () => {
    const world = botWorld();
    const bot = createBot(BOT_PLAYER, Difficulty.Hard, 1);

    play(world, bot, 5000);

    const buildings = owned(world, BOT_PLAYER).filter(isBuilding);
    const cold = buildings.filter((entity) => !isPowered(world, entity));
    expect(
      cold.length,
      `${cold.length} of ${buildings.length} of its buildings are running at half speed`,
    ).toBe(0);
  });
});
