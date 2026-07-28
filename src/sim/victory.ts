/**
 * Who has lost, and who has won.
 *
 * A player is out when they have **nothing left that could rebuild**: no
 * buildings, and no unit able to put one up.
 *
 * The two halves of that are each there for a reason. Losing every building is
 * not defeat — surviving workers can start again, and ending the match at that
 * moment would take away a comeback the rules otherwise allow. But the old rule
 * ("nothing left *at all*") went too far the other way: a side reduced to a
 * single soldier can never build anything again, and the winner was left
 * sweeping a 64×64 map for it before the game would admit what had happened.
 * Whether that soldier is found changes nothing about the outcome, so it should
 * not change when the outcome is announced.
 */

import { UnitType } from "../content/units.js";
import { isUnit, type Entity, type PlayerId } from "./entities.js";
import type { World } from "./world.js";

/**
 * Could this entity put a building up again?
 *
 * Buildings count because they produce: a headquarters left standing alone
 * still trains the worker that rebuilds around it.
 */
export function canRebuild(entity: Entity): boolean {
  if (!isUnit(entity)) return true;
  return entity.typeId === UnitType.Worker;
}

export function isDefeated(world: World, playerId: PlayerId): boolean {
  for (const entity of world.entities.list) {
    if (entity.owner !== playerId) continue;
    if (canRebuild(entity)) return false;
  }
  return true;
}

/**
 * Settle the match if it is settled.
 *
 * The tick keeps running afterwards — the clock should carry on so a result
 * screen can show how long it took — but the outcome is fixed from here.
 */
export function updateVictory(world: World): void {
  if (world.matchOver) return;

  const alive: PlayerId[] = [];
  for (const player of world.players) {
    if (!isDefeated(world, player.id)) alive.push(player.id);
  }

  // Nobody has done anything yet: at tick zero every side may still be empty
  // while the opening position is being set up.
  if (alive.length === world.players.length) return;

  if (alive.length === 1) {
    world.winner = alive[0]!;
    world.matchOver = true;
    return;
  }

  if (alive.length === 0) {
    // Mutual annihilation. A draw, not a win.
    world.winner = null;
    world.matchOver = true;
  }
}
