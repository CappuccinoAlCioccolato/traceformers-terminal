import { useEffect } from "react";
import { TRACE_COLLECTION, TRACE_SITE } from "@/lib/trace/catalog";
import { shortAddress } from "@/lib/protocol/domain";
import { blockAt } from "@/lib/protocol/relayer";
import { bootApp, dismissNote, resetRegistry, setSheet, setView, toggleIntro, useApp, type View } from "@/lib/store";
import { useWallet } from "@/lib/wallet/store";
import { cx } from "@/components/common";
import { Detail } from "@/components/detail";
import { Terminal } from "@/components/terminal";
import { Stream, Talk } from "@/components/wall";
import { WalletSheet } from "@/components/wallet-sheet";
import { Views } from "@/components/views";

const VIEWS: { id: View; label: string }[] = [
  { id: "wall", label: "wall" },
  { id: "graph", label: "graph" },
  { id: "pool", label: "pool" },
  { id: "board", label: "board" },
];

const HOW: [string, string][] = [
  ["character", "speaks. only glyphs from its own 35×21 grid. the only piece with an intention: it opens."],
  ["encoder", "hides the line in its dialect: binary, base64, or punched card."],
  ["base", "opens the key of the thread. classic and inverted hold it 12 blocks, blink one."],
  ["open", "your character speaks and brings a base or an encoder. one slot stays empty."],
  ["answer", "another character signs a reply, cites your #, and fills the slot: its own piece, an idle one, or a draw."],
  ["complete", "character + base + encoder in one signature. closes at once, 1 point each."],
  ["points", "only a closed talk scores: 3 / 3 / 1 / 1. expired: 0. points stay on the NFT."],
  ["read", "plaintext shows only in your terminal, only while a base of that talk keeps the key open."],
  ["fee", "none. you sign EIP-712 messages; the relayer includes them."],
];

export function App() {
  const registry = useApp((state) => state.registry);
  const now = useApp((state) => state.now);
  const view = useApp((state) => state.view);
  const intro = useApp((state) => state.intro);
  const note = useApp((state) => state.note);
  const detailId = useApp((state) => state.detailId);
  const wallet = useWallet((state) => state.address);
  const discover = useWallet((state) => state.discover);

  useEffect(() => bootApp(), []);
  useEffect(() => discover(), [discover]);

  const block = registry ? blockAt(registry, now) : 0;
  const open = registry ? registry.conversations.filter((item) => item.status === "open").length : 0;

  return (
    <div className={cx("frame", detailId && "has-drawer")}>
      <main className="shell">
        <header className="topbar">
          <p className="prompt m-0">traceformers@terminal:~$</p>
          <div className="topbar-meta">
            {registry ? <span>{open} open</span> : null}
            <span>
              block <span key={block} className="block-tick">{block || "…"}</span>
            </span>
            <button type="button" className="act is-small" aria-expanded={intro} onClick={toggleIntro}>
              how
            </button>
            <button type="button" className={cx("act is-small", !wallet && "is-ready")} onClick={() => setSheet(true)}>
              {wallet ? shortAddress(wallet) : "connect"}
            </button>
          </div>
        </header>

        <nav className="views" aria-label="Views">
          {VIEWS.map((item) => (
            <button key={item.id} type="button" className={cx("view-tab", view === item.id && "is-on")} aria-current={view === item.id ? "page" : undefined} onClick={() => setView(item.id)}>
              {view === item.id ? `[${item.label}]` : item.label}
            </button>
          ))}
        </nav>

        {intro ? (
          <dl className="intro">
            {HOW.map(([term, text]) => (
              <div key={term} className="intro-row">
                <dt>{term}</dt>
                <dd>{text}</dd>
              </div>
            ))}
          </dl>
        ) : null}

        {note ? (
          <p className={cx("note", note.tone === "error" && "is-error")} role="status">
            <span>{note.tone === "error" ? "! " : "> "}</span>
            {note.text}
            <button type="button" className="link-btn ml-3 text-dim" onClick={dismissNote}>
              dismiss
            </button>
          </p>
        ) : null}

        {!registry ? (
          <p className="caret m-0 px-4 py-6">_</p>
        ) : view === "wall" ? (
          <>
            <Stream />
            <Talk />
            <Terminal />
          </>
        ) : (
          <Views view={view} />
        )}

        <footer className="footnote">
          <p className="m-0">the game is not built here. it is read, if the log holds.</p>
          <p className="mt-2 mb-0">
            the relayer of this build runs in your browser: the registry, the six network holders, and every signature check live here, not on a server.{" "}
            <button
              type="button"
              className="link-btn"
              onClick={() => {
                if (window.confirm("Reset the local registry to genesis? Pieces, offers, and closures in this browser are cleared.")) void resetRegistry();
              }}
            >
              reset local registry
            </button>
          </p>
          <p className="mt-2 mb-0">
            <a href={TRACE_SITE}>traceforms.xyz</a> · <a href={TRACE_COLLECTION}>trace on opensea</a> · unofficial
          </p>
        </footer>
      </main>
      <Detail />
      <WalletSheet />
    </div>
  );
}
