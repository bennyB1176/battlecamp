/**
 * What a production building offers, as data.
 *
 * This lived inline in `main.ts`'s frame loop, where nothing could test it.
 * That is the same shape of mistake as the bot that was never called: code in
 * the entry point is code nobody is watching. Here it is a plain function over
 * the content tables, so the property that matters — the menu says what the
 * *table* says — has a test on it.
 *
 * No DOM: the caller decides whether this becomes a button, a list row, or a
 * line in a headless log.
 */

import type { BuildingDef } from "../content/buildings.js";
import { unitDef, type UnitTypeId } from "../content/units.js";
import { canAfford, type Cost, type Player } from "../sim/resources.js";

export interface TrainOption {
  readonly unitType: UnitTypeId;
  readonly name: string;
  /** Silhouette key the renderer draws this unit with. */
  readonly shape: string;
  readonly cost: Cost;
  /** False when the player cannot pay for it right now. */
  readonly affordable: boolean;
}

/**
 * The units this building can train, priced against what the player has.
 *
 * Affordability is asked of the same function the simulation uses, so a new
 * resource cannot make a button lie about what is payable.
 */
export function trainOptions(def: BuildingDef, player: Player): TrainOption[] {
  return def.produces.map((unitType) => {
    const unit = unitDef(unitType);
    return {
      unitType,
      name: unit.name,
      shape: unit.shape,
      cost: unit.cost,
      affordable: canAfford(player, unit.cost),
    };
  });
}
