import { getAddress, keccak256, stringToHex, type Address, type Hex } from "viem";

export const CHAIN_ID = 1;
export const VERIFYING_CONTRACT: Address = getAddress("0x000000000000000000000000000000000000c011");

export const DOMAIN = {
  name: "Traceformers Terminal",
  version: "1",
  chainId: CHAIN_ID,
  verifyingContract: VERIFYING_CONTRACT,
} as const;

export const LINK_STATEMENT = "Hold Trace pieces in Traceformers Terminal. No fee, no transaction.";

/** Seconds. An opening waits at most two hours for its missing piece. */
export const MAX_OPEN_SECONDS = 7200;
export const MIN_OPEN_SECONDS = 120;

/**
 * Each side of a closed talk pays its pieces. The two characters earn 3 each, every base and encoder 1.
 * When the answering character is held by the opener's own wallet, that wallet is talking to itself:
 * the talk character earns 1 and the answer side earns nothing for that wallet.
 */
export const POINTS = {
  character: 3,
  piece: 1,
  selfTalk: 1,
} as const;

export const linkTypes = {
  LinkWallet: [
    { name: "wallet", type: "address" },
    { name: "statement", type: "string" },
  ],
} as const;

export const idleTypes = {
  IdleOffer: [
    { name: "nft", type: "string" },
    { name: "role", type: "string" },
    { name: "nonce", type: "uint256" },
    { name: "maxUses", type: "uint256" },
    { name: "expiry", type: "uint256" },
    { name: "allowed", type: "string" },
  ],
} as const;

export const revokeTypes = {
  Revoke: [
    { name: "nft", type: "string" },
    { name: "nonce", type: "uint256" },
  ],
} as const;

export const openTypes = {
  Open: [
    { name: "character", type: "string" },
    { name: "base", type: "string" },
    { name: "encoder", type: "string" },
    { name: "line", type: "bytes32" },
    { name: "deadline", type: "uint256" },
    { name: "nonce", type: "uint256" },
  ],
} as const;

export const answerTypes = {
  Answer: [
    { name: "openId", type: "string" },
    { name: "character", type: "string" },
    { name: "base", type: "string" },
    { name: "encoder", type: "string" },
    { name: "line", type: "bytes32" },
  ],
} as const;

/** A base or encoder holder takes an empty seat on one side of a talk, from the waiting room. */
export const joinTypes = {
  Join: [
    { name: "openId", type: "string" },
    { name: "side", type: "string" },
    { name: "nft", type: "string" },
    { name: "nonce", type: "uint256" },
  ],
} as const;

/** Hands the signing rights of a piece to another address inside this registry. Not a sale, not an Ethereum transfer. */
export const delegateTypes = {
  Delegate: [
    { name: "nft", type: "string" },
    { name: "to", type: "address" },
    { name: "nonce", type: "uint256" },
  ],
} as const;

export type TypedSpec = {
  types: Record<string, readonly { name: string; type: string }[]>;
  primaryType: string;
  message: Record<string, unknown>;
};

/** The line is never signed in clear: the signature commits to its hash. */
export function lineCommit(plaintext: string): Hex {
  return keccak256(stringToHex(`traceformers:${plaintext}`));
}

export function canonicalIds(ids: string[]): string {
  return [...new Set(ids.map((id) => id.trim()).filter(Boolean))].sort().join(",");
}

export function shortAddress(address: string): string {
  const value = address.toLowerCase();
  if (value.length < 10) return value;
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

export const linkSpec = (wallet: string): TypedSpec => ({
  types: linkTypes,
  primaryType: "LinkWallet",
  message: { wallet: getAddress(wallet), statement: LINK_STATEMENT },
});

export const idleSpec = (m: { nft: string; role: string; nonce: number; maxUses: number; expiry: number; allowed: string }): TypedSpec => ({
  types: idleTypes,
  primaryType: "IdleOffer",
  message: { ...m, nonce: BigInt(m.nonce), maxUses: BigInt(m.maxUses), expiry: BigInt(m.expiry) },
});

export const revokeSpec = (m: { nft: string; nonce: number }): TypedSpec => ({
  types: revokeTypes,
  primaryType: "Revoke",
  message: { nft: m.nft, nonce: BigInt(m.nonce) },
});

export const openSpec = (m: { character: string; base: string; encoder: string; line: Hex; deadline: number; nonce: number }): TypedSpec => ({
  types: openTypes,
  primaryType: "Open",
  message: { ...m, deadline: BigInt(m.deadline), nonce: BigInt(m.nonce) },
});

export const answerSpec = (m: { openId: string; character: string; base: string; encoder: string; line: Hex }): TypedSpec => ({
  types: answerTypes,
  primaryType: "Answer",
  message: m,
});

export const joinSpec = (m: { openId: string; side: string; nft: string; nonce: number }): TypedSpec => ({
  types: joinTypes,
  primaryType: "Join",
  message: { ...m, nonce: BigInt(m.nonce) },
});

export const delegateSpec = (m: { nft: string; to: string; nonce: number }): TypedSpec => ({
  types: delegateTypes,
  primaryType: "Delegate",
  message: { nft: m.nft, to: getAddress(m.to), nonce: BigInt(m.nonce) },
});
