import { useEffect } from "react";
import { TRACE_COLLECTION, TRACE_SITE } from "@/lib/trace/catalog";
import { shortAddress } from "@/lib/protocol/domain";
import { blockAt } from "@/lib/protocol/relayer";
import { bootApp, resetRegistry, setSheet, setView, useApp, type View } from "@/lib/store";
import { useWallet } from "@/lib/wallet/store";
import { cx } from "@/components/common";
import { Detail } from "@/components/detail";
import { Guide, Note } from "@/components/help";
import { TalkWindow } from "@/components/talk-window";
import { Terminal } from "@/components/terminal";
import { Views } from "@/components/views";
import { Stream } from "@/components/wall";
import { Room, countWaiting } from "@/components/room";
import { WalletSheet } from "@/components/wallet-sheet";

const VIEWS: { id: View; label: string }[] = [
  { id: "wall", label: "wall" },
  { id: "graph", label: "graph" },
  { id: "pool", label: "pool" },
  { id: "board", label: "board" },
];

export function App() {
  const registry = useApp((state) => state.registry);
  const now = useApp((state) => state.now);
  const view = useApp((state) => state.view);
  const detailId = useApp((state) => state.detailId);
  const wallet = useWallet((state) => state.address);
  const discover = useWallet((state) => state.discover);

  useEffect(() => bootApp(), []);
  useEffect(() => discover(), [discover]);

  const block = registry ? blockAt(registry, now) : 0;
  const open = registry ? registry.conversations.filter((item) => item.status === "open").length : 0;
  const seats = registry ? countWaiting(registry, now) : 0;

  return (
    <div className={cx("frame", detailId && "has-drawer")}>
      <main className="shell">
        <header className="topbar">
          <p className="prompt m-0">traceformers@terminal:~$</p>
          <div className="topbar-meta">
            {registry ? (
              <button type="button" className="link-btn" onClick={() => { setView("wall"); window.requestAnimationFrame(() => document.getElementById("room")?.scrollIntoView({ behavior: "smooth" })); }}>
                {open} open · {seats} seat{seats === 1 ? "" : "s"} waiting
              </button>
            ) : null}
            <span>
              block <span key={block} className="block-tick">{block || "…"}</span>
            </span>
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

        <Guide view={view} />

        {!registry ? (
          <p className="caret m-0 px-4 py-6">_</p>
        ) : view === "wall" ? (
          <>
            <Stream />
            <Room />
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
          <Note scope="footer" />
          <p className="mt-2 mb-0">
            <a href={TRACE_SITE}>traceforms.xyz</a> · <a href={TRACE_COLLECTION}>trace on opensea</a> · unofficial
          </p>
        </footer>
      </main>
      <Detail />
      <TalkWindow />
      <WalletSheet />
    </div>
  );
}
