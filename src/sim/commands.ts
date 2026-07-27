/**
 * Commands are the *only* way anything changes the world.
 *
 * The UI does not move a unit; it emits a command. A bot does not spend
 * resources; it emits a command. Commands are collected during a frame and
 * applied together at the next tick boundary, which buys us four things almost
 * for free:
 *
 *   - bots and humans share one code path (no privileged AI back door)
 *   - a replay is just a seed plus the command log
 *   - regression tests can assert "these commands from this seed => this hash"
 *   - lockstep multiplayer becomes "broadcast commands", not "sync state"
 *
 * Commands must be plain serialisable data — no functions, no entity object
 * references, only ids and coordinates.
 */

import type { World } from "./world.js";
import { isInside } from "./grid.js";

/**
 * A player-visible marker dropped by tapping the map. It exists so M0 has a
 * command worth applying and so we can confirm on a real phone that a tap lands
 * on the tile the player aimed at. Gameplay commands (move, build, produce,
 * attack) join this union from M1 onwards.
 */
export interface PingCommand {
  readonly type: "ping";
  readonly playerId: number;
  readonly tileX: number;
  readonly tileY: number;
}

export type Command = PingCommand;

/** How many ticks a ping marker stays visible (10 ticks/second => 2 seconds). */
export const PING_LIFETIME_TICKS = 20;

export function applyCommand(world: World, command: Command): void {
  switch (command.type) {
    case "ping": {
      if (!isInside(world.grid, command.tileX, command.tileY)) return;
      world.markers.push({
        playerId: command.playerId,
        tileX: command.tileX,
        tileY: command.tileY,
        ticksLeft: PING_LIFETIME_TICKS,
      });
      return;
    }
    default: {
      // An unknown command type means a bug upstream, not a recoverable state —
      // silently ignoring it would let a desync creep in unnoticed.
      throw new Error(`Unhandled command: ${JSON.stringify(command)}`);
    }
  }
}
