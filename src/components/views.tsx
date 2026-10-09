import { useCallback, useState } from "react";
import { padId, piece, pieceId, type Role } from "@/lib/trace/catalog";
import { shortAddress } from "@/lib/protocol/domain";
import { buildGraph, ranksForRole, ranksForWallets, walletLabel } from "@/lib/protocol/derive";
import { unix } from "@/lib/protocol/relayer";
import type { LogRow, Registry } from "@/lib/protocol/types";
import { delegatePiece, offerIdle, revokeIdle, selectDetail, showConversation, useApp, type View } from "@/lib/store";
import { Note } from "./help";
import { useWallet } from "@/lib/wallet/store";
import { PieceMark, Tok, cx, formatStamp } from "./common";
import { GraphCanvas } from "./graph-canvas";

export function Views({ view }: { view: View }) {
  if (view === "graph") return <Graph />;
  if (view === "pool") return <Pool />;
  return <Board />;
}

const LOG_TEXT: Record<LogRow["kind"], string> = {
  IdleOffer: "idle offer",
  Revoke: "revoke",
  Opened: "opened",
  Closed: "closed",
  Expired: "expired",
  Delegate: "delegate",
  Linked: "signed in",
};

const PAGE = 25;

function logTarget(registry: Registry, row: LogRow): { conv?: string; detail?: string } {
  if (registry.conversations.some((item) => item.id === row.refId)) return { conv: row.refId };
  if (piece(row.refId)) return { detail: row.refId };
  if (row.refId.startsWith("0x")) return { detail: `w:${row.refId}` };
  return {};
}

/** The wallets and pieces a log row is about: its signer, its piece, or the slots of its conversation. */
function logSubjects(registry: Registry, row: LogRow): { pieces: string[]; wallets: string[] } {
  const wallets = row.by.startsWith("0x") ? [row.by] : [];
  if (piece(row.refId)) return { pieces: [row.refId], wallets };
  if (row.refId.startsWith("0x")) return { pieces: [], wallets: [...wallets, row.refId] };
  const conversation = registry.conversations.find((item) => item.id === row.refId);
  if (!conversation) return { pieces: [], wallets };
  const closure = registry.closures.find((item) => item.id === conversation.closureId);
  const pieces = [conversation.characterId, conversation.responderId, conversation.baseId, conversation.encoderId].filter((id): id is string => Boolean(id));
  const held = closure
    ? [closure.initiatorWallet, closure.responderWallet, closure.baseWallet, closure.encoderWallet].filter((id): id is string => Boolean(id))
    : [conversation.opener];
  return { pieces, wallets: [...wallets, ...held] };
}

type FocusRole = "" | "character" | "base" | "encoder" | "wallet";

function Graph() {
  const registry = useApp((state) => state.registry)!;
  const detailId = useApp((state) => state.detailId);
  const wallet = useWallet((state) => state.address);
  const [focus, setFocus] = useState("");
  const [role, setRole] = useState<FocusRole>("");
  const [num, setNum] = useState("");
  const [page, setPage] = useState(0);
  const graph = buildGraph(registry);
  const known = graph.nodes.some((node) => node.id === focus);

  const apply = useCallback((id: string | null) => {
    setFocus(id ?? "");
    setPage(0);
    selectDetail(id);
    if (!id) {
      setRole("");
      setNum("");
      setQuery("");
    } else if (id.startsWith("w:")) {
      setRole("wallet");
      setNum("");
      const current = useApp.getState().registry;
      const address = id.slice(2);
      setQuery(current?.handles[address] ? `@${current.handles[address]}` : (current?.labels[address] ?? address));
    } else {
      setRole(piece(id)?.role ?? "");
      setNum(String(piece(id)?.tokenId ?? ""));
    }
  }, []);

  const pickRole = (next: FocusRole) => {
    setRole(next);
    setNum("");
    setQuery("");
    setFocus("");
    setPage(0);
    selectDetail(null);
  };
  const pickNumber = (value: string) => {
    const digits = value.replace(/\D/g, "");
    setNum(digits);
    setPage(0);
    if (role && role !== "wallet" && digits) {
      const id = pieceId(role, Number(digits));
      setFocus(id);
      selectDetail(piece(id) ? id : null);
    } else {
      setFocus("");
    }
  };
  const wallets = graph.nodes.filter((node) => node.kind === "wallet");
  const [query, setQuery] = useState("");
  const matchesOf = (text: string) => {
    const needle = text.trim().toLowerCase().replace(/^@/, "");
    if (!needle) return [];
    return wallets
      .filter((node) => {
        const address = node.address ?? "";
        const handle = (registry.handles[address] ?? "").toLowerCase();
        return address.includes(needle) || node.label.toLowerCase().includes(needle) || handle.includes(needle) || (address === wallet && "you".startsWith(needle));
      })
      .slice(0, 8);
  };
  const matches = matchesOf(query);
  const search = (text: string) => {
    setQuery(text);
    setPage(0);
    const found = matchesOf(text);
    if (found.length === 1) {
      setFocus(found[0]!.id);
      selectDetail(found[0]!.id);
    } else {
      setFocus("");
    }
  };

  const rows = [...registry.log].reverse().filter((row) => {
    if (!focus) return true;
    const subjects = logSubjects(registry, row);
    return focus.startsWith("w:") ? subjects.wallets.includes(focus.slice(2)) : subjects.pieces.includes(focus);
  });
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const current = Math.min(page, pages - 1);
  const visible = rows.slice(current * PAGE, current * PAGE + PAGE);

  return (
    <section className="px-4 py-3" aria-label="Graph">
      <div className="flex flex-wrap items-end gap-3">
        <label className="field">
          <span>focus</span>
          <select value={role} onChange={(event) => pickRole(event.target.value as FocusRole)}>
            <option value="">entire network</option>
            <option value="character">character</option>
            <option value="base">base</option>
            <option value="encoder">encoder</option>
            <option value="wallet">wallet</option>
          </select>
        </label>
        {role && role !== "wallet" ? (
          <label className="field">
            <span>#</span>
            <input className="w-24" value={num} inputMode="numeric" placeholder="21" autoFocus onChange={(event) => pickNumber(event.target.value)} />
          </label>
        ) : null}
        {role === "wallet" ? (
          <label className="field grow">
            <span>holder · address, name, or @handle</span>
            <input value={query} spellCheck={false} autoComplete="off" autoFocus placeholder="0x…, North Atelier, @handle" onChange={(event) => search(event.target.value)} />
          </label>
        ) : null}
        {focus ? (
          <button type="button" className="act is-small" onClick={() => apply(null)}>
            clear
          </button>
        ) : null}
      </div>
      {role === "wallet" && query && !known ? (
        <ul className="matches">
          {matches.length === 0 ? <li className="text-dim">no holder matches “{query}”.</li> : null}
          {matches.map((node) => (
            <li key={node.id}>
              <button type="button" className="link-btn" onClick={() => apply(node.id)}>
                {node.address === wallet ? "you" : node.label}
              </button>{" "}
              <span className="text-dim">
                {registry.handles[node.address!] ? `@${registry.handles[node.address!]} · ` : ""}
                {node.address}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      <p className="mt-2 mb-0 text-sm text-dim">
        {known
          ? "its neighbors stay lit and the log lists only its transactions. click empty space to see the whole network."
          : focus
            ? "that piece has no closed talk yet, so it is not in the graph."
            : `${graph.nodes.length} nodes · ${registry.closures.length} closures. click a node to focus it.`}
      </p>
      <div className="graph-box">
        <GraphCanvas registry={registry} focus={known ? focus : null} selected={detailId} wallet={wallet} onSelect={apply} />
      </div>
      <p className="legend-row">
        <span>
          <i className="dot dot-character" /> character
        </span>
        <span>
          <i className="dot dot-base" /> base
        </span>
        <span>
          <i className="dot dot-encoder" /> encoder
        </span>
        <span>
          <i className="dot dot-wallet" /> wallet
        </span>
        <span className="text-accent">— answer</span>
        <span className="text-you">○ yours</span>
      </p>

      <div className="mt-5 mb-1 flex flex-wrap items-baseline justify-between gap-2">
        <p className="legend m-0">
          log{focus ? ` · ${known || piece(focus) ? (focus.startsWith("w:") ? walletLabel(registry, focus.slice(2)) : `${piece(focus)?.role} ${padId(piece(focus)?.tokenId ?? 0)}`) : "focus"}` : ""} · {rows.length}{" "}
          {rows.length === 1 ? "transaction" : "transactions"} · click one to read the talk
        </p>
        {pages > 1 ? (
          <span className="pager">
            <button type="button" className="act is-small" disabled={current === 0} onClick={() => setPage(current - 1)}>
              prev
            </button>
            <span className="text-dim">
              {current + 1}/{pages}
            </span>
            <button type="button" className="act is-small" disabled={current >= pages - 1} onClick={() => setPage(current + 1)}>
              next
            </button>
          </span>
        ) : null}
      </div>
      <ul className="m-0 list-none p-0">
        {visible.length === 0 ? <li className="text-dim">no transactions_</li> : null}
        {visible.map((row) => {
          const target = logTarget(registry, row);
          const mine = Boolean(wallet) && (row.by === wallet || logSubjects(registry, row).wallets.includes(wallet!));
          return (
            <li key={row.id}>
              <button
                type="button"
                className={cx("log-row", mine && "is-you")}
                disabled={!target.conv && !target.detail}
                onClick={() => (target.conv ? showConversation(target.conv) : selectDetail(target.detail ?? null))}
              >
                <span className="text-dim">{row.block}</span>
                <span className={mine ? "" : row.kind === "Closed" ? "text-accent" : row.kind === "Expired" ? "text-dim" : "text-cyan"}>{LOG_TEXT[row.kind]}</span>
                <span className="truncate">{piece(row.refId) ? padId(piece(row.refId)!.tokenId) : row.refId.startsWith("0x") ? shortAddress(row.refId) : row.refId}</span>
                <span className={cx("truncate", !mine && "text-dim")}>
                  {row.by === "relayer" ? "relayer" : row.by === wallet ? "you" : walletLabel(registry, row.by)} · {formatStamp(row.at)}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Pool() {
  const registry = useApp((state) => state.registry)!;
  const now = useApp((state) => state.now);
  const pending = useApp((state) => state.pending);
  const detailId = useApp((state) => state.detailId);
  const wallet = useWallet((state) => state.address);
  const linked = Boolean(wallet && registry.links.includes(wallet));
  const mine = registry.assets.filter((asset) => asset.owner === wallet && (asset.role === "base" || asset.role === "encoder"));
  const all = registry.assets.filter((asset) => asset.owner === wallet);
  const [assetId, setAssetId] = useState("");
  const [cap, setCap] = useState("");
  const [days, setDays] = useState("");
  const [allowed, setAllowed] = useState("");
  const [giveId, setGiveId] = useState("");
  const [giveTo, setGiveTo] = useState("");
  const chosen = mine.find((asset) => asset.id === assetId) ?? mine[0];
  const give = all.find((asset) => asset.id === giveId) ?? all[0];
  const offered = chosen ? registry.idles.some((offer) => offer.assetId === chosen.id) : false;

  return (
    <section className="px-4 py-3" aria-label="Idle pool">
      <p className="m-0 text-muted">
        a signature puts a base or an encoder on offer. without it, nobody can use the piece. an opening that misses that role can take it, or the relayer can draw it.
        click a row to see the NFT.
      </p>
      <ul className="mt-3 mb-0 list-none p-0">
        {registry.idles.length === 0 ? <li className="text-dim">the pool is empty_</li> : null}
        {registry.idles.map((offer) => {
          const expired = offer.expiry !== 0 && offer.expiry <= unix(now);
          return (
            <li key={offer.assetId}>
              <button type="button" className={cx("pool-row", detailId === offer.assetId && "is-on")} onClick={() => selectDetail(offer.assetId)}>
                <PieceMark id={offer.assetId} />
                <Tok id={offer.assetId} mine={offer.owner === wallet} />
                <span className="text-dim truncate">
                  {offer.role} · {offer.maxUses ? `${offer.uses}/${offer.maxUses} uses` : "until revoked"}
                  {offer.allowed ? ` · only for ${offer.allowed.split(",").map((id) => padId(piece(id)?.tokenId ?? 0)).join(" ")}` : " · any character"}
                  {offer.expiry ? (expired ? " · expired" : ` · until ${new Date(offer.expiry * 1000).toISOString().slice(0, 10)}`) : ""}
                </span>
                <span className={offer.owner === wallet ? "text-you" : "text-dim"}>{offer.owner === wallet ? "you" : walletLabel(registry, offer.owner)}</span>
              </button>
            </li>
          );
        })}
      </ul>

      {linked && chosen ? (
        <div className="panel mt-5">
          <p className="prompt m-0">offer or revoke</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="field">
              <span>your piece</span>
              <select value={chosen.id} onChange={(event) => setAssetId(event.target.value)}>
                {mine.map((asset) => (
                  <option key={asset.id} value={asset.id}>
                    {padId(asset.tokenId)} · {asset.role} · {piece(asset.id)?.dialect ?? piece(asset.id)?.form}
                    {registry.idles.some((offer) => offer.assetId === asset.id) ? " · idle" : ""}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>max uses · empty = unlimited</span>
              <input value={cap} inputMode="numeric" onChange={(event) => setCap(event.target.value.replace(/\D/g, ""))} />
            </label>
            <label className="field">
              <span>valid for days · empty = no expiry</span>
              <input value={days} inputMode="decimal" onChange={(event) => setDays(event.target.value.replace(/[^\d.]/g, ""))} />
            </label>
            <label className="field sm:col-span-2">
              <span>only these characters may use it · their # separated by commas · empty = any character</span>
              <input value={allowed} spellCheck={false} inputMode="numeric" onChange={(event) => setAllowed(event.target.value.replace(/[^\d,# ]/g, ""))} placeholder="any character" />
            </label>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              className="act is-ready"
              disabled={pending}
              onClick={() => void offerIdle({ assetId: chosen.id, maxUses: cap ? Number(cap) : 0, days: days ? Number(days) : 0, allowed: toCharacterIds(allowed) })}
            >
              sign the offer
            </button>
            <button type="button" className="act" disabled={pending || !offered} onClick={() => void revokeIdle(chosen.id)}>
              revoke
            </button>
          </div>
          <Note scope="pool-offer" />
        </div>
      ) : null}

      {linked && give ? (
        <div className="panel mt-5">
          <p className="prompt m-0">delegate</p>
          <p className="mt-2 mb-0 text-sm text-dim">
            hand the signing rights of one of your pieces to another address in this registry. it is not a sale and does not move the Trace token on Ethereum. after it,
            your earlier signatures on that piece stop counting: only the new holder can sign with it.
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="field">
              <span>piece</span>
              <select value={give.id} onChange={(event) => setGiveId(event.target.value)}>
                {all.map((asset) => (
                  <option key={asset.id} value={asset.id}>
                    {padId(asset.tokenId)} · {asset.role}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>to address</span>
              <input value={giveTo} placeholder="0x…" spellCheck={false} onChange={(event) => setGiveTo(event.target.value)} />
            </label>
          </div>
          <button type="button" className="act mt-3" disabled={pending || !giveTo.trim()} onClick={() => void delegatePiece(give.id, giveTo)}>
            sign delegation
          </button>
          <Note scope="pool-delegate" />
        </div>
      ) : null}

      {!linked ? <p className="mt-5 mb-0 text-dim">sign in from the wall to offer your own pieces_</p> : null}
    </section>
  );
}

function Board() {
  const registry = useApp((state) => state.registry)!;
  const detailId = useApp((state) => state.detailId);
  const wallet = useWallet((state) => state.address);
  const [role, setRole] = useState<Role>("character");
  const [by, setBy] = useState<"nft" | "wallet">("wallet");
  const rows = by === "nft" ? ranksForRole(registry, role) : ranksForWallets(registry, role);
  const top = rows[0]?.points || 1;
  const isMine = (id: string) => Boolean(wallet) && (by === "wallet" ? id === wallet : registry.assets.some((asset) => asset.id === id && asset.owner === wallet));
  const myIndex = rows.findIndex((row) => isMine(row.id));
  const listed: { row: (typeof rows)[number] | null; rank: number }[] = rows.slice(0, 10).map((row, index) => ({ row, rank: index + 1 }));
  if (myIndex >= 10) {
    listed.push({ row: null, rank: -1 });
    listed.push({ row: rows[myIndex]!, rank: myIndex + 1 });
  }

  return (
    <section className="px-4 py-3" aria-label="Leaderboard">
      <p className="m-0 text-muted">
        points belong to the NFT. the wallet view sums what each address holds now: it is not a balance that moves. ties: more closures, then the lower id. click a
        row to see its closures.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {(["character", "base", "encoder"] as const).map((item) => (
          <button key={item} type="button" className={cx("act is-small", role === item && "is-on")} onClick={() => setRole(item)}>
            {item}
          </button>
        ))}
        <span className="w-4" />
        <button type="button" className={cx("act is-small", by === "wallet" && "is-on")} onClick={() => setBy("wallet")}>
          by wallet
        </button>
        <button type="button" className={cx("act is-small", by === "nft" && "is-on")} onClick={() => setBy("nft")}>
          by nft
        </button>
      </div>
      {wallet ? (
        <p className="mt-3 mb-0 text-you">
          {myIndex >= 0
            ? `you: #${myIndex + 1} for ${role}${by === "nft" ? ` with ${rows[myIndex]!.label}` : ""} · ${rows[myIndex]!.points} pts · ${rows[myIndex]!.closures} ${rows[myIndex]!.closures === 1 ? "closure" : "closures"}`
            : `you have no ${role} closures yet.`}
        </p>
      ) : null}
      <ol className="mt-3 mb-0 list-none p-0">
        {rows.length === 0 ? <li className="text-dim">no closures yet_</li> : null}
        {listed.map((item) => {
          if (!item.row) {
            return (
              <li key="gap" className="board-gap">
                […]
              </li>
            );
          }
          const row = item.row;
          const mine = isMine(row.id);
          const nodeId = by === "wallet" ? `w:${row.id}` : row.id;
          return (
            <li key={`${item.rank}-${row.id}`}>
              <button type="button" className={cx("board-row", mine && "is-you", detailId === nodeId && "is-on")} onClick={() => selectDetail(nodeId)}>
                <span className="text-dim">{String(item.rank).padStart(2, "0")}</span>
                <span className="min-w-0">
                  <span className="flex items-baseline gap-2">
                    {by === "nft" ? <PieceMark id={row.id} /> : null}
                    <span className="truncate">{row.label}</span>
                  </span>
                  <span className="board-sub">{row.sub}</span>
                  <span className="board-bar" style={{ width: `${Math.max(4, (row.points / top) * 100)}%` }} />
                </span>
                <span className="text-right">
                  <span className="board-pts">{row.points}</span>
                  <span className="board-sub">{row.closures === 1 ? "1 closure" : `${row.closures} closures`}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/** "#2, 14" becomes "c-14,c-2": the registry ids of the characters an offer is reserved for. */
function toCharacterIds(text: string): string {
  return text
    .split(",")
    .map((item) => item.replace(/\D/g, ""))
    .filter(Boolean)
    .map((digits) => pieceId("character", Number(digits)))
    .join(",");
}
