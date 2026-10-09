import { useEffect } from "react";
import { padId, piece } from "@/lib/trace/catalog";
import { dialectMark, formMark } from "@/lib/trace/marks";
import { broughtBy, canRead, conversationLines, conversationOf, walletLabel } from "@/lib/protocol/derive";
import { blockAt, emptySeats, keyLeft, unix } from "@/lib/protocol/relayer";
import { SIDES, SLOTS } from "@/lib/protocol/types";
import { exportTalkPng } from "@/lib/export-talk";
import { buildPost, intentUrl, postLength, siteUrl } from "@/lib/share";
import { openTalk, selectDetail, setAnswerTarget, setView, useApp } from "@/lib/store";
import { useWallet } from "@/lib/wallet/store";
import { lineCipher } from "./wall";
import { Note } from "./help";
import { Tok, cx, formatLeft } from "./common";

export function TalkWindow() {
  const registry = useApp((state) => state.registry);
  const now = useApp((state) => state.now);
  const talkId = useApp((state) => state.talkId);
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
  const linked = Boolean(wallet && registry.links.includes(wallet));
  const seats = emptySeats(conversation);
  const readable = new Set(lines.filter((line) => canRead(registry, line, wallet, block)).map((line) => line.id));
  const post = buildPost(registry, conversation, closure);
  const length = postLength(post, [siteUrl()]);
  const goToRoom = () => {
    close();
    setView("wall");
    window.requestAnimationFrame(() => document.getElementById("room")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

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
              open · {formatLeft(conversation.deadline, unix(now))} left · {seats.length} empty seat{seats.length === 1 ? "" : "s"} in the waiting room
            </span>
          ) : conversation.status === "expired" ? (
            <span className="text-dim">expired · nobody took the last seats in time · 0 points</span>
          ) : (
            <span className="text-accent">
              closed at block {closure?.block}
              {closure?.self ? " · answered by the same wallet" : ""}
            </span>
          )}
          <span className="text-dim"> · {conversation.dialect ? `spoken in ${conversation.dialect}` : "no dialect until the talk encoder sits"}</span>
        </p>

        {SIDES.map((side) => (
          <div key={side} className="cast-row">
            <p className={cx("cast-side", side === "talk" ? "text-cyan" : "text-accent")}>
              {side}
              {side === "answer" && !conversation.talk.encoder ? <span className="text-dim"> · opens when the talk has all three pieces</span> : null}
            </p>
            <ul className="cast">
              {SLOTS.map((slot) => {
                const seat = conversation[side][slot];
                const art = seat ? piece(seat.id) : undefined;
                const holder = seat ? (closure ? closure.wallets[side][slot] : seat.holder) : "";
                const handle = holder ? registry.handles[holder] : "";
                const left = slot === "base" && seat ? keyLeft(registry, seat.id, block) : 0;
                return (
                  <li key={slot} className={cx("cast-tile", !art && "is-empty", seat && mineIds.has(seat.id) && "is-mine")}>
                    <span className="cast-role">
                      {slot}
                      {slot === "encoder" && !art && side === "answer" && conversation.dialect ? ` · ${conversation.dialect}` : ""}
                    </span>
                    {art ? (
                      <button type="button" className="cast-art" onClick={() => selectDetail(art.id)} aria-label={`info Trace ${padId(art.tokenId)}`}>
                        <img src={art.image} alt="" loading="lazy" />
                      </button>
                    ) : (
                      <span className="cast-art cast-blank">{conversation.status === "open" ? "empty seat" : "····"}</span>
                    )}
                    {art ? (
                      <span className="cast-id">
                        {art.dialect ? <span className={`trait-${art.dialect}`}>{dialectMark(art.dialect)}</span> : null}
                        {art.form ? <span className={`form-${art.form}`}>{formMark(art.form)}</span> : null} {padId(art.tokenId)}
                        {left > 0 ? <span className="text-cyan"> · key {left}</span> : null}
                      </span>
                    ) : null}
                    {holder ? (
                      <span className={cx("cast-holder", holder === wallet && "text-you")}>
                        {holder === wallet ? "you" : handle ? `@${handle}` : walletLabel(registry, holder)}
                      </span>
                    ) : null}
                    {seat && slot !== "character" ? <span className="cast-holder">{broughtBy(conversation, side, slot)}</span> : null}
                    {closure && seat ? <span className="cast-holder">+{closure.points[side][slot]}</span> : null}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}

        {lines.map((line) => {
          const parent = line.replyTo ? byId.get(line.replyTo) : undefined;
          const encoderId = conversation[line.side].encoder?.id;
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
                    "talks"
                  )}
                </span>
                <span className="text-dim">{line.dialect ? `${line.dialect} via ${padId(piece(encoderId ?? "")?.tokenId ?? 0)}` : "waits for its encoder"}</span>
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
          {linked && seats.some((item) => item.slot !== "character") ? (
            <button type="button" className="act" onClick={goToRoom}>
              take a seat
            </button>
          ) : null}
          {linked && seats.some((item) => item.side === "answer" && item.slot === "character") ? (
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
        <p className="mt-2 mb-0 text-sm text-dim">the post tags holders who added their X username in the wallet panel · {length}/280 · attach the png by hand</p>
        <Note scope="talk" />
      </div>
    </div>
  );
}
