import { useEffect, useMemo, useState } from "react";
import { epithet, padId, piece, type Role } from "@/lib/trace/catalog";
import { encode } from "@/lib/trace/cipher";
import { dialectMark, visualCipher } from "@/lib/trace/marks";
import { portrait, signature, speakable } from "@/lib/trace/portrait";
import { shortAddress } from "@/lib/protocol/domain";
import { canRead, tally } from "@/lib/protocol/derive";
import { MAX_GLYPHS, blockAt, cooling, eligibleIdle, keyLeft, unix } from "@/lib/protocol/relayer";
import type { Registry } from "@/lib/protocol/types";
import {
  completeConversation,
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
import { PieceMark, Tok, cx, formatLeft } from "./common";

type Mode = "open-base" | "open-encoder" | "complete" | "answer";

const MODES: { id: Mode; label: string }[] = [
  { id: "open-base", label: "open +base" },
  { id: "open-encoder", label: "open +encoder" },
  { id: "complete", label: "complete" },
  { id: "answer", label: "answer" },
];

const FORM_ORDER = ["classic", "inverted", "blink"];

const WINDOWS = [
  { seconds: 120, label: "2m" },
  { seconds: 1800, label: "30m" },
  { seconds: 7200, label: "2h" },
];

function idleChoices(registry: Registry, role: Role, wallet: string, banned: string[], characters: string[], ms: number) {
  return eligibleIdle(registry, role, banned, characters, ms)
    .filter((offer) => offer.owner !== wallet)
    .map((offer) => ({ id: offer.assetId, label: `${padId(piece(offer.assetId)!.tokenId)} idle · ${piece(offer.assetId)?.dialect ?? piece(offer.assetId)?.form}` }));
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
  const characters = mine.filter((asset) => asset.role === "character");
  const bases = mine.filter((asset) => asset.role === "base").sort((a, b) => FORM_ORDER.indexOf(piece(a.id)?.form ?? "") - FORM_ORDER.indexOf(piece(b.id)?.form ?? ""));
  const encoders = mine.filter((asset) => asset.role === "encoder");

  const [characterId, setCharacterId] = useState("");
  const [baseId, setBaseId] = useState("");
  const [encoderId, setEncoderId] = useState("");
  const [draft, setDraft] = useState("");
  const [mode, setMode] = useState<Mode>("open-base");
  const [answerer, setAnswerer] = useState<Answerer>("network");
  const [seconds, setSeconds] = useState(1800);
  const [face, setFace] = useState(false);
  const [completeBase, setCompleteBase] = useState("");
  const [completeEncoder, setCompleteEncoder] = useState("");
  const [answerPiece, setAnswerPiece] = useState("");

  useEffect(() => {
    if (!characters.some((asset) => asset.id === characterId)) setCharacterId(characters[0]?.id ?? "");
    if (!bases.some((asset) => asset.id === baseId)) setBaseId(bases[0]?.id ?? "");
    if (!encoders.some((asset) => asset.id === encoderId)) setEncoderId(encoders[0]?.id ?? "");
  }, [characters, bases, encoders, characterId, baseId, encoderId]);

  useEffect(() => {
    if (answerTarget) setMode("answer");
  }, [answerTarget]);

  const answerable = registry.conversations.filter(
    (item) => item.status === "open" && item.kind === "targeted" && !item.draw && item.deadline > unix(now) && item.characterId !== characterId,
  );
  const target = answerable.find((item) => item.id === answerTarget) ?? null;
  const targetEmpty: Role | null = target ? (target.baseId ? "encoder" : "base") : null;

  useEffect(() => {
    if (mode === "answer" && answerTarget && !answerable.some((item) => item.id === answerTarget)) setAnswerTarget(null);
  }, [mode, answerTarget, answerable]);

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
      </section>
    );
  }

  const speaker = piece(characterId);
  const glyphs = speaker ? speakable(speaker.tokenId) : [];
  const mouthCool = characterId ? cooling(registry, characterId, block) : 0;
  const other = characters.find((asset) => asset.id !== characterId);

  const ms = Date.now();
  const completeBases = [
    ...bases.map((asset) => ({ id: asset.id, label: `${padId(asset.tokenId)} mine · ${piece(asset.id)?.form}` })),
    ...idleChoices(registry, "base", wallet, [], [characterId], ms),
  ];
  const completeEncoders = [
    ...encoders.map((asset) => ({ id: asset.id, label: `${padId(asset.tokenId)} mine · ${piece(asset.id)?.dialect}` })),
    ...idleChoices(registry, "encoder", wallet, [], [characterId], ms),
  ];
  const cBase = completeBases.some((item) => item.id === completeBase) ? completeBase : baseId;
  const cEncoder = completeEncoders.some((item) => item.id === completeEncoder) ? completeEncoder : encoderId;
  const answerPieces = target && targetEmpty
    ? [
        { id: "", label: "draw from the idle pool" },
        ...mine
          .filter((asset) => asset.role === targetEmpty && cooling(registry, asset.id, block) === 0)
          .map((asset) => ({ id: asset.id, label: `${padId(asset.tokenId)} mine · ${piece(asset.id)?.dialect ?? piece(asset.id)?.form}` })),
        ...idleChoices(registry, targetEmpty, wallet, [target.characterId, target.baseId ?? "", target.encoderId ?? ""], [target.characterId, characterId], ms),
      ]
    : [];
  const aPiece = answerPieces.some((item) => item.id === answerPiece) ? answerPiece : (answerPieces[1]?.id ?? "");

  // The encoder that will hide this line, when it is known before sending.
  const lineEncoder =
    mode === "open-encoder" || mode === "open-base"
      ? mode === "open-encoder"
        ? encoderId
        : ""
      : mode === "complete"
        ? cEncoder
        : target?.encoderId ?? (targetEmpty === "encoder" ? aPiece : "");
  const dialect = lineEncoder ? piece(lineEncoder)?.dialect ?? null : null;

  const coolingAttached =
    mode === "open-base" ? cooling(registry, baseId, block) : mode === "open-encoder" ? cooling(registry, encoderId, block) : 0;
  const ready =
    !pending &&
    !busy &&
    draft.length > 0 &&
    mouthCool === 0 &&
    coolingAttached === 0 &&
    (mode === "open-base" ? Boolean(baseId) : mode === "open-encoder" ? Boolean(encoderId) : mode === "complete" ? Boolean(cBase && cEncoder) : Boolean(target));

  async function send() {
    const plaintext = draft;
    let result;
    if (mode === "open-base" || mode === "open-encoder") {
      result = await openConversation({ characterId, attachedId: mode === "open-base" ? baseId : encoderId, plaintext, seconds, answerer });
    } else if (mode === "complete") {
      result = await completeConversation({ characterId, baseId: cBase, encoderId: cEncoder, plaintext });
    } else if (target) {
      result = await respondTo({ convId: target.id, characterId, pieceId: aPiece, plaintext });
      if (result.ok) setAnswerTarget(null);
    }
    if (result?.ok) setDraft("");
  }

  const readable = registry.lines.filter((line) => canRead(registry, line, wallet, block));
  const readConvs = [...new Set(readable.map((line) => line.convId))].slice(-5);
  const counts = tally(readable);

  return (
    <section id="terminal" className="terminal" aria-label="Local terminal">
      <p className="prompt m-0">
        traceformers@local:~$ <span className="text-dim">{shortAddress(wallet)} · {providerName}</span>
      </p>

      {mine.length === 0 ? <p className="mt-3 mb-0 text-dim">this address holds no pieces. reset the local registry from the footer to get a new set.</p> : null}

      <p className="legend mt-4 mb-0">character · who speaks</p>
      {characters.map((asset) => {
        const on = asset.id === characterId;
        const cool = cooling(registry, asset.id, block);
        return (
          <div key={asset.id} className="pick-line">
            <button type="button" className={cx("pick-row", on && "is-on")} aria-pressed={on} onClick={() => setCharacterId(asset.id)}>
              <span className="pick">{on ? ">" : " "}</span>
              <span className="sig">{signature(asset.tokenId)}</span>
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
      {speaker ? (
        <>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <button type="button" className="act is-small" aria-expanded={face} onClick={() => setFace(!face)}>
              face
            </button>
            <span className="text-dim text-sm">{epithet(speaker)}</span>
          </div>
          {face ? (
            <div className="face">
              <img src={speaker.image} alt={`Trace ${padId(speaker.tokenId)}`} />
              <pre className="portrait">{portrait(speaker.tokenId).join("\n")}</pre>
            </div>
          ) : null}
        </>
      ) : null}

      <p className="legend mt-4 mb-0">base · opens the key</p>
      {bases.map((asset) => {
        const on = asset.id === baseId;
        const left = keyLeft(registry, asset.id, block);
        const cool = cooling(registry, asset.id, block);
        const idle = registry.idles.some((offer) => offer.assetId === asset.id);
        return (
          <div key={asset.id} className="pick-line">
            <button type="button" className={cx("pick-row", on && "is-on")} aria-pressed={on} onClick={() => setBaseId(asset.id)}>
              <span className="pick">{on ? ">" : " "}</span>
              <PieceMark id={asset.id} />
              <span className="id">{padId(asset.tokenId)}</span>
              <span className="text-dim">
                {piece(asset.id)?.form}
                {left > 0 ? ` · key ${left}` : ""}
                {idle ? " · idle" : ""}
              </span>
              {cool > 0 ? <span className="text-accent">cool {cool}</span> : null}
            </button>
            <button type="button" className={cx("act is-small", left > 0 && "is-on")} disabled={cool > 0 || pending} onClick={() => void openKeyOf(asset.id)}>
              key
            </button>
            <button type="button" className="act is-small" onClick={() => selectDetail(asset.id)}>
              info
            </button>
          </div>
        );
      })}

      <p className="legend mt-4 mb-0">encoder · hides the line</p>
      {encoders.map((asset) => {
        const on = asset.id === encoderId;
        const cool = cooling(registry, asset.id, block);
        const idle = registry.idles.some((offer) => offer.assetId === asset.id);
        return (
          <div key={asset.id} className="pick-line">
            <button type="button" className={cx("pick-row", on && "is-on")} aria-pressed={on} onClick={() => setEncoderId(asset.id)}>
              <span className="pick">{on ? ">" : " "}</span>
              <PieceMark id={asset.id} />
              <span className="id">{padId(asset.tokenId)}</span>
              <span className="text-dim">
                {piece(asset.id)?.dialect}
                {idle ? " · idle" : ""}
              </span>
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

      {mode === "open-base" || mode === "open-encoder" ? (
        <div className="mode-box">
          <p className="m-0 text-dim">
            {padId(speaker?.tokenId ?? 0)} speaks and brings {mode === "open-base" ? `base ${padId(piece(baseId)?.tokenId ?? 0)}` : `encoder ${padId(piece(encoderId)?.tokenId ?? 0)}`}. the{" "}
            {mode === "open-base" ? "encoder" : "base"} slot stays empty: whoever answers fills it. {mode === "open-encoder" ? "until a base joins, the line is sealed." : "until an encoder joins, the line is not encoded."}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="text-dim">window</span>
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

      {mode === "complete" ? (
        <div className="mode-box">
          <p className="m-0 text-dim">character + base + encoder in one signature. it closes at once, 1 point each. pieces you do not hold must be idle.</p>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <label className="field">
              <span>base</span>
              <select value={cBase} onChange={(event) => setCompleteBase(event.target.value)}>
                {completeBases.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>encoder</span>
              <select value={cEncoder} onChange={(event) => setCompleteEncoder(event.target.value)}>
                {completeEncoders.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
      ) : null}

      {mode === "answer" ? (
        <div className="mode-box">
          {answerable.length === 0 ? (
            <p className="m-0 text-dim">no opening waits for an answer right now.</p>
          ) : (
            <ul className="m-0 list-none p-0">
              {answerable.map((item) => {
                const on = item.id === target?.id;
                return (
                  <li key={item.id}>
                    <button type="button" className={cx("pick-row", on && "is-on")} aria-pressed={on} onClick={() => setAnswerTarget(item.id)}>
                      <span className="pick">{on ? ">" : " "}</span>
                      <Tok id={item.characterId} mine={mine.some((asset) => asset.id === item.characterId)} />
                      <span className="text-dim">
                        brings <PieceMark id={item.baseId ?? item.encoderId} /> {padId(piece(item.baseId ?? item.encoderId ?? "")?.tokenId ?? 0)} · needs {item.baseId ? "encoder" : "base"}
                      </span>
                      <span className="text-cyan">{formatLeft(item.deadline, unix(now))}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {target && targetEmpty ? (
            <div className="mt-2 flex flex-wrap items-end gap-2">
              <label className="field grow">
                <span>{targetEmpty} for the empty slot</span>
                <select value={aPiece} onChange={(event) => setAnswerPiece(event.target.value)}>
                  {answerPieces.map((item) => (
                    <option key={item.id || "draw"} value={item.id}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
              <button type="button" className="act is-small" onClick={() => openTalk(target.id)}>
                talk
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      <p className="mt-4 mb-3">
        <span className="text-dim">{"> "}</span>
        <span className="sig">{draft}</span>
        <span className="caret">_</span>
        <span className="ml-3 text-dim text-sm">
          {Array.from(draft).length}/{MAX_GLYPHS}
        </span>
      </p>

      <div className="flex flex-wrap gap-2">
        {glyphs.map((glyph) => (
          <button
            key={glyph}
            type="button"
            className="glyph-key"
            disabled={mouthCool > 0 || Array.from(draft).length >= MAX_GLYPHS}
            onClick={() => setDraft(draft + glyph)}
          >
            {glyph}
          </button>
        ))}
        <button type="button" className="act" disabled={draft.length === 0} onClick={() => setDraft(Array.from(draft).slice(0, -1).join(""))}>
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
        {coolingAttached > 0 ? <span className="text-accent">piece cools down {coolingAttached}</span> : null}
        {awaiting ? <span className="text-cyan">{answerer === "mine" && other ? `${padId(other.tokenId)} answers…` : "the network answers…"}</span> : null}
      </div>

      <div className="private">
        <p className="m-0 text-dim">read only here</p>
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
