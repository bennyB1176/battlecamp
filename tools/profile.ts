/**
 * Per-tick cost probe.
 *
 * Exists because a performance regression here does not announce itself: the
 * game keeps working, just slower, until a phone drops frames. Comparing "with
 * bots" against "without" separates simulation cost from decision cost, which
 * is what caught the flow-field cache thrashing that made the simulation 190x
 * slower while the bots themselves cost nothing.
 *
 * Run with: npx vite-node tools/profile.ts
 */

import { createBot, Difficulty, updateBot } from "../src/ai/bot.js";
import type { Command } from "../src/sim/commands.js";
import { createWorld, tickWorld } from "../src/sim/world.js";

function measure(label: string, withBots: boolean, ticks: number): void {
  const world = createWorld({ seed: 1, width: 64, height: 64 });
  const bots = [createBot(0, Difficulty.Normal, 1), createBot(1, Difficulty.Hard, 2)];

  let botMs = 0;
  let simMs = 0;

  for (let tick = 0; tick < ticks; tick++) {
    const commands: Command[] = [];

    if (withBots) {
      const started = performance.now();
      for (const bot of bots) commands.push(...updateBot(bot, world));
      botMs += performance.now() - started;
    }

    const started = performance.now();
    tickWorld(world, commands);
    simMs += performance.now() - started;
  }

  console.log(
    `${label.padEnd(12)} Sim ${(simMs / ticks).toFixed(3)} ms/Tick · ` +
      `Bot ${(botMs / ticks).toFixed(3)} ms/Tick · ${world.entities.list.length} Objekte`,
  );
}

// The budget is 8 ms per tick on a mid-range phone.
measure("ohne Bots", false, 2000);
measure("mit Bots", true, 2000);
