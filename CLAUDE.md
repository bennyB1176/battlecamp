# Arbeitsweise in diesem Projekt

Kurze Sammlung der Konventionen, die sich hier eingespielt haben — damit sie
auch nach einem Sitzungswechsel gelten.

## Pull Requests

**Rebase-Merge, keine Merge-Commits.** Vom Nutzer so festgelegt. Zwei Folgen,
die man kennen sollte:

- Die Historie auf `main` bleibt linear, ohne „Merge pull request …"-Commits.
- Die Commits bekommen dabei neue SHAs. Für unseren Ablauf unproblematisch:
  nach einem Merge wird der Entwicklungsbranch ohnehin frisch von `main`
  gesetzt, statt auf gemergter Historie weiterzustapeln.

Dauerhaft erzwingen lässt sich das nur in den Repo-Einstellungen:
*Settings → General → Pull Requests* → nur „Allow rebase merging" ankreuzen.

## Commits

- `git config user.email noreply@anthropic.com`, `user.name Claude`
- Commit-Nachrichten auf Deutsch, und sie erklären **warum**, nicht was —
  der Diff sagt schon, was sich geändert hat
- Merge-Commits, die GitHub selbst erzeugt, tragen `GitHub
  <noreply@github.com>` als Committer. Das ist normal und wird **nicht**
  nachträglich umgeschrieben: sie liegen bereits auf `main`, und ein
  Force-Push auf den Hauptbranch wäre ein absurder Preis für einen
  kosmetischen Eintrag an einem fremden Commit.

## Entwicklung

- **Testgetrieben**: erst der Test, dann die Implementierung. Jeder Meilenstein
  hat sein Abnahmekriterium als lauffähigen Test, nicht als Notiz.
- **Der Simulations-Kern bleibt rein.** `tests/sim-purity.test.ts` liest den
  Quelltext von `src/sim` und lässt den Build scheitern, sobald dort
  `Math.random()`, `Date.now()` oder DOM-Zugriffe auftauchen.
- **Golden-Hash bewusst aktualisieren.** Ändert sich das Verhalten der
  Simulation absichtlich, wird der Wert in `tests/determinism.test.ts` im
  selben Commit mitgezogen — der Diff hält dann fest, dass sich die Welt
  geändert hat.
- **Ansichtscode wird im Browser geprüft**, nicht nur per Unit-Test. Mehrere
  echte Fehler dieses Projekts waren reine Bedienbarkeitsfragen und wären in
  keinem Unit-Test aufgefallen.
- **Ein neues Teilsystem ist erst fertig, wenn `main.ts` es aufruft.** Der Bot
  war über acht Seeds getestet, durch fünf Fehler nachjustiert — und wurde vom
  Spiel nie aufgerufen. Alle Tests grün, auf dem Telefon ein Gegner, der
  regungslos dasteht. Tests beweisen, dass eine Sache funktioniert, nicht dass
  sie stattfindet. Die Verdrahtung gehört in ein eigenes Modul mit eigenen
  Tests, nicht in ein paar Zeilen im Einstiegspunkt, an die kein Test kommt.
- Vor jedem Push: `npm run typecheck`, `npm test`, `npm run build`,
  `npm run scan:secrets`.

## Inhalte und Balance

Zahlen gehören in die Tabellen unter `src/content/`, nicht in den Code. Die
Legende im Spiel leitet sich vollständig daraus ab — wer eine Einheit
hinzufügt oder die Schadensmatrix nachjustiert, muss die Hilfe nicht anfassen.
