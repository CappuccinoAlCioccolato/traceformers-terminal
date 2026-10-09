import { useEffect } from "react";
import { padId, piece } from "@/lib/trace/catalog";
import { dialectMark, formMark } from "@/lib/trace/marks";
import { canRead, conversationLines, conversationOf, walletLabel } from "@/lib/protocol/derive";
import { blockAt, keyLeft, unix } from "@/lib/protocol/relayer";
import type { Closure, Conversation, Registry } from "@/lib/protocol/types";
import { exportTalkPng } from "@/lib/export-talk";
import { buildPost, intentUrl, postLength, siteUrl } from "@/lib/share";
import { includeCallback, openTalk, selectDetail, setAnswerTarget, setView, useApp } from "@/lib/store";
import { useWallet } from "@/lib/wallet/store";
import { lineCipher } from "./wall";
import { Note } from "./help";
import { Tok, cx, formatLeft } from "./common";

type Slot = { role: string; id: string | null; empty: string };

export function slotsOf(conversation: Conversation): Slot[] {
  return [
    { role: "opens", id: conversation.characterId, empty: "" },
    { role: "answers", id: conversation.responderId, empty: conversation.kind === "complete" ? "nobody · complete" : "waiting" },
    { role: "base", id: conversation.baseId, empty: "empty slot" },
    { role: "encoder", id: conversation.encoderId, empty: "empty slot" },
  ];
}

export function holderAt(registry: Registry, closure: Closure | undefined, id: string): string {
  if (closure) {
    if (closure.initiatorId === id) return closure.initiatorWallet;
    if (closure.responderId === id && closure.responderWallet) return closure.responderWallet;
    if (closure.baseId === id) return closure.baseWallet;
    if (closure.encoderId === id) return closure.encoderWallet;
  }
  return registry.assets.find((asset) => asset.id === id)?.owner ?? "";
}

export function TalkWindow() {
  const registry = useApp((state) => state.registry);
  const now = useApp((state) => state.now);
  const talkId = useApp((state) => state.talkId);
  const pending = useApp((state) => state.pending);
  const wallet = useWallet((state) => state.address);

  useEffect(() => {
    if (!talkId) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") openTalk(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [talkId]);

  if (!registry || !talkId) return null;
  const conversation = conversationOf(registry, talkId);
  const block = blockAt(registry, now);
  const close = () => openTalk(null);

  if (!conversation) {
    return (
      <div className="sheet-backdrop" role="presentation" onClick={close}>
        <div role="dialog" aria-modal="true" aria-label="Talk" className="talk-window" onClick={(event) => event.stopPropagation()}>
          <div className="flex items-baseline justify-between gap-3">
            <p className="prompt m-0">talk {talkId}</p>
            <button type="button" className="act is-small" onClick={close}>
              close
            </button>
          </div>
          <p className="mt-3 mb-0 text-dim">this talk is too old: its lines left the local log. the closure and its points remain.</p>
        </div>
      </div>
    );
  }

  const lines = conversationLines(registry, conversation.id);
  const byId = new Map(lines.map((line) => [line.id, line]));
  const closure = registry.closures.find((item) => item.id === conversation.closureId);
  const mineIds = new Set(wallet ? registry.assets.filter((asset) => asset.owner === wallet).map((asset) => asset.id) : []);
  const left = keyLeft(registry, conversation.baseId, block);
  const empty = conversation.status === "open" ? (conversation.baseId ? "encoder" : "base") : null;
  const canAnswer = Boolean(wallet && registry.links.includes(wallet) && conversation.status === "open" && !conversation.draw && conversation.kind === "targeted");
  const readable = new Set(lines.filter((line) => canRead(registry, line, wallet, block)).map((line) => line.id));
  const post = buildPost(registry, conversation, closure);
  const length = postLength(post, [siteUrl()]);

  return (
    <div className="sheet-backdrop" role="presentation" onClick={close}>
      <div role="dialog" aria-modal="true" aria-labelledby="talk-title" className="talk-window" onClick={(event) => event.stopPropagation()}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p id="talk-title" className="prompt m-0">
            talk <span className="text-dim">{conversation.id}</span>
          </p>
          <button type="button" className="act is-small" onClick={close}>
            close
          </button>
        </div>

        <p className="mt-2 mb-0">
          {conversation.status === "open" ? (
            <span className="text-cyan">
              open · {formatLeft(conversation.deadline, unix(now))} left · missing {empty}
            </span>
          ) : conversation.status === "expired" ? (
            <span className="text-dim">expired · nobody answered in time · 0 points</span>
          ) : (
            <span className="text-accent">
              closed at block {closure?.block} · {conversation.kind}
              {closure ? ` · ${closure.pointsInitiator}/${closure.pointsResponder}/${closure.pointsBase}/${closure.pointsEncoder} pts` : ""}
              {closure?.drawSeed ? " · drawn from the pool" : ""}
            </span>
          )}
          {conversation.baseId ? <span className="text-dim"> · key {left > 0 ? `open ${left}` : "closed"}</span> : null}
        </p>

        <ul className="cast">
          {slotsOf(conversation).map((slot) => {
            const art = slot.id ? piece(slot.id) : undefined;
            const holder = slot.id ? holderAt(registry, closure, slot.id) : "";
            const handle = holder ? registry.handles[holder] : "";
            return (
              <li key={slot.role} className={cx("cast-tile", !art && "is-empty", slot.id && mineIds.has(slot.id) && "is-mine")}>
                <span className="cast-role">{slot.role}</span>
                {art ? (
                  <button type="button" className="cast-art" onClick={() => selectDetail(art.id)} aria-label={`info Trace ${padId(art.tokenId)}`}>
                    <img src={art.image} alt="" loading="lazy" />
                  </button>
                ) : (
                  <span className="cast-art cast-blank">····</span>
                )}
                <span className="cast-id">
                  {art ? (
                    <>
                      {art.dialect ? <span className={`trait-${art.dialect}`}>{dialectMark(art.dialect)}</span> : null}
                      {art.form ? <span className={`form-${art.form}`}>{formMark(art.form)}</span> : null} {padId(art.tokenId)}
                    </>
                  ) : (
                    <span className="text-dim">{slot.empty}</span>
                  )}
                </span>
                {holder ? (
                  <span className={cx("cast-holder", holder === wallet && "text-you")}>
                    {holder === wallet ? "you" : handle ? `@${handle}` : walletLabel(registry, holder)}
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>

        {conversation.draw ? (
          <p className="mt-3 mb-0 flex flex-wrap items-center gap-3">
            <span className="text-cyan">the relayer draws the missing {empty} from the idle pool…</span>
            <button type="button" className="act is-small" disabled={pending} onClick={() => void includeCallback(conversation.id)}>
              include callback
            </button>
          </p>
        ) : null}

        {lines.map((line) => {
          const parent = line.replyTo ? byId.get(line.replyTo) : undefined;
          return (
            <div key={line.id} className="talk-line">
              <p className="talk-meta m-0">
                <Tok id={line.speakerId} mine={mineIds.has(line.speakerId)} />
                <span className="text-dim">
                  {parent ? (
                    <>
                      answers <span className="text-ink">{padId(piece(parent.speakerId)?.tokenId ?? 0)}</span>
                    </>
                  ) : (
                    "spoke"
                  )}
                </span>
                <span className="text-dim">{line.dialect ? `${line.dialect} via ${padId(piece(conversation.encoderId ?? "")?.tokenId ?? 0)}` : "no encoder yet"}</span>
                <span className="text-dim">block {line.block}</span>
              </p>
              <p className={cx("talk-cipher", line.dialect && `trait-${line.dialect}`)}>{lineCipher(registry, line, block)}</p>
              {readable.has(line.id) ? (
                <p className="sig m-0">
                  {line.plaintext} <span className="text-dim text-sm">· read only here</span>
                </p>
              ) : null}
            </div>
          );
        })}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button type="button" className="act is-ready" onClick={() => void exportTalkPng(registry, conversation, lines, readable, block)}>
            export png
          </button>
          <a className="act act-link" href={intentUrl(post)} target="_blank" rel="noreferrer">
            share on x
          </a>
          {canAnswer ? (
            <button
              type="button"
              className="act"
              onClick={() => {
                close();
                setView("wall");
                setAnswerTarget(conversation.id);
              }}
            >
              answer it
            </button>
          ) : null}
        </div>
        <p className="mt-2 mb-0 text-sm text-dim">
          the post tags holders who added their X username in the wallet panel · {length}/280 · attach the png by hand
        </p>
        <Note scope="talk" />
      </div>
    </div>
  );
}
