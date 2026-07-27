/**
 * Architectural guard rails for the simulation core.
 *
 * `src/sim` must stay a pure, headless, deterministic module: no DOM, no
 * wall-clock time, no unseeded randomness, no dependency on rendering or input.
 * Those rules are easy to state and easy to break by accident — a stray
 * `Date.now()` added while debugging would survive review and only surface as a
 * desync months later.
 *
 * This test reads the source and enforces them mechanically.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const SIM_DIR = fileURLToPath(new URL("../src/sim", import.meta.url));

function listSourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return listSourceFiles(path);
    return entry.name.endsWith(".ts") ? [path] : [];
  });
}

/**
 * Strip comments so documentation *describing* a banned API (this file's own
 * header, for instance) does not trip the check.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

const BANNED_PATTERNS: ReadonlyArray<{ pattern: RegExp; reason: string }> = [
  { pattern: /\bMath\s*\.\s*random\b/, reason: "unseeded randomness breaks reproducibility — use world.rng" },
  { pattern: /\bDate\s*\.\s*now\b/, reason: "wall-clock time breaks determinism — use world.tick" },
  { pattern: /\bnew\s+Date\b/, reason: "wall-clock time breaks determinism — use world.tick" },
  { pattern: /\bperformance\s*\.\s*now\b/, reason: "wall-clock time breaks determinism — use world.tick" },
  { pattern: /\bwindow\b/, reason: "the sim must run headless (CI, worker, server)" },
  { pattern: /\bdocument\b/, reason: "the sim must run headless (CI, worker, server)" },
  { pattern: /\blocalStorage\b/, reason: "the sim must run headless (CI, worker, server)" },
  { pattern: /\bsetTimeout\b/, reason: "the sim advances only via tickWorld" },
  { pattern: /\bsetInterval\b/, reason: "the sim advances only via tickWorld" },
  { pattern: /\brequestAnimationFrame\b/, reason: "the sim advances only via tickWorld" },
];

describe("simulation core purity", () => {
  const files = listSourceFiles(SIM_DIR);

  it("finds simulation sources to check", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files.map((file) => [file] as const))("%s uses no non-deterministic APIs", (file) => {
    const code = stripComments(readFileSync(file, "utf8"));

    for (const { pattern, reason } of BANNED_PATTERNS) {
      expect(pattern.test(code), `${file} matches ${pattern}: ${reason}`).toBe(false);
    }
  });

  it.each(files.map((file) => [file] as const))("%s does not depend on view code", (file) => {
    const code = stripComments(readFileSync(file, "utf8"));
    const imports = [...code.matchAll(/from\s+["']([^"']+)["']/g)].map((match) => match[1] ?? "");

    for (const specifier of imports) {
      expect(
        /(^|\/)(render|input|ui)\//.test(specifier),
        `${file} imports view code from "${specifier}" — the sim must not know the renderer exists`,
      ).toBe(false);
    }
  });
});
