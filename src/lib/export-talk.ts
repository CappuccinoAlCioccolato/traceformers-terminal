import { padId, piece } from "@/lib/trace/catalog";
import { decayed, dialectMark, formMark, visualCipher } from "@/lib/trace/marks";
import { broughtBy } from "@/lib/protocol/derive";
import { SIDES, SLOTS, type Conversation, type Line, type Registry } from "@/lib/protocol/types";

const WIDTH = 760;
const PAD = 32;
const GAP = 16;
const TILE = 132;
const FIELD = "#0a0a0a";
const INK = "#f0f0f0";
const MUTED = "#b4b4b4";
const DIM = "#949494";
const LINE = "#262626";
const ACCENT = "#f8037c";
const CYAN = "#96feff";
const PAPER = "#ededed";

function tok(id: string | null | undefined): string {
  const art = id ? piece(id) : undefined;
  return art ? padId(art.tokenId) : "#····";
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = src;
  });
}

function holderName(registry: Registry, address: string): string {
  if (!address) return "";
  const handle = registry.handles[address];
  if (handle) return `@${handle}`;
  return registry.labels[address] ?? `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/** Export the talk as a PNG: both sides with their art and who seated each piece, then the encoded lines. */
export async function exportTalkPng(registry: Registry, conversation: Conversation, lines: Line[], readable: Set<string>, block: number): Promise<void> {
  await document.fonts.load("16px 'IBM Plex Mono'");
  const closure = registry.closures.find((item) => item.id === conversation.closureId);
  const seats = SIDES.flatMap((side) => SLOTS.map((slot) => ({ side, slot, seat: conversation[side][slot] })));
  const images = await Promise.all(seats.map(({ seat }) => (seat && piece(seat.id) ? loadImage(piece(seat.id)!.image) : Promise.resolve(null))));

  const rowHeight = 22 + TILE + 66;
  const castTop = 92;
  const header = castTop + rowHeight * 2 + 24;
  const step = 96;
  const height = header + lines.length * step + 44;
  const canvas = document.createElement("canvas");
  canvas.width = WIDTH * 2;
  canvas.height = height * 2;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.scale(2, 2);
  ctx.fillStyle = FIELD;
  ctx.fillRect(0, 0, WIDTH, height);
  const text = (value: string, x: number, y: number, color: string, size = 16) => {
    ctx.font = `${size}px 'IBM Plex Mono', Courier, monospace`;
    ctx.fillStyle = color;
    ctx.fillText(value, x, y);
  };
  const fit = (value: string, max: number, size: number) => {
    ctx.font = `${size}px 'IBM Plex Mono', Courier, monospace`;
    let out = value;
    while (out.length > 1 && ctx.measureText(out).width > max) out = out.slice(0, -1);
    return out === value ? value : `${out.slice(0, -1)}…`;
  };

  text("traceformers@terminal:~$ talk", PAD, 38, CYAN);
  const state = conversation.status === "closed" && closure ? `closed at block ${closure.block}` : conversation.status === "expired" ? "expired" : "open · seats still waiting";
  text(`${state} · ${conversation.dialect ?? "no dialect yet"}`, PAD, 64, conversation.status === "closed" ? ACCENT : DIM, 14);

  seats.forEach(({ side, slot, seat }, index) => {
    const row = side === "talk" ? 0 : 1;
    const column = SLOTS.indexOf(slot);
    const x = PAD + 92 + column * (TILE + GAP);
    const top = castTop + row * rowHeight;
    if (column === 0) text(side, PAD, top + 22 + TILE / 2, side === "talk" ? CYAN : ACCENT, 14);
    text(slot, x, top + 12, DIM, 12);
    const art = seat ? piece(seat.id) : undefined;
    const tileTop = top + 22;
    if (art && images[index]) {
      ctx.fillStyle = PAPER;
      ctx.fillRect(x, tileTop, TILE, TILE);
      ctx.drawImage(images[index]!, x, tileTop, TILE, TILE);
    } else {
      ctx.strokeStyle = LINE;
      ctx.setLineDash([3, 4]);
      ctx.strokeRect(x + 0.5, tileTop + 0.5, TILE - 1, TILE - 1);
      ctx.setLineDash([]);
      text("empty seat", x + 10, tileTop + TILE / 2 + 5, DIM, 12);
    }
    if (art && seat) {
      const mark = art.dialect ? dialectMark(art.dialect) : art.form ? formMark(art.form) : "";
      const color = art.dialect === "binary" || art.form === "inverted" ? CYAN : art.dialect === "punched" || art.form === "blink" ? ACCENT : INK;
      text(fit(`${padId(art.tokenId)} ${mark}`, TILE, 13), x, tileTop + TILE + 18, color, 13);
      text(fit(holderName(registry, closure ? closure.wallets[side][slot] : seat.holder), TILE, 12), x, tileTop + TILE + 36, MUTED, 12);
      const by = broughtBy(conversation, side, slot);
      if (by) text(fit(by, TILE, 11), x, tileTop + TILE + 54, DIM, 11);
    }
  });

  ctx.fillStyle = LINE;
  ctx.fillRect(PAD, header - 14, WIDTH - PAD * 2, 1);

  const byId = new Map(lines.map((line) => [line.id, line]));
  lines.forEach((line, index) => {
    const y = header + 16 + index * step;
    const parent = line.replyTo ? byId.get(line.replyTo) : undefined;
    const encoderId = conversation[line.side].encoder?.id;
    text(tok(line.speakerId), PAD, y, ACCENT);
    text(parent ? `answers ${tok(parent.speakerId)}` : "talks", PAD + 100, y, MUTED);
    text(`block ${line.block}`, WIDTH - PAD - 150, y, DIM, 14);
    text(line.dialect ? `${line.dialect} via encoder ${tok(encoderId)}` : "no encoder yet", PAD, y + 24, DIM, 14);
    const gone = piece(conversation[line.side].base?.id ?? "")?.form === "blink" && block > line.block + 1;
    const cipher = !line.ciphertext || !line.dialect ? "· · ·" : gone ? decayed(line.ciphertext) : visualCipher(line.dialect, line.ciphertext);
    text(cipher.slice(0, 64), PAD, y + 48, line.dialect === "binary" ? CYAN : line.dialect === "punched" ? ACCENT : MUTED);
    if (readable.has(line.id)) text(line.plaintext, PAD, y + 72, INK);
  });
  text("traceformers terminal · unofficial · trace by 0xvesty", PAD, height - 20, DIM, 12);

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) return;
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `talk-${lines.map((line) => piece(line.speakerId)?.tokenId ?? "x").join("-")}.png`;
  link.click();
  URL.revokeObjectURL(url);
}
