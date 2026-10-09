import { padId, piece } from "@/lib/trace/catalog";
import { decayed, dialectMark, formMark, visualCipher } from "@/lib/trace/marks";
import type { Conversation, Line, Registry } from "@/lib/protocol/types";

const WIDTH = 760;
const FIELD = "#0a0a0a";
const INK = "#f0f0f0";
const MUTED = "#b4b4b4";
const DIM = "#949494";
const ACCENT = "#f8037c";
const CYAN = "#96feff";

function tok(id: string | null): string {
  const art = id ? piece(id) : undefined;
  return art ? padId(art.tokenId) : "#····";
}

/** Export the talk as a PNG: who spoke, who answered which #, and the pieces used to encode it. */
export async function exportTalkPng(registry: Registry, conversation: Conversation, lines: Line[], readable: Set<string>, block: number): Promise<void> {
  await document.fonts.load("16px 'IBM Plex Mono'");
  const closure = registry.closures.find((item) => item.id === conversation.closureId);
  const base = conversation.baseId ? piece(conversation.baseId) : undefined;
  const encoder = conversation.encoderId ? piece(conversation.encoderId) : undefined;
  const header = 196;
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
  ctx.font = "16px 'IBM Plex Mono', Courier, monospace";
  const text = (value: string, x: number, y: number, color: string) => {
    ctx.fillStyle = color;
    ctx.fillText(value, x, y);
  };

  text("traceformers@terminal:~$ talk", 32, 38, CYAN);
  text(conversation.id, 360, 38, DIM);
  text(`opens    ${tok(conversation.characterId)}  character`, 32, 70, INK);
  text(`answers  ${conversation.responderId ? `${tok(conversation.responderId)}  character` : conversation.kind === "complete" ? "complete offer" : "waiting"}`, 32, 94, INK);
  text(`base     ${tok(conversation.baseId)}  ${base?.form ? `${base.form} ${formMark(base.form)}` : "empty slot"}`, 32, 118, MUTED);
  text(`encoder  ${tok(conversation.encoderId)}  ${encoder?.dialect ? `${encoder.dialect} ${dialectMark(encoder.dialect)}` : "empty slot"}`, 32, 142, MUTED);
  const state =
    conversation.status === "closed" && closure
      ? `closed · block ${closure.block} · ${closure.pointsInitiator}/${closure.pointsResponder}/${closure.pointsBase}/${closure.pointsEncoder} pts`
      : conversation.status;
  text(`state    ${state}`, 32, 166, conversation.status === "closed" ? ACCENT : DIM);

  const byId = new Map(lines.map((line) => [line.id, line]));
  lines.forEach((line, index) => {
    const y = header + 16 + index * step;
    const parent = line.replyTo ? byId.get(line.replyTo) : undefined;
    text(tok(line.speakerId), 32, y, ACCENT);
    text(parent ? `answers ${tok(parent.speakerId)}` : "spoke", 132, y, MUTED);
    text(`block ${line.block}`, 560, y, DIM);
    text(line.dialect ? `encoder ${tok(conversation.encoderId)}  ${line.dialect}` : "no encoder yet", 32, y + 24, DIM);
    const gone = base?.form === "blink" && block > line.block + 1;
    const cipher = !line.ciphertext || !line.dialect ? "· · ·" : gone ? decayed(line.ciphertext) : visualCipher(line.dialect, line.ciphertext);
    text(cipher.slice(0, 64), 32, y + 48, line.dialect === "binary" ? CYAN : line.dialect === "punched" ? ACCENT : MUTED);
    if (readable.has(line.id)) text(line.plaintext, 32, y + 72, INK);
  });
  text("traceformers terminal · unofficial · trace by 0xvesty", 32, height - 20, DIM);

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) return;
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `talk-${lines.map((line) => piece(line.speakerId)?.tokenId ?? "x").join("-")}.png`;
  link.click();
  URL.revokeObjectURL(url);
}
