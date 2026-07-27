/**
 * Running a whole match headlessly.
 *
 * Shared by the command-line runner (`tools/match.ts`) and by the tests, so
 * that "a match" means exactly the same thing in CI as it does when someone
 * runs one by hand to look at balance.
 *
 * No rendering, no timers, no DOM — just the simulation and some bots, stepped
 * as fast as the machine can manage.
 */

import { createBot, updateBot, type Bot, type DifficultyId } from "./bot.js";
import type { Command } from "../sim/commands.js";
import { isBuilding, isUnit } from "../sim/entities.js";
import { TICKS_PER_SECOND } from "../sim/constants.js";
import { hashWorldHex } from "../sim/hash.js";
import { RESOURCE_KINDS } from "../sim/resources.js";
import { createWorld, tickWorld, type World } from "../sim/world.js";

export interface MatchOptions {
  readonly seed: number;
  /** One difficulty per player, in player order. */
  readonly difficulties: readonly DifficultyId[];
  readonly maxTicks: number;
  readonly width?: number;
  readonly height?: number;
  /** Take a snapshot every N ticks. Zero disables sampling. */
  readonly sampleEvery?: number;
}

export interface PlayerSample {
  readonly units: number;
  readonly buildings: number;
  readonly banked: number;
}

export interface MatchSample {
  readonly tick: number;
  readonly players: readonly PlayerSample[];
}

export interface MatchResult {
  readonly seed: number;
  readonly ticks: number;
  readonly seconds: number;
  /** Null means nobody won inside the tick budget, or everybody died. */
  readonly winner: number | null;
  readonly decided: boolean;
  readonly hash: string;
  readonly samples: readonly MatchSample[];
  readonly world: World;
}

function sample(world: World): MatchSample {
  return {
    tick: world.tick,
    players: world.players.map((player) => {
      let units = 0;
      let buildings = 0;
      for (const entity of world.entities.list) {
        if (entity.owner !== player.id) continue;
        if (isUnit(entity)) units++;
        else if (isBuilding(entity)) buildings++;
      }
      let banked = 0;
      for (const kind of RESOURCE_KINDS) banked += player.resources[kind];
      return { units, buildings, banked };
    }),
  };
}

export function runMatch(options: MatchOptions): MatchResult {
  const world = createWorld({
    seed: options.seed,
    width: options.width ?? 64,
    height: options.height ?? 64,
  });

  const bots: Bot[] = options.difficulties.map((difficulty, index) =>
    // The bot seed is derived from the match seed, so one number reproduces the
    // entire game — map, opening and both opponents.
    createBot(index, difficulty, (options.seed ^ (index + 1) * 0x2545f491) >>> 0),
  );

  const sampleEvery = options.sampleEvery ?? 0;
  const samples: MatchSample[] = [];

  for (let tick = 0; tick < options.maxTicks; tick++) {
    const commands: Command[] = [];
    for (const bot of bots) commands.push(...updateBot(bot, world));

    tickWorld(world, commands);

    if (sampleEvery > 0 && world.tick % sampleEvery === 0) samples.push(sample(world));
    if (world.matchOver) break;
  }

  return {
    seed: options.seed,
    ticks: world.tick,
    seconds: world.tick / TICKS_PER_SECOND,
    winner: world.winner,
    decided: world.matchOver,
    hash: hashWorldHex(world),
    samples,
    world,
  };
}
