import { useEffect, useMemo, useState } from "react";
import { padId, piece } from "@/lib/trace/catalog";
import { encode } from "@/lib/trace/cipher";
import { dialectMark, visualCipher } from "@/lib/trace/marks";
import { glyphCounts, speakable } from "@/lib/trace/portrait";
import { shortAddress } from "@/lib/protocol/domain";
import { broughtBy, canRead, tally } from "@/lib/protocol/derive";
import { MAX_GLYPHS, blockAt, cooling, emptySide, keyLeft, seatProblem, sideReady, unix, windowFor } from "@/lib/protocol/relayer";
import type { Conversation } from "@/lib/protocol/types";
import { answerTalk, linkWallet, openConversation, openKeyOf, openTalk, selectDetail, setAnswerTarget, setSheet, setView, useApp, type Answerer } from "@/lib/store";
import { useWallet } from "@/lib/wallet/store";
import { Note } from "./help";
import { PieceMark, Tok, cx, formatLeft } from "./common";

type Mode = "talk" | "answer";

const MODES: { id: Mode; label: string; text: string }[] = [
  { id: "talk", label: "talk", text: "your character speaks first. bring your base and encoder, or leave either seat to the waiting room: any holder can take it." },
  { id: "answer", label: "answer", text: "your character answers a talk that has all three pieces. bring a base and an encoder of the same dialect, or leave the seats to the waiting room." },
];

const FORM_ORDER = ["classic", "inverted", "blink"];
const WINDOWS = [
  { seconds: 120, label: "2m" },
  { seconds: 1800, label: "30m" },
  { seconds: 7200, label: "2h" },
];

/** A blank talk, so the seat rules can be checked before there is one. */
function draftTalk(): Conversation {
  return { id: "", talk: emptySide(), answer: emptySide(), dialect: null, deadline: 0, nonce: 0, status: "open", openedBlock: 0, movedBlock: 0, closureId: null };
}

export function Terminal() {
  const registry = useApp((state) => state.registry)!;
  const now = useApp((state) => state.now);
  const pending = useApp((state) => state.pending);
  const awaiting = useApp((state) => state.awaiting);
  const answerTarget = useApp((state) => state.answerTarget);
  const wallet = useWallet((state) => state.address);
  const providerName = useWallet((state) => state.providerName);
  const busy = useWallet((state) => state.busy);
  const block = blockAt(registry, now);
  const linked = Boolean(wallet && registry.links.includes(wallet));
  const mine = useMemo(() => (wallet ? registry.assets.filter((asset) => asset.owner === wallet) : []), [registry, wallet]);
  const characters = useMemo(() => mine.filter((asset) => asset.role === "character"), [mine]);

  const [characterId, setCharacterId] = useState("");
  const [picked, setPicked] = useState<Record<"base" | "encoder", string | null>>({ base: null, encoder: null });
  const [draft, setDraft] = useState("");
  const [mode, setMode] = useState<Mode>("talk");
  const [answerer, setAnswerer] = useState<Answerer>("network");
  const [seconds, setSeconds] = useState(1800);

  useEffect(() => {
    if (!characters.some((asset) => asset.id === characterId)) setCharacterId(characters[0]?.id ?? "");
  }, [characters, characterId]);

  useEffect(() => {
    if (answerTarget) setMode("answer");
  }, [answerTarget]);

  if (!wallet) {
    return (
      <section id="terminal" className="terminal" aria-label="Local terminal">
        <p className="prompt m-0">traceformers@local:~$</p>
        <div className="mt-4 flex items-end justify-between gap-4">
          <p className="m-0 text-dim">
            connect to hold pieces, talk, answer, or take a seat<span className="caret">_</span>
          </p>
          <button type="button" className="act is-ready" onClick={() => setSheet(true)}>
            connect
          </button>
        </div>
      </section>
    );
  }

  if (!linked) {
    return (
      <section id="terminal" className="terminal" aria-label="Local terminal">
        <p className="prompt m-0">
          traceformers@local:~$ <span className="text-dim">{shortAddress(wallet)}</span>
        </p>
        <p className="mt-3 mb-0 text-muted">
          sign once to enter. the first signature places 2 characters, 3 bases (classic, inverted, blink), and 3 encoders (binary, base64, punched card) on
          this address. EIP-712 only: no transaction, no gas.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" className="act is-ready" disabled={pending || busy} onClick={() => void linkWallet()}>
            sign in
          </button>
          <button type="button" className="act" onClick={() => setSheet(true)}>
            wallet
          </button>
        </div>
        <Note scope="wallet" />
      </section>
    );
  }

  if (characters.length === 0) {
    return (
      <section id="terminal" className="terminal" aria-label="Local terminal">
        <p className="prompt m-0">
          traceformers@local:~$ <span className="text-dim">{shortAddress(wallet)} · {providerName}</span>
        </p>
        <p className="mt-3 mb-0 text-muted">
          you hold no character, so you do not speak. your bases and encoders still take part: join a talk or an answer from the waiting room above, or offer
          them in the pool so the relayer can seat them for you.
        </p>
        <p className="mt-3 mb-0 flex flex-wrap gap-x-4 gap-y-1">
          {mine.map((asset) => (
            <span key={asset.id} className="inline-flex items-baseline gap-1">
              <PieceMark id={asset.id} />
              <Tok id={asset.id} onClick={() => selectDetail(asset.id)} />
            </span>
          ))}
        </p>
        <div className="mt-3 flex gap-2">
          <button type="button" className="act" onClick={() => document.getElementById("room")?.scrollIntoView({ behavior: "smooth" })}>
            waiting room
          </button>
          <button type="button" className="act" onClick={() => setView("pool")}>
            pool
          </button>
        </div>
      </section>
    );
  }

  const speaker = piece(characterId);
  const glyphs = speaker ? speakable(speaker.tokenId) : [];
  const mouthCool = characterId ? cooling(registry, characterId, block) : 0;
  const other = characters.find((asset) => asset.id !== characterId);
  const answerable = registry.conversations.filter(
    (item) => item.status === "open" && sideReady(item.talk) && !item.answer.character && item.deadline > unix(now) && item.talk.character?.id !== characterId,
  );
  const target = mode === "answer" ? (answerable.find((item) => item.id === answerTarget) ?? null) : null;
  const side = mode === "talk" ? "talk" : "answer";
  const context = mode === "talk" ? draftTalk() : target;

  /** Your pieces that can sit in a seat now, or the piece already seated there by someone who joined. */
  const seatFor = (slot: "base" | "encoder") => {
    if (!context) return { fixed: null as string | null, options: [] as string[] };
    const fixed = context[side][slot]?.id ?? null;
    const options = mine
      .filter((asset) => asset.role === slot && !seatProblem(registry, context, side, slot, asset, block))
      .sort((a, b) => FORM_ORDER.indexOf(piece(a.id)?.form ?? "") - FORM_ORDER.indexOf(piece(b.id)?.form ?? "") || a.tokenId - b.tokenId)
      .map((asset) => asset.id);
    return { fixed, options };
  };
  const chosen = (slot: "base" | "encoder"): string => {
    const seat = seatFor(slot);
    if (seat.fixed) return "";
    const current = picked[slot];
    if (current !== null && (current === "" || seat.options.includes(current))) return current;
    return seat.options[0] ?? "";
  };
  const baseId = chosen("base");
  const encoderId = chosen("encoder");
  const lineEncoder = encoderId || (context?.[side].encoder?.id ?? "");
  const dialect = lineEncoder ? (piece(lineEncoder)?.dialect ?? null) : null;

  const ready = !pending && !busy && draft.length > 0 && mouthCool === 0 && (mode === "talk" || Boolean(target));

  async function send() {
    const result =
      mode === "talk"
        ? await openConversation({ characterId, base: baseId, encoder: encoderId, plaintext: draft, seconds, answerer })
        : target
          ? await answerTalk({ convId: target.id, characterId, base: baseId, encoder: encoderId, plaintext: draft })
          : null;
    if (result?.ok) {
      setDraft("");
      if (mode === "answer") setAnswerTarget(null);
    }
  }

  const readable = registry.lines.filter((line) => canRead(registry, line, wallet, block));
  const readConvs = [...new Set(readable.map((line) => line.convId))].slice(-5);
  const counts = tally(readable);

  const section = (slot: "base" | "encoder") => {
    if (mode === "answer" && !target) return null;
    const seat = seatFor(slot);
    const selected = slot === "base" ? baseId : encoderId;
    const title = slot === "base" ? "base · holds the key" : `encoder · hides the line${mode === "answer" && target?.dialect ? ` · must speak ${target.dialect}` : ""}`;
    return (
      <div className="slot">
        <p className="legend m-0">{title}</p>
        {seat.fixed ? (
          <p className="slot-fixed">
            <PieceMark id={seat.fixed} /> <Tok id={seat.fixed} onClick={() => selectDetail(seat.fixed)} />{" "}
            <span className="text-dim">{context ? broughtBy(context, side, slot) : ""}</span>
          </p>
        ) : (
          <>
            {seat.options.map((id) => {
              const on = id === selected;
              const art = piece(id)!;
              const left = slot === "base" ? keyLeft(registry, id, block) : 0;
              return (
                <div key={id} className="pick-line">
                  <button type="button" className={cx("pick-row", on && "is-on")} aria-pressed={on} onClick={() => setPicked({ ...picked, [slot]: id })}>
                    <span className="pick">{on ? ">" : " "}</span>
                    <PieceMark id={id} />
                    <span className="id">{padId(art.tokenId)}</span>
                    <span className="text-dim truncate">{art.dialect ?? art.form}</span>
                    {left > 0 ? <span className="text-cyan">key open {left}</span> : null}
                  </button>
                  {slot === "base" ? (
                    <button
                      type="button"
                      className="act is-small"
                      title={`read the talks of this base for ${windowFor(id)} block${windowFor(id) === 1 ? "" : "s"}`}
                      disabled={cooling(registry, id, block) > 0 || pending}
                      onClick={() => void openKeyOf(id)}
                    >
                      open key
                    </button>
                  ) : null}
                  <button type="button" className="act is-small" onClick={() => selectDetail(id)}>
                    info
                  </button>
                </div>
              );
            })}
            <button type="button" className={cx("pick-row", selected === "" && "is-on")} aria-pressed={selected === ""} onClick={() => setPicked({ ...picked, [slot]: "" })}>
              <span className="pick">{selected === "" ? ">" : " "}</span>
              <span className="text-dim">····</span>
              <span className="text-dim">leave the seat to the waiting room</span>
            </button>
            {seat.options.length === 0 ? <p className="slot-hint">none of your {slot}s fits this seat now (cooling, already seated, or another dialect).</p> : null}
          </>
        )}
      </div>
    );
  };

  return (
    <section id="terminal" className="terminal" aria-label="Local terminal">
      <p className="prompt m-0">
        traceformers@local:~$ <span className="text-dim">{shortAddress(wallet)} · {providerName}</span>
      </p>

      <p className="legend mt-4 mb-0">character · who speaks</p>
      {characters.map((asset) => {
        const on = asset.id === characterId;
        const cool = cooling(registry, asset.id, block);
        return (
          <div key={asset.id} className="pick-line">
            <button type="button" className={cx("pick-row", on && "is-on")} aria-pressed={on} onClick={() => setCharacterId(asset.id)}>
              <span className="pick">{on ? ">" : " "}</span>
              <img className="mini" src={piece(asset.id)!.image} alt="" />
              <span className="id">{padId(asset.tokenId)}</span>
              <span className="text-dim truncate">{on ? "speaks" : answerer === "mine" && mode === "talk" ? "answers" : "waits"}</span>
              {cool > 0 ? <span className="text-accent">cool {cool}</span> : null}
            </button>
            <button type="button" className="act is-small" onClick={() => selectDetail(asset.id)}>
              info
            </button>
          </div>
        );
      })}

      <p className="legend mt-5 mb-1">mode</p>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="mode">
        {MODES.map((item) => (
          <button key={item.id} type="button" role="radio" aria-checked={mode === item.id} className={cx("act", mode === item.id && "is-on")} onClick={() => setMode(item.id)}>
            {item.label}
          </button>
        ))}
      </div>
      <p className="mt-2 mb-0 text-sm text-dim">{MODES.find((item) => item.id === mode)!.text}</p>

      {mode === "answer" ? (
        <div className="mode-box">
          <p className="legend m-0">talks ready for an answer</p>
          {answerable.length === 0 ? <p className="m-0 text-dim">none right now: a talk is ready once its base and encoder are seated.</p> : null}
          <ul className="m-0 list-none p-0">
            {answerable.map((item) => {
              const on = item.id === target?.id;
              return (
                <li key={item.id} className="pick-line">
                  <button type="button" className={cx("pick-row", on && "is-on")} aria-pressed={on} onClick={() => setAnswerTarget(item.id)}>
                    <span className="pick">{on ? ">" : " "}</span>
                    <Tok id={item.talk.character?.id ?? null} mine={item.talk.character?.holder === wallet} />
                    <span className={item.dialect ? `trait-${item.dialect}` : "text-dim"}>{item.dialect}</span>
                    <span className="text-dim truncate">
                      {[item.answer.base && "base joined", item.answer.encoder && "encoder joined"].filter(Boolean).join(" · ") || "answer seats empty"}
                    </span>
                    <span className="text-cyan">{formatLeft(item.deadline, unix(now))}</span>
                  </button>
                  <button type="button" className="act is-small" onClick={() => openTalk(item.id)}>
                    talk
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      {section("base")}
      {section("encoder")}

      {mode === "talk" ? (
        <div className="mode-box">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-dim">waits up to</span>
            {WINDOWS.map((item) => (
              <button key={item.seconds} type="button" className={cx("act is-small", seconds === item.seconds && "is-on")} onClick={() => setSeconds(item.seconds)}>
                {item.label}
              </button>
            ))}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="text-dim">answered by</span>
            <button type="button" className={cx("act is-small", answerer === "network" && "is-on")} onClick={() => setAnswerer("network")}>
              the network
            </button>
            <button type="button" className={cx("act is-small", answerer === "mine" && "is-on")} disabled={!other} onClick={() => setAnswerer("mine")}>
              my {other ? padId(other.tokenId) : "other character"}
            </button>
            <span className="text-sm text-dim">once the talk has all three pieces</span>
          </div>
        </div>
      ) : null}

      <p className="mt-5 mb-1">
        <span className="text-dim">{"> "}</span>
        <span className="sig">{draft}</span>
        <span className="caret">_</span>
        <span className="ml-3 text-dim text-sm">
          {Array.from(draft).length}/{MAX_GLYPHS}
        </span>
      </p>
      <p className="mt-0 mb-2 text-sm text-dim">
        {padId(speaker?.tokenId ?? 0)} speaks only with the glyphs its art is drawn with:{" "}
        {speaker
          ? [...glyphCounts(speaker.tokenId)]
              .sort((a, b) => glyphs.indexOf(a[0]) - glyphs.indexOf(b[0]))
              .map(([glyph, n]) => `${glyph} ${n}`)
              .join(" · ")
          : ""}
      </p>

      <div className="flex flex-wrap gap-2">
        {glyphs.map((glyph) => (
          <button
            key={glyph}
            type="button"
            className="glyph-key"
            disabled={mouthCool > 0 || Array.from(draft).length >= MAX_GLYPHS}
            onClick={() => setDraft((current) => (Array.from(current).length >= MAX_GLYPHS ? current : current + glyph))}
          >
            {glyph}
          </button>
        ))}
        <button type="button" className="act" disabled={draft.length === 0} onClick={() => setDraft((current) => Array.from(current).slice(0, -1).join(""))}>
          back
        </button>
      </div>

      {draft ? (
        <p className={cx("staged", dialect && `trait-${dialect}`)}>
          <span>{dialect ? dialectMark(dialect) : "····"}</span>
          <span>{dialect ? visualCipher(dialect, encode(draft, dialect)) : "not encoded until an encoder takes the seat"}</span>
        </p>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button type="button" className={cx("act", ready && "is-ready")} disabled={!ready} onClick={() => void send()}>
          {busy ? "signing…" : "sign + send"}
        </button>
        {mouthCool > 0 ? <span className="text-accent">{padId(speaker?.tokenId ?? 0)} cools down {mouthCool}</span> : null}
        {awaiting ? (
          <span className="text-cyan">{answerer === "mine" && other ? `${padId(other.tokenId)} answers once the talk is complete…` : "the network answers once the talk is complete…"}</span>
        ) : null}
      </div>
      <Note scope="terminal" />

      <div className="private">
        <p className="m-0 text-dim">read only here · plaintext of your talks while the base of that side keeps its key open</p>
        {readConvs.length > 0 ? (
          <ul className="mt-2 mb-0 list-none p-0">
            {readConvs.map((convId) => (
              <li key={convId} className="mt-2">
                <button type="button" className="link-btn text-accent" onClick={() => openTalk(convId)}>
                  {convId}
                </button>
                <ul className="m-0 list-none p-0">
                  {readable
                    .filter((line) => line.convId === convId)
                    .map((line) => {
                      const parent = line.replyTo ? registry.lines.find((item) => item.id === line.replyTo) : undefined;
                      return (
                        <li key={line.id}>
                          <span className="text-dim">
                            {padId(piece(line.speakerId)?.tokenId ?? 0)}
                            {parent ? ` answers ${padId(piece(parent.speakerId)?.tokenId ?? 0)}` : " talks"}
                          </span>{" "}
                          <span className="sig">{line.plaintext}</span>
                        </li>
                      );
                    })}
                </ul>
              </li>
            ))}
          </ul>
        ) : (
          <p className="caret mt-2 mb-0">_</p>
        )}
      </div>

      {counts.length > 0 ? (
        <p className="mt-4 mb-0 text-sm text-dim">
          seen{" "}
          {counts.map((item) => (
            <span key={item.glyph} className="sig mr-3">
              {item.glyph} {item.n}
            </span>
          ))}
        </p>
      ) : null}
    </section>
  );
}
