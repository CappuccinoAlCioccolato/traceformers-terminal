import { padId, piece } from "@/lib/trace/catalog";
import { dialectMark, decayed, visualCipher } from "@/lib/trace/marks";
import { canRead, conversationLines, conversationOf } from "@/lib/protocol/derive";
import { blockAt, keyLeft, unix } from "@/lib/protocol/relayer";
import type { Conversation, Line, Registry } from "@/lib/protocol/types";
import { exportTalkPng } from "@/lib/export-talk";
import { includeCallback, openTalk, setAnswerTarget, useApp } from "@/lib/store";
import { useWallet } from "@/lib/wallet/store";
import { PieceMark, Tok, cx, formatLeft } from "./common";

const WALL_TAIL = 9;

function mineSet(registry: Registry, wallet: string | null): Set<string> {
  if (!wallet) return new Set();
  return new Set(registry.assets.filter((asset) => asset.owner === wallet).map((asset) => asset.id));
}

/** A blink line lives one block on the public wall, then decays into a block of noise. */
export function isDecayed(registry: Registry, line: Line, block: number): boolean {
  const conversation = conversationOf(registry, line.convId);
  return piece(conversation?.baseId ?? "")?.form === "blink" && block > line.block + 1;
}

export function lineCipher(registry: Registry, line: Line, block: number): string {
  if (!line.ciphertext || !line.dialect) return "· · · no encoder yet";
  if (isDecayed(registry, line, block)) return decayed(line.ciphertext);
  return visualCipher(line.dialect, line.ciphertext);
}

function lineStatus(line: Line, byId: Map<string, Line>, conversation: Conversation | undefined): string {
  if (line.replyTo) {
    const parent = byId.get(line.replyTo);
    if (parent) return `ans ${padId(piece(parent.speakerId)?.tokenId ?? 0)}`;
  }
  if (!conversation) return "";
  if (conversation.status === "expired") return "expired";
  if (!conversation.baseId) return "sealed";
  if (conversation.status === "open") return "waiting";
  if (conversation.kind === "complete") return "complete";
  return piece(conversation.baseId)?.form ?? "";
}

function cluster(lines: Line[]): Line[][] {
  const groups: Line[][] = [];
  for (const line of lines) {
    const prev = groups[groups.length - 1];
    const last = prev?.[prev.length - 1];
    if (line.replyTo && last?.id === line.replyTo) prev.push(line);
    else groups.push([line]);
  }
  return groups;
}

export function Stream() {
  const registry = useApp((state) => state.registry)!;
  const now = useApp((state) => state.now);
  const talkId = useApp((state) => state.talkId);
  const wallet = useWallet((state) => state.address);
  const block = blockAt(registry, now);
  const mine = mineSet(registry, wallet);
  const byId = new Map(registry.lines.map((line) => [line.id, line]));
  const sorted = [...registry.lines].sort((a, b) => a.block - b.block || (a.replyTo === b.id ? 1 : b.replyTo === a.id ? -1 : 0));
  const groups = cluster(sorted.slice(-WALL_TAIL));

  return (
    <div className="muro-log" aria-live="polite">
      <ol className="m-0 list-none p-0">
        {groups.map((group) => (
          <li key={group[0].id} className={group.length > 1 ? "muro-cluster" : undefined}>
            {group.map((line) => {
              const conversation = conversationOf(registry, line.convId);
              const gone = isDecayed(registry, line, block);
              const classes = cx(
                "muro-row",
                line.dialect ? `is-${line.dialect}` : "is-bare",
                line.block >= block - 1 && "is-fresh",
                piece(conversation?.baseId ?? "")?.form === "blink" && !gone && "is-blink",
                gone && "is-gone",
                talkId === line.convId && "is-armed",
              );
              return (
                <button
                  key={line.id}
                  type="button"
                  className={classes}
                  aria-pressed={talkId === line.convId}
                  aria-label={`open talk of ${padId(piece(line.speakerId)?.tokenId ?? 0)}`}
                  onClick={() => openTalk(line.convId)}
                >
                  <span className="mark">{line.replyTo ? "└" : ""}</span>
                  <span className={cx("id", mine.has(line.speakerId) && "is-mine")}>{padId(piece(line.speakerId)?.tokenId ?? 0)}</span>
                  <span className={line.dialect ? `trait trait-${line.dialect}` : "trait text-dim"}>{line.dialect ? dialectMark(line.dialect) : "····"}</span>
                  <span className="cipher">{lineCipher(registry, line, block)}</span>
                  <span className="status">{lineStatus(line, byId, conversation)}</span>
                </button>
              );
            })}
          </li>
        ))}
      </ol>
      <p className="caret m-0 px-1 py-2" aria-hidden="true">
        _
      </p>
    </div>
  );
}

export function Talk() {
  const registry = useApp((state) => state.registry)!;
  const now = useApp((state) => state.now);
  const talkId = useApp((state) => state.talkId);
  const pending = useApp((state) => state.pending);
  const wallet = useWallet((state) => state.address);
  const conversation = conversationOf(registry, talkId);
  if (!conversation) return null;
  const block = blockAt(registry, now);
  const lines = conversationLines(registry, conversation.id);
  const byId = new Map(lines.map((line) => [line.id, line]));
  const mine = mineSet(registry, wallet);
  const closure = registry.closures.find((item) => item.id === conversation.closureId);
  const left = keyLeft(registry, conversation.baseId, block);
  const empty = conversation.status === "open" ? (conversation.baseId ? "encoder" : "base") : null;
  const canAnswer = Boolean(wallet && conversation.status === "open" && !conversation.draw && conversation.kind === "targeted");
  const readable = new Set(lines.filter((line) => canRead(registry, line, wallet, block)).map((line) => line.id));

  return (
    <section id="talk" className="talk" aria-label="Talk">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="prompt m-0">
          talk <span className="text-dim">{conversation.id}</span>
        </p>
        <div className="flex gap-2">
          <button type="button" className="act is-ready" onClick={() => void exportTalkPng(registry, conversation, lines, readable, block)}>
            png
          </button>
          <button type="button" className="act" onClick={() => openTalk(null)}>
            close
          </button>
        </div>
      </div>

      <dl className="talk-pieces">
        <dt>opens</dt>
        <dd>
          <Tok id={conversation.characterId} mine={mine.has(conversation.characterId)} /> <span className="text-dim">character</span>
        </dd>
        <dt>answers</dt>
        <dd>
          {conversation.responderId ? (
            <>
              <Tok id={conversation.responderId} mine={mine.has(conversation.responderId)} /> <span className="text-dim">character</span>
            </>
          ) : (
            <span className="text-dim">{conversation.kind === "complete" ? "nobody: complete offer" : "waiting"}</span>
          )}
        </dd>
        <dt>base</dt>
        <dd>
          <PieceMark id={conversation.baseId} /> <Tok id={conversation.baseId} mine={!!conversation.baseId && mine.has(conversation.baseId)} />{" "}
          <span className="text-dim">
            {conversation.baseId ? `${piece(conversation.baseId)?.form} · key ${left > 0 ? `open ${left}` : "closed"}` : "empty slot"}
          </span>
        </dd>
        <dt>encoder</dt>
        <dd>
          <PieceMark id={conversation.encoderId} /> <Tok id={conversation.encoderId} mine={!!conversation.encoderId && mine.has(conversation.encoderId)} />{" "}
          <span className="text-dim">{conversation.encoderId ? piece(conversation.encoderId)?.dialect : "empty slot"}</span>
        </dd>
        <dt>state</dt>
        <dd>
          {conversation.status === "open" ? (
            <span className="text-cyan">
              open · {formatLeft(conversation.deadline, unix(now))} left · missing {empty}
            </span>
          ) : conversation.status === "expired" ? (
            <span className="text-dim">expired · 0 points</span>
          ) : (
            <span className="text-accent">
              closed at block {closure?.block} · {conversation.kind} ·{" "}
              {closure ? `${closure.pointsInitiator}/${closure.pointsResponder}/${closure.pointsBase}/${closure.pointsEncoder} pts` : ""}
              {closure?.drawSeed ? " · drawn" : ""}
            </span>
          )}
        </dd>
      </dl>

      {conversation.draw ? (
        <p className="mt-3 mb-0 flex flex-wrap items-center gap-3">
          <span className="text-cyan">the relayer draws the missing {empty} from the idle pool…</span>
          <button type="button" className="act" disabled={pending} onClick={() => void includeCallback(conversation.id)}>
            include callback
          </button>
        </p>
      ) : null}

      {lines.map((line) => {
        const parent = line.replyTo ? byId.get(line.replyTo) : undefined;
        return (
          <div key={line.id} className="talk-line">
            <p className="talk-meta m-0">
              <Tok id={line.speakerId} mine={mine.has(line.speakerId)} />
              <span className="text-dim">
                {parent ? (
                  <>
                    answers <span className="text-ink">{padId(piece(parent.speakerId)?.tokenId ?? 0)}</span>
                  </>
                ) : (
                  "spoke"
                )}
              </span>
              <span className="text-dim">
                {line.dialect ? `encoder ${padId(piece(conversation.encoderId ?? "")?.tokenId ?? 0)} ${line.dialect}` : "no encoder yet"}
              </span>
              <span className="text-dim">block {line.block}</span>
            </p>
            <p className={cx("talk-cipher", line.dialect && `trait-${line.dialect}`)}>{lineCipher(registry, line, block)}</p>
            {readable.has(line.id) ? <p className="sig m-0">{line.plaintext}</p> : null}
          </div>
        );
      })}

      {canAnswer ? (
        <p className="mt-4 mb-0">
          <button type="button" className="act" onClick={() => setAnswerTarget(conversation.id)}>
            answer from my terminal
          </button>
        </p>
      ) : null}
    </section>
  );
}
