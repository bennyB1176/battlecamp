/**
 * HUD wiring: turns the markup in `index.html` into callbacks, and exposes a
 * small handle for pushing state back out.
 *
 * The context panel is rebuilt from a description of what the selection can do,
 * rather than the HUD reaching into the world to work it out for itself. That
 * keeps the "what is possible" question in one place — `main.ts` — instead of
 * splitting it between the rules and the buttons that trigger them.
 *
 * Deliberately plain DOM. The panel will grow a lot over the next milestones,
 * and reaching for a framework before its shape is known would be guessing.
 */

export interface HudCallbacks {
  onTogglePause: () => void;
  /** The player tapped the time control; step to the next speed. */
  onCycleSpeed: () => void;
  onCenter: () => void;
  onToggleSelectMode: () => void;
  onToggleBuildMenu: () => void;
  onToggleAttackMove: () => void;
  onToggleLegend: () => void;
}

/** One button in the context panel. */
import { SPEEDS, speedGlyph, speedLabel } from "./speed.js";
import {
  RESOURCE_COLORS,
  RESOURCE_KINDS,
  RESOURCE_NAMES,
  type ResourceKind,
} from "../sim/resources.js";

export interface HudAction {
  readonly id: string;
  readonly label: string;
  /** Second line, typically a price. */
  readonly detail?: string;
  readonly disabled?: boolean;
  /** Shown as active — a build type awaiting placement, for instance. */
  readonly armed?: boolean;
  readonly onSelect: () => void;
}

export interface Hud {
  setClock: (text: string) => void;
  setStats: (text: string) => void;
  setPaused: (paused: boolean) => void;
  setSpeed: (speed: number) => void;
  setSelectMode: (active: boolean) => void;
  setBuildMode: (active: boolean) => void;
  setAttackMode: (active: boolean) => void;
  /** Amounts by resource kind, in the order the resource table lists them. */
  setResources: (amounts: Readonly<Record<ResourceKind, number>>) => void;
  /** Mouths to feed against the ceiling that feeds them. */
  setFood: (demand: number, supply: number) => void;
  /**
   * Replace the context panel. It hides when there is nothing to say.
   *
   * `onDismiss` is what the panel's × does — clearing the selection, or closing
   * the build menu. Omitting it hides the ×, so the button never appears
   * offering to dismiss something that cannot be dismissed.
   */
  setContext: (title: string, actions: readonly HudAction[], onDismiss?: () => void) => void;
}

function requireElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`HUD element #${id} is missing from index.html`);
  return element as T;
}

export function createHud(callbacks: HudCallbacks): Hud {
  const clock = requireElement<HTMLDivElement>("clock");
  const stats = requireElement<HTMLDivElement>("stats");
  const pauseButton = requireElement<HTMLButtonElement>("btn-pause");
  const centerButton = requireElement<HTMLButtonElement>("btn-center");
  const selectButton = requireElement<HTMLButtonElement>("btn-select");
  const buildButton = requireElement<HTMLButtonElement>("btn-build");
  const attackButton = requireElement<HTMLButtonElement>("btn-attack");
  const legendButton = requireElement<HTMLButtonElement>("btn-legend");
  const speedButton = requireElement<HTMLButtonElement>("btn-speed");

  // Built from the table rather than from markup: a new resource is one edit in
  // src/sim/resources.ts, and the bar, its swatch and the legend all follow.
  const resourceBar = requireElement<HTMLDivElement>("resources");
  const amounts = new Map<ResourceKind, HTMLSpanElement>();
  for (const kind of RESOURCE_KINDS) {
    const span = document.createElement("span");
    span.className = "res";
    span.style.setProperty("--swatch", RESOURCE_COLORS[kind]);
    span.title = RESOURCE_NAMES[kind];
    span.textContent = "0";
    resourceBar.append(span);
    amounts.set(kind, span);
  }

  // Food is not a stock, so it does not belong among the amounts: it is a
  // ratio, and the only number on this bar that can be *bad*. It sits at the
  // end with its own marker and turns red the moment demand passes supply —
  // an army quietly losing health with no explanation on screen is the kind of
  // thing that makes a game feel broken rather than hard.
  const food = document.createElement("span");
  food.className = "res food";
  food.style.setProperty("--swatch", "#e6b45c");
  food.title = "Nahrung: Bedarf / Versorgung";
  resourceBar.append(food);

  const context = requireElement<HTMLDivElement>("hud-context");
  const contextTitle = requireElement<HTMLDivElement>("context-title");
  const contextDismiss = requireElement<HTMLButtonElement>("context-dismiss");
  const infoToggle = requireElement<HTMLButtonElement>("btn-info");
  let dismiss: (() => void) | undefined;
  contextDismiss.addEventListener("click", () => dismiss?.());

  infoToggle.addEventListener("click", () => {
    stats.hidden = !stats.hidden;
    infoToggle.classList.toggle("active", !stats.hidden);
    infoToggle.setAttribute("aria-label", stats.hidden ? "Status einblenden" : "Status ausblenden");
  });
  const contextActions = requireElement<HTMLDivElement>("context-actions");

  pauseButton.addEventListener("click", callbacks.onTogglePause);
  centerButton.addEventListener("click", callbacks.onCenter);
  selectButton.addEventListener("click", callbacks.onToggleSelectMode);
  buildButton.addEventListener("click", callbacks.onToggleBuildMenu);
  attackButton.addEventListener("click", callbacks.onToggleAttackMove);
  legendButton.addEventListener("click", callbacks.onToggleLegend);

  speedButton.addEventListener("click", callbacks.onCycleSpeed);

  window.addEventListener("keydown", (event) => {
    if (event.code === "Space") {
      event.preventDefault();
      callbacks.onTogglePause();
      return;
    }
    // Escape is what a desktop player reaches for to back out of a mode, and it
    // does exactly what the panel's × does — one idea, not two.
    if (event.code === "Escape") {
      event.preventDefault();
      dismiss?.();
    }
  });

  /** Remembered so the panel is only rebuilt when it actually changed. */
  let renderedSignature = "";

  return {
    setClock: (text) => {
      clock.textContent = text;
    },
    setStats: (text) => {
      stats.textContent = text;
    },
    setPaused: (paused) => {
      pauseButton.classList.toggle("paused", paused);
      pauseButton.textContent = paused ? "▶" : "⏸";
      pauseButton.setAttribute("aria-label", paused ? "Fortsetzen" : "Pause");
    },
    setSpeed: (speed) => {
      speedButton.textContent = speedGlyph(speed);
      speedButton.setAttribute("aria-label", speedLabel(speed));
      speedButton.title = speedLabel(speed);
      // Lit only when time is running faster than normal, so the row is not
      // permanently highlighted for the default state.
      speedButton.classList.toggle("active", speed !== SPEEDS[0]);
    },
    setSelectMode: (active) => {
      selectButton.classList.toggle("active", active);
    },
    setBuildMode: (active) => {
      buildButton.classList.toggle("active", active);
    },
    setAttackMode: (active) => {
      attackButton.classList.toggle("active", active);
    },
    setResources: (stock) => {
      for (const [kind, span] of amounts) {
        const text = String(stock[kind] ?? 0);
        // Touching textContent on every frame would make the phone re-layout the
        // whole bar sixty times a second for numbers that change once a second.
        if (span.textContent !== text) span.textContent = text;
      }
    },
    setFood: (demand, supply) => {
      const text = `${demand}/${supply}`;
      if (food.textContent !== text) food.textContent = text;
      food.classList.toggle("short", demand > supply);
    },
    setContext: (title, actions, onDismiss) => {
      // Kept out of the signature: it changes identity every frame, and it
      // changes nothing the player can see.
      dismiss = onDismiss;
      contextDismiss.hidden = onDismiss === undefined;

      // Rebuilding the panel on every frame would kill any button mid-tap on a
      // touchscreen, so it is only redrawn when its content actually differs.
      const signature = `${title}|${onDismiss ? 1 : 0}|${actions
        .map((action) => `${action.id}:${action.label}:${action.detail ?? ""}:${action.disabled ? 1 : 0}:${action.armed ? 1 : 0}`)
        .join(",")}`;
      if (signature === renderedSignature) return;
      renderedSignature = signature;

      // A selected soldier has a name and no actions, and it still needs the
      // panel — that is where the way out lives.
      if (actions.length === 0 && title === "") {
        context.hidden = true;
        contextActions.replaceChildren();
        return;
      }

      context.hidden = false;
      contextTitle.textContent = title;

      contextActions.replaceChildren(
        ...actions.map((action) => {
          const button = document.createElement("button");
          button.className = "action";
          button.type = "button";
          if (action.armed) button.classList.add("armed");
          button.disabled = action.disabled ?? false;

          const label = document.createElement("span");
          label.textContent = action.label;
          button.appendChild(label);

          if (action.detail) {
            const detail = document.createElement("span");
            detail.className = "cost";
            detail.textContent = action.detail;
            button.appendChild(detail);
          }

          button.addEventListener("click", action.onSelect);
          return button;
        }),
      );
    },
  };
}
