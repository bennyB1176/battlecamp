/**
 * The entity store. Every unit and building in the game lives here, so its two
 * properties matter more than its API surface:
 *
 *   - iteration order must be deterministic (it feeds the sim's tick order)
 *   - a removed entity's id must never resolve again (stale ids are the classic
 *     source of "the dead unit still shoots" bugs, and in a networked game they
 *     desync clients rather than merely misbehaving)
 */

import { describe, expect, it } from "vitest";

import { UnitType } from "../src/content/units.js";
import { fromTiles } from "../src/sim/fixed.js";
import {
  addEntity,
  createEntityStore,
  entityCount,
  getEntity,
  removeEntity,
  type EntitySpec,
} from "../src/sim/entities.js";

function spec(overrides: Partial<EntitySpec> = {}): EntitySpec {
  return {
    typeId: UnitType.Worker,
    owner: 0,
    x: fromTiles(5),
    y: fromTiles(5),
    ...overrides,
  };
}

describe("entity store", () => {
  it("starts empty", () => {
    const store = createEntityStore();
    expect(entityCount(store)).toBe(0);
    expect(store.list).toHaveLength(0);
  });

  it("hands out a unique id per entity", () => {
    const store = createEntityStore();
    const ids = new Set([addEntity(store, spec()).id, addEntity(store, spec()).id, addEntity(store, spec()).id]);
    expect(ids.size).toBe(3);
    expect(entityCount(store)).toBe(3);
  });

  it("stores the spec it was given", () => {
    const store = createEntityStore();
    const entity = addEntity(store, spec({ typeId: UnitType.Scout, owner: 1, x: fromTiles(3), y: fromTiles(7) }));

    expect(entity.typeId).toBe(UnitType.Scout);
    expect(entity.owner).toBe(1);
    expect(entity.x).toBe(fromTiles(3));
    expect(entity.y).toBe(fromTiles(7));
  });

  it("starts units at full health for their type", () => {
    const store = createEntityStore();
    expect(addEntity(store, spec({ typeId: UnitType.Soldier })).hp).toBe(80);
  });

  it("looks entities up by id", () => {
    const store = createEntityStore();
    const entity = addEntity(store, spec());
    expect(getEntity(store, entity.id)).toBe(entity);
  });

  it("returns undefined for an unknown id", () => {
    const store = createEntityStore();
    expect(getEntity(store, 9999)).toBeUndefined();
  });

  it("removes an entity and reports whether it did", () => {
    const store = createEntityStore();
    const entity = addEntity(store, spec());

    expect(removeEntity(store, entity.id)).toBe(true);
    expect(getEntity(store, entity.id)).toBeUndefined();
    expect(entityCount(store)).toBe(0);

    // Removing again is a no-op, not a crash — commands can legitimately
    // reference something another command destroyed earlier in the same tick.
    expect(removeEntity(store, entity.id)).toBe(false);
  });

  it("never reuses the id of a removed entity", () => {
    const store = createEntityStore();
    const first = addEntity(store, spec());
    removeEntity(store, first.id);
    const second = addEntity(store, spec());

    expect(second.id).not.toBe(first.id);
    // The crucial part: an order still holding the old id must not silently
    // start applying to whoever took its place.
    expect(getEntity(store, first.id)).toBeUndefined();
  });

  it("keeps the list dense when removing from the middle", () => {
    const store = createEntityStore();
    const a = addEntity(store, spec());
    const b = addEntity(store, spec());
    const c = addEntity(store, spec());

    removeEntity(store, b.id);

    expect(store.list).toHaveLength(2);
    expect(store.list.every((entity) => entity !== undefined)).toBe(true);
    expect(new Set(store.list.map((entity) => entity.id))).toEqual(new Set([a.id, c.id]));
    // Every survivor must still be findable — a swap-remove that forgets to
    // repair the index map breaks exactly here.
    expect(getEntity(store, c.id)?.id).toBe(c.id);
    expect(getEntity(store, a.id)?.id).toBe(a.id);
  });

  it("iterates in the same order for the same sequence of operations", () => {
    const build = (): number[] => {
      const store = createEntityStore();
      const created = Array.from({ length: 20 }, () => addEntity(store, spec()));
      for (const index of [3, 7, 11, 0, 15]) {
        removeEntity(store, created[index]!.id);
      }
      addEntity(store, spec());
      addEntity(store, spec());
      return store.list.map((entity) => entity.id);
    };

    expect(build()).toEqual(build());
  });

  it("finds all entities belonging to a player", () => {
    const store = createEntityStore();
    addEntity(store, spec({ owner: 0 }));
    const mine = addEntity(store, spec({ owner: 1 }));
    addEntity(store, spec({ owner: 0 }));

    expect(store.list.filter((entity) => entity.owner === 1).map((entity) => entity.id)).toEqual([mine.id]);
  });
});
