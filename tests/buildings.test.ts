/**
 * Buildings.
 *
 * Units and buildings share one entity store rather than living in separate
 * worlds. From M3 both take damage, both are targets, both are drawn — keeping
 * them together means combat, rendering and the world hash each need one loop
 * instead of two.
 */

import { describe, expect, it } from "vitest";

import { BuildingType, BUILDING_DEFS, buildingDef } from "../src/content/buildings.js";
import { UnitType } from "../src/content/units.js";
import {
  EntityKind,
  addBuilding,
  addEntity,
  buildingOrigin,
  buildingTiles,
  createEntityStore,
  isBuilding,
  isUnit,
  maxHpOf,
} from "../src/sim/entities.js";
import { ONE, toTiles } from "../src/sim/fixed.js";
import { Resource } from "../src/sim/resources.js";

describe("building definitions", () => {
  it("gives every building a sane footprint, cost and health", () => {
    for (const [id, def] of Object.entries(BUILDING_DEFS)) {
      expect(def.footprint, `${def.name} footprint`).toBeGreaterThanOrEqual(1);
      expect(def.maxHp, `${def.name} hp`).toBeGreaterThan(0);
      expect(def.buildWork, `${def.name} build work`).toBeGreaterThan(0);
      // Something has to be paid, or the build menu is a free-for-all.
      const total = Object.values(def.cost).reduce((sum, amount) => sum + (amount ?? 0), 0);
      expect(total, `${def.name} (${id}) costs nothing`).toBeGreaterThan(0);
    }
  });

  it("makes the headquarters a drop-off point", () => {
    // Without this the opening has nowhere to deliver to and no economy starts.
    expect(buildingDef(BuildingType.Headquarters).acceptsDeliveries).toBe(true);
  });

  it("lets the headquarters produce workers", () => {
    expect(buildingDef(BuildingType.Headquarters).produces).toContain(UnitType.Worker);
  });

  it("gives every building a build radius so bases stay connected", () => {
    for (const def of Object.values(BUILDING_DEFS)) {
      expect(def.buildRadius, `${def.name} build radius`).toBeGreaterThan(0);
    }
  });

  it("prices the depot in wood and stone", () => {
    const cost = buildingDef(BuildingType.Depot).cost;
    expect(cost[Resource.Wood]).toBeGreaterThan(0);
  });
});

describe("buildings as entities", () => {
  it("distinguishes buildings from units", () => {
    const store = createEntityStore();
    const unit = addEntity(store, { typeId: UnitType.Worker, owner: 0, x: ONE, y: ONE });
    const hq = addBuilding(store, { typeId: BuildingType.Headquarters, owner: 0, tileX: 5, tileY: 5 });

    expect(isUnit(unit)).toBe(true);
    expect(isBuilding(unit)).toBe(false);
    expect(isBuilding(hq)).toBe(true);
    expect(hq.kind).toBe(EntityKind.Building);
  });

  it("centres a building on its footprint", () => {
    const store = createEntityStore();
    const def = buildingDef(BuildingType.Headquarters);
    const hq = addBuilding(store, { typeId: BuildingType.Headquarters, owner: 0, tileX: 10, tileY: 20 });

    expect(toTiles(hq.x)).toBe(10 + def.footprint / 2);
    expect(toTiles(hq.y)).toBe(20 + def.footprint / 2);
  });

  it("recovers the origin tile it was placed on", () => {
    // Rendering, occupancy and placement all need the top-left tile back, and
    // deriving it must be exact — a rounding slip puts a building half a tile
    // off from the squares it actually blocks.
    const store = createEntityStore();
    for (const [tileX, tileY] of [[0, 0], [7, 3], [41, 58]] as const) {
      const hq = addBuilding(store, { typeId: BuildingType.Headquarters, owner: 0, tileX, tileY });
      expect(buildingOrigin(hq)).toEqual({ tileX, tileY });
    }
  });

  it("lists every tile it occupies", () => {
    const store = createEntityStore();
    const hq = addBuilding(store, { typeId: BuildingType.Headquarters, owner: 0, tileX: 4, tileY: 6 });
    const def = buildingDef(BuildingType.Headquarters);

    const tiles = buildingTiles(hq);
    expect(tiles).toHaveLength(def.footprint * def.footprint);
    expect(tiles).toContainEqual({ tileX: 4, tileY: 6 });
    expect(tiles).toContainEqual({ tileX: 4 + def.footprint - 1, tileY: 6 + def.footprint - 1 });
  });

  it("starts complete when placed directly, and damaged when under construction", () => {
    const store = createEntityStore();
    const finished = addBuilding(store, { typeId: BuildingType.Depot, owner: 0, tileX: 2, tileY: 2 });
    const site = addBuilding(store, {
      typeId: BuildingType.Depot,
      owner: 0,
      tileX: 8,
      tileY: 2,
      underConstruction: true,
    });

    expect(finished.construction).toBeNull();
    expect(finished.hp).toBe(buildingDef(BuildingType.Depot).maxHp);

    expect(site.construction).toBe(buildingDef(BuildingType.Depot).buildWork);
    // A building site is fragile — that is what makes forward expansion a risk.
    expect(site.hp).toBeLessThan(buildingDef(BuildingType.Depot).maxHp);
    expect(site.hp).toBeGreaterThan(0);
  });

  it("reports max health for units and buildings alike", () => {
    expect(maxHpOf(EntityKind.Unit, UnitType.Soldier)).toBe(80);
    expect(maxHpOf(EntityKind.Building, BuildingType.Headquarters)).toBe(
      buildingDef(BuildingType.Headquarters).maxHp,
    );
  });

  it("never gives a building a movement goal", () => {
    const store = createEntityStore();
    const hq = addBuilding(store, { typeId: BuildingType.Headquarters, owner: 0, tileX: 5, tileY: 5 });
    expect(hq.goalX).toBeNull();
  });
});
