/**
 * Biomes — the generator's thresholds, lifted into a table.
 *
 * Every map the game had ever produced was the same kind of place with the
 * lakes moved around, because the thresholds were constants in `mapgen.ts`.
 * Pure data here, like the unit and building tables, so a new biome is one
 * entry and no code.
 *
 * The rule each of these is written to: a biome has to change **what you do**,
 * not just what you look at. A desert with the same amount of wood as grassland
 * is a colour swap. So each one takes something away and gives something back,
 * and the blurb says which — the player should be able to choose knowing what
 * they are in for.
 */

import { Terrain, type TerrainType } from "../sim/grid.js";

export const Biome = {
  Grassland: 0,
  Desert: 1,
  Tundra: 2,
  Badlands: 3,
} as const;

export type BiomeId = (typeof Biome)[keyof typeof Biome];

export interface BiomeDef {
  readonly name: string;
  /** One line on what this map costs you and what it hands you. */
  readonly blurb: string;
  /**
   * Elevation thresholds, on the generator's 0..1024 noise scale.
   *
   * Below `waterLevel` is the barrier terrain, below `shoreLevel` is shore, and
   * above `rockLevel` is rock. Everything between is open ground.
   */
  readonly waterLevel: number;
  readonly shoreLevel: number;
  readonly rockLevel: number;
  /** What fills the low ground: water on most maps, lava in the badlands. */
  readonly barrier: TerrainType;
  /** The strip just above the barrier. */
  readonly shore: TerrainType;
  /** The open ground everything is built on. */
  readonly ground: TerrainType;
  /**
   * Moisture above which open ground becomes forest, on the same 0..1024 scale.
   *
   * This is the wood supply, and therefore the whole early economy: every
   * building and every unit in the game costs wood.
   */
  readonly forestLevel: number;
  /** One ore cluster per this many tiles. Lower means richer. */
  readonly oreSpacing: number;
  /** One stone cluster per this many tiles. Lower means richer. */
  readonly stoneSpacing: number;
}

export const BIOMES: Readonly<Record<BiomeId, BiomeDef>> = {
  // The yardstick the others are described against, and deliberately not
  // extreme in any direction: these are the numbers every balance pass so far
  // was run on.
  [Biome.Grassland]: {
    name: "Grasland",
    blurb: "Ausgewogen — viel Holz, genug von allem anderen",
    waterLevel: 320,
    shoreLevel: 380,
    rockLevel: 800,
    barrier: Terrain.Water,
    shore: Terrain.Sand,
    ground: Terrain.Grass,
    forestLevel: 620,
    oreSpacing: 900,
    stoneSpacing: 500,
  },

  // Wood is the bottleneck of the whole early game, so taking it away is the
  // strongest lever the table has. The ore and stone are the compensation: a
  // desert opening is slow and then suddenly rich.
  [Biome.Desert]: {
    name: "Wüste",
    blurb: "Kaum Holz, dafür Erz und Stein im Überfluss",
    waterLevel: 240,
    shoreLevel: 300,
    rockLevel: 830,
    barrier: Terrain.Water,
    shore: Terrain.Rock,
    ground: Terrain.Sand,
    // Nearly out of reach of the moisture noise, so forest survives only in a
    // few pockets — enough to open with, never enough to rely on.
    forestLevel: 880,
    oreSpacing: 480,
    stoneSpacing: 380,
  },

  // Nothing here is forbidden; everything is simply slower. Snow costs
  // movement, wood is thin, and stone is the one thing there is plenty of.
  [Biome.Tundra]: {
    name: "Tundra",
    blurb: "Zäh — langsamer Boden, wenig Holz, viel Stein",
    waterLevel: 300,
    shoreLevel: 350,
    rockLevel: 760,
    barrier: Terrain.Water,
    shore: Terrain.Rock,
    ground: Terrain.Snow,
    forestLevel: 760,
    oreSpacing: 800,
    stoneSpacing: 340,
  },

  // The cramped one. Lava does what water does and reads nothing like it, so
  // the map announces itself before the player has walked anywhere.
  [Biome.Badlands]: {
    name: "Ödland",
    blurb: "Eng und feindselig — Lavaadern zerschneiden die Karte",
    // Tuned against the walkable-ground test, not by eye: at a lava line of
    // 360 and a rock ceiling of 760 the badlands came out 49 % walkable, which
    // is where generated maps start producing pockets that strand a base. The
    // map is meant to be hostile, not unplayable.
    waterLevel: 335,
    shoreLevel: 385,
    rockLevel: 800,
    barrier: Terrain.Lava,
    shore: Terrain.Rock,
    ground: Terrain.Sand,
    forestLevel: 720,
    oreSpacing: 520,
    stoneSpacing: 520,
  },
};

/** Every biome, in the order the setup screen offers them. */
export const BIOME_LIST: readonly BiomeId[] = [
  Biome.Grassland,
  Biome.Desert,
  Biome.Tundra,
  Biome.Badlands,
];

export function biomeDef(biome: BiomeId): BiomeDef {
  return BIOMES[biome];
}
