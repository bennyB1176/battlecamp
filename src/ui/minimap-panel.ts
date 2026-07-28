/**
 * Putting the minimap into the page: mounting it, tap-to-jump, collapsing it.
 *
 * Its own module rather than a handful of lines in `main.ts`, for the reason
 * written into CLAUDE.md the hard way — code in the entry point is code no test
 * ever looks at, and the bot spent a whole milestone written, tuned and never
 * called. The geometry it relies on is tested in `tests/minimap.test.ts`; what
 * is left here is DOM, and that gets checked in a browser.
 */

import type { Camera } from "../input/camera.js";
import { centerOn } from "../input/camera.js";
import { createMinimap, type Minimap } from "../render/minimap.js";
import type { PlayerId } from "../sim/entities.js";
import type { World } from "../sim/world.js";

/**
 * Edge length in CSS pixels.
 *
 * Derived from the *smaller* screen dimension so it comes out the same in
 * portrait and landscape — a minimap that resizes when the phone turns would
 * need the canvas rebuilt on every rotation for no benefit. Bounded at both
 * ends: below about 96 px the dots merge, above 132 px it starts eating the
 * corner of a small screen.
 */
function panelSize(): number {
  const shortEdge = Math.min(window.innerWidth, window.innerHeight);
  return Math.round(Math.min(132, Math.max(96, shortEdge * 0.32)));
}

export interface MinimapPanel {
  draw: (world: World, camera: Camera, localPlayer: PlayerId) => void;
  isOpen: () => boolean;
}

export function attachMinimap(world: World, camera: Camera): MinimapPanel {
  const panel = document.getElementById("minimap-panel");
  const slot = document.getElementById("minimap-slot");
  const toggle = document.getElementById("minimap-toggle");
  const caret = document.getElementById("minimap-caret");

  // Missing markup should not take the game down with it: the minimap is an
  // aid, and a match without one is still a match.
  if (!panel || !slot || !toggle || !caret) {
    return { draw: () => {}, isOpen: () => false };
  }

  const size = panelSize();
  const minimap: Minimap = createMinimap(world, size);
  slot.append(minimap.canvas);

  let open = true;

  const setOpen = (next: boolean): void => {
    open = next;
    panel.classList.toggle("collapsed", !open);
    caret.textContent = open ? "▾" : "▴";
    toggle.setAttribute("aria-expanded", String(open));
    toggle.setAttribute("aria-label", open ? "Übersichtskarte ausblenden" : "Übersichtskarte einblenden");
  };

  toggle.addEventListener("click", () => setOpen(!open));

  // Pointerdown rather than click: on a touchscreen the jump should happen the
  // moment the finger lands, the same as a tap on the map itself. Waiting for
  // the release makes the overview feel a beat behind everything else.
  minimap.canvas.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    const box = minimap.canvas.getBoundingClientRect();
    const tile = minimap.tileAt(event.clientX - box.left, event.clientY - box.top);
    centerOn(camera, tile.tileX, tile.tileY);
  });

  return {
    draw: (w, cam, localPlayer) => {
      if (!open) return;
      minimap.draw(w, cam, localPlayer);
    },
    isOpen: () => open,
  };
}
