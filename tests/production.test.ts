/**
 * Training units.
 *
 * Workers cost resources and take time. Both matter: without a cost there is
 * never a reason to stop making them, and the milestone's central question —
 * "more workers, or a depot closer to the seam?" — stops being a question.
 */

import { describe, expect, it } from "vitest";

import { BuildingType } from "../src/content/buildings.js";
import { UnitType, unitDef, type UnitTypeId } from "../src/content/units.js";
import { placeBuildingAt } from "../src/sim/construction.js";
import { isUnit, type Entity } from "../src/sim/entities.js";
import { toTiles } from "../src/sim/fixed.js";
import { createGrid, Terrain } from "../src/sim/grid.js";
import { Resource } from "../src/sim/resources.js";
import { createWorld, tickWorld, type World } from "../src/sim/world.js";

function baseWorld(): { world: World; hq: Entity } {
  const world = createWorld({ seed: 4, width: 40, height: 40, startingUnits: 0 });
  world.grid.tiles.set(createGrid(40, 40, Terrain.Grass).tiles);
  world.grid.blocked.fill(0);
  world.deposits.fill(0);
  world.players[0]!.resources[Resource.Wood] = 1000;
  world.players[0]!.resources[Resource.Stone] = 1000;
  world.players[1]!.resources[Resource.Wood] = 1000;

  const hq = placeBuildingAt(world, 0, BuildingType.Headquarters, 10, 10, { free: true, finished: true })!;
  return { world, hq };
}

function train(world: World, hq: Entity, playerId = 0, unitType: UnitTypeId = UnitType.Worker): void {
  tickWorld(world, [{ type: "train", playerId, buildingId: hq.id, unitType }]);
}

function unitCount(world: World, owner = 0): number {
  return world.entities.list.filter((entity) => isUnit(entity) && entity.owner === owner).length;
}

describe("queueing", () => {
  it("charges for the unit when it is queued", () => {
    const { world, hq } = baseWorld();
    const before = world.players[0]!.resources[Resource.Wood];

    train(world, hq);

    expect(hq.production?.queue).toEqual([UnitType.Worker]);
    expect(world.players[0]!.resources[Resource.Wood]).toBe(
      before - (unitDef(UnitType.Worker).cost[Resource.Wood] ?? 0),
    );
  });

  it("refuses what the player cannot afford", () => {
    const { world, hq } = baseWorld();
    world.players[0]!.resources[Resource.Wood] = 0;

    train(world, hq);
    expect(hq.production?.queue).toEqual([]);
  });

  it("refuses a unit this building does not train", () => {
    const { world, hq } = baseWorld();
    train(world, hq, 0, UnitType.Soldier);
    expect(hq.production?.queue).toEqual([]);
  });

  it("refuses orders from another player", () => {
    const { world, hq } = baseWorld();
    train(world, hq, 1);
    expect(hq.production?.queue).toEqual([]);
    // ...and does not quietly bill them for it either.
    expect(world.players[1]!.resources[Resource.Wood]).toBe(1000);
  });

  it("refuses to train at a construction site", () => {
    const { world } = baseWorld();
    const site = placeBuildingAt(world, 0, BuildingType.Headquarters, 15, 15, { free: true })!;
    train(world, site);
    expect(site.production?.queue).toEqual([]);
  });

  it("stacks several orders in the order given", () => {
    const { world, hq } = baseWorld();
    train(world, hq);
    train(world, hq);
    train(world, hq);
    expect(hq.production?.queue).toHaveLength(3);
  });
});

describe("training", () => {
  it("produces the unit after its training time", () => {
    const { world, hq } = baseWorld();
    train(world, hq);

    const ticks = unitDef(UnitType.Worker).trainTicks;
    for (let i = 0; i < ticks - 2; i++) tickWorld(world);
    expect(unitCount(world)).toBe(0);

    for (let i = 0; i < 4; i++) tickWorld(world);
    expect(unitCount(world)).toBe(1);
  });

  it("gives the new unit to the building's owner", () => {
    const { world, hq } = baseWorld();
    train(world, hq);
    for (let i = 0; i < 200; i++) tickWorld(world);

    const produced = world.entities.list.find((entity) => isUnit(entity));
    expect(produced?.owner).toBe(0);
    expect(produced?.typeId).toBe(UnitType.Worker);
  });

  it("places the new unit outside the building, not inside it", () => {
    // Spawning on a blocked tile would leave the unit stuck in a wall.
    const { world, hq } = baseWorld();
    train(world, hq);
    for (let i = 0; i < 200; i++) tickWorld(world);

    const produced = world.entities.list.find((entity) => isUnit(entity))!;
    const tileX = Math.floor(toTiles(produced.x));
    const tileY = Math.floor(toTiles(produced.y));
    expect(world.grid.blocked[tileY * world.grid.width + tileX]).toBe(0);
  });

  it("works through the queue one at a time", () => {
    const { world, hq } = baseWorld();
    train(world, hq);
    train(world, hq);

    const ticks = unitDef(UnitType.Worker).trainTicks;
    for (let i = 0; i < ticks + 2; i++) tickWorld(world);
    expect(unitCount(world)).toBe(1);

    for (let i = 0; i < ticks + 2; i++) tickWorld(world);
    expect(unitCount(world)).toBe(2);
    expect(hq.production?.queue).toHaveLength(0);
  });

  it("sends new units to the rally point when one is set", () => {
    const { world, hq } = baseWorld();
    tickWorld(world, [
      { type: "rally", playerId: 0, buildingId: hq.id, targetX: 25 * 256, targetY: 25 * 256 },
    ]);
    train(world, hq);
    // Checked just after it walks out: given longer it would reach the rally
    // point and correctly go idle, which would make this assert nothing.
    for (let i = 0; i < unitDef(UnitType.Worker).trainTicks + 2; i++) tickWorld(world);

    const produced = world.entities.list.find((entity) => isUnit(entity))!;
    expect(produced.goalX).toBe(25 * 256);
  });

  it("leaves new units idle when no rally point is set", () => {
    const { world, hq } = baseWorld();
    train(world, hq);
    for (let i = 0; i < unitDef(UnitType.Worker).trainTicks + 2; i++) tickWorld(world);

    const produced = world.entities.list.find((entity) => isUnit(entity))!;
    expect(produced.goalX).toBeNull();
  });
});

describe("cancelling", () => {
  it("refunds the last order in the queue", () => {
    const { world, hq } = baseWorld();
    train(world, hq);
    train(world, hq);
    const afterQueueing = world.players[0]!.resources[Resource.Wood];

    tickWorld(world, [{ type: "cancel-train", playerId: 0, buildingId: hq.id }]);

    expect(hq.production?.queue).toHaveLength(1);
    expect(world.players[0]!.resources[Resource.Wood]).toBe(
      afterQueueing + (unitDef(UnitType.Worker).cost[Resource.Wood] ?? 0),
    );
  });

  it("does nothing on an empty queue", () => {
    const { world, hq } = baseWorld();
    const before = world.players[0]!.resources[Resource.Wood];
    tickWorld(world, [{ type: "cancel-train", playerId: 0, buildingId: hq.id }]);
    expect(world.players[0]!.resources[Resource.Wood]).toBe(before);
  });

  it("ignores another player's cancel", () => {
    const { world, hq } = baseWorld();
    train(world, hq);
    tickWorld(world, [{ type: "cancel-train", playerId: 1, buildingId: hq.id }]);
    expect(hq.production?.queue).toHaveLength(1);
  });
});

describe("determinism", () => {
  it("produces the same result twice", () => {
    const run = (): number[] => {
      const { world, hq } = baseWorld();
      for (let i = 0; i < 4; i++) train(world, hq);
      for (let i = 0; i < 400; i++) tickWorld(world);
      return world.entities.list.flatMap((entity) => [entity.id, entity.x, entity.y]);
    };

    expect(run()).toEqual(run());
  });
});
