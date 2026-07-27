/**
 * Power: the rule that makes base *layout* a decision.
 *
 * Everything else in this economy is a shopping list — enough wood, enough
 * stone, press the button. Power is the one rule that cares *where* a building
 * stands: a plant lights a circle, and anything working outside every circle
 * crawls. That turns a base from a heap of buildings into a shape somebody
 * chose, and it hands an attacker a target worth far more than its own hit
 * points, because one plant is several buildings' output.
 *
 * Slower, never stopped. A base that switches off when its plant dies has taken
 * the game away from the player at the exact moment they most need something to
 * do; one that halves in speed leaves them a problem they can still play their
 * way out of.
 *
 * Measured between building centres in fixed point, like every other distance
 * in the simulation — no floating-point radius, nothing that could differ by
 * one tile between two machines running the same match.
 */

import { buildingDefOf, isBuilding, isComplete, type Entity } from "./entities.js";
import { distSq } from "./fixed.js";
import type { World } from "./world.js";

/**
 * How fast work goes on and off the grid, as a fraction.
 *
 * Half is deliberately blunt. A subtler number would be harder to feel, and a
 * rule nobody can feel is a rule nobody plans around — which would leave power
 * as bookkeeping rather than as a decision about where to build.
 */
const POWERED_NUMERATOR = 2;
const UNPOWERED_NUMERATOR = 1;
const RATE_DENOMINATOR = 2;

/** Work done per tick, as a fraction of full speed. */
export function poweredFraction(powered: boolean): number {
  return (powered ? POWERED_NUMERATOR : UNPOWERED_NUMERATOR) / RATE_DENOMINATOR;
}

/**
 * Is this building inside one of its owner's power radii?
 *
 * A plant powers itself, which saves the player from the silly special case of
 * a plant that runs at half speed because nothing is powering it.
 */
export function isPowered(world: World, building: Entity): boolean {
  for (const other of world.entities.list) {
    if (other.owner !== building.owner) continue;
    if (!isBuilding(other)) continue;
    // A plant under construction is scaffolding, not a grid.
    if (!isComplete(other)) continue;

    const radius = buildingDefOf(other).powerRadius;
    if (radius <= 0) continue;

    if (distSq(building.x, building.y, other.x, other.y) <= radius * radius) return true;
  }

  return false;
}

/**
 * How much progress a building makes this tick, in halves.
 *
 * Returned as an integer numerator over `RATE_DENOMINATOR` so that callers can
 * accumulate whole numbers: fractional progress in the simulation would be
 * floating point, and floating point is what the fixed-point work exists to
 * keep out of the world state.
 */
export function workRate(world: World, building: Entity): number {
  return isPowered(world, building) ? POWERED_NUMERATOR : UNPOWERED_NUMERATOR;
}

/** The denominator every `workRate` is measured against. */
export const WORK_RATE_DENOMINATOR = RATE_DENOMINATOR;
