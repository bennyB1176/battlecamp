/**
 * The M1 acceptance criterion, as an executable test.
 *
 * The milestone is defined as: "100 units move smoothly to a target without
 * jamming." That sentence is easy to nod at and hard to keep true — crowd
 * behaviour degrades the moment someone tweaks a separation constant. Encoding
 * it here means the definition of done is checked on every push rather than
 * remembered.
 *
 * Frame rate is not measured here; that belongs on a real device. What this
 * checks is the part a headless run *can* prove: everybody arrives, nobody
 * stands in rock, nobody is still shoving when the dust settles.
 */

import { describe, expect, it } from "vitest";

import { UnitType } from "../src/content/units.js";
import { addEntity } from "../src/sim/entities.js";
import { dist, fromTiles, ONE, toTiles } from "../src/sim/fixed.js";
import { isPassable } from "../src/sim/grid.js";
import { computeFlowField, isReachable } from "../src/sim/pathing.js";
import { createWorld, tickWorld, type World } from "../src/sim/world.js";

const CROWD_SIZE = 100;
/** 60 seconds of simulated time at 10 Hz — generous for a 40-tile walk. */
const TICK_BUDGET = 600;

function worldWithCrowd(seed: number): { world: World; ids: number[]; target: { x: number; y: number } } {
  const world = createWorld({ seed, width: 64, height: 64, startingUnits: 0 });
  const target = passableNear(world, 46, 46);

  // Only place units on ground that actually connects to the destination.
  //
  // A generated map has lakes and ridges, and a naive block of spawn points can
  // straddle one — leaving a unit correctly deciding the goal is unreachable and
  // standing still. That is the sim behaving properly, not a movement failure,
  // so the crowd is seeded inside a single connected region, the way a real
  // player's army starts out.
  const reachable = computeFlowField(world.grid, target.x, target.y);
  const ids: number[] = [];

  let placed = 0;
  for (let row = 0; row < 30 && placed < CROWD_SIZE; row++) {
    for (let column = 0; column < 30 && placed < CROWD_SIZE; column++) {
      const tileX = 6 + column;
      const tileY = 6 + row;
      if (!isPassable(world.grid, tileX, tileY)) continue;
      if (!isReachable(reachable, tileX, tileY)) continue;

      ids.push(
        addEntity(world.entities, {
          typeId: placed % 5 === 0 ? UnitType.Scout : UnitType.Soldier,
          owner: 0,
          x: fromTiles(tileX + 0.5),
          y: fromTiles(tileY + 0.5),
        }).id,
      );
      placed++;
    }
  }

  return { world, ids, target };
}

/** A destination that is actually reachable, searched outward from a preference. */
function passableNear(world: World, tileX: number, tileY: number): { x: number; y: number } {
  for (let radius = 0; radius < 30; radius++) {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
        if (isPassable(world.grid, tileX + dx, tileY + dy)) {
          return { x: tileX + dx, y: tileY + dy };
        }
      }
    }
  }
  throw new Error("no passable destination found");
}

describe("M1 acceptance: a hundred units cross the map", () => {
  it.each([1, 20260727, 31337])("settles the whole crowd on seed %i", (seed) => {
    const { world, ids, target } = worldWithCrowd(seed);

    tickWorld(world, [
      {
        type: "move",
        playerId: 0,
        entityIds: ids,
        targetX: fromTiles(target.x + 0.5),
        targetY: fromTiles(target.y + 0.5),
      },
    ]);

    for (let tick = 0; tick < TICK_BUDGET; tick++) tickWorld(world);

    const units = world.entities.list;
    expect(units).toHaveLength(CROWD_SIZE);

    // 1. Everyone has stopped. A unit still holding a goal after a minute is
    //    either lost or locked in a shoving match — both are failures.
    const stillMoving = units.filter((unit) => unit.goalX !== null);
    expect(stillMoving, `${stillMoving.length} units never settled`).toHaveLength(0);

    // 2. Everyone ended up near the destination. A hundred bodies cannot share
    //    one tile, so they spread — but they should form a clump, not scatter.
    for (const unit of units) {
      const away = toTiles(dist(unit.x, unit.y, fromTiles(target.x + 0.5), fromTiles(target.y + 0.5)));
      expect(away, `unit ${unit.id} stopped ${away.toFixed(1)} tiles away`).toBeLessThan(10);
    }

    // 3. Nobody is standing inside terrain.
    for (const unit of units) {
      const tileX = Math.floor(toTiles(unit.x));
      const tileY = Math.floor(toTiles(unit.y));
      expect(isPassable(world.grid, tileX, tileY), `unit ${unit.id} is inside terrain`).toBe(true);
    }

    // 4. Nobody is perfectly stacked on somebody else. Exact overlap means
    //    separation gave up, and units would move as one blob from then on.
    for (let i = 0; i < units.length; i++) {
      for (let j = i + 1; j < units.length; j++) {
        const a = units[i]!;
        const b = units[j]!;
        expect(a.x !== b.x || a.y !== b.y, `units ${a.id} and ${b.id} occupy the same point`).toBe(true);
      }
    }
  });

  it("keeps the simulation well inside the per-tick budget", () => {
    const { world, ids, target } = worldWithCrowd(20260727);

    tickWorld(world, [
      {
        type: "move",
        playerId: 0,
        entityIds: ids,
        targetX: fromTiles(target.x + 0.5),
        targetY: fromTiles(target.y + 0.5),
      },
    ]);

    const started = performance.now();
    for (let tick = 0; tick < 300; tick++) tickWorld(world);
    const averageMs = (performance.now() - started) / 300;

    // The real budget is 8 ms per tick on a mid-range phone. CI hardware varies
    // far too much to assert that here, so this threshold is deliberately loose:
    // it exists to catch an algorithmic regression — someone reintroducing
    // per-unit pathfinding, say — not to police milliseconds.
    expect(averageMs, `average tick ${averageMs.toFixed(2)} ms`).toBeLessThan(20);
  });

  it("re-uses one flow field for the whole crowd", () => {
    // The reason a hundred units are affordable at all. If this ever grows with
    // the crowd size, per-unit pathfinding has crept back in.
    const { world, ids, target } = worldWithCrowd(1);

    tickWorld(world, [
      {
        type: "move",
        playerId: 0,
        entityIds: ids,
        targetX: fromTiles(target.x + 0.5),
        targetY: fromTiles(target.y + 0.5),
      },
    ]);
    for (let tick = 0; tick < 20; tick++) tickWorld(world);

    expect(world.fields.fields.size).toBe(1);
  });

  it("stays byte-identical across two identical runs", () => {
    const run = (): number[] => {
      const { world, ids, target } = worldWithCrowd(99);
      tickWorld(world, [
        {
          type: "move",
          playerId: 0,
          entityIds: ids,
          targetX: fromTiles(target.x + 0.5),
          targetY: fromTiles(target.y + 0.5),
        },
      ]);
      for (let tick = 0; tick < 200; tick++) tickWorld(world);
      return world.entities.list.flatMap((unit) => [unit.x, unit.y]);
    };

    expect(run()).toEqual(run());
  });
});

describe("units do not drift when idle", () => {
  it("holds position over a long stretch of ticks", () => {
    // A crowd standing still must stay still: separation nudges that never fully
    // cancel would have an idle army slowly sliding across the map.
    const { world } = worldWithCrowd(7);
    for (let tick = 0; tick < 50; tick++) tickWorld(world);

    const before = world.entities.list.map((unit) => ({ x: unit.x, y: unit.y }));
    for (let tick = 0; tick < 200; tick++) tickWorld(world);

    world.entities.list.forEach((unit, index) => {
      const start = before[index]!;
      expect(dist(unit.x, unit.y, start.x, start.y)).toBeLessThanOrEqual(ONE / 8);
    });
  });
});
