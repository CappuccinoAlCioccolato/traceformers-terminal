import { padId, piece } from "@/lib/trace/catalog";
import { decayed, dialectMark, formMark, visualCipher } from "@/lib/trace/marks";
import type { Closure, Conversation, Line, Registry } from "@/lib/protocol/types";

const WIDTH = 760;
const PAD = 32;
const FIELD = "#0a0a0a";
const INK = "#f0f0f0";
const MUTED = "#b4b4b4";
const DIM = "#949494";
const LINE = "#262626";
const ACCENT = "#f8037c";
const CYAN = "#96feff";
const PAPER = "#ededed";

function tok(id: string | null): string {
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

function holderOf(registry: Registry, closure: Closure | undefined, id: string): string {
  let address = registry.assets.find((asset) => asset.id === id)?.owner ?? "";
  if (closure) {
    if (closure.initiatorId === id) address = closure.initiatorWallet;
    else if (closure.responderId === id && closure.responderWallet) address = closure.responderWallet;
    else if (closure.baseId === id) address = closure.baseWallet;
    else if (closure.encoderId === id) address = closure.encoderWallet;
  }
  if (!address) return "";
  const handle = registry.handles[address];
  if (handle) return `@${handle}`;
  return registry.labels[address] ?? `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/** Export the talk as a PNG: the four pieces with their art, who answered which #, and the encoded lines. */
export async function exportTalkPng(registry: Registry, conversation: Conversation, lines: Line[], readable: Set<string>, block: number): Promise<void> {
  await document.fonts.load("16px 'IBM Plex Mono'");
  const closure = registry.closures.find((item) => item.id === conversation.closureId);
  const base = conversation.baseId ? piece(conversation.baseId) : undefined;
  const slots = [
    { role: "opens", id: conversation.characterId },
    { role: "answers", id: conversation.responderId },
    { role: "base", id: conversation.baseId },
    { role: "encoder", id: conversation.encoderId },
  ];
  const images = await Promise.all(slots.map((slot) => (slot.id && piece(slot.id) ? loadImage(piece(slot.id)!.image) : Promise.resolve(null))));

  const tile = (WIDTH - PAD * 2 - 3 * 16) / 4;
  const castTop = 100;
  const castHeight = 22 + tile + 48;
  const header = castTop + castHeight + 24;
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
  const state =
    conversation.status === "closed" && closure
      ? `closed · block ${closure.block} · ${conversation.kind} · ${closure.pointsInitiator}/${closure.pointsResponder}/${closure.pointsBase}/${closure.pointsEncoder} pts`
      : conversation.status === "expired"
        ? "expired · 0 points"
        : "open · waiting for an answer";
  text(state, PAD, 66, conversation.status === "closed" ? ACCENT : DIM, 14);

  slots.forEach((slot, index) => {
    const x = PAD + index * (tile + 16);
    const art = slot.id ? piece(slot.id) : undefined;
    text(slot.role, x, castTop + 12, DIM, 12);
    const top = castTop + 22;
    if (art && images[index]) {
      ctx.fillStyle = PAPER;
      ctx.fillRect(x, top, tile, tile);
      ctx.drawImage(images[index]!, x, top, tile, tile);
    } else {
      ctx.strokeStyle = LINE;
      ctx.setLineDash([3, 4]);
      ctx.strokeRect(x + 0.5, top + 0.5, tile - 1, tile - 1);
      ctx.setLineDash([]);
      text(slot.role === "answers" && conversation.kind === "complete" ? "complete" : "empty", x + 10, top + tile / 2 + 5, DIM, 12);
    }
    if (art) {
      const mark = art.dialect ? dialectMark(art.dialect) : art.form ? formMark(art.form) : "";
      const color = art.dialect === "binary" || art.form === "inverted" ? CYAN : art.dialect === "punched" || art.form === "blink" ? ACCENT : INK;
      text(fit(`${padId(art.tokenId)} ${mark}`, tile, 13), x, top + tile + 18, color, 13);
      text(fit(holderOf(registry, closure, art.id), tile, 12), x, top + tile + 36, MUTED, 12);
    }
  });

  ctx.fillStyle = LINE;
  ctx.fillRect(PAD, header - 14, WIDTH - PAD * 2, 1);

  const byId = new Map(lines.map((line) => [line.id, line]));
  lines.forEach((line, index) => {
    const y = header + 16 + index * step;
    const parent = line.replyTo ? byId.get(line.replyTo) : undefined;
    text(tok(line.speakerId), PAD, y, ACCENT);
    text(parent ? `answers ${tok(parent.speakerId)}` : "spoke", PAD + 100, y, MUTED);
    text(`block ${line.block}`, WIDTH - PAD - 150, y, DIM, 14);
    text(line.dialect ? `${line.dialect} via encoder ${tok(conversation.encoderId)}` : "no encoder yet", PAD, y + 24, DIM, 14);
    const gone = base?.form === "blink" && block > line.block + 1;
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
