import { isAddress } from "viem";
import { create } from "zustand";
import { piece, type Role } from "@/lib/trace/catalog";
import { answer } from "@/lib/trace/portrait";
import {
  canonicalExcluded,
  completeSpec,
  idleSpec,
  lineCommit,
  linkSpec,
  openSpec,
  respondSpec,
  revokeSpec,
  delegateSpec,
} from "@/lib/protocol/domain";
import { ambient, chooseResponder, createGenesis, npcRespond } from "@/lib/protocol/network";
import {
  BLOCK_MS,
  GENESIS_BLOCK,
  blockAt,
  cooling,
  eligibleIdle,
  nextNonce,
  renewKey,
  settleDraw,
  submitComplete,
  submitIdle,
  submitLink,
  submitOpen,
  submitRespond,
  submitRevoke,
  submitDelegate,
  unix,
} from "@/lib/protocol/relayer";
import type { Registry, Result } from "@/lib/protocol/types";
import { useWallet } from "@/lib/wallet/store";

const STORE_KEY = "traceformers-terminal.registry.v1";
const REPLY_MS = 2600;
const CATCH_UP = 48;

export type View = "wall" | "graph" | "pool" | "board";
/** Where a note belongs: it is shown under the section that produced it. */
export type Scope = "terminal" | "talk" | "wallet" | "pool-offer" | "pool-delegate" | "footer";
export type Answerer = "network" | "mine";

type AppState = {
  registry: Registry | null;
  now: number;
  view: View;
  talkId: string | null;
  detailId: string | null;
  note: { text: string; tone: "ok" | "error"; scope: Scope } | null;
  pending: boolean;
  awaiting: string | null;
  answerTarget: string | null;
  sheet: boolean;
};

export const useApp = create<AppState>(() => ({
  registry: null,
  now: Date.now(),
  view: "wall",
  talkId: null,
  detailId: null,
  note: null,
  pending: false,
  awaiting: null,
  answerTarget: null,
  sheet: false,
}));

// Every change to the registry goes through one queue: a draft is cloned, the relayer works on it,
// and the draft replaces the registry only when the work succeeded (or always, for upkeep).
let queue: Promise<unknown> = Promise.resolve();

function mutate<T>(work: (draft: Registry, ms: number) => Promise<T>, commit: (out: T) => boolean): Promise<T> {
  const next = queue.then(async () => {
    const current = useApp.getState().registry;
    if (!current) throw new Error("The registry is still loading.");
    const draft = structuredClone(current);
    const out = await work(draft, Date.now());
    if (commit(out)) useApp.setState({ registry: draft });
    return out;
  });
  queue = next.catch(() => undefined);
  return next;
}

function submit(work: (draft: Registry, ms: number) => Promise<Result> | Result): Promise<Result> {
  return mutate(async (draft, ms) => work(draft, ms), (out) => out.ok);
}

function say(result: Result, scope: Scope) {
  useApp.setState({ note: result.ok ? { text: result.note, tone: "ok", scope } : { text: result.error, tone: "error", scope } });
  return result;
}

async function signed(scope: Scope, task: () => Promise<Result>): Promise<Result> {
  useApp.setState({ pending: true, note: null });
  try {
    return say(await task(), scope);
  } catch (err) {
    return say({ ok: false, error: err instanceof Error ? err.message : "The request failed." }, scope);
  } finally {
    useApp.setState({ pending: false });
  }
}

function registryNow(): Registry {
  const registry = useApp.getState().registry;
  if (!registry) throw new Error("The registry is still loading.");
  return registry;
}

// ---------------------------------------------------------------------------------------------------------
// Boot, persistence, and the block loop.

function load(): Registry | null {
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Registry;
    if (parsed?.version !== 1 || !Array.isArray(parsed.assets) || !Array.isArray(parsed.closures)) return null;
    // Registries saved by earlier builds: no handles yet, and delegation was logged as a transfer.
    parsed.handles ??= {};
    for (const row of parsed.log) if ((row.kind as string) === "Transfer") row.kind = "Delegate";
    return parsed;
  } catch {
    return null;
  }
}

let saveTimer = 0;
function save(registry: Registry) {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    try {
      window.localStorage.setItem(STORE_KEY, JSON.stringify(registry));
    } catch {
      /* storage full or blocked: the registry lives for this tab only */
    }
  }, 400);
}

async function advance() {
  const registry = useApp.getState().registry;
  if (!registry) return;
  const target = blockAt(registry, Date.now());
  if (target <= registry.cursor) return;
  const me = useWallet.getState().address;
  const drawing = registry.conversations.filter((item) => item.draw && item.draw.address === me).map((item) => item.id);
  await mutate(
    async (draft) => {
      for (let block = Math.max(draft.cursor + 1, target - CATCH_UP); block <= target; block++) {
        const ms = draft.epoch + (block - GENESIS_BLOCK) * BLOCK_MS + 500;
        await ambient(draft, block, Math.min(ms, Date.now()));
      }
      draft.cursor = target;
    },
    () => true,
  );
  const after = useApp.getState().registry;
  for (const id of drawing) {
    const conversation = after?.conversations.find((item) => item.id === id);
    if (!conversation || conversation.draw) continue;
    say(
      conversation.status === "closed"
        ? { ok: true, note: `Callback included for ${id}: the relayer drew the missing piece and the talk is closed.` }
        : { ok: false, error: `The draw for ${id} found no eligible idle piece. Offers were not consumed.` },
      "terminal",
    );
  }
}

export function bootApp(): () => void {
  const fromHash = () => {
    const hash = window.location.hash.replace("#", "") as View;
    if (["wall", "graph", "pool", "board"].includes(hash)) useApp.setState({ view: hash });
  };
  fromHash();
  window.addEventListener("hashchange", fromHash);
  let alive = true;
  (async () => {
    const stored = load();
    const registry = stored ?? (await createGenesis(Date.now()));
    if (!alive) return;
    useApp.setState({ registry, now: Date.now() });
    await advance();
  })();
  const unsub = useApp.subscribe((state, prev) => {
    if (state.registry && state.registry !== prev.registry) save(state.registry);
  });
  const id = window.setInterval(() => {
    useApp.setState({ now: Date.now() });
    void advance();
  }, 1000);
  return () => {
    alive = false;
    window.clearInterval(id);
    window.removeEventListener("hashchange", fromHash);
    unsub();
  };
}

export async function resetRegistry() {
  const registry = await createGenesis(Date.now());
  await mutate(
    async (draft) => {
      Object.assign(draft, registry);
    },
    () => true,
  );
  useApp.setState({ talkId: null, detailId: null, note: { text: "Local registry reset to genesis.", tone: "ok", scope: "footer" } });
}

// ---------------------------------------------------------------------------------------------------------
// UI state.

export function setView(view: View) {
  useApp.setState({ view, note: null });
  if (window.location.hash !== `#${view}`) window.history.replaceState(null, "", `#${view}`);
}

/** Open a talk in the floating window, from any view. */
export function openTalk(convId: string | null) {
  useApp.setState({ talkId: convId });
}

export const showConversation = openTalk;

/** Point the terminal at an open conversation to answer it. */
export function setAnswerTarget(convId: string | null) {
  useApp.setState({ answerTarget: convId });
  if (convId) window.requestAnimationFrame(() => document.getElementById("terminal")?.scrollIntoView({ behavior: "smooth", block: "start" }));
}

export function selectDetail(id: string | null) {
  useApp.setState({ detailId: id });
}

export function setSheet(sheet: boolean) {
  useApp.setState({ sheet });
}

export function dismissNote() {
  useApp.setState({ note: null });
}

// ---------------------------------------------------------------------------------------------------------
// Signed actions of the connected wallet.

function wallet() {
  const state = useWallet.getState();
  if (!state.address) throw new Error("Connect a wallet before signing.");
  return state;
}

export function linkWallet() {
  return signed("wallet", async () => {
    const { address, signTyped } = wallet();
    const signature = await signTyped(linkSpec(address!));
    return submit((draft, ms) => submitLink(draft, { address: address!, signature }, ms));
  });
}

export function openConversation(input: { characterId: string; attachedId: string; plaintext: string; seconds: number; answerer: Answerer }) {
  return signed("terminal", async () => {
    const { signTyped } = wallet();
    const registry = registryNow();
    const role = piece(input.attachedId)!.role;
    const message = {
      character: input.characterId,
      base: role === "base" ? input.attachedId : "",
      encoder: role === "encoder" ? input.attachedId : "",
      deadline: unix(Date.now()) + input.seconds,
      nonce: nextNonce(registry, input.characterId, "open"),
    };
    const signature = await signTyped(openSpec({ ...message, line: lineCommit(input.plaintext) }));
    const result = await submit((draft, ms) => submitOpen(draft, { ...message, plaintext: input.plaintext, signature }, ms));
    if (result.ok && result.refId) {
      useApp.setState({ talkId: result.refId, awaiting: result.refId });
      window.setTimeout(() => void autoAnswer(result.refId!, input.answerer), REPLY_MS);
    }
    return result;
  });
}

/** The answer comes by itself: a network character, or your other character signing with your wallet. */
async function autoAnswer(convId: string, answerer: Answerer) {
  try {
    if (answerer === "mine") {
      await answerWithMine(convId);
      return;
    }
    const result = await submit(async (draft, ms) => {
      const conversation = draft.conversations.find((item) => item.id === convId);
      if (!conversation || conversation.status !== "open" || conversation.draw) return { ok: false, error: "That opening is no longer waiting." };
      const choice = chooseResponder(draft, conversation, ms);
      if (!choice) return { ok: false, error: "No network character is free to answer right now. Your opening stays open until its deadline." };
      return npcRespond(draft, conversation, choice.responderId, choice.pieceId, ms);
    });
    say(result, "terminal");
  } finally {
    if (useApp.getState().awaiting === convId) useApp.setState({ awaiting: null });
  }
}

async function answerWithMine(convId: string) {
  const registry = registryNow();
  const { address } = wallet();
  const conversation = registry.conversations.find((item) => item.id === convId);
  if (!conversation) return;
  const block = blockAt(registry, Date.now());
  const other = registry.assets.find(
    (asset) => asset.owner === address && asset.role === "character" && asset.id !== conversation.characterId && cooling(registry, asset.id, block) === 0,
  );
  if (!other) {
    say({ ok: false, error: "Your other character is cooling down. The opening stays open for the network." }, "terminal");
    return;
  }
  const empty: Role = conversation.baseId ? "encoder" : "base";
  const own = registry.assets.find((asset) => asset.owner === address && asset.role === empty && cooling(registry, asset.id, block) === 0);
  const opening = registry.lines.find((line) => line.convId === convId && !line.replyTo);
  const plaintext = answer(opening?.plaintext ?? "█", other.tokenId).slice(0, 6);
  await respondTo({ convId, characterId: other.id, pieceId: own?.id ?? "", plaintext });
}

export function respondTo(input: { convId: string; characterId: string; pieceId: string; plaintext: string }) {
  return signed("terminal", async () => {
    const { signTyped } = wallet();
    const registry = registryNow();
    const conversation = registry.conversations.find((item) => item.id === input.convId);
    if (!conversation) return { ok: false, error: "Unknown opening." };
    const empty: Role = conversation.baseId ? "encoder" : "base";
    const message = {
      openId: input.convId,
      character: input.characterId,
      base: empty === "base" ? input.pieceId : "",
      encoder: empty === "encoder" ? input.pieceId : "",
    };
    const signature = await signTyped(respondSpec({ ...message, line: lineCommit(input.plaintext) }));
    const result = await submit((draft, ms) => submitRespond(draft, { ...message, plaintext: input.plaintext, signature }, ms));
    if (result.ok) useApp.setState({ talkId: input.convId });
    return result;
  });
}

export function includeCallback(convId: string) {
  return signed("talk", async () => submit((draft, ms) => settleDraw(draft, convId, ms, 2000)));
}

export function completeConversation(input: { characterId: string; baseId: string; encoderId: string; plaintext: string }) {
  return signed("terminal", async () => {
    const { signTyped } = wallet();
    const registry = registryNow();
    const message = { character: input.characterId, base: input.baseId, encoder: input.encoderId, nonce: nextNonce(registry, input.characterId, "complete") };
    const signature = await signTyped(completeSpec({ ...message, line: lineCommit(input.plaintext) }));
    const result = await submit((draft, ms) => submitComplete(draft, { ...message, plaintext: input.plaintext, signature }, ms));
    if (result.ok && result.refId) useApp.setState({ talkId: result.refId });
    return result;
  });
}

export function offerIdle(input: { assetId: string; maxUses: number; days: number; excluded: string }) {
  return signed("pool-offer", async () => {
    const { signTyped } = wallet();
    const registry = registryNow();
    const message = {
      nft: input.assetId,
      role: piece(input.assetId)!.role,
      nonce: nextNonce(registry, input.assetId, "offer"),
      maxUses: input.maxUses,
      expiry: input.days > 0 ? unix(Date.now()) + Math.round(input.days * 86400) : 0,
      excluded: canonicalExcluded(input.excluded.split(",")),
    };
    const signature = await signTyped(idleSpec(message));
    return submit((draft, ms) => submitIdle(draft, { ...message, signature }, ms));
  });
}

export function revokeIdle(assetId: string) {
  return signed("pool-offer", async () => {
    const { signTyped } = wallet();
    const message = { nft: assetId, nonce: nextNonce(registryNow(), assetId, "offer") };
    const signature = await signTyped(revokeSpec(message));
    return submit((draft, ms) => submitRevoke(draft, { ...message, signature }, ms));
  });
}

export function delegatePiece(assetId: string, to: string) {
  return signed("pool-delegate", async () => {
    const { signTyped, address } = wallet();
    const target = to.trim();
    if (!isAddress(target)) return { ok: false, error: "That is not an Ethereum address: 0x followed by 40 hex characters." };
    if (target.toLowerCase() === address) return { ok: false, error: "That is your own address: the piece is already yours." };
    const message = { nft: assetId, to: target, nonce: nextNonce(registryNow(), assetId, "delegate") };
    const signature = await signTyped(delegateSpec(message));
    return submit((draft, ms) => submitDelegate(draft, { ...message, signature }, ms));
  });
}

/** Attach an X username to the connected address, so a shared talk can tag it. */
export async function setHandle(handle: string) {
  const value = handle.trim().replace(/^@/, "");
  if (value && !/^[A-Za-z0-9_]{1,15}$/.test(value)) {
    return say({ ok: false, error: "An X username has 1 to 15 letters, digits, or underscores." }, "wallet");
  }
  const address = useWallet.getState().address;
  if (!address) return say({ ok: false, error: "Connect a wallet first." }, "wallet");
  await mutate(
    async (draft) => {
      if (value) draft.handles[address] = value;
      else delete draft.handles[address];
    },
    () => true,
  );
  return say({ ok: true, note: value ? `Shared talks will tag @${value} for your pieces.` : "X username removed." }, "wallet");
}

export function openKeyOf(baseId: string) {
  return signed("terminal", async () => {
    const { address } = wallet();
    return submit((draft, ms) => renewKey(draft, baseId, address!, ms));
  });
}

export { eligibleIdle };
