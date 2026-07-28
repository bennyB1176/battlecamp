/**
 * Where the camera calls home.
 *
 * The bug this fixes was invisible in every unit test the project had: the game
 * opened on the middle of the map, which on a rotationally symmetric layout is
 * precisely the spot that holds neither base. Everything worked; there was just
 * nothing on screen.
 */

import { describe, expect, it } from "vitest";

import { BuildingType } from "../src/content/buildings.js";
import { UnitType } from "../src/content/units.js";
import { addBuilding, addEntity } from "../src/sim/entities.js";
import { fromTiles, toTiles } from "../src/sim/fixed.js";
import { createWorld, type World } from "../src/sim/world.js";
import { homeView } from "../src/input/home.js";

function emptyWorld(): World {
  return createWorld({ seed: 7, width: 64, height: 64, startingUnits: 0 });
}

/** `tileX`/`tileY` are the footprint's top-left; the entity sits at its centre. */
function building(world: World, tileX: number, tileY: number, owner = 0) {
  return addBuilding(world.entities, {
    typeId: BuildingType.Headquarters,
    owner,
    tileX,
    tileY,
  });
}

function unit(world: World, tileX: number, tileY: number, owner = 0) {
  return addEntity(world.entities, {
    typeId: UnitType.Soldier,
    owner,
    x: fromTiles(tileX),
    y: fromTiles(tileY),
  });
}

describe("homeView", () => {
  it("looks at the player's own base", () => {
    const world = emptyWorld();
    const hq = building(world, 8, 9);

    expect(homeView(world, 0)).toEqual({ x: toTiles(hq.x), y: toTiles(hq.y) });
  });

  it("ignores the opponent's base", () => {
    // The whole point: on a symmetric map the average of both bases is the
    // middle of the map, which is exactly the wrong answer.
    const world = emptyWorld();
    const mine = building(world, 8, 8, 0);
    building(world, 53, 53, 1);

    expect(homeView(world, 0)).toEqual({ x: toTiles(mine.x), y: toTiles(mine.y) });
  });

  it("averages several buildings, so a grown base stays framed", () => {
    const world = emptyWorld();
    building(world, 10, 10);
    building(world, 14, 10);
    building(world, 12, 14);

    // Centres are the origins plus half a 3×3 footprint.
    expect(homeView(world, 0)).toEqual({ x: 13.5, y: 38.5 / 3 });
  });

  it("falls back to the units when every building is gone", () => {
    const world = emptyWorld();
    unit(world, 40, 20);
    unit(world, 42, 20);

    expect(homeView(world, 0)).toEqual({ x: 41, y: 20 });
  });

  it("prefers buildings over units, because a base stays put", () => {
    // An army halfway across the map must not drag the view off the base the
    // player is trying to build in.
    const world = emptyWorld();
    const hq = building(world, 8, 8);
    unit(world, 55, 55);

    expect(homeView(world, 0)).toEqual({ x: toTiles(hq.x), y: toTiles(hq.y) });
  });

  it("settles for the middle of the map when the player owns nothing", () => {
    const world = emptyWorld();
    expect(homeView(world, 0)).toEqual({ x: 32, y: 32 });
  });
});
