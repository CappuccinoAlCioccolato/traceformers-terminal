import { keccak256, stringToHex, type Hex } from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { PIECES, piece, pieceId, type Role } from "@/lib/trace/catalog";
import { answer, mulberry32, phrase } from "@/lib/trace/portrait";
import { DOMAIN, idleSpec, lineCommit, openSpec, respondSpec, type TypedSpec } from "./domain";
import {
  BLOCK_MS,
  DRAW_MS,
  blockAt,
  cooling,
  eligibleIdle,
  expireDue,
  nextNonce,
  settleRipe,
  submitIdle,
  submitOpen,
  submitRespond,
  unix,
} from "./relayer";
import type { Conversation, Registry, Result } from "./types";

// Six holders that live in this registry. Their keys are derived from public labels: they are demo
// wallets, not secrets. Their signatures still go through the same EIP-712 checks as yours.

type Npc = { label: string; account: PrivateKeyAccount; pieces: string[] };

const HOLDERS: { label: string; characters: number[]; bases: number[]; encoders: number[] }[] = [
  { label: "North Atelier", characters: [2, 4], bases: [1, 6], encoders: [611, 123] },
  { label: "Glass House", characters: [5, 7], bases: [3, 8], encoders: [149] },
  { label: "Hem Workshop", characters: [9, 12], bases: [10], encoders: [789, 125] },
  { label: "Salt Court", characters: [13, 14], bases: [11, 16], encoders: [150] },
  { label: "Mist Studio", characters: [15], bases: [17], encoders: [139] },
  { label: "Silt Fund", characters: [19], bases: [20], encoders: [163] },
];

export const NPCS: Npc[] = HOLDERS.map((holder) => ({
  label: holder.label,
  account: privateKeyToAccount(keccak256(stringToHex(`traceformers-terminal:demo-holder:${holder.label}`))),
  pieces: [
    ...holder.characters.map((id) => pieceId("character", id)),
    ...holder.bases.map((id) => pieceId("base", id)),
    ...holder.encoders.map((id) => pieceId("encoder", id)),
  ],
}));

const NPC_BY_ADDRESS = new Map(NPCS.map((npc) => [npc.account.address.toLowerCase(), npc]));

export function isNpc(address: string): boolean {
  return NPC_BY_ADDRESS.has(address.toLowerCase());
}

function npcFor(registry: Registry, assetId: string): Npc | undefined {
  const owner = registry.assets.find((asset) => asset.id === assetId)?.owner;
  return owner ? NPC_BY_ADDRESS.get(owner) : undefined;
}

async function sign(npc: Npc, spec: TypedSpec): Promise<Hex> {
  return npc.account.signTypedData({ domain: DOMAIN, types: spec.types, primaryType: spec.primaryType, message: spec.message } as never);
}

function held(registry: Registry, npc: Npc, role: Role, block: number): string[] {
  const address = npc.account.address.toLowerCase();
  return registry.assets
    .filter((asset) => asset.owner === address && asset.role === role && cooling(registry, asset.id, block) === 0)
    .map((asset) => asset.id);
}

function tokenOf(id: string): number {
  return piece(id)?.tokenId ?? 0;
}

// ---------------------------------------------------------------------------------------------------------
// Acts. Each one signs as the holder of the character and goes through the relayer.

async function npcIdle(registry: Registry, assetId: string, ms: number, opts: { maxUses?: number; expiry?: number; allowed?: string } = {}) {
  const npc = npcFor(registry, assetId);
  if (!npc) return;
  const message = {
    nft: assetId,
    role: piece(assetId)!.role,
    nonce: nextNonce(registry, assetId, "offer"),
    maxUses: opts.maxUses ?? 0,
    expiry: opts.expiry ?? 0,
    allowed: opts.allowed ?? "",
  };
  const signature = await sign(npc, idleSpec(message));
  await submitIdle(registry, { ...message, signature }, ms);
}

/** A network character opens a talk with one piece (targeted) or with both (complete). */
export async function npcOpen(registry: Registry, characterId: string, attachedIds: string[], minutes: number, ms: number, salt: number): Promise<Result> {
  const npc = npcFor(registry, characterId);
  if (!npc) return { ok: false, error: "Not a network character." };
  const plaintext = phrase(tokenOf(characterId), 3 + (salt % 3), salt);
  const message = {
    character: characterId,
    base: attachedIds.find((id) => piece(id)?.role === "base") ?? "",
    encoder: attachedIds.find((id) => piece(id)?.role === "encoder") ?? "",
    deadline: unix(ms) + minutes * 60,
    nonce: nextNonce(registry, characterId, "open"),
  };
  const signature = await sign(npc, openSpec({ ...message, line: lineCommit(plaintext) }));
  return submitOpen(registry, { ...message, plaintext, signature }, ms);
}

/** A network character answers an opening. `piece` fills the empty slot (own or idle), or "" for a draw or a complete talk. */
export async function npcRespond(registry: Registry, conversation: Conversation, responderId: string, pieceIdOrDraw: string, ms: number): Promise<Result> {
  const npc = npcFor(registry, responderId);
  if (!npc) return { ok: false, error: "Not a network character." };
  const opening = registry.lines.find((line) => line.convId === conversation.id && !line.replyTo);
  const plaintext = answer(opening?.plaintext ?? "█", tokenOf(responderId)).slice(0, 6);
  const empty: Role | null = conversation.baseId && conversation.encoderId ? null : conversation.baseId ? "encoder" : "base";
  const message = {
    openId: conversation.id,
    character: responderId,
    base: empty === "base" ? pieceIdOrDraw : "",
    encoder: empty === "encoder" ? pieceIdOrDraw : "",
  };
  const signature = await sign(npc, respondSpec({ ...message, line: lineCommit(plaintext) }));
  return submitRespond(registry, { ...message, plaintext, signature }, ms);
}

/**
 * Pick a network character, held by another wallet than the opener's, and the piece it brings.
 * A complete talk needs no piece. A targeted one prefers the responder's own piece, then an idle one, then a draw.
 */
export function chooseResponder(registry: Registry, conversation: Conversation, ms: number, rnd: () => number = Math.random) {
  const block = blockAt(registry, ms);
  const empty: Role | null = conversation.baseId && conversation.encoderId ? null : conversation.baseId ? "encoder" : "base";
  const taken = [conversation.characterId, conversation.baseId, conversation.encoderId].filter((id): id is string => Boolean(id));
  const candidates = NPCS.filter((npc) => npc.account.address.toLowerCase() !== conversation.opener)
    .flatMap((npc) => held(registry, npc, "character", block).map((id) => ({ npc, id })))
    .filter((item) => !taken.includes(item.id));
  if (!candidates.length) return null;
  const pick = candidates[Math.floor(rnd() * candidates.length)]!;
  if (!empty) return { responderId: pick.id, pieceId: "" };
  const own = held(registry, pick.npc, empty, block).filter((id) => !taken.includes(id));
  const pool = eligibleIdle(registry, empty, [...taken, pick.id], pick.id, ms);
  const roll = rnd();
  if (own.length && (roll < 0.6 || !pool.length)) return { responderId: pick.id, pieceId: own[Math.floor(rnd() * own.length)]! };
  if (pool.length && roll < 0.85) return { responderId: pick.id, pieceId: pool[Math.floor(rnd() * pool.length)]!.assetId };
  if (pool.length) return { responderId: pick.id, pieceId: "" };
  // Every own piece of that role is cooling and the pool is empty: try another holder next block.
  return null;
}

// ---------------------------------------------------------------------------------------------------------
// Genesis and the ambient loop.

export async function createGenesis(now: number): Promise<Registry> {
  const BACK = 60;
  const registry: Registry = {
    version: 1,
    epoch: now - BACK * BLOCK_MS,
    assets: PIECES.map((item) => ({ id: item.id, role: item.role, tokenId: item.tokenId, owner: "" })),
    idles: [],
    conversations: [],
    lines: [],
    closures: [],
    log: [],
    nonces: {},
    keys: [],
    cooldowns: {},
    labels: {},
    handles: {},
    links: [],
    grants: [],
    seq: 0,
    cursor: 0,
  };
  for (const npc of NPCS) {
    const address = npc.account.address.toLowerCase();
    registry.labels[address] = npc.label;
    for (const id of npc.pieces) {
      const asset = registry.assets.find((item) => item.id === id);
      if (asset) asset.owner = address;
    }
  }
  const at = (k: number) => registry.epoch + k * BLOCK_MS + 500;
  const conv = (id: string) => registry.conversations.find((item) => item.id === id)!;
  const open = async (k: number, character: number, pieces: [Role, number][], minutes = 60) => {
    const ids = pieces.map(([role, id]) => pieceId(role, id));
    const result = await npcOpen(registry, pieceId("character", character), ids, minutes, at(k), k);
    if (!result.ok) throw new Error(`genesis open: ${result.error}`);
    return conv(result.refId!);
  };
  const respond = async (k: number, conversation: Conversation, character: number, role: Role | null = null, attached = 0) => {
    const result = await npcRespond(registry, conversation, pieceId("character", character), role ? pieceId(role, attached) : "", at(k));
    if (!result.ok) throw new Error(`genesis respond: ${result.error}`);
  };

  await npcIdle(registry, "b-3", at(2));
  await npcIdle(registry, "e-125", at(2), { maxUses: 4 });
  await npcIdle(registry, "b-11", at(2), { allowed: "c-12,c-15" });
  await npcIdle(registry, "e-139", at(2));
  await npcIdle(registry, "b-20", at(2), { maxUses: 2 });
  await npcIdle(registry, "e-123", at(2), { expiry: 1893456000 });

  await respond(7, await open(6, 2, [["base", 1]]), 5, "encoder", 149);
  await respond(11, await open(10, 7, [["encoder", 149]]), 4, "base", 6);
  await respond(15, await open(14, 9, [["base", 10], ["encoder", 789]]), 14);
  await respond(19, await open(18, 13, [["base", 16]]), 15);
  await settleRipe(registry, at(19) + DRAW_MS + 1);
  await respond(25, await open(24, 19, [["encoder", 163]]), 12, "base", 3);
  await respond(29, await open(28, 2, [["encoder", 611]]), 14, "base", 11);
  await respond(33, await open(32, 15, [["base", 17], ["encoder", 139]]), 7);
  await respond(37, await open(36, 5, [["base", 8]]), 19, "encoder", 163);
  await respond(41, await open(40, 12, [["base", 10]]), 13, "encoder", 150);

  await open(BACK - 4, 4, [["base", 1]], 90);
  await open(BACK - 2, 19, [["encoder", 163]], 45);
  registry.cursor = blockAt(registry, now);
  return registry;
}

/** How long, in blocks, an opening waits before the network answers it. */
const ANSWER_AFTER = 3;

/** One block of network life: draw callbacks, new openings, and answers to every opening that waits. */
export async function ambient(registry: Registry, block: number, ms: number): Promise<void> {
  await settleRipe(registry, ms);
  const rnd = mulberry32(block * 997);
  const npcOpen_ = registry.conversations.filter((item) => item.status === "open" && isNpc(item.opener));

  if (block % 6 === 0 && npcOpen_.length < 3) {
    const npc = NPCS[Math.floor(rnd() * NPCS.length)]!;
    const characters = held(registry, npc, "character", block);
    const bases = held(registry, npc, "base", block);
    const encoders = held(registry, npc, "encoder", block);
    const complete = block % 18 === 0 && bases.length > 0 && encoders.length > 0;
    const role: Role = rnd() < 0.5 ? "base" : "encoder";
    const attached = complete
      ? [bases[Math.floor(rnd() * bases.length)]!, encoders[Math.floor(rnd() * encoders.length)]!]
      : (role === "base" ? bases : encoders).slice(0, 1);
    if (characters.length && attached.length) {
      await npcOpen(registry, characters[Math.floor(rnd() * characters.length)]!, attached, 20 + Math.floor(rnd() * 70), ms, block);
    }
  }

  // Every talk closes: the oldest opening that has waited long enough gets an answer, whoever opened it.
  const waiting = registry.conversations
    .filter((item) => item.status === "open" && !item.draw && block - item.openedBlock >= ANSWER_AFTER)
    .sort((a, b) => a.deadline - b.deadline);
  for (const target of waiting.slice(0, 2)) {
    const choice = chooseResponder(registry, target, ms, rnd);
    if (choice) await npcRespond(registry, target, choice.responderId, choice.pieceId, ms);
  }
  expireDue(registry, ms);

  // Keep the stored log bounded: the oldest closures and finished conversations fall off.
  if (registry.closures.length > 2000) registry.closures.splice(0, registry.closures.length - 2000);
  const finished = registry.conversations.filter((item) => item.status !== "open");
  if (finished.length > 240) {
    const drop = new Set(finished.slice(0, finished.length - 240).map((item) => item.id));
    registry.conversations = registry.conversations.filter((item) => !drop.has(item.id));
    registry.lines = registry.lines.filter((line) => !drop.has(line.convId));
  }
}
