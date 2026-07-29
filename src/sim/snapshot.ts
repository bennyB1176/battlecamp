/**
 * Saving a match and putting it back.
 *
 * A phone call, a locked screen, a browser deciding to reclaim a tab — any of
 * them used to cost the whole game. This is the fix, and it is also the point
 * at which the deterministic core stops being an internal virtue: the property
 * that made it worth building is exactly the property that makes a snapshot
 * *checkable*. A restored world has to hash the same as the one it came from,
 * and has to keep hashing the same as both run on.
 *
 * What is deliberately left out:
 *
 * - **Flow fields and the spatial hash.** Caches, rebuilt from the world within
 *   a tick. Storing them would multiply the save size for nothing.
 * - **Bot state.** A bot is a pair of hands on a controller, not part of the
 *   world. Restored opponents re-read the board and carry on; at worst an
 *   attack that was already under way is decided again.
 * - **Anything the renderer keeps.** Interpolation, facing, terrain images —
 *   all cosmetic, all derived.
 *
 * Typed arrays travel as base64 rather than as JSON number lists. A 64×64 map
 * has five of them; spelled out as `[0,0,4,0,…]` a save runs to hundreds of
 * kilobytes of text, which is a real cost against a browser storage quota.
 */

import { Biome, type BiomeId } from "../content/biomes.js";
import { createEntityStore, type Entity, type EntityStore } from "./entities.js";
import { ONE } from "./fixed.js";
import { createGrid, type TileGrid } from "./grid.js";
import { createFlowFieldCache } from "./pathing.js";
import { createSpatialHash } from "./spatial.js";
import { createPlayer, RESOURCE_KINDS, type Player, type ResourceKind } from "./resources.js";
import { createStats, type MatchStats } from "./stats.js";
import { createVision, updateVision, type PlayerVision } from "./vision.js";
import type { Marker, World } from "./world.js";

/**
 * Bumped whenever the shape below changes.
 *
 * A save from another version is refused outright rather than read as best it
 * can be: a silently mis-read snapshot hands the player a world that is wrong
 * in ways nothing will ever report.
 */
export const SNAPSHOT_VERSION = 1;

export interface WorldSnapshot {
  readonly version: number;
  readonly seed: number;
  readonly tick: number;
  readonly rngState: number;
  readonly width: number;
  readonly height: number;
  /** Not used to rebuild the map — kept so the game can say what was played. */
  readonly biome: BiomeId;
  /** base64 of the terrain bytes. */
  readonly tiles: string;
  readonly blocked: string;
  /** base64 of the Int32 deposit counts. */
  readonly deposits: string;
  readonly players: ReadonlyArray<{ id: number; resources: Record<string, number> }>;
  readonly stats: readonly MatchStats[];
  readonly explored: readonly string[];
  readonly entities: readonly Entity[];
  readonly nextEntityId: number;
  readonly markers: readonly Marker[];
  readonly winner: number | null;
  readonly matchOver: boolean;
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  // Chunked: `String.fromCharCode(...bytes)` on a 64×64 map is six thousand
  // arguments, and on a larger one it overflows the call stack outright.
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function fromBase64(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function int32ToBase64(values: Int32Array): string {
  return toBase64(new Uint8Array(values.buffer, values.byteOffset, values.byteLength));
}

function int32FromBase64(text: string, length: number): Int32Array {
  const bytes = fromBase64(text);
  const result = new Int32Array(length);
  new Uint8Array(result.buffer).set(bytes.subarray(0, result.byteLength));
  return result;
}

export function snapshotWorld(world: World): WorldSnapshot {
  return {
    version: SNAPSHOT_VERSION,
    seed: world.seed,
    tick: world.tick,
    rngState: world.rng.state,
    width: world.grid.width,
    height: world.grid.height,
    biome: world.biome,
    tiles: toBase64(world.grid.tiles),
    blocked: toBase64(world.grid.blocked),
    deposits: int32ToBase64(world.deposits),
    players: world.players.map((player) => ({
      id: player.id,
      resources: { ...player.resources } as unknown as Record<string, number>,
    })),
    stats: world.stats.map((stats) => ({
      gathered: { ...stats.gathered },
      unitsTrained: stats.unitsTrained,
      buildingsBuilt: stats.buildingsBuilt,
      unitsLost: stats.unitsLost,
      buildingsLost: stats.buildingsLost,
    })),
    // Only what has been *seen*. What is visible right now is recomputed from
    // where everything stands, so storing it would be paying twice.
    explored: world.vision.map((vision) => toBase64(vision.explored)),
    entities: world.entities.list.map((entity) => ({
      ...entity,
      job: entity.job ? { ...entity.job } : null,
      production: entity.production
        ? { ...entity.production, queue: [...entity.production.queue] }
        : null,
      refinery: entity.refinery ? { ...entity.refinery } : null,
    })),
    nextEntityId: world.entities.nextId,
    markers: world.markers.map((marker) => ({ ...marker })),
    winner: world.winner,
    matchOver: world.matchOver,
  };
}

function require<T>(value: T | undefined | null, what: string): T {
  if (value === undefined || value === null) throw new Error(`snapshot is missing ${what}`);
  return value;
}

export function restoreWorld(raw: unknown): World {
  if (typeof raw !== "object" || raw === null) throw new Error("snapshot is not an object");
  const snapshot = raw as Partial<WorldSnapshot>;

  if (snapshot.version !== SNAPSHOT_VERSION) {
    throw new Error(`snapshot version ${String(snapshot.version)} cannot be read`);
  }

  const width = require(snapshot.width, "width");
  const height = require(snapshot.height, "height");
  const grid: TileGrid = createGrid(width, height);
  grid.tiles.set(fromBase64(require(snapshot.tiles, "tiles")));
  grid.blocked.set(fromBase64(require(snapshot.blocked, "blocked")));

  const players: Player[] = require(snapshot.players, "players").map((saved) => {
    const player = createPlayer(saved.id);
    for (const kind of RESOURCE_KINDS) {
      player.resources[kind] = saved.resources[String(kind)] ?? 0;
    }
    return player;
  });

  const stats: MatchStats[] = require(snapshot.stats, "stats").map((saved) => {
    const restored = createStats();
    for (const kind of RESOURCE_KINDS) {
      restored.gathered[kind] = saved.gathered[kind as ResourceKind] ?? 0;
    }
    restored.unitsTrained = saved.unitsTrained;
    restored.buildingsBuilt = saved.buildingsBuilt;
    restored.unitsLost = saved.unitsLost;
    restored.buildingsLost = saved.buildingsLost;
    return restored;
  });

  const vision: PlayerVision[] = require(snapshot.explored, "vision").map((saved) => {
    const restored = createVision(width, height);
    restored.explored.set(fromBase64(saved));
    return restored;
  });

  const entities: EntityStore = createEntityStore();
  for (const saved of require(snapshot.entities, "entities")) {
    const entity: Entity = {
      ...saved,
      job: saved.job ? { ...saved.job } : null,
      production: saved.production
        ? { ...saved.production, queue: [...saved.production.queue] }
        : null,
      refinery: saved.refinery ? { ...saved.refinery } : null,
    };
    entities.list.push(entity);
    entities.indexById.set(entity.id, entities.list.length - 1);
  }
  entities.nextId = require(snapshot.nextEntityId, "nextEntityId");

  const world: World = {
    seed: require(snapshot.seed, "seed"),
    biome: snapshot.biome ?? Biome.Grassland,
    tick: require(snapshot.tick, "tick"),
    rng: { state: require(snapshot.rngState, "rngState") },
    grid,
    deposits: int32FromBase64(require(snapshot.deposits, "deposits"), width * height),
    players,
    stats,
    vision,
    entities,
    fields: createFlowFieldCache(48),
    spatial: createSpatialHash(2 * ONE),
    // A restored world has to draw itself before it ticks, so the renderer is
    // told up front that everything it cached belongs to a different match.
    terrainDirty: true,
    terrainVersion: 1,
    winner: snapshot.winner ?? null,
    matchOver: snapshot.matchOver ?? false,
    markers: (snapshot.markers ?? []).map((marker) => ({ ...marker })),
    // Not saved and not restored: tracers describe a tenth of a second that is
    // already over by the time anyone loads the game.
    shots: [],
  };

  // Rebuilt rather than stored: it is a pure function of where things stand,
  // and recomputing it costs one pass over the entities.
  updateVision(world);

  return world;
}
