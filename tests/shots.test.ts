/**
 * Shots you can see.
 *
 * Before this, a battle was two clumps of shapes standing still while health
 * bars quietly went down — combat is the one system in the game with no other
 * visible sign of itself.
 *
 * Two halves are worth testing. The simulation has to *report* shots at all,
 * because the renderer cannot work them out: a unit shooting something it
 * noticed by itself never records that target, so most shots would be invisible
 * from outside. And the report has to stay out of the hash and out of a saved
 * game, or a cosmetic detail becomes something two machines can disagree about.
 */

import { describe, expect, it } from "vitest";

import { UnitType } from "../src/content/units.js";
import { addEntity, type Entity } from "../src/sim/entities.js";
import { fromTiles, toTiles } from "../src/sim/fixed.js";
import { createGrid, Terrain } from "../src/sim/grid.js";
import { hashWorldHex } from "../src/sim/hash.js";
import { restoreWorld, snapshotWorld } from "../src/sim/snapshot.js";
import { createWorld, tickWorld, type World } from "../src/sim/world.js";
import {
  shotIsVisible,
  TRACER_FLIGHT_MS,
  createTracerStore,
  tracerPosition,
  tracerProgress,
  updateTracers,
} from "../src/render/shots.js";

function arena(size = 40): World {
  const world = createWorld({ seed: 5, width: size, height: size, startingUnits: 0 });
  world.grid.tiles.set(createGrid(size, size, Terrain.Grass).tiles);
  world.grid.blocked.fill(0);
  world.deposits.fill(0);
  return world;
}

function soldier(world: World, owner: number, tileX: number, tileY: number): Entity {
  return addEntity(world.entities, {
    typeId: UnitType.Soldier,
    owner,
    x: fromTiles(tileX),
    y: fromTiles(tileY),
  });
}

/** Two soldiers close enough to shoot each other. */
function duel(): World {
  const world = arena();
  soldier(world, 0, 20, 20);
  soldier(world, 1, 20.8, 20);
  return world;
}

describe("the simulation reports its shots", () => {
  it("records a shot when something fires", () => {
    const world = duel();
    for (let i = 0; i < 20 && world.shots.length === 0; i++) tickWorld(world);

    expect(world.shots.length, "nobody ever fired").toBeGreaterThan(0);
  });

  it("says who fired and where it went", () => {
    const world = duel();
    for (let i = 0; i < 20 && world.shots.length === 0; i++) tickWorld(world);

    const shot = world.shots[0]!;
    expect([0, 1]).toContain(shot.playerId);
    // Aimed across the gap, not at itself.
    expect(Math.abs(toTiles(shot.toX) - toTiles(shot.fromX))).toBeGreaterThan(0.5);
  });

  it("reports shots at targets nobody ordered", () => {
    // The reason this lives in the simulation at all: an auto-acquired enemy is
    // never written down as an order, so a watcher outside could not tell what
    // was being shot at. Two idle soldiers in range shoot each other on their
    // own initiative, and those shots have to show up.
    const world = duel();
    for (let i = 0; i < 20 && world.shots.length === 0; i++) tickWorld(world);

    for (const entity of world.entities.list) {
      expect(entity.attackTargetId, "the test accidentally issued an order").toBeNull();
    }
    expect(world.shots.length).toBeGreaterThan(0);
  });

  it("clears the list at the start of every tick", () => {
    // Otherwise the list grows for the whole match and the renderer redraws
    // twenty minutes of gunfire on every frame.
    const world = duel();
    for (let i = 0; i < 20 && world.shots.length === 0; i++) tickWorld(world);
    expect(world.shots.length).toBeGreaterThan(0);

    // Far enough apart that neither can fire.
    for (const entity of world.entities.list) entity.x = fromTiles(entity.owner * 30 + 2);
    tickWorld(world);

    expect(world.shots).toHaveLength(0);
  });
});

describe("a tracer is not simulation state", () => {
  it("stays out of the world hash", () => {
    // Nothing reads it back, so two machines disagreeing about a tracer cannot
    // diverge — and hashing a list that changes every tick would cost for free.
    const world = duel();
    for (let i = 0; i < 20 && world.shots.length === 0; i++) tickWorld(world);

    const before = hashWorldHex(world);
    world.shots.push({ playerId: 0, fromX: 1, fromY: 2, toX: 3, toY: 4 });
    expect(hashWorldHex(world)).toBe(before);
  });

  it("is not carried into a saved game", () => {
    const world = duel();
    for (let i = 0; i < 20 && world.shots.length === 0; i++) tickWorld(world);

    const restored = restoreWorld(JSON.parse(JSON.stringify(snapshotWorld(world))));
    expect(restored.shots).toHaveLength(0);
    expect(hashWorldHex(restored)).toBe(hashWorldHex(world));
  });
});

describe("where a dot is at any moment", () => {
  const shot = { fromX: fromTiles(10), fromY: fromTiles(10), toX: fromTiles(20), toY: fromTiles(10) };

  it("starts at the shooter and ends at the target", () => {
    expect(tracerPosition({ ...shot, age: 0 }).x).toBeCloseTo(10, 6);
    expect(tracerPosition({ ...shot, age: TRACER_FLIGHT_MS }).x).toBeCloseTo(20, 6);
  });

  it("is halfway across at half the flight", () => {
    expect(tracerPosition({ ...shot, age: TRACER_FLIGHT_MS / 2 }).x).toBeCloseTo(15, 6);
  });

  it("never overshoots on a late frame", () => {
    // A backgrounded tab hands back a frame gap of seconds. A dot that ran on
    // past its target would draw somewhere nothing happened.
    expect(tracerPosition({ ...shot, age: 99_999 }).x).toBeCloseTo(20, 6);
    expect(tracerProgress(-50)).toBe(0);
    expect(tracerProgress(99_999)).toBe(1);
  });
});

describe("the tracer store", () => {
  it("takes each tick's shots exactly once", () => {
    // The renderer runs six times per tick at sixty frames a second. Taking the
    // list on every call would stack six copies of every shot.
    const world = duel();
    for (let i = 0; i < 20 && world.shots.length === 0; i++) tickWorld(world);
    const fired = world.shots.length;

    const store = createTracerStore();
    for (let frame = 0; frame < 6; frame++) updateTracers(store, world, 0, 16);

    expect(store.live).toHaveLength(fired);
  });

  it("lets them expire rather than piling up", () => {
    const world = duel();
    for (let i = 0; i < 20 && world.shots.length === 0; i++) tickWorld(world);

    const store = createTracerStore();
    updateTracers(store, world, 0, 0);
    expect(store.live.length).toBeGreaterThan(0);

    updateTracers(store, world, 0, TRACER_FLIGHT_MS + 1);
    expect(store.live).toHaveLength(0);
  });
});

describe("the fog still holds", () => {
  it("shows fire that lands where the player can see", () => {
    const world = duel();
    // Player 0's own soldier is standing there, so the ground is lit.
    for (let i = 0; i < 20 && world.shots.length === 0; i++) tickWorld(world);

    expect(world.shots.some((shot) => shotIsVisible(world, 0, shot))).toBe(true);
  });

  it("hides a firefight between two others in the dark", () => {
    // Judged on where a shot *lands*. Anything else would reveal an ambush the
    // moment it opened up, which is the one thing the fog is for.
    const world = createWorld({ seed: 5, width: 40, height: 40, startingUnits: 0, playerCount: 3 });
    world.grid.tiles.set(createGrid(40, 40, Terrain.Grass).tiles);
    world.grid.blocked.fill(0);

    soldier(world, 1, 30, 30);
    soldier(world, 2, 30.8, 30);
    soldier(world, 0, 3, 3);

    for (let i = 0; i < 20 && world.shots.length === 0; i++) tickWorld(world);

    expect(world.shots.length, "the two strangers never fired").toBeGreaterThan(0);
    expect(world.shots.every((shot) => !shotIsVisible(world, 0, shot))).toBe(true);
  });
});
