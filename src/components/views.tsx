import { useCallback, useState } from "react";
import { padId, piece, roleName, type Role } from "@/lib/trace/catalog";
import { shortAddress } from "@/lib/protocol/domain";
import { buildGraph, ranksForRole, ranksForWallets, walletLabel } from "@/lib/protocol/derive";
import { unix } from "@/lib/protocol/relayer";
import type { LogRow, Registry } from "@/lib/protocol/types";
import { offerIdle, revokeIdle, selectDetail, showConversation, transferPiece, useApp, type View } from "@/lib/store";
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
  Transfer: "transfer",
  Linked: "signed in",
};

function logTarget(registry: Registry, row: LogRow): { conv?: string; detail?: string } {
  if (registry.conversations.some((item) => item.id === row.refId)) return { conv: row.refId };
  if (piece(row.refId)) return { detail: row.refId };
  if (row.refId.startsWith("0x")) return { detail: `w:${row.refId}` };
  return {};
}

function Graph() {
  const registry = useApp((state) => state.registry)!;
  const detailId = useApp((state) => state.detailId);
  const wallet = useWallet((state) => state.address);
  const [focus, setFocus] = useState("");
  const graph = buildGraph(registry);
  const onSelect = useCallback((id: string | null) => {
    setFocus(id ?? "");
    selectDetail(id);
  }, []);
  const known = graph.nodes.some((node) => node.id === focus);

  return (
    <section className="px-4 py-3" aria-label="Graph">
      <div className="flex flex-wrap items-end gap-3">
        <label className="field">
          <span>focus</span>
          <select
            value={known ? focus : ""}
            onChange={(event) => {
              setFocus(event.target.value);
              selectDetail(event.target.value || null);
            }}
          >
            <option value="">entire network</option>
            {wallet && graph.nodes.some((node) => node.id === `w:${wallet}`) ? <option value={`w:${wallet}`}>my wallet</option> : null}
            {graph.nodes.map((node) => (
              <option key={node.id} value={node.id}>
                {roleName(node.kind)} · {node.label}
              </option>
            ))}
          </select>
        </label>
        <p className="m-0 pb-2 text-sm text-dim">
          {known ? "neighbors stay lit. click empty space to see the whole network." : `${graph.nodes.length} nodes · ${registry.closures.length} closures. click a node to focus it.`}
        </p>
      </div>
      <div className="graph-box">
        <GraphCanvas registry={registry} focus={known ? focus : null} selected={detailId} wallet={wallet} onSelect={onSelect} />
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

      <p className="legend mt-5 mb-1">log · click a transaction to read the talk</p>
      <ul className="m-0 list-none p-0">
        {[...registry.log]
          .reverse()
          .slice(0, 24)
          .map((row) => {
            const target = logTarget(registry, row);
            return (
              <li key={row.id}>
                <button
                  type="button"
                  className="log-row"
                  disabled={!target.conv && !target.detail}
                  onClick={() => (target.conv ? showConversation(target.conv) : selectDetail(target.detail ?? null))}
                >
                  <span className="text-dim">{row.block}</span>
                  <span className={row.kind === "Closed" ? "text-accent" : row.kind === "Expired" ? "text-dim" : "text-cyan"}>{LOG_TEXT[row.kind]}</span>
                  <span className="truncate">{piece(row.refId) ? padId(piece(row.refId)!.tokenId) : row.refId.startsWith("0x") ? shortAddress(row.refId) : row.refId}</span>
                  <span className="text-dim truncate">
                    {row.by === "relayer" ? "relayer" : walletLabel(registry, row.by)} · {formatStamp(row.at)}
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
  const [excluded, setExcluded] = useState("");
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
                  {offer.excluded ? ` · excludes ${offer.excluded.split(",").map((id) => padId(piece(id)?.tokenId ?? 0)).join(" ")}` : ""}
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
            <label className="field">
              <span>excluded characters · ids like c-2, c-14</span>
              <input value={excluded} spellCheck={false} onChange={(event) => setExcluded(event.target.value)} placeholder="c-2, c-14" />
            </label>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              className="act is-ready"
              disabled={pending}
              onClick={() => void offerIdle({ assetId: chosen.id, maxUses: cap ? Number(cap) : 0, days: days ? Number(days) : 0, excluded })}
            >
              sign the offer
            </button>
            <button type="button" className="act" disabled={pending || !offered} onClick={() => void revokeIdle(chosen.id)}>
              revoke
            </button>
          </div>
        </div>
      ) : null}

      {linked && give ? (
        <div className="panel mt-5">
          <p className="prompt m-0">transfer</p>
          <p className="mt-2 mb-0 text-sm text-dim">
            a change of holder inside this registry. it is not an OpenSea sale and does not move the Trace token on Ethereum. after it, earlier signatures on that
            piece no longer count: only the holder at inclusion time can sign.
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
              <span>recipient</span>
              <input value={giveTo} placeholder="0x…" spellCheck={false} onChange={(event) => setGiveTo(event.target.value)} />
            </label>
          </div>
          <button type="button" className="act mt-3" disabled={pending || !giveTo.trim()} onClick={() => void transferPiece(give.id, giveTo)}>
            sign transfer
          </button>
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
