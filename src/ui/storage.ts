/**
 * Where a saved match lives.
 *
 * `localStorage`, deliberately: it is synchronous, which matters because the
 * one moment a save has to succeed is the moment the browser is taking the page
 * away — a phone call, a locked screen, a tab being reclaimed. An async store
 * loses that race.
 *
 * Every operation is defensive. Storage can be full, disabled outright in
 * private browsing, or hold a save written by an older version of the game.
 * None of those may stop somebody playing: a failed save is a match that
 * carries on unsaved, and an unreadable save is a fresh start, never an error
 * screen over a game that was working fine.
 */

import { restoreWorld, snapshotWorld, type WorldSnapshot } from "../sim/snapshot.js";
import type { World } from "../sim/world.js";
import { DIFFICULTY_SLUGS, parseSettings, type MatchSettings } from "./match-settings.js";

const KEY = "battlecamp.save.v1";

export interface SavedMatch {
  readonly world: World;
  readonly settings: MatchSettings;
  /** Match clock at the moment it was written, for the resume button. */
  readonly tick: number;
}

interface StoredShape {
  readonly snapshot: WorldSnapshot;
  readonly query: string;
}

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    // Private browsing on some phones throws on the *property access* itself.
    return null;
  }
}

/**
 * Write the match down. Returns false when it could not be stored.
 *
 * Failure is reported rather than thrown: the caller is a game loop, and a full
 * disk is not a reason to stop playing.
 */
export function saveMatch(world: World, settings: MatchSettings): boolean {
  const store = storage();
  if (!store) return false;

  try {
    const stored: StoredShape = {
      snapshot: snapshotWorld(world),
      // The settings the match was started with, so a resumed game keeps the
      // opponent it was being played against. The map itself comes from the
      // snapshot — regenerating it from the seed would undo every felled forest.
      query: `seed=${settings.seed}&gegner=${DIFFICULTY_SLUGS[settings.difficulty]}&groesse=${settings.size}`,
    };
    store.setItem(KEY, JSON.stringify(stored));
    return true;
  } catch {
    return false;
  }
}

/** The saved match, or null if there is none that can be read. */
export function loadMatch(): SavedMatch | null {
  const store = storage();
  if (!store) return null;

  let text: string | null;
  try {
    text = store.getItem(KEY);
  } catch {
    return null;
  }
  if (!text) return null;

  try {
    const stored = JSON.parse(text) as StoredShape;
    const world = restoreWorld(stored.snapshot);
    const settings = parseSettings(new URLSearchParams(stored.query ?? ""));

    return {
      world,
      // The biome comes off the snapshot rather than the query: the world is
      // the authority on what it is, and an older save may predate the setting.
      settings: { ...settings, biome: world.biome, size: world.grid.width },
      tick: world.tick,
    };
  } catch {
    // Unreadable for any reason — a half-written save, a format from an older
    // version — is discarded rather than left to fail again on every load.
    clearMatch();
    return null;
  }
}

export function clearMatch(): void {
  try {
    storage()?.removeItem(KEY);
  } catch {
    // Nothing useful to do, and nothing worth interrupting the player over.
  }
}

/** Whether a resumable match is stored, without paying to rebuild the world. */
export function hasSavedMatch(): boolean {
  const store = storage();
  if (!store) return false;
  try {
    return store.getItem(KEY) !== null;
  } catch {
    return false;
  }
}
