/**
 * A 32-bit fingerprint of the whole world state (FNV-1a).
 *
 * This is the determinism tripwire. Two runs from the same seed with the same
 * commands must produce the same hash at every tick. If someone slips a
 * `Math.random()`, a `Date.now()`, or an iteration over an unordered `Set` into
 * the sim, this diverges and the test fails.
 *
 * It is also what a lockstep multiplayer session would exchange periodically to
 * detect desync early instead of letting two clients drift apart silently.
 */

import type { World } from "./world.js";

const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

function mix(hash: number, value: number): number {
  return Math.imul(hash ^ (value >>> 0), FNV_PRIME) >>> 0;
}

/** Mix in a 32-bit value one byte at a time, so byte order is part of the hash. */
function mixInt32(hash: number, value: number): number {
  let h = hash;
  h = mix(h, value & 0xff);
  h = mix(h, (value >>> 8) & 0xff);
  h = mix(h, (value >>> 16) & 0xff);
  h = mix(h, (value >>> 24) & 0xff);
  return h;
}

export function hashWorld(world: World): number {
  let h = FNV_OFFSET_BASIS;

  h = mixInt32(h, world.tick);
  h = mixInt32(h, world.seed);
  h = mixInt32(h, world.rng.state);

  h = mixInt32(h, world.grid.width);
  h = mixInt32(h, world.grid.height);
  for (let i = 0; i < world.grid.tiles.length; i++) {
    h = mix(h, world.grid.tiles[i]!);
  }

  h = mixInt32(h, world.markers.length);
  for (const marker of world.markers) {
    h = mixInt32(h, marker.playerId);
    h = mixInt32(h, marker.tileX);
    h = mixInt32(h, marker.tileY);
    h = mixInt32(h, marker.ticksLeft);
  }

  return h >>> 0;
}

/** Hex form, handy for test failure messages and desync reports. */
export function hashWorldHex(world: World): string {
  return hashWorld(world).toString(16).padStart(8, "0");
}
