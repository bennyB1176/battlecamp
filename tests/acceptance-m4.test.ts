/**
 * M4 acceptance: bots that make a match.
 *
 * The milestone criterion, in the roadmap's own words, is "Bot vs. Bot runs
 * twenty minutes stably, and a human loses to Schwer". The second half is a
 * judgement a person makes on a phone; this file pins down everything that can
 * be checked mechanically, and the properties chosen here are the ones that
 * actually broke on the way to the milestone rather than a list of things that
 * sound thorough:
 *
 *   - **It finishes.** Every earlier defect in this milestone — a base marooned
 *     on an island, a barracks walling the map in two, an army standing on the
 *     rubble of its target, a worker sealed inside its own building — showed up
 *     the same way: a twenty-minute match ending nil-all with both economies
 *     humming. "Somebody wins" is the single most informative assertion here.
 *   - **Difficulty points the right way.** A harder setting has to actually win
 *     more, or the setting is decoration. Measured in both seats, because a
 *     result that only holds from one starting corner is a map artefact.
 *   - **Nothing degenerates.** No unit inside solid ground, no fractional
 *     positions, no negative health, over the whole twenty minutes.
 *   - **It is reproducible.** Same seed, same match, to the hash.
 *
 * These runs take a few seconds each, which is the price of testing the thing
 * itself rather than a scale model of it.
 */

import { describe, expect, it } from "vitest";

import { Difficulty, type DifficultyId } from "../src/ai/bot.js";
import { runMatch, type MatchResult } from "../src/ai/match.js";
import { isBuilding, isUnit } from "../src/sim/entities.js";
import { toTiles } from "../src/sim/fixed.js";
import { isPassable } from "../src/sim/grid.js";
import { isWorker } from "../src/sim/economy.js";
import { tickWorld, type World } from "../src/sim/world.js";

/** Twenty minutes at 10 Hz — the roadmap's number, not a convenient one. */
const TWENTY_MINUTES = 12000;

const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];

function play(seed: number, difficulties: readonly DifficultyId[], maxTicks = TWENTY_MINUTES): MatchResult {
  return runMatch({ seed, difficulties, maxTicks });
}

function countWins(difficulties: readonly DifficultyId[], seeds: readonly number[]): number[] {
  const wins = difficulties.map(() => 0);
  for (const seed of seeds) {
    const result = play(seed, difficulties);
    if (result.decided && result.winner !== null) wins[result.winner]!++;
  }
  return wins;
}

describe("M4 acceptance: a match against real opponents", () => {
  it.each(SEEDS)("reaches a decision within twenty minutes on seed %i", (seed) => {
    const result = play(seed, [Difficulty.Easy, Difficulty.Hard]);

    expect(
      result.decided,
      `seed ${seed}: twenty minutes and nobody won — usually means the two sides cannot reach each other`,
    ).toBe(true);
    expect(result.winner).not.toBeNull();
  });

  it("leaves the world in a coherent state after twenty minutes", () => {
    const world = play(3, [Difficulty.Hard, Difficulty.Hard]).world;

    for (const entity of world.entities.list) {
      expect(Number.isInteger(entity.x), `entity ${entity.id} has a fractional position`).toBe(true);
      expect(Number.isInteger(entity.y), `entity ${entity.id} has a fractional position`).toBe(true);
      expect(entity.hp, `entity ${entity.id} survived with no health`).toBeGreaterThan(0);

      if (!isUnit(entity)) continue;
      const tileX = Math.floor(toTiles(entity.x));
      const tileY = Math.floor(toTiles(entity.y));
      expect(
        isPassable(world.grid, tileX, tileY),
        `unit ${entity.id} ended up inside solid ground at ${tileX},${tileY}`,
      ).toBe(true);
    }
  });

  it("keeps both sides playing rather than one quietly dying of nothing", () => {
    // A bot that stops gathering, stops building or stops producing still
    // "runs" for twenty minutes. It just does not play.
    //
    // Sampled at sixty per cent of however long the match actually lasted,
    // rather than at a fixed five minutes. A fixed mark measures the balance of
    // the day: the first time the economy got faster, matches ended sooner, the
    // mark landed after the loser had already been dismantled, and a test about
    // *playing* started failing for reasons about *winning*.
    const settings = [Difficulty.Normal, Difficulty.Hard];
    const full = play(2, settings);
    const world = play(2, settings, Math.floor(full.ticks * 0.6)).world;

    for (const player of world.players) {
      const owned = world.entities.list.filter((entity) => entity.owner === player.id);
      const workers = owned.filter(isWorker).length;
      const fighters = owned.filter((entity) => isUnit(entity) && !isWorker(entity)).length;
      const buildings = owned.filter(isBuilding).length;

      expect(workers, `player ${player.id} has no economy at sixty per cent of the match`).toBeGreaterThan(2);
      expect(buildings, `player ${player.id} never built anything`).toBeGreaterThan(1);
      expect(fighters, `player ${player.id} never made an army`).toBeGreaterThan(0);
    }
  });

  it("makes the harder setting win more, from either starting corner", () => {
    // Both seats, because the two start positions are not mirror images on a
    // generated map, and a difficulty claim that only holds from one corner is
    // a claim about the map.
    const seeds = SEEDS.slice(0, 6);

    const [easyFirst, hardSecond] = countWins([Difficulty.Easy, Difficulty.Hard], seeds);
    const [hardFirst, easySecond] = countWins([Difficulty.Hard, Difficulty.Easy], seeds);

    const hardWins = hardSecond! + hardFirst!;
    const easyWins = easyFirst! + easySecond!;

    expect(
      hardWins,
      `Schwer won ${hardWins} of ${seeds.length * 2}, Leicht won ${easyWins} — difficulty is not doing anything`,
    ).toBeGreaterThan(easyWins);
  });

  it("gives the harder setting a bigger economy in the same time", () => {
    // The mechanism behind the win rate, checked separately: reaction time
    // turns into more workers, which turns into more army. If this holds and
    // the win rate does not, the problem is tactics, not the profile.
    const world = play(5, [Difficulty.Easy, Difficulty.Hard], 6000).world;

    const workersOf = (playerId: number): number =>
      world.entities.list.filter((entity) => entity.owner === playerId && isWorker(entity)).length;

    expect(workersOf(1)).toBeGreaterThan(workersOf(0));
  });

  it("plays the same twenty minutes twice", () => {
    // The property everything else in this file rests on: without it, a failure
    // here could not be reproduced, and none of these numbers would mean
    // anything from one run to the next.
    const once = play(7, [Difficulty.Hard, Difficulty.Normal]);
    const twice = play(7, [Difficulty.Hard, Difficulty.Normal]);

    expect(twice.hash).toBe(once.hash);
    expect(twice.ticks).toBe(once.ticks);
    expect(twice.winner).toBe(once.winner);
  });

  it("stays inside the per-tick budget with two full economies running", () => {
    // The budget is 8 ms per tick on a mid-range phone. Measured on whatever
    // machine is running the tests, so it is generous by design — it is here to
    // catch an order-of-magnitude regression, not to grade the hardware.
    const world: World = play(1, [Difficulty.Hard, Difficulty.Hard], 3000).world;

    const started = performance.now();
    for (let tick = 0; tick < 200; tick++) tickWorld(world);
    const perTick = (performance.now() - started) / 200;

    expect(perTick, `simulation costs ${perTick.toFixed(2)} ms per tick`).toBeLessThan(8);
  });
});
