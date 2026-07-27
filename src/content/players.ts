/**
 * Player colours.
 *
 * In a strategy game the single most important thing to read at a glance is
 * *whose* — friend or foe — before *what*. So colour is reserved for the player
 * and never used to distinguish unit types; that job belongs to silhouette.
 *
 * Getting this the wrong way round is a classic mistake: colour-code the types
 * and a red enemy soldier becomes indistinguishable from your own red soldier
 * in the middle of a fight, which is precisely when it matters most.
 */

export interface PlayerColors {
  /** Body fill. */
  readonly body: string;
  /** Outline and roofs — a darker shade of the same hue. */
  readonly dark: string;
  /** Highlights and details — a lighter shade. */
  readonly light: string;
}

/**
 * Chosen against the terrain palette, not in isolation.
 *
 * Every colour here has to stay readable on grass, sand, rock and water. Blue
 * is the hardest case — the map's water is blue — so player one's is pushed
 * much brighter than the water it may stand beside. Green and brown are
 * deliberately absent from the first two slots, because grass and ore already
 * own them.
 */
export const PLAYER_COLORS: readonly PlayerColors[] = [
  { body: "#62b0f5", dark: "#0e2f52", light: "#d2e9ff" },
  { body: "#e05a42", dark: "#4d1710", light: "#ffc0b3" },
  { body: "#b073e0", dark: "#3d1a57", light: "#e2c8f5" },
  { body: "#e8c34a", dark: "#5c4610", light: "#fff0c2" },
];

export function playerColors(playerId: number): PlayerColors {
  return PLAYER_COLORS[playerId % PLAYER_COLORS.length]!;
}
