/**
 * Resources: what the ground holds, and what each player has banked.
 *
 * Deposits are **finite**. That one decision is what makes a map a strategic
 * space rather than a backdrop: once a base has stripped the ground around it,
 * expanding means moving toward terrain somebody else also wants. An infinite
 * deposit would make the starting position the only position that ever matters.
 *
 * Banked resources are a single global pool per player — no carts, no
 * warehouses to route between. The one journey that exists is the worker's
 * round trip from deposit to drop-off, which is what makes *where* you put a
 * depot an actual decision.
 */

import { setTerrain, Terrain, terrainAt, isInside, type TerrainType } from "./grid.js";
import type { PlayerId } from "./entities.js";
import type { World } from "./world.js";

export const Resource = {
  Wood: 0,
  Stone: 1,
  Ore: 2,
  /** Refined from wood. */
  Planks: 3,
  /** Refined from ore. */
  Steel: 4,
} as const;

export type ResourceKind = (typeof Resource)[keyof typeof Resource];

export const RESOURCE_KINDS: readonly ResourceKind[] = [
  Resource.Wood,
  Resource.Stone,
  Resource.Ore,
  Resource.Planks,
  Resource.Steel,
];

/**
 * The ones that come out of the ground, in the order the HUD shows them.
 *
 * Separate from RESOURCE_KINDS because plenty of code means specifically "what
 * a worker can be sent to dig up" — a bot looking for the scarcest seam must
 * not decide the answer is steel and then wander the map looking for a steel
 * mine.
 */
export const RAW_KINDS: readonly ResourceKind[] = [Resource.Wood, Resource.Stone, Resource.Ore];

/** What a refinery makes. Everything here has to be produced, never gathered. */
export const REFINED_KINDS: readonly ResourceKind[] = [Resource.Planks, Resource.Steel];

/**
 * Swatch colour for the resource bar, kept beside the name for the same reason
 * `TERRAIN_INFO` carries one: adding a resource should be a single edit here,
 * not a hunt through markup and a stylesheet for the three places that would
 * otherwise have to agree.
 */
export const RESOURCE_COLORS: Readonly<Record<ResourceKind, string>> = {
  [Resource.Wood]: "#6ba85a",
  [Resource.Stone]: "#c9c6bd",
  [Resource.Ore]: "#d69a4c",
  // Refined goods share their raw material's hue, lightened: the bar reads as
  // two tiers at a glance rather than as five unrelated colours.
  [Resource.Planks]: "#a8d18f",
  [Resource.Steel]: "#9fb6c9",
};

export const RESOURCE_NAMES: Readonly<Record<ResourceKind, string>> = {
  [Resource.Wood]: "Holz",
  [Resource.Stone]: "Stein",
  [Resource.Ore]: "Erz",
  [Resource.Planks]: "Bretter",
  [Resource.Steel]: "Stahl",
};

/** A price tag. Missing entries mean "costs none of that". */
export type Cost = Partial<Record<ResourceKind, number>>;

/** How much a freshly generated tile of each kind holds. */
const DEPOSIT_YIELD: Readonly<Record<ResourceKind, number>> = {
  [Resource.Wood]: 240,
  [Resource.Stone]: 400,
  [Resource.Ore]: 320,
  // Refined goods are never in the ground; these exist only to keep the record
  // total, and `resourceOfTerrain` never returns them.
  [Resource.Planks]: 0,
  [Resource.Steel]: 0,
};

export function resourceOfTerrain(terrain: TerrainType): ResourceKind | null {
  switch (terrain) {
    case Terrain.Forest:
      return Resource.Wood;
    case Terrain.Stone:
      return Resource.Stone;
    case Terrain.Ore:
      return Resource.Ore;
    default:
      return null;
  }
}

export interface Player {
  readonly id: PlayerId;
  resources: Record<ResourceKind, number>;
}

export function createPlayer(id: PlayerId, starting: Cost = {}): Player {
  return {
    id,
    resources: {
      [Resource.Wood]: starting[Resource.Wood] ?? 0,
      [Resource.Stone]: starting[Resource.Stone] ?? 0,
      [Resource.Ore]: starting[Resource.Ore] ?? 0,
      [Resource.Planks]: starting[Resource.Planks] ?? 0,
      [Resource.Steel]: starting[Resource.Steel] ?? 0,
    },
  };
}

export function credit(player: Player, resource: ResourceKind, amount: number): void {
  if (amount <= 0) return;
  player.resources[resource] += amount;
}

export function canAfford(player: Player, cost: Cost): boolean {
  for (const kind of RESOURCE_KINDS) {
    if ((player.resources[kind] ?? 0) < (cost[kind] ?? 0)) return false;
  }
  return true;
}

/**
 * Pay a cost in full, or not at all.
 *
 * Partial payment would leave a half-ordered building and an account that no
 * longer reflects what the player owns, so affordability is checked before a
 * single unit is deducted.
 */
export function debit(player: Player, cost: Cost): boolean {
  if (!canAfford(player, cost)) return false;
  for (const kind of RESOURCE_KINDS) {
    player.resources[kind] -= cost[kind] ?? 0;
  }
  return true;
}

/** Build the deposit layer from the terrain. Called once, at world creation. */
export function stockDeposits(world: World): void {
  const { grid } = world;
  for (let y = 0; y < grid.height; y++) {
    for (let x = 0; x < grid.width; x++) {
      const resource = resourceOfTerrain(terrainAt(grid, x, y));
      world.deposits[y * grid.width + x] = resource === null ? 0 : DEPOSIT_YIELD[resource];
    }
  }
}

export function depositAt(world: World, tileX: number, tileY: number): number {
  if (!isInside(world.grid, tileX, tileY)) return 0;
  return world.deposits[tileY * world.grid.width + tileX]!;
}

export function totalDeposits(world: World): number {
  let total = 0;
  for (const amount of world.deposits) total += amount;
  return total;
}

/**
 * Take up to `wanted` from a tile.
 *
 * When the last of it is taken the tile reverts to open grass: the forest has
 * been felled, the seam worked out. That changes what is walkable and buildable,
 * so callers must invalidate cached flow fields — `world.ts` does this centrally
 * rather than leaving it to every caller to remember.
 */
export function harvestFrom(
  world: World,
  tileX: number,
  tileY: number,
  wanted: number,
): { resource: ResourceKind; amount: number } | null {
  if (!isInside(world.grid, tileX, tileY)) return null;
  if (wanted <= 0) return null;

  const resource = resourceOfTerrain(terrainAt(world.grid, tileX, tileY));
  if (resource === null) return null;

  const index = tileY * world.grid.width + tileX;
  const available = world.deposits[index]!;
  if (available <= 0) return null;

  const amount = Math.min(wanted, available);
  world.deposits[index] = available - amount;

  if (world.deposits[index] === 0) {
    setTerrain(world.grid, tileX, tileY, Terrain.Grass);
    world.terrainDirty = true;
  }

  return { resource, amount };
}
