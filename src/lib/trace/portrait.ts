import { piece, pieceId, traitOf, type Piece } from "./catalog";

// A 35×21 symbol grid per character. The bust is seeded by the tokenId and dressed by its real traits,
// so the glyphs a character can speak come from what it wears.
const COLS = 35;
const ROWS = 21;
const RAMP = [" ", ".", ":", "░", "▒", "▓", "█"] as const;

const cache = new Map<number, string[]>();

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

function put(cells: string[][], rawX: number, rawY: number, ch: string) {
  const x = Math.round(rawX);
  const y = Math.round(rawY);
  if (y < 0 || y >= ROWS || x < 0 || x >= COLS) return;
  cells[y][x] = ch;
}

function has(target: Piece | undefined, type: string, ...words: string[]): boolean {
  if (!target) return false;
  const value = traitOf(target, type).toLowerCase();
  if (!value) return false;
  return words.length === 0 || words.some((word) => value.includes(word));
}

function bust(tokenId: number): string[] {
  const rnd = mulberry32((tokenId * 2654435761) >>> 0);
  const dressed = piece(pieceId("character", tokenId));
  const cells = Array.from({ length: ROWS }, () => Array<string>(COLS).fill(" "));

  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      if (rnd() < 0.035) cells[y][x] = rnd() < 0.7 ? "." : ":";
    }
  }

  const cx = 16 + Math.floor(rnd() * 3);
  const cy = 7 + Math.floor(rnd() * 2);
  const rx = 7 + Math.floor(rnd() * 2);
  const ry = 6 + Math.floor(rnd() * 2);
  const light = rnd() < 0.5 ? -1 : 1;

  // Back: an object behind the shoulders.
  if (has(dressed, "Back")) {
    const mark = has(dressed, "Back", "blade", "staff", "driver", "ski") ? "/" : has(dressed, "Back", "bat") ? "^" : "\\";
    for (let i = 0; i < 12; i++) put(cells, cx - rx - 2 + i, cy + 6 - i, mark);
  }

  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      const nx = (x - cx) / rx;
      const ny = (y - cy) / ry;
      const d = nx * nx + ny * ny;
      if (d > 1) continue;
      const lit = 0.5 + 0.5 * light * nx;
      let level = 2 + Math.round((0.25 + 0.75 * lit) * 3);
      if (d > 0.78) level -= 2;
      if (d < 0.18) level += 1;
      level = Math.max(1, Math.min(6, level));
      cells[y][x] = RAMP[level];
    }
  }

  const shoulder = cy + ry - 1;
  const body = has(dressed, "Body", "suit", "blazer", "collar", "turtleneck") ? "▓" : has(dressed, "Body", "striped") ? "=" : "▒";
  for (let y = shoulder; y < Math.min(ROWS - 1, shoulder + 7); y++) {
    const t = (y - shoulder) / 6;
    const half = Math.min(16, Math.floor(rx * 0.55 + t * 11));
    for (let x = cx - half; x <= cx + half; x++) {
      if (y < 0 || y >= ROWS || x < 1 || x >= COLS - 1) continue;
      const edge = Math.abs(x - cx) >= half - 1;
      const spine = Math.abs(x - cx) <= 1;
      cells[y][x] = edge ? "░" : spine ? "▓" : body === "=" && y % 2 === 0 ? "=" : body;
    }
  }
  if (has(dressed, "Body", "chain")) {
    for (let i = -3; i <= 3; i++) put(cells, cx + i, shoulder + 1 + Math.abs(i) / 3, "o");
  }

  // Headwear: a cap over the skull.
  if (has(dressed, "Headwear") && !has(dressed, "Headwear", "bald")) {
    const top = cy - ry;
    const cap = has(dressed, "Headwear", "helmet", "headset") ? "█" : has(dressed, "Headwear", "brim") ? "▀" : "#";
    for (let y = top; y <= top + 2; y++) {
      for (let x = cx - rx + 1; x <= cx + rx - 1; x++) put(cells, x, y, cap);
    }
    if (has(dressed, "Headwear", "brim")) for (let x = cx - rx - 2; x <= cx + rx + 2; x++) put(cells, x, top + 3, "─");
  }

  const ey = cy - 1;
  const gap = 3;
  if (has(dressed, "Eyewear")) {
    const lens = has(dressed, "Eyewear", "eyepatch") ? "●" : has(dressed, "Eyewear", "shutter") ? "≡" : "■";
    for (let x = cx - gap - 1; x <= cx + gap + 1; x++) put(cells, x, ey, x === cx ? "─" : lens);
  } else {
    const eye = has(dressed, "Features", "closed", "blank") ? "─" : "█";
    for (const sx of [-1, 1]) {
      put(cells, cx + sx * gap, ey, eye);
      put(cells, cx + sx * gap, ey - 1, "▓");
    }
  }
  put(cells, cx, cy + 1, "|");

  const my = Math.min(ROWS - 2, cy + 3);
  if (has(dressed, "Mask")) {
    for (let y = cy + 1; y <= my + 1; y++) for (let x = cx - 4; x <= cx + 4; x++) put(cells, x, y, "*");
  }
  const mw = 1 + Math.floor(rnd() * 2);
  const lip = has(dressed, "Features", "grin") ? "‿" : has(dressed, "Features", "scowl") ? "^" : "─";
  for (let i = -mw; i <= mw; i++) put(cells, cx + i, my, lip);
  if (has(dressed, "Features", "cigarette", "pipe")) {
    put(cells, cx + mw + 1, my, "=");
    put(cells, cx + mw + 2, my - 1, "~");
  }
  if (has(dressed, "Features", "beard", "goatee", "chinstrap", "handlebar")) {
    for (let i = -mw - 1; i <= mw + 1; i++) put(cells, cx + i, my + 1, ":");
  }

  if (rnd() > 0.45) {
    put(cells, cx - rx + 1, cy - 2, "+");
    put(cells, cx + rx - 1, cy + 1, "+");
  }

  return cells.map((row) => row.join("").padEnd(COLS, " ").slice(0, COLS));
}

export function portrait(tokenId: number): string[] {
  const hit = cache.get(tokenId);
  if (hit) return hit;
  const lines = bust(tokenId);
  cache.set(tokenId, lines);
  return lines;
}

/** The glyphs a character owns: every non-blank symbol in its grid. */
export function speakable(tokenId: number): string[] {
  const seen = new Set<string>();
  for (const line of portrait(tokenId)) {
    for (const ch of Array.from(line)) {
      if (ch !== " ") seen.add(ch);
    }
  }
  return [...seen];
}

/** First glyphs of the grid, used as a compact signature of the character. */
export function signature(tokenId: number): string {
  return speakable(tokenId).slice(0, 4).join("") || "█";
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
