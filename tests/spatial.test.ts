/**
 * The spatial hash answers "who is near this point?" without comparing every
 * entity against every other one.
 *
 * At 500 units a brute-force neighbour search is 250 000 distance checks per
 * tick, which is precisely the budget we do not have on a phone. The risk with
 * any such index is that it is *subtly* wrong — missing a neighbour that sits
 * just across a cell boundary — so the core test compares it against brute
 * force over many randomised layouts rather than over a few hand-picked ones.
 */

import { describe, expect, it } from "vitest";

import { UnitType } from "../src/content/units.js";
import { addEntity, createEntityStore, type Entity } from "../src/sim/entities.js";
import { distSq, fromTiles, ONE } from "../src/sim/fixed.js";
import { createSpatialHash, queryRadius, rebuildSpatialHash } from "../src/sim/spatial.js";
import { createRng, nextInt } from "../src/sim/rng.js";

function makeEntities(positions: ReadonlyArray<readonly [number, number]>): Entity[] {
  const store = createEntityStore();
  for (const [x, y] of positions) {
    addEntity(store, { typeId: UnitType.Worker, owner: 0, x, y });
  }
  return store.list;
}

function idsWithin(entities: readonly Entity[], x: number, y: number, radius: number): number[] {
  return entities
    .filter((entity) => distSq(entity.x, entity.y, x, y) <= radius * radius)
    .map((entity) => entity.id)
    .sort((a, b) => a - b);
}

describe("spatial hash", () => {
  it("returns nothing when empty", () => {
    const hash = createSpatialHash(2 * ONE);
    rebuildSpatialHash(hash, []);
    expect(queryRadius(hash, fromTiles(5), fromTiles(5), fromTiles(3), [])).toEqual([]);
  });

  it("finds an entity at the query point", () => {
    const entities = makeEntities([[fromTiles(5), fromTiles(5)]]);
    const hash = createSpatialHash(2 * ONE);
    rebuildSpatialHash(hash, entities);

    expect(queryRadius(hash, fromTiles(5), fromTiles(5), fromTiles(1), [])).toHaveLength(1);
  });

  it("excludes an entity outside the radius", () => {
    const entities = makeEntities([[fromTiles(20), fromTiles(20)]]);
    const hash = createSpatialHash(2 * ONE);
    rebuildSpatialHash(hash, entities);

    expect(queryRadius(hash, fromTiles(5), fromTiles(5), fromTiles(3), [])).toEqual([]);
  });

  it("includes an entity exactly on the radius", () => {
    const entities = makeEntities([[fromTiles(8), fromTiles(5)]]);
    const hash = createSpatialHash(2 * ONE);
    rebuildSpatialHash(hash, entities);

    expect(queryRadius(hash, fromTiles(5), fromTiles(5), fromTiles(3), [])).toHaveLength(1);
  });

  it("finds neighbours across a cell boundary", () => {
    // Two units a hair apart, deliberately straddling the line between cells.
    const cellSize = 2 * ONE;
    const entities = makeEntities([
      [cellSize - 1, fromTiles(5)],
      [cellSize + 1, fromTiles(5)],
    ]);
    const hash = createSpatialHash(cellSize);
    rebuildSpatialHash(hash, entities);

    expect(queryRadius(hash, cellSize, fromTiles(5), fromTiles(0.5), [])).toHaveLength(2);
  });

  it("returns each entity at most once", () => {
    const entities = makeEntities(
      Array.from({ length: 30 }, (_, i) => [fromTiles(5 + (i % 6)), fromTiles(5 + Math.floor(i / 6))] as const),
    );
    const hash = createSpatialHash(2 * ONE);
    rebuildSpatialHash(hash, entities);

    const found = queryRadius(hash, fromTiles(7), fromTiles(6), fromTiles(20), []);
    expect(new Set(found.map((entity) => entity.id)).size).toBe(found.length);
  });

  it("clears the output array it is handed", () => {
    const entities = makeEntities([[fromTiles(5), fromTiles(5)]]);
    const hash = createSpatialHash(2 * ONE);
    rebuildSpatialHash(hash, entities);

    // Reusing one scratch array across ticks is the point — it must not
    // accumulate stale results from the previous query.
    const out: Entity[] = [];
    queryRadius(hash, fromTiles(5), fromTiles(5), fromTiles(1), out);
    queryRadius(hash, fromTiles(50), fromTiles(50), fromTiles(1), out);
    expect(out).toEqual([]);
  });

  it("forgets entities from the previous rebuild", () => {
    const first = makeEntities([[fromTiles(5), fromTiles(5)]]);
    const hash = createSpatialHash(2 * ONE);
    rebuildSpatialHash(hash, first);
    rebuildSpatialHash(hash, []);

    expect(queryRadius(hash, fromTiles(5), fromTiles(5), fromTiles(3), [])).toEqual([]);
  });

  it("agrees with brute force across randomised layouts", () => {
    const rng = createRng(4242);

    for (let round = 0; round < 200; round++) {
      const count = nextInt(rng, 40) + 1;
      const entities = makeEntities(
        Array.from({ length: count }, () => [nextInt(rng, fromTiles(30)), nextInt(rng, fromTiles(30))] as const),
      );

      // Vary the cell size too: a hash that only works when cells happen to be
      // larger than the query radius is a hash that will fail in the field.
      const hash = createSpatialHash(fromTiles(1 + nextInt(rng, 4)));
      rebuildSpatialHash(hash, entities);

      const qx = nextInt(rng, fromTiles(30));
      const qy = nextInt(rng, fromTiles(30));
      const radius = fromTiles(1) + nextInt(rng, fromTiles(6));

      const actual = queryRadius(hash, qx, qy, radius, [])
        .map((entity) => entity.id)
        .sort((a, b) => a - b);

      expect(actual).toEqual(idsWithin(entities, qx, qy, radius));
    }
  });

  it("handles negative coordinates without colliding cells", () => {
    // Positions stay inside the map in practice, but a key function that folds
    // negatives onto positives would silently return wrong neighbours.
    const entities = makeEntities([
      [fromTiles(-5), fromTiles(-5)],
      [fromTiles(5), fromTiles(5)],
    ]);
    const hash = createSpatialHash(2 * ONE);
    rebuildSpatialHash(hash, entities);

    expect(queryRadius(hash, fromTiles(-5), fromTiles(-5), fromTiles(1), [])).toHaveLength(1);
  });
});
