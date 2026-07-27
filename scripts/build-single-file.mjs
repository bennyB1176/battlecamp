/**
 * Bundle the built game into one self-contained HTML file.
 *
 * Useful whenever the game has to travel somewhere that cannot serve a folder
 * of assets: a hosted preview link, an itch.io upload, an attachment, or simply
 * opening it from a phone's Files app. The whole game is ~30 KB, so inlining
 * costs nothing.
 *
 * Run after `npm run build` (or via `npm run build:single`).
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const distDir = join(repoRoot, "dist");

/** `</script>` inside a string literal would close our inline tag early. */
function escapeClosingTags(code) {
  return code.replace(/<\/script/gi, "<\\/script");
}

function inlineAssets(html) {
  let result = html;

  // <script type="module" crossorigin src="./assets/index-XYZ.js"></script>
  result = result.replace(
    /<script[^>]*src="\.?\/?([^"]+\.js)"[^>]*><\/script>/g,
    (_match, src) => {
      const code = readFileSync(join(distDir, src), "utf8");
      return `<script type="module">\n${escapeClosingTags(code)}\n</script>`;
    },
  );

  // <link rel="stylesheet" href="./assets/index-XYZ.css">
  result = result.replace(/<link[^>]*href="\.?\/?([^"]+\.css)"[^>]*>/g, (_match, href) => {
    const css = readFileSync(join(distDir, href), "utf8");
    return `<style>\n${css}\n</style>`;
  });

  // The manifest is a separate file that a standalone page cannot reach.
  result = result.replace(/<link[^>]*rel="manifest"[^>]*>\s*/g, "");

  return result;
}

const html = readFileSync(join(distDir, "index.html"), "utf8");
const standalone = inlineAssets(html);

const outputDir = join(repoRoot, "dist-single");
mkdirSync(outputDir, { recursive: true });
const outputPath = join(outputDir, "battlecamp.html");
writeFileSync(outputPath, standalone, "utf8");

const sizeKb = (Buffer.byteLength(standalone, "utf8") / 1024).toFixed(1);
console.log(`build-single-file: ${outputPath} (${sizeKb} kB)`);

// Sanity check: an unnoticed leftover reference would produce a page that looks
// standalone and silently fails to start when opened without a server.
const leftovers = [...standalone.matchAll(/(?:src|href)="([^"]*\.(?:js|css|webmanifest))"/g)];
if (leftovers.length > 0) {
  console.error(`build-single-file: still references external files: ${leftovers.map((m) => m[1]).join(", ")}`);
  process.exit(1);
}
