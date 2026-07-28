/**
 * What the result screen says, as data.
 *
 * Same rule as the legend: every figure is read out of the world and the
 * content tables, never written out by hand somewhere near the markup. That is
 * also what makes it testable — the screen is a handful of divs around this.
 *
 * The screen exists because "Sieg" alone answers nothing. A win off the back of
 * a bigger economy and a win that cost two thirds of an army are different
 * games, and the tally is the only place that difference survives.
 */

import { playerColors, type PlayerColors } from "../content/players.js";
import type { PlayerId } from "../sim/entities.js";
import { RESOURCE_KINDS, RESOURCE_NAMES, type ResourceKind } from "../sim/resources.js";
import { statsFor, totalGathered } from "../sim/stats.js";
import { TICKS_PER_SECOND, type World } from "../sim/world.js";

export const Outcome = {
  Won: "won",
  Lost: "lost",
  Draw: "draw",
} as const;

export type OutcomeId = (typeof Outcome)[keyof typeof Outcome];

export interface HaulRow {
  readonly kind: ResourceKind;
  readonly name: string;
  readonly amount: number;
}

export interface SideResult {
  readonly playerId: PlayerId;
  readonly name: string;
  readonly colors: PlayerColors;
  /** True for the player reading the screen. */
  readonly isLocal: boolean;
  readonly isWinner: boolean;
  /** Everything dug up, across all resources. */
  readonly gathered: number;
  /** Per-resource breakdown, leaving out anything nobody touched. */
  readonly haul: readonly HaulRow[];
  readonly unitsTrained: number;
  readonly buildingsBuilt: number;
  readonly unitsLost: number;
  readonly buildingsLost: number;
}

export interface MatchResult {
  readonly outcome: OutcomeId;
  /** One line, in the second person — this is being read by the loser too. */
  readonly headline: string;
  readonly detail: string;
  /** Match length as m:ss. */
  readonly duration: string;
  /** The local player first: whoever is reading wants their own column first. */
  readonly sides: readonly SideResult[];
}

const HEADLINES: Readonly<Record<OutcomeId, { headline: string; detail: string }>> = {
  [Outcome.Won]: {
    headline: "Sieg",
    detail: "Der Gegner hat nichts mehr, womit er wieder aufbauen könnte.",
  },
  [Outcome.Lost]: {
    headline: "Niederlage",
    detail: "Kein Gebäude und kein Arbeiter mehr — von hier führt kein Weg zurück.",
  },
  [Outcome.Draw]: {
    headline: "Unentschieden",
    detail: "Beide Seiten sind ausgelöscht.",
  },
};

/** "Du" for whoever is reading; the rest are numbered only if there are several. */
function sideName(playerId: PlayerId, localPlayer: PlayerId, opponents: number): string {
  if (playerId === localPlayer) return "Du";
  if (opponents <= 1) return "Gegner";
  return `Gegner ${playerId}`;
}

function formatDuration(tick: number): string {
  const totalSeconds = Math.floor(tick / TICKS_PER_SECOND);
  return `${Math.floor(totalSeconds / 60)}:${(totalSeconds % 60).toString().padStart(2, "0")}`;
}

/**
 * The result, or null while the match is still being played.
 *
 * Null rather than a "still running" outcome: a screen that can render an
 * undecided match is a screen that can appear over a live game.
 */
export function matchResult(world: World, localPlayer: PlayerId): MatchResult | null {
  if (!world.matchOver) return null;

  const outcome: OutcomeId =
    world.winner === null ? Outcome.Draw : world.winner === localPlayer ? Outcome.Won : Outcome.Lost;

  const opponents = world.players.length - 1;
  const sides = world.players
    // The reader's own column first. Comparing anything is easier when the
    // thing you already know sits on the left.
    .slice()
    .sort((a, b) => Number(b.id === localPlayer) - Number(a.id === localPlayer))
    .map((player): SideResult => {
      const stats = statsFor(world, player.id);
      return {
        playerId: player.id,
        name: sideName(player.id, localPlayer, opponents),
        colors: playerColors(player.id),
        isLocal: player.id === localPlayer,
        isWinner: world.winner === player.id,
        gathered: totalGathered(stats),
        haul: RESOURCE_KINDS.filter((kind) => stats.gathered[kind] > 0).map((kind) => ({
          kind,
          name: RESOURCE_NAMES[kind],
          amount: stats.gathered[kind],
        })),
        unitsTrained: stats.unitsTrained,
        buildingsBuilt: stats.buildingsBuilt,
        unitsLost: stats.unitsLost,
        buildingsLost: stats.buildingsLost,
      };
    });

  return {
    outcome,
    headline: HEADLINES[outcome].headline,
    detail: HEADLINES[outcome].detail,
    duration: formatDuration(world.tick),
    sides,
  };
}
