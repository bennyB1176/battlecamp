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
import { isWorker } from "../sim/economy.js";
import {
  buildingOrigin,
  isBuilding,
  isComplete,
  isUnit,
  type Entity,
  type PlayerId,
} from "../sim/entities.js";
import { distSq, toTiles } from "../sim/fixed.js";
import { isPassable, terrainAt } from "../sim/grid.js";
import {
  canAfford,
  resourceOfTerrain,
  Resource,
  RESOURCE_KINDS,
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
}

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
  };
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
    // Which resource, not just which tile. Sending everyone to the nearest
    // thing means the nearest thing is wood, and a bot with only wood can
    // never build a soldier — it grows an economy and then stands there with
    // it. Whichever stock is thinnest gets the next worker.
    const wanted = scarcestResource(bot, world);
    const node = nearestDeposit(world, worker, wanted) ?? nearestDeposit(world, worker, null);
    if (!node) continue;

    commands.push({
      type: "gather",
      playerId: bot.playerId,
      entityIds: [worker.id],
      tileX: node.tileX,
      tileY: node.tileY,
    });
  }

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

  // Only one thing at a time on the go — a bot that starts three buildings it
  // cannot finish stalls its whole economy on half-built shells.
  const underConstruction = buildings.some((building) => !isComplete(building));
  if (underConstruction) return;

  const has = (typeId: BuildingTypeId): boolean =>
    buildings.some((building) => building.typeId === typeId);

  const wanted: BuildingTypeId[] = [];
  if (!has(BuildingType.Barracks)) wanted.push(BuildingType.Barracks);
  if (bot.profile.buildsTowers && !has(BuildingType.Tower)) wanted.push(BuildingType.Tower);

  for (const typeId of wanted) {
    if (!canAfford(player, buildingDef(typeId).cost)) continue;

    const spot = findBuildSpot(bot, world, typeId, buildings);
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
      const unitType = chooseUnitType(bot, world);
      if (canAfford(player, unitDef(unitType).cost)) {
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

  // Already on the way — re-issuing every think would reset their pathing and
  // leave the army shuffling in place.
  if (bot.committed && fighters.some((entity) => entity.attackMoveX !== null)) return;

  const target = enemyTarget(world, bot.playerId);
  if (!target) return;

  commands.push({
    type: "attack-move",
    playerId: bot.playerId,
    entityIds: fighters.map((entity) => entity.id),
    targetX: target.x,
    targetY: target.y,
  });
  bot.committed = true;
}

/**
 * Which fighter to make.
 *
 * The clever version looks at what the enemy actually fields and builds the
 * answer to it; the simple version just makes soldiers. This is the single
 * biggest difference between a hard bot and an easy one, and it is exactly the
 * decision a human is making too.
 */
function chooseUnitType(bot: Bot, world: World): UnitTypeId {
  const options: UnitTypeId[] = [UnitType.Soldier, UnitType.Grenadier, UnitType.Vehicle];

  if (!bot.profile.usesCounters) {
    // A little variety so an easy bot is not perfectly predictable, but no
    // actual reading of the board.
    return nextInt(bot.rng, 5) === 0 ? UnitType.Grenadier : UnitType.Soldier;
  }

  let best: UnitTypeId = UnitType.Soldier;
  let bestScore = -1;

  for (const option of options) {
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

  let scarcest: ResourceKind = Resource.Wood;
  for (const kind of RESOURCE_KINDS) {
    if (player.resources[kind] < player.resources[scarcest]) scarcest = kind;
  }
  return scarcest;
}

/** Closest tile holding the wanted resource, or any resource when null. */
function nearestDeposit(
  world: World,
  worker: Entity,
  wanted: ResourceKind | null,
): { tileX: number; tileY: number } | null {
  const fromX = Math.floor(toTiles(worker.x));
  const fromY = Math.floor(toTiles(worker.y));

  for (let radius = 1; radius < 24; radius++) {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;

        const tileX = fromX + dx;
        const tileY = fromY + dy;
        const kind = resourceOfTerrain(terrainAt(world.grid, tileX, tileY));
        if (kind === null) continue;
        if (wanted !== null && kind !== wanted) continue;
        if ((world.deposits[tileY * world.grid.width + tileX] ?? 0) <= 0) continue;

        return { tileX, tileY };
      }
    }
  }
  return null;
}

/** A legal spot for a building, spiralling out from the base. */
function findBuildSpot(
  bot: Bot,
  world: World,
  typeId: BuildingTypeId,
  buildings: Entity[],
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
        // Legal is not the same as reachable. A site wedged against water or a
        // cliff passes every placement rule and then sits there as a permanent
        // building site, because no worker can stand next to it — which is
        // exactly how a bot ends a fifteen-minute match with no army at all.
        if (!hasWorkableEdge(world, typeId, tileX, tileY)) continue;

        return { tileX, tileY };
      }
    }
  }
  return null;
}

/** Can a worker stand somewhere around this footprint to build it? */
function hasWorkableEdge(
  world: World,
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
      if (isPassable(world.grid, tileX + dx, tileY + dy)) return true;
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

/** Where to send an attack: the enemy's buildings first, then whatever is left. */
function enemyTarget(world: World, playerId: PlayerId): { x: number; y: number } | null {
  let fallback: Entity | null = null;

  for (const entity of world.entities.list) {
    if (entity.owner === playerId) continue;
    // Buildings win: killing production ends a game, killing a patrol does not.
    if (isBuilding(entity)) return { x: entity.x, y: entity.y };
    if (!fallback) fallback = entity;
  }

  return fallback ? { x: fallback.x, y: fallback.y } : null;
}
