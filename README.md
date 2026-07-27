# Battlecamp

Ein 2D-Echtzeit-Strategiespiel zwischen **Command & Conquer** und **Die Siedler**, mit einer Prise
**StarCraft**. Basis aufbauen, Wirtschaft hochziehen, Armee produzieren, Gegner zerstören — auf dem
Handy spielbar, Strategie vor Fingerfertigkeit.

**▶ Spielen: https://bennyb1176.github.io/battlecamp/** — läuft im Browser, für Touch gebaut.

> Status: **M5** — die Wirtschaft stellt jetzt Fragen. Veredelungsketten (Holz → Bretter,
> Erz → Stahl), Nahrung als laufender Unterhalt mit Attrition, und Strom, der im Radius
> wirkt. Dazu drei Bot-Schwierigkeitsgrade, die sich messbar unterscheiden, und ein
> Headless-Match-Runner: `npm run match -- --seeds 8 --bots leicht,schwer`.
>
> Den Gegner wählt man vorerst über die Adresse — `?gegner=leicht`, `?gegner=normal`
> (Standard) oder `?gegner=schwer`. Ein richtiges Menü kommt mit dem
> Skirmish-Setup in M8.

## Schnellstart

```bash
npm install
npm run dev -- --host   # dann vom Handy im gleichen WLAN öffnen
```

| Befehl | Zweck |
| --- | --- |
| `npm run dev` | Entwicklungsserver mit Hot Reload |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Vitest, inklusive Determinismus- und Abnahme-Suite |
| `npm run build` | Typecheck + Produktions-Build nach `dist/` |
| `npm run build:single` | Alles in eine Datei: `dist-single/battlecamp.html` |
| `node scripts/make-icons.mjs` | App-Symbole neu erzeugen (nach Farbänderungen) |
| `npm run match` | Headless-Partien für Balance und Stabilität, z.B. `-- --seeds 8 --bots leicht,schwer` |
| `npm run scan:secrets` | gitleaks über Arbeitskopie und Historie |
| `npm run hooks:install` | Pre-commit-Hook aktivieren (optional) |

Keine Runtime-Abhängigkeiten — nur TypeScript, Vite und Vitest zur Entwicklung.

## Bedienung

| Geste | Wirkung |
| --- | --- |
| Ein Finger ziehen | Karte verschieben |
| Zwei Finger | Zoomen (und verschieben) |
| Auf eigene Einheit tippen | Einheit auswählen |
| Auf Rohstoff tippen (mit Arbeitern) | Abbauen |
| Auf eigene Baustelle tippen (mit Arbeitern) | Beim Bau helfen |
| Auf Gelände tippen (mit Auswahl) | Bewegungsbefehl |
| Auf Gelände tippen (ohne Auswahl) | Markierung setzen |
| Auf Hauptquartier tippen | Arbeiter ausbilden |
| Auf Kaserne tippen | Soldat, Grenadier oder Panzerwagen ausbilden |
| Auf Gegner tippen (mit Kampfeinheiten) | Angreifen |
| ⚔ dann tippen | Angriffsbewegung — engagiert, was unterwegs auftaucht |
| 🔨 dann Gebäude wählen | Bauen — erlaubte Fläche wird markiert |
| ⬚ dann ziehen | Auswahlrahmen über mehrere Einheiten |
| ? | Legende und Anleitung |
| Mausrad | Zoomen (Desktop) |
| Leertaste / ⏸ | Pause |
| ▶ antippen | Tempo: 1× → 2× → 4× → 1× |

Auf dem Handy gibt es keine rechte Maustaste, und Ein-Finger-Ziehen ist fürs Verschieben der Karte
vergeben. Der Auswahlrahmen bekommt deshalb einen eigenen Modus-Knopf, der sich nach der Auswahl
von selbst wieder ausschaltet.

## Auf dem Handy testen

Drei Wege, je nachdem was du gerade brauchst:

**Im gleichen WLAN** — `npm run dev -- --host`, dann die angezeigte Netzwerk-Adresse am Telefon
öffnen. Hot Reload inklusive: speichern am Rechner, das Handy lädt neu.

**GitHub Pages** — jeder Push auf `main` baut, testet und veröffentlicht automatisch
(`.github/workflows/pages.yml`); das Spiel liegt danach unter
`https://bennyb1176.github.io/battlecamp/`. Einmalig nötig:

> Settings → Pages → Build and deployment → Source: **GitHub Actions**

Nur `main`, nicht jeder Branch: GitHub legt die `github-pages`-Umgebung mit einer Regel an, die
Deploys auf den Default-Branch beschränkt. Ein Lauf von einem Feature-Branch baut und testet
sauber und wird dann am Deploy-Tor abgewiesen — ein rotes Kreuz, das nichts über den Code aussagt.
Für Zwischenstände auf dem Gerät sind die beiden anderen Wege da.

**Eine Datei zum Weitergeben** — `npm run build:single` legt `dist-single/battlecamp.html` an:
das komplette Spiel in ~24 kB, ohne Server lauffähig. Reicht für AirDrop, Anhang oder itch.io.

Auf iOS lohnt sich „Teilen → Zum Home-Bildschirm": das Manifest startet das Spiel im Vollbild,
ohne dass Safaris Leisten ein Drittel des Schirms wegnehmen.

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

Positionen laufen über die Fixed-Point-Helfer in `src/sim/fixed.ts`: JavaScript-Fließkomma ist
zwischen Engines nicht bitgenau, und diese Vorsorge hält den späteren Multiplayer-Umbau auf eine
Datei begrenzt.

### Warum hundert Einheiten bezahlbar sind

Drei Entscheidungen tragen die Masse:

- **Flow-Fields statt A\* pro Einheit** (`src/sim/pathing.ts`). Ein Dijkstra-Lauf vom *Ziel* aus
  beschriftet jede Kachel mit ihrem günstigsten Schritt; beliebig viele Einheiten folgen den Pfeilen
  für den Preis eines Array-Zugriffs. Hundert Einheiten auf einen Punkt zu schicken kostet eine
  Suche, nicht hundert. Ein Test hält das fest: nach einem Gruppenbefehl darf der Cache genau ein
  Feld enthalten.
- **Spatial-Hash statt Alle-gegen-alle** (`src/sim/spatial.ts`). Nachbarschaftsabfragen für
  Trennung — später für Kampf — würden sonst quadratisch wachsen.
- **Auswahl gehört zur Ansicht, nicht zur Welt** (`src/input/selection.ts`). Was ich markiert habe,
  geht die Simulation nichts an; sonst müssten Replays es aufzeichnen und Multiplayer es abgleichen.

Gemessen im Browser mit Touch-Emulation: 212 Einheiten bei 60 fps, Simulationsschritt 0,4 ms gegen
ein Budget von 8 ms.

### Wo im Spiel eine Entscheidung entsteht

Die Wirtschaft hat bewusst **keine** Warenlogistik: keine Karren, keine Versorgungslinien. Modelliert
ist genau *eine* Strecke — der Pendelweg des Arbeiters vom Vorkommen zum nächsten Abgabepunkt. Genau
die macht das Lager zu einer Entscheidung: nah am Wald verkürzt es jeden künftigen Weg, steht dafür
aber verwundbar weit weg von zuhause.

Dazu zwei Regeln, die dem Ganzen Form geben:

- **Vorkommen sind endlich.** Eine abgeerntete Kachel wird wieder Wiese. Wer seine Umgebung
  ausgeräumt hat, muss dorthin expandieren, wo auch andere hinwollen.
- **Gebaut wird nur in Reichweite fertiger eigener Gebäude.** Das macht eine Basis zu einem
  zusammenhängenden, verteidigbaren Gebilde statt zu verstreuten Hütten. Nur *fertige* Gebäude zählen
  — sonst kettet man unfertige Hüllen über die Karte und umgeht die Regel.
- **Ein Gebäude darf die Karte nicht zerschneiden.** Ein Bauplatz, der die letzte Verbindung
  zwischen zwei Hälften der Karte schließen würde, wird abgelehnt. Ob man einen Engpass zumauern
  *dürfen* sollte, ist eine offene Designfrage; eine Partie, die niemand mehr gewinnen kann, ist
  keine.

## Sicherheit

`npm run scan:secrets` prüft **Arbeitskopie und komplette Git-Historie** auf versehentlich
committete Zugangsdaten. Ein Schlüssel, der einmal committet und später „entfernt" wurde, steckt
weiterhin in jedem Klon — deshalb reicht der aktuelle Stand als Prüfziel nicht.

CI führt exakt dasselbe Skript aus, damit ein grüner lokaler Lauf und eine grüne Pipeline nicht
zweierlei bedeuten können. Die gitleaks-Binärdatei ist auf Version **und SHA-256** festgenagelt:
ein Sicherheitswerkzeug per `latest` über das Netz zu ziehen hieße, ausgerechnet dem Prüfer blind
zu vertrauen.

Optional lokal: `npm run hooks:install` aktiviert einen Pre-commit-Hook, der die gestageten
Änderungen prüft. Er fängt einen Fund an der einzigen Stelle ab, an der er noch gratis zu beheben
ist — vor dem Commit. Danach hilft nur noch: **Schlüssel rotieren.** Historie umschreiben macht
einen geteilten Schlüssel nicht ungeteilt.

## Spielkonzept

**Wirtschaft** — der Regler zwischen den beiden Vorbildern steht in der Mitte: Veredelungsketten wie
bei den Siedlern (Erz + Kohle → Stahl → Panzer), aber ohne Träger-Logistik. Arbeiter pendeln zwischen
Vorkommen und Lager, Veredelungsgebäude ziehen aus einem globalen Pool.

Zwei Regeln erzwingen echte Wirtschaftsentscheidungen statt Dauer-Rush:

- **Nahrung ist laufender Unterhalt**, nicht nur Baukosten — und zwar eine *Obergrenze*, kein Vorrat.
  Reicht sie nicht, verliert die ganze Armee langsam Leben (nie bis zum Tod). Eine Armee, für die man
  die Wirtschaft leergeräumt hat, gewinnt den Kampf, den sie anfängt, und zerfällt auf dem Rückweg.
- **Energie wirkt im Radius** — das Hauptquartier versorgt seinen eigenen Hof, alles weiter draußen
  arbeitet halb so schnell, bis ein Kraftwerk es abdeckt. Nichts schaltet sich ganz ab: langsam,
  nicht tot. Damit wird Basis-Layout zur Entscheidung und das Kraftwerk zum lohnendsten Ziel.

**Kampf** — Tiefe über eine Schadens-/Rüstungsmatrix (normal / explosiv / durchschlagend gegen
leicht / mittel / schwer / Gebäude) statt über Grafik. Das Konter-Dreieck schließt sich:
Panzerwagen zerreißen Infanterie, Grenadiere knacken Panzerwagen, Infanterie schlägt Grenadiere.
Kein Typ ist die Antwort auf alles — deshalb lohnt sich Aufklärung.

**Legende** — der `?`-Knopf öffnet eine Anleitung im Spiel: Ziel, Bedienung, Rohstoffe, alle
Einheiten und Gebäude mit Werten, das Konter-Dreieck. Sie zeichnet ihre Symbole mit *demselben*
Code wie der Renderer und zieht jede Zahl aus den Content-Tabellen, kann also nicht veralten —
eine neue Einheit taucht von allein auf, eine geänderte Schadensmatrix schreibt die Konter-Tabelle
um. Genau deshalb steckt sie im Spiel und nicht in einem Wiki: handgepflegte Doku zu einem System,
das noch im Balancing ist, stimmt nach einer Woche nicht mehr — und ist dann schlimmer als keine,
weil man ihr glaubt.

**Darstellung** — Farbe sagt *wessen*, Form sagt *was*. Farbe ist für den Spieler reserviert und
wird nie für Einheitentypen ausgegeben; andersherum wären der eigene und der gegnerische Soldat
im Getümmel nicht zu unterscheiden. Alles ist als Canvas-Pfad gezeichnet, keine Bilddateien —
echte Sprites können später eintreten, ohne dass sich am Aufbau etwas ändert.

**Völker** — Union (ausgewogen, Fahrzeuge), Klan (wirtschaftsstark, defensiv), Brut (schnell, billig,
organisch). Data-driven definiert; ein neues Volk ist im Wesentlichen eine Content-Datei.

**Welten** — prozedurale Karten mit Biomen (Grasland, Wüste, Tundra, Ödland) und
rotationssymmetrischen Startpositionen.

## Roadmap

| | Meilenstein | Fertig, wenn |
| --- | --- | --- |
| **M0** | Gerüst | ✅ Karte auf dem Handy flüssig scroll- und zoombar, Pause hält den Tick an |
| **M1** | Einheiten & Bewegung | ✅ 100 Einheiten laufen flüssig zum Ziel, ohne sich zu verkeilen |
| **M2** | Wirtschaft & Bau | ✅ Aus einem HQ lässt sich eine funktionierende Basis hochziehen |
| **M3** | Produktion & Kampf | ✅ Ein komplettes Match gegen einen Dummy-Gegner ist gewinnbar |
| **M4** | Echte Bots | ✅ Bot vs. Bot läuft 20 Minuten stabil und entscheidet sich, Schwierigkeitsgrade unterscheiden sich messbar |
| **M5** | Ketten, Nahrung, Energie | ✅ Alle drei Systeme werden in echten Partien genutzt, Balance-Reihenfolge hält |
| M6 | Fog of War | Aufklärung zählt, Bots respektieren den Nebel |
| M7 | Völker 2 & 3 | Klan und Brut spielbar |
| M8 | Welten | Prozedurale Karten, vier Biome, Skirmish-Setup |
| M9 | Politur | Speichern/Laden, Replays, PWA, offline |
| M10 | Multiplayer | Lockstep über WebSocket (optional) |
