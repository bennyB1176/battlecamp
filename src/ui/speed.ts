/**
 * The time control: one button that cycles, rather than one button per speed.
 *
 * Three speed buttons cost three button widths, and on a phone held upright the
 * control row ran off the edge of the screen — the last thing on it being the
 * help button, which is exactly what a new player reaches for first. Cycling
 * costs one width and one extra tap to reach the far end.
 *
 * The glyph grows with the speed, so it reads without a legend: one arrow,
 * two, three. Nobody should have to remember which symbol meant which number.
 */

/** Available time multipliers, slowest first. */
export const SPEEDS: readonly number[] = [1, 2, 4];

/**
 * The next speed in the cycle, wrapping round to the start.
 *
 * An unknown speed returns to the beginning rather than sticking. A time
 * control that stops responding looks, on a phone, exactly like a frozen game.
 */
export function nextSpeed(current: number): number {
  const index = SPEEDS.indexOf(current);
  if (index < 0) return SPEEDS[0]!;
  return SPEEDS[(index + 1) % SPEEDS.length]!;
}

/**
 * What the button shows.
 *
 * The variation selector forces the text form of the arrow: without it, phones
 * substitute a colour emoji, which sits at a different size and baseline from
 * every other glyph in the row and makes the whole strip look misaligned.
 */
export function speedGlyph(speed: number): string {
  const steps = Math.max(1, SPEEDS.indexOf(speed) + 1);
  return "▶︎".repeat(steps);
}

/** The accessible name, since the glyph carries no number. */
export function speedLabel(speed: number): string {
  return `Tempo ${speed}-fach, tippen für schneller`;
}
