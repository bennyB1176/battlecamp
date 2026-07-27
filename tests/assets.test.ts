/**
 * Everything the page asks the browser to fetch must exist.
 *
 * A missing icon is not a crash — it is a 404 in the console, a blank square on
 * the home screen, and nothing that any other test would notice. This file
 * closes that gap by reading the references out of `index.html` and the web
 * manifest and checking each one against the files actually shipped.
 *
 * Written after the same shape of mistake twice in one evening: a thing that
 * existed but was never referenced, and a thing that was referenced but never
 * existed.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..");
const PUBLIC = join(ROOT, "public");

const html = readFileSync(join(ROOT, "index.html"), "utf8");
const manifest = JSON.parse(readFileSync(join(PUBLIC, "manifest.webmanifest"), "utf8")) as {
  icons?: Array<{ src: string; sizes: string; type: string }>;
};

/** `public/` is copied to the site root, so "./x" means "public/x". */
function shipped(reference: string): string {
  return join(PUBLIC, reference.replace(/^\.\//, ""));
}

describe("what index.html references", () => {
  const references = [...html.matchAll(/(?:href|src)="(\.\/[^"]+)"/g)].map((match) => match[1]!);

  it("finds something to check", () => {
    // Guards the regex itself: a silent zero matches would make every
    // assertion below vacuously true.
    expect(references.length).toBeGreaterThan(2);
  });

  it.each(["./icon.svg", "./icon-180.png", "./manifest.webmanifest"])(
    "links %s",
    (reference) => {
      expect(references, `index.html no longer references ${reference}`).toContain(reference);
    },
  );

  it("ships every file it links from public/", () => {
    for (const reference of references) {
      // Source paths (./src/...) are resolved and bundled by Vite, not copied.
      if (reference.startsWith("./src/")) {
        expect(existsSync(join(ROOT, reference)), `missing source file ${reference}`).toBe(true);
        continue;
      }
      expect(existsSync(shipped(reference)), `missing asset ${reference}`).toBe(true);
    }
  });
});

describe("the web manifest", () => {
  it("declares icons at all", () => {
    // Without these, "Zum Home-Bildschirm" on a phone saves a screenshot
    // thumbnail instead of an icon.
    expect(manifest.icons?.length ?? 0).toBeGreaterThan(0);
  });

  it("ships every icon it declares", () => {
    for (const icon of manifest.icons ?? []) {
      expect(existsSync(shipped(icon.src)), `manifest names a missing icon: ${icon.src}`).toBe(true);
    }
  });

  it("offers the sizes an install prompt asks for", () => {
    const sizes = new Set((manifest.icons ?? []).map((icon) => icon.sizes));
    expect(sizes).toContain("192x192");
    expect(sizes).toContain("512x512");
  });

  it("has icons that are really PNGs", () => {
    // Cheap, and it catches a truncated or half-written file — which is exactly
    // what a hand-rolled encoder can produce without anyone noticing.
    const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    for (const icon of manifest.icons ?? []) {
      if (icon.type !== "image/png") continue;
      const bytes = readFileSync(shipped(icon.src));
      expect(bytes.subarray(0, 8), `${icon.src} is not a PNG`).toEqual(signature);
      // Width and height live in the IHDR chunk, right after the signature.
      const declared = Number.parseInt(icon.sizes.split("x")[0]!, 10);
      expect(bytes.readUInt32BE(16), `${icon.src} is not ${declared} wide`).toBe(declared);
      expect(bytes.readUInt32BE(20), `${icon.src} is not ${declared} tall`).toBe(declared);
    }
  });
});
