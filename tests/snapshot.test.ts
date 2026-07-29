/**
 * Saving and restoring a match.
 *
 * The bar is not "it loads without crashing" — it is that a restored world is
 * **the same world**, and keeps being the same world as it runs on. A save that
 * drops a worker's half-finished load, or a barracks' training progress, gives
 * a player back a game that is subtly not the one they left, and no error ever
 * appears. So the tests here compare world hashes, and then keep ticking both
 * copies to see whether they stay together.
 *
 * That is exactly what the determinism core was built to make checkable, and it
 * is why a snapshot is worth having at all.
 */

import { describe, expect, it } from "vitest";

import { Biome, type BiomeId } from "../src/content/biomes.js";
import { BuildingType } from "../src/content/buildings.js";
import { UnitType } from "../src/content/units.js";
import { createBot, Difficulty, updateBot } from "../src/ai/bot.js";
import { placeBuildingAt } from "../src/sim/construction.js";
import { addEntity } from "../src/sim/entities.js";
import { fromTiles } from "../src/sim/fixed.js";
import { hashWorldHex } from "../src/sim/hash.js";
import { Resource } from "../src/sim/resources.js";
import { restoreWorld, SNAPSHOT_VERSION, snapshotWorld } from "../src/sim/snapshot.js";
import { statsFor } from "../src/sim/stats.js";
import { isExplored } from "../src/sim/vision.js";
import { createWorld, tickWorld, type World } from "../src/sim/world.js";

/** A match that has actually been played for a while, not a fresh board. */
function playedMatch(ticks = 600, biome: BiomeId = Biome.Grassland): World {
  const world = createWorld({ seed: 4242, width: 48, height: 48, biome });
  const bots = [createBot(0, Difficulty.Normal, 7), createBot(1, Difficulty.Hard, 8)];
  for (let i = 0; i < ticks; i++) {
    tickWorld(world, bots.flatMap((bot) => updateBot(bot, world)));
  }
  return world;
}

function roundTrip(world: World): World {
  return restoreWorld(JSON.parse(JSON.stringify(snapshotWorld(world))));
}

describe("a restored world is the same world", () => {
  it("matches hash for hash", () => {
    const world = playedMatch();
    expect(hashWorldHex(roundTrip(world))).toBe(hashWorldHex(world));
  });

  it("survives a trip through actual JSON text", () => {
    // localStorage stores strings, so the format has to survive being one.
    const world = playedMatch(300);
    const restored = restoreWorld(JSON.parse(JSON.stringify(snapshotWorld(world))));
    expect(hashWorldHex(restored)).toBe(hashWorldHex(world));
  });

  it("keeps running identically afterwards", () => {
    // The property that actually matters. A snapshot can look right and still
    // have dropped something the next tick needs — a cached field, a worker's
    // half-finished load — and the two copies drift apart from there.
    const world = playedMatch();
    const restored = roundTrip(world);

    for (let i = 0; i < 400; i++) {
      tickWorld(world);
      tickWorld(restored);
    }

    expect(hashWorldHex(restored)).toBe(hashWorldHex(world));
  });

  it("keeps running identically under fresh orders", () => {
    const world = playedMatch(200);
    const restored = roundTrip(world);
    const bots = () => [createBot(0, Difficulty.Normal, 7), createBot(1, Difficulty.Hard, 8)];

    const [a, b] = [bots(), bots()];
    for (let i = 0; i < 300; i++) {
      tickWorld(world, a.flatMap((bot) => updateBot(bot, world)));
      tickWorld(restored, b.flatMap((bot) => updateBot(bot, restored)));
    }

    expect(hashWorldHex(restored)).toBe(hashWorldHex(world));
  });
});

describe("what a snapshot has to carry", () => {
  it("remembers the map itself, not just its seed", () => {
    // Terrain changes as the match runs: forests are felled, buildings block
    // ground. Regenerating from the seed would hand back the opening map.
    const world = playedMatch();
    const restored = roundTrip(world);

    expect(Array.from(restored.grid.tiles)).toEqual(Array.from(world.grid.tiles));
    expect(Array.from(restored.grid.blocked)).toEqual(Array.from(world.grid.blocked));
    expect(Array.from(restored.deposits)).toEqual(Array.from(world.deposits));
  });

  it("remembers where each side has been", () => {
    const world = playedMatch();
    const restored = roundTrip(world);

    let explored = 0;
    for (let tileY = 0; tileY < world.grid.height; tileY++) {
      for (let tileX = 0; tileX < world.grid.width; tileX++) {
        if (isExplored(world, 0, tileX, tileY)) explored++;
        expect(isExplored(restored, 0, tileX, tileY)).toBe(isExplored(world, 0, tileX, tileY));
      }
    }
    expect(explored, "the test match never explored anything").toBeGreaterThan(0);
  });

  it("remembers the match tally", () => {
    const world = playedMatch();
    const restored = roundTrip(world);

    for (const player of world.players) {
      expect(statsFor(restored, player.id)).toEqual(statsFor(world, player.id));
    }
  });

  it("remembers a worker mid-trip and a barracks mid-order", () => {
    const world = createWorld({ seed: 5, width: 40, height: 40, startingUnits: 0 });
    const barracks = placeBuildingAt(world, 0, BuildingType.Barracks, 6, 6, {
      free: true,
      finished: true,
      ignoreRadius: true,
    })!;
    barracks.production!.queue.push(UnitType.Soldier);
    barracks.production!.progress = 17;
    barracks.production!.rallyX = fromTiles(12);
    barracks.production!.rallyY = fromTiles(13);

    const worker = addEntity(world.entities, {
      typeId: UnitType.Worker,
      owner: 0,
      x: fromTiles(9),
      y: fromTiles(9),
    });
    worker.job = { nodeX: 3, nodeY: 4, carrying: Resource.Wood, carried: 7, harvestTicks: 11, returning: true };

    const restored = roundTrip(world);
    const restoredBarracks = restored.entities.list.find((entity) => entity.id === barracks.id)!;
    const restoredWorker = restored.entities.list.find((entity) => entity.id === worker.id)!;

    expect(restoredBarracks.production).toEqual(barracks.production);
    expect(restoredWorker.job).toEqual(worker.job);
  });

  it("remembers which biome the map came from", () => {
    // Not used by the simulation, but the result screen and any future rematch
    // want to know what was being played.
    const world = playedMatch(60, Biome.Badlands);
    expect(snapshotWorld(world).biome).toBe(Biome.Badlands);
  });

  it("remembers a finished match as finished", () => {
    const world = createWorld({ seed: 3, width: 32, height: 32, startingUnits: 0 });
    world.matchOver = true;
    world.winner = 1;

    const restored = roundTrip(world);
    expect(restored.matchOver).toBe(true);
    expect(restored.winner).toBe(1);
  });
});

describe("refusing what it cannot read", () => {
  it("stamps a version on everything it writes", () => {
    expect(snapshotWorld(playedMatch(10)).version).toBe(SNAPSHOT_VERSION);
  });

  it("refuses a snapshot from a future or past format", () => {
    // A silently mis-read save is worse than none: the player gets a world that
    // is wrong in ways no error will ever mention.
    const snapshot = snapshotWorld(playedMatch(10));
    expect(() => restoreWorld({ ...snapshot, version: SNAPSHOT_VERSION + 1 })).toThrow();
    expect(() => restoreWorld({ ...snapshot, version: SNAPSHOT_VERSION - 1 })).toThrow();
  });

  it("refuses obvious rubbish rather than half-loading it", () => {
    expect(() => restoreWorld(null)).toThrow();
    expect(() => restoreWorld({})).toThrow();
    expect(() => restoreWorld({ version: SNAPSHOT_VERSION })).toThrow();
  });
});
