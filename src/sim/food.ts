/**
 * Food: the bill that keeps arriving.
 *
 * Every other cost in this game is paid once. Food is owed every tick, by every
 * unit, for as long as it lives — and that one difference is the game's main
 * anti-rush lever. An army raised by stripping the economy bare wins the fight
 * it starts and then withers on the way home, so the question stops being "how
 * big an army can I raise?" and becomes "how big an army can I *keep*?". The
 * second question is about the base, which is where a strategy game wants the
 * player looking.
 *
 * Food is a **capacity, not a stock**: farms raise the ceiling, units press
 * against it, and nothing accumulates. Stockpiling would produce the worst
 * possible screen — ten thousand food banked and an army starving because the
 * rate went negative eight minutes ago — and it would make food the one
 * resource that cannot be spent on anything.
 *
 * Going short costs health, never lives. Deleting a unit somebody paid for
 * reads as the game cheating, and it would hand a stalled opponent free kills.
 * A whole army visibly weakening is a warning with time left to act on it.
 */

import { isUnit, unitDefOf, buildingDefOf, isBuilding, isComplete } from "./entities.js";
import type { PlayerId } from "./entities.js";
import type { World } from "./world.js";

/** How often the books are balanced. Every tick would be needless work. */
const SETTLE_INTERVAL_TICKS = 20;

/** Health a hungry unit loses per settlement. */
const STARVATION_DAMAGE = 2;

/**
 * Health a fed unit regains per settlement.
 *
 * Deliberately a quarter of the starvation rate: an economy that can feed its
 * army gets something back for it, but not so fast that fights stop costing
 * anything. Recovery is also what makes starvation a setback rather than a
 * permanent scar — without it, one lean minute would follow an army for the
 * rest of the match.
 */
const RECOVERY = 1;

/**
 * A starving unit never falls below this share of its health.
 *
 * Attrition is meant to make an over-extended army lose the next fight, not to
 * dissolve it into something an enemy scout can mop up.
 */
const STARVED_FLOOR_NUMERATOR = 1;
const STARVED_FLOOR_DENOMINATOR = 5;

/** What this player's units cost to keep, per tick. */
export function foodDemand(world: World, playerId: PlayerId): number {
  let demand = 0;
  for (const entity of world.entities.list) {
    if (entity.owner !== playerId) continue;
    if (!isUnit(entity)) continue;
    demand += unitDefOf(entity).upkeep;
  }
  return demand;
}

/**
 * What the land feeds without anybody organising it.
 *
 * A patrol forages; an army does not. Without this floor, two soldiers standing
 * on an empty map slowly waste away, which is silly on its face — and it would
 * put an invisible tax on every small skirmish and every test that involves a
 * couple of units. The number is small enough that it never covers a force
 * anyone would call an army.
 */
const FORAGED_SUPPLY = 8;

/** What this player's finished buildings can feed, plus what the land gives. */
export function foodSupply(world: World, playerId: PlayerId): number {
  let supply = FORAGED_SUPPLY;
  for (const entity of world.entities.list) {
    if (entity.owner !== playerId) continue;
    if (!isBuilding(entity)) continue;
    // A field that has not been ploughed feeds nobody.
    if (!isComplete(entity)) continue;
    supply += buildingDefOf(entity).foodSupply;
  }
  return supply;
}

/** True when this player cannot feed what they have. */
export function isStarving(world: World, playerId: PlayerId): boolean {
  return foodDemand(world, playerId) > foodSupply(world, playerId);
}

export function updateFood(world: World): void {
  if (world.tick % SETTLE_INTERVAL_TICKS !== 0) return;

  for (const player of world.players) {
    const starving = isStarving(world, player.id);

    for (const entity of world.entities.list) {
      if (entity.owner !== player.id) continue;
      // Buildings do not eat. Only the things with an upkeep are affected by
      // whether that upkeep is being met.
      if (!isUnit(entity)) continue;

      const def = unitDefOf(entity);

      if (starving) {
        const floor = Math.max(
          1,
          Math.floor((def.maxHp * STARVED_FLOOR_NUMERATOR) / STARVED_FLOOR_DENOMINATOR),
        );
        entity.hp = Math.max(floor, entity.hp - STARVATION_DAMAGE);
      } else {
        entity.hp = Math.min(def.maxHp, entity.hp + RECOVERY);
      }
    }
  }
}
