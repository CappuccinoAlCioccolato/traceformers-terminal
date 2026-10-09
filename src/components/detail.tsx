import { useEffect } from "react";
import { TRACE_COLLECTION, epithet, padId, piece } from "@/lib/trace/catalog";
import { glyphCounts } from "@/lib/trace/portrait";
import { shortAddress } from "@/lib/protocol/domain";
import { closuresTouching, pointsIn, roleInClosure, walletLabel } from "@/lib/protocol/derive";
import { blockAt, cooling, keyLeft } from "@/lib/protocol/relayer";
import { selectDetail, showConversation, useApp } from "@/lib/store";
import { useWallet } from "@/lib/wallet/store";
import { PieceMark, Tok } from "./common";

/** The side panel for a piece or a wallet. Every view reuses it: graph, pool, board, and the terminal. */
export function Detail() {
  const registry = useApp((state) => state.registry);
  const id = useApp((state) => state.detailId);
  const now = useApp((state) => state.now);
  const wallet = useWallet((state) => state.address);

  useEffect(() => {
    if (!id) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") selectDetail(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [id]);

  if (!registry || !id) return null;
  const block = blockAt(registry, now);
  const closures = closuresTouching(registry, id);
  const art = piece(id);
  const asset = registry.assets.find((item) => item.id === id);
  const address = id.startsWith("w:") ? id.slice(2) : "";
  const idle = registry.idles.find((offer) => offer.assetId === id);
  const total = closures.reduce((sum, closure) => sum + pointsIn(id, closure), 0);

  return (
    <aside className="drawer" aria-label="Info">
      <div className="flex items-baseline justify-between gap-3">
        <p className="prompt m-0">{art ? `info ${art.role}` : "info wallet"}</p>
        <button type="button" className="act is-small" onClick={() => selectDetail(null)}>
          close
        </button>
      </div>

      {art && asset ? (
        <>
          <div className="mt-3 flex items-baseline gap-3">
            <PieceMark id={id} />
            <span className="drawer-title">Trace {padId(art.tokenId)}</span>
          </div>
          <img className="drawer-art" src={art.image} alt={`Trace ${padId(art.tokenId)}`} loading="lazy" />
          <p className="mt-2 mb-0 text-sm text-muted">{epithet(art)}</p>
          {art.role === "character" ? (
            <p className="mt-1 mb-0 text-sm text-dim">
              glyphs: {[...glyphCounts(art.tokenId)].map(([glyph, n]) => `${glyph} ${n}`).join(" · ")}
            </p>
          ) : null}
          <ul className="traits">
            {art.traits.map((trait) => (
              <li key={trait.type}>
                <span>{trait.type.toLowerCase()}</span>
                {trait.value}
              </li>
            ))}
            <li>
              <span>stage</span>
              {art.role === "character" ? "Decoded" : "Encoded"}
            </li>
          </ul>
          <dl className="talk-pieces mt-3">
            <dt>holder</dt>
            <dd>
              {asset.owner ? (
                <button type="button" className="link-btn" onClick={() => selectDetail(`w:${asset.owner}`)}>
                  {walletLabel(registry, asset.owner)}
                  {asset.owner === wallet ? <span className="text-you"> · you</span> : null}
                </button>
              ) : (
                <span className="text-dim">unclaimed in this registry</span>
              )}
            </dd>
            {art.role === "base" ? (
              <>
                <dt>key</dt>
                <dd>{keyLeft(registry, id, block) > 0 ? <span className="text-cyan">open {keyLeft(registry, id, block)} blocks</span> : <span className="text-dim">closed</span>}</dd>
              </>
            ) : null}
            <dt>state</dt>
            <dd>
              {cooling(registry, id, block) > 0 ? <span className="text-accent">cooldown {cooling(registry, id, block)}</span> : <span className="text-dim">free</span>}
              {idle ? <span className="text-cyan"> · idle {idle.maxUses ? `${idle.uses}/${idle.maxUses}` : "until revoked"}</span> : null}
            </dd>
            <dt>points</dt>
            <dd>{total}</dd>
          </dl>
          <p className="mt-3 mb-0 flex flex-col gap-1 text-sm">
            <a href={art.opensea} target="_blank" rel="noreferrer">
              view on opensea ↗
            </a>
            <a href={TRACE_COLLECTION} target="_blank" rel="noreferrer" className="text-dim">
              trace collection ↗
            </a>
          </p>
        </>
      ) : (
        <>
          <p className="drawer-title mt-3 mb-0">
            {walletLabel(registry, address)}
            {address === wallet ? <span className="text-you"> · you</span> : null}
          </p>
          <p className="mt-1 mb-0 break-all text-sm text-dim">{address}</p>
          <p className="mt-3 mb-1 legend">holds</p>
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            {registry.assets
              .filter((item) => item.owner === address)
              .map((item) => (
                <span key={item.id} className="inline-flex items-baseline gap-1">
                  <PieceMark id={item.id} />
                  <Tok id={item.id} onClick={() => selectDetail(item.id)} />
                </span>
              ))}
          </div>
          <p className="mt-3 mb-0 text-sm text-dim">points: {total} · {shortAddress(address)}</p>
        </>
      )}

      <p className="legend mt-5 mb-1">
        {closures.length === 1 ? "1 closure" : `${closures.length} closures`} · click to read the talk
      </p>
      {closures.length === 0 ? <p className="m-0 text-dim">no closures yet.</p> : null}
      <ul className="m-0 list-none p-0">
        {closures.slice(0, 40).map((closure) => (
          <li key={closure.id}>
            <button type="button" className="closure-row" onClick={() => showConversation(closure.convId)}>
              <span className="text-dim">{closure.block}</span>
              <span>{roleInClosure(id, closure)}</span>
              <span className="text-dim">
                <Tok id={closure.initiatorId} />
                {closure.responderId ? (
                  <>
                    {" ↔ "}
                    <Tok id={closure.responderId} />
                  </>
                ) : (
                  " complete"
                )}
              </span>
              <span className="text-accent">+{pointsIn(id, closure)}</span>
            </button>
          </li>
        ))}
      </ul>
    </aside>
  );
}
