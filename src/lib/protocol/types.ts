import type { Hex } from "viem";
import type { Dialect, Role } from "@/lib/trace/catalog";

/** A Trace piece as the registry sees it: who holds it now. Art and traits come from the catalog. */
export type Asset = {
  id: string;
  role: Role;
  tokenId: number;
  /** Lowercase address, or "" while the piece is unclaimed in this registry. */
  owner: string;
};

export type IdleOffer = {
  assetId: string;
  role: Role;
  nonce: number;
  maxUses: number;
  uses: number;
  expiry: number;
  /** Characters allowed to use the piece, comma-separated registry ids. Empty: any character. */
  allowed: string;
  signature: Hex;
  owner: string;
};

export type ConversationStatus = "open" | "closed" | "expired";

export type PendingDraw = {
  responderId: string;
  address: string;
  signature: Hex;
  requestedAt: number;
};

/** An opening (targeted) or a complete offer. Both carry the lines that were spoken. */
export type Conversation = {
  id: string;
  kind: "targeted" | "complete";
  characterId: string;
  baseId: string | null;
  encoderId: string | null;
  responderId: string | null;
  deadline: number;
  nonce: number;
  signature: Hex;
  opener: string;
  status: ConversationStatus;
  openedBlock: number;
  closureId: string | null;
  draw: PendingDraw | null;
};

/** One line on the wall. Plaintext stays in this client; the wall shows the ciphertext only. */
export type Line = {
  id: string;
  convId: string;
  speakerId: string;
  replyTo: string | null;
  plaintext: string;
  commit: Hex;
  dialect: Dialect | null;
  ciphertext: string | null;
  block: number;
};

export type Closure = {
  id: string;
  kind: "targeted" | "complete";
  convId: string;
  initiatorId: string;
  responderId: string | null;
  baseId: string;
  encoderId: string;
  initiatorWallet: string;
  responderWallet: string | null;
  baseWallet: string;
  encoderWallet: string;
  pointsInitiator: number;
  pointsResponder: number;
  pointsBase: number;
  pointsEncoder: number;
  drawSeed: Hex | null;
  block: number;
  at: number;
};

export type LogKind = "IdleOffer" | "Revoke" | "Opened" | "Closed" | "Expired" | "Delegate" | "Linked";

export type LogRow = {
  id: number;
  kind: LogKind;
  refId: string;
  block: number;
  at: number;
  by: string;
};

/** A base holds the key of its thread open for a window of blocks. */
export type KeyWindow = { baseId: string; openedAt: number; window: number };

export type Registry = {
  version: 1;
  epoch: number;
  assets: Asset[];
  idles: IdleOffer[];
  conversations: Conversation[];
  lines: Line[];
  closures: Closure[];
  log: LogRow[];
  nonces: Record<string, number>;
  keys: KeyWindow[];
  cooldowns: Record<string, number>;
  labels: Record<string, string>;
  /** X usernames that holders attached to their address, used to tag them when a talk is shared. */
  handles: Record<string, string>;
  links: string[];
  grants: string[];
  seq: number;
  /** Last block the network loop has processed. */
  cursor: number;
};

export type Result = { ok: true; note: string; refId?: string } | { ok: false; error: string };
