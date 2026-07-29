/**
 * Every resource has to be spent on something.
 *
 * This test exists because it was not there. Planks had a producer — the
 * sawmill, 140 wood and 60 stone, consuming wood forever — and no consumer at
 * all: not one building cost and not one unit cost named them. So the sawmill
 * was not a decision, it was a trap, and the legend cheerfully explained the
 * refining chain to a player who could do nothing with it.
 *
 * It is the same shape of mistake as a subsystem that works and is never
 * called. Everything passed; the content simply did not close. The test below
 * is the cheap, permanent guard: a resource the game can make and cannot spend
 * fails the build.
 */

import { describe, expect, it } from "vitest";

import { BUILDING_DEFS, buildingDef, type BuildingTypeId } from "../src/content/buildings.js";
import { UNIT_DEFS } from "../src/content/units.js";
import { RAW_KINDS, RESOURCE_KINDS, RESOURCE_NAMES, type ResourceKind } from "../src/sim/resources.js";

const BUILDING_TYPES = Object.keys(BUILDING_DEFS).map(Number) as BuildingTypeId[];

/** Everything that costs this resource, by name. */
function spentOn(kind: ResourceKind): string[] {
  const names: string[] = [];

  for (const def of Object.values(BUILDING_DEFS)) {
    if ((def.cost[kind] ?? 0) > 0) names.push(def.name);
  }
  for (const def of Object.values(UNIT_DEFS)) {
    if ((def.cost[kind] ?? 0) > 0) names.push(def.name);
  }

  return names;
}

/** Everything that produces this resource, by name. */
function producedBy(kind: ResourceKind): string[] {
  return Object.values(BUILDING_DEFS)
    .filter((def) => def.refines?.output === kind)
    .map((def) => def.name);
}

describe("the economy closes", () => {
  it.each(RESOURCE_KINDS)("finds somewhere to spend resource %i", (kind) => {
    expect(
      spentOn(kind),
      `nothing in the game costs ${RESOURCE_NAMES[kind]} — it can be gathered or refined and never used`,
    ).not.toHaveLength(0);
  });

  it("gives every refinery's output more than one buyer", () => {
    // One buyer is a chain that dies with a single balance change, and it also
    // reads as arbitrary: "steel exists so the tank exists". Two or more make
    // the refined good a resource rather than a key.
    for (const kind of RESOURCE_KINDS) {
      if (producedBy(kind).length === 0) continue;
      expect(
        spentOn(kind).length,
        `${RESOURCE_NAMES[kind]} is refined but only ${spentOn(kind).join(", ")} wants it`,
      ).toBeGreaterThan(1);
    }
  });
});

describe("the chain can be started", () => {
  /**
   * Walk the tech tree from an empty board.
   *
   * Start holding only what the ground yields, then repeatedly buy anything the
   * current stock covers and add whatever it refines. Whatever is still
   * unreachable when that stops growing is locked behind itself — a chain with
   * the key inside the box.
   *
   * Stated this way rather than as "no refinery may cost a refined good",
   * which is the tempting version and is simply wrong: a smelter paid for in
   * planks is perfectly reachable, because a sawmill is not.
   */
  function reachableFromNothing(): { buildings: Set<string>; resources: Set<ResourceKind> } {
    const resources = new Set<ResourceKind>(RAW_KINDS);
    const buildings = new Set<string>();

    for (let pass = 0; pass < BUILDING_TYPES.length + 1; pass++) {
      for (const typeId of BUILDING_TYPES) {
        const def = buildingDef(typeId);
        if (buildings.has(def.name)) continue;

        const affordable = RESOURCE_KINDS.every(
          (kind) => (def.cost[kind] ?? 0) === 0 || resources.has(kind),
        );
        if (!affordable) continue;

        buildings.add(def.name);
        if (def.refines) resources.add(def.refines.output);
      }
    }

    return { buildings, resources };
  }

  it("reaches every building from raw materials alone", () => {
    const reached = reachableFromNothing();
    for (const typeId of BUILDING_TYPES) {
      const def = buildingDef(typeId);
      expect(reached.buildings.has(def.name), `${def.name} can never be built`).toBe(true);
    }
  });

  it("reaches every refined resource", () => {
    const reached = reachableFromNothing();
    for (const kind of RESOURCE_KINDS) {
      if (producedBy(kind).length === 0) continue;
      expect(
        reached.resources.has(kind),
        `${RESOURCE_NAMES[kind]} is refined by a building nobody can build`,
      ).toBe(true);
    }
  });

  it("keeps every unit payable by a player who got that far", () => {
    const reached = reachableFromNothing();
    for (const def of Object.values(UNIT_DEFS)) {
      for (const kind of RESOURCE_KINDS) {
        if ((def.cost[kind] ?? 0) === 0) continue;
        expect(
          reached.resources.has(kind),
          `${def.name} costs ${RESOURCE_NAMES[kind]}, which nothing can produce`,
        ).toBe(true);
      }
    }
  });
});
