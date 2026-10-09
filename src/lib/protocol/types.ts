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

/** A talk has two sides. Each side is a character, a base, and an encoder, possibly from different holders. */
export type SideName = "talk" | "answer";
export type Slot = "character" | "base" | "encoder";

/**
 * How a piece took its seat: in the character's own signature (speaker), by its holder joining the
 * waiting room (joined), or taken by the relayer from an idle offer (pool).
 */
export type Bringer = "speaker" | "joined" | "pool";

export type Seat = { id: string; holder: string; by: Bringer; signature: Hex | null };

export type Side = Record<Slot, Seat | null>;

export type ConversationStatus = "open" | "closed" | "expired";

export type Conversation = {
  id: string;
  talk: Side;
  answer: Side;
  /** The dialect of the talk encoder. The answer encoder must speak the same one. */
  dialect: Dialect | null;
  deadline: number;
  nonce: number;
  status: ConversationStatus;
  openedBlock: number;
  /** Last block a seat changed: the relayer fills empty seats from the pool after a while. */
  movedBlock: number;
  closureId: string | null;
};

/** One line on the wall. Plaintext stays in this client; the wall shows the ciphertext only. */
export type Line = {
  id: string;
  convId: string;
  side: SideName;
  speakerId: string;
  replyTo: string | null;
  plaintext: string;
  commit: Hex;
  dialect: Dialect | null;
  ciphertext: string | null;
  block: number;
};

export type Seats<T> = Record<SideName, Record<Slot, T>>;

export type Closure = {
  id: string;
  convId: string;
  pieces: Seats<string>;
  wallets: Seats<string>;
  points: Seats<number>;
  /** The answering character is held by the opener's own wallet. */
  self: boolean;
  block: number;
  at: number;
};

export type LogKind = "IdleOffer" | "Revoke" | "Opened" | "Answered" | "Joined" | "Pooled" | "Closed" | "Expired" | "Delegate" | "Linked";

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
  version: 3;
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

export const SIDES: SideName[] = ["talk", "answer"];
export const SLOTS: Slot[] = ["character", "base", "encoder"];
