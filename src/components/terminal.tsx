import { useEffect, useMemo, useState } from "react";
import { padId, piece, type Role } from "@/lib/trace/catalog";
import { encode } from "@/lib/trace/cipher";
import { dialectMark, visualCipher } from "@/lib/trace/marks";
import { glyphCounts, speakable } from "@/lib/trace/portrait";
import { shortAddress } from "@/lib/protocol/domain";
import { canRead, tally, walletLabel } from "@/lib/protocol/derive";
import { MAX_GLYPHS, blockAt, cooling, eligibleIdle, keyLeft, unix, windowFor } from "@/lib/protocol/relayer";
import type { Conversation, Registry } from "@/lib/protocol/types";
import {
  linkWallet,
  openConversation,
  openKeyOf,
  openTalk,
  respondTo,
  selectDetail,
  setAnswerTarget,
  setSheet,
  useApp,
  type Answerer,
} from "@/lib/store";
import { useWallet } from "@/lib/wallet/store";
import { Note } from "./help";
import { PieceMark, Tok, cx, formatLeft } from "./common";

type Mode = "open-base" | "open-encoder" | "complete" | "answer";

const MODES: { id: Mode; label: string; text: string }[] = [
  { id: "open-base", label: "open +base", text: "your character speaks and brings a base. the encoder slot stays empty: whoever answers fills it. until then the line is not encoded." },
  { id: "open-encoder", label: "open +encoder", text: "your character speaks and brings an encoder. the base slot stays empty: whoever answers fills it. until then the line is sealed." },
  { id: "complete", label: "complete", text: "your character speaks and brings both a base and an encoder. another character answers with itself only: 1 point to each of the four pieces." },
  { id: "answer", label: "answer", text: "reply to an opening with your character. if a slot is empty, fill it: your piece, an idle one, or a draw from the pool." },
];

const FORM_ORDER = ["classic", "inverted", "blink"];

const WINDOWS = [
  { seconds: 120, label: "2m" },
  { seconds: 1800, label: "30m" },
  { seconds: 7200, label: "2h" },
];

type Choice = { id: string; own: boolean; label: string };

/** What a role slot looks like in the current mode: chosen by you, filled by someone else, or left empty. */
type SlotPlan = { kind: "pick"; choices: Choice[]; note: string } | { kind: "fixed"; id: string; note: string } | { kind: "empty"; note: string };

function ownChoices(registry: Registry, wallet: string, role: Role): Choice[] {
  return registry.assets
    .filter((asset) => asset.owner === wallet && asset.role === role)
    .sort((a, b) => FORM_ORDER.indexOf(piece(a.id)?.form ?? "") - FORM_ORDER.indexOf(piece(b.id)?.form ?? "") || a.tokenId - b.tokenId)
    .map((asset) => ({ id: asset.id, own: true, label: "mine" }));
}

function idleChoices(registry: Registry, role: Role, wallet: string, banned: string[], takerId: string, ms: number): Choice[] {
  return eligibleIdle(registry, role, banned, takerId, ms)
    .filter((offer) => offer.owner !== wallet)
    .map((offer) => ({ id: offer.assetId, own: false, label: `idle · ${walletLabel(registry, offer.owner)}` }));
}

function plan(role: Role, mode: Mode, registry: Registry, wallet: string, characterId: string, target: Conversation | null, ms: number): SlotPlan {
  const own = ownChoices(registry, wallet, role);
  if (mode === "open-base" || mode === "open-encoder") {
    const brought = mode === "open-base" ? "base" : "encoder";
    if (role === brought) return { kind: "pick", choices: own, note: "you bring it" };
    return { kind: "empty", note: `empty slot · whoever answers brings the ${role}` };
  }
  if (mode === "complete") return { kind: "pick", choices: own, note: "you bring it" };
  if (!target) return { kind: "empty", note: "pick an opening above" };
  const filled = role === "base" ? target.baseId : target.encoderId;
  if (filled) return { kind: "fixed", id: filled, note: `brought by ${padId(piece(target.characterId)?.tokenId ?? 0)}` };
  const banned = [target.characterId, target.baseId ?? "", target.encoderId ?? ""];
  return {
    kind: "pick",
    choices: [{ id: "", own: false, label: "the relayer draws from the idle pool" }, ...own, ...idleChoices(registry, role, wallet, banned, characterId, ms)],
    note: "you fill the empty slot",
  };
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
  const characters = useMemo(() => (wallet ? registry.assets.filter((asset) => asset.owner === wallet && asset.role === "character") : []), [registry, wallet]);

  const [characterId, setCharacterId] = useState("");
  const [picked, setPicked] = useState<Record<"base" | "encoder", string | null>>({ base: null, encoder: null });
  const [draft, setDraft] = useState("");
  const [mode, setMode] = useState<Mode>("open-base");
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
            connect to hold pieces and speak<span className="caret">_</span>
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

  const ms = Date.now();
  const speaker = piece(characterId);
  const glyphs = speaker ? speakable(speaker.tokenId) : [];
  const mouthCool = characterId ? cooling(registry, characterId, block) : 0;
  const other = characters.find((asset) => asset.id !== characterId);
  const answerable = registry.conversations.filter(
    (item) => item.status === "open" && item.kind === "targeted" && !item.draw && item.deadline > unix(now) && item.characterId !== characterId,
  );
  const target = mode === "answer" ? (answerable.find((item) => item.id === answerTarget) ?? null) : null;

  const plans: Record<"base" | "encoder", SlotPlan> = {
    base: plan("base", mode, registry, wallet, characterId, target, ms),
    encoder: plan("encoder", mode, registry, wallet, characterId, target, ms),
  };
  const chosen = (role: "base" | "encoder"): string | null => {
    const slot = plans[role];
    if (slot.kind === "fixed") return slot.id;
    if (slot.kind === "empty") return null;
    const current = picked[role];
    if (current !== null && slot.choices.some((item) => item.id === current)) return current;
    const own = slot.choices.find((item) => item.own && cooling(registry, item.id, block) === 0) ?? slot.choices.find((item) => item.own);
    return own?.id ?? slot.choices[0]?.id ?? null;
  };
  const baseId = chosen("base");
  const encoderId = chosen("encoder");
  const dialect = encoderId ? (piece(encoderId)?.dialect ?? null) : null;
  const attachedIds = (mode === "open-base" ? [baseId] : mode === "open-encoder" ? [encoderId] : mode === "complete" ? [baseId, encoderId] : []).filter(
    (id): id is string => Boolean(id),
  );
  const coolingPiece = attachedIds.find((id) => cooling(registry, id, block) > 0) ?? null;
  const attachedCool = coolingPiece ? cooling(registry, coolingPiece, block) : 0;

  const ready =
    !pending &&
    !busy &&
    draft.length > 0 &&
    mouthCool === 0 &&
    attachedCool === 0 &&
    (mode === "answer" ? Boolean(target) : attachedIds.length === (mode === "complete" ? 2 : 1));

  async function send() {
    let result;
    if (mode !== "answer") {
      result = await openConversation({ characterId, attachedIds, plaintext: draft, seconds, answerer });
    } else if (target) {
      const filling = target.baseId && target.encoderId ? "" : target.baseId ? encoderId : baseId;
      result = await respondTo({ convId: target.id, characterId, pieceId: filling ?? "", plaintext: draft });
      if (result.ok) setAnswerTarget(null);
    }
    if (result?.ok) setDraft("");
  }

  const readable = registry.lines.filter((line) => canRead(registry, line, wallet, block));
  const readConvs = [...new Set(readable.map((line) => line.convId))].slice(-5);
  const counts = tally(readable);

  const section = (role: "base" | "encoder") => {
    const slot = plans[role];
    const selected = role === "base" ? baseId : encoderId;
    const title = role === "base" ? "base · holds the key" : "encoder · hides the line";
    return (
      <div className="slot">
        <p className="legend m-0">
          {title} <span className="text-cyan">· {slot.note}</span>
        </p>
        {slot.kind === "empty" ? <p className="slot-empty">···· waiting</p> : null}
        {slot.kind === "fixed" ? (
          <p className="slot-fixed">
            <PieceMark id={slot.id} /> <Tok id={slot.id} onClick={() => selectDetail(slot.id)} />{" "}
            <span className="text-dim">{piece(slot.id)?.dialect ?? piece(slot.id)?.form}</span>
          </p>
        ) : null}
        {slot.kind === "pick"
          ? slot.choices.map((item) => {
              const on = item.id === selected;
              if (!item.id) {
                return (
                  <button key="draw" type="button" className={cx("pick-row", on && "is-on")} aria-pressed={on} onClick={() => setPicked({ ...picked, [role]: "" })}>
                    <span className="pick">{on ? ">" : " "}</span>
                    <span className="text-dim">????</span>
                    <span className="text-dim">{item.label}</span>
                  </button>
                );
              }
              const art = piece(item.id)!;
              const cool = cooling(registry, item.id, block);
              const left = role === "base" ? keyLeft(registry, item.id, block) : 0;
              return (
                <div key={item.id} className="pick-line">
                  <button type="button" className={cx("pick-row", on && "is-on")} aria-pressed={on} onClick={() => setPicked({ ...picked, [role]: item.id })}>
                    <span className="pick">{on ? ">" : " "}</span>
                    <PieceMark id={item.id} />
                    <span className="id">{padId(art.tokenId)}</span>
                    <span className="text-dim truncate">
                      {art.dialect ?? art.form}
                      {item.own ? "" : ` · ${item.label}`}
                    </span>
                    {left > 0 ? <span className="text-cyan">key open {left}</span> : null}
                    {cool > 0 ? <span className="text-accent">cool {cool}</span> : null}
                  </button>
                  {role === "base" && item.own ? (
                    <button
                      type="button"
                      className="act is-small"
                      title={`read the talks of this base for ${windowFor(item.id)} block${windowFor(item.id) === 1 ? "" : "s"}`}
                      disabled={cool > 0 || pending}
                      onClick={() => void openKeyOf(item.id)}
                    >
                      open key
                    </button>
                  ) : null}
                  <button type="button" className="act is-small" onClick={() => selectDetail(item.id)}>
                    info
                  </button>
                </div>
              );
            })
          : null}
        {role === "base" && slot.kind === "pick" && slot.choices.some((item) => item.own) ? (
          <p className="slot-hint">open key: read the plaintext of this base&apos;s talks for 12 blocks (blink: 1). no points move. a base also opens its key when it joins a talk.</p>
        ) : null}
      </div>
    );
  };

  return (
    <section id="terminal" className="terminal" aria-label="Local terminal">
      <p className="prompt m-0">
        traceformers@local:~$ <span className="text-dim">{shortAddress(wallet)} · {providerName}</span>
      </p>

      {characters.length === 0 ? <p className="mt-3 mb-0 text-dim">this address holds no character. reset the local registry from the footer to get a new set.</p> : null}

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
              <span className="text-dim truncate">{on ? "speaks" : answerer === "mine" && mode.startsWith("open") ? "answers" : "waits"}</span>
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
          <p className="legend m-0">openings waiting for an answer</p>
          {answerable.length === 0 ? <p className="m-0 text-dim">none right now.</p> : null}
          <ul className="m-0 list-none p-0">
            {answerable.map((item) => {
              const on = item.id === target?.id;
              return (
                <li key={item.id} className="pick-line">
                  <button type="button" className={cx("pick-row", on && "is-on")} aria-pressed={on} onClick={() => setAnswerTarget(item.id)}>
                    <span className="pick">{on ? ">" : " "}</span>
                    <Tok id={item.characterId} mine={registry.assets.some((asset) => asset.id === item.characterId && asset.owner === wallet)} />
                    <span className="text-dim truncate">
                      {item.baseId && item.encoderId ? "complete · needs only a character" : <>brings <PieceMark id={item.baseId ?? item.encoderId} /> · needs {item.baseId ? "encoder" : "base"}</>}
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

      {mode !== "answer" ? (
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
          </div>
        </div>
      ) : null}

      <p className="mt-5 mb-3">
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
          <span>{dialect ? visualCipher(dialect, encode(draft, dialect)) : "not encoded until an encoder joins"}</span>
        </p>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button type="button" className={cx("act", ready && "is-ready")} disabled={!ready} onClick={() => void send()}>
          {busy ? "signing…" : "sign + send"}
        </button>
        {mouthCool > 0 ? <span className="text-accent">{padId(speaker?.tokenId ?? 0)} cools down {mouthCool}</span> : null}
        {coolingPiece ? <span className="text-accent">{padId(piece(coolingPiece)?.tokenId ?? 0)} cools down {attachedCool}</span> : null}
        {awaiting ? <span className="text-cyan">{answerer === "mine" && other ? `${padId(other.tokenId)} answers…` : "the network answers…"}</span> : null}
      </div>
      <Note scope="terminal" />

      <div className="private">
        <p className="m-0 text-dim">read only here · plaintext of your talks while a key is open</p>
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
                            {parent ? ` answers ${padId(piece(parent.speakerId)?.tokenId ?? 0)}` : " spoke"}
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
