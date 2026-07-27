/**
 * The M3 acceptance criterion, as an executable test.
 *
 * The milestone is: "a complete match against a dummy opponent is winnable."
 * That means the pieces have to work *together* — an economy that pays for a
 * barracks, a barracks that trains an army, an army that crosses the map and
 * pulls down a base, and a victory that is actually declared.
 */

import { describe, expect, it } from "vitest";

import { BuildingType } from "../src/content/buildings.js";
import { UnitType } from "../src/content/units.js";
import { placeBuildingAt } from "../src/sim/construction.js";
import { addEntity, isBuilding, type Entity } from "../src/sim/entities.js";
import { fromTiles } from "../src/sim/fixed.js";
import { createGrid, Terrain } from "../src/sim/grid.js";
import { Resource } from "../src/sim/resources.js";
import { isDefeated } from "../src/sim/victory.js";
import { createWorld, tickWorld, type World } from "../src/sim/world.js";

function arena(size = 48): World {
  const world = createWorld({ seed: 9, width: size, height: size, startingUnits: 0 });
  world.grid.tiles.set(createGrid(size, size, Terrain.Grass).tiles);
  world.grid.blocked.fill(0);
  world.deposits.fill(0);
  for (const player of world.players) {
    player.resources[Resource.Wood] = 4000;
    player.resources[Resource.Stone] = 4000;
    player.resources[Resource.Ore] = 4000;
  }
  return world;
}

function army(world: World, typeId: number, owner: number, count: number, tileX: number, tileY: number): Entity[] {
  return Array.from({ length: count }, (_, i) =>
    addEntity(world.entities, {
      typeId: typeId as never,
      owner,
      x: fromTiles(tileX + (i % 4)),
      y: fromTiles(tileY + Math.floor(i / 4)),
    }),
  );
}

function run(world: World, ticks: number): void {
  for (let i = 0; i < ticks; i++) tickWorld(world);
}

describe("victory", () => {
  it("declares nobody the winner while both sides still stand", () => {
    const world = arena();
    placeBuildingAt(world, 0, BuildingType.Headquarters, 5, 5, { free: true, finished: true, ignoreRadius: true });
    placeBuildingAt(world, 1, BuildingType.Headquarters, 40, 40, { free: true, finished: true, ignoreRadius: true });

    run(world, 20);
    expect(world.winner).toBeNull();
    expect(world.matchOver).toBe(false);
  });

  it("counts a player with nothing left as defeated", () => {
    const world = arena();
    placeBuildingAt(world, 0, BuildingType.Headquarters, 5, 5, { free: true, finished: true, ignoreRadius: true });

    run(world, 5);
    expect(isDefeated(world, 1)).toBe(true);
    expect(isDefeated(world, 0)).toBe(false);
  });

  it("keeps a player alive while they still have units to rebuild with", () => {
    // Losing every building is not the same as losing: workers can still put
    // something up. Ending the match early would take that comeback away.
    const world = arena();
    placeBuildingAt(world, 0, BuildingType.Headquarters, 5, 5, { free: true, finished: true, ignoreRadius: true });
    army(world, UnitType.Worker, 1, 3, 40, 40);

    run(world, 5);
    expect(isDefeated(world, 1)).toBe(false);
  });

  it("declares the last player standing the winner", () => {
    const world = arena();
    placeBuildingAt(world, 0, BuildingType.Headquarters, 5, 5, { free: true, finished: true, ignoreRadius: true });
    const doomed = placeBuildingAt(world, 1, BuildingType.Depot, 12, 5, {
      free: true,
      finished: true,
      ignoreRadius: true,
    })!;
    doomed.hp = 10;
    army(world, UnitType.Grenadier, 0, 2, 10, 5);

    run(world, 200);

    expect(world.winner).toBe(0);
    expect(world.matchOver).toBe(true);
  });

  it("stops fighting once the match is over", () => {
    const world = arena();
    placeBuildingAt(world, 0, BuildingType.Headquarters, 5, 5, { free: true, finished: true, ignoreRadius: true });
    const doomed = placeBuildingAt(world, 1, BuildingType.Depot, 12, 5, {
      free: true,
      finished: true,
      ignoreRadius: true,
    })!;
    doomed.hp = 10;
    army(world, UnitType.Grenadier, 0, 2, 10, 5);

    run(world, 200);
    const tickAtEnd = world.tick;
    run(world, 50);

    // The clock keeps running so the result screen can show a duration, but
    // nothing changes any more.
    expect(world.tick).toBeGreaterThan(tickAtEnd);
    expect(world.winner).toBe(0);
  });
});

describe("M3 acceptance: a winnable match", () => {
  it("takes an army across the map and levels a base", () => {
    const world = arena(48);

    // A defended enemy base: headquarters, depot, and a tower covering them.
    placeBuildingAt(world, 0, BuildingType.Headquarters, 4, 4, { free: true, finished: true, ignoreRadius: true });
    placeBuildingAt(world, 1, BuildingType.Headquarters, 38, 38, { free: true, finished: true, ignoreRadius: true });
    placeBuildingAt(world, 1, BuildingType.Depot, 35, 38, { free: true, finished: true, ignoreRadius: true });
    placeBuildingAt(world, 1, BuildingType.Tower, 34, 36, { free: true, finished: true, ignoreRadius: true });
    army(world, UnitType.Soldier, 1, 4, 36, 34);

    // A composition that answers what is there: grenadiers for the buildings,
    // soldiers to screen them from the defenders.
    const attackers = [
      ...army(world, UnitType.Grenadier, 0, 8, 6, 6),
      ...army(world, UnitType.Soldier, 0, 10, 6, 9),
    ];

    tickWorld(world, [
      {
        type: "attack-move",
        playerId: 0,
        entityIds: attackers.map((entity) => entity.id),
        targetX: fromTiles(38),
        targetY: fromTiles(38),
      },
    ]);

    // Five minutes of simulated time to cross the map and finish the job.
    run(world, 3000);

    const enemyBuildings = world.entities.list.filter(
      (entity) => isBuilding(entity) && entity.owner === 1,
    );
    expect(enemyBuildings, "the enemy base survived the assault").toHaveLength(0);
    expect(world.winner).toBe(0);
  });

  it("makes composition decide the fight, not numbers alone", () => {
    // The whole point of the damage matrix: the same count of the right unit
    // beats the wrong one. If this ever fails, the counters have stopped
    // mattering and the game is back to "build more of the strong thing".
    const fight = (attackerType: number, defenderType: number): number => {
      const world = arena();
      const attackers = army(world, attackerType, 0, 8, 8, 10);
      army(world, defenderType, 1, 8, 14, 10);

      tickWorld(world, [
        {
          type: "attack-move",
          playerId: 0,
          entityIds: attackers.map((entity) => entity.id),
          targetX: fromTiles(15),
          targetY: fromTiles(11),
        },
      ]);
      run(world, 800);

      const mine = world.entities.list.filter((entity) => entity.owner === 0).length;
      const theirs = world.entities.list.filter((entity) => entity.owner === 1).length;
      return mine - theirs;
    };

    // Vehicles maul infantry; grenadiers maul vehicles.
    expect(fight(UnitType.Vehicle, UnitType.Soldier)).toBeGreaterThan(0);
    expect(fight(UnitType.Grenadier, UnitType.Vehicle)).toBeGreaterThan(0);
  });

  it("lets a tower hold off a raid it should hold off", () => {
    const world = arena();
    placeBuildingAt(world, 0, BuildingType.Tower, 20, 20, { free: true, finished: true, ignoreRadius: true });
    const raiders = army(world, UnitType.Worker, 1, 3, 26, 20);

    tickWorld(world, [
      {
        type: "attack-move",
        playerId: 1,
        entityIds: raiders.map((entity) => entity.id),
        targetX: fromTiles(20),
        targetY: fromTiles(20),
      },
    ]);
    run(world, 600);

    const survivors = world.entities.list.filter((entity) => entity.owner === 1).length;
    expect(survivors).toBeLessThan(3);
  });

  it("keeps a large battle within the per-tick budget", () => {
    const world = arena(64);
    const attackers = army(world, UnitType.Soldier, 0, 60, 10, 10);
    army(world, UnitType.Grenadier, 1, 60, 30, 10);

    tickWorld(world, [
      {
        type: "attack-move",
        playerId: 0,
        entityIds: attackers.map((entity) => entity.id),
        targetX: fromTiles(32),
        targetY: fromTiles(12),
      },
    ]);

    const started = performance.now();
    run(world, 400);
    const averageMs = (performance.now() - started) / 400;

    // Loose on purpose — this catches an algorithmic regression, such as
    // targeting degenerating into an all-against-all scan, not milliseconds.
    expect(averageMs, `average tick ${averageMs.toFixed(3)} ms`).toBeLessThan(20);
  });

  it("fights the same battle identically twice", () => {
    const battle = (): number[] => {
      const world = arena();
      const attackers = army(world, UnitType.Soldier, 0, 12, 8, 10);
      army(world, UnitType.Grenadier, 1, 12, 16, 10);
      placeBuildingAt(world, 1, BuildingType.Tower, 20, 12, {
        free: true,
        finished: true,
        ignoreRadius: true,
      });

      tickWorld(world, [
        {
          type: "attack-move",
          playerId: 0,
          entityIds: attackers.map((entity) => entity.id),
          targetX: fromTiles(20),
          targetY: fromTiles(12),
        },
      ]);
      run(world, 600);

      return world.entities.list.flatMap((entity) => [entity.id, entity.x, entity.y, entity.hp]);
    };

    expect(battle()).toEqual(battle());
  });
});
