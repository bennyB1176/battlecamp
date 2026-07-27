/**
 * Generate the app icons.
 *
 * Checked in as a script rather than as four opaque binaries, so the icon can be
 * regenerated when the game's colours change — they come from the same tables
 * the renderer uses, and a mark that drifts away from what the game looks like
 * is worse than no mark at all.
 *
 * The PNGs are written by hand: axis-aligned rectangles on a flat background
 * need no anti-aliasing and no image library, and this project has no runtime
 * dependencies worth breaking that record for. Node's own zlib does the
 * compression.
 *
 *   node scripts/make-icons.mjs
 */

import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "public");

/**
 * The mark: a headquarters standing on grass, drawn exactly the way the game
 * draws one — body in the first player's blue, a darker roof band across the
 * top third, a light doorway at the foot. Colours lifted from
 * `src/content/players.ts` and `src/sim/grid.ts`; if those change, run this
 * again.
 *
 * Everything is expressed as fractions of the icon, so one description serves
 * every size from a 32-pixel browser tab to a 512-pixel install prompt.
 */
const BACKGROUND = "#12161c";
const GRASS = "#4a6b3a";
const BODY = "#62b0f5";
const ROOF = "#0e2f52";
const DOOR = "#d2e9ff";
const OUTLINE = "#070a0e";

const ENEMY = "#e05a42";
const ENEMY_DARK = "#4d1710";

/**
 * [x, y, width, height, colour], each in fractions of the icon's side.
 *
 * Two colours, because that is the game's whole visual grammar: colour says
 * whose, shape says what. A blue building alone would be a blue box on any app
 * grid; a blue building with red closing in on it is legible as a strategy game
 * at thirty-two pixels, which is the size that actually has to work.
 */
const SHAPES = [
  // Ground: a band along the bottom, so the building stands on something.
  [0, 0.72, 1, 0.28, GRASS],
  // Outline first, then the body inside it — cheaper than stroking, and at 32
  // pixels a hard edge is what makes the silhouette readable at all.
  [0.1, 0.2, 0.52, 0.6, OUTLINE],
  [0.13, 0.23, 0.46, 0.54, BODY],
  [0.13, 0.23, 0.46, 0.18, ROOF],
  [0.29, 0.62, 0.13, 0.15, DOOR],
  // The attackers, coming from the right.
  [0.7, 0.42, 0.16, 0.16, ENEMY_DARK],
  [0.72, 0.44, 0.12, 0.12, ENEMY],
  [0.78, 0.66, 0.16, 0.16, ENEMY_DARK],
  [0.8, 0.68, 0.12, 0.12, ENEMY],
];

function parseColor(hex) {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

/** Paint the mark into a raw RGBA buffer. */
function render(size) {
  const pixels = new Uint8Array(size * size * 4);
  const fill = (x0, y0, w, h, hex) => {
    const [r, g, b] = parseColor(hex);
    const left = Math.round(x0 * size);
    const top = Math.round(y0 * size);
    const right = Math.round((x0 + w) * size);
    const bottom = Math.round((y0 + h) * size);

    for (let y = Math.max(0, top); y < Math.min(size, bottom); y++) {
      for (let x = Math.max(0, left); x < Math.min(size, right); x++) {
        const index = (y * size + x) * 4;
        pixels[index] = r;
        pixels[index + 1] = g;
        pixels[index + 2] = b;
        pixels[index + 3] = 255;
      }
    }
  };

  fill(0, 0, 1, 1, BACKGROUND);
  for (const [x, y, w, h, color] of SHAPES) fill(x, y, w, h, color);
  return pixels;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function encodePng(size, pixels) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // colour type: RGBA
  // compression, filter, interlace: the only values PNG actually defines.
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;

  // One filter byte per scanline. Filter 0 (none) costs a little size and
  // saves a lot of code; these images compress to a couple of kilobytes anyway.
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(pixels.buffer, y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** The same geometry as SVG, for browsers that would rather scale than resample. */
function encodeSvg() {
  const rects = SHAPES.map(
    ([x, y, w, h, color]) =>
      `  <rect x="${x * 100}" y="${y * 100}" width="${w * 100}" height="${h * 100}" fill="${color}"/>`,
  ).join("\n");

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" role="img" aria-label="Battlecamp">
  <rect width="100" height="100" fill="${BACKGROUND}"/>
${rects}
</svg>
`;
}

for (const size of [180, 192, 512]) {
  writeFileSync(join(OUT, `icon-${size}.png`), encodePng(size, render(size)));
}
writeFileSync(join(OUT, "icon.svg"), encodeSvg());

console.log("Symbole geschrieben: icon.svg, icon-180.png, icon-192.png, icon-512.png");
