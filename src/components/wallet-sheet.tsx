import { useEffect } from "react";
import { shortAddress } from "@/lib/protocol/domain";
import { linkWallet, setSheet, useApp } from "@/lib/store";
import { useWallet } from "@/lib/wallet/store";

export function WalletSheet() {
  const open = useApp((state) => state.sheet);
  const registry = useApp((state) => state.registry);
  const pending = useApp((state) => state.pending);
  const wallet = useWallet();

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSheet(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!open) return null;
  const linked = Boolean(wallet.address && registry?.links.includes(wallet.address));

  return (
    <div className="sheet-backdrop" role="presentation" onClick={() => setSheet(false)}>
      <div role="dialog" aria-modal="true" aria-labelledby="wallet-title" className="sheet" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-baseline justify-between gap-3">
          <p id="wallet-title" className="prompt m-0">
            traceformers@wallet:~$
          </p>
          <button type="button" className="act is-small" onClick={() => setSheet(false)}>
            close
          </button>
        </div>
        <p className="mt-3 mb-0 text-muted">EIP-712 signatures only. Nothing asks for ether and no Trace token moves on Ethereum.</p>
        {wallet.address ? (
          <p className="mt-3 mb-0">
            <span className="text-cyan">connected</span> <span className="text-dim">{wallet.providerName}</span> {shortAddress(wallet.address)}
            {linked ? <span className="text-accent"> · signed in</span> : null}
          </p>
        ) : null}
        {wallet.error ? <p className="mt-3 mb-0 text-you">{wallet.error}</p> : null}
        <div className="mt-4 flex flex-col gap-2">
          {wallet.providers.map((provider) => (
            <button key={provider.uuid} type="button" className="act sheet-btn" disabled={wallet.busy} onClick={() => void wallet.connectInjected(provider.uuid)}>
              {provider.icon ? <img src={provider.icon} alt="" className="size-5" /> : <span className="text-dim">{">"}</span>}
              {provider.name}
            </button>
          ))}
          {wallet.providers.length === 0 ? (
            <p className="m-0 text-dim text-sm">no wallet extension in this browser. a session wallet keeps its key in this browser and signs the same EIP-712 messages.</p>
          ) : null}
          <button type="button" className={wallet.source === "session" ? "act sheet-btn is-on" : "act sheet-btn"} disabled={wallet.busy} onClick={() => wallet.connectSession()}>
            <span className="text-dim">{">"}</span>
            {wallet.source === "session" ? "session wallet active" : "session wallet"}
          </button>
          {wallet.address && !linked ? (
            <button type="button" className="act sheet-btn is-ready" disabled={wallet.busy || pending} onClick={() => void linkWallet().then((result) => result.ok && setSheet(false))}>
              sign in with this address
            </button>
          ) : null}
          {wallet.address ? (
            <button type="button" className="act sheet-btn" onClick={() => wallet.disconnect()}>
              disconnect
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
