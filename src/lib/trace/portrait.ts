import { GRIDS } from "./grid-data";

// A decoded Trace character is already ASCII: a 35×21 grid drawn with the shade ramp . ░ ▒ ▓ █.
// The glyphs a character can speak are the ones its own grid is made of.
export const RAMP = [".", "░", "▒", "▓", "█"] as const;

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function portrait(tokenId: number): string[] {
  return GRIDS[tokenId] ?? [];
}

/** How many cells of each glyph the character's grid holds. */
export function glyphCounts(tokenId: number): Map<string, number> {
  const counts = new Map<string, number>();
  for (const line of portrait(tokenId)) {
    for (const ch of Array.from(line)) if (ch !== " ") counts.set(ch, (counts.get(ch) ?? 0) + 1);
  }
  return counts;
}

/** The glyphs a character owns, in ramp order: every symbol its grid is drawn with. */
export function speakable(tokenId: number): string[] {
  const counts = glyphCounts(tokenId);
  return RAMP.filter((glyph) => counts.has(glyph));
}

/** A deterministic short phrase from a character's own glyphs. */
export function phrase(tokenId: number, n: number, salt: number): string {
  const glyphs = speakable(tokenId);
  if (glyphs.length === 0) return "█";
  const rnd = mulberry32((tokenId * 131 + salt * 17 + 9) >>> 0);
  let out = "";
  for (let i = 0; i < n; i++) out += glyphs[Math.floor(rnd() * glyphs.length)];
  return out;
}

/** The answer a character gives to a line: it maps the incoming glyphs onto its own set. */
export function answer(input: string, tokenId: number): string {
  const glyphs = speakable(tokenId);
  if (glyphs.length === 0) return "█";
  return Array.from(input)
    .map((ch, index) => glyphs[((ch.codePointAt(0) ?? 0) + index * 3) % glyphs.length])
    .join("");
}
