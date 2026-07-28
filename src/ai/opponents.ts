/**
 * Putting bots into a game somebody is actually playing.
 *
 * Small enough to look unnecessary, and it is here because leaving it out cost
 * a whole milestone: the bot was written, tested across eight seeds and tuned
 * through five separate defects, while `main.ts` never called it once. Every
 * test passed. The headless runner played hundreds of matches. And the game on
 * the phone had an opponent that stood perfectly still.
 *
 * Nothing here belongs in the simulation — bots are hands on a controller, not
 * world state — so it sits beside the bot rather than inside `src/sim`.
 */

import { createBot, Difficulty, type Bot, type DifficultyId } from "./bot.js";
import { updateBot } from "./bot.js";
import type { Command } from "../sim/commands.js";
import type { PlayerId } from "../sim/entities.js";
import type { World } from "../sim/world.js";

const BY_NAME: Readonly<Record<string, DifficultyId>> = {
  leicht: Difficulty.Easy,
  easy: Difficulty.Easy,
  normal: Difficulty.Normal,
  schwer: Difficulty.Hard,
  hard: Difficulty.Hard,
};

/**
 * What you get without asking.
 *
 * The gentlest setting, because until there is a menu this is what everybody
 * plays — and a first match that is simply lost teaches nothing about how the
 * game works. Anyone who wants a fight is one URL parameter away.
 */
export const DEFAULT_DIFFICULTY: DifficultyId = Difficulty.Easy;

/**
 * Read a difficulty from whatever the outside world offers — a URL parameter,
 * a saved setting, a menu.
 *
 * Anything unrecognised gives the default rather than an error. A typo in a
 * link should start a game, not refuse to.
 */
export function difficultyFromName(name: string | null | undefined): DifficultyId {
  if (!name) return DEFAULT_DIFFICULTY;
  return BY_NAME[name.trim().toLowerCase()] ?? DEFAULT_DIFFICULTY;
}

/**
 * One bot per player other than the human.
 *
 * The seed comes from the world, so a single number still reproduces the whole
 * match — map, opening and opponent — which is what replays will need.
 */
export function createOpponents(
  world: World,
  localPlayer: PlayerId,
  difficulty: DifficultyId,
): Bot[] {
  return world.players
    .filter((player) => player.id !== localPlayer)
    .map((player) => createBot(player.id, difficulty, (world.seed ^ 0x5bf03635) >>> 0));
}

/**
 * What the opponents want to do this tick.
 *
 * Call it every tick and hand the result to `tickWorld` along with the player's
 * own commands. Each bot decides for itself how often it actually thinks — that
 * interval is what makes an easy opponent feel slow rather than stupid — so
 * this returns an empty list most ticks and costs almost nothing.
 */
export function opponentCommands(bots: readonly Bot[], world: World): Command[] {
  const commands: Command[] = [];
  for (const bot of bots) commands.push(...updateBot(bot, world));
  return commands;
}
