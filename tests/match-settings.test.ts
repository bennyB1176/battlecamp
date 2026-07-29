/**
 * What a match is set up with, and how that survives a link.
 *
 * The settings live in the URL rather than in memory, which buys two things at
 * once: a match is shareable ("spiel mal Seed 481203"), and starting a new one
 * is a reload rather than a teardown of every listener, cache and canvas in the
 * game. Reproducing a map is exactly the property the deterministic core was
 * built for; it would be a waste not to expose it.
 *
 * Everything here is parsing, so it is the part that has to survive nonsense:
 * a truncated link, a hand-edited number, a seed somebody typed with a space in
 * it. None of that may end in a blank screen.
 */

import { describe, expect, it } from "vitest";

import { Difficulty } from "../src/ai/bot.js";
import { Biome, BIOME_LIST } from "../src/content/biomes.js";
import {
  DEFAULT_SETTINGS,
  MAP_SIZES,
  OPPONENT_COUNTS,
  parseSettings,
  randomSeed,
  settingsToQuery,
  type MatchSettings,
} from "../src/ui/match-settings.js";

function query(text: string): URLSearchParams {
  return new URLSearchParams(text);
}

describe("reading settings from a link", () => {
  it("reads a full set", () => {
    const settings = parseSettings(
      query("seed=4711&gegner=schwer&groesse=80&gelaende=wueste&gegnerzahl=3"),
    );
    expect(settings).toEqual({
      seed: 4711,
      difficulty: Difficulty.Hard,
      size: 80,
      biome: Biome.Desert,
      opponents: 3,
    });
  });

  it("still reads the plain difficulty link that used to be the only setting", () => {
    // Links like ?gegner=schwer are already out there in the notes; they have to
    // keep working, and a missing seed means "surprise me", not "refuse".
    const settings = parseSettings(query("gegner=schwer"));
    expect(settings.difficulty).toBe(Difficulty.Hard);
    expect(settings.size).toBe(DEFAULT_SETTINGS.size);
    expect(settings.seed).toBeGreaterThan(0);
  });

  it("falls back to the defaults for anything it cannot read", () => {
    const settings = parseSettings(query("seed=abc&gegner=unmöglich&groesse=riesig"));
    expect(settings.difficulty).toBe(DEFAULT_SETTINGS.difficulty);
    expect(settings.size).toBe(DEFAULT_SETTINGS.size);
    expect(Number.isInteger(settings.seed)).toBe(true);
  });

  it("survives an empty query without a menu of decisions", () => {
    const settings = parseSettings(query(""));
    expect(settings.difficulty).toBe(DEFAULT_SETTINGS.difficulty);
    expect(settings.size).toBe(DEFAULT_SETTINGS.size);
  });

  it("snaps a hand-edited map size to one the game offers", () => {
    // 63 tiles is not a thing the setup screen can produce, but a link can. The
    // nearest offered size beats both refusing and generating something no
    // other match will ever use.
    expect(parseSettings(query("groesse=63")).size).toBe(64);
    expect(parseSettings(query("groesse=5")).size).toBe(MAP_SIZES[0]!.tiles);
    expect(parseSettings(query("groesse=9999")).size).toBe(MAP_SIZES[MAP_SIZES.length - 1]!.tiles);
  });

  it("forgives stray spaces and capitals around a difficulty", () => {
    expect(parseSettings(query("gegner=%20Schwer%20")).difficulty).toBe(Difficulty.Hard);
  });

  it("refuses a seed that is not a positive whole number", () => {
    for (const bad of ["0", "-5", "1.5", "1e30", ""]) {
      const settings = parseSettings(query(`seed=${bad}`));
      expect(settings.seed, `seed=${bad} came through`).toBeGreaterThan(0);
      expect(Number.isSafeInteger(settings.seed)).toBe(true);
    }
  });
});

describe("writing settings back into a link", () => {
  it("round-trips every setting", () => {
    const settings: MatchSettings = {
      seed: 123456,
      difficulty: Difficulty.Normal,
      size: 48,
      biome: Biome.Tundra,
      opponents: 2,
    };
    expect(parseSettings(query(settingsToQuery(settings)))).toEqual(settings);
  });

  it("round-trips every offered map size", () => {
    for (const size of MAP_SIZES) {
      const settings: MatchSettings = {
        seed: 7,
        difficulty: Difficulty.Easy,
        size: size.tiles,
        biome: Biome.Grassland,
        opponents: 1,
      };
      expect(parseSettings(query(settingsToQuery(settings))).size).toBe(size.tiles);
    }
  });

  it("writes the seed in a form somebody can read out loud", () => {
    const text = settingsToQuery({
      seed: 481203,
      difficulty: Difficulty.Easy,
      size: 64,
      biome: Biome.Badlands,
      opponents: 3,
    });
    expect(text).toContain("seed=481203");
  });
});

describe("rolling a seed", () => {
  it("stays inside what the parser accepts", () => {
    for (let i = 0; i < 200; i++) {
      const seed = randomSeed();
      expect(parseSettings(query(`seed=${seed}`)).seed).toBe(seed);
    }
  });

  it("does not hand out the same map every time", () => {
    const seen = new Set(Array.from({ length: 50 }, () => randomSeed()));
    expect(seen.size).toBeGreaterThan(40);
  });
});

describe("the terrain setting", () => {
  it("round-trips every biome", () => {
    for (const biome of BIOME_LIST) {
      const settings: MatchSettings = { seed: 9, difficulty: Difficulty.Easy, size: 64, biome, opponents: 1 };
      expect(parseSettings(query(settingsToQuery(settings))).biome).toBe(biome);
    }
  });

  it("writes a slug a person can read, not a number", () => {
    const text = settingsToQuery({
      seed: 9,
      difficulty: Difficulty.Easy,
      size: 64,
      biome: Biome.Tundra,
      opponents: 1,
    });
    expect(text).toContain("gelaende=tundra");
  });

  it("falls back to grassland for a terrain it does not know", () => {
    expect(parseSettings(query("gelaende=dschungel")).biome).toBe(Biome.Grassland);
    expect(parseSettings(query("")).biome).toBe(Biome.Grassland);
  });
});

describe("how many opponents", () => {
  it("round-trips every offered count", () => {
    for (const opponents of OPPONENT_COUNTS) {
      const settings: MatchSettings = {
        seed: 9,
        difficulty: Difficulty.Easy,
        size: 64,
        biome: Biome.Grassland,
        opponents,
      };
      expect(parseSettings(query(settingsToQuery(settings))).opponents).toBe(opponents);
    }
  });

  it("clamps a hand-edited count to what the map can seat", () => {
    // Four bases is what the anchor table has room for, so three opponents is
    // the ceiling — and a link asking for nine has to start a game anyway.
    expect(parseSettings(query("gegnerzahl=9")).opponents).toBe(
      OPPONENT_COUNTS[OPPONENT_COUNTS.length - 1],
    );
    expect(parseSettings(query("gegnerzahl=0")).opponents).toBe(OPPONENT_COUNTS[0]);
    expect(parseSettings(query("gegnerzahl=hallo")).opponents).toBe(DEFAULT_SETTINGS.opponents);
  });

  it("defaults to a duel", () => {
    // The setting nearly everybody plays, and the one every balance run used.
    expect(parseSettings(query("")).opponents).toBe(1);
  });
});

describe("the offered map sizes", () => {
  it("names every one of them", () => {
    for (const size of MAP_SIZES) {
      expect(size.name).toBeTruthy();
      expect(size.tiles).toBeGreaterThan(0);
    }
  });

  it("lists them small to large, so the setup screen can just print them", () => {
    for (let i = 1; i < MAP_SIZES.length; i++) {
      expect(MAP_SIZES[i]!.tiles).toBeGreaterThan(MAP_SIZES[i - 1]!.tiles);
    }
  });

  it("offers the default among them", () => {
    expect(MAP_SIZES.some((size) => size.tiles === DEFAULT_SETTINGS.size)).toBe(true);
  });
});
