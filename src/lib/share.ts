import { padId, piece } from "@/lib/trace/catalog";
import { shortAddress } from "@/lib/protocol/domain";
import { SIDES, SLOTS, type Closure, type Conversation, type Registry } from "@/lib/protocol/types";

export const POST_LIMIT = 280;
const URL_WEIGHT = 23;

/** X counts most Latin text as 1 and everything else (box drawing, CJK, emoji) as 2; any URL counts 23. */
export function postLength(text: string, urls: string[] = []): number {
  let rest = text;
  let weight = 0;
  for (const url of urls) {
    if (!rest.includes(url)) continue;
    rest = rest.replace(url, "");
    weight += URL_WEIGHT;
  }
  for (const ch of rest) {
    const code = ch.codePointAt(0) ?? 0;
    const light = code <= 4351 || (code >= 8192 && code <= 8205) || (code >= 8208 && code <= 8223) || (code >= 8242 && code <= 8247);
    weight += light ? 1 : 2;
  }
  return weight;
}

export function siteUrl(): string {
  return `${window.location.origin}${import.meta.env.BASE_URL}`;
}

type Part = { label: string; short: string; id: string; holder: string };

/**
 * The post for a talk. Each holder appears once, tagged with @ when an X username is known for its
 * address, followed by the seats it took. Optional words fall away until the post fits 280.
 */
export function buildPost(registry: Registry, conversation: Conversation, closure: Closure | undefined, url = siteUrl()): string {
  const parts: Part[] = [];
  for (const side of SIDES) {
    for (const slot of SLOTS) {
      const seat = conversation[side][slot];
      if (!seat) continue;
      const holder = closure ? closure.wallets[side][slot] : seat.holder;
      const label = slot === "character" ? (side === "talk" ? "talks" : "answers") : `${side} ${slot}`;
      const short = slot === "character" ? (side === "talk" ? "t" : "a") : `${side[0]}${slot[0]}`;
      parts.push({ label, short, id: seat.id, holder });
    }
  }
  const groups = new Map<string, Part[]>();
  for (const part of parts) groups.set(part.holder, [...(groups.get(part.holder) ?? []), part]);

  const who = (address: string, plain: boolean) => {
    const handle = registry.handles[address];
    if (handle) return `@${handle}`;
    if (plain) return "";
    return registry.labels[address] ?? shortAddress(address);
  };
  const state = conversation.status === "closed" ? "A talk closed" : conversation.status === "expired" ? "A talk expired" : "A talk is open";

  const attempts = [
    { head: `${state} on Traceformers Terminal`, short: false, plain: false },
    { head: `${state} on Traceformers Terminal`, short: true, plain: false },
    { head: "Traceformers Terminal", short: true, plain: true },
  ];
  let post = "";
  for (const attempt of attempts) {
    const lines = [...groups.entries()].map(([address, items]) => {
      const pieces = items.map((item) => `${attempt.short ? item.short : item.label} ${padId(piece(item.id)?.tokenId ?? 0)}`).join(", ");
      const name = who(address, attempt.plain);
      return name ? `${name}: ${pieces}` : pieces;
    });
    post = [attempt.head, ...lines, url].join("\n");
    if (postLength(post, [url]) <= POST_LIMIT) return post;
  }
  return post;
}

export function intentUrl(text: string): string {
  return `https://x.com/intent/post?text=${encodeURIComponent(text)}`;
}
