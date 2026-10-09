import { padId, piece } from "@/lib/trace/catalog";
import { shortAddress } from "@/lib/protocol/domain";
import type { Closure, Conversation, Registry } from "@/lib/protocol/types";

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

type Part = { role: string; id: string };

/**
 * The post for a talk. Each holder appears once, tagged with @ when an X username is known for its
 * address, followed by the pieces it brought. Optional words fall away until the post fits 280.
 */
export function buildPost(registry: Registry, conversation: Conversation, closure: Closure | undefined, url = siteUrl()): string {
  const parts: Part[] = [{ role: "opens", id: conversation.characterId }];
  if (conversation.responderId) parts.push({ role: "answers", id: conversation.responderId });
  if (conversation.baseId) parts.push({ role: "base", id: conversation.baseId });
  if (conversation.encoderId) parts.push({ role: "encoder", id: conversation.encoderId });

  const holderOf = (id: string) => (closure ? walletIn(closure, id) : null) ?? registry.assets.find((asset) => asset.id === id)?.owner ?? "";
  const groups = new Map<string, Part[]>();
  for (const part of parts) {
    const holder = holderOf(part.id);
    groups.set(holder, [...(groups.get(holder) ?? []), part]);
  }

  const who = (address: string, plain: boolean) => {
    const handle = registry.handles[address];
    if (handle) return `@${handle}`;
    if (plain) return "";
    return registry.labels[address] ?? shortAddress(address);
  };

  const state =
    conversation.status === "closed"
      ? conversation.kind === "complete"
        ? "A complete talk closed"
        : "A talk closed"
      : conversation.status === "expired"
        ? "A talk expired"
        : "A talk is open";
  const points = closure ? ` · ${closure.pointsInitiator}/${closure.pointsResponder}/${closure.pointsBase}/${closure.pointsEncoder} pts` : "";

  const attempts = [
    { head: `${state} on Traceformers Terminal${points}`, short: false, plain: false },
    { head: `${state} on Traceformers Terminal`, short: false, plain: false },
    { head: `${state} on Traceformers Terminal`, short: true, plain: false },
    { head: "Traceformers Terminal", short: true, plain: true },
  ];
  let post = "";
  for (const attempt of attempts) {
    const lines = [...groups.entries()].map(([address, items]) => {
      const pieces = items.map((item) => `${attempt.short ? item.role[0] : item.role} ${padId(piece(item.id)?.tokenId ?? 0)}`).join(", ");
      const name = who(address, attempt.plain);
      return name ? `${name}: ${pieces}` : pieces;
    });
    post = [attempt.head, ...lines, url].join("\n");
    if (postLength(post, [url]) <= POST_LIMIT) return post;
  }
  return post;
}

function walletIn(closure: Closure, id: string): string | null {
  if (closure.initiatorId === id) return closure.initiatorWallet;
  if (closure.responderId === id) return closure.responderWallet;
  if (closure.baseId === id) return closure.baseWallet;
  if (closure.encoderId === id) return closure.encoderWallet;
  return null;
}

export function intentUrl(text: string): string {
  return `https://x.com/intent/post?text=${encodeURIComponent(text)}`;
}
