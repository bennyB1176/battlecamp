# Battlecamp

Ein 2D-Echtzeit-Strategiespiel zwischen **Command & Conquer** und **Die Siedler**, mit einer Prise
**StarCraft**. Basis aufbauen, Wirtschaft hochziehen, Armee produzieren, Gegner zerstören — auf dem
Handy spielbar, Strategie vor Fingerfertigkeit.

> Status: **M0** — Fundament steht (Karte, Kamera, deterministischer Sim-Kern, Spielschleife).
> Einheiten und Wirtschaft kommen in M1/M2.

## Schnellstart

```bash
npm install
npm run dev -- --host   # dann vom Handy im gleichen WLAN öffnen
```

| Befehl | Zweck |
| --- | --- |
| `npm run dev` | Entwicklungsserver mit Hot Reload |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Vitest, inklusive Determinismus-Suite |
| `npm run build` | Typecheck + Produktions-Build nach `dist/` |

Keine Runtime-Abhängigkeiten — nur TypeScript, Vite und Vitest zur Entwicklung.

## Bedienung

| Geste | Wirkung |
| --- | --- |
| Ein Finger ziehen | Karte verschieben |
| Zwei Finger | Zoomen (und verschieben) |
| Tippen | Markierung setzen (Platzhalter für spätere Befehle) |
| Mausrad | Zoomen (Desktop) |
| Leertaste / ⏸ | Pause |
| 1× / 2× / 4× | Zeitraffer |

## Architektur

Eine Entscheidung prägt alles: **der Simulations-Kern ist strikt vom Rendering getrennt und
vollständig deterministisch.** Jede Zustandsänderung läuft über ein `Command`, das an einer
Tick-Grenze angewendet wird — die UI mutiert nichts direkt, ein Bot auch nicht.

```
src/
  sim/      deterministischer Kern — kein DOM, keine Wanduhr, kein Math.random
  content/  reine Daten: Einheiten, Gebäude, Völker, Biome
  ai/       Bot-Spieler, gibt ausschließlich Commands aus
  render/   Canvas2D, liest den Zustand nur
  input/    Touch/Maus → Commands
  ui/       HUD
```

Der Sim läuft mit **10 Hz** (fixer Tick), gerendert wird mit Bildwiederholrate und dazwischen
interpoliert. Das ist der entscheidende Mobile-Trick: die teure Logik läuft sechsmal seltener als
das Zeichnen.

Was diese Trennung später fast gratis liefert:

- **Bots** benutzen exakt denselben Befehlsweg wie ein Mensch — kein KI-Sonderpfad
- **Replays** sind Seed + Befehlsliste, also wenige Kilobyte
- **Regressionstests**: gleicher Seed + gleiche Befehle ⇒ gleicher Zustands-Hash
- **Lockstep-Multiplayer** ohne Neuschreiben des Kerns

Zwei Testdateien bewachen genau das: `tests/determinism.test.ts` prüft die Reproduzierbarkeit,
`tests/sim-purity.test.ts` liest den Quelltext von `src/sim` und lässt den Build scheitern, sobald
dort `Math.random()`, `Date.now()` oder DOM-Zugriffe auftauchen.

Positionen laufen ab M1 über die Fixed-Point-Helfer in `src/sim/fixed.ts`: JavaScript-Fließkomma ist
zwischen Engines nicht bitgenau, und diese Vorsorge hält den späteren Multiplayer-Umbau auf eine
Datei begrenzt.

## Spielkonzept

**Wirtschaft** — der Regler zwischen den beiden Vorbildern steht in der Mitte: Veredelungsketten wie
bei den Siedlern (Erz + Kohle → Stahl → Panzer), aber ohne Träger-Logistik. Arbeiter pendeln zwischen
Vorkommen und Lager, Veredelungsgebäude ziehen aus einem globalen Pool.

Zwei Regeln erzwingen echte Wirtschaftsentscheidungen statt Dauer-Rush:

- **Nahrung ist laufender Unterhalt**, nicht nur Baukosten — eine Armee ohne Basis verhungert
- **Energie wirkt im Radius** — Basis-Layout wird zur Entscheidung, Kraftwerke zu lohnenden Zielen

**Kampf** — Tiefe über eine Schadens-/Rüstungsmatrix (normal / explosiv / durchschlagend gegen
leicht / mittel / schwer / Gebäude) statt über Grafik.

**Völker** — Union (ausgewogen, Fahrzeuge), Klan (wirtschaftsstark, defensiv), Brut (schnell, billig,
organisch). Data-driven definiert; ein neues Volk ist im Wesentlichen eine Content-Datei.

**Welten** — prozedurale Karten mit Biomen (Grasland, Wüste, Tundra, Ödland) und
rotationssymmetrischen Startpositionen.

## Roadmap

| | Meilenstein | Fertig, wenn |
| --- | --- | --- |
| **M0** | Gerüst | ✅ Karte auf dem Handy flüssig scroll- und zoombar, Pause hält den Tick an |
| M1 | Einheiten & Bewegung | 100 Einheiten laufen flüssig zum Ziel, ohne sich zu verkeilen |
| M2 | Wirtschaft & Bau | Aus einem HQ lässt sich eine funktionierende Basis hochziehen |
| M3 | Produktion & Kampf | Ein komplettes Match gegen einen Dummy-Gegner ist gewinnbar |
| M4 | Echte Bots | Bot vs. Bot läuft 20 Minuten stabil, Mensch verliert gegen „Schwer" |
| M5 | Ketten, Nahrung, Energie | Erster Balance-Pass über Massen-Headless-Matches |
| M6 | Fog of War | Aufklärung zählt, Bots respektieren den Nebel |
| M7 | Völker 2 & 3 | Klan und Brut spielbar |
| M8 | Welten | Prozedurale Karten, vier Biome, Skirmish-Setup |
| M9 | Politur | Speichern/Laden, Replays, PWA, offline |
| M10 | Multiplayer | Lockstep über WebSocket (optional) |
