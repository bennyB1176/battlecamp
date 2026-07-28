/**
 * Bots and the fog.
 *
 * The point of fog is that both sides are guessing. An opponent that reads the
 * true state of the map while the player reads a lit patch of it is not a
 * harder opponent — it is a different game, and it also stops being any use as
 * a balance instrument, because no human could ever have played that way.
 *
 * So the honest settings only act on what their own units can see. The hardest
 * one is allowed to look through the fog, and that is the *only* thing it is
 * allowed to cheat at: no free resources, no faster building.
 *
 * The awkward consequence is that an honest bot which has never seen anything
 * still has to attack somewhere, or it stockpiles an army forever and a match
 * against Leicht never ends. It marches at the far side of the map — the same
 * inference a human draws from a symmetric layout, not a peek at the truth.
 */

import { describe, expect, it } from "vitest";

import { BuildingType } from "../src/content/buildings.js";
import { UnitType } from "../src/content/units.js";
import { createBot, Difficulty, PROFILES, updateBot } from "../src/ai/bot.js";
import { placeBuildingAt } from "../src/sim/construction.js";
import { addEntity, type Entity } from "../src/sim/entities.js";
import { fromTiles, toTiles } from "../src/sim/fixed.js";
import { createGrid, Terrain } from "../src/sim/grid.js";
import { Resource } from "../src/sim/resources.js";
import { createWorld, tickWorld, type World } from "../src/sim/world.js";

const BOT = 1;
const HUMAN = 0;

function arena(size = 48): World {
  const world = createWorld({ seed: 12, width: size, height: size, startingUnits: 0 });
  world.grid.tiles.set(createGrid(size, size, Terrain.Grass).tiles);
  world.grid.blocked.fill(0);
  world.deposits.fill(0);
  for (const player of world.players) {
    player.resources[Resource.Wood] = 5000;
    player.resources[Resource.Stone] = 5000;
    player.resources[Resource.Ore] = 5000;
  }
  return world;
}

function army(world: World, owner: number, count: number, tileX: number, tileY: number): Entity[] {
  return Array.from({ length: count }, (_, i) =>
    addEntity(world.entities, {
      typeId: UnitType.Soldier,
      owner,
      x: fromTiles(tileX + (i % 4)),
      y: fromTiles(tileY + Math.floor(i / 4)),
    }),
  );
}

/** Run the bot until it issues an attack-move, and report where it aimed. */
function firstAttackTarget(
  world: World,
  difficulty: 0 | 1 | 2,
  ticks = 400,
): { tileX: number; tileY: number } | null {
  const bot = createBot(BOT, difficulty, 99);
  // These arenas are built by hand after the world exists, so nothing has been
  // looked at yet. One tick lets the world notice what is standing on it — in
  // a real match the sim has been running the whole time.
  tickWorld(world);

  for (let i = 0; i < ticks; i++) {
    const commands = updateBot(bot, world);
    for (const command of commands) {
      if (command.type === "attack-move") {
        return { tileX: toTiles(command.targetX), tileY: toTiles(command.targetY) };
      }
    }
    tickWorld(world, commands);
  }
  return null;
}

describe("the difficulty profiles", () => {
  it("keeps the two lower settings honest about the fog", () => {
    expect(PROFILES[Difficulty.Easy].seesThroughFog).toBe(false);
    expect(PROFILES[Difficulty.Normal].seesThroughFog).toBe(false);
  });

  it("lets only the hardest setting look through it", () => {
    expect(PROFILES[Difficulty.Hard].seesThroughFog).toBe(true);
  });
});

describe("an honest bot with nothing in sight", () => {
  it("does not walk straight to a base it has never seen", () => {
    const world = arena();
    placeBuildingAt(world, BOT, BuildingType.Headquarters, 4, 4, {
      free: true,
      finished: true,
      ignoreRadius: true,
    });
    // Far away, and deliberately nowhere near the mirrored corner the bot will
    // guess at — so walking to it is proof of reading the fog, not of guessing.
    placeBuildingAt(world, HUMAN, BuildingType.Headquarters, 4, 40, {
      free: true,
      finished: true,
      ignoreRadius: true,
    });
    army(world, BOT, 16, 6, 8);

    const aim = firstAttackTarget(world, Difficulty.Easy);
    expect(aim, "the honest bot never attacked at all").not.toBeNull();

    const distanceToSecret = Math.hypot(aim!.tileX - 5, aim!.tileY - 41);
    expect(distanceToSecret, "it marched onto a base it could not see").toBeGreaterThan(8);
  });

  it("still commits to an attack rather than stockpiling forever", () => {
    const world = arena();
    placeBuildingAt(world, BOT, BuildingType.Headquarters, 4, 4, {
      free: true,
      finished: true,
      ignoreRadius: true,
    });
    placeBuildingAt(world, HUMAN, BuildingType.Headquarters, 40, 40, {
      free: true,
      finished: true,
      ignoreRadius: true,
    });
    army(world, BOT, 16, 6, 8);

    const aim = firstAttackTarget(world, Difficulty.Easy);
    expect(aim).not.toBeNull();
    // Away from home, which is the only thing a blind march can promise.
    expect(Math.hypot(aim!.tileX - 5, aim!.tileY - 5)).toBeGreaterThan(12);
  });
});

describe("an honest bot that can see something", () => {
  it("attacks what its own units have spotted", () => {
    const world = arena();
    placeBuildingAt(world, BOT, BuildingType.Headquarters, 4, 4, {
      free: true,
      finished: true,
      ignoreRadius: true,
    });
    const seen = placeBuildingAt(world, HUMAN, BuildingType.Depot, 12, 6, {
      free: true,
      finished: true,
      ignoreRadius: true,
    })!;
    // Standing right beside it, so it is lit from the first tick.
    army(world, BOT, 16, 10, 6);

    const aim = firstAttackTarget(world, Difficulty.Easy);
    expect(aim).not.toBeNull();
    expect(Math.hypot(aim!.tileX - toTiles(seen.x), aim!.tileY - toTiles(seen.y))).toBeLessThan(4);
  });
});

describe("the hardest setting", () => {
  it("goes straight for a base it has never laid eyes on", () => {
    // The one sanctioned cheat, and it has to actually be worth something.
    const world = arena();
    placeBuildingAt(world, BOT, BuildingType.Headquarters, 4, 4, {
      free: true,
      finished: true,
      ignoreRadius: true,
    });
    const hidden = placeBuildingAt(world, HUMAN, BuildingType.Headquarters, 4, 40, {
      free: true,
      finished: true,
      ignoreRadius: true,
    })!;
    army(world, BOT, 24, 6, 8);

    const aim = firstAttackTarget(world, Difficulty.Hard);
    expect(aim).not.toBeNull();
    expect(Math.hypot(aim!.tileX - toTiles(hidden.x), aim!.tileY - toTiles(hidden.y))).toBeLessThan(4);
  });
});
