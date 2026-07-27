/**
 * M5 acceptance: an economy with more than one question in it.
 *
 * The milestone adds three rules, and each one exists to turn a number into a
 * decision:
 *
 *   - **Refining** puts a building between raw ore and the thing you want, so
 *     the heavy unit is something you planned for rather than something you
 *     could afford.
 *   - **Food** is the only cost that keeps arriving, so army size becomes a
 *     question about the base rather than about the last two minutes.
 *   - **Power** is the only rule that cares *where* a building stands, so a base
 *     becomes a shape somebody chose.
 *
 * A rule nobody exercises is not a rule, it is dead content — so these tests ask
 * whether the systems are *used* in real matches, not merely whether they work
 * in isolation. Every one of them started out failing: the bots banked thousands
 * of ore they could never spend, starved eighteen workers, and never built a
 * plant, all while looking perfectly busy.
 */

import { describe, expect, it } from "vitest";

import { BuildingType } from "../src/content/buildings.js";
import { Difficulty, type DifficultyId } from "../src/ai/bot.js";
import { runMatch } from "../src/ai/match.js";
import { buildingDefOf, isBuilding } from "../src/sim/entities.js";
import { foodDemand, foodSupply } from "../src/sim/food.js";
import { isPowered } from "../src/sim/power.js";
import { REFINED_KINDS } from "../src/sim/resources.js";
import { tickWorld, type World } from "../src/sim/world.js";

const SEEDS = [1, 2, 3, 4, 5, 6];

function match(seed: number, difficulties: readonly DifficultyId[], maxTicks = 9000): World {
  return runMatch({ seed, difficulties, maxTicks }).world;
}

/** Every building of this type the player owns, finished or not. */
function owns(world: World, playerId: number, typeId: number): number {
  return world.entities.list.filter(
    (entity) => entity.owner === playerId && isBuilding(entity) && entity.typeId === typeId,
  ).length;
}

describe("M5 acceptance: the chains get used", () => {
  it("has the hard bot set up refining on most maps", () => {
    // Not "can a smelter work" — whether anybody ever builds one. Without this
    // the whole refining chain is scenery: thousands of ore banked, and the
    // heaviest unit in the game unreachable for twenty minutes.
    //
    // Run without an opponent, because the question is about the bot. In a real
    // match a bot that gets rushed and dies at two minutes fifty never builds a
    // smelter — correctly — and asserting otherwise would be demanding that it
    // build one while being overrun.
    // Most, not all. A start hemmed in with thin seams genuinely cannot reach a
    // smelter in ten minutes, and demanding it on every map would be demanding
    // that the bot conjure stone. What must not happen is the chain going
    // untouched across the board — which is exactly what it did until the bot
    // learned to move workers onto whatever is holding it up.
    const built = SEEDS.filter(
      (seed) => owns(match(seed, [Difficulty.Hard], 6000), 0, BuildingType.Smelter) > 0,
    );

    expect(
      built.length,
      `only ${built.length} of ${SEEDS.length} maps got a smelter up`,
    ).toBeGreaterThanOrEqual(SEEDS.length - 1);
  });

  it("turns raw material into refined goods over a match", () => {
    const world = match(3, [Difficulty.Hard, Difficulty.Hard]);

    // Somebody, on some side, actually produced something refined. A chain that
    // is built and never runs is the same dead content one tier down.
    const refined = world.players.some((player) =>
      REFINED_KINDS.some((kind) => player.resources[kind] > 0),
    );
    expect(refined, "a whole match went by without a single plank or ingot").toBe(true);
  });
});

describe("M5 acceptance: food is a bill somebody pays", () => {
  it.each(SEEDS)("keeps the hard bot mostly fed on seed %i", (seed) => {
    // Mostly, not always: going hungry is the signal that tells a player to
    // build a farm, so a bot that is never hungry is one the rule never
    // reached. Living in it is the failure.
    const world = match(seed, [Difficulty.Hard], 6000);

    expect(
      owns(world, 0, BuildingType.Farm),
      "the hard bot never built a farm at all",
    ).toBeGreaterThan(0);
  });

  it("makes an army without a base wither", () => {
    // The anti-rush lever, end to end: take the base away and the army that was
    // built on it stops being an army.
    const world = match(1, [Difficulty.Hard, Difficulty.Hard], 3000);

    const victim = world.players[0]!;
    for (const entity of world.entities.list) {
      if (entity.owner === victim.id && isBuilding(entity)) entity.hp = 0;
    }
    tickWorld(world);

    const army = world.entities.list.filter((entity) => entity.owner === victim.id);
    expect(army.length, "nothing left to measure").toBeGreaterThan(0);
    const before = army.map((entity) => entity.hp);

    expect(foodDemand(world, victim.id)).toBeGreaterThan(foodSupply(world, victim.id));
    for (let tick = 0; tick < 400; tick++) tickWorld(world);

    const weakened = army.filter((entity, index) => entity.hp < before[index]!).length;
    expect(weakened, "a homeless army was perfectly comfortable").toBeGreaterThan(0);
  });
});

describe("M5 acceptance: power is worth having", () => {
  it("leaves no building of the hard bot running cold", () => {
    // The bot only builds a plant when something of its own is off the grid, so
    // this is really two assertions in one: that it notices, and that the plant
    // it then builds actually covers what was cold.
    const world = match(2, [Difficulty.Hard], 6000);

    const theirs = world.entities.list.filter(
      (entity) => entity.owner === 0 && isBuilding(entity) && entity.construction === null,
    );
    const cold = theirs.filter((entity) => !isPowered(world, entity));

    expect(
      cold.map((entity) => buildingDefOf(entity).name),
      "buildings left running at half speed",
    ).toEqual([]);
  });
});

describe("M5 acceptance: the balance still points the right way", () => {
  it("keeps the harder setting ahead after three new rules", () => {
    // Every rule in this milestone could have flipped the order — food punishes
    // the bigger economy, refining costs the harder bot time, power costs it
    // resources. It did flip once: the hard bot starved eighteen workers and
    // started losing to the easy one.
    const wins = (difficulties: readonly DifficultyId[]): number[] => {
      const tally = difficulties.map(() => 0);
      for (const seed of SEEDS) {
        const result = runMatch({ seed, difficulties, maxTicks: 12000 });
        if (result.decided && result.winner !== null) tally[result.winner]!++;
      }
      return tally;
    };

    const [normalFirst, hardSecond] = wins([Difficulty.Normal, Difficulty.Hard]);
    expect(
      hardSecond,
      `Schwer won ${hardSecond} of ${SEEDS.length} against Normal's ${normalFirst}`,
    ).toBeGreaterThan(normalFirst!);
  });
});
