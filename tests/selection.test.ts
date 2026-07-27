/**
 * Unit selection.
 *
 * Selection deliberately lives outside the simulation. What I have highlighted
 * is my business, not the world's — putting it in the world would mean
 * replays record it and multiplayer clients synchronise it, for no gain.
 *
 * The touch-specific concern here is fat fingers: a unit is a third of a tile
 * wide, and a fingertip is not. Hit testing therefore uses a generous radius,
 * and picks the nearest candidate when several qualify.
 */

import { describe, expect, it } from "vitest";

import { UnitType } from "../src/content/units.js";
import { addEntity, removeEntity } from "../src/sim/entities.js";
import { fromTiles } from "../src/sim/fixed.js";
import { createWorld, type World } from "../src/sim/world.js";
import {
  clearSelection,
  createSelection,
  isSelected,
  pruneSelection,
  selectAt,
  selectInBox,
  selectedEntities,
} from "../src/input/selection.js";

function emptyWorld(): World {
  return createWorld({ seed: 3, width: 32, height: 32, startingUnits: 0 });
}

function spawn(world: World, tileX: number, tileY: number, owner = 0) {
  return addEntity(world.entities, {
    typeId: UnitType.Soldier,
    owner,
    x: fromTiles(tileX),
    y: fromTiles(tileY),
  });
}

describe("tap selection", () => {
  it("selects the unit under the tap", () => {
    const world = emptyWorld();
    const unit = spawn(world, 5, 5);
    const selection = createSelection();

    expect(selectAt(selection, world, fromTiles(5), fromTiles(5), 0)).toBe(true);
    expect(isSelected(selection, unit.id)).toBe(true);
  });

  it("forgives a near miss, because fingers are wider than units", () => {
    const world = emptyWorld();
    spawn(world, 5, 5);
    const selection = createSelection();

    expect(selectAt(selection, world, fromTiles(5.4), fromTiles(5.4), 0)).toBe(true);
  });

  it("reports a miss on empty ground", () => {
    const world = emptyWorld();
    spawn(world, 5, 5);
    const selection = createSelection();

    expect(selectAt(selection, world, fromTiles(20), fromTiles(20), 0)).toBe(false);
    expect(selectedEntities(selection, world)).toHaveLength(0);
  });

  it("picks the nearest of several candidates", () => {
    const world = emptyWorld();
    const near = spawn(world, 5, 5);
    spawn(world, 5.5, 5);
    const selection = createSelection();

    selectAt(selection, world, fromTiles(4.9), fromTiles(5), 0);
    expect(isSelected(selection, near.id)).toBe(true);
    expect(selectedEntities(selection, world)).toHaveLength(1);
  });

  it("will not select another player's units", () => {
    const world = emptyWorld();
    spawn(world, 5, 5, 1);
    const selection = createSelection();

    expect(selectAt(selection, world, fromTiles(5), fromTiles(5), 0)).toBe(false);
  });

  it("replaces the previous selection", () => {
    const world = emptyWorld();
    const first = spawn(world, 5, 5);
    const second = spawn(world, 15, 15);
    const selection = createSelection();

    selectAt(selection, world, fromTiles(5), fromTiles(5), 0);
    selectAt(selection, world, fromTiles(15), fromTiles(15), 0);

    expect(isSelected(selection, first.id)).toBe(false);
    expect(isSelected(selection, second.id)).toBe(true);
  });
});

describe("box selection", () => {
  it("selects every own unit inside the box", () => {
    const world = emptyWorld();
    const inside = [spawn(world, 5, 5), spawn(world, 6, 6), spawn(world, 7, 5)];
    const outside = spawn(world, 20, 20);
    const selection = createSelection();

    selectInBox(selection, world, fromTiles(4), fromTiles(4), fromTiles(8), fromTiles(8), 0);

    expect(selectedEntities(selection, world)).toHaveLength(inside.length);
    expect(isSelected(selection, outside.id)).toBe(false);
  });

  it("accepts a box dragged in any direction", () => {
    const world = emptyWorld();
    spawn(world, 5, 5);
    const selection = createSelection();

    // Dragged up and to the left — the corners arrive reversed.
    selectInBox(selection, world, fromTiles(8), fromTiles(8), fromTiles(4), fromTiles(4), 0);
    expect(selectedEntities(selection, world)).toHaveLength(1);
  });

  it("leaves enemy units alone", () => {
    const world = emptyWorld();
    spawn(world, 5, 5, 1);
    const selection = createSelection();

    selectInBox(selection, world, fromTiles(0), fromTiles(0), fromTiles(30), fromTiles(30), 0);
    expect(selectedEntities(selection, world)).toHaveLength(0);
  });

  it("clears the selection when the box is empty", () => {
    const world = emptyWorld();
    const unit = spawn(world, 5, 5);
    const selection = createSelection();

    selectAt(selection, world, fromTiles(5), fromTiles(5), 0);
    selectInBox(selection, world, fromTiles(20), fromTiles(20), fromTiles(25), fromTiles(25), 0);

    expect(isSelected(selection, unit.id)).toBe(false);
  });
});

describe("selection bookkeeping", () => {
  it("clears on request", () => {
    const world = emptyWorld();
    spawn(world, 5, 5);
    const selection = createSelection();

    selectAt(selection, world, fromTiles(5), fromTiles(5), 0);
    clearSelection(selection);
    expect(selectedEntities(selection, world)).toHaveLength(0);
  });

  it("forgets units that no longer exist", () => {
    const world = emptyWorld();
    const unit = spawn(world, 5, 5);
    const selection = createSelection();

    selectAt(selection, world, fromTiles(5), fromTiles(5), 0);
    removeEntity(world.entities, unit.id);
    pruneSelection(selection, world);

    // Without pruning, the HUD would keep counting a unit that died, and orders
    // would be issued for an id the sim quietly ignores.
    expect(selection.ids.size).toBe(0);
  });

  it("skips missing entities when listing the selection", () => {
    const world = emptyWorld();
    const unit = spawn(world, 5, 5);
    const selection = createSelection();

    selectAt(selection, world, fromTiles(5), fromTiles(5), 0);
    removeEntity(world.entities, unit.id);

    expect(selectedEntities(selection, world)).toHaveLength(0);
  });
});
