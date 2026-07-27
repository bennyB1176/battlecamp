/**
 * Who has lost, and who has won.
 *
 * A player is out when they have **nothing left at all** — no buildings *and*
 * no units. Losing every building alone is not defeat: surviving workers can
 * still put something back up, and ending the match at that moment would take
 * away a comeback that the rules otherwise allow. Conversely, an army with no
 * base is still a threat, and deserves the chance to be one.
 */

import type { PlayerId } from "./entities.js";
import type { World } from "./world.js";

export function isDefeated(world: World, playerId: PlayerId): boolean {
  for (const entity of world.entities.list) {
    if (entity.owner === playerId) return false;
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
