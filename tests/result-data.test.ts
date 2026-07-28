/**
 * What the result screen says.
 *
 * Kept as pure data for the same reason the legend is: the numbers must come
 * from the world and the content tables, never from a second copy that drifts.
 * The screen itself is a handful of divs around this.
 */

import { describe, expect, it } from "vitest";

import { RESOURCE_NAMES, Resource } from "../src/sim/resources.js";
import { statsFor } from "../src/sim/stats.js";
import { createWorld, TICKS_PER_SECOND, type World } from "../src/sim/world.js";
import { matchResult, Outcome } from "../src/ui/result-data.js";

function world(): World {
  return createWorld({ seed: 3, width: 32, height: 32, startingUnits: 0 });
}

describe("the verdict", () => {
  it("calls a win a win, from the local player's chair", () => {
    const w = world();
    w.matchOver = true;
    w.winner = 0;

    expect(matchResult(w, 0)!.outcome).toBe(Outcome.Won);
    expect(matchResult(w, 1)!.outcome).toBe(Outcome.Lost);
  });

  it("calls a draw a draw for everybody", () => {
    const w = world();
    w.matchOver = true;
    w.winner = null;

    expect(matchResult(w, 0)!.outcome).toBe(Outcome.Draw);
    expect(matchResult(w, 1)!.outcome).toBe(Outcome.Draw);
  });

  it("says nothing while the match is still running", () => {
    expect(matchResult(world(), 0)).toBeNull();
  });

  it("puts the result in words, not just in a code", () => {
    const w = world();
    w.matchOver = true;
    w.winner = 0;

    expect(matchResult(w, 0)!.headline).toBeTruthy();
    expect(matchResult(w, 0)!.headline).not.toBe(matchResult(w, 1)!.headline);
  });
});

describe("how long it took", () => {
  it("reports the match length as minutes and seconds", () => {
    const w = world();
    w.matchOver = true;
    w.winner = 0;
    w.tick = TICKS_PER_SECOND * (3 * 60 + 7);

    expect(matchResult(w, 0)!.duration).toBe("3:07");
  });
});

describe("the columns", () => {
  it("lists the local player first, whoever that is", () => {
    const w = world();
    w.matchOver = true;
    w.winner = 1;

    expect(matchResult(w, 1)!.sides[0]!.playerId).toBe(1);
    expect(matchResult(w, 1)!.sides[1]!.playerId).toBe(0);
    expect(matchResult(w, 0)!.sides[0]!.playerId).toBe(0);
  });

  it("names the sides in a way a player can tell apart", () => {
    const w = world();
    w.matchOver = true;
    w.winner = 0;

    const names = matchResult(w, 0)!.sides.map((side) => side.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("takes every figure straight from the tally", () => {
    const w = world();
    w.matchOver = true;
    w.winner = 0;
    const stats = statsFor(w, 0);
    stats.gathered[Resource.Wood] = 640;
    stats.gathered[Resource.Stone] = 120;
    stats.unitsTrained = 17;
    stats.buildingsBuilt = 6;
    stats.unitsLost = 9;
    stats.buildingsLost = 2;

    const mine = matchResult(w, 0)!.sides[0]!;
    expect(mine.gathered).toBe(760);
    expect(mine.unitsTrained).toBe(17);
    expect(mine.buildingsBuilt).toBe(6);
    expect(mine.unitsLost).toBe(9);
    expect(mine.buildingsLost).toBe(2);
  });

  it("breaks the haul down by resource, using the resource table's names", () => {
    const w = world();
    w.matchOver = true;
    w.winner = 0;
    statsFor(w, 0).gathered[Resource.Ore] = 55;

    const ore = matchResult(w, 0)!.sides[0]!.haul.find((row) => row.kind === Resource.Ore)!;
    expect(ore.name).toBe(RESOURCE_NAMES[Resource.Ore]);
    expect(ore.amount).toBe(55);
  });

  it("leaves out resources nobody dug up, so the column stays readable", () => {
    const w = world();
    w.matchOver = true;
    w.winner = 0;
    statsFor(w, 0).gathered[Resource.Wood] = 10;

    const haul = matchResult(w, 0)!.sides[0]!.haul;
    expect(haul).toHaveLength(1);
    expect(haul[0]!.kind).toBe(Resource.Wood);
  });
});
