/**
 * The end-of-match screen.
 *
 * Until this existed the match ended in a single line of text in the context
 * panel, next to the buttons — which on a phone reads as "nothing happened".
 * A match that is over has to *look* over: the map stops mattering, and the
 * screen should say so plainly and then get out of the way.
 *
 * Dismissible on purpose. A player who wants to look at the final state of the
 * map should be able to, and an overlay that cannot be closed is a game that
 * appears to have hung. Reopening it is one tap on the same button.
 */

import type { PlayerId } from "../sim/entities.js";
import type { World } from "../sim/world.js";
import { matchResult, type MatchResult, type SideResult } from "./result-data.js";

export interface ResultScreen {
  /**
   * Called every frame with the current world. Shows itself once, when the
   * match ends, and does nothing on every other call.
   */
  update: (world: World) => void;
  /** Bring it back after the player dismissed it. Null while nothing to show. */
  reopen: () => void;
  isOpen: () => boolean;
  /** True once the match has ended, whether or not the screen is on show. */
  hasResult: () => boolean;
}

function row(label: string, value: string): HTMLElement {
  const line = document.createElement("div");
  line.className = "result-row";

  const name = document.createElement("span");
  name.textContent = label;
  const amount = document.createElement("span");
  amount.className = "result-value";
  amount.textContent = value;

  line.append(name, amount);
  return line;
}

function column(side: SideResult): HTMLElement {
  const box = document.createElement("div");
  box.className = "result-side";
  if (side.isWinner) box.classList.add("winner");

  const head = document.createElement("div");
  head.className = "result-side-head";

  // The same colour the side's units carry on the map, so the two columns are
  // told apart the way everything else in the game is told apart.
  const swatch = document.createElement("span");
  swatch.className = "result-swatch";
  swatch.style.background = side.colors.body;

  const name = document.createElement("strong");
  name.textContent = side.name;
  head.append(swatch, name);
  box.appendChild(head);

  box.appendChild(row("Abgebaut", String(side.gathered)));
  for (const haul of side.haul) {
    const line = row(`· ${haul.name}`, String(haul.amount));
    line.classList.add("result-sub");
    box.appendChild(line);
  }
  box.appendChild(row("Einheiten gebaut", String(side.unitsTrained)));
  box.appendChild(row("Gebäude gebaut", String(side.buildingsBuilt)));
  box.appendChild(row("Einheiten verloren", String(side.unitsLost)));
  box.appendChild(row("Gebäude verloren", String(side.buildingsLost)));

  return box;
}

function content(result: MatchResult): HTMLElement {
  const wrap = document.createElement("div");

  const headline = document.createElement("h1");
  headline.className = "result-headline";
  headline.classList.add(`outcome-${result.outcome}`);
  headline.textContent = result.headline;
  wrap.appendChild(headline);

  const detail = document.createElement("p");
  detail.className = "result-detail";
  detail.textContent = `${result.detail} Spieldauer ${result.duration}.`;
  wrap.appendChild(detail);

  const sides = document.createElement("div");
  sides.className = "result-sides";
  for (const side of result.sides) sides.appendChild(column(side));
  wrap.appendChild(sides);

  const hint = document.createElement("p");
  hint.className = "result-hint";
  hint.textContent = "Neu laden startet ein neues Spiel.";
  wrap.appendChild(hint);

  return wrap;
}

export function createResultScreen(localPlayer: PlayerId): ResultScreen {
  const overlay = document.createElement("div");
  overlay.id = "result";
  overlay.hidden = true;
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-label", "Ergebnis");

  const panel = document.createElement("div");
  panel.className = "result-panel";

  const bar = document.createElement("div");
  bar.className = "legend-bar";
  const title = document.createElement("strong");
  title.textContent = "Ergebnis";
  const close = document.createElement("button");
  close.className = "ctrl";
  close.type = "button";
  close.textContent = "✕";
  close.setAttribute("aria-label", "Schließen");
  bar.append(title, close);

  const body = document.createElement("div");
  body.className = "result-body";

  panel.append(bar, body);
  overlay.appendChild(panel);
  document.body.appendChild(overlay);

  /** Remembered so the screen is built once, not on every frame after the end. */
  let shown = false;
  let result: MatchResult | null = null;

  const setOpen = (open: boolean): void => {
    overlay.hidden = !open;
    if (open && result) {
      body.replaceChildren(content(result));
      body.scrollTop = 0;
    } else if (!open) {
      body.replaceChildren();
    }
  };

  close.addEventListener("click", () => setOpen(false));
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) setOpen(false);
  });
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !overlay.hidden) setOpen(false);
  });

  return {
    update: (world) => {
      if (shown) return;
      const decided = matchResult(world, localPlayer);
      if (!decided) return;

      // Frozen at the moment the match ended. The tick keeps running afterwards
      // so the clock reads sensibly, but the numbers on this screen are the
      // numbers the match finished with.
      result = decided;
      shown = true;
      setOpen(true);
    },
    reopen: () => {
      if (result) setOpen(true);
    },
    isOpen: () => !overlay.hidden,
    hasResult: () => result !== null,
  };
}
