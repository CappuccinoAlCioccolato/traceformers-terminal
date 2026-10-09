import { piece, padId, type Role } from "@/lib/trace/catalog";
import { shortAddress } from "./domain";
import { keyLeft } from "./relayer";
import type { Asset, Closure, Conversation, Line, Registry } from "./types";

export type GraphKind = Role | "wallet";

export type GraphNode = {
  id: string;
  kind: GraphKind;
  label: string;
  sub: string;
  points: number;
  closures: number;
  address?: string;
};

export type GraphEdge = {
  id: string;
  source: string;
  target: string;
  weight: number;
  kind: "piece" | "reply" | "custody";
};

export type RankRow = {
  id: string;
  label: string;
  sub: string;
  points: number;
  closures: number;
  tie: number;
};

export const walletNode = (address: string) => `w:${address.toLowerCase()}`;

export function walletLabel(registry: Registry, address: string): string {
  return registry.labels[address.toLowerCase()] ?? shortAddress(address);
}

export function pointsFor(asset: Asset, closures: Closure[]): { points: number; closures: number } {
  let points = 0;
  let n = 0;
  for (const closure of closures) {
    if (asset.role === "character") {
      if (closure.initiatorId === asset.id) {
        points += closure.pointsInitiator;
        n += 1;
      } else if (closure.responderId === asset.id) {
        points += closure.pointsResponder;
        n += 1;
      }
    } else if (asset.role === "base" && closure.baseId === asset.id) {
      points += closure.pointsBase;
      n += 1;
    } else if (asset.role === "encoder" && closure.encoderId === asset.id) {
      points += closure.pointsEncoder;
      n += 1;
    }
  }
  return { points, closures: n };
}

export function buildGraph(registry: Registry): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const assets = new Map(registry.assets.map((asset) => [asset.id, asset]));
  const seen = new Set<string>();
  const wallets = new Set<string>();
  const edgeMap = new Map<string, GraphEdge>();

  const addEdge = (source: string, target: string, kind: GraphEdge["kind"]) => {
    if (!source || !target || source === target) return;
    const [a, b] = source < target ? [source, target] : [target, source];
    const id = `${kind}:${a}:${b}`;
    const existing = edgeMap.get(id);
    if (existing) existing.weight += 1;
    else edgeMap.set(id, { id, source: a, target: b, weight: 1, kind });
  };

  for (const closure of registry.closures) {
    for (const id of [closure.initiatorId, closure.responderId, closure.baseId, closure.encoderId]) if (id) seen.add(id);
    addEdge(closure.initiatorId, closure.baseId, "piece");
    addEdge(closure.initiatorId, closure.encoderId, "piece");
    if (closure.responderId) {
      addEdge(closure.responderId, closure.baseId, "piece");
      addEdge(closure.responderId, closure.encoderId, "piece");
      addEdge(closure.initiatorId, closure.responderId, "reply");
    }
    const pairs: [string, string][] = [
      [closure.initiatorId, closure.initiatorWallet],
      [closure.baseId, closure.baseWallet],
      [closure.encoderId, closure.encoderWallet],
    ];
    if (closure.responderId && closure.responderWallet) pairs.push([closure.responderId, closure.responderWallet]);
    for (const [assetId, wallet] of pairs) {
      wallets.add(wallet.toLowerCase());
      addEdge(assetId, walletNode(wallet), "custody");
    }
  }

  const nodes: GraphNode[] = [];
  for (const id of seen) {
    const asset = assets.get(id);
    if (!asset) continue;
    const score = pointsFor(asset, registry.closures);
    const art = piece(id);
    const sub = art?.dialect ?? art?.form ?? "decoded";
    nodes.push({ id, kind: asset.role, label: padId(asset.tokenId), sub, points: score.points, closures: score.closures });
  }
  for (const address of wallets) {
    nodes.push({
      id: walletNode(address),
      kind: "wallet",
      label: walletLabel(registry, address),
      sub: shortAddress(address),
      points: 0,
      closures: 0,
      address,
    });
  }
  return { nodes, edges: [...edgeMap.values()] };
}

function compareRank(a: RankRow, b: RankRow): number {
  if (b.points !== a.points) return b.points - a.points;
  if (b.closures !== a.closures) return b.closures - a.closures;
  return a.tie - b.tie;
}

export function ranksForRole(registry: Registry, role: Role): RankRow[] {
  return registry.assets
    .filter((asset) => asset.role === role && asset.owner)
    .map((asset) => {
      const score = pointsFor(asset, registry.closures);
      return {
        id: asset.id,
        label: padId(asset.tokenId),
        sub: `${role === "character" ? "" : `${piece(asset.id)?.dialect ?? piece(asset.id)?.form} · `}held by ${registry.handles[asset.owner] ? `@${registry.handles[asset.owner]}` : walletLabel(registry, asset.owner)}`,
        points: score.points,
        closures: score.closures,
        tie: asset.tokenId,
      };
    })
    .filter((row) => row.closures > 0)
    .sort(compareRank);
}

/** The wallet view sums what each address holds now. It is a current view, not a credit that moves. */
export function ranksForWallets(registry: Registry, role: Role): RankRow[] {
  const buckets = new Map<string, RankRow>();
  for (const asset of registry.assets) {
    if (asset.role !== role || !asset.owner) continue;
    const score = pointsFor(asset, registry.closures);
    if (score.closures === 0) continue;
    const current = buckets.get(asset.owner) ?? {
      id: asset.owner,
      label: walletLabel(registry, asset.owner),
      sub: "",
      points: 0,
      closures: 0,
      tie: 0,
    };
    current.points += score.points;
    current.closures += score.closures;
    current.tie += 1;
    buckets.set(asset.owner, current);
  }
  for (const row of buckets.values()) {
    const handle = registry.handles[row.id];
    row.sub = `${handle ? `@${handle} · ` : ""}sum of the ${row.tie} ${role}${row.tie === 1 ? "" : "s"} it holds now`;
  }
  return [...buckets.values()].sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    if (b.closures !== a.closures) return b.closures - a.closures;
    return a.id.localeCompare(b.id);
  });
}

export function closuresTouching(registry: Registry, nodeId: string): Closure[] {
  const rows = registry.closures.filter((closure) => {
    if (nodeId.startsWith("w:")) {
      const address = nodeId.slice(2);
      return [closure.initiatorWallet, closure.responderWallet, closure.baseWallet, closure.encoderWallet].some(
        (wallet) => wallet?.toLowerCase() === address,
      );
    }
    return [closure.initiatorId, closure.responderId, closure.baseId, closure.encoderId].includes(nodeId);
  });
  return rows.sort((a, b) => b.block - a.block || b.at - a.at);
}

export function roleInClosure(nodeId: string, closure: Closure): string {
  if (nodeId.startsWith("w:")) {
    const address = nodeId.slice(2);
    const roles: string[] = [];
    if (closure.initiatorWallet === address) roles.push("opening holder");
    if (closure.responderWallet === address) roles.push("responding holder");
    if (closure.baseWallet === address) roles.push("base holder");
    if (closure.encoderWallet === address) roles.push("encoder holder");
    return roles.join(" · ");
  }
  if (closure.initiatorId === nodeId) return "opened";
  if (closure.responderId === nodeId) return "answered";
  if (closure.baseId === nodeId) return "base";
  if (closure.encoderId === nodeId) return "encoder";
  return "";
}

export function pointsIn(nodeId: string, closure: Closure): number {
  if (closure.initiatorId === nodeId) return closure.pointsInitiator;
  if (closure.responderId === nodeId) return closure.pointsResponder;
  if (closure.baseId === nodeId) return closure.pointsBase;
  if (closure.encoderId === nodeId) return closure.pointsEncoder;
  if (nodeId.startsWith("w:")) {
    const address = nodeId.slice(2);
    let sum = 0;
    if (closure.initiatorWallet === address) sum += closure.pointsInitiator;
    if (closure.responderWallet === address) sum += closure.pointsResponder;
    if (closure.baseWallet === address) sum += closure.pointsBase;
    if (closure.encoderWallet === address) sum += closure.pointsEncoder;
    return sum;
  }
  return 0;
}

export function nodeTouchesFocus(nodeId: string, edges: GraphEdge[], focus: string | null): boolean {
  if (!focus) return true;
  if (nodeId === focus) return true;
  return edges.some(
    (edge) => (edge.source === focus && edge.target === nodeId) || (edge.target === focus && edge.source === nodeId),
  );
}

export function conversationLines(registry: Registry, convId: string): Line[] {
  return registry.lines.filter((line) => line.convId === convId).sort((a, b) => a.block - b.block || (a.replyTo ? 1 : -1));
}

export function conversationOf(registry: Registry, convId: string | null): Conversation | undefined {
  if (!convId) return undefined;
  return registry.conversations.find((item) => item.id === convId);
}

/**
 * A holder reads a line only in this terminal, only if one of its pieces is in that conversation
 * (or it holds the base of the thread), and only while that base keeps the key open.
 */
export function canRead(registry: Registry, line: Line, wallet: string | null, block: number): boolean {
  if (!wallet) return false;
  const conversation = conversationOf(registry, line.convId);
  if (!conversation?.baseId) return false;
  if (keyLeft(registry, conversation.baseId, block) <= 0) return false;
  const ids = [conversation.characterId, conversation.responderId, conversation.baseId, conversation.encoderId];
  return registry.assets.some((asset) => asset.owner === wallet && ids.includes(asset.id));
}

export function tally(lines: Line[]): Array<{ glyph: string; n: number }> {
  const map = new Map<string, number>();
  for (const line of lines) {
    for (const glyph of Array.from(line.plaintext)) map.set(glyph, (map.get(glyph) ?? 0) + 1);
  }
  return [...map.entries()]
    .map(([glyph, n]) => ({ glyph, n }))
    .sort((a, b) => b.n - a.n || (a.glyph < b.glyph ? -1 : 1))
    .slice(0, 6);
}

/** Who put a base or an encoder into the talk, in words. */
export function broughtBy(conversation: Conversation, role: "base" | "encoder"): string {
  const who = conversation.brought?.[role];
  const tok = (id: string | null) => padId(piece(id ?? "")?.tokenId ?? 0);
  if (who === "opener") return `brought by ${tok(conversation.characterId)}`;
  if (who === "responder") return `brought by ${tok(conversation.responderId)}`;
  if (who === "idle") return `idle piece, taken by ${tok(conversation.responderId)}`;
  if (who === "draw") return "drawn from the idle pool";
  return "";
}
