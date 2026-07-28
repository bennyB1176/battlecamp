/**
 * Drawing units and buildings.
 *
 * Two rules carry the whole visual language, and they exist for legibility
 * rather than looks:
 *
 * **Colour says whose. Shape says what.** In a fight, the first question is
 * always friend or foe, so colour is reserved for the player and never spent on
 * distinguishing unit types. Type is carried by silhouette, which survives
 * being small, overlapping and half off-screen. Colour-coding the types instead
 * is a classic mistake: your red soldier and the enemy's red soldier become the
 * same thing exactly when telling them apart matters most.
 *
 * **Detail scales with zoom.** Zoomed out, a unit is a dot in its player's
 * colour — anything more is noise at that size.
 *
 * The simulation ticks ten times a second and the display refreshes sixty, so
 * everything is drawn between where it was last tick and where it is now, using
 * the `alpha` the game loop provides. That is the entire reason entities carry
 * `prevX`/`prevY`.
 *
 * Nothing here loads an image. Silhouettes are Canvas paths, which keeps the
 * build tiny and means real sprites can replace them later by changing what
 * `UnitDef.shape` selects — and nothing else.
 */

import { BuildingGlyph, buildingDef, type BuildingTypeId } from "../content/buildings.js";
import { playerColors } from "../content/players.js";
import { UnitShape } from "../content/units.js";
import type { Camera } from "../input/camera.js";
import { visibleTileBounds, worldToScreen } from "../input/camera.js";
import type { Selection } from "../input/selection.js";
import { canPlace, PlacementError } from "../sim/construction.js";
import {
  buildingDefOf,
  buildingOrigin,
  isBuilding,
  isComplete,
  unitDefOf,
  type Entity,
  type EntityId,
} from "../sim/entities.js";
import { toTiles } from "../sim/fixed.js";
import { Resource } from "../sim/resources.js";
import type { World } from "../sim/world.js";

/** Below this zoom, units are plain dots — outlines and glyphs only muddy them. */
const DETAIL_MIN_TILE_SIZE = 12;

/** Below this, health bars are more clutter than information. */
const HEALTH_BAR_MIN_TILE_SIZE = 16;

export interface WorldBox {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

/**
 * Which way each unit is facing, remembered between frames.
 *
 * Facing is derived from movement, so it needs somewhere to persist while a
 * unit stands still. It lives here rather than in the world because it is
 * purely cosmetic — putting it in the simulation would mean replays recorded it
 * and multiplayer clients had to agree on it, for no gain.
 */
const facings = new Map<EntityId, number>();

const RESOURCE_COLORS: Record<number, string> = {
  [Resource.Wood]: "#6ba85a",
  [Resource.Stone]: "#d8d5cc",
  [Resource.Ore]: "#e0a75c",
};

export function drawEntities(
  ctx: CanvasRenderingContext2D,
  world: World,
  camera: Camera,
  selection: Selection,
  alpha: number,
): void {
  const bounds = visibleTileBounds(camera);
  const margin = 3;
  const detailed = camera.tileSize >= DETAIL_MIN_TILE_SIZE;

  // Buildings first, so units walking past a wall are drawn over it.
  for (const pass of [true, false]) {
    for (const entity of world.entities.list) {
      if (isBuilding(entity) !== pass) continue;

      const worldX = toTiles(entity.prevX + (entity.x - entity.prevX) * alpha);
      const worldY = toTiles(entity.prevY + (entity.y - entity.prevY) * alpha);

      if (
        worldX < bounds.minX - margin ||
        worldX > bounds.maxX + margin ||
        worldY < bounds.minY - margin ||
        worldY > bounds.maxY + margin
      ) {
        continue;
      }

      const selected = selection.ids.has(entity.id);
      if (isBuilding(entity)) {
        drawBuilding(ctx, entity, camera, selected, detailed);
      } else {
        drawUnit(ctx, entity, camera, worldX, worldY, selected, detailed);
      }
    }
  }
}

function drawUnit(
  ctx: CanvasRenderingContext2D,
  entity: Entity,
  camera: Camera,
  worldX: number,
  worldY: number,
  selected: boolean,
  detailed: boolean,
): void {
  const def = unitDefOf(entity);
  const colors = playerColors(entity.owner);
  const screen = worldToScreen(camera, worldX, worldY);
  const radius = Math.max(2, toTiles(def.radius) * camera.tileSize);

  if (!detailed) {
    // Too small for a silhouette to read — a coloured dot says the only thing
    // still legible at this size: whose it is.
    ctx.fillStyle = colors.body;
    ctx.beginPath();
    ctx.arc(screen.x, screen.y, Math.max(1.5, radius), 0, Math.PI * 2);
    ctx.fill();
    return;
  }

  const facing = updateFacing(entity);

  ctx.save();
  ctx.translate(screen.x, screen.y);
  ctx.rotate(facing);

  ctx.fillStyle = colors.body;
  ctx.strokeStyle = colors.dark;
  ctx.lineWidth = Math.max(1, radius * 0.22);

  traceUnitShape(ctx, def.shape, radius);
  ctx.fill();
  ctx.stroke();

  // A lighter mark toward the front gives the silhouette a readable "nose", so
  // facing is obvious even when a unit is barely bigger than a few pixels.
  ctx.fillStyle = colors.light;
  ctx.beginPath();
  ctx.arc(radius * 0.42, 0, Math.max(1, radius * 0.22), 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();

  if (entity.job !== null && entity.job.carrying !== null && entity.job.carried > 0) {
    // What a worker is carrying, so the economy is legible on the map and not
    // only in the numbers at the top.
    ctx.fillStyle = RESOURCE_COLORS[entity.job.carrying] ?? "#ffffff";
    ctx.strokeStyle = "rgba(0,0,0,0.6)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(screen.x, screen.y - radius - radius * 0.55, Math.max(1.5, radius * 0.38), 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  if (selected) {
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(screen.x, screen.y, radius + 4, 0, Math.PI * 2);
    ctx.stroke();
  }

  drawHealthBar(ctx, entity, camera, screen.x, screen.y - radius - 8, radius * 2.4, def.maxHp, selected);
}

/**
 * Facing, derived from where the unit moved.
 *
 * Below a threshold the movement is jitter from separation rather than travel,
 * and turning to face it would make an idle crowd twitch.
 */
function updateFacing(entity: Entity): number {
  const dx = entity.x - entity.prevX;
  const dy = entity.y - entity.prevY;

  if (dx * dx + dy * dy > 4) {
    const angle = Math.atan2(dy, dx);
    facings.set(entity.id, angle);
    return angle;
  }

  return facings.get(entity.id) ?? 0;
}

/**
 * Silhouettes, drawn facing +x so the caller can simply rotate.
 *
 * Exported because the in-game legend draws its icons with this exact
 * function. A legend that redraws the shapes by hand is a legend that will
 * quietly stop matching the game.
 */
export function traceUnitShape(ctx: CanvasRenderingContext2D, shape: string, radius: number): void {
  ctx.beginPath();

  switch (shape) {
    case UnitShape.Arrow: {
      // Narrow and pointed: reads as fast even at a glance.
      ctx.moveTo(radius * 1.35, 0);
      ctx.lineTo(-radius * 0.8, radius * 0.85);
      ctx.lineTo(-radius * 0.35, 0);
      ctx.lineTo(-radius * 0.8, -radius * 0.85);
      ctx.closePath();
      return;
    }
    case UnitShape.Shield: {
      // Broad, flat-fronted: reads as someone standing behind a shield.
      const w = radius * 1.05;
      const h = radius * 1.1;
      ctx.moveTo(w, -h * 0.55);
      ctx.lineTo(w, h * 0.55);
      ctx.lineTo(-w * 0.55, h);
      ctx.lineTo(-w, h * 0.3);
      ctx.lineTo(-w, -h * 0.3);
      ctx.lineTo(-w * 0.55, -h);
      ctx.closePath();
      return;
    }
    case UnitShape.Wedge: {
      // A chevron: short, fat, and notched at the back. The concave rear is the
      // point — a merely "blunt" shape was indistinguishable from the vehicle's
      // at icon size, which defeats the whole purpose of having silhouettes.
      const w = radius * 1.2;
      const h = radius * 1.15;
      ctx.moveTo(w, 0);
      ctx.lineTo(-w * 0.35, h);
      ctx.lineTo(-w, h * 0.75);
      ctx.lineTo(-w * 0.3, 0);
      ctx.lineTo(-w, -h * 0.75);
      ctx.lineTo(-w * 0.35, -h);
      ctx.closePath();
      return;
    }
    case UnitShape.Hull: {
      // Long, rectangular, corners clipped. The elongation does the work:
      // nothing else in the roster is twice as long as it is wide, so it reads
      // as a machine at any size.
      const w = radius * 1.55;
      const h = radius * 0.7;
      const cut = h * 0.55;
      ctx.moveTo(w - cut, -h);
      ctx.lineTo(w, -h + cut);
      ctx.lineTo(w, h - cut);
      ctx.lineTo(w - cut, h);
      ctx.lineTo(-w + cut, h);
      ctx.lineTo(-w, h - cut);
      ctx.lineTo(-w, -h + cut);
      ctx.lineTo(-w + cut, -h);
      ctx.closePath();
      return;
    }
    case UnitShape.Round:
    default: {
      // Soft and round: reads as civilian, not a threat.
      ctx.arc(0, 0, radius, 0, Math.PI * 2);
      return;
    }
  }
}

/**
 * Buildings are drawn on their real footprint, which matters for more than
 * looks: the shape on screen is exactly the ground they block, so it is obvious
 * why a unit walks around rather than through.
 */
function drawBuilding(
  ctx: CanvasRenderingContext2D,
  entity: Entity,
  camera: Camera,
  selected: boolean,
  detailed: boolean,
): void {
  const def = buildingDefOf(entity);
  const colors = playerColors(entity.owner);
  const origin = buildingOrigin(entity);
  const topLeft = worldToScreen(camera, origin.tileX, origin.tileY);
  const size = def.footprint * camera.tileSize;

  const underConstruction = !isComplete(entity);
  const inset = size * 0.08;

  ctx.save();
  ctx.globalAlpha = underConstruction ? 0.5 : 1;

  // Walls in the player's colour, roof a darker shade of the same hue: the
  // building reads as one object rather than two stacked rectangles.
  ctx.fillStyle = colors.body;
  ctx.fillRect(topLeft.x + inset, topLeft.y + inset, size - inset * 2, size - inset * 2);

  if (detailed) {
    ctx.fillStyle = colors.dark;
    // A roof band across the top third gives the block an orientation and a
    // sense of scale.
    ctx.fillRect(topLeft.x + inset, topLeft.y + inset, size - inset * 2, (size - inset * 2) * 0.34);

    ctx.strokeStyle = "rgba(0,0,0,0.75)";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(topLeft.x + inset, topLeft.y + inset, size - inset * 2, size - inset * 2);

    // The mark that says *what* this is. Colour is spent on whose it is and
    // there are only two footprints, so without this a base of seven building
    // types is seven identical coloured blocks.
    drawBuildingGlyph(ctx, def.glyph, topLeft.x + size / 2, topLeft.y + size * 0.6, size * 0.28, colors.light);
  }

  ctx.globalAlpha = 1;

  if (underConstruction && entity.construction !== null) {
    // Scaffolding: a bar that fills as the work is done.
    const done = 1 - entity.construction / def.buildWork;
    const barHeight = Math.max(3, size * 0.12);
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(topLeft.x, topLeft.y + size - barHeight, size, barHeight);
    ctx.fillStyle = "#ffd666";
    ctx.fillRect(topLeft.x, topLeft.y + size - barHeight, size * done, barHeight);
  }

  if (selected) {
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2;
    ctx.strokeRect(topLeft.x - 3, topLeft.y - 3, size + 6, size + 6);
  }

  ctx.restore();

  if (!underConstruction) {
    drawHealthBar(ctx, entity, camera, topLeft.x + size / 2, topLeft.y - 8, size * 0.9, def.maxHp, selected);
  }
}

/**
 * A health bar, shown only when it says something: the thing is damaged, or the
 * player has selected it. Permanent bars over a healthy army are pure clutter.
 */
function drawHealthBar(
  ctx: CanvasRenderingContext2D,
  entity: Entity,
  camera: Camera,
  centerX: number,
  y: number,
  width: number,
  maxHp: number,
  selected: boolean,
): void {
  if (camera.tileSize < HEALTH_BAR_MIN_TILE_SIZE) return;

  const fraction = Math.max(0, Math.min(1, entity.hp / maxHp));
  if (fraction >= 1 && !selected) return;

  const height = Math.max(3, camera.tileSize * 0.12);
  const left = centerX - width / 2;

  ctx.fillStyle = "rgba(0,0,0,0.6)";
  ctx.fillRect(left, y, width, height);

  // Green through amber to red: the colour alone tells you how bad it is,
  // without having to read the length.
  ctx.fillStyle = fraction > 0.6 ? "#63c163" : fraction > 0.3 ? "#e0b34a" : "#d95c4a";
  ctx.fillRect(left, y, width * fraction, height);
}

/**
 * While a building is armed, tint every tile it could legally stand on.
 *
 * This is the affordance that makes the build-radius rule teachable. Without
 * it, a player taps somewhere reasonable, is refused, and has to infer an
 * invisible rule from failures; with it, the rule is simply visible before the
 * first tap.
 *
 * Cost is deliberately not part of the tint — that is what the greyed-out
 * button says. Mixing the two would make "you cannot afford this" look like
 * "you cannot build here".
 */
export function drawBuildOverlay(
  ctx: CanvasRenderingContext2D,
  world: World,
  camera: Camera,
  playerId: number,
  typeId: BuildingTypeId,
): void {
  const bounds = visibleTileBounds(camera);

  // Amber, not green. The map is mostly grass and forest, and a green "you may
  // build here" tint over green ground is invisible — which makes the whole
  // affordance worthless. Amber is the HUD's accent and reads against every
  // terrain in the palette.
  const legal = (tileX: number, tileY: number): boolean => {
    const check = canPlace(world, playerId, typeId, tileX, tileY);
    return check.ok || check.error === PlacementError.TooExpensive;
  };

  ctx.save();
  ctx.fillStyle = "rgba(255, 214, 102, 0.22)";

  const valid: boolean[][] = [];
  for (let tileY = bounds.minY; tileY <= bounds.maxY; tileY++) {
    const row: boolean[] = [];
    for (let tileX = bounds.minX; tileX <= bounds.maxX; tileX++) {
      const ok = legal(tileX, tileY);
      row.push(ok);
      if (!ok) continue;

      const topLeft = worldToScreen(camera, tileX, tileY);
      ctx.fillRect(topLeft.x, topLeft.y, camera.tileSize + 1, camera.tileSize + 1);
    }
    valid.push(row);
  }

  // Outline the edge of the buildable area. A filled region alone still blends
  // on busy terrain; a hard border makes the boundary unmistakable.
  ctx.strokeStyle = "rgba(255, 214, 102, 0.95)";
  ctx.lineWidth = 2;
  ctx.beginPath();

  for (let row = 0; row < valid.length; row++) {
    for (let column = 0; column < valid[row]!.length; column++) {
      if (!valid[row]![column]) continue;

      const topLeft = worldToScreen(camera, bounds.minX + column, bounds.minY + row);
      const size = camera.tileSize;

      // Tiles outside the visible slice count as invalid, so the border also
      // traces the screen edge — which is honest: we do not know what is there.
      const up = row > 0 && valid[row - 1]![column];
      const down = row + 1 < valid.length && valid[row + 1]![column];
      const left = column > 0 && valid[row]![column - 1];
      const right = column + 1 < valid[row]!.length && valid[row]![column + 1];

      if (!up) {
        ctx.moveTo(topLeft.x, topLeft.y);
        ctx.lineTo(topLeft.x + size, topLeft.y);
      }
      if (!down) {
        ctx.moveTo(topLeft.x, topLeft.y + size);
        ctx.lineTo(topLeft.x + size, topLeft.y + size);
      }
      if (!left) {
        ctx.moveTo(topLeft.x, topLeft.y);
        ctx.lineTo(topLeft.x, topLeft.y + size);
      }
      if (!right) {
        ctx.moveTo(topLeft.x + size, topLeft.y);
        ctx.lineTo(topLeft.x + size, topLeft.y + size);
      }
    }
  }

  ctx.stroke();
  ctx.restore();

  drawPowerRings(ctx, world, camera, playerId);
}

/**
 * The edge of every one of the player's power circles, drawn only while the
 * build menu is open.
 *
 * Without it, power is a rule the player is told about and can never see. The
 * whole point of the rule is that *where* a building stands changes what it
 * does, and that decision is made at exactly this moment — with a footprint in
 * hand, looking for somewhere to put it. Shown only while placing, because a
 * permanent set of circles over the map would be clutter the other 95% of the
 * time.
 */
function drawPowerRings(
  ctx: CanvasRenderingContext2D,
  world: World,
  camera: Camera,
  playerId: number,
): void {
  ctx.save();
  ctx.strokeStyle = "rgba(120, 200, 255, 0.55)";
  ctx.lineWidth = 1.5;
  ctx.setLineDash([6, 5]);

  for (const entity of world.entities.list) {
    if (entity.owner !== playerId) continue;
    if (!isBuilding(entity) || !isComplete(entity)) continue;

    const radius = buildingDefOf(entity).powerRadius;
    if (radius <= 0) continue;

    const center = worldToScreen(camera, toTiles(entity.x), toTiles(entity.y));
    ctx.beginPath();
    ctx.arc(center.x, center.y, toTiles(radius) * camera.tileSize, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.restore();
}

/**
 * Draw a building's mark, centred on (x, y) at the given radius.
 *
 * Shared with the legend, exactly like `traceUnitShape`: one piece of code
 * decides what a smelter looks like, so the help sheet cannot drift away from
 * the map. A dark outline under a light fill keeps every glyph readable against
 * both the roof band and the walls, which are different shades of the same hue.
 */
export function drawBuildingGlyph(
  ctx: CanvasRenderingContext2D,
  glyph: string,
  x: number,
  y: number,
  radius: number,
  color: string,
): void {
  ctx.save();
  ctx.translate(x, y);

  traceBuildingGlyph(ctx, glyph, radius);

  ctx.strokeStyle = "rgba(0,0,0,0.8)";
  ctx.lineWidth = Math.max(1, radius * 0.34);
  ctx.lineJoin = "round";
  ctx.stroke();

  ctx.fillStyle = color;
  ctx.fill();

  ctx.restore();
}

/**
 * The outlines themselves, in a box of ±radius around the origin.
 *
 * Every one has to survive being a dozen pixels across on a phone, so they are
 * silhouettes rather than pictures: no letters, no interior detail, and no two
 * that could be confused at a glance.
 */
export function traceBuildingGlyph(ctx: CanvasRenderingContext2D, glyph: string, radius: number): void {
  const r = radius;
  ctx.beginPath();

  switch (glyph) {
    case BuildingGlyph.Banner: {
      // A pennant on a pole: the seat of things.
      ctx.moveTo(-r * 0.55, -r);
      ctx.lineTo(-r * 0.2, -r);
      ctx.lineTo(-r * 0.2, r);
      ctx.lineTo(-r * 0.55, r);
      ctx.closePath();
      ctx.moveTo(-r * 0.2, -r);
      ctx.lineTo(r, -r * 0.62);
      ctx.lineTo(-r * 0.2, -r * 0.24);
      ctx.closePath();
      break;
    }
    case BuildingGlyph.Crate: {
      // Two crates, stacked and offset. A single box with a strap across it was
      // the first attempt and came out as a plain filled square: an inner detail
      // drawn the same way round as its outline merges into the fill and simply
      // disappears. Only the outline carries a silhouette, so the silhouette has
      // to be the idea.
      ctx.rect(-r * 0.95, r * 0.1, r * 1.5, r * 0.8);
      ctx.rect(-r * 0.55, -r * 0.9, r * 1.5, r * 0.8);
      break;
    }
    case BuildingGlyph.Chevrons: {
      // Rank stripes: two arrowheads stacked.
      for (const offset of [-r * 0.45, r * 0.35]) {
        ctx.moveTo(-r * 0.9, offset + r * 0.4);
        ctx.lineTo(0, offset - r * 0.35);
        ctx.lineTo(r * 0.9, offset + r * 0.4);
        ctx.lineTo(r * 0.55, offset + r * 0.4);
        ctx.lineTo(0, offset + r * 0.05);
        ctx.lineTo(-r * 0.55, offset + r * 0.4);
        ctx.closePath();
      }
      break;
    }
    case BuildingGlyph.Merlons: {
      // Battlements: the top edge of a wall, notched.
      ctx.moveTo(-r, r * 0.7);
      ctx.lineTo(-r, -r * 0.5);
      ctx.lineTo(-r * 0.6, -r * 0.5);
      ctx.lineTo(-r * 0.6, -r);
      ctx.lineTo(-r * 0.2, -r);
      ctx.lineTo(-r * 0.2, -r * 0.5);
      ctx.lineTo(r * 0.2, -r * 0.5);
      ctx.lineTo(r * 0.2, -r);
      ctx.lineTo(r * 0.6, -r);
      ctx.lineTo(r * 0.6, -r * 0.5);
      ctx.lineTo(r, -r * 0.5);
      ctx.lineTo(r, r * 0.7);
      ctx.closePath();
      break;
    }
    case BuildingGlyph.Axe: {
      // An axe, after a saw blade came out as a starburst twice. A disc of
      // teeth needs an arbor hole to read as a blade, and a hole means a
      // reversed inner winding — more machinery than a glyph this size can
      // carry. The axe is a handle and a wedge: two shapes, no ambiguity.
      ctx.moveTo(r * 0.44, r * 0.98);
      ctx.lineTo(r * 0.16, r * 0.98);
      ctx.lineTo(-r * 0.12, -r * 0.5);
      ctx.lineTo(r * 0.16, -r * 0.5);
      ctx.closePath();

      ctx.moveTo(r * 0.18, -r * 0.4);
      ctx.lineTo(r * 0.18, -r * 0.98);
      ctx.quadraticCurveTo(-r * 0.55, -r * 0.95, -r * 0.92, -r * 0.45);
      ctx.quadraticCurveTo(-r * 0.45, -r * 0.24, r * 0.18, -r * 0.4);
      ctx.closePath();
      break;
    }
    case BuildingGlyph.Anvil: {
      // An anvil. Two attempts at a flame both came out as a drop of water —
      // on the building that melts ore, the one thing it must not say. A curved
      // teardrop stays a teardrop however much it is kinked, because a thick
      // outline rounds the kink away. The anvil's horn and waist survive being
      // outlined at any size.
      ctx.moveTo(-r * 0.95, -r * 0.7);
      ctx.lineTo(r * 0.55, -r * 0.7);
      ctx.lineTo(r * 0.98, -r * 0.35);
      ctx.lineTo(r * 0.5, -r * 0.28);
      ctx.lineTo(-r * 0.35, -r * 0.28);
      ctx.lineTo(-r * 0.2, r * 0.35);
      ctx.lineTo(-r * 0.7, r * 0.95);
      ctx.lineTo(r * 0.7, r * 0.95);
      ctx.lineTo(r * 0.2, r * 0.35);
      ctx.lineTo(-r * 0.05, -r * 0.28);
      ctx.lineTo(-r * 0.95, -r * 0.28);
      ctx.closePath();
      break;
    }
    case BuildingGlyph.Grain: {
      // Three ears standing in a row. A single shoot with two leaves read as a
      // propeller; three of anything reads as a crop.
      const ears: ReadonlyArray<readonly [number, number]> = [
        [-r * 0.62, -r * 0.45],
        [0, -r * 0.95],
        [r * 0.62, -r * 0.45],
      ];
      for (const [offset, top] of ears) {
        // A thin stalk under a fat pointed head. Small round heads came out as
        // pins stuck in a board; an ear of grain has to be wider than its stalk
        // by enough to see.
        ctx.moveTo(offset - r * 0.09, r * 0.95);
        ctx.lineTo(offset + r * 0.09, r * 0.95);
        ctx.lineTo(offset + r * 0.09, top + r * 0.62);
        ctx.closePath();

        ctx.moveTo(offset, top - r * 0.18);
        ctx.quadraticCurveTo(offset + r * 0.34, top + r * 0.1, offset + r * 0.2, top + r * 0.66);
        ctx.quadraticCurveTo(offset, top + r * 0.82, offset - r * 0.2, top + r * 0.66);
        ctx.quadraticCurveTo(offset - r * 0.34, top + r * 0.1, offset, top - r * 0.18);
        ctx.closePath();
      }
      break;
    }
    case BuildingGlyph.Bolt:
    default: {
      // A lightning bolt. The one glyph nobody has to be taught.
      ctx.moveTo(r * 0.35, -r);
      ctx.lineTo(-r * 0.6, r * 0.15);
      ctx.lineTo(-r * 0.05, r * 0.15);
      ctx.lineTo(-r * 0.35, r);
      ctx.lineTo(r * 0.6, -r * 0.2);
      ctx.lineTo(r * 0.05, -r * 0.2);
      ctx.closePath();
      break;
    }
  }
}

/** A faint line from each selected unit to where it was told to go. */
export function drawOrders(
  ctx: CanvasRenderingContext2D,
  world: World,
  camera: Camera,
  selection: Selection,
): void {
  if (selection.ids.size === 0) return;

  ctx.save();
  ctx.strokeStyle = "rgba(255,255,255,0.28)";
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 5]);
  ctx.beginPath();

  for (const entity of world.entities.list) {
    if (!selection.ids.has(entity.id)) continue;
    if (entity.goalX === null || entity.goalY === null) continue;

    const from = worldToScreen(camera, toTiles(entity.x), toTiles(entity.y));
    const to = worldToScreen(camera, toTiles(entity.goalX), toTiles(entity.goalY));
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
  }

  ctx.stroke();
  ctx.restore();
}

/** The rubber-band rectangle while the player is dragging a selection box. */
export function drawSelectionBox(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  box: WorldBox | null,
): void {
  if (!box) return;

  const start = worldToScreen(camera, Math.min(box.x0, box.x1), Math.min(box.y0, box.y1));
  const end = worldToScreen(camera, Math.max(box.x0, box.x1), Math.max(box.y0, box.y1));

  ctx.save();
  ctx.fillStyle = "rgba(255, 214, 102, 0.12)";
  ctx.fillRect(start.x, start.y, end.x - start.x, end.y - start.y);
  ctx.strokeStyle = "rgba(255, 214, 102, 0.9)";
  ctx.lineWidth = 1.5;
  ctx.strokeRect(start.x, start.y, end.x - start.x, end.y - start.y);
  ctx.restore();
}

/** Drop remembered facings for units that no longer exist. */
export function pruneRenderState(world: World): void {
  if (facings.size < 256) return;

  const alive = new Set(world.entities.list.map((entity) => entity.id));
  for (const id of facings.keys()) {
    if (!alive.has(id)) facings.delete(id);
  }
}
