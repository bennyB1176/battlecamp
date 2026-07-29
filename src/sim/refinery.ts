/**
 * Refineries: standing orders that turn raw materials into refined ones.
 *
 * The chain is what puts a *second* decision behind every advanced unit. Raw
 * ore is not a tank; ore plus a smelter you had the foresight to build, on
 * ground you can still defend, is a tank. That turns "can I afford it?" into
 * "did I plan for this five minutes ago?" — which is the question a strategy
 * game wants to be asking, and the one a pure buy-list never asks.
 *
 * Both ends of a recipe are the player's single global pool. No carts, no
 * warehouses, no routing: the only journey in this economy remains the worker's
 * round trip from seam to drop-off. What makes a refinery cost something is not
 * logistics but opportunity — the wood it eats is wood not spent on soldiers,
 * and the building is one more thing standing where somebody can burn it down.
 */

import { buildingDefOf, isBuilding, isComplete, type Entity } from "./entities.js";
import { workRate, WORK_RATE_DENOMINATOR } from "./power.js";
import { credit } from "./resources.js";
import type { World } from "./world.js";

export function updateRefineries(world: World): void {
  for (const entity of world.entities.list) {
    if (!isBuilding(entity)) continue;
    // A half-built shell producing goods would make construction time free.
    if (!isComplete(entity)) continue;

    const recipe = buildingDefOf(entity).refines;
    if (!recipe) continue;

    stepRefinery(world, entity);
  }
}

function stepRefinery(world: World, building: Entity): void {
  const recipe = buildingDefOf(building).refines!;
  const player = world.players[building.owner];
  if (!player) return;

  const state = building.refinery;
  if (!state) return;

  // Progress counts in half-ticks, not ticks: a building off the power grid
  // earns one a tick instead of two. Whole numbers keep the world state free of
  // floating point, which is the whole point of the fixed-point arithmetic.
  //
  // Nothing spare to work with: idle, rather than going into debt or banking
  // progress it has not earned. A refinery with no input is a building waiting
  // for work.
  //
  // "Spare" is the load-bearing word. A refinery that eats into the working
  // capital is a hole in the raw economy — the sawmill takes thirty wood every
  // twelve seconds forever, roughly one worker's whole output — and the player
  // watches their wood sit at zero without ever being told why.
  if (player.resources[recipe.input] - recipe.reserve < recipe.inputAmount) return;

  state.progress += workRate(world, building);
  if (state.progress < recipe.ticks * WORK_RATE_DENOMINATOR) return;

  // The input is only taken once the batch is actually finished. Charging up
  // front would let a player destroy their own refinery mid-batch and make the
  // materials vanish, which reads as a bug however it is explained.
  player.resources[recipe.input] -= recipe.inputAmount;
  credit(player, recipe.output, recipe.outputAmount);
  state.progress -= recipe.ticks * WORK_RATE_DENOMINATOR;
}
