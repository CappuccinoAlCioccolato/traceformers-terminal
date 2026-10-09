import { padId, piece } from "@/lib/trace/catalog";
import { dialectMark, decayed, visualCipher } from "@/lib/trace/marks";
import { conversationOf } from "@/lib/protocol/derive";
import { blockAt } from "@/lib/protocol/relayer";
import type { Conversation, Line, Registry } from "@/lib/protocol/types";
import { openTalk, useApp } from "@/lib/store";
import { useWallet } from "@/lib/wallet/store";
import { cx } from "./common";

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
