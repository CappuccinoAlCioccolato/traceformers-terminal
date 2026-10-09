import { keccak256, stringToHex, type Hex } from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { PIECES, piece, pieceId, type Role } from "@/lib/trace/catalog";
import { answer, mulberry32, phrase } from "@/lib/trace/portrait";
import { DOMAIN, completeSpec, idleSpec, lineCommit, openSpec, respondSpec, type TypedSpec } from "./domain";
import {
  BLOCK_MS,
  DRAW_MS,
  blockAt,
  cooling,
  eligibleIdle,
  expireDue,
  nextNonce,
  settleRipe,
  submitComplete,
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

async function npcIdle(registry: Registry, assetId: string, ms: number, opts: { maxUses?: number; expiry?: number; excluded?: string } = {}) {
  const npc = npcFor(registry, assetId);
  if (!npc) return;
  const message = {
    nft: assetId,
    role: piece(assetId)!.role,
    nonce: nextNonce(registry, assetId, "offer"),
    maxUses: opts.maxUses ?? 0,
    expiry: opts.expiry ?? 0,
    excluded: opts.excluded ?? "",
  };
  const signature = await sign(npc, idleSpec(message));
  await submitIdle(registry, { ...message, signature }, ms);
}

export async function npcOpen(registry: Registry, characterId: string, attachedId: string, minutes: number, ms: number, salt: number): Promise<Result> {
  const npc = npcFor(registry, characterId);
  if (!npc) return { ok: false, error: "Not a network character." };
  const role = piece(attachedId)!.role;
  const plaintext = phrase(tokenOf(characterId), 3 + (salt % 3), salt);
  const message = {
    character: characterId,
    base: role === "base" ? attachedId : "",
    encoder: role === "encoder" ? attachedId : "",
    deadline: unix(ms) + minutes * 60,
    nonce: nextNonce(registry, characterId, "open"),
  };
  const signature = await sign(npc, openSpec({ ...message, line: lineCommit(plaintext) }));
  return submitOpen(registry, { ...message, plaintext, signature }, ms);
}

/** A network character answers an opening. `piece` is an own or idle piece, or "" to ask the relayer to draw. */
export async function npcRespond(registry: Registry, conversation: Conversation, responderId: string, pieceIdOrDraw: string, ms: number): Promise<Result> {
  const npc = npcFor(registry, responderId);
  if (!npc) return { ok: false, error: "Not a network character." };
  const opening = registry.lines.find((line) => line.convId === conversation.id && !line.replyTo);
  const plaintext = answer(opening?.plaintext ?? "█", tokenOf(responderId)).slice(0, 6);
  const empty: Role = conversation.baseId ? "encoder" : "base";
  const message = {
    openId: conversation.id,
    character: responderId,
    base: empty === "base" ? pieceIdOrDraw : "",
    encoder: empty === "encoder" ? pieceIdOrDraw : "",
  };
  const signature = await sign(npc, respondSpec({ ...message, line: lineCommit(plaintext) }));
  return submitRespond(registry, { ...message, plaintext, signature }, ms);
}

async function npcComplete(registry: Registry, characterId: string, baseId: string, encoderId: string, ms: number, salt: number): Promise<Result> {
  const npc = npcFor(registry, characterId);
  if (!npc) return { ok: false, error: "Not a network character." };
  const plaintext = phrase(tokenOf(characterId), 3 + (salt % 3), salt);
  const message = { character: characterId, base: baseId, encoder: encoderId, nonce: nextNonce(registry, characterId, "complete") };
  const signature = await sign(npc, completeSpec({ ...message, line: lineCommit(plaintext) }));
  return submitComplete(registry, { ...message, plaintext, signature }, ms);
}

/** Pick a network character and a piece for an opening, the way a holder would. */
export function chooseResponder(registry: Registry, conversation: Conversation, ms: number, rnd: () => number = Math.random) {
  const block = blockAt(registry, ms);
  const empty: Role = conversation.baseId ? "encoder" : "base";
  const taken = [conversation.characterId, conversation.baseId, conversation.encoderId].filter((id): id is string => Boolean(id));
  const candidates = NPCS.flatMap((npc) => held(registry, npc, "character", block).map((id) => ({ npc, id }))).filter(
    (item) => !taken.includes(item.id),
  );
  if (!candidates.length) return null;
  const pick = candidates[Math.floor(rnd() * candidates.length)]!;
  const own = held(registry, pick.npc, empty, block).filter((id) => !taken.includes(id));
  const pool = eligibleIdle(registry, empty, [...taken, pick.id], [conversation.characterId, pick.id], ms);
  const roll = rnd();
  if (own.length && (roll < 0.55 || !pool.length)) return { responderId: pick.id, pieceId: own[Math.floor(rnd() * own.length)]! };
  if (pool.length && roll < 0.8) return { responderId: pick.id, pieceId: pool[Math.floor(rnd() * pool.length)]!.assetId };
  if (pool.length) return { responderId: pick.id, pieceId: "" };
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
  const open = async (k: number, character: number, role: Role, attached: number, minutes = 60) => {
    const result = await npcOpen(registry, pieceId("character", character), pieceId(role, attached), minutes, at(k), k);
    if (!result.ok) throw new Error(`genesis open: ${result.error}`);
    return conv(result.refId!);
  };
  const respond = async (k: number, conversation: Conversation, character: number, role: Role | null, attached = 0) => {
    const result = await npcRespond(registry, conversation, pieceId("character", character), role ? pieceId(role, attached) : "", at(k));
    if (!result.ok) throw new Error(`genesis respond: ${result.error}`);
  };

  await npcIdle(registry, "b-3", at(2));
  await npcIdle(registry, "e-125", at(2), { maxUses: 4 });
  await npcIdle(registry, "b-11", at(2), { excluded: "c-2" });
  await npcIdle(registry, "e-139", at(2));
  await npcIdle(registry, "b-20", at(2), { maxUses: 2 });
  await npcIdle(registry, "e-123", at(2), { expiry: 1893456000 });

  await respond(7, await open(6, 2, "base", 1), 5, "encoder", 149);
  await respond(11, await open(10, 7, "encoder", 149), 4, "base", 6);
  await npcComplete(registry, "c-9", "b-10", "e-789", at(14), 14);
  await respond(19, await open(18, 13, "base", 16), 15, null);
  await settleRipe(registry, at(19) + DRAW_MS + 1);
  await respond(25, await open(24, 19, "encoder", 163), 12, "base", 3);
  await respond(29, await open(28, 2, "encoder", 611), 14, "base", 11);
  await npcComplete(registry, "c-15", "b-17", "e-125", at(32), 32);
  await open(36, 5, "base", 8, 3);
  await respond(41, await open(40, 12, "base", 10), 13, "encoder", 150);

  await open(BACK - 4, 4, "base", 1, 90);
  await open(BACK - 2, 19, "encoder", 163, 45);
  registry.cursor = blockAt(registry, now);
  return registry;
}

/** One block of network life: expiries, draw callbacks, and a few holders talking. */
export async function ambient(registry: Registry, block: number, ms: number): Promise<void> {
  expireDue(registry, ms);
  await settleRipe(registry, ms);
  const rnd = mulberry32(block * 997);
  const npcOpen_ = registry.conversations.filter((item) => item.status === "open" && isNpc(item.opener) && !item.draw);

  if (block % 6 === 0 && npcOpen_.length < 3) {
    const npc = NPCS[Math.floor(rnd() * NPCS.length)]!;
    const characters = held(registry, npc, "character", block);
    const role: Role = rnd() < 0.5 ? "base" : "encoder";
    const attached = held(registry, npc, role, block);
    if (characters.length && attached.length) {
      await npcOpen(registry, characters[Math.floor(rnd() * characters.length)]!, attached[Math.floor(rnd() * attached.length)]!, 20 + Math.floor(rnd() * 70), ms, block);
    }
  }

  if (block % 6 === 3) {
    const ripe = npcOpen_.filter((item) => block - item.openedBlock >= 3);
    const target = ripe[Math.floor(rnd() * ripe.length)];
    if (target) {
      const choice = chooseResponder(registry, target, ms, rnd);
      if (choice) await npcRespond(registry, target, choice.responderId, choice.pieceId, ms);
    }
  }

  if (block % 15 === 7) {
    const npc = NPCS[Math.floor(rnd() * NPCS.length)]!;
    const characters = held(registry, npc, "character", block);
    const bases = held(registry, npc, "base", block);
    const encoders = held(registry, npc, "encoder", block);
    if (characters.length && bases.length && encoders.length) {
      await npcComplete(registry, characters[0]!, bases[Math.floor(rnd() * bases.length)]!, encoders[Math.floor(rnd() * encoders.length)]!, ms, block);
    }
  }

  // Keep the stored log bounded: the oldest closures and finished conversations fall off.
  if (registry.closures.length > 2000) registry.closures.splice(0, registry.closures.length - 2000);
  const finished = registry.conversations.filter((item) => item.status !== "open");
  if (finished.length > 240) {
    const drop = new Set(finished.slice(0, finished.length - 240).map((item) => item.id));
    registry.conversations = registry.conversations.filter((item) => !drop.has(item.id));
    registry.lines = registry.lines.filter((line) => !drop.has(line.convId));
  }
}
