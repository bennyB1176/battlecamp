/**
 * Headless match runner — the balance and stability net.
 *
 *   npm run match -- --seed 42 --bots easy,hard --ticks 12000
 *   npm run match -- --seeds 20 --bots hard,hard
 *
 * Running matches without a renderer is how balance questions get answered
 * without anyone having to play two hundred games. It is also the cheapest
 * crash detector this project has: twenty simulated matches exercise more
 * pathfinding, combat and construction edge cases in a minute than a person
 * would hit in an evening.
 *
 * Run with: npx vite-node tools/match.ts -- <options>
 */

import { Difficulty, DIFFICULTY_NAMES, type DifficultyId } from "../src/ai/bot.js";
import { runMatch, type MatchResult } from "../src/ai/match.js";

interface Options {
  seeds: number[];
  difficulties: DifficultyId[];
  maxTicks: number;
  verbose: boolean;
}

const DIFFICULTY_BY_NAME: Readonly<Record<string, DifficultyId>> = {
  leicht: Difficulty.Easy,
  easy: Difficulty.Easy,
  normal: Difficulty.Normal,
  schwer: Difficulty.Hard,
  hard: Difficulty.Hard,
};

function parseArgs(argv: readonly string[]): Options {
  const options: Options = {
    seeds: [1],
    difficulties: [Difficulty.Normal, Difficulty.Normal],
    // 12 000 ticks at 10 Hz is twenty simulated minutes — long enough that a
    // stalled economy or a stuck army shows up rather than being cut short.
    maxTicks: 12000,
    verbose: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = argv[i + 1];

    switch (arg) {
      case "--seed":
        options.seeds = [Number(value)];
        i++;
        break;
      case "--seeds": {
        const count = Number(value);
        options.seeds = Array.from({ length: count }, (_, index) => index + 1);
        i++;
        break;
      }
      case "--ticks":
        options.maxTicks = Number(value);
        i++;
        break;
      case "--bots": {
        const names = (value ?? "").split(",").map((name) => name.trim().toLowerCase());
        const parsed = names.map((name) => DIFFICULTY_BY_NAME[name]);
        if (parsed.some((difficulty) => difficulty === undefined)) {
          throw new Error(`Unbekannte Schwierigkeit in "${value}". Erlaubt: leicht, normal, schwer`);
        }
        options.difficulties = parsed as DifficultyId[];
        i++;
        break;
      }
      case "--verbose":
        options.verbose = true;
        break;
      default:
        break;
    }
  }

  return options;
}

function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${Math.floor(seconds % 60).toString().padStart(2, "0")}`;
}

function describe(result: MatchResult, difficulties: readonly DifficultyId[]): string {
  const outcome = !result.decided
    ? "unentschieden (Zeit abgelaufen)"
    : result.winner === null
      ? "beide vernichtet"
      : `Spieler ${result.winner} (${DIFFICULTY_NAMES[difficulties[result.winner]!]})`;

  const final = result.samples[result.samples.length - 1];
  const standing =
    final
      ?.players.map((player, index) => `P${index}: ${player.units}E/${player.buildings}G`)
      .join("  ") ?? "";

  return `Seed ${String(result.seed).padStart(5)} · ${formatDuration(result.seconds).padStart(6)} · ${outcome.padEnd(28)} ${standing}`;
}

function main(): void {
  const options = parseArgs(process.argv.slice(2));

  const matchup = options.difficulties.map((difficulty) => DIFFICULTY_NAMES[difficulty]).join(" gegen ");
  console.log(`Battlecamp — ${matchup}, ${options.seeds.length} Match(es), max ${options.maxTicks} Ticks\n`);

  const wins = new Map<number | null, number>();
  const started = Date.now();
  let totalTicks = 0;

  for (const seed of options.seeds) {
    const result = runMatch({
      seed,
      difficulties: options.difficulties,
      maxTicks: options.maxTicks,
      sampleEvery: options.verbose ? 600 : options.maxTicks,
    });

    totalTicks += result.ticks;
    const key = result.decided ? result.winner : null;
    wins.set(key, (wins.get(key) ?? 0) + 1);

    console.log(describe(result, options.difficulties));

    if (options.verbose) {
      for (const snapshot of result.samples) {
        const line = snapshot.players
          .map((player, index) => `P${index} ${player.units}E ${player.buildings}G ${player.banked}R`)
          .join("   ");
        console.log(`    ${formatDuration(snapshot.tick / 10).padStart(6)}  ${line}`);
      }
    }
  }

  const elapsed = (Date.now() - started) / 1000;
  console.log("\nErgebnis:");
  for (const [winner, count] of [...wins.entries()].sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))) {
    const label =
      winner === null
        ? "ohne Entscheidung"
        : `Spieler ${winner} (${DIFFICULTY_NAMES[options.difficulties[winner]!]})`;
    console.log(`  ${label.padEnd(28)} ${count}/${options.seeds.length}`);
  }
  console.log(
    `\n${totalTicks} Ticks in ${elapsed.toFixed(1)}s — ${(totalTicks / elapsed / 1000).toFixed(1)}k Ticks/s`,
  );
}

main();
