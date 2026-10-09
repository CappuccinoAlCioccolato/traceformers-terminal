import { useState } from "react";
import { padId, piece } from "@/lib/trace/catalog";
import { walletLabel } from "@/lib/protocol/derive";
import { blockAt, emptySeats, seatProblem, sideReady, unix } from "@/lib/protocol/relayer";
import type { Conversation, Registry, SideName, Slot } from "@/lib/protocol/types";
import { joinSeat, openTalk, setAnswerTarget, useApp } from "@/lib/store";
import { useWallet } from "@/lib/wallet/store";
import { Note } from "./help";
import { PieceMark, Tok, formatLeft } from "./common";

function seatLabel(conversation: Conversation, side: SideName, slot: Slot): string {
  if (slot === "character") return "a character to answer";
  if (slot === "encoder" && side === "answer") return `a ${conversation.dialect} encoder`;
  return slot === "encoder" ? "an encoder" : "a base";
}

/** The waiting room: the empty seats of open talks. Any holder can take one; a character can answer. */
export function Room() {
  const registry = useApp((state) => state.registry)!;
  const now = useApp((state) => state.now);
  const pending = useApp((state) => state.pending);
  const wallet = useWallet((state) => state.address);
  const [picked, setPicked] = useState<Record<string, string>>({});
  const block = blockAt(registry, now);
  const linked = Boolean(wallet && registry.links.includes(wallet));
  const open = registry.conversations.filter((item) => item.status === "open" && item.deadline > unix(now)).sort((a, b) => a.deadline - b.deadline);
  const talks = open.filter((item) => !sideReady(item.talk));
  const answers = open.filter((item) => sideReady(item.talk));

  const fitting = (conversation: Conversation, side: SideName, slot: Slot) =>
    wallet ? registry.assets.filter((asset) => asset.owner === wallet && asset.role === slot && !seatProblem(registry, conversation, side, slot, asset, block)) : [];

  const entry = (conversation: Conversation, side: SideName) => {
    const speaker = conversation[side].character ?? conversation.talk.character;
    const seats = emptySeats(conversation).filter((item) => item.side === side);
    return (
      <li key={`${conversation.id}-${side}`} className="room-entry">
        <p className="m-0 flex flex-wrap items-baseline gap-x-3">
          <button type="button" className="link-btn" onClick={() => openTalk(conversation.id)}>
            {side === "talk" ? "talk of" : "answer to"} {padId(piece(conversation.talk.character?.id ?? "")?.tokenId ?? 0)}
          </button>
          {side === "answer" && conversation.answer.character ? (
            <span className="text-dim">
              by <Tok id={conversation.answer.character.id} mine={conversation.answer.character.holder === wallet} />
            </span>
          ) : null}
          <span className={speaker?.holder === wallet ? "text-you" : "text-dim"}>{speaker?.holder === wallet ? "you" : walletLabel(registry, speaker?.holder ?? "")}</span>
          {conversation.dialect ? <span className={`trait-${conversation.dialect}`}>{conversation.dialect}</span> : null}
          <span className="text-cyan">{formatLeft(conversation.deadline, unix(now))}</span>
        </p>
        <ul className="m-0 list-none p-0">
          {seats.map(({ slot }) => {
            const key = `${conversation.id}:${side}:${slot}`;
            if (slot === "character") {
              const characters = fitting(conversation, side, "character");
              return (
                <li key={key} className="room-seat">
                  <span className="text-dim">needs {seatLabel(conversation, side, slot)}</span>
                  {linked && characters.length ? (
                    <button type="button" className="act is-small" onClick={() => setAnswerTarget(conversation.id)}>
                      answer from my terminal
                    </button>
                  ) : null}
                </li>
              );
            }
            const options = fitting(conversation, side, slot);
            const choice = options.some((asset) => asset.id === picked[key]) ? picked[key]! : (options[0]?.id ?? "");
            return (
              <li key={key} className="room-seat">
                <span className="text-dim">needs {seatLabel(conversation, side, slot)}</span>
                {linked && options.length ? (
                  <>
                    <select className="room-select" value={choice} onChange={(event) => setPicked({ ...picked, [key]: event.target.value })} aria-label={`your ${slot}`}>
                      {options.map((asset) => (
                        <option key={asset.id} value={asset.id}>
                          {padId(asset.tokenId)} · {piece(asset.id)?.dialect ?? piece(asset.id)?.form}
                        </option>
                      ))}
                    </select>
                    <PieceMark id={choice} />
                    <button type="button" className="act is-small is-ready" disabled={pending} onClick={() => void joinSeat({ convId: conversation.id, side, assetId: choice })}>
                      join
                    </button>
                  </>
                ) : linked ? (
                  <span className="text-edge">none of yours fits now</span>
                ) : null}
              </li>
            );
          })}
        </ul>
      </li>
    );
  };

  return (
    <section id="room" className="room" aria-label="Waiting room">
      <p className="prompt m-0">waiting room</p>
      <p className="mt-1 mb-0 text-sm text-dim">
        the empty seats of open talks. a base or an encoder joins with one signature, no character needed. a character answers from the terminal. if nobody comes,
        the network or the idle pool fills the seat.
      </p>
      <div className="room-grid">
        <div>
          <p className="legend mt-3 mb-1">talks · a character spoke and waits for its base and encoder</p>
          {talks.length === 0 ? <p className="m-0 text-dim">no talk is missing pieces_</p> : null}
          <ul className="m-0 list-none p-0">{talks.map((item) => entry(item, "talk"))}</ul>
        </div>
        <div>
          <p className="legend mt-3 mb-1">answers · the talk is encoded; the answer needs its character, base, and same-dialect encoder</p>
          {answers.length === 0 ? <p className="m-0 text-dim">no answer is waiting_</p> : null}
          <ul className="m-0 list-none p-0">{answers.map((item) => entry(item, "answer"))}</ul>
        </div>
      </div>
      {!linked ? <p className="mt-3 mb-0 text-sm text-dim">connect and sign in to take a seat.</p> : null}
      <Note scope="room" />
    </section>
  );
}

export function countWaiting(registry: Registry, nowMs: number): number {
  return registry.conversations.filter((item) => item.status === "open" && item.deadline > unix(nowMs)).reduce((sum, item) => sum + emptySeats(item).length, 0);
}

