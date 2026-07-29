/**
 * The skirmish setup screen.
 *
 * Until now the seed was a constant in `main.ts`: every match ever played was
 * the same map against the same opponent, and "new game" meant reloading into
 * that identical map. The whole point of a seeded generator is that it can hand
 * out a different world every time, and none of it reached the player.
 *
 * Choices are applied by putting them in the URL and reloading. That is
 * deliberately blunt: tearing a running match down — listeners, caches,
 * canvases, bots — and rebuilding it is where restart bugs live, and a reload
 * costs a fraction of a second from cache. It also makes a match **shareable**,
 * which is the deterministic core finally showing up as a feature rather than
 * as a test fixture.
 */

import { DIFFICULTY_NAMES, Difficulty, type DifficultyId } from "../ai/bot.js";
import { BIOME_LIST, biomeDef, type BiomeId } from "../content/biomes.js";
import {
  MAP_SIZES,
  OPPONENT_COUNTS,
  randomSeed,
  settingsToQuery,
  type MatchSettings,
} from "./match-settings.js";

const DIFFICULTIES: readonly DifficultyId[] = [Difficulty.Easy, Difficulty.Normal, Difficulty.Hard];

const DIFFICULTY_NOTES: Readonly<Record<DifficultyId, string>> = {
  [Difficulty.Easy]: "Spät dran, kleine Wirtschaft, lernt nie dazu",
  [Difficulty.Normal]: "Verteidigt seine Basis, baut Türme",
  [Difficulty.Hard]: "Reagiert sofort, kontert dich — und sieht durch den Nebel",
};

const OPPONENT_NOTES: Readonly<Record<number, string>> = {
  1: "Ein Duell",
  2: "Jeder gegen jeden — wer zuerst angreift, ist danach der Schwächste",
  3: "Jeder gegen jeden, vier Basen auf einer Karte",
};

const SIZE_NOTES: Readonly<Record<number, string>> = {
  48: "Kurz — man findet sich sofort",
  64: "Ausgewogen",
  80: "Lang — Aufklärung und Expansionen zahlen sich aus",
};

function group(title: string): HTMLElement {
  const heading = document.createElement("h2");
  heading.textContent = title;
  return heading;
}

/** One row of mutually exclusive choices. */
function choices<T>(
  values: readonly T[],
  label: (value: T) => string,
  note: (value: T) => string,
  selected: T,
  onPick: (value: T) => void,
): HTMLElement {
  const row = document.createElement("div");
  row.className = "setup-choices";

  const buttons = values.map((value) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "setup-choice";
    button.classList.toggle("chosen", value === selected);

    const name = document.createElement("strong");
    name.textContent = label(value);
    const hint = document.createElement("span");
    hint.textContent = note(value);
    button.append(name, hint);

    button.addEventListener("click", () => {
      for (const other of buttons) other.classList.remove("chosen");
      button.classList.add("chosen");
      onPick(value);
    });

    row.append(button);
    return button;
  });

  return row;
}

/**
 * Show the setup screen and resolve once the player starts a match.
 *
 * Resolves rather than reloading here, so the caller decides what "start"
 * means — which is what lets the same screen serve both the opening menu and
 * the "another one" button on the result screen.
 */
export interface SetupChoice {
  readonly kind: "new";
  readonly settings: MatchSettings;
}

export interface ResumeChoice {
  readonly kind: "resume";
}

/**
 * Show the setup screen and resolve once the player has decided.
 *
 * `onResume` is offered only when there is actually something to go back to.
 * A permanently visible "continue" that sometimes does nothing is worse than
 * none: the player learns to distrust it.
 */
export function showSetupScreen(
  initial: MatchSettings,
  resume?: { readonly clockText: string },
): Promise<SetupChoice | ResumeChoice> {
  return new Promise((resolve) => {
    let chosen: MatchSettings = { ...initial };

    const overlay = document.createElement("div");
    overlay.id = "setup";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-label", "Neues Spiel");

    const panel = document.createElement("div");
    panel.className = "setup-panel";

    const title = document.createElement("h1");
    title.textContent = "Battlecamp";
    const blurb = document.createElement("p");
    blurb.className = "setup-blurb";
    blurb.textContent =
      "Basis aufbauen, Rohstoffe abbauen, Armee aufstellen, Gegner ausschalten. Alles unter Nebel — du siehst nur, wohin du schaust.";

    panel.append(title, blurb);

    if (resume) {
      const button = document.createElement("button");
      button.type = "button";
      button.id = "setup-resume";
      const label = document.createElement("strong");
      label.textContent = "Weiterspielen";
      const detail = document.createElement("span");
      detail.textContent = `Gespeichertes Spiel bei ${resume.clockText}`;
      button.append(label, detail);
      button.addEventListener("click", () => {
        overlay.remove();
        resolve({ kind: "resume" });
      });
      panel.append(button);
    }

    panel.append(group("Gegner"));
    panel.append(
      choices(
        DIFFICULTIES,
        (value) => DIFFICULTY_NAMES[value],
        (value) => DIFFICULTY_NOTES[value],
        chosen.difficulty,
        (value) => {
          chosen = { ...chosen, difficulty: value };
        },
      ),
    );

    panel.append(group("Anzahl Gegner"));
    panel.append(
      choices(
        OPPONENT_COUNTS,
        (value) => (value === 1 ? "Ein Gegner" : `${value} Gegner`),
        (value) => OPPONENT_NOTES[value] ?? "",
        chosen.opponents,
        (value) => {
          chosen = { ...chosen, opponents: value };
        },
      ),
    );

    panel.append(group("Gelände"));
    panel.append(
      choices<BiomeId>(
        BIOME_LIST,
        (value) => biomeDef(value).name,
        (value) => biomeDef(value).blurb,
        chosen.biome,
        (value) => {
          chosen = { ...chosen, biome: value };
        },
      ),
    );

    panel.append(group("Kartengröße"));
    panel.append(
      choices(
        MAP_SIZES,
        (value) => value.name,
        (value) => SIZE_NOTES[value.tiles] ?? `${value.tiles} Kacheln`,
        MAP_SIZES.find((size) => size.tiles === chosen.size) ?? MAP_SIZES[1]!,
        (value) => {
          chosen = { ...chosen, size: value.tiles };
        },
      ),
    );

    panel.append(group("Kartennummer"));

    const seedRow = document.createElement("div");
    seedRow.className = "setup-seed";

    const seedInput = document.createElement("input");
    seedInput.id = "setup-seed";
    seedInput.type = "text";
    seedInput.inputMode = "numeric";
    seedInput.value = String(chosen.seed);
    seedInput.setAttribute("aria-label", "Kartennummer");

    const reroll = document.createElement("button");
    reroll.type = "button";
    reroll.className = "setup-reroll";
    reroll.textContent = "Würfeln";

    seedRow.append(seedInput, reroll);
    panel.append(seedRow);

    const seedNote = document.createElement("p");
    seedNote.className = "setup-note";
    seedNote.textContent =
      "Dieselbe Nummer ergibt dieselbe Karte — gib sie weiter, und jemand anders spielt genau dein Spiel.";
    panel.append(seedNote);

    // Typed nonsense is not worth a scolding message: the parser has to survive
    // it anyway, and silently keeping the last good value is what a player
    // actually wants when they fat-finger a digit.
    const readSeed = (): number => {
      const text = seedInput.value.trim();
      return /^\d+$/.test(text) && Number(text) > 0 ? Number(text) : chosen.seed;
    };

    seedInput.addEventListener("change", () => {
      chosen = { ...chosen, seed: readSeed() };
      seedInput.value = String(chosen.seed);
    });

    reroll.addEventListener("click", () => {
      chosen = { ...chosen, seed: randomSeed() };
      seedInput.value = String(chosen.seed);
    });

    const start = document.createElement("button");
    start.type = "button";
    start.id = "setup-start";
    start.textContent = resume ? "Neues Spiel starten" : "Spiel starten";
    panel.append(start);

    start.addEventListener("click", () => {
      const settings: MatchSettings = { ...chosen, seed: readSeed() };
      overlay.remove();
      resolve({ kind: "new", settings });
    });

    overlay.append(panel);
    document.body.append(overlay);
    // Not focused: on a phone, focusing a text field opens the keyboard over
    // half the screen before the player has even read the options.
  });
}

/** Reload into a match with these settings. */
export function applySettings(settings: MatchSettings): void {
  window.location.search = settingsToQuery(settings);
}
