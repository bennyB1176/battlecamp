/**
 * What a match is set up with, kept in the URL.
 *
 * The URL rather than memory, for two reasons that both matter more than they
 * look. A match becomes **shareable** — "spiel mal Seed 481203" reproduces the
 * exact same map on someone else's phone, which is the property the
 * deterministic core was built for and would be a waste to hide. And starting a
 * new match becomes a **reload** instead of tearing down every listener, cache
 * and canvas the game has built up, which is where restart bugs live.
 *
 * Everything here is parsing, so it has to survive nonsense: a truncated link,
 * a hand-edited number, a seed with a space in it. None of that may end in a
 * blank screen, so every reader falls back rather than throwing.
 */

import { Difficulty, type DifficultyId } from "../ai/bot.js";

export interface MapSize {
  readonly name: string;
  readonly tiles: number;
}

/**
 * Offered map sizes, smallest first.
 *
 * Small is a knife fight — you find the enemy in the first minute and the fog
 * barely matters. Large is where scouting and expansions come into their own,
 * at the price of a longer match on a phone.
 */
export const MAP_SIZES: readonly MapSize[] = [
  { name: "Klein", tiles: 48 },
  { name: "Mittel", tiles: 64 },
  { name: "Groß", tiles: 80 },
];

export interface MatchSettings {
  readonly seed: number;
  readonly difficulty: DifficultyId;
  readonly size: number;
}

/** Largest seed the game hands out. Six digits: readable, and easy to type. */
const MAX_SEED = 999_999;

export const DEFAULT_SETTINGS: Omit<MatchSettings, "seed"> & { readonly seed: number } = {
  seed: 20260727,
  // The gentlest setting, because a first match that is simply lost teaches
  // nothing about how the game works.
  difficulty: Difficulty.Easy,
  size: 64,
};

const DIFFICULTY_BY_NAME: Readonly<Record<string, DifficultyId>> = {
  leicht: Difficulty.Easy,
  easy: Difficulty.Easy,
  normal: Difficulty.Normal,
  schwer: Difficulty.Hard,
  hard: Difficulty.Hard,
};

/** German name for a difficulty, for links and for the setup screen. */
export const DIFFICULTY_SLUGS: Readonly<Record<DifficultyId, string>> = {
  [Difficulty.Easy]: "leicht",
  [Difficulty.Normal]: "normal",
  [Difficulty.Hard]: "schwer",
};

/** A fresh map. Outside the simulation, so ordinary randomness is fine here. */
export function randomSeed(): number {
  return 1 + Math.floor(Math.random() * MAX_SEED);
}

function readSeed(raw: string | null): number | null {
  if (raw === null) return null;
  const text = raw.trim();
  // Rejected rather than coerced: `Number("")` is 0 and `Number("1e30")` is a
  // perfectly good float, and neither is a seed anybody meant to type.
  if (!/^\d+$/.test(text)) return null;

  const value = Number(text);
  if (!Number.isSafeInteger(value) || value <= 0) return null;
  return value;
}

/** The offered size nearest the requested one. */
function snapSize(tiles: number): number {
  let best = MAP_SIZES[0]!.tiles;
  let bestGap = Number.POSITIVE_INFINITY;
  for (const size of MAP_SIZES) {
    const gap = Math.abs(size.tiles - tiles);
    if (gap < bestGap) {
      bestGap = gap;
      best = size.tiles;
    }
  }
  return best;
}

/**
 * Read a match setup out of a query string.
 *
 * A link with a difficulty but no seed means "this hard, surprise me with the
 * map" — those links already exist in the project's own notes, and they have to
 * keep working.
 */
export function parseSettings(query: URLSearchParams): MatchSettings {
  const seed = readSeed(query.get("seed"));
  const difficultyName = (query.get("gegner") ?? "").trim().toLowerCase();
  const sizeText = (query.get("groesse") ?? "").trim();
  const sizeValue = /^\d+$/.test(sizeText) ? Number(sizeText) : null;

  return {
    seed: seed ?? randomSeed(),
    difficulty: DIFFICULTY_BY_NAME[difficultyName] ?? DEFAULT_SETTINGS.difficulty,
    size: sizeValue === null ? DEFAULT_SETTINGS.size : snapSize(sizeValue),
  };
}

/** The query string that reproduces this match. */
export function settingsToQuery(settings: MatchSettings): string {
  const query = new URLSearchParams();
  query.set("seed", String(settings.seed));
  query.set("gegner", DIFFICULTY_SLUGS[settings.difficulty]);
  query.set("groesse", String(settings.size));
  return query.toString();
}
