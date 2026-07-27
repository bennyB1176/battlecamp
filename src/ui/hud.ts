/**
 * HUD wiring: turns the buttons declared in `index.html` into callbacks and
 * exposes a small handle for pushing text back out.
 *
 * Deliberately plain DOM. The HUD will grow a lot (build menu, selection panel,
 * minimap), but reaching for a UI framework before we know the shape of those
 * panels would be guessing.
 */

export interface HudCallbacks {
  onTogglePause: () => void;
  onSetSpeed: (speed: number) => void;
  onCenter: () => void;
  onToggleSelectMode: () => void;
}

export interface Hud {
  setClock: (text: string) => void;
  setStats: (text: string) => void;
  setPaused: (paused: boolean) => void;
  setSpeed: (speed: number) => void;
  setSelectMode: (active: boolean) => void;
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
  const speedButtons = [...document.querySelectorAll<HTMLButtonElement>(".ctrl.speed")];

  pauseButton.addEventListener("click", callbacks.onTogglePause);
  centerButton.addEventListener("click", callbacks.onCenter);
  selectButton.addEventListener("click", callbacks.onToggleSelectMode);

  for (const button of speedButtons) {
    button.addEventListener("click", () => {
      callbacks.onSetSpeed(Number(button.dataset.speed ?? "1"));
    });
  }

  // Space bar is the pause key everyone already expects on desktop.
  window.addEventListener("keydown", (event) => {
    if (event.code === "Space") {
      event.preventDefault();
      callbacks.onTogglePause();
    }
  });

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
      for (const button of speedButtons) {
        button.classList.toggle("active", Number(button.dataset.speed ?? "1") === speed);
      }
    },
    setSelectMode: (active) => {
      selectButton.classList.toggle("active", active);
    },
  };
}
