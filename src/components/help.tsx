import { useState } from "react";
import { dismissNote, useApp, type Scope, type View } from "@/lib/store";
import { cx } from "./common";

const GUIDE: Record<View, { title: string; rows: [string, string][] }> = {
  wall: {
    title: "how the wall works",
    rows: [
      ["character", "speaks, only with glyphs from its own 35×21 grid. it is the only piece that opens a talk."],
      ["encoder", "hides the line in its dialect: binary, base64, or punched card."],
      ["base", "holds the key. while it is open (12 blocks, blink 1) the holders of that talk read the plaintext here."],
      ["open", "your character speaks and brings a base or an encoder. whoever answers brings the other one."],
      ["answer", "another character replies, cites your #, and fills the empty slot: its own piece, an idle one, or a draw."],
      ["complete", "character, base, and encoder in one signature. it closes at once, 1 point each."],
      ["wall", "everyone sees only the ciphertext. click a line to open its talk."],
      ["fee", "none. you sign EIP-712 messages; the relayer includes them."],
    ],
  },
  graph: {
    title: "how to read the graph",
    rows: [
      ["nodes", "every piece and wallet that took part in a closed talk. a bigger character has more points."],
      ["lines", "grey: pieces used together · magenta: a character answered another · dotted: who held the piece."],
      ["focus", "click a node, or pick a role and type its #. the log below then lists only its transactions."],
      ["reset", "click empty space in the graph to see the whole network again."],
      ["log", "every signed step, newest first. click a row to open its talk. yours are red."],
    ],
  },
  pool: {
    title: "how the idle pool works",
    rows: [
      ["idle", "one signature lets other holders use your base or encoder in their talks, without asking you each time."],
      ["limits", "it stands until you revoke it, or until its max uses or expiry run out."],
      ["blocked", "you can name characters that may not use the piece."],
      ["draw", "when an answer leaves the slot to chance, the relayer draws an eligible idle piece."],
      ["delegate", "hand the signing rights of a piece to another address in this registry. not a sale, not an Ethereum transfer."],
    ],
  },
  board: {
    title: "how points work",
    rows: [
      ["targeted", "a talk that closes: opening character 3, answering character 3, base 1, encoder 1."],
      ["complete", "one holder, one signature: 1 point to each piece."],
      ["expired", "an opening nobody answered in time: 0 for everyone."],
      ["nft", "points stay on the NFT. by wallet sums what an address holds now."],
      ["you", "your rows are red. click any row to see the talks behind it."],
    ],
  },
};

const KEY = "traceformers-terminal.guide";

function readOpen(view: View): boolean {
  try {
    return window.localStorage.getItem(`${KEY}.${view}`) === "open";
  } catch {
    return false;
  }
}

/** A short guide for the page in view, folded by default and remembered per page. */
export function Guide({ view }: { view: View }) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const isOpen = open[view] ?? readOpen(view);
  const guide = GUIDE[view];
  const toggle = () => {
    const next = !isOpen;
    setOpen({ ...open, [view]: next });
    try {
      window.localStorage.setItem(`${KEY}.${view}`, next ? "open" : "closed");
    } catch {
      /* the choice lasts for this tab */
    }
  };
  return (
    <section className={cx("guide", isOpen && "is-open")} aria-label={guide.title}>
      <button type="button" className="guide-bar" aria-expanded={isOpen} onClick={toggle}>
        <span className="text-cyan">?</span>
        <span>{guide.title}</span>
        <span className="guide-toggle">{isOpen ? "[hide]" : "[show]"}</span>
      </button>
      {isOpen ? (
        <dl className="intro">
          {guide.rows.map(([term, text]) => (
            <div key={term} className="intro-row">
              <dt>{term}</dt>
              <dd>{text}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </section>
  );
}

/** The result of the last action, shown under the section that produced it. */
export function Note({ scope }: { scope: Scope }) {
  const note = useApp((state) => state.note);
  if (!note || note.scope !== scope) return null;
  return (
    <p className={cx("note", note.tone === "error" && "is-error")} role="status">
      <span>{note.tone === "error" ? "! " : "> "}</span>
      {note.text}
      <button type="button" className="link-btn ml-3 text-dim" onClick={dismissNote}>
        dismiss
      </button>
    </p>
  );
}
