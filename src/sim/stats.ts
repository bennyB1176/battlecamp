/**
 * What happened during the match, counted as it happens.
 *
 * The result screen is the reason this exists. "Sieg" on its own says nothing
 * about the game that was just played — whether it was won by out-earning the
 * opponent or by trading two thirds of an army for their base is the actual
 * story, and it cannot be reconstructed afterwards from the wreckage.
 *
 * These are counters, not a log: a full event history would grow without bound
 * over a twenty-minute match, and nothing here needs to know *when* something
 * happened. They live in the world, so they are deterministic, they survive
 * into a save, and a run that tallies differently from the same seed shows up
 * in the world hash as the desync it is.
 */

import { RESOURCE_KINDS, type ResourceKind } from "./resources.js";
import type { PlayerId } from "./entities.js";
import type { World } from "./world.js";

export interface MatchStats {
  /**
   * Raw resources carried home by workers.
   *
   * Deliberately not everything that ever landed in the account: refinery
   * output and the opening pile are not *gathered*, and counting them would
   * make the number stop meaning "how hard my economy worked".
   */
  gathered: Record<ResourceKind, number>;
  /** Units that finished training. */
  unitsTrained: number;
  /** Buildings that finished construction — shells do not count. */
  buildingsBuilt: number;
  unitsLost: number;
  buildingsLost: number;
}

export function createStats(): MatchStats {
  const gathered = {} as Record<ResourceKind, number>;
  for (const kind of RESOURCE_KINDS) gathered[kind] = 0;
  return { gathered, unitsTrained: 0, buildingsBuilt: 0, unitsLost: 0, buildingsLost: 0 };
}

/**
 * The tally for one player.
 *
 * Callers add to the fields directly, the same way they add to a player's
 * resources. A setter per counter would be five functions that each do one
 * `+= 1`, and would hide nothing.
 */
export function statsFor(world: World, playerId: PlayerId): MatchStats {
  const stats = world.stats[playerId];
  if (!stats) throw new Error(`no match statistics for player ${playerId}`);
  return stats;
}

/** Everything a side dug up, across all resources. */
export function totalGathered(stats: MatchStats): number {
  let total = 0;
  for (const kind of RESOURCE_KINDS) total += stats.gathered[kind];
  return total;
}
