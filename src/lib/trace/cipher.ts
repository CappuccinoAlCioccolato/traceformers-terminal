import type { Dialect } from "./catalog";

const ORDER = " .:░▒▓█+-=|#%*/\\@─│└═";

function indexOfGlyph(ch: string): number {
  const i = ORDER.indexOf(ch);
  if (i >= 0) return i;
  return (ch.codePointAt(0) ?? 0) & 31;
}

export function encode(text: string, dialect: Dialect): string {
  if (dialect === "binary") {
    return Array.from(text)
      .map((ch) => indexOfGlyph(ch).toString(2).padStart(5, "0"))
      .join(" ");
  }
  if (dialect === "punched") {
    let h = 2166136261;
    for (const ch of Array.from(text)) {
      h ^= indexOfGlyph(ch) + 1;
      h = Math.imul(h, 16777619);
    }
    const len = 6 + (Math.abs(h) % 5);
    let out = "";
    for (let i = 0; i < len; i++) out += (h >>> i) & 1 ? "#" : ".";
    return out;
  }
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}
