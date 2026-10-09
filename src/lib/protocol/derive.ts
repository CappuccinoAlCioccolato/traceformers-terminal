import { piece, padId, type Role } from "@/lib/trace/catalog";
import { shortAddress } from "./domain";
import { keyLeft } from "./relayer";
import { SIDES, SLOTS, type Asset, type Closure, type Conversation, type Line, type Registry, type SideName, type Slot } from "./types";

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

/** Every seat of a closure, as side, slot, piece, holder at closure, and points. */
export function seatsOf(closure: Closure): { side: SideName; slot: Slot; id: string; wallet: string; points: number }[] {
  return SIDES.flatMap((side) =>
    SLOTS.map((slot) => ({ side, slot, id: closure.pieces[side][slot], wallet: closure.wallets[side][slot], points: closure.points[side][slot] })),
  );
}

export function pointsIn(nodeId: string, closure: Closure): number {
  const address = nodeId.startsWith("w:") ? nodeId.slice(2) : null;
  return seatsOf(closure)
    .filter((seat) => (address ? seat.wallet === address : seat.id === nodeId))
    .reduce((sum, seat) => sum + seat.points, 0);
}

export function pointsFor(asset: Asset, closures: Closure[]): { points: number; closures: number } {
  let points = 0;
  let n = 0;
  for (const closure of closures) {
    const seats = seatsOf(closure).filter((seat) => seat.id === asset.id);
    if (!seats.length) continue;
    n += 1;
    points += seats.reduce((sum, seat) => sum + seat.points, 0);
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
    for (const side of SIDES) {
      const { character, base, encoder } = closure.pieces[side];
      addEdge(character, base, "piece");
      addEdge(character, encoder, "piece");
    }
    addEdge(closure.pieces.talk.character, closure.pieces.answer.character, "reply");
    for (const seat of seatsOf(closure)) {
      seen.add(seat.id);
      wallets.add(seat.wallet);
      addEdge(seat.id, walletNode(seat.wallet), "custody");
    }
  }

  const nodes: GraphNode[] = [];
  for (const id of seen) {
    const asset = assets.get(id);
    if (!asset) continue;
    const score = pointsFor(asset, registry.closures);
    const art = piece(id);
    nodes.push({ id, kind: asset.role, label: padId(asset.tokenId), sub: art?.dialect ?? art?.form ?? "decoded", points: score.points, closures: score.closures });
  }
  for (const address of wallets) {
    nodes.push({ id: walletNode(address), kind: "wallet", label: walletLabel(registry, address), sub: shortAddress(address), points: 0, closures: 0, address });
  }
  return { nodes, edges: [...edgeMap.values()] };
}

function compareRank(a: RankRow, b: RankRow): number {
  if (b.points !== a.points) return b.points - a.points;
  if (b.closures !== a.closures) return b.closures - a.closures;
  return a.tie - b.tie;
}

function holderName(registry: Registry, address: string): string {
  return registry.handles[address] ? `@${registry.handles[address]}` : walletLabel(registry, address);
}

export function ranksForRole(registry: Registry, role: Role): RankRow[] {
  return registry.assets
    .filter((asset) => asset.role === role && asset.owner)
    .map((asset) => {
      const score = pointsFor(asset, registry.closures);
      const kind = role === "character" ? "" : `${piece(asset.id)?.dialect ?? piece(asset.id)?.form} · `;
      return { id: asset.id, label: padId(asset.tokenId), sub: `${kind}held by ${holderName(registry, asset.owner)}`, points: score.points, closures: score.closures, tie: asset.tokenId };
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
    const current = buckets.get(asset.owner) ?? { id: asset.owner, label: walletLabel(registry, asset.owner), sub: "", points: 0, closures: 0, tie: 0 };
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
  const address = nodeId.startsWith("w:") ? nodeId.slice(2) : null;
  return registry.closures
    .filter((closure) => seatsOf(closure).some((seat) => (address ? seat.wallet === address : seat.id === nodeId)))
    .sort((a, b) => b.block - a.block || b.at - a.at);
}

export function roleInClosure(nodeId: string, closure: Closure): string {
  const address = nodeId.startsWith("w:") ? nodeId.slice(2) : null;
  const seats = seatsOf(closure).filter((seat) => (address ? seat.wallet === address : seat.id === nodeId));
  return seats.map((seat) => (seat.slot === "character" ? (seat.side === "talk" ? "talked" : "answered") : `${seat.side} ${seat.slot}`)).join(" · ");
}

export function nodeTouchesFocus(nodeId: string, edges: GraphEdge[], focus: string | null): boolean {
  if (!focus) return true;
  if (nodeId === focus) return true;
  return edges.some((edge) => (edge.source === focus && edge.target === nodeId) || (edge.target === focus && edge.source === nodeId));
}

export function conversationLines(registry: Registry, convId: string): Line[] {
  return registry.lines.filter((line) => line.convId === convId).sort((a, b) => (a.side === b.side ? a.block - b.block : a.side === "talk" ? -1 : 1));
}

export function conversationOf(registry: Registry, convId: string | null): Conversation | undefined {
  if (!convId) return undefined;
  return registry.conversations.find((item) => item.id === convId);
}

/** Every piece seated in a conversation, both sides. */
export function piecesIn(conversation: Conversation): string[] {
  return SIDES.flatMap((side) => SLOTS.map((slot) => conversation[side][slot]?.id)).filter((id): id is string => Boolean(id));
}

/**
 * A holder reads a line only in this terminal, only if one of its pieces sits in that talk,
 * and only while the base of that line's side keeps its key open.
 */
export function canRead(registry: Registry, line: Line, wallet: string | null, block: number): boolean {
  if (!wallet) return false;
  const conversation = conversationOf(registry, line.convId);
  if (!conversation) return false;
  if (keyLeft(registry, conversation[line.side].base?.id, block) <= 0) return false;
  const ids = piecesIn(conversation);
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

/** How a base or an encoder took its seat, in words. */
export function broughtBy(conversation: Conversation, side: SideName, slot: Slot): string {
  const seat = conversation[side][slot];
  if (!seat || slot === "character") return "";
  if (seat.by === "speaker") return `brought by ${padId(piece(conversation[side].character?.id ?? "")?.tokenId ?? 0)}`;
  if (seat.by === "joined") return "joined from the waiting room";
  return "taken from the idle pool";
}
