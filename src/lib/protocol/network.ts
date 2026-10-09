import { keccak256, stringToHex, type Hex } from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { PIECES, piece, pieceId, type Role } from "@/lib/trace/catalog";
import { answer, mulberry32, phrase } from "@/lib/trace/portrait";
import { DOMAIN, answerSpec, idleSpec, joinSpec, lineCommit, openSpec, type TypedSpec } from "./domain";
import {
  BLOCK_MS,
  blockAt,
  cooling,
  emptySeats,
  expireDue,
  fillFromPool,
  nextNonce,
  seatProblem,
  submitAnswer,
  submitIdle,
  submitJoin,
  submitOpen,
  unix,
} from "./relayer";
import type { Conversation, Registry, Result, SideName, Slot } from "./types";

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
// Acts. Each one signs as the holder of the piece and goes through the relayer.

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

/** A network character opens a talk, bringing its own base and encoder or leaving them to the waiting room. */
export async function npcOpen(registry: Registry, characterId: string, bring: { base?: string; encoder?: string }, minutes: number, ms: number, salt: number): Promise<Result> {
  const npc = npcFor(registry, characterId);
  if (!npc) return { ok: false, error: "Not a network character." };
  const plaintext = phrase(tokenOf(characterId), 3 + (salt % 3), salt);
  const message = {
    character: characterId,
    base: bring.base ?? "",
    encoder: bring.encoder ?? "",
    deadline: unix(ms) + minutes * 60,
    nonce: nextNonce(registry, characterId, "open"),
  };
  const signature = await sign(npc, openSpec({ ...message, line: lineCommit(plaintext) }));
  return submitOpen(registry, { ...message, plaintext, signature }, ms);
}

/** A network character answers a talk, citing its line with glyphs of its own art. */
export async function npcAnswer(registry: Registry, conversation: Conversation, characterId: string, bring: { base?: string; encoder?: string }, ms: number): Promise<Result> {
  const npc = npcFor(registry, characterId);
  if (!npc) return { ok: false, error: "Not a network character." };
  const opening = registry.lines.find((line) => line.convId === conversation.id && line.side === "talk");
  const plaintext = answer(opening?.plaintext ?? "█", tokenOf(characterId)).slice(0, 6);
  const message = { openId: conversation.id, character: characterId, base: bring.base ?? "", encoder: bring.encoder ?? "" };
  const signature = await sign(npc, answerSpec({ ...message, line: lineCommit(plaintext) }));
  return submitAnswer(registry, { ...message, plaintext, signature }, ms);
}

async function npcJoin(registry: Registry, conversation: Conversation, side: SideName, assetId: string, ms: number): Promise<Result> {
  const npc = npcFor(registry, assetId);
  if (!npc) return { ok: false, error: "Not a network piece." };
  const message = { openId: conversation.id, side, nft: assetId, nonce: nextNonce(registry, assetId, "join") };
  const signature = await sign(npc, joinSpec(message));
  return submitJoin(registry, { ...message, signature }, ms);
}

function fits(registry: Registry, conversation: Conversation, side: SideName, slot: Slot, assetId: string, block: number): boolean {
  const asset = registry.assets.find((item) => item.id === assetId);
  return Boolean(asset && !seatProblem(registry, conversation, side, slot, asset, block));
}

/**
 * A network character, held by another wallet than the talk's, ready to answer.
 * `full` brings its own base and a same-dialect encoder when it has them; otherwise it may leave seats to the room.
 */
export function chooseAnswer(registry: Registry, conversation: Conversation, ms: number, rnd: () => number = Math.random, full = false) {
  const block = blockAt(registry, ms);
  const talkHolder = conversation.talk.character?.holder;
  const candidates = NPCS.filter((npc) => npc.account.address.toLowerCase() !== talkHolder)
    .flatMap((npc) => held(registry, npc, "character", block).map((id) => ({ npc, id })))
    .filter((item) => fits(registry, conversation, "answer", "character", item.id, block));
  if (!candidates.length) return null;
  const pick = candidates[Math.floor(rnd() * candidates.length)]!;
  const bases = held(registry, pick.npc, "base", block).filter((id) => fits(registry, conversation, "answer", "base", id, block));
  const encoders = held(registry, pick.npc, "encoder", block).filter((id) => piece(id)?.dialect === conversation.dialect && fits(registry, conversation, "answer", "encoder", id, block));
  return {
    characterId: pick.id,
    base: bases.length && (full || rnd() < 0.5) ? bases[0] : undefined,
    encoder: encoders.length && (full || rnd() < 0.5) ? encoders[0] : undefined,
  };
}

/** A network piece that fits an empty seat, from any holder. */
function chooseJoin(registry: Registry, conversation: Conversation, side: SideName, slot: Slot, ms: number, rnd: () => number) {
  const block = blockAt(registry, ms);
  const options = NPCS.flatMap((npc) => held(registry, npc, slot, block)).filter((id) => fits(registry, conversation, side, slot, id, block));
  return options.length ? options[Math.floor(rnd() * options.length)]! : null;
}

// ---------------------------------------------------------------------------------------------------------
// Genesis and the ambient loop.

export async function createGenesis(now: number): Promise<Registry> {
  const BACK = 60;
  const registry: Registry = {
    version: 3,
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
  const must = (result: Result, what: string) => {
    if (!result.ok) throw new Error(`genesis ${what}: ${result.error}`);
    return result;
  };
  const open = async (k: number, character: number, base: number, encoder: number, minutes = 60) => {
    const result = must(
      await npcOpen(registry, pieceId("character", character), { base: base ? pieceId("base", base) : undefined, encoder: encoder ? pieceId("encoder", encoder) : undefined }, minutes, at(k), k),
      "open",
    );
    return conv(result.refId!);
  };
  const reply = async (k: number, conversation: Conversation, character: number, base: number, encoder: number) => {
    must(await npcAnswer(registry, conversation, pieceId("character", character), { base: base ? pieceId("base", base) : undefined, encoder: encoder ? pieceId("encoder", encoder) : undefined }, at(k)), "answer");
  };
  const join = async (k: number, conversation: Conversation, side: SideName, role: "base" | "encoder", id: number) => {
    must(await npcJoin(registry, conversation, side, pieceId(role, id), at(k)), "join");
  };

  await npcIdle(registry, "b-3", at(2));
  await npcIdle(registry, "e-125", at(2), { maxUses: 4 });
  await npcIdle(registry, "b-11", at(2), { allowed: "c-12,c-15" });
  await npcIdle(registry, "e-139", at(2));
  await npcIdle(registry, "b-20", at(2), { maxUses: 2 });
  await npcIdle(registry, "e-123", at(2), { expiry: 1893456000 });

  // Closed talks. Each side is seated by its character's holder, by other holders joining, or both.
  const first = await open(6, 2, 1, 123);
  await reply(7, first, 5, 3, 0);
  await join(8, first, "answer", "encoder", 125);
  const second = await open(10, 7, 8, 0);
  await join(11, second, "talk", "encoder", 611);
  await reply(12, second, 4, 6, 0);
  await join(13, second, "answer", "encoder", 789);
  const third = await open(14, 9, 10, 125);
  await reply(15, third, 14, 16, 0);
  await join(16, third, "answer", "encoder", 123);
  const fourth = await open(18, 13, 0, 150);
  await join(19, fourth, "talk", "base", 17);
  await reply(20, fourth, 19, 20, 163);
  const fifth = await open(24, 12, 10, 125);
  await reply(25, fifth, 15, 17, 139);
  const sixth = await open(30, 5, 0, 0);
  await join(31, sixth, "talk", "base", 11);
  await join(31, sixth, "talk", "encoder", 150);
  await reply(33, sixth, 2, 1, 0);
  await join(34, sixth, "answer", "encoder", 149);

  // Still in the waiting room when you arrive: an answer without base and encoder, and a talk without encoder.
  const waiting = await open(BACK - 8, 19, 20, 163, 45);
  await reply(BACK - 4, waiting, 9, 0, 0);
  await open(BACK - 3, 4, 6, 0, 90);
  registry.cursor = blockAt(registry, now);
  return registry;
}

/** Blocks a seat waits before a network holder takes it, and before a network character answers. */
const JOIN_AFTER = 4;
const ANSWER_AFTER = 3;

/** One block of network life: pool fills, new talks, answers, and network pieces taking the seats nobody took. */
export async function ambient(registry: Registry, block: number, ms: number): Promise<void> {
  await fillFromPool(registry, ms);
  const rnd = mulberry32(block * 997);
  const open = registry.conversations.filter((item) => item.status === "open").sort((a, b) => a.deadline - b.deadline);
  const npcOpenCount = open.filter((item) => isNpc(item.talk.character?.holder ?? "")).length;

  if (block % 6 === 0 && npcOpenCount < 3) {
    const npc = NPCS[Math.floor(rnd() * NPCS.length)]!;
    const characters = held(registry, npc, "character", block);
    const bases = held(registry, npc, "base", block);
    const encoders = held(registry, npc, "encoder", block);
    if (characters.length) {
      await npcOpen(
        registry,
        characters[Math.floor(rnd() * characters.length)]!,
        { base: rnd() < 0.6 ? bases[0] : undefined, encoder: rnd() < 0.6 ? encoders[0] : undefined },
        20 + Math.floor(rnd() * 70),
        ms,
        block,
      );
    }
  }

  let acts = 0;
  for (const conversation of open) {
    if (acts >= 2 || conversation.status !== "open") break;
    const waited = block - conversation.movedBlock;
    const seats = emptySeats(conversation);
    const needsAnswer = seats.some((item) => item.side === "answer" && item.slot === "character");
    if (needsAnswer && waited >= ANSWER_AFTER) {
      const choice = chooseAnswer(registry, conversation, ms, rnd);
      if (choice) {
        await npcAnswer(registry, conversation, choice.characterId, choice, ms);
        acts += 1;
        continue;
      }
    }
    if (waited < JOIN_AFTER) continue;
    const seatToFill = seats.find((item) => item.slot !== "character");
    if (!seatToFill) continue;
    const pieceToSeat = chooseJoin(registry, conversation, seatToFill.side, seatToFill.slot, ms, rnd);
    if (pieceToSeat) {
      await npcJoin(registry, conversation, seatToFill.side, pieceToSeat, ms);
      acts += 1;
    }
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
