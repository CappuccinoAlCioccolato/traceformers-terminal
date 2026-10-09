import { getAddress, isAddress, recoverTypedDataAddress, type Hex } from "viem";
import { piece, type Role } from "@/lib/trace/catalog";
import { encode } from "@/lib/trace/cipher";
import { speakable } from "@/lib/trace/portrait";
import {
  DOMAIN,
  MAX_OPEN_SECONDS,
  MIN_OPEN_SECONDS,
  POINTS,
  answerSpec,
  canonicalIds,
  delegateSpec,
  idleSpec,
  joinSpec,
  lineCommit,
  linkSpec,
  openSpec,
  revokeSpec,
  type TypedSpec,
} from "./domain";
import { SIDES, SLOTS, type Asset, type Conversation, type IdleOffer, type LogKind, type Registry, type Result, type Seat, type Side, type SideName, type Slot } from "./types";

// The relayer of this build runs in the browser. It checks every EIP-712 signature against the holder
// at inclusion time, exactly as the contract would, and writes the log the wall, graph, and board read.

export const BLOCK_MS = 6500;
export const GENESIS_BLOCK = 18_421_000;
export const COOLDOWN = 3;
export const MAX_GLYPHS = 6;
/** Blocks an empty base or encoder seat waits for a holder before the relayer takes an idle piece. */
export const POOL_AFTER = 5;

export function blockAt(registry: Registry, ms: number): number {
  return GENESIS_BLOCK + Math.max(0, Math.floor((ms - registry.epoch) / BLOCK_MS));
}

export function unix(ms: number): number {
  return Math.floor(ms / 1000);
}

export function windowFor(baseId: string): number {
  return piece(baseId)?.form === "blink" ? 1 : 12;
}

class ProtocolError extends Error {}

function fail(message: string): never {
  throw new ProtocolError(message);
}

const SIG = /^0x[0-9a-fA-F]{130}$/;

export async function recover(spec: TypedSpec, signature: string): Promise<string> {
  if (!SIG.test(signature)) fail("Malformed signature.");
  try {
    const address = await recoverTypedDataAddress({
      domain: DOMAIN,
      types: spec.types,
      primaryType: spec.primaryType,
      message: spec.message,
      signature: signature as Hex,
    } as never);
    return address.toLowerCase();
  } catch {
    fail("Signature does not match this message.");
  }
}

function normAddress(value: string): string {
  if (!isAddress(value.trim())) fail("That is not an Ethereum address: 0x followed by 40 hex characters.");
  return getAddress(value.trim()).toLowerCase();
}

function mustAsset(registry: Registry, id: string): Asset {
  const asset = registry.assets.find((item) => item.id === id);
  if (!asset || !asset.owner) fail("Unknown NFT in the registry.");
  return asset;
}

const tok = (id: string | null | undefined) => (id && piece(id) ? `#${String(piece(id)!.tokenId).padStart(4, "0")}` : "—");

export function nonceKey(assetId: string, purpose: string) {
  return `${assetId}:${purpose}`;
}

export function nextNonce(registry: Registry, assetId: string, purpose: string): number {
  return (registry.nonces[nonceKey(assetId, purpose)] ?? 0) + 1;
}

function bumpNonce(registry: Registry, assetId: string, purpose: string, nonce: number) {
  const key = nonceKey(assetId, purpose);
  if ((registry.nonces[key] ?? 0) >= nonce) fail("Nonce already used. Sign again with the next nonce.");
  registry.nonces[key] = nonce;
}

export function cooling(registry: Registry, assetId: string, block: number): number {
  return Math.max(0, (registry.cooldowns[assetId] ?? 0) - block);
}

function assertCool(registry: Registry, assetId: string, block: number) {
  const left = cooling(registry, assetId, block);
  if (left > 0) fail(`${tok(assetId)} cools down for ${left} more block${left === 1 ? "" : "s"}.`);
}

function cool(registry: Registry, ids: (string | null)[], block: number) {
  for (const id of ids) if (id) registry.cooldowns[id] = block + COOLDOWN;
}

function log(registry: Registry, kind: LogKind, refId: string, by: string, ms: number) {
  registry.seq += 1;
  registry.log.push({ id: registry.seq, kind, refId, block: blockAt(registry, ms), at: ms, by });
  if (registry.log.length > 600) registry.log.splice(0, registry.log.length - 600);
}

function openKey(registry: Registry, baseId: string, block: number) {
  const window = windowFor(baseId);
  const existing = registry.keys.find((key) => key.baseId === baseId);
  if (existing) {
    existing.openedAt = block;
    existing.window = window;
  } else registry.keys.push({ baseId, openedAt: block, window });
}

export function keyLeft(registry: Registry, baseId: string | null | undefined, block: number): number {
  if (!baseId) return 0;
  const key = registry.keys.find((item) => item.baseId === baseId);
  if (!key) return 0;
  return Math.max(0, key.openedAt + key.window - block);
}

export function emptySide(): Side {
  return { character: null, base: null, encoder: null };
}

export function sideReady(side: Side): boolean {
  return Boolean(side.character && side.base && side.encoder);
}

/** Every piece seated in a conversation, both sides. */
export function seatedIds(conversation: Conversation): string[] {
  return SIDES.flatMap((name) => SLOTS.map((slot) => conversation[name][slot]?.id)).filter((id): id is string => Boolean(id));
}

/** The seats still empty, in the order the waiting room shows them. The answer side opens once the talk side is complete. */
export function emptySeats(conversation: Conversation): { side: SideName; slot: Slot }[] {
  if (conversation.status !== "open") return [];
  const out: { side: SideName; slot: Slot }[] = [];
  for (const slot of SLOTS) if (!conversation.talk[slot]) out.push({ side: "talk", slot });
  if (!sideReady(conversation.talk)) return out;
  for (const slot of SLOTS) if (!conversation.answer[slot]) out.push({ side: "answer", slot });
  return out;
}

/** Lines get their ciphertext as soon as their side has an encoder. */
function encodeLines(registry: Registry, conversation: Conversation) {
  for (const line of registry.lines) {
    if (line.convId !== conversation.id || line.ciphertext) continue;
    const encoderId = conversation[line.side].encoder?.id;
    const dialect = encoderId ? piece(encoderId)?.dialect : null;
    if (!dialect) continue;
    line.dialect = dialect;
    line.ciphertext = encode(line.plaintext, dialect);
  }
}

function addLine(registry: Registry, input: { convId: string; side: SideName; speakerId: string; replyTo: string | null; plaintext: string; block: number }): string {
  registry.seq += 1;
  const id = `l-${input.block}-${registry.seq}`;
  registry.lines.push({ ...input, id, commit: lineCommit(input.plaintext), dialect: null, ciphertext: null });
  return id;
}

function lineCheck(plaintext: string, speaker: Asset) {
  const chars = Array.from(plaintext);
  if (chars.length === 0) fail("Compose at least one glyph.");
  if (chars.length > MAX_GLYPHS) fail(`A line holds at most ${MAX_GLYPHS} glyphs.`);
  const owned = new Set(speakable(speaker.tokenId));
  if (chars.some((ch) => !owned.has(ch))) fail("A character speaks only with the glyphs its own art is drawn with.");
}

async function consumeIdle(registry: Registry, assetId: string, takerId: string, ms: number) {
  const offer = registry.idles.find((item) => item.assetId === assetId);
  if (!offer) fail("That piece is not in the idle pool.");
  const asset = mustAsset(registry, assetId);
  if (asset.owner !== offer.owner) fail("The idle offer no longer belongs to the current holder.");
  if (offer.expiry !== 0 && offer.expiry <= unix(ms)) fail("Idle offer expired.");
  if (offer.maxUses !== 0 && offer.uses >= offer.maxUses) fail("Idle offer has no uses left.");
  const allowed = offer.allowed ? offer.allowed.split(",") : [];
  if (allowed.length && !allowed.includes(takerId)) fail("This idle piece is reserved for other characters.");
  const recovered = await recover(
    idleSpec({ nft: assetId, role: offer.role, nonce: offer.nonce, maxUses: offer.maxUses, expiry: offer.expiry, allowed: offer.allowed }),
    offer.signature,
  );
  if (recovered !== asset.owner) fail("The idle signature is no longer valid.");
  offer.uses += 1;
  if (offer.maxUses !== 0 && offer.uses >= offer.maxUses) registry.idles = registry.idles.filter((item) => item.assetId !== assetId);
}

/** Idle offers of a role that the taking character may use now, minus pieces already in the talk. */
export function eligibleIdle(registry: Registry, role: Role, banned: string[], takerId: string, ms: number): IdleOffer[] {
  return registry.idles
    .filter((offer) => {
      if (offer.role !== role || banned.includes(offer.assetId)) return false;
      const asset = registry.assets.find((item) => item.id === offer.assetId);
      if (!asset || asset.owner !== offer.owner) return false;
      if (offer.maxUses !== 0 && offer.uses >= offer.maxUses) return false;
      if (offer.expiry !== 0 && offer.expiry <= unix(ms)) return false;
      const allowed = offer.allowed ? offer.allowed.split(",") : [];
      return allowed.length === 0 || allowed.includes(takerId);
    })
    .sort((a, b) => a.assetId.localeCompare(b.assetId));
}

/** Can this piece sit in this seat? Role, dialect, freedom from other seats, and cooldown. */
export function seatProblem(registry: Registry, conversation: Conversation, side: SideName, slot: Slot, asset: Asset, block: number): string | null {
  if (asset.role !== slot) return `The ${slot} seat needs a ${slot}.`;
  if (conversation[side][slot]) return `The ${side} ${slot} seat is already taken.`;
  if (seatedIds(conversation).includes(asset.id)) return "The same NFT cannot sit in two seats of one talk.";
  if (side === "answer" && !sideReady(conversation.talk)) return "The answer side opens once the talk side has its character, base, and encoder.";
  if (side === "answer" && slot === "encoder" && conversation.dialect && piece(asset.id)?.dialect !== conversation.dialect) {
    return `The answer must be encoded in ${conversation.dialect}, like the talk.`;
  }
  const left = cooling(registry, asset.id, block);
  if (left > 0) return `${tok(asset.id)} cools down for ${left} more block${left === 1 ? "" : "s"}.`;
  return null;
}

function checkSeat(registry: Registry, conversation: Conversation, side: SideName, slot: Slot, asset: Asset, block: number) {
  const problem = seatProblem(registry, conversation, side, slot, asset, block);
  if (problem) fail(problem);
}

function seat(registry: Registry, conversation: Conversation, side: SideName, slot: Slot, asset: Asset, by: Seat["by"], signature: Hex | null, block: number) {
  conversation[side][slot] = { id: asset.id, holder: asset.owner, by, signature };
  conversation.movedBlock = block;
  if (side === "talk" && slot === "encoder") conversation.dialect = piece(asset.id)?.dialect ?? null;
  if (slot === "base") openKey(registry, asset.id, block);
  cool(registry, [asset.id], block);
  encodeLines(registry, conversation);
}

function mustOpen(registry: Registry, id: string, ms: number): Conversation {
  const conversation = registry.conversations.find((item) => item.id === id);
  if (!conversation) fail("Unknown talk.");
  if (conversation.status !== "open") fail("That talk is no longer open.");
  if (conversation.deadline <= unix(ms)) fail("That talk is past its deadline.");
  return conversation;
}

/** Close the talk when all six seats are taken. Every seated piece must still be with the holder who seated it. */
function maybeClose(registry: Registry, conversation: Conversation, by: string, ms: number): boolean {
  if (!sideReady(conversation.talk) || !sideReady(conversation.answer)) return false;
  for (const name of SIDES) {
    for (const slot of SLOTS) {
      const taken = conversation[name][slot]!;
      if (mustAsset(registry, taken.id).owner !== taken.holder) {
        conversation[name][slot] = null;
        if (name === "talk" && slot === "character") conversation.status = "expired";
        return false;
      }
    }
  }
  const block = blockAt(registry, ms);
  const talkHolder = conversation.talk.character!.holder;
  const self = conversation.answer.character!.holder === talkHolder;
  const pieces = { talk: {}, answer: {} } as Record<SideName, Record<Slot, string>>;
  const wallets = { talk: {}, answer: {} } as Record<SideName, Record<Slot, string>>;
  const points = { talk: {}, answer: {} } as Record<SideName, Record<Slot, number>>;
  for (const name of SIDES) {
    for (const slot of SLOTS) {
      const taken = conversation[name][slot]!;
      pieces[name][slot] = taken.id;
      wallets[name][slot] = taken.holder;
      let value: number = slot === "character" ? POINTS.character : POINTS.piece;
      if (self && name === "talk" && slot === "character") value = POINTS.selfTalk;
      if (self && name === "answer" && taken.holder === talkHolder) value = 0;
      points[name][slot] = value;
    }
  }
  registry.seq += 1;
  const id = `k-${block}-${registry.seq}`;
  registry.closures.push({ id, convId: conversation.id, pieces, wallets, points, self, block, at: ms });
  conversation.status = "closed";
  conversation.closureId = id;
  log(registry, "Closed", conversation.id, by, ms);
  return true;
}

function closedNote(registry: Registry, conversation: Conversation): string {
  const closure = registry.closures.find((item) => item.id === conversation.closureId);
  if (!closure) return "Talk closed.";
  return closure.self
    ? "Talk closed. The same wallet answered itself, so its answer side earns nothing."
    : `Talk closed: ${closure.points.talk.character} + ${closure.points.answer.character} to the characters, 1 to each base and encoder.`;
}

async function run(work: () => Promise<{ note: string; refId?: string }>): Promise<Result> {
  try {
    const out = await work();
    return { ok: true, ...out };
  } catch (err) {
    if (err instanceof ProtocolError) return { ok: false, error: err.message };
    throw err;
  }
}

// ---------------------------------------------------------------------------------------------------------
// Upkeep: what the relayer does on every block without anyone signing.

export function expireDue(registry: Registry, ms: number): string[] {
  const expired: string[] = [];
  for (const conversation of registry.conversations) {
    if (conversation.status !== "open" || conversation.deadline > unix(ms)) continue;
    conversation.status = "expired";
    expired.push(conversation.id);
    log(registry, "Expired", conversation.id, "relayer", ms);
  }
  return expired;
}

/**
 * An empty base or encoder seat that nobody took for a while gets an idle piece from the pool, if one fits.
 * The answer side needs its character first: the idle offer may be reserved for some characters.
 */
export async function fillFromPool(registry: Registry, ms: number): Promise<string[]> {
  const block = blockAt(registry, ms);
  const filled: string[] = [];
  for (const conversation of registry.conversations) {
    if (conversation.status !== "open" || block - conversation.movedBlock < POOL_AFTER) continue;
    for (const { side, slot } of emptySeats(conversation)) {
      if (slot === "character") continue;
      const taker = conversation[side].character?.id;
      if (!taker) continue;
      const options = eligibleIdle(registry, slot, seatedIds(conversation), taker, ms).filter(
        (offer) => !seatProblem(registry, conversation, side, slot, mustAsset(registry, offer.assetId), block),
      );
      const chosen = options[(block + conversation.openedBlock) % Math.max(1, options.length)];
      if (!chosen) continue;
      try {
        await consumeIdle(registry, chosen.assetId, taker, ms);
      } catch (err) {
        if (err instanceof ProtocolError) continue;
        throw err;
      }
      seat(registry, conversation, side, slot, mustAsset(registry, chosen.assetId), "pool", null, block);
      log(registry, "Pooled", conversation.id, "relayer", ms);
      filled.push(conversation.id);
    }
    maybeClose(registry, conversation, "relayer", ms);
  }
  return filled;
}

// ---------------------------------------------------------------------------------------------------------
// Signed submissions.

const GRANT_ROLES: { role: Role; prefer: (id: string) => number }[] = [
  { role: "character", prefer: () => 0 },
  { role: "character", prefer: () => 0 },
  { role: "base", prefer: (id) => (piece(id)?.form === "classic" ? 0 : 1) },
  { role: "base", prefer: (id) => (piece(id)?.form === "inverted" ? 0 : 1) },
  { role: "base", prefer: (id) => (piece(id)?.form === "blink" ? 0 : 1) },
  { role: "encoder", prefer: (id) => (piece(id)?.dialect === "binary" ? 0 : 1) },
  { role: "encoder", prefer: (id) => (piece(id)?.dialect === "base64" ? 0 : 1) },
  { role: "encoder", prefer: (id) => (piece(id)?.dialect === "punched" ? 0 : 1) },
];

export async function submitLink(registry: Registry, input: { address: string; signature: string }, ms: number): Promise<Result> {
  return run(async () => {
    const address = normAddress(input.address);
    const recovered = await recover(linkSpec(address), input.signature);
    if (recovered !== address) fail("The signature does not belong to this wallet.");
    if (!registry.links.includes(address)) registry.links.push(address);
    const holds = registry.assets.some((asset) => asset.owner === address);
    if (registry.grants.includes(address) || holds) {
      log(registry, "Linked", address, address, ms);
      return { note: "Wallet signed in. Your pieces are below." };
    }
    const granted: Asset[] = [];
    for (const slot of GRANT_ROLES) {
      const free = registry.assets
        .filter((asset) => asset.role === slot.role && !asset.owner)
        .sort((a, b) => slot.prefer(a.id) - slot.prefer(b.id) || a.tokenId - b.tokenId);
      const pick = free[0];
      if (!pick) continue;
      pick.owner = address;
      granted.push(pick);
    }
    registry.grants.push(address);
    log(registry, "Linked", address, address, ms);
    if (granted.length === 0) return { note: "Wallet signed in. Every piece of this registry is already held: reset it from the footer to start over." };
    const count = (role: Role) => granted.filter((asset) => asset.role === role).length;
    return { note: `Wallet signed in. ${count("character")} characters, ${count("base")} bases, and ${count("encoder")} encoders are now on this address.` };
  });
}

export async function submitIdle(
  registry: Registry,
  input: { nft: string; role: string; nonce: number; maxUses: number; expiry: number; allowed: string; signature: string },
  ms: number,
): Promise<Result> {
  return run(async () => {
    if (input.role !== "base" && input.role !== "encoder") fail("Only a base or an encoder can sit idle.");
    const asset = mustAsset(registry, input.nft);
    if (asset.role !== input.role) fail("The signed role does not match the NFT.");
    if (!Number.isInteger(input.maxUses) || input.maxUses < 0) fail("Max uses must be a whole number.");
    if (input.expiry !== 0 && input.expiry <= unix(ms)) fail("That expiry is already in the past.");
    const allowed = canonicalIds(input.allowed.split(","));
    if (allowed !== input.allowed) fail("Allowed ids must be sorted and unique.");
    for (const id of allowed ? allowed.split(",") : []) {
      if (!registry.assets.some((item) => item.id === id && item.role === "character")) fail(`#${id.slice(2)} is not a Trace character.`);
    }
    const recovered = await recover(
      idleSpec({ nft: input.nft, role: input.role, nonce: input.nonce, maxUses: input.maxUses, expiry: input.expiry, allowed }),
      input.signature,
    );
    if (recovered !== asset.owner) fail("Only the current holder can idle this NFT.");
    bumpNonce(registry, input.nft, "offer", input.nonce);
    registry.idles = registry.idles.filter((offer) => offer.assetId !== input.nft);
    registry.idles.push({
      assetId: input.nft,
      role: asset.role,
      nonce: input.nonce,
      maxUses: input.maxUses,
      uses: 0,
      expiry: input.expiry,
      allowed,
      signature: input.signature as Hex,
      owner: asset.owner,
    });
    log(registry, "IdleOffer", input.nft, recovered, ms);
    return { note: "Idle offer included. It stands until you revoke it.", refId: input.nft };
  });
}

export async function submitRevoke(registry: Registry, input: { nft: string; nonce: number; signature: string }, ms: number): Promise<Result> {
  return run(async () => {
    const asset = mustAsset(registry, input.nft);
    const recovered = await recover(revokeSpec({ nft: input.nft, nonce: input.nonce }), input.signature);
    if (recovered !== asset.owner) fail("Only the current holder can revoke.");
    if (!registry.idles.some((offer) => offer.assetId === input.nft)) fail("There was no idle offer to revoke.");
    bumpNonce(registry, input.nft, "offer", input.nonce);
    registry.idles = registry.idles.filter((offer) => offer.assetId !== input.nft);
    log(registry, "Revoke", input.nft, recovered, ms);
    return { note: "Offer revoked. The NFT left the pool.", refId: input.nft };
  });
}

/** A character opens a talk. It may bring its base and encoder, or leave either seat to the waiting room. */
export async function submitOpen(
  registry: Registry,
  input: { character: string; base: string; encoder: string; plaintext: string; deadline: number; nonce: number; signature: string },
  ms: number,
): Promise<Result> {
  return run(async () => {
    const block = blockAt(registry, ms);
    const now = unix(ms);
    const slack = 90;
    if (input.deadline < now + MIN_OPEN_SECONDS - slack || input.deadline > now + MAX_OPEN_SECONDS + slack) {
      fail("The window must be between 2 minutes and 2 hours.");
    }
    const character = mustAsset(registry, input.character);
    if (character.role !== "character") fail("Only a character can open a talk.");
    lineCheck(input.plaintext, character);
    assertCool(registry, character.id, block);
    const recovered = await recover(
      openSpec({ character: input.character, base: input.base, encoder: input.encoder, line: lineCommit(input.plaintext), deadline: input.deadline, nonce: input.nonce }),
      input.signature,
    );
    if (recovered !== character.owner) fail("The character does not belong to the signer.");
    registry.seq += 1;
    const id = `t-${block}-${registry.seq}`;
    const conversation: Conversation = {
      id,
      talk: emptySide(),
      answer: emptySide(),
      dialect: null,
      deadline: input.deadline,
      nonce: input.nonce,
      status: "open",
      openedBlock: block,
      movedBlock: block,
      closureId: null,
    };
    for (const [slot, pieceId] of [["base", input.base], ["encoder", input.encoder]] as const) {
      if (!pieceId) continue;
      const asset = mustAsset(registry, pieceId);
      checkSeat(registry, conversation, "talk", slot, asset, block);
      if (asset.owner !== recovered) fail(`The ${slot} you bring must be yours. Leave the seat empty and its holder can join.`);
    }
    bumpNonce(registry, input.character, "open", input.nonce);
    conversation.talk.character = { id: character.id, holder: recovered, by: "speaker", signature: input.signature as Hex };
    cool(registry, [character.id], block);
    addLine(registry, { convId: id, side: "talk", speakerId: character.id, replyTo: null, plaintext: input.plaintext, block });
    for (const [slot, pieceId] of [["base", input.base], ["encoder", input.encoder]] as const) {
      if (pieceId) seat(registry, conversation, "talk", slot, mustAsset(registry, pieceId), "speaker", input.signature as Hex, block);
    }
    registry.conversations.push(conversation);
    log(registry, "Opened", id, recovered, ms);
    const missing = SLOTS.filter((slot) => !conversation.talk[slot]);
    return {
      note: missing.length ? `Talk opened. Its ${missing.join(" and ")} seat waits in the waiting room.` : "Talk opened with all three pieces. It waits for an answer.",
      refId: id,
    };
  });
}

/** A character answers a talk whose talk side is complete. It may bring a base, and an encoder of the same dialect. */
export async function submitAnswer(
  registry: Registry,
  input: { openId: string; character: string; base: string; encoder: string; plaintext: string; signature: string },
  ms: number,
): Promise<Result> {
  return run(async () => {
    const block = blockAt(registry, ms);
    const conversation = mustOpen(registry, input.openId, ms);
    if (!sideReady(conversation.talk)) fail("The talk still misses pieces. Answer once its base and encoder are seated.");
    if (conversation.answer.character) fail("Another character already answered this talk.");
    const responder = mustAsset(registry, input.character);
    checkSeat(registry, conversation, "answer", "character", responder, block);
    lineCheck(input.plaintext, responder);
    const recovered = await recover(
      answerSpec({ openId: input.openId, character: input.character, base: input.base, encoder: input.encoder, line: lineCommit(input.plaintext) }),
      input.signature,
    );
    if (recovered !== responder.owner) fail("The signature is not from the character's holder.");
    for (const [slot, pieceId] of [["base", input.base], ["encoder", input.encoder]] as const) {
      if (!pieceId) continue;
      const asset = mustAsset(registry, pieceId);
      checkSeat(registry, conversation, "answer", slot, asset, block);
      if (asset.owner !== recovered) fail(`The ${slot} you bring must be yours. Leave the seat empty and its holder can join.`);
    }
    seat(registry, conversation, "answer", "character", responder, "speaker", input.signature as Hex, block);
    const opening = registry.lines.find((line) => line.convId === conversation.id && line.side === "talk");
    addLine(registry, { convId: conversation.id, side: "answer", speakerId: responder.id, replyTo: opening?.id ?? null, plaintext: input.plaintext, block });
    for (const [slot, pieceId] of [["base", input.base], ["encoder", input.encoder]] as const) {
      if (pieceId) seat(registry, conversation, "answer", slot, mustAsset(registry, pieceId), "speaker", input.signature as Hex, block);
    }
    encodeLines(registry, conversation);
    log(registry, "Answered", conversation.id, recovered, ms);
    if (maybeClose(registry, conversation, recovered, ms)) return { note: closedNote(registry, conversation), refId: conversation.id };
    const missing = SLOTS.filter((slot) => !conversation.answer[slot]);
    return { note: `Answer included. Its ${missing.join(" and ")} seat waits in the waiting room.`, refId: conversation.id };
  });
}

/** A base or encoder holder takes an empty seat from the waiting room. */
export async function submitJoin(registry: Registry, input: { openId: string; side: SideName; nft: string; nonce: number; signature: string }, ms: number): Promise<Result> {
  return run(async () => {
    const block = blockAt(registry, ms);
    const conversation = mustOpen(registry, input.openId, ms);
    if (input.side !== "talk" && input.side !== "answer") fail("Unknown side.");
    const asset = mustAsset(registry, input.nft);
    if (asset.role === "character") fail("A character does not join: it opens or answers.");
    checkSeat(registry, conversation, input.side, asset.role, asset, block);
    const recovered = await recover(joinSpec({ openId: input.openId, side: input.side, nft: input.nft, nonce: input.nonce }), input.signature);
    if (recovered !== asset.owner) fail("Only the holder of this piece can seat it.");
    bumpNonce(registry, input.nft, "join", input.nonce);
    seat(registry, conversation, input.side, asset.role, asset, "joined", input.signature as Hex, block);
    log(registry, "Joined", conversation.id, recovered, ms);
    if (maybeClose(registry, conversation, recovered, ms)) return { note: `${tok(asset.id)} joined and closed the talk. ${closedNote(registry, conversation)}`, refId: conversation.id };
    return { note: `${tok(asset.id)} joined the ${input.side} side as its ${asset.role}.`, refId: conversation.id };
  });
}

export async function submitDelegate(registry: Registry, input: { nft: string; to: string; nonce: number; signature: string }, ms: number): Promise<Result> {
  return run(async () => {
    const asset = mustAsset(registry, input.nft);
    const to = normAddress(input.to);
    if (to === asset.owner) fail("That piece is already delegated to this address.");
    const recovered = await recover(delegateSpec({ nft: input.nft, to, nonce: input.nonce }), input.signature);
    if (recovered !== asset.owner) fail("Only the current holder can delegate.");
    bumpNonce(registry, input.nft, "delegate", input.nonce);
    asset.owner = to;
    registry.idles = registry.idles.filter((offer) => offer.assetId !== input.nft);
    // Earlier signatures on this piece stop counting: it leaves every seat of every open talk.
    for (const conversation of registry.conversations) {
      if (conversation.status !== "open") continue;
      for (const name of SIDES) {
        for (const slot of SLOTS) {
          if (conversation[name][slot]?.id !== input.nft) continue;
          conversation[name][slot] = null;
          if (name === "talk" && slot === "character") {
            conversation.status = "expired";
            log(registry, "Expired", conversation.id, "relayer", ms);
          }
        }
      }
    }
    log(registry, "Delegate", input.nft, recovered, ms);
    return { note: `Delegated. ${to.slice(0, 6)}…${to.slice(-4)} now signs for this piece; earlier signatures on it no longer count.`, refId: input.nft };
  });
}

/** The holder of a base renews the key of its thread. Reading rights only: no points move. */
export function renewKey(registry: Registry, baseId: string, address: string, ms: number): Result {
  const asset = registry.assets.find((item) => item.id === baseId);
  if (!asset || asset.owner !== address) return { ok: false, error: "Only the holder of this base can open its key." };
  const block = blockAt(registry, ms);
  const left = cooling(registry, baseId, block);
  if (left > 0) return { ok: false, error: `The base cools down for ${left} more block${left === 1 ? "" : "s"}.` };
  openKey(registry, baseId, block);
  cool(registry, [baseId], block);
  return { ok: true, note: `Key open for ${windowFor(baseId)} block${windowFor(baseId) === 1 ? "" : "s"}.` };
}
