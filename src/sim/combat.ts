/**
 * Fighting: acquiring targets, shooting, and dying.
 *
 * The design decision that shapes how the game feels is **restraint**. An idle
 * unit defends itself — it shoots whatever comes within reach — but it does not
 * advance. Only an explicit attack order, or attack-move, makes a unit close
 * distance.
 *
 * Units that chase on their own initiative pull an army apart one skirmish at a
 * time, and the player never ordered any of it. The cost of restraint is that
 * an enemy can sit just outside reach and be ignored; that is a far smaller
 * problem than an army that dissolves whenever something walks past.
 *
 * Damage runs through the matrix in `content/combat.ts`, so who wins is decided
 * by what each side chose to build.
 */

import { damageAgainst, type Weapon } from "../content/combat.js";
import { buildingDefOf, isBuilding, isComplete, isUnit, unitDefOf } from "./entities.js";
import type { Entity, EntityId } from "./entities.js";
import { getEntity, removeEntity } from "./entities.js";
import { distSq, isqrt, toTileIndex } from "./fixed.js";
import { setBlocked } from "./grid.js";
import { snapGoalToReachable } from "./movement.js";
import { buildingTiles } from "./entities.js";
import { queryRadius } from "./spatial.js";
import type { World } from "./world.js";
import { statsFor } from "./stats.js";

/**
 * How far past its weapon a unit will step to reach an ordered target before
 * giving up. Keeps a chase from becoming a cross-map pursuit.
 */
const CHASE_LEASH = 24;

/** Scratch buffer, reused so a busy battle allocates nothing. */
const nearbyScratch: Entity[] = [];

/** The weapon an entity fights with, or null. */
export function weaponOf(entity: Entity): Weapon | null {
  return isBuilding(entity) ? buildingDefOf(entity).weapon : unitDefOf(entity).weapon;
}

/** The armour class an entity is hit against. */
function armorOf(entity: Entity): number {
  return isBuilding(entity) ? buildingDefOf(entity).armor : unitDefOf(entity).armor;
}

/**
 * How far an entity notices an enemy on its own.
 *
 * An attack-moving unit was sent out looking for trouble, so it watches as far
 * as it can see. An idle one only reacts to what comes close — the difference
 * between an army advancing on a base and one that trickles away chasing
 * whatever drifts past.
 */
function acquireRange(entity: Entity, weapon: Weapon): number {
  // Buildings watch as far as they shoot; they cannot follow up anyway.
  if (isBuilding(entity)) return weapon.range;

  const def = unitDefOf(entity);
  if (entity.attackMoveX !== null) return def.sight;
  return Math.max(weapon.range, def.sight / 2);
}

export function updateCombat(world: World): void {
  // Cooldowns first, so a unit that fired last tick is ready on schedule.
  for (const entity of world.entities.list) {
    if (entity.weaponCooldown > 0) entity.weaponCooldown--;
  }

  for (const entity of world.entities.list) {
    const weapon = weaponOf(entity);
    if (!weapon) continue;
    // A half-built tower is scaffolding, not a gun emplacement.
    if (!isComplete(entity)) continue;

    stepFighter(world, entity, weapon);
  }

  reapDead(world);
}

function stepFighter(world: World, entity: Entity, weapon: Weapon): void {
  let target = entity.attackTargetId !== null ? getEntity(world.entities, entity.attackTargetId) : undefined;

  // The ordered target is gone or has changed hands — forget it.
  if (target && target.owner === entity.owner) target = undefined;
  if (!target) entity.attackTargetId = null;

  const ordered = entity.attackTargetId !== null;

  if (!target) {
    target = acquire(world, entity, weapon) ?? undefined;
    // Auto-acquired targets are not remembered as orders: the unit shoots what
    // is in front of it and forgets about it the moment it leaves.
  }

  if (!target) {
    // Nothing to shoot. Attack-moving units keep walking toward their
    // destination; everyone else stays put.
    resumeAttackMove(entity);
    return;
  }

  const reach = weapon.range + bodyRadius(target);
  const separationSq = distSq(entity.x, entity.y, target.x, target.y);

  if (separationSq <= reach * reach) {
    entity.goalX = null;
    entity.goalY = null;
    fire(world, entity, target, weapon);
    return;
  }

  // Out of reach. Only advance if the player asked for it — either by naming
  // this target, or by attack-moving through here.
  const advancing = ordered || entity.attackMoveX !== null;
  if (!advancing || isBuilding(entity)) return;

  const leash = reach + CHASE_LEASH * 256;
  if (ordered && separationSq > leash * leash && entity.attackMoveX === null) {
    // Too far to be worth chasing across the map.
    entity.attackTargetId = null;
    return;
  }

  // Walk to open ground beside the target, not into it. A building's centre is
  // ground it blocks, so heading straight for it is an unreachable order — the
  // attacker would stop dead a few tiles short and never fire a shot.
  //
  // Measured from the attacker, which is the whole difference between working
  // and not. Without it the snap can land in a pocket on the far side of the
  // target: movement refuses a goal it cannot route to, the unit stands still
  // four tiles short, and the building sits at full health while forty-four
  // soldiers mill around it. A twenty-minute match ended that way.
  const approach = snapGoalToReachable(world.grid, target.x, target.y, {
    tileX: toTileIndex(entity.x),
    tileY: toTileIndex(entity.y),
  });
  entity.goalX = approach.x;
  entity.goalY = approach.y;
  entity.blockedTicks = 0;
}

/** Nearest enemy within notice range. */
function acquire(world: World, entity: Entity, weapon: Weapon): Entity | null {
  const range = acquireRange(entity, weapon);
  const candidates = queryRadius(world.spatial, entity.x, entity.y, range + 512, nearbyScratch);

  let best: Entity | null = null;
  let bestDistanceSq = Number.POSITIVE_INFINITY;

  for (const other of candidates) {
    if (other.owner === entity.owner) continue;
    if (other.hp <= 0) continue;

    const separationSq = distSq(entity.x, entity.y, other.x, other.y);
    const noticeAt = range + bodyRadius(other);
    if (separationSq > noticeAt * noticeAt) continue;

    if (separationSq < bestDistanceSq) {
      bestDistanceSq = separationSq;
      best = other;
    }
  }

  return best;
}

function bodyRadius(entity: Entity): number {
  return isBuilding(entity) ? (buildingDefOf(entity).footprint * 256) / 2 : unitDefOf(entity).radius;
}

function fire(world: World, attacker: Entity, target: Entity, weapon: Weapon): void {
  if (attacker.weaponCooldown > 0) return;

  target.hp -= damageAgainst(weapon.damage, weapon.damageType, armorOf(target) as never);
  attacker.weaponCooldown = weapon.cooldownTicks;

  // Recorded where it was aimed, not where the target ends up: the tracer is
  // drawn over the following tenth of a second, and a target that dies or walks
  // in the meantime would otherwise drag the shot along behind it.
  world.shots.push({
    playerId: attacker.owner,
    fromX: attacker.x,
    fromY: attacker.y,
    toX: target.x,
    toY: target.y,
  });
}

/** Put an attack-moving unit back on the road once nothing is in reach. */
function resumeAttackMove(entity: Entity): void {
  if (entity.attackMoveX === null || entity.attackMoveY === null) return;

  const arrivedSq = 256 * 256;
  if (distSq(entity.x, entity.y, entity.attackMoveX, entity.attackMoveY) <= arrivedSq) {
    entity.attackMoveX = null;
    entity.attackMoveY = null;
    return;
  }

  if (entity.goalX === null) {
    entity.goalX = entity.attackMoveX;
    entity.goalY = entity.attackMoveY;
    entity.blockedTicks = 0;
  }
}

/**
 * Remove everything that died this tick.
 *
 * Done in one pass after all fighting, so two units killing each other in the
 * same tick both die — rather than the first one processed winning by accident
 * of iteration order.
 */
function reapDead(world: World): void {
  const dead: EntityId[] = [];
  for (const entity of world.entities.list) {
    if (entity.hp <= 0) dead.push(entity.id);
  }
  if (dead.length === 0) return;

  for (const id of dead) {
    const entity = getEntity(world.entities, id);
    if (!entity) continue;

    if (isBuilding(entity)) {
      // Give the ground back. Rubble that kept blocking would slowly fill the
      // map with invisible walls where buildings used to be.
      for (const tile of buildingTiles(entity)) {
        setBlocked(world.grid, tile.tileX, tile.tileY, false);
      }
      world.terrainDirty = true;
      statsFor(world, entity.owner).buildingsLost++;
    } else {
      statsFor(world, entity.owner).unitsLost++;
    }

    removeEntity(world.entities, id);
  }

  // Anything aiming at a corpse forgets it, and any worker helping to build a
  // site that no longer exists is released.
  for (const entity of world.entities.list) {
    if (entity.attackTargetId !== null && !getEntity(world.entities, entity.attackTargetId)) {
      entity.attackTargetId = null;
    }
    if (entity.buildTargetId !== null && !getEntity(world.entities, entity.buildTargetId)) {
      entity.buildTargetId = null;
      entity.goalX = null;
      entity.goalY = null;
    }
  }
}

/** Order an entity to attack a specific target. */
export function assignAttackTarget(world: World, attacker: Entity, targetId: EntityId): boolean {
  const target = getEntity(world.entities, targetId);
  if (!target) return false;
  if (target.owner === attacker.owner) return false;
  if (!weaponOf(attacker)) return false;

  attacker.attackTargetId = targetId;
  attacker.attackMoveX = null;
  attacker.attackMoveY = null;
  // Fighting and working are different jobs; taking one drops the other.
  attacker.job = null;
  attacker.buildTargetId = null;
  attacker.blockedTicks = 0;
  return true;
}

/** Order an entity to advance on a point, engaging whatever it meets. */
export function assignAttackMove(entity: Entity, x: number, y: number): boolean {
  if (!isUnit(entity)) return false;
  if (!weaponOf(entity)) return false;

  entity.attackMoveX = x;
  entity.attackMoveY = y;
  entity.attackTargetId = null;
  entity.job = null;
  entity.buildTargetId = null;
  entity.goalX = x;
  entity.goalY = y;
  entity.blockedTicks = 0;
  return true;
}

/** Cancel any fighting orders — used when a plain move order arrives. */
export function clearCombatOrders(entity: Entity): void {
  entity.attackTargetId = null;
  entity.attackMoveX = null;
  entity.attackMoveY = null;
}

/** Distance helper kept here so callers do not reimplement it. */
export function distanceBetween(a: Entity, b: Entity): number {
  return isqrt(distSq(a.x, a.y, b.x, b.y));
}
