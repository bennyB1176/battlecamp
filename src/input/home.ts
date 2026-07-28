/**
 * Where "home" is for the camera.
 *
 * The game used to open on the middle of the map, which on a rotationally
 * symmetric two-player layout is the one place guaranteed to contain neither
 * base: the first thing a new player saw was empty grass and no way to tell
 * which way to pan. The centre button had the same problem — it promised to
 * take you somewhere and took you nowhere in particular.
 *
 * View state, so it lives here rather than in the sim: it reads the world and
 * changes nothing in it.
 */

import { EntityKind, type PlayerId } from "../sim/entities.js";
import { toTiles } from "../sim/fixed.js";
import type { World } from "../sim/world.js";

export interface TilePoint {
  readonly x: number;
  readonly y: number;
}

/**
 * The tile the camera should look at for `player`.
 *
 * Buildings win over units, because a base is where you left it and an army is
 * wherever it wandered off to. With neither — the moment before defeat, or a
 * spectator watching nobody — the middle of the map is as good an answer as
 * exists.
 */
export function homeView(world: World, player: PlayerId): TilePoint {
  const middle = { x: world.grid.width / 2, y: world.grid.height / 2 };

  let buildingCount = 0;
  let buildingX = 0;
  let buildingY = 0;
  let unitCount = 0;
  let unitX = 0;
  let unitY = 0;

  for (const entity of world.entities.list) {
    if (entity.owner !== player) continue;
    if (entity.kind === EntityKind.Building) {
      buildingCount++;
      buildingX += toTiles(entity.x);
      buildingY += toTiles(entity.y);
    } else {
      unitCount++;
      unitX += toTiles(entity.x);
      unitY += toTiles(entity.y);
    }
  }

  if (buildingCount > 0) return { x: buildingX / buildingCount, y: buildingY / buildingCount };
  if (unitCount > 0) return { x: unitX / unitCount, y: unitY / unitCount };
  return middle;
}
