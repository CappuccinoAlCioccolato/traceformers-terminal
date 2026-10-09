import { getAddress, isAddress, keccak256, recoverTypedDataAddress, stringToHex, type Hex } from "viem";
import { piece, type Role } from "@/lib/trace/catalog";
import { encode } from "@/lib/trace/cipher";
import { speakable } from "@/lib/trace/portrait";
import {
  DOMAIN,
  MAX_OPEN_SECONDS,
  MIN_OPEN_SECONDS,
  POINTS,
  canonicalExcluded,
  completeSpec,
  idleSpec,
  lineCommit,
  linkSpec,
  openSpec,
  respondSpec,
  revokeSpec,
  transferSpec,
  type TypedSpec,
} from "./domain";
import type { Asset, Conversation, IdleOffer, LogKind, Registry, Result } from "./types";

// The relayer of this build runs in the browser. It checks every EIP-712 signature against the holder
// at inclusion time, exactly as the contract would, and writes the log the wall, graph, and board read.

export const BLOCK_MS = 6500;
export const GENESIS_BLOCK = 18_421_000;
export const COOLDOWN = 3;
export const MAX_GLYPHS = 6;
/** The relayer includes the draw callback after this delay, standing in for a VRF round trip. */
export const DRAW_MS = 8000;

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
  if (!isAddress(value.trim())) fail("Invalid address.");
  return getAddress(value.trim()).toLowerCase();
}

function mustAsset(registry: Registry, id: string): Asset {
  const asset = registry.assets.find((item) => item.id === id);
  if (!asset || !asset.owner) fail("Unknown NFT in the registry.");
  return asset;
}

function distinct(ids: (string | null | undefined)[]) {
  const filled = ids.filter((id): id is string => Boolean(id));
  if (new Set(filled).size !== filled.length) fail("The same NFT cannot fill two slots.");
}

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
  if (left > 0) fail(`${piece(assetId) ? `#${piece(assetId)!.tokenId}` : assetId} cools down for ${left} more block${left === 1 ? "" : "s"}.`);
}

function cool(registry: Registry, ids: (string | null)[], block: number) {
  for (const id of ids) if (id) registry.cooldowns[id] = block + COOLDOWN;
}

function log(registry: Registry, kind: LogKind, refId: string, by: string, ms: number) {
  registry.seq += 1;
  registry.log.push({ id: registry.seq, kind, refId, block: blockAt(registry, ms), at: ms, by });
  if (registry.log.length > 400) registry.log.splice(0, registry.log.length - 400);
}

function openKey(registry: Registry, baseId: string, block: number) {
  const window = windowFor(baseId);
  const existing = registry.keys.find((key) => key.baseId === baseId);
  if (existing) {
    existing.openedAt = block;
    existing.window = window;
  } else registry.keys.push({ baseId, openedAt: block, window });
}

export function keyLeft(registry: Registry, baseId: string | null, block: number): number {
  if (!baseId) return 0;
  const key = registry.keys.find((item) => item.baseId === baseId);
  if (!key) return 0;
  return Math.max(0, key.openedAt + key.window - block);
}

/** Lines get their ciphertext as soon as the conversation has an encoder. */
function cipherLines(registry: Registry, conversation: Conversation) {
  const dialect = conversation.encoderId ? piece(conversation.encoderId)?.dialect : null;
  if (!dialect) return;
  for (const line of registry.lines) {
    if (line.convId !== conversation.id || line.ciphertext) continue;
    line.dialect = dialect;
    line.ciphertext = encode(line.plaintext, dialect);
  }
}

function addLine(
  registry: Registry,
  input: { convId: string; speakerId: string; replyTo: string | null; plaintext: string; block: number },
): string {
  registry.seq += 1;
  const id = `l-${input.block}-${registry.seq}`;
  registry.lines.push({
    id,
    convId: input.convId,
    speakerId: input.speakerId,
    replyTo: input.replyTo,
    plaintext: input.plaintext,
    commit: lineCommit(input.plaintext),
    dialect: null,
    ciphertext: null,
    block: input.block,
  });
  return id;
}

async function consumeIdle(registry: Registry, assetId: string, role: Role, characterIds: string[], ms: number) {
  const offer = registry.idles.find((item) => item.assetId === assetId);
  if (!offer) fail("That piece is not in the idle pool.");
  if (offer.role !== role) fail("The idle offer role does not match the slot.");
  const asset = mustAsset(registry, assetId);
  if (asset.owner !== offer.owner) fail("The idle offer no longer belongs to the current holder.");
  if (offer.expiry !== 0 && offer.expiry <= unix(ms)) fail("Idle offer expired.");
  if (offer.maxUses !== 0 && offer.uses >= offer.maxUses) fail("Idle offer has no uses left.");
  const banned = offer.excluded ? offer.excluded.split(",") : [];
  if (characterIds.some((id) => banned.includes(id))) fail("A character in this conversation is excluded from the idle offer.");
  const recovered = await recover(
    idleSpec({ nft: assetId, role: offer.role, nonce: offer.nonce, maxUses: offer.maxUses, expiry: offer.expiry, excluded: offer.excluded }),
    offer.signature,
  );
  if (recovered !== asset.owner) fail("The idle signature is no longer valid.");
  offer.uses += 1;
  if (offer.maxUses !== 0 && offer.uses >= offer.maxUses) {
    registry.idles = registry.idles.filter((item) => item.assetId !== assetId);
  }
}

async function authorizePiece(registry: Registry, assetId: string, role: Role, signer: string, characterIds: string[], ms: number) {
  const asset = mustAsset(registry, assetId);
  if (asset.role !== role) fail(`The ${role} slot needs an NFT of that role.`);
  if (asset.owner === signer) return asset;
  await consumeIdle(registry, assetId, role, characterIds, ms);
  return asset;
}

export function eligibleIdle(registry: Registry, role: Role, banned: string[], characterIds: string[], ms: number): IdleOffer[] {
  return registry.idles
    .filter((offer) => {
      if (offer.role !== role || banned.includes(offer.assetId)) return false;
      const asset = registry.assets.find((item) => item.id === offer.assetId);
      if (!asset || asset.owner !== offer.owner) return false;
      if (offer.maxUses !== 0 && offer.uses >= offer.maxUses) return false;
      if (offer.expiry !== 0 && offer.expiry <= unix(ms)) return false;
      const excluded = offer.excluded ? offer.excluded.split(",") : [];
      return !characterIds.some((id) => excluded.includes(id));
    })
    .sort((a, b) => a.assetId.localeCompare(b.assetId));
}

function writeClosure(
  registry: Registry,
  input: {
    conversation: Conversation;
    responder: Asset | null;
    base: Asset;
    encoder: Asset;
    drawSeed: Hex | null;
    by: string;
    ms: number;
  },
): string {
  const { conversation } = input;
  const block = blockAt(registry, input.ms);
  const initiator = mustAsset(registry, conversation.characterId);
  const points = POINTS[conversation.kind];
  registry.seq += 1;
  const id = `k-${block}-${registry.seq}`;
  registry.closures.push({
    id,
    kind: conversation.kind,
    convId: conversation.id,
    initiatorId: initiator.id,
    responderId: input.responder?.id ?? null,
    baseId: input.base.id,
    encoderId: input.encoder.id,
    initiatorWallet: initiator.owner,
    responderWallet: input.responder?.owner ?? null,
    baseWallet: input.base.owner,
    encoderWallet: input.encoder.owner,
    pointsInitiator: points.initiator,
    pointsResponder: points.responder,
    pointsBase: points.base,
    pointsEncoder: points.encoder,
    drawSeed: input.drawSeed,
    block,
    at: input.ms,
  });
  conversation.status = "closed";
  conversation.closureId = id;
  conversation.baseId = input.base.id;
  conversation.encoderId = input.encoder.id;
  conversation.responderId = input.responder?.id ?? null;
  conversation.draw = null;
  cipherLines(registry, conversation);
  openKey(registry, input.base.id, block);
  log(registry, "Closed", conversation.id, input.by, input.ms);
  return id;
}

function mustOpenConversation(registry: Registry, id: string, ms: number): Conversation {
  const conversation = registry.conversations.find((item) => item.id === id);
  if (!conversation) fail("Unknown opening.");
  if (conversation.status !== "open") fail("That opening is no longer open.");
  if (conversation.deadline <= unix(ms)) fail("That opening is past its deadline.");
  return conversation;
}

async function assertOpeningFresh(registry: Registry, conversation: Conversation) {
  const character = mustAsset(registry, conversation.characterId);
  if (character.owner !== conversation.opener) fail("The opening character changed hands. The opening signature no longer counts.");
  for (const id of [conversation.baseId, conversation.encoderId]) {
    if (id && mustAsset(registry, id).owner !== conversation.opener) fail("The attached piece changed hands.");
  }
  const opening = registry.lines.find((line) => line.convId === conversation.id && !line.replyTo);
  if (!opening) fail("The opening line is missing.");
  const recovered = await recover(
    openSpec({
      character: conversation.characterId,
      base: conversation.baseId ?? "",
      encoder: conversation.encoderId ?? "",
      line: opening.commit,
      deadline: conversation.deadline,
      nonce: conversation.nonce,
    }),
    conversation.signature,
  );
  if (recovered !== character.owner) fail("Opening signature is no longer valid.");
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
    conversation.draw = null;
    expired.push(conversation.id);
    log(registry, "Expired", conversation.id, "relayer", ms);
  }
  return expired;
}

export async function settleDraw(registry: Registry, convId: string, ms: number, minMs = DRAW_MS): Promise<Result> {
  return run(async () => {
    const conversation = mustOpenConversation(registry, convId, ms);
    const pending = conversation.draw;
    if (!pending) fail("No draw is waiting on this opening.");
    if (ms - pending.requestedAt < minMs) fail("The relayer callback is not ready yet.");
    await assertOpeningFresh(registry, conversation);
    const empty: Role = conversation.baseId ? "encoder" : "base";
    const responder = mustAsset(registry, pending.responderId);
    if (responder.owner !== pending.address) {
      conversation.draw = null;
      fail("The responding character changed hands.");
    }
    const pool = eligibleIdle(
      registry,
      empty,
      [conversation.characterId, conversation.baseId, conversation.encoderId, responder.id].filter((id): id is string => Boolean(id)),
      [conversation.characterId, responder.id],
      ms,
    );
    if (!pool.length) {
      conversation.draw = null;
      fail("The idle pool is empty for the missing slot. Offers were not consumed.");
    }
    const seed = keccak256(stringToHex(`${convId}:${pending.signature}:${blockAt(registry, ms)}`));
    const chosen = pool[Number(BigInt(seed) % BigInt(pool.length))]!;
    await consumeIdle(registry, chosen.assetId, empty, [conversation.characterId, responder.id], ms);
    const drawn = mustAsset(registry, chosen.assetId);
    const base = empty === "base" ? drawn : mustAsset(registry, conversation.baseId!);
    const encoder = empty === "encoder" ? drawn : mustAsset(registry, conversation.encoderId!);
    distinct([conversation.characterId, responder.id, base.id, encoder.id]);
    writeClosure(registry, { conversation, responder, base, encoder, drawSeed: seed, by: "relayer", ms });
    return { note: `Callback included. ${empty === "base" ? "Base" : "Encoder"} #${drawn.tokenId} drawn from the idle pool.`, refId: convId };
  });
}

export async function settleRipe(registry: Registry, ms: number): Promise<string[]> {
  const settled: string[] = [];
  for (const conversation of registry.conversations) {
    if (conversation.status !== "open" || !conversation.draw) continue;
    if (ms - conversation.draw.requestedAt < DRAW_MS) continue;
    const result = await settleDraw(registry, conversation.id, ms);
    if (result.ok) settled.push(conversation.id);
  }
  return settled;
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
    const chars = granted.filter((asset) => asset.role === "character").length;
    const bases = granted.filter((asset) => asset.role === "base").length;
    const encoders = granted.filter((asset) => asset.role === "encoder").length;
    return { note: `Wallet signed in. ${chars} characters, ${bases} bases, and ${encoders} encoders are now on this address.` };
  });
}

export async function submitIdle(
  registry: Registry,
  input: { nft: string; role: string; nonce: number; maxUses: number; expiry: number; excluded: string; signature: string },
  ms: number,
): Promise<Result> {
  return run(async () => {
    if (input.role !== "base" && input.role !== "encoder") fail("Only a base or an encoder can sit idle.");
    const asset = mustAsset(registry, input.nft);
    if (asset.role !== input.role) fail("The signed role does not match the NFT.");
    if (!Number.isInteger(input.maxUses) || input.maxUses < 0) fail("Max uses must be a whole number.");
    if (input.expiry !== 0 && input.expiry <= unix(ms)) fail("That expiry is already in the past.");
    const excluded = canonicalExcluded(input.excluded.split(","));
    if (excluded !== input.excluded) fail("Excluded ids must be sorted and unique.");
    for (const id of excluded ? excluded.split(",") : []) {
      if (mustAsset(registry, id).role !== "character") fail("Only characters can be excluded.");
    }
    const recovered = await recover(
      idleSpec({ nft: input.nft, role: input.role, nonce: input.nonce, maxUses: input.maxUses, expiry: input.expiry, excluded }),
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
      excluded,
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

export async function submitOpen(
  registry: Registry,
  input: { character: string; base: string; encoder: string; plaintext: string; deadline: number; nonce: number; signature: string },
  ms: number,
): Promise<Result> {
  return run(async () => {
    const block = blockAt(registry, ms);
    if (Boolean(input.base) === Boolean(input.encoder)) {
      fail("An opening leaves exactly one slot empty. To bring both pieces, use a complete offer.");
    }
    const now = unix(ms);
    const slack = 90;
    if (input.deadline < now + MIN_OPEN_SECONDS - slack || input.deadline > now + MAX_OPEN_SECONDS + slack) {
      fail("The window must be between 2 minutes and 2 hours.");
    }
    const character = mustAsset(registry, input.character);
    if (character.role !== "character") fail("Only a character can open.");
    const attached = mustAsset(registry, input.base || input.encoder);
    if (attached.role !== (input.base ? "base" : "encoder")) fail("The attached piece has the wrong role.");
    distinct([input.character, input.base, input.encoder]);
    lineCheck(input.plaintext, character);
    assertCool(registry, character.id, block);
    assertCool(registry, attached.id, block);
    const commit = lineCommit(input.plaintext);
    const recovered = await recover(
      openSpec({ character: input.character, base: input.base, encoder: input.encoder, line: commit, deadline: input.deadline, nonce: input.nonce }),
      input.signature,
    );
    if (recovered !== character.owner || recovered !== attached.owner) fail("The character and the attached piece must belong to the signer.");
    bumpNonce(registry, input.character, "open", input.nonce);
    registry.seq += 1;
    const id = `op-${block}-${registry.seq}`;
    const conversation: Conversation = {
      id,
      kind: "targeted",
      characterId: input.character,
      baseId: input.base || null,
      encoderId: input.encoder || null,
      responderId: null,
      deadline: input.deadline,
      nonce: input.nonce,
      signature: input.signature as Hex,
      opener: recovered,
      status: "open",
      openedBlock: block,
      closureId: null,
      draw: null,
    };
    registry.conversations.push(conversation);
    addLine(registry, { convId: id, speakerId: character.id, replyTo: null, plaintext: input.plaintext, block });
    cipherLines(registry, conversation);
    if (input.base) openKey(registry, input.base, block);
    cool(registry, [character.id, attached.id], block);
    log(registry, "Opened", id, recovered, ms);
    return { note: `Opening included. It waits for ${input.base ? "an encoder" : "a base"} and another character.`, refId: id };
  });
}

function lineCheck(plaintext: string, speaker: Asset) {
  const chars = Array.from(plaintext);
  if (chars.length === 0) fail("Compose at least one glyph.");
  if (chars.length > MAX_GLYPHS) fail(`A line holds at most ${MAX_GLYPHS} glyphs.`);
  const owned = new Set(speakable(speaker.tokenId));
  if (chars.some((ch) => !owned.has(ch))) fail("A character speaks only with glyphs from its own grid.");
}

export async function submitRespond(
  registry: Registry,
  input: { openId: string; character: string; base: string; encoder: string; plaintext: string; signature: string },
  ms: number,
): Promise<Result> {
  return run(async () => {
    const block = blockAt(registry, ms);
    const conversation = mustOpenConversation(registry, input.openId, ms);
    await assertOpeningFresh(registry, conversation);
    if (conversation.draw) fail("A draw is already waiting on this opening.");
    if (conversation.baseId && input.base) fail("The base slot is already filled.");
    if (conversation.encoderId && input.encoder) fail("The encoder slot is already filled.");
    const empty: Role = conversation.baseId ? "encoder" : "base";
    const supplied = empty === "base" ? input.base : input.encoder;
    const responder = mustAsset(registry, input.character);
    if (responder.role !== "character") fail("Only a character can respond.");
    if (responder.id === conversation.characterId) fail("The same character cannot answer itself.");
    lineCheck(input.plaintext, responder);
    assertCool(registry, responder.id, block);
    const commit = lineCommit(input.plaintext);
    const recovered = await recover(
      respondSpec({ openId: input.openId, character: input.character, base: input.base, encoder: input.encoder, line: commit }),
      input.signature,
    );
    if (recovered !== responder.owner) fail("The signature is not from the character's holder.");
    const opening = registry.lines.find((line) => line.convId === conversation.id && !line.replyTo);
    addLine(registry, { convId: conversation.id, speakerId: responder.id, replyTo: opening?.id ?? null, plaintext: input.plaintext, block });
    cool(registry, [responder.id], block);
    if (!supplied) {
      conversation.draw = { responderId: responder.id, address: recovered, signature: input.signature as Hex, requestedAt: ms };
      conversation.responderId = responder.id;
      return { note: "Response included. The relayer draws the missing piece from the idle pool: wait for the callback.", refId: conversation.id };
    }
    const chosen = await authorizePiece(registry, supplied, empty, recovered, [conversation.characterId, responder.id], ms);
    const base = empty === "base" ? chosen : mustAsset(registry, conversation.baseId!);
    const encoder = empty === "encoder" ? chosen : mustAsset(registry, conversation.encoderId!);
    distinct([conversation.characterId, responder.id, base.id, encoder.id]);
    writeClosure(registry, { conversation, responder, base, encoder, drawSeed: null, by: recovered, ms });
    cool(registry, [chosen.id], block);
    return { note: "Conversation closed. 3 / 3 / 1 / 1 points sit on the NFTs.", refId: conversation.id };
  });
}

export async function submitComplete(
  registry: Registry,
  input: { character: string; base: string; encoder: string; plaintext: string; nonce: number; signature: string },
  ms: number,
): Promise<Result> {
  return run(async () => {
    const block = blockAt(registry, ms);
    distinct([input.character, input.base, input.encoder]);
    const character = mustAsset(registry, input.character);
    if (character.role !== "character") fail("A complete offer starts from a character.");
    lineCheck(input.plaintext, character);
    assertCool(registry, character.id, block);
    const commit = lineCommit(input.plaintext);
    const recovered = await recover(
      completeSpec({ character: input.character, base: input.base, encoder: input.encoder, line: commit, nonce: input.nonce }),
      input.signature,
    );
    if (recovered !== character.owner) fail("The character does not belong to the signer.");
    const base = await authorizePiece(registry, input.base, "base", recovered, [input.character], ms);
    const encoder = await authorizePiece(registry, input.encoder, "encoder", recovered, [input.character], ms);
    bumpNonce(registry, input.character, "complete", input.nonce);
    registry.seq += 1;
    const id = `cp-${block}-${registry.seq}`;
    const conversation: Conversation = {
      id,
      kind: "complete",
      characterId: character.id,
      baseId: base.id,
      encoderId: encoder.id,
      responderId: null,
      deadline: unix(ms),
      nonce: input.nonce,
      signature: input.signature as Hex,
      opener: recovered,
      status: "open",
      openedBlock: block,
      closureId: null,
      draw: null,
    };
    registry.conversations.push(conversation);
    addLine(registry, { convId: id, speakerId: character.id, replyTo: null, plaintext: input.plaintext, block });
    log(registry, "Opened", id, recovered, ms);
    writeClosure(registry, { conversation, responder: null, base, encoder, drawSeed: null, by: recovered, ms });
    cool(registry, [character.id, encoder.id], block);
    return { note: "Complete offer closed. Reduced weight: 1 point per piece.", refId: id };
  });
}

export async function submitTransfer(
  registry: Registry,
  input: { nft: string; recipient: string; nonce: number; signature: string },
  ms: number,
): Promise<Result> {
  return run(async () => {
    const asset = mustAsset(registry, input.nft);
    const recipient = normAddress(input.recipient);
    if (recipient === asset.owner) fail("That NFT is already at this address.");
    const recovered = await recover(transferSpec({ nft: input.nft, recipient, nonce: input.nonce }), input.signature);
    if (recovered !== asset.owner) fail("Only the current holder can transfer.");
    bumpNonce(registry, input.nft, "transfer", input.nonce);
    asset.owner = recipient;
    registry.idles = registry.idles.filter((offer) => offer.assetId !== input.nft);
    log(registry, "Transfer", input.nft, recovered, ms);
    return { note: "Holder updated. Earlier signatures on this NFT no longer count.", refId: input.nft };
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
