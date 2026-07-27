/**
 * The bot opponent.
 *
 * It plays through the **same command path a human uses** — no privileged
 * access, no direct state mutation. That is not politeness: it means every bug
 * the bot hits is a bug a player can hit, and every rule the simulation
 * enforces on a player it enforces on the bot too. A bot that cheats is also
 * useless as a balance instrument, and balance runs are half the point of
 * having one (see `tools/match.ts`).
 *
 * Four layers, in the order they matter:
 *
 *   1. **Economy** — keep workers digging, replace losses
 *   2. **Infrastructure** — put up what the next step needs
 *   3. **Military** — build an army, then decide when it is worth spending
 *   4. **Micro** — react to what is happening right now
 *
 * Difficulty comes from **reaction time and decision quality**, never from
 * resource bonuses. A bot that is handed free income is not a harder opponent,
 * it is a different game — and it tells you nothing about whether your own
 * economy is tuned correctly.
 *
 * The bot lives outside the world, like a player's hands. Its state is not
 * simulation state: a replay stores the commands it issued, so playing one back
 * needs no bot at all.
 */

import { BuildingType, buildingDef, type BuildingTypeId } from "../content/buildings.js";
import { DAMAGE_MULTIPLIERS } from "../content/combat.js";
import { UnitType, unitDef, type UnitTypeId } from "../content/units.js";
import type { Command } from "../sim/commands.js";
import { canPlace } from "../sim/construction.js";
import { computeFlowField, isReachable, type FlowField } from "../sim/pathing.js";
import { isWorker } from "../sim/economy.js";
import { foodDemand, foodSupply } from "../sim/food.js";
import { isPowered } from "../sim/power.js";
import {
  buildingOrigin,
  getEntity,
  isBuilding,
  isComplete,
  isUnit,
  type Entity,
  type EntityId,
  type PlayerId,
} from "../sim/entities.js";
import { distSq, toTileIndex, toTiles } from "../sim/fixed.js";
import { isPassable, terrainAt } from "../sim/grid.js";
import { snapGoalToReachable } from "../sim/movement.js";
import {
  canAfford,
  RAW_KINDS,
  resourceOfTerrain,
  Resource,
  type Player,
  type ResourceKind,
} from "../sim/resources.js";
import { createRng, nextInt, type Rng } from "../sim/rng.js";
import type { World } from "../sim/world.js";

export const Difficulty = {
  Easy: 0,
  Normal: 1,
  Hard: 2,
} as const;

export type DifficultyId = (typeof Difficulty)[keyof typeof Difficulty];

export const DIFFICULTY_NAMES: Readonly<Record<DifficultyId, string>> = {
  [Difficulty.Easy]: "leicht",
  [Difficulty.Normal]: "normal",
  [Difficulty.Hard]: "schwer",
};

export interface BotProfile {
  /** Ticks between decisions. The main lever: a slow bot is simply late. */
  readonly thinkInterval: number;
  /** How many workers it wants before it stops making more. */
  readonly workerTarget: number;
  /** Army size it gathers before committing to an attack. */
  readonly attackAt: number;
  /** Whether it spends on static defence. */
  readonly buildsTowers: boolean;
  /** Whether it picks unit types to counter what the enemy actually fields. */
  readonly usesCounters: boolean;
  /** Whether it pulls its army home when its base is attacked. */
  readonly defendsBase: boolean;
}

/**
 * A note on `attackAt`, because the obvious reading is backwards.
 *
 * It is tempting to make the harder bot attack *sooner* — aggression reads as
 * difficulty. Headless runs said otherwise: a bot committing at six units feeds
 * its army into the enemy in packets small enough to be killed one after
 * another, while the "easy" bot quietly stockpiles fifty and wins on numbers.
 *
 * So the harder bot commits *later* and with a better-composed force. Its edge
 * is reaction time, a bigger economy, counters and defence — not impatience.
 */
export const PROFILES: Readonly<Record<DifficultyId, BotProfile>> = {
  // Late to everything, small economy, never learns what it is fighting.
  [Difficulty.Easy]: {
    thinkInterval: 40,
    workerTarget: 6,
    attackAt: 8,
    buildsTowers: false,
    usesCounters: false,
    defendsBase: false,
  },
  [Difficulty.Normal]: {
    thinkInterval: 15,
    workerTarget: 11,
    attackAt: 12,
    buildsTowers: true,
    usesCounters: false,
    defendsBase: true,
  },
  // Reacts within half a second, out-produces you, defends what it has, and
  // builds the answer to whatever you happen to have made.
  [Difficulty.Hard]: {
    thinkInterval: 5,
    workerTarget: 18,
    attackAt: 16,
    buildsTowers: true,
    usesCounters: true,
    defendsBase: true,
  },
};

export interface Bot {
  readonly playerId: PlayerId;
  readonly difficulty: DifficultyId;
  readonly profile: BotProfile;
  readonly rng: Rng;
  /** Next tick at which it will think. */
  nextThinkTick: number;
  /** True while an attack is under way, so it does not re-issue every think. */
  committed: boolean;
  /** What that attack is aimed at, so it notices when the thing stops existing. */
  attackTargetId: EntityId | null;
  /**
   * Construction sites that have stopped making progress, and when they were
   * last seen moving.
   *
   * The safety net behind the reachability check in `findBuildSpot`. If a site
   * ever does get stuck anyway, this stops it from freezing every future
   * building decision — one bad placement should cost a building, not a game.
   */
  readonly siteWatch: Map<EntityId, { work: number; sinceTick: number }>;
  readonly stalledSites: Set<EntityId>;
  /** Where its workers can walk, and what that answer was computed against. */
  reach: ReachCache | null;
}

/** Ticks a site may sit at the same amount of work before it is written off. */
const STALL_TICKS = 600;

/** How lopsided the stocks must be before a worker is moved to fix it. */
const REBALANCE_GAP = 200;

/**
 * Spare food the bot wants in hand before it stops building farms.
 *
 * Roughly four soldiers' worth: enough that the next batch out of the barracks
 * is fed on arrival rather than starting the whole army starving.
 */
const FOOD_HEADROOM = 8;

interface ReachCache {
  readonly tick: number;
  readonly field: FlowField;
}

/**
 * How long a reachability answer is trusted before it is measured again.
 *
 * Not tied to the world's terrain version on purpose: that version bumps every
 * time a seam is mined out, which happens constantly and changes nothing about
 * where anyone can walk. Keying on it turned one sweep per match into one every
 * few ticks and doubled the cost of running a bot. Twenty seconds of staleness
 * costs a bot nothing, and a spot that goes stale mid-decision is caught by the
 * stall watch.
 */
const REACH_REFRESH_TICKS = 200;

export function createBot(playerId: PlayerId, difficulty: DifficultyId, seed: number): Bot {
  return {
    playerId,
    difficulty,
    profile: PROFILES[difficulty],
    // Its own generator: the bot must be reproducible without touching the
    // world's, whose draw sequence belongs to the simulation.
    rng: createRng((seed ^ (playerId * 0x9e3779b9) ^ 0x51ed270b) >>> 0),
    nextThinkTick: 0,
    committed: false,
    attackTargetId: null,
    siteWatch: new Map(),
    stalledSites: new Set(),
    reach: null,
  };
}

/**
 * Everywhere this bot's workers can actually walk.
 *
 * Legal is not the same as walkable, and the gap between them is where a bot
 * quietly dies: a seam across a river and a building site behind a ridge both
 * pass every rule the simulation checks, and both leave workers standing still
 * forever. One Dijkstra sweep answers the question for the whole map at once.
 *
 * Cached hard, because it changes rarely. Reachability is a property of the
 * *region*, not of the tile it was measured from — so while the worker is still
 * somewhere the old field can see, the old field describes the same region and
 * is still the right answer.
 */
function reachableFrom(bot: Bot, world: World, worker: Entity): FlowField {
  // A worker can end up standing on a tile that a building was later dropped
  // onto. Sweeping from there yields a field that reaches nothing at all —
  // which reads as "this bot can go nowhere", strands the worker, and makes
  // every following call recompute the same useless answer.
  const anchor = snapGoalToReachable(world.grid, worker.x, worker.y);
  const tileX = toTileIndex(anchor.x);
  const tileY = toTileIndex(anchor.y);

  const cached = bot.reach;
  if (
    cached &&
    world.tick - cached.tick < REACH_REFRESH_TICKS &&
    isReachable(cached.field, tileX, tileY)
  ) {
    return cached.field;
  }

  const field = computeFlowField(world.grid, tileX, tileY);
  bot.reach = { tick: world.tick, field };
  return field;
}

/**
 * Decide what to do this tick.
 *
 * Returns commands; it never touches the world. Called every tick, but only
 * actually thinks on its own schedule — that interval is what makes an easy bot
 * feel slow rather than stupid.
 */
export function updateBot(bot: Bot, world: World): Command[] {
  if (world.matchOver) return [];
  if (world.tick < bot.nextThinkTick) return [];
  bot.nextThinkTick = world.tick + bot.profile.thinkInterval;

  const mine = world.entities.list.filter((entity) => entity.owner === bot.playerId);
  if (mine.length === 0) return [];

  const commands: Command[] = [];
  const workers = mine.filter(isWorker);
  const buildings = mine.filter(isBuilding);
  const fighters = mine.filter((entity) => isUnit(entity) && !isWorker(entity));

  runEconomy(bot, world, commands, workers, buildings);
  runInfrastructure(bot, world, commands, buildings, workers);
  runMilitary(bot, world, commands, buildings, fighters);

  return commands;
}

/** Keep every worker busy, and keep making more until the target is met. */
function runEconomy(
  bot: Bot,
  world: World,
  commands: Command[],
  workers: Entity[],
  buildings: Entity[],
): void {
  const idle = workers.filter(
    (worker) => worker.job === null && worker.buildTargetId === null && worker.goalX === null,
  );

  for (const worker of idle) {
    const routes = reachableFrom(bot, world, worker);
    // Which resource, not just which tile. Sending everyone to the nearest
    // thing means the nearest thing is wood, and a bot with only wood can
    // never build a soldier — it grows an economy and then stands there with
    // it. Whichever stock is thinnest gets the next worker.
    const wanted = scarcestResource(bot, world);
    const node = nearestDeposit(world, routes, worker, wanted);
    if (!node) continue;

    commands.push({
      type: "gather",
      playerId: bot.playerId,
      entityIds: [worker.id],
      tileX: node.tileX,
      tileY: node.tileY,
    });
  }

  rebalance(bot, world, commands, workers);

  if (workers.length >= bot.profile.workerTarget) return;

  const hq = buildings.find(
    (building) => building.typeId === BuildingType.Headquarters && isComplete(building),
  );
  if (!hq) return;

  // One at a time: queuing a stack up front spends resources that the next
  // building might need more, and the queue cannot be reordered later.
  const queued = hq.production?.queue.length ?? 0;
  if (queued > 0) return;

  const player = world.players[bot.playerId];
  if (!player || !canAfford(player, unitDef(UnitType.Worker).cost)) return;

  commands.push({
    type: "train",
    playerId: bot.playerId,
    buildingId: hq.id,
    unitType: UnitType.Worker,
  });
}

/**
 * Move one worker at a time off a resource there is plenty of, onto the one
 * holding everything up.
 *
 * Without this the opening assignment decides the whole match. Workers keep the
 * job they were given — deliberately, so a lumberjack does not wander into a
 * mine and quietly change what the economy produces — and idle workers are the
 * only ones this layer ever touches. Wood is what a spiral search finds first,
 * so wood is what nearly everyone ended up on: eleven hundred wood banked, ten
 * stone, and a smelter the bot could never afford standing between it and the
 * entire refining chain.
 *
 * One worker per think, so the workforce drifts toward the shortage instead of
 * stampeding between seams and spending the whole match walking.
 */
function rebalance(bot: Bot, world: World, commands: Command[], workers: Entity[]): void {
  const player = world.players[bot.playerId];
  if (!player) return;

  const scarce = scarcestResource(bot, world);
  const plentiful = RAW_KINDS.reduce((most, kind) =>
    player.resources[kind] > player.resources[most] ? kind : most,
  );

  // Only when the gap is real. Shuffling workers over a rounding difference
  // would cost more in walking than it ever earned.
  if (player.resources[plentiful] < player.resources[scarce] + REBALANCE_GAP) return;

  const spare = workers.find(
    (worker) =>
      worker.job !== null &&
      worker.buildTargetId === null &&
      resourceOfTerrain(terrainAt(world.grid, worker.job.nodeX, worker.job.nodeY)) === plentiful,
  );
  if (!spare) return;

  const node = nearestDeposit(world, reachableFrom(bot, world, spare), spare, scarce);
  if (!node || resourceOfTerrain(terrainAt(world.grid, node.tileX, node.tileY)) !== scarce) return;

  commands.push({
    type: "gather",
    playerId: bot.playerId,
    entityIds: [spare.id],
    tileX: node.tileX,
    tileY: node.tileY,
  });
}

/** Put up what the next step needs: first a barracks, then defence. */
function runInfrastructure(
  bot: Bot,
  world: World,
  commands: Command[],
  buildings: Entity[],
  workers: Entity[],
): void {
  if (workers.length === 0) return;

  const player = world.players[bot.playerId];
  if (!player) return;

  watchSites(bot, world, buildings);

  // Only one thing at a time on the go — a bot that starts three buildings it
  // cannot finish stalls its whole economy on half-built shells. Sites already
  // written off as stuck do not count, or a single bad placement would block
  // every future building for the rest of the match.
  const inProgress = buildings.some(
    (building) => !isComplete(building) && !bot.stalledSites.has(building.id),
  );
  if (inProgress) return;

  const has = (typeId: BuildingTypeId): boolean =>
    buildings.some((building) => building.typeId === typeId);

  const wanted: BuildingTypeId[] = [];
  const headroom = foodSupply(world, bot.playerId) - foodDemand(world, bot.playerId);

  // Hunger jumps the queue; being merely close to hungry does not. That
  // distinction is load-bearing: the bot builds one thing at a time, so a
  // condition at the head of this list that is nearly always true starves
  // everything behind it. With the pre-emptive farm first, the smelter never
  // came up at all — ten minutes, eighteen workers, and the refining chain
  // never once touched.
  if (headroom < 0) wanted.push(BuildingType.Farm);

  if (!has(BuildingType.Barracks)) wanted.push(BuildingType.Barracks);

  // A smelter once there is a barracks to spend the steel at. Without one the
  // whole refining chain is dead content in every bot match: thousands of ore
  // banked that can never become anything, and the heaviest unit in the game
  // out of reach for the entire twenty minutes.
  if (has(BuildingType.Barracks) && !has(BuildingType.Smelter)) wanted.push(BuildingType.Smelter);

  // A plant only when something of its own is actually running cold. Building
  // one on principle would be wasted resources on a base that never left its
  // own yard.
  if (buildings.some((building) => isComplete(building) && !isPowered(world, building))) {
    wanted.push(BuildingType.PowerPlant);
  }

  // The pre-emptive farm, once the essentials are in hand. Waiting for the
  // larder to be empty means always being one farm behind — by the time the
  // field is ploughed the army is down to a fifth of its health.
  if (headroom < FOOD_HEADROOM) wanted.push(BuildingType.Farm);

  if (bot.profile.buildsTowers && !has(BuildingType.Tower)) wanted.push(BuildingType.Tower);

  for (const typeId of wanted) {
    if (!canAfford(player, buildingDef(typeId).cost)) continue;

    // Measured from the crew that will actually walk there, not from the base:
    // a base can have open ground beside it that is walled off from its own
    // workers, and then the site is legal, reachable "from the base", and still
    // never gets built.
    const crewLead = workers[0]!;
    const spot = findBuildSpot(bot, world, typeId, buildings, reachableFrom(bot, world, crewLead));
    if (!spot) continue;

    // Send a couple of workers, not the whole economy.
    const crew = workers.slice(0, 2).map((worker) => worker.id);
    commands.push({
      type: "build",
      playerId: bot.playerId,
      entityIds: crew,
      buildingType: typeId,
      tileX: spot.tileX,
      tileY: spot.tileY,
    });
    return;
  }
}

/**
 * Notice construction sites that have stopped moving.
 *
 * Progress is the only honest signal here: whatever the reason a site is stuck
 * — unreachable, builders dead, workers pulled away — the symptom is the same,
 * and so is the right response.
 */
function watchSites(bot: Bot, world: World, buildings: Entity[]): void {
  const live = new Set<EntityId>();

  for (const building of buildings) {
    if (isComplete(building) || building.construction === null) continue;
    live.add(building.id);

    const seen = bot.siteWatch.get(building.id);
    if (!seen || seen.work !== building.construction) {
      bot.siteWatch.set(building.id, { work: building.construction, sinceTick: world.tick });
      bot.stalledSites.delete(building.id);
      continue;
    }

    if (world.tick - seen.sinceTick >= STALL_TICKS) bot.stalledSites.add(building.id);
  }

  // Forget finished or destroyed sites, so the maps cannot grow without bound.
  for (const id of [...bot.siteWatch.keys()]) {
    if (!live.has(id)) {
      bot.siteWatch.delete(id);
      bot.stalledSites.delete(id);
    }
  }
}

/** Build an army, then decide whether it is worth spending. */
function runMilitary(
  bot: Bot,
  world: World,
  commands: Command[],
  buildings: Entity[],
  fighters: Entity[],
): void {
  const barracks = buildings.find(
    (building) => building.typeId === BuildingType.Barracks && isComplete(building),
  );

  if (barracks) {
    const queued = barracks.production?.queue.length ?? 0;
    const player = world.players[bot.playerId];
    if (player && queued < 2) {
      const unitType = chooseUnitType(bot, world, player);
      if (unitType !== null) {
        commands.push({
          type: "train",
          playerId: bot.playerId,
          buildingId: barracks.id,
          unitType,
        });
      }
    }
  }

  if (fighters.length === 0) {
    bot.committed = false;
    return;
  }

  // Something is in the base: bring the army home. Losing an economy while the
  // army is out on the map is how a bot loses a game it was winning.
  if (bot.profile.defendsBase) {
    const home = buildings[0];
    const threat = home ? nearestEnemyNear(world, bot.playerId, home, 14) : null;
    if (threat && home) {
      commands.push({
        type: "attack-move",
        playerId: bot.playerId,
        entityIds: fighters.map((entity) => entity.id),
        targetX: threat.x,
        targetY: threat.y,
      });
      bot.committed = false;
      return;
    }
  }

  if (fighters.length < bot.profile.attackAt) return;

  // Stay on the current target while it still exists. Committing to a set of
  // *coordinates* instead is how an army ends up standing on the rubble of a
  // headquarters for twelve minutes while the barracks next door keeps working.
  const current =
    bot.attackTargetId === null ? undefined : getEntity(world.entities, bot.attackTargetId);
  const target = current ?? enemyTarget(world, bot.playerId);
  if (!target) return;

  // Already on the way — re-issuing every think would reset their pathing and
  // leave the army shuffling in place.
  //
  // "On the way" means most of them, not one of them. Attack-move clears itself
  // on arrival and an idle unit only shoots what is already in weapon range, so
  // an army that stopped a couple of tiles short of the enemy base needs telling
  // again. With `some`, a single straggler still walking kept seventy arrived
  // soldiers standing politely beside an intact headquarters.
  const marching = fighters.filter((entity) => entity.attackMoveX !== null).length;
  if (bot.committed && bot.attackTargetId === target.id && marching * 2 >= fighters.length) {
    return;
  }

  commands.push({
    type: "attack-move",
    playerId: bot.playerId,
    entityIds: fighters.map((entity) => entity.id),
    targetX: target.x,
    targetY: target.y,
  });
  bot.committed = true;
  bot.attackTargetId = target.id;
}

/**
 * Which fighter to make, or null when it cannot pay for any of them.
 *
 * The clever version looks at what the enemy actually fields and builds the
 * answer to it; the simple version just makes soldiers. This is the single
 * biggest difference between a hard bot and an easy one, and it is exactly the
 * decision a human is making too.
 *
 * Affordability is part of the *choice*, not a veto applied afterwards. Naming
 * an ideal unit and then failing to buy it leaves the bot naming it again on the
 * next think, and the next, with a full treasury and an empty barracks — which
 * is precisely how the hard bot came out of twenty-minute matches with four
 * soldiers and ten thousand banked wood. The best answer it can pay for beats
 * the perfect answer it cannot.
 */
function chooseUnitType(bot: Bot, world: World, player: Player): UnitTypeId | null {
  const options: UnitTypeId[] = [UnitType.Soldier, UnitType.Grenadier, UnitType.Vehicle];
  const affordable = options.filter((option) => canAfford(player, unitDef(option).cost));
  if (affordable.length === 0) return null;

  if (!bot.profile.usesCounters) {
    // A little variety so an easy bot is not perfectly predictable, but no
    // actual reading of the board.
    const wanted = nextInt(bot.rng, 5) === 0 ? UnitType.Grenadier : UnitType.Soldier;
    return affordable.includes(wanted) ? wanted : affordable[0]!;
  }

  let best: UnitTypeId = affordable[0]!;
  let bestScore = -1;

  for (const option of affordable) {
    const weapon = unitDef(option).weapon;
    if (!weapon) continue;

    let score = 0;
    for (const entity of world.entities.list) {
      if (entity.owner === bot.playerId) continue;
      const armor = isBuilding(entity) ? 3 : unitDef(entity.typeId as UnitTypeId).armor;
      score += DAMAGE_MULTIPLIERS[weapon.damageType][armor as never] ?? 0;
    }

    if (score > bestScore) {
      bestScore = score;
      best = option;
    }
  }

  return best;
}

/**
 * Whichever resource the player has least of.
 *
 * Crude, and deliberately so: it needs no plan and no lookahead, yet it keeps
 * all three stocks moving, which is all the bot needs to afford the mix of
 * things it wants to build.
 */
function scarcestResource(bot: Bot, world: World): ResourceKind {
  const player = world.players[bot.playerId];
  if (!player) return Resource.Wood;

  // Raw kinds only. Steel is always the thinnest stock early on, and sending a
  // worker off to look for a steel mine is a search that can never succeed.
  let scarcest: ResourceKind = Resource.Wood;
  for (const kind of RAW_KINDS) {
    if (player.resources[kind] < player.resources[scarcest]) scarcest = kind;
  }
  return scarcest;
}

/**
 * The closest seam of the wanted resource — or, failing that, the closest seam
 * of anything.
 *
 * Both answers come out of one outward spiral rather than two passes, because
 * this is the bot's hottest loop: it runs for every idle worker on every think,
 * and the fallback pass is the expensive one precisely when it is needed (the
 * wanted resource is nowhere nearby, so the search runs to full radius).
 *
 * Only tiles the worker can walk to count. The nearest seam as the crow flies
 * is worthless if the crow is the only one who can get there.
 */
function nearestDeposit(
  world: World,
  routes: FlowField,
  worker: Entity,
  wanted: ResourceKind,
): { tileX: number; tileY: number } | null {
  const fromX = Math.floor(toTiles(worker.x));
  const fromY = Math.floor(toTiles(worker.y));
  let fallback: { tileX: number; tileY: number } | null = null;

  for (let radius = 1; radius < 24; radius++) {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;

        const tileX = fromX + dx;
        const tileY = fromY + dy;
        const kind = resourceOfTerrain(terrainAt(world.grid, tileX, tileY));
        if (kind === null) continue;
        if ((world.deposits[tileY * world.grid.width + tileX] ?? 0) <= 0) continue;
        if (!isReachable(routes, tileX, tileY)) continue;

        if (kind === wanted) return { tileX, tileY };
        fallback ??= { tileX, tileY };
      }
    }
  }

  return fallback;
}

/**
 * A legal spot for a building, spiralling out from the base.
 *
 * "Legal" is not enough, and this cost a whole milestone to learn. A site can
 * satisfy every placement rule, have open ground all around it, and still be
 * somewhere no worker can *get to* — across a river, behind a ridge. The
 * builders then stand at home forever, the barracks never finishes, and the bot
 * plays out a fifteen-minute match with a single soldier.
 *
 * So the candidate is checked against an actual route the builders can walk,
 * not against passability.
 */
function findBuildSpot(
  bot: Bot,
  world: World,
  typeId: BuildingTypeId,
  buildings: Entity[],
  routes: FlowField,
): { tileX: number; tileY: number } | null {
  const anchor = buildings.find((building) => isComplete(building)) ?? buildings[0];
  if (!anchor) return null;

  const origin = buildingOrigin(anchor);

  for (let radius = 2; radius < 10; radius++) {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;

        const tileX = origin.tileX + dx;
        const tileY = origin.tileY + dy;
        if (!canPlace(world, bot.playerId, typeId, tileX, tileY).ok) continue;
        if (!hasReachableEdge(world, routes, typeId, tileX, tileY)) continue;

        return { tileX, tileY };
      }
    }
  }
  return null;
}

/** Can a worker actually walk to somewhere around this footprint and build? */
function hasReachableEdge(
  world: World,
  routes: FlowField,
  typeId: BuildingTypeId,
  tileX: number,
  tileY: number,
): boolean {
  const footprint = buildingDef(typeId).footprint;

  for (let dy = -1; dy <= footprint; dy++) {
    for (let dx = -1; dx <= footprint; dx++) {
      const insideX = dx >= 0 && dx < footprint;
      const insideY = dy >= 0 && dy < footprint;
      if (insideX && insideY) continue;

      const x = tileX + dx;
      const y = tileY + dy;
      if (!isPassable(world.grid, x, y)) continue;
      if (isReachable(routes, x, y)) return true;
    }
  }
  return false;
}

/** The nearest enemy within a radius of one of our buildings, if any. */
function nearestEnemyNear(
  world: World,
  playerId: PlayerId,
  around: Entity,
  radiusTiles: number,
): Entity | null {
  const radius = radiusTiles * 256;
  let best: Entity | null = null;
  let bestDistanceSq = radius * radius;

  for (const entity of world.entities.list) {
    if (entity.owner === playerId) continue;
    if (!isUnit(entity)) continue;

    const separationSq = distSq(entity.x, entity.y, around.x, around.y);
    if (separationSq <= bestDistanceSq) {
      bestDistanceSq = separationSq;
      best = entity;
    }
  }

  return best;
}

/** What to send an attack at: the enemy's buildings first, then whatever is left. */
function enemyTarget(world: World, playerId: PlayerId): Entity | null {
  let fallback: Entity | null = null;

  for (const entity of world.entities.list) {
    if (entity.owner === playerId) continue;
    // Buildings win: killing production ends a game, killing a patrol does not.
    if (isBuilding(entity)) return entity;
    if (!fallback) fallback = entity;
  }

  return fallback;
}
