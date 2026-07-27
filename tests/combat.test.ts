/**
 * Fighting.
 *
 * The behaviour that matters most here is restraint: a unit standing around
 * must defend itself but must *not* wander off after whatever it can see.
 * Units that chase on their own drag a player's army apart one skirmish at a
 * time, and the player never gave an order for any of it. So idle units shoot
 * what comes into reach; only an explicit attack order, or attack-move, makes
 * them advance.
 */

import { describe, expect, it } from "vitest";

import { BuildingType } from "../src/content/buildings.js";
import { UnitType, unitDef } from "../src/content/units.js";
import { placeBuildingAt } from "../src/sim/construction.js";
import { addEntity, getEntity, isBuilding, type Entity } from "../src/sim/entities.js";
import { fromTiles, toTiles } from "../src/sim/fixed.js";
import { createGrid, Terrain } from "../src/sim/grid.js";
import { Resource } from "../src/sim/resources.js";
import { createWorld, tickWorld, type World } from "../src/sim/world.js";

function arena(size = 40): World {
  const world = createWorld({ seed: 5, width: size, height: size, startingUnits: 0 });
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

function unit(world: World, typeId: number, owner: number, tileX: number, tileY: number): Entity {
  return addEntity(world.entities, {
    typeId: typeId as never,
    owner,
    x: fromTiles(tileX + 0.5),
    y: fromTiles(tileY + 0.5),
  });
}

function run(world: World, ticks: number): void {
  for (let i = 0; i < ticks; i++) tickWorld(world);
}

describe("self defence", () => {
  it("shoots an enemy that walks into reach", () => {
    const world = arena();
    const mine = unit(world, UnitType.Soldier, 0, 10, 10);
    const enemy = unit(world, UnitType.Soldier, 1, 11, 10);
    const startingHp = enemy.hp;

    run(world, 30);
    expect(enemy.hp).toBeLessThan(startingHp);
    expect(mine.hp).toBeLessThan(unitDef(UnitType.Soldier).maxHp);
  });

  it("does not wander off after a distant enemy", () => {
    // The restraint that keeps an army together. Without it, one visible enemy
    // pulls units off in every direction and the player never ordered any of it.
    const world = arena();
    const mine = unit(world, UnitType.Soldier, 0, 10, 10);
    unit(world, UnitType.Soldier, 1, 25, 10);

    run(world, 100);
    expect(toTiles(mine.x)).toBeLessThan(11);
    expect(mine.goalX).toBeNull();
  });

  it("never shoots its own side", () => {
    const world = arena();
    const a = unit(world, UnitType.Soldier, 0, 10, 10);
    const b = unit(world, UnitType.Soldier, 0, 11, 10);

    run(world, 60);
    expect(a.hp).toBe(unitDef(UnitType.Soldier).maxHp);
    expect(b.hp).toBe(unitDef(UnitType.Soldier).maxHp);
  });

  it("lets workers fight back, badly", () => {
    const world = arena();
    const worker = unit(world, UnitType.Worker, 0, 10, 10);
    const raider = unit(world, UnitType.Soldier, 1, 11, 10);

    run(world, 40);
    // The worker does something, but loses the exchange convincingly.
    expect(raider.hp).toBeLessThan(unitDef(UnitType.Soldier).maxHp);
    expect(worker.hp / unitDef(UnitType.Worker).maxHp).toBeLessThan(
      raider.hp / unitDef(UnitType.Soldier).maxHp,
    );
  });
});

describe("rate of fire", () => {
  it("waits out the cooldown between shots", () => {
    const world = arena();
    const target = unit(world, UnitType.Soldier, 1, 11, 10);
    unit(world, UnitType.Soldier, 0, 10, 10);

    // Over a fixed window a soldier lands a predictable number of shots, not
    // one per tick.
    const before = target.hp;
    run(world, 20);
    const dealt = before - target.hp;
    const perShot = unitDef(UnitType.Soldier).weapon!.damage;

    expect(dealt).toBeLessThanOrEqual(perShot * 4);
    expect(dealt).toBeGreaterThan(0);
  });
});

describe("the matrix in practice", () => {
  it("has a vehicle shred infantry faster than the reverse", () => {
    const damageDealt = (attackerType: number, defenderType: number): number => {
      const world = arena();
      const defender = unit(world, defenderType, 1, 11, 10);
      unit(world, attackerType, 0, 10, 10);
      const before = defender.hp;
      run(world, 40);
      return (before - defender.hp) / unitDef(defenderType as never).maxHp;
    };

    expect(damageDealt(UnitType.Vehicle, UnitType.Soldier)).toBeGreaterThan(
      damageDealt(UnitType.Soldier, UnitType.Vehicle),
    );
  });

  it("has grenadiers pull down buildings faster than soldiers", () => {
    const wear = (attackerType: number): number => {
      const world = arena();
      const target = placeBuildingAt(world, 1, BuildingType.Depot, 12, 10, {
        free: true,
        finished: true,
        ignoreRadius: true,
      })!;
      unit(world, attackerType, 0, 10, 10);
      const before = target.hp;
      run(world, 120);
      return before - target.hp;
    };

    expect(wear(UnitType.Grenadier)).toBeGreaterThan(wear(UnitType.Soldier));
  });
});

describe("death", () => {
  it("removes a unit at zero health", () => {
    const world = arena();
    const victim = unit(world, UnitType.Worker, 1, 11, 10);
    unit(world, UnitType.Vehicle, 0, 10, 10);
    const victimId = victim.id;

    run(world, 200);
    expect(getEntity(world.entities, victimId)).toBeUndefined();
  });

  it("frees the ground a destroyed building stood on", () => {
    const world = arena();
    const target = placeBuildingAt(world, 1, BuildingType.Depot, 12, 10, {
      free: true,
      finished: true,
      ignoreRadius: true,
    })!;
    const index = 10 * world.grid.width + 12;
    expect(world.grid.blocked[index]).toBe(1);

    target.hp = 5;
    unit(world, UnitType.Grenadier, 0, 11, 10);
    run(world, 60);

    expect(getEntity(world.entities, target.id)).toBeUndefined();
    // The rubble must not keep blocking the tile, or the map slowly fills with
    // invisible walls where buildings used to be.
    expect(world.grid.blocked[index]).toBe(0);
  });

  it("lets attackers forget a target that died", () => {
    const world = arena();
    const victim = unit(world, UnitType.Worker, 1, 11, 10);
    const killer = unit(world, UnitType.Vehicle, 0, 10, 10);

    tickWorld(world, [{ type: "attack", playerId: 0, entityIds: [killer.id], targetId: victim.id }]);
    run(world, 200);

    expect(killer.attackTargetId).toBeNull();
  });
});

describe("attack orders", () => {
  it("sends a unit after a distant target", () => {
    const world = arena();
    const attacker = unit(world, UnitType.Soldier, 0, 10, 10);
    const target = unit(world, UnitType.Soldier, 1, 24, 10);

    tickWorld(world, [{ type: "attack", playerId: 0, entityIds: [attacker.id], targetId: target.id }]);
    run(world, 300);

    expect(target.hp).toBeLessThan(unitDef(UnitType.Soldier).maxHp);
  });

  it("refuses an order for another player's units", () => {
    const world = arena();
    const notMine = unit(world, UnitType.Soldier, 1, 10, 10);
    const target = unit(world, UnitType.Soldier, 0, 12, 10);

    tickWorld(world, [{ type: "attack", playerId: 0, entityIds: [notMine.id], targetId: target.id }]);
    expect(notMine.attackTargetId).toBeNull();
  });

  it("ignores an order to attack your own unit", () => {
    const world = arena();
    const attacker = unit(world, UnitType.Soldier, 0, 10, 10);
    const friend = unit(world, UnitType.Soldier, 0, 14, 10);

    tickWorld(world, [{ type: "attack", playerId: 0, entityIds: [attacker.id], targetId: friend.id }]);
    expect(attacker.attackTargetId).toBeNull();
  });
});

describe("attack-move", () => {
  it("engages what it meets on the way", () => {
    const world = arena();
    const attacker = unit(world, UnitType.Soldier, 0, 5, 10);
    const bystander = unit(world, UnitType.Soldier, 1, 14, 10);

    tickWorld(world, [
      {
        type: "attack-move",
        playerId: 0,
        entityIds: [attacker.id],
        targetX: fromTiles(30),
        targetY: fromTiles(10),
      },
    ]);
    run(world, 300);

    expect(bystander.hp).toBeLessThan(unitDef(UnitType.Soldier).maxHp);
  });

  it("carries on to the destination once the road is clear", () => {
    const world = arena();
    const attacker = unit(world, UnitType.Soldier, 0, 5, 10);

    tickWorld(world, [
      {
        type: "attack-move",
        playerId: 0,
        entityIds: [attacker.id],
        targetX: fromTiles(20),
        targetY: fromTiles(10),
      },
    ]);
    run(world, 400);

    expect(toTiles(attacker.x)).toBeGreaterThan(18);
  });
});

describe("towers", () => {
  it("shoots enemies in range", () => {
    const world = arena();
    const tower = placeBuildingAt(world, 0, BuildingType.Tower, 10, 10, {
      free: true,
      finished: true,
      ignoreRadius: true,
    })!;
    const enemy = unit(world, UnitType.Soldier, 1, 13, 10);

    run(world, 60);
    expect(enemy.hp).toBeLessThan(unitDef(UnitType.Soldier).maxHp);
    expect(tower.goalX).toBeNull();
  });

  it("out-ranges the infantry it defends against", () => {
    // A tower a soldier can stand outside of and shoot is not a defence.
    const world = arena();
    placeBuildingAt(world, 0, BuildingType.Tower, 10, 10, {
      free: true,
      finished: true,
      ignoreRadius: true,
    });
    const enemy = unit(world, UnitType.Soldier, 1, 14, 10);

    run(world, 40);
    expect(enemy.hp).toBeLessThan(unitDef(UnitType.Soldier).maxHp);
  });

  it("does not shoot while it is still a building site", () => {
    const world = arena();
    placeBuildingAt(world, 0, BuildingType.Tower, 10, 10, { free: true, ignoreRadius: true });
    const enemy = unit(world, UnitType.Soldier, 1, 13, 10);

    run(world, 40);
    expect(enemy.hp).toBe(unitDef(UnitType.Soldier).maxHp);
  });
});

describe("determinism", () => {
  it("fights out the same battle twice", () => {
    const battle = (): number[] => {
      const world = arena();
      for (let i = 0; i < 6; i++) unit(world, UnitType.Soldier, 0, 8, 8 + i);
      for (let i = 0; i < 6; i++) unit(world, UnitType.Grenadier, 1, 12, 8 + i);

      tickWorld(world, [
        {
          type: "attack-move",
          playerId: 0,
          entityIds: world.entities.list.filter((e) => e.owner === 0).map((e) => e.id),
          targetX: fromTiles(14),
          targetY: fromTiles(10),
        },
      ]);
      run(world, 400);

      return world.entities.list.flatMap((entity) => [entity.id, entity.x, entity.y, entity.hp]);
    };

    expect(battle()).toEqual(battle());
  });

  it("keeps buildings out of the movement system", () => {
    const world = arena();
    const tower = placeBuildingAt(world, 0, BuildingType.Tower, 10, 10, {
      free: true,
      finished: true,
      ignoreRadius: true,
    })!;
    const before = { x: tower.x, y: tower.y };
    unit(world, UnitType.Soldier, 1, 13, 10);

    run(world, 100);
    expect({ x: tower.x, y: tower.y }).toEqual(before);
    expect(isBuilding(tower)).toBe(true);
  });
});
