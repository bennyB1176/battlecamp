/**
 * The world: all simulation state, and the single `tick` function that advances
 * it.
 *
 * Rules this module lives by, enforced by tests in `tests/determinism.test.ts`:
 *
 *   - no DOM, no `window`, no `Date.now()`, no `Math.random()`
 *   - time is measured in ticks, never in milliseconds
 *   - every mutation happens inside `tick`, driven by commands
 *
 * Keeping the sim this pure is what lets it run headless in CI (bot-vs-bot
 * balance matches from M4) and in a worker or on a server later on.
 */

import { Biome, biomeDef, type BiomeId } from "../content/biomes.js";
import { BuildingType, buildingDef } from "../content/buildings.js";
import { UnitType } from "../content/units.js";
import { applyCommand, type Command } from "./commands.js";
import {
  addEntity,
  buildingOrigin,
  createEntityStore,
  type Entity,
  type EntityStore,
  type PlayerId,
} from "./entities.js";
import { updateCombat } from "./combat.js";
import { placeBuildingAt, updateConstruction } from "./construction.js";
import { updateEconomy } from "./economy.js";
import { ONE, tileCenter } from "./fixed.js";
import { generateMap } from "./mapgen.js";
import {
  findLargestRegion,
  findRegionFrom,
  isBlocked,
  isBuildable,
  isInside,
  isPassable,
  setTerrain,
  terrainAt,
  Terrain,
  type TileGrid,
} from "./grid.js";
import { updateMovement } from "./movement.js";
import { createFlowFieldCache, invalidateFlowFields, type FlowFieldCache } from "./pathing.js";
import { updateProduction } from "./production.js";
import { updateFood } from "./food.js";
import { updateRefineries } from "./refinery.js";
import {
  createPlayer,
  RAW_KINDS,
  Resource,
  resourceOfTerrain,
  stockDeposits,
  terrainOfResource,
  type Player,
  type ResourceKind,
} from "./resources.js";
import { createStats, type MatchStats } from "./stats.js";
import { createVision, updateVision, type PlayerVision } from "./vision.js";
import { updateVictory } from "./victory.js";
import { createRng, type Rng } from "./rng.js";
import { createSpatialHash, type SpatialHash } from "./spatial.js";

// Re-exported so existing importers keep working; the definitions live in
// constants.ts to stay importable from content tables without a cycle.
export { MS_PER_TICK, TICKS_PER_SECOND } from "./constants.js";

export interface Marker {
  readonly playerId: number;
  readonly tileX: number;
  readonly tileY: number;
  /** Counts down each tick; the marker is removed when it reaches zero. */
  ticksLeft: number;
}

export interface WorldConfig {
  readonly seed: number;
  readonly width: number;
  readonly height: number;
  /**
   * Units handed to player 0 at the start.
   *
   * A placeholder for M2, where units come out of a headquarters instead. Tests
   * that want an empty world pass 0.
   */
  readonly startingUnits: number;
  /** Which kind of place this is. Decides terrain mix and resource density. */
  readonly biome: BiomeId;
  /**
   * How many sides are in the match, the human included.
   *
   * Free-for-all: nobody is allied with anybody, so every side is every other
   * side's enemy and the last one standing wins. Bounded by the anchor table
   * below, which is what decides where a fourth base could even go.
   */
  readonly playerCount: number;
}

export const DEFAULT_WORLD_CONFIG: WorldConfig = {
  seed: 1,
  width: 64,
  height: 64,
  startingUnits: 12,
  biome: Biome.Grassland,
  playerCount: 2,
};

/** Most sides a match can have, set by the start-anchor table. */
export const MAX_PLAYERS = 4;

/**
 * Opening stock: enough for a depot and a few workers, not enough to skip
 * gathering. The point of a starting pile is to remove the first two dull
 * minutes, not to remove the first decision.
 */
const STARTING_STOCK = {
  [Resource.Wood]: 300,
  [Resource.Stone]: 150,
  [Resource.Ore]: 0,
};

export interface World {
  readonly seed: number;
  /**
   * Which kind of place this is.
   *
   * The simulation never reads it — the biome's work is done the moment the map
   * exists. It is carried anyway because everything *around* the simulation
   * wants it: the status readout, a saved game, and any future rematch button.
   */
  readonly biome: BiomeId;
  /** Ticks elapsed since the start of the match. The sim's only clock. */
  tick: number;
  readonly rng: Rng;
  readonly grid: TileGrid;
  /** Remaining yield per tile, parallel to grid.tiles. Zero where nothing grows. */
  readonly deposits: Int32Array;
  readonly players: Player[];
  /**
   * The match tally, one entry per player and indexed by player id.
   *
   * Beside the players rather than inside them: a `Player` is what somebody
   * owns and can spend, and what they have done so far is a different question
   * that only the result screen asks.
   */
  readonly stats: MatchStats[];
  /**
   * Fog of war, one entry per player and indexed by player id.
   *
   * In the world rather than beside the renderer because the bots read it: an
   * opponent that plays off the true state of the map while the player plays
   * off a lit patch of it is not a difficulty setting, it is a different game.
   */
  readonly vision: PlayerVision[];
  readonly entities: EntityStore;
  /** Shared flow fields, keyed by goal tile. Invalidated when terrain changes. */
  readonly fields: FlowFieldCache;
  /** Rebuilt each tick; used for separation now, for combat from M3. */
  readonly spatial: SpatialHash;
  /**
   * Set by anything that changes terrain — a felled forest, a finished
   * building. The tick clears it after invalidating cached paths and telling
   * the renderer its terrain image is stale, so no caller has to remember both.
   */
  terrainDirty: boolean;
  /**
   * Bumped whenever terrain changed. The renderer keeps the version it last
   * drew and rebuilds its terrain image when the two differ — a pull, so the
   * simulation never needs to know a renderer exists.
   */
  terrainVersion: number;
  /** Set once the match is decided. Null winner with matchOver means a draw. */
  winner: PlayerId | null;
  matchOver: boolean;
  markers: Marker[];
}

export function createWorld(config: Partial<WorldConfig> = {}): World {
  const { seed, width, height, startingUnits, biome } = { ...DEFAULT_WORLD_CONFIG, ...config };
  // Clamped rather than trusted: a saved game or a hand-edited link can ask for
  // five, and there is nowhere on the map to put a fifth base.
  const playerCount = Math.min(MAX_PLAYERS, Math.max(2, config.playerCount ?? DEFAULT_WORLD_CONFIG.playerCount));

  // Map generation gets its own generator so that later changes to how many
  // random numbers the runtime sim draws cannot alter the map for a given seed.
  const mapRng = createRng(seed);
  const grid = generateMap(mapRng, width, height, biomeDef(biome));

  const world: World = {
    seed,
    biome,
    tick: 0,
    rng: createRng((seed ^ 0x9e3779b9) >>> 0),
    grid,
    deposits: new Int32Array(width * height),
    // Everybody starts on identical books. In a free-for-all that matters more
    // than in a duel: three opponents who each began with something different
    // would make the result unreadable.
    players: Array.from({ length: playerCount }, (_, id) => createPlayer(id, STARTING_STOCK)),
    stats: Array.from({ length: playerCount }, () => createStats()),
    vision: Array.from({ length: playerCount }, () => createVision(width, height)),
    entities: createEntityStore(),
    // Sized for how many *distinct* goals exist at once, which is what actually
    // drives the cache. Every gathering worker walks to its own deposit tile, so
    // a two-player match with full economies easily holds dozens of live goals.
    //
    // Getting this wrong is expensive in a way that hides: at eight entries the
    // cache thrashed, every miss recomputed a full Dijkstra over the map, and
    // the simulation went from 0.04 ms to 8 ms per tick — a 190x slowdown that
    // looked like "the bots are slow" rather than "the cache is too small".
    // Each field is about 20 KB on a 64x64 map, so this costs roughly a megabyte.
    fields: createFlowFieldCache(48),
    // Cell size tracks the separation query radius — roughly two tiles.
    spatial: createSpatialHash(2 * ONE),
    terrainDirty: false,
    terrainVersion: 0,
    winner: null,
    matchOver: false,
    markers: [],
  };

  stockDeposits(world);

  if (startingUnits > 0) spawnStartingUnits(world, startingUnits);

  // Before anyone gets to look at the world. Without it the first frame draws
  // an entirely black map, and a bot asked for its opening move on tick zero
  // would be told, truthfully, that it cannot even see its own front yard.
  updateVision(world);

  return world;
}

/**
 * Set up the opening positions — one base per player.
 *
 * Anchors come from a fixed table of normalised spots rather than trigonometry:
 * `Math.cos` is not guaranteed bit-identical across engines, and where a base
 * stands is simulation state, not decoration.
 *
 * From each anchor the search spirals outward for ground that will actually
 * take a headquarters, so a lake or a ridge on a generated map moves a start
 * rather than breaking it.
 *
 * M8 replaces this with a proper generator that guarantees mirrored terrain and
 * equal resources; this version only guarantees the parts a match cannot do
 * without.
 */
const START_ANCHORS: Readonly<Record<number, ReadonlyArray<readonly [number, number]>>> = {
  1: [[0.5, 0.5]],
  // Opposite corners rather than opposite edges: the diagonal is the longest
  // line on the map, which leaves the most room between the two economies.
  2: [
    [0.2, 0.2],
    [0.8, 0.8],
  ],
  3: [
    [0.2, 0.2],
    [0.8, 0.25],
    [0.5, 0.8],
  ],
  4: [
    [0.2, 0.2],
    [0.8, 0.2],
    [0.2, 0.8],
    [0.8, 0.8],
  ],
};

function spawnStartingUnits(world: World, count: number): void {
  const anchors = START_ANCHORS[world.players.length] ?? START_ANCHORS[2]!;

  // Work out which ground is the real map before placing anything. Generated
  // maps have islands and pockets, and a base dropped into one is a match
  // nobody can play — the armies never meet and a small pocket starves the
  // economy besides.
  let shared = findLargestRegion(world.grid);

  world.players.forEach((player, index) => {
    const anchor = anchors[index % anchors.length]!;
    const home = spawnBase(
      world,
      player.id,
      Math.floor(world.grid.width * anchor[0]),
      Math.floor(world.grid.height * anchor[1]),
      count,
      shared,
    );

    // Re-measure from the ground this base actually opens onto, for two
    // reasons. A three-by-three footprint can sever a narrow neck and split the
    // map, so the mask computed a moment ago may already be out of date; and
    // "the largest region" is only the right question for the first player —
    // after that the right question is "the region the others are in".
    if (home) {
      seedNearbyResources(world, home);
      shared = findRegionFrom(world.grid, home.tileX, home.tileY);
    }
  });
}

/**
 * How far from home a seam still counts as this player's.
 *
 * Beyond it the round trip costs more than the load is worth, and the answer
 * stops being "walk further" and becomes "build a depot out there" — which is a
 * decision, not an opening.
 */
const START_REACH_TILES = 12;

/** Tiles of a resource a start needs before it counts as supplied. */
const START_TILES_WANTED = 6;

/**
 * Make sure a start has all three raw resources within walking distance.
 *
 * The generator scatters seams as a handful of clusters, and stone got the
 * fewest: on a sixty-four square map it produced ten to twenty-eight tiles,
 * against a thousand of forest. Nearly every building in the game costs stone,
 * so most starts simply could not build one — the bots banked thousands of ore
 * they could never spend, never raised a second refinery, and looked broken for
 * an hour before the fault turned out to be in the map rather than in them.
 *
 * M8's generator will do this properly, with mirrored terrain and matched
 * seams. This guarantees only the part a match cannot do without: that the cost
 * tables describe a game the player can actually play.
 */
function seedNearbyResources(world: World, home: { tileX: number; tileY: number }): void {
  for (const kind of RAW_KINDS) {
    if (countNearby(world, home, kind) >= START_TILES_WANTED) continue;
    plantSeam(world, home, kind);
  }
}

/**
 * Is this tile close enough to home to count?
 *
 * As the crow flies, not as a square. The square was the original reading and
 * it quietly overstated the guarantee by half: a seam at the corner of a
 * twelve-tile box is seventeen tiles of walking, so a start could satisfy
 * "stone within reach" while its workers spent the opening on the road.
 */
function withinStartReach(dx: number, dy: number): boolean {
  return dx * dx + dy * dy <= START_REACH_TILES * START_REACH_TILES;
}

function countNearby(
  world: World,
  home: { tileX: number; tileY: number },
  kind: ResourceKind,
): number {
  let found = 0;
  for (let dy = -START_REACH_TILES; dy <= START_REACH_TILES; dy++) {
    for (let dx = -START_REACH_TILES; dx <= START_REACH_TILES; dx++) {
      if (!withinStartReach(dx, dy)) continue;
      const tileX = home.tileX + dx;
      const tileY = home.tileY + dy;
      if (resourceOfTerrain(terrainAt(world.grid, tileX, tileY)) !== kind) continue;
      if ((world.deposits[tileY * world.grid.width + tileX] ?? 0) <= 0) continue;
      found++;
    }
  }
  return found;
}

/**
 * Lay a small seam on open ground near the base, on the ring the workers can
 * reach but far enough out that it does not sit under the next building.
 */
function plantSeam(
  world: World,
  home: { tileX: number; tileY: number },
  kind: ResourceKind,
): void {
  const terrain = terrainOfResource(kind);
  let planted = 0;

  for (let radius = 5; radius <= START_REACH_TILES && planted < START_TILES_WANTED; radius++) {
    for (let dy = -radius; dy <= radius && planted < START_TILES_WANTED; dy++) {
      for (let dx = -radius; dx <= radius && planted < START_TILES_WANTED; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
        // Same measure the guarantee is stated in, or the corners of the outer
        // rings would plant seams the workers cannot sensibly reach.
        if (!withinStartReach(dx, dy)) continue;

        const tileX = home.tileX + dx;
        const tileY = home.tileY + dy;
        if (!isInside(world.grid, tileX, tileY)) continue;
        // Only plain ground: a seam must not swallow water, rock, or another
        // resource, and never the ground a building already stands on.
        const existing = terrainAt(world.grid, tileX, tileY);
        if (existing !== Terrain.Grass && existing !== Terrain.Sand) continue;
        if (isBlocked(world.grid, tileX, tileY)) continue;

        setTerrain(world.grid, tileX, tileY, terrain);
        planted++;
      }
    }
  }

  if (planted > 0) stockDeposits(world);
}

/**
 * One headquarters plus its opening workers, around a given anchor tile.
 *
 * Returns a walkable tile beside the finished base — the ground this player
 * actually opens onto — or null if nowhere on the shared region would take a
 * headquarters.
 */
function spawnBase(
  world: World,
  playerId: PlayerId,
  anchorX: number,
  anchorY: number,
  count: number,
  shared: Uint8Array,
): { tileX: number; tileY: number } | null {
  const placed = placeStartingHeadquarters(world, playerId, anchorX, anchorY, shared);
  if (!placed) return null;

  const origin = buildingOrigin(placed);
  const footprint = buildingDef(BuildingType.Headquarters).footprint;
  const centerX = origin.tileX + Math.floor(footprint / 2);
  const centerY = origin.tileY + Math.floor(footprint / 2);

  // The workers all have to come out onto the same ground, and the same ground
  // the base is judged to be on. Spiralling for merely *passable* tiles once
  // scattered a player's opening across a lake: half the workforce spawned on
  // an islet two tiles away and never took a single order.
  const home = passableEdge(world.grid, origin.tileX, origin.tileY, footprint, shared, MIN_HOME_ROOM_TILES);
  if (!home) return null;
  const reachable = findRegionFrom(world.grid, home.tileX, home.tileY);

  const spots: Array<{ x: number; y: number }> = [];
  const maxRadius = Math.max(world.grid.width, world.grid.height);

  for (let radius = 1; radius < maxRadius && spots.length < count; radius++) {
    for (let dy = -radius; dy <= radius && spots.length < count; dy++) {
      for (let dx = -radius; dx <= radius && spots.length < count; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;

        const x = centerX + dx;
        const y = centerY + dy;
        if (reachable[y * world.grid.width + x] === 1) spots.push({ x, y });
      }
    }
  }

  spots.forEach((spot, index) => {
    addEntity(world.entities, {
      // Mostly workers — an idle soldier contributes nothing to an opening.
      // One scout comes along, because finding the other player early is worth
      // more than one more trip to the woods.
      typeId: index === 0 ? UnitType.Scout : UnitType.Worker,
      owner: playerId,
      x: tileCenter(spot.x),
      y: tileCenter(spot.y),
    });
  });

  return home;
}

/**
 * How far apart two openings must be on a 64-tile map, in tiles.
 *
 * Below this the two build radii overlap and the match is a coin flip decided
 * in the first thirty seconds, before either player has made a decision.
 */
const START_SEPARATION_AT_64 = 22;

/**
 * The same distance in proportion to the map, because the map is no longer
 * always 64 tiles.
 *
 * A fixed 22 is nearly half of a small map — unmeetable, so the search fell
 * straight through to its last resort — and a modest gap on a large one. Scaled
 * from the value the default map was tuned at, so that map is unaffected.
 */
function startSeparationTiles(grid: TileGrid, playerCount: number): number {
  const shortEdge = Math.min(grid.width, grid.height);
  const forSize = (shortEdge * START_SEPARATION_AT_64) / 64;
  // And with the number of sides, because they share the same ground. Four
  // openings on a map sized for two cannot each keep a duel's worth of room,
  // and demanding it would only send the search through the whole ladder to
  // its last resort — which is worse than asking for what is achievable.
  return Math.max(8, Math.round(forSize * Math.sqrt(2 / playerCount)));
}

/**
 * The distances the search will settle for, best first.
 *
 * It used to be "the full distance, or else anywhere at all", and the gap
 * between those two is where a broken match lives: on a small map seed 6 put
 * the two headquarters **five tiles apart**, close enough to see each other's
 * workers at the opening whistle. Stepping down means a cramped start is now
 * genuinely cramped rather than catastrophic, and zero stays only as the last
 * resort it was always meant to be — no base at all is worse than a bad one.
 */
function separationLadder(grid: TileGrid, playerCount: number): number[] {
  const target = startSeparationTiles(grid, playerCount);
  const steps = [
    target,
    Math.round(target * 0.8),
    Math.round(target * 0.65),
    floorSeparationTiles(playerCount),
    0,
  ];
  return [...new Set(steps)].filter((step) => step >= 0).sort((a, b) => b - a);
}

/**
 * Below this two bases share a yard: the headquarters build radius is seven
 * tiles, so anything under about fifteen means the two players are placing
 * buildings into each other's opening.
 */
const FLOOR_SEPARATION_TILES = 15;

/**
 * The floor, scaled the same way the target is.
 *
 * Exported because the tests assert against the promise rather than against a
 * number somebody typed twice — a bar that has to be edited by hand every time
 * the rule changes is a bar that stops meaning anything.
 */
export function floorSeparationTiles(playerCount: number): number {
  return Math.max(8, Math.round(FLOOR_SEPARATION_TILES * Math.sqrt(2 / playerCount)));
}

/**
 * Find ground near the anchor that will take a headquarters, and place it.
 *
 * Tried twice: first insisting on a fair gap from the bases already down, then
 * without. Refusing to place a base at all is strictly worse than placing a
 * cramped one — a player with no headquarters has lost before the match starts,
 * whereas a close start is merely a bad map.
 */
function placeStartingHeadquarters(
  world: World,
  playerId: PlayerId,
  anchorX: number,
  anchorY: number,
  shared: Uint8Array,
): Entity | null {
  for (const separation of separationLadder(world.grid, world.players.length)) {
    const placed = trySiteNear(world, playerId, anchorX, anchorY, shared, separation);
    if (placed) return placed;
  }
  return null;
}

function trySiteNear(
  world: World,
  playerId: PlayerId,
  anchorX: number,
  anchorY: number,
  shared: Uint8Array,
  minSeparationTiles: number,
): Entity | null {
  const footprint = buildingDef(BuildingType.Headquarters).footprint;
  const maxRadius = Math.max(world.grid.width, world.grid.height);
  const half = Math.floor(footprint / 2);

  for (let radius = 0; radius < maxRadius; radius++) {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;

        const tileX = anchorX + dx - half;
        const tileY = anchorY + dy - half;
        if (!isBuildable(world.grid, tileX, tileY, footprint)) continue;
        // A worker must be able to stand beside it *and* be on the shared
        // ground, or this base is marooned.
        if (!passableEdge(world.grid, tileX, tileY, footprint, shared, MIN_HOME_ROOM_TILES)) continue;
        if (!farEnoughFromOtherBases(world, tileX + half, tileY + half, minSeparationTiles)) continue;

        const placed = placeBuildingAt(world, playerId, BuildingType.Headquarters, tileX, tileY, {
          // Nothing exists yet to pay for it or to build within reach of.
          free: true,
          finished: true,
          ignoreRadius: true,
        });
        if (placed) return placed;
      }
    }
  }

  return null;
}

function farEnoughFromOtherBases(
  world: World,
  centerTileX: number,
  centerTileY: number,
  minSeparationTiles: number,
): boolean {
  if (minSeparationTiles <= 0) return true;
  const minimumSq = minSeparationTiles * minSeparationTiles;

  for (const entity of world.entities.list) {
    if (entity.typeId !== BuildingType.Headquarters) continue;

    const origin = buildingOrigin(entity);
    const half = Math.floor(buildingDef(BuildingType.Headquarters).footprint / 2);
    const dx = origin.tileX + half - centerTileX;
    const dy = origin.tileY + half - centerTileY;
    if (dx * dx + dy * dy < minimumSq) return false;
  }

  return true;
}

/**
 * A tile of the given region lying flat against one of this footprint's four
 * sides, or null if the site does not touch that region at all.
 *
 * The corners of the surrounding ring are deliberately excluded, and that
 * distinction is the whole point. A base can sit on a small island whose corner
 * kisses the mainland across a diagonal of water: every tile of the ring test
 * says "mainland", while movement — which refuses a diagonal step unless both
 * tiles beside it are open — says the two are not connected at all. Two of
 * eight twenty-minute bot matches ended nil-all that way, both sides mining
 * peacefully on separate islands.
 */
/**
 * How much open ground a base's doorstep has to connect to.
 *
 * Roughly a base's worth of yard. The number matters because the alternative
 * turned up the moment a third player needed somewhere to stand: a
 * headquarters can wall its own doorstep into a pocket, and the tile still
 * passes every check made *before* the building went up. On one map that left
 * the shared ground four tiles wide — a starting twelve units sealed into a
 * nook they could never walk out of, and nowhere at all for the next player.
 *
 * It had been shipping in two-player matches too. Nothing noticed, because
 * with two sides nobody else needed the ground afterwards.
 */
const MIN_HOME_ROOM_TILES = 60;

function passableEdge(
  grid: TileGrid,
  tileX: number,
  tileY: number,
  footprint: number,
  region: Uint8Array,
  minRoom = 0,
): { tileX: number; tileY: number } | null {
  const sides: Array<[number, number]> = [];
  for (let offset = 0; offset < footprint; offset++) {
    sides.push([tileX + offset, tileY - 1]);
    sides.push([tileX + offset, tileY + footprint]);
    sides.push([tileX - 1, tileY + offset]);
    sides.push([tileX + footprint, tileY + offset]);
  }

  for (const [x, y] of sides) {
    if (x < 0 || y < 0 || x >= grid.width || y >= grid.height) continue;
    if (region[y * grid.width + x] !== 1) continue;
    if (!isPassable(grid, x, y)) continue;

    if (minRoom > 0) {
      // Measured with the footprint taken out, so the answer is the same
      // whether this is asked before the building is placed or after.
      const reachable = findRegionFrom(grid, x, y, { tileX, tileY, size: footprint });
      let room = 0;
      for (let i = 0; i < reachable.length; i++) room += reachable[i]!;
      if (room < minRoom) continue;
    }

    return { tileX: x, tileY: y };
  }

  return null;
}

/**
 * Advance the world by exactly one tick.
 *
 * Commands are applied first so a command issued during the previous frame
 * takes effect before the systems that react to it run.
 */
export function tickWorld(world: World, commands: readonly Command[] = []): void {
  for (const command of commands) {
    applyCommand(world, command);
  }

  // Economy first: it decides where workers want to be, then movement walks
  // them there. Running it the other way round would cost every worker a tick
  // of lag on every leg of every trip.
  updateProduction(world);
  // After production, before gathering: a batch finished this tick is in the
  // pool for the next order, not for one already paid for this tick.
  updateRefineries(world);
  // Before combat, so a starving army goes into the fight already weakened
  // rather than being docked afterwards for a battle it has already won.
  updateFood(world);
  updateEconomy(world);
  updateConstruction(world);
  // Combat before movement: fighting decides where units want to be (or that
  // they should stand still and shoot), and movement then carries that out.
  // It also needs the spatial index from last tick's rebuild, which is exactly
  // what movement leaves behind.
  updateCombat(world);
  updateMovement(world.grid, world.entities.list, world.fields, world.spatial);
  // After movement, so what is drawn this frame matches where things ended up.
  // Before victory, so a bot deciding it has won is deciding from the same view
  // of the map the renderer is about to show.
  updateVision(world);
  updateVictory(world);
  updateMarkers(world);

  // Terrain changed this tick (a forest felled, a building finished), so every
  // cached route across it is now a lie. Clearing here, once, means no system
  // has to remember to do it for itself.
  if (world.terrainDirty) {
    invalidateFlowFields(world.fields);
    world.terrainDirty = false;
    world.terrainVersion++;
  }

  world.tick++;
}

function updateMarkers(world: World): void {
  if (world.markers.length === 0) return;

  // Filter in place to avoid allocating a new array every tick.
  let write = 0;
  for (let read = 0; read < world.markers.length; read++) {
    const marker = world.markers[read]!;
    marker.ticksLeft--;
    if (marker.ticksLeft > 0) {
      world.markers[write++] = marker;
    }
  }
  world.markers.length = write;
}

/** Convenience for tests and the headless match runner. */
export function runTicks(world: World, count: number, commands: readonly Command[] = []): void {
  for (let i = 0; i < count; i++) {
    tickWorld(world, i === 0 ? commands : []);
  }
}
