/**
 * The in-game legend: what everything is, and how to play.
 *
 * Deliberately inside the game rather than on a wiki page, for two reasons.
 * On a phone, leaving the app to look something up is a real cost. And more
 * importantly: this page draws its icons with the renderer's own shape code and
 * takes every number from the content tables, so it *cannot* fall out of step
 * with the game. A wiki page with screenshots is wrong the moment a colour
 * changes — and worse than no page, because people believe it.
 *
 * Built on demand and thrown away on close: it is a rare, static view, so
 * holding it in memory would be paying for something almost never looked at.
 */

import { playerColors } from "../content/players.js";
import { drawBuildingGlyph, traceUnitShape } from "../render/entities.js";
import { UnitType } from "../content/units.js";
import { buildingEntries, counterTriangle, resourceEntries, unitEntries } from "./legend-data.js";

const GESTURES: ReadonlyArray<readonly [string, string]> = [
  ["Ein Finger ziehen", "Karte verschieben"],
  ["Zwei Finger", "Zoomen"],
  ["Eigene Einheit antippen", "Auswählen"],
  ["⬚ dann ziehen", "Mehrere auswählen"],
  ["Rohstoff antippen (mit Arbeitern)", "Abbauen lassen"],
  ["Eigene Baustelle antippen", "Beim Bau helfen"],
  ["Hauptquartier / Kaserne antippen", "Einheiten ausbilden"],
  ["🔨 dann Gebäude, dann Karte", "Bauen — erlaubte Fläche ist markiert"],
  ["Gegner antippen (mit Kämpfern)", "Angreifen"],
  ["⚔ dann Karte antippen", "Vorrücken und unterwegs kämpfen"],
  ["Gelände antippen (mit Auswahl)", "Hingehen"],
  ["⏸ oder Leertaste", "Pause — Befehle gehen auch pausiert"],
  ["▶︎ antippen", "Tempo: 1× → 2× → 4× → wieder 1×"],
];

/** Draw a unit silhouette into a small canvas, exactly as the game draws it. */
function unitIcon(shape: string, playerId: number): HTMLCanvasElement {
  const size = 34;
  const canvas = document.createElement("canvas");
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = size * dpr;
  canvas.height = size * dpr;
  canvas.style.width = `${size}px`;
  canvas.style.height = `${size}px`;

  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  ctx.scale(dpr, dpr);
  const colors = playerColors(playerId);
  const radius = size * 0.32;

  ctx.translate(size / 2, size / 2);
  ctx.fillStyle = colors.body;
  ctx.strokeStyle = colors.dark;
  ctx.lineWidth = Math.max(1, radius * 0.22);
  traceUnitShape(ctx, shape, radius);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = colors.light;
  ctx.beginPath();
  ctx.arc(radius * 0.42, 0, Math.max(1, radius * 0.22), 0, Math.PI * 2);
  ctx.fill();

  return canvas;
}

/** A small square in the player's colours, standing in for a building. */
/**
 * A building's icon, drawn with the renderer's own glyph code.
 *
 * The same rule the unit icons follow: one piece of code decides what a smelter
 * looks like. A hand-drawn copy here would be a second answer to that question,
 * and the two would part ways the first time a glyph was retuned.
 */
function buildingIcon(playerId: number, glyph: string): HTMLCanvasElement {
  const size = 34;
  const canvas = document.createElement("canvas");
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = size * dpr;
  canvas.height = size * dpr;
  canvas.style.width = `${size}px`;
  canvas.style.height = `${size}px`;

  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  ctx.scale(dpr, dpr);
  const colors = playerColors(playerId);
  const inset = size * 0.12;

  ctx.fillStyle = colors.body;
  ctx.fillRect(inset, inset, size - inset * 2, size - inset * 2);
  ctx.fillStyle = colors.dark;
  ctx.fillRect(inset, inset, size - inset * 2, (size - inset * 2) * 0.34);
  ctx.strokeStyle = "rgba(0,0,0,0.75)";
  ctx.lineWidth = 1.5;
  ctx.strokeRect(inset, inset, size - inset * 2, size - inset * 2);

  drawBuildingGlyph(ctx, glyph, size / 2, size * 0.58, size * 0.24, colors.light);
  return canvas;
}

function heading(text: string): HTMLElement {
  const element = document.createElement("h2");
  element.textContent = text;
  return element;
}

function paragraph(text: string): HTMLElement {
  const element = document.createElement("p");
  element.textContent = text;
  return element;
}

function definitionList(rows: ReadonlyArray<readonly [string, string]>): HTMLElement {
  const list = document.createElement("dl");
  for (const [term, description] of rows) {
    const dt = document.createElement("dt");
    dt.textContent = term;
    const dd = document.createElement("dd");
    dd.textContent = description;
    list.append(dt, dd);
  }
  return list;
}

function buildContent(): DocumentFragment {
  const fragment = document.createDocumentFragment();

  fragment.append(
    heading("Worum es geht"),
    paragraph(
      "Baue eine Basis auf, lass Rohstoffe abbauen, stelle eine Armee auf und schalte den Gegner aus. " +
        "Besiegt ist, wer keine Gebäude und keine Einheiten mehr hat — solange Arbeiter leben, kann man " +
        "neu aufbauen.",
    ),
    paragraph(
      "Es entscheidet die Zusammensetzung, nicht die Menge: jeder Einheitentyp hat einen Konter. " +
        "Deshalb lohnt es sich, erst zu sehen, was der Gegner baut.",
    ),
  );

  fragment.append(heading("Farbe und Form"));
  const colorNote = document.createElement("div");
  colorNote.className = "legend-colors";
  for (const [playerId, label] of [
    [0, "Du"],
    [1, "Gegner"],
  ] as const) {
    const chip = document.createElement("span");
    chip.className = "legend-chip";
    chip.appendChild(unitIcon("shield", playerId));
    const text = document.createElement("span");
    text.textContent = label;
    chip.appendChild(text);
    colorNote.appendChild(chip);
  }
  fragment.append(
    colorNote,
    paragraph(
      "Die Farbe sagt, wem etwas gehört. Die Form sagt, was es ist. Deshalb sind alle deine Einheiten " +
        "gleich eingefärbt und unterscheiden sich nur in der Silhouette.",
    ),
  );

  fragment.append(heading("Rohstoffe"));
  const resources = document.createElement("div");
  resources.className = "legend-resources";
  for (const swatch of resourceEntries()) {
    const chip = document.createElement("span");
    chip.className = "legend-chip";
    const dot = document.createElement("span");
    dot.className = "legend-dot";
    dot.style.background = swatch.color;
    const text = document.createElement("span");
    text.textContent = `${swatch.name} — aus ${swatch.from}`;
    chip.append(dot, text);
    resources.appendChild(chip);
  }
  fragment.append(
    resources,
    paragraph(
      "Vorkommen sind endlich. Eine abgeerntete Kachel wird wieder Wiese — wer seine Umgebung " +
        "ausgeräumt hat, muss dorthin expandieren, wo auch andere hinwollen.",
    ),
    paragraph(
      "Bretter und Stahl liegen nicht im Boden: dafür braucht es ein Sägewerk und eine Schmelze, " +
        "die laufend aus dem Vorrat veredeln. Der Panzerwagen hängt daran — wer nie eine Schmelze " +
        "gebaut hat, kann ihn nicht aufstellen, wie viel rohes Erz auch herumliegt.",
    ),
  );

  fragment.append(heading("Nahrung"));
  fragment.append(
    paragraph(
      "Nahrung ist die einzige Ausgabe, die immer wieder anfällt: jede Einheit kostet sie, " +
        "solange sie lebt. Die Anzeige oben links zeigt Bedarf durch Versorgung und wird rot, " +
        "sobald sie nicht mehr reicht.",
    ),
    paragraph(
      "Reicht sie nicht, verliert die ganze Armee langsam Leben — sie stirbt nicht daran, aber " +
        "sie verliert den nächsten Kampf. Eine Farm ist das billigste Gebäude im Menü und die " +
        "Antwort darauf. Wer satt ist, erholt sich langsam wieder.",
    ),
  );

  fragment.append(heading("Strom"));
  fragment.append(
    paragraph(
      "Das Hauptquartier versorgt seinen eigenen Hof. Alles, was weiter draußen steht — eine " +
        "Schmelze am Erz, eine vorgeschobene Kaserne — arbeitet nur halb so schnell, bis ein " +
        "Kraftwerk es abdeckt.",
    ),
    paragraph(
      "Nichts schaltet sich ganz ab: ein Gebäude ohne Strom wird langsam, nicht tot. Dafür ist " +
        "ein Kraftwerk das lohnendste Ziel auf der Karte — es ist die Leistung mehrerer Gebäude " +
        "in einem einzigen, das man niederbrennen kann.",
    ),
  );

  fragment.append(heading("Einheiten"));
  const units = document.createElement("div");
  units.className = "legend-cards";
  for (const entry of unitEntries()) {
    const card = document.createElement("div");
    card.className = "legend-card";

    const head = document.createElement("div");
    head.className = "legend-card-head";
    head.appendChild(unitIcon(entry.shape, 0));
    const title = document.createElement("div");
    title.innerHTML = "";
    const name = document.createElement("strong");
    name.textContent = entry.name;
    const role = document.createElement("div");
    role.className = "legend-role";
    role.textContent = entry.role;
    title.append(name, role);
    head.appendChild(title);
    card.appendChild(head);

    const rows: Array<readonly [string, string]> = [
      ["Kosten", entry.costText],
      ["Leben", `${entry.hp} · Rüstung ${entry.armorName}`],
      ["Tempo", entry.speedText],
      ["Sicht", entry.sightText],
    ];
    if (entry.weaponText) rows.push(["Waffe", entry.weaponText]);
    if (entry.strongAgainst.length > 0) rows.push(["Stark gegen", entry.strongAgainst.join(", ")]);
    if (entry.weakAgainst.length > 0) rows.push(["Schwach gegen", entry.weakAgainst.join(", ")]);

    card.appendChild(definitionList(rows));
    units.appendChild(card);
  }
  fragment.appendChild(units);

  fragment.append(heading("Konter"));
  const table = document.createElement("table");
  table.className = "legend-table";
  const header = document.createElement("tr");
  for (const label of ["Einheit", "schlägt", "verliert gegen"]) {
    const th = document.createElement("th");
    th.textContent = label;
    header.appendChild(th);
  }
  table.appendChild(header);
  for (const row of counterTriangle([UnitType.Soldier, UnitType.Grenadier, UnitType.Vehicle])) {
    const tr = document.createElement("tr");
    for (const value of [row.attacker, row.beats, row.losesTo]) {
      const td = document.createElement("td");
      td.textContent = value;
      tr.appendChild(td);
    }
    table.appendChild(tr);
  }
  fragment.appendChild(table);

  fragment.append(heading("Gebäude"));
  const buildings = document.createElement("div");
  buildings.className = "legend-cards";
  for (const entry of buildingEntries()) {
    const card = document.createElement("div");
    card.className = "legend-card";

    const head = document.createElement("div");
    head.className = "legend-card-head";
    head.appendChild(buildingIcon(0, entry.glyph));
    const title = document.createElement("strong");
    title.textContent = `${entry.name} (${entry.footprint}×${entry.footprint})`;
    head.appendChild(title);
    card.appendChild(head);

    const rows: Array<readonly [string, string]> = [
      ["Kosten", entry.costText],
      ["Leben", String(entry.hp)],
      ["Bauradius", `${entry.buildRadius} Kacheln`],
    ];
    if (entry.acceptsDeliveries) rows.push(["Abgabe", "Arbeiter liefern hier ab"]);
    if (entry.refinesText) rows.push(["Veredelt", entry.refinesText]);
    if (entry.foodText) rows.push(["Nahrung", entry.foodText]);
    if (entry.powerText) rows.push(["Strom", entry.powerText]);
    if (entry.trains.length > 0) rows.push(["Bildet aus", entry.trains.join(", ")]);
    if (entry.weaponText) rows.push(["Waffe", entry.weaponText]);

    card.appendChild(definitionList(rows));
    buildings.appendChild(card);
  }
  fragment.appendChild(buildings);

  fragment.append(
    heading("Bauen"),
    paragraph(
      "Gebaut wird nur in Reichweite fertiger eigener Gebäude — die erlaubte Fläche wird beim Bauen " +
        "markiert. Das hält deine Basis zusammen, statt Hütten über die Karte zu verstreuen. " +
        "Unfertige Gebäude zählen nicht: erst wenn etwas steht, erweitert es die Fläche.",
    ),
    paragraph(
      "Ein Lager näher am Wald verkürzt jeden künftigen Weg deiner Arbeiter — steht dafür aber " +
        "verwundbar weit weg von zuhause. Das ist die zentrale Abwägung der Wirtschaft.",
    ),
  );

  fragment.append(heading("Bedienung"), definitionList(GESTURES));

  return fragment;
}

export interface Legend {
  toggle: () => void;
  isOpen: () => boolean;
  close: () => void;
}

export function createLegend(): Legend {
  const overlay = document.createElement("div");
  overlay.id = "legend";
  overlay.hidden = true;
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-label", "Legende und Anleitung");

  const panel = document.createElement("div");
  panel.className = "legend-panel";

  const bar = document.createElement("div");
  bar.className = "legend-bar";
  const title = document.createElement("strong");
  title.textContent = "Legende";
  const close = document.createElement("button");
  close.className = "ctrl";
  close.type = "button";
  close.textContent = "✕";
  close.setAttribute("aria-label", "Schließen");
  bar.append(title, close);

  const body = document.createElement("div");
  body.className = "legend-body";

  panel.append(bar, body);
  overlay.appendChild(panel);
  document.body.appendChild(overlay);

  const setOpen = (open: boolean): void => {
    overlay.hidden = !open;
    if (open) {
      // Built fresh each time so it always reflects the current tables, and
      // costs nothing while closed.
      body.replaceChildren(buildContent());
      body.scrollTop = 0;
    } else {
      body.replaceChildren();
    }
  };

  close.addEventListener("click", () => setOpen(false));
  // Tapping the dimmed area closes it — the gesture everyone tries first.
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) setOpen(false);
  });
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !overlay.hidden) setOpen(false);
  });

  return {
    toggle: () => setOpen(overlay.hidden),
    isOpen: () => !overlay.hidden,
    close: () => setOpen(false),
  };
}
