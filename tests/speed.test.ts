/**
 * The time control.
 *
 * Three separate speed buttons cost three button widths, and in portrait the
 * control row simply ran off the screen. One button that cycles costs one —
 * which is the whole reason this exists, so the first thing worth pinning down
 * is that cycling actually returns to where it started.
 */

import { describe, expect, it } from "vitest";

import { SPEEDS, nextSpeed, speedGlyph, speedLabel } from "../src/ui/speed.js";

describe("cycling through the speeds", () => {
  it("steps 1 to 2 to 4 and back to 1", () => {
    expect(nextSpeed(1)).toBe(2);
    expect(nextSpeed(2)).toBe(4);
    expect(nextSpeed(4)).toBe(1);
  });

  it("returns to the start after one full round", () => {
    let speed = SPEEDS[0]!;
    for (let step = 0; step < SPEEDS.length; step++) speed = nextSpeed(speed);
    expect(speed).toBe(SPEEDS[0]);
  });

  it("visits every speed on the way round", () => {
    const seen = new Set<number>();
    let speed = SPEEDS[0]!;
    for (let step = 0; step < SPEEDS.length; step++) {
      seen.add(speed);
      speed = nextSpeed(speed);
    }
    expect([...seen].sort((a, b) => a - b)).toEqual([...SPEEDS]);
  });

  it("recovers from a speed that is not in the table", () => {
    // Defensive, because the alternative is a control that stops responding —
    // and a stuck time control on a phone looks exactly like a frozen game.
    expect(nextSpeed(3)).toBe(SPEEDS[0]);
    expect(nextSpeed(0)).toBe(SPEEDS[0]);
  });
});

describe("what the button shows", () => {
  it("gives each speed its own glyph", () => {
    const glyphs = SPEEDS.map(speedGlyph);
    expect(new Set(glyphs).size, "two speeds look identical on screen").toBe(SPEEDS.length);
  });

  it("grows the glyph with the speed", () => {
    // The one property that makes it readable without a legend: more arrows,
    // faster. A player should never have to remember which symbol meant what.
    const lengths = SPEEDS.map((speed) => speedGlyph(speed).length);
    for (let i = 1; i < lengths.length; i++) {
      expect(lengths[i]!).toBeGreaterThan(lengths[i - 1]!);
    }
  });

  it("says the speed in words for anyone who cannot see the glyph", () => {
    // The glyph carries no number, so the accessible name has to.
    for (const speed of SPEEDS) {
      expect(speedLabel(speed)).toContain(String(speed));
    }
  });
});
