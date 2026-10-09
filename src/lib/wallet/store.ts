import { create } from "zustand";
import { createWalletClient, custom, getAddress, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { mainnet } from "viem/chains";
import { DOMAIN, type TypedSpec } from "@/lib/protocol/domain";

const LOCAL_KEY = "traceformers-terminal.session-key";
const OFF_KEY = "traceformers-terminal.session-off";

type EthereumProvider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
};

type Announced = { uuid: string; name: string; icon: string; provider: EthereumProvider };

type WalletState = {
  address: string | null;
  source: "injected" | "session" | null;
  providerName: string | null;
  providers: { uuid: string; name: string; icon: string }[];
  busy: boolean;
  error: string | null;
  discover: () => void;
  connectInjected: (uuid: string) => Promise<void>;
  connectSession: () => void;
  disconnect: () => void;
  signTyped: (spec: TypedSpec) => Promise<Hex>;
};

const announced = new Map<string, Announced>();
let injected: EthereumProvider | null = null;
let sessionKey: Hex | null = null;
let listening = false;

function readKey(): Hex | null {
  try {
    return window.localStorage.getItem(LOCAL_KEY) as Hex | null;
  } catch {
    return null;
  }
}

function writeKey(key: Hex | null) {
  try {
    if (key) window.localStorage.setItem(LOCAL_KEY, key);
    else window.localStorage.removeItem(LOCAL_KEY);
  } catch {
    /* private window: the session wallet lives only in memory */
  }
}

function flag(on: boolean | null): boolean {
  try {
    if (on === true) window.localStorage.setItem(OFF_KEY, "1");
    if (on === false) window.localStorage.removeItem(OFF_KEY);
    return window.localStorage.getItem(OFF_KEY) === "1";
  } catch {
    return false;
  }
}

function mapWalletError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (/rejected|denied|4001/i.test(message)) return "Signature rejected in the wallet.";
  if (/No injected/i.test(message)) return "No wallet in this browser.";
  return message.split("\n")[0] || "The wallet did not finish the request.";
}

export const useWallet = create<WalletState>((set, get) => ({
  address: null,
  source: null,
  providerName: null,
  providers: [],
  busy: false,
  error: null,
  discover: () => {
    if (!listening) {
      listening = true;
      window.addEventListener("eip6963:announceProvider", ((event: Event) => {
        const detail = (event as CustomEvent<{ info: { uuid: string; name: string; icon: string }; provider: EthereumProvider }>).detail;
        if (!detail?.info?.uuid || !detail.provider) return;
        announced.delete("injected");
        announced.set(detail.info.uuid, { ...detail.info, provider: detail.provider });
        set({ providers: [...announced.values()].map(({ uuid, name, icon }) => ({ uuid, name, icon })) });
      }) as EventListener);
    }
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    const ethereum = (window as Window & { ethereum?: EthereumProvider }).ethereum;
    if (ethereum && announced.size === 0) {
      announced.set("injected", { uuid: "injected", name: "browser wallet", icon: "", provider: ethereum });
      set({ providers: [{ uuid: "injected", name: "browser wallet", icon: "" }] });
    }
    const stored = readKey();
    if (stored && !get().address && !flag(null)) {
      try {
        const account = privateKeyToAccount(stored);
        sessionKey = stored;
        set({ address: account.address.toLowerCase(), source: "session", providerName: "session wallet", error: null });
      } catch {
        writeKey(null);
      }
    }
  },
  connectInjected: async (uuid) => {
    const found = announced.get(uuid);
    if (!found) {
      set({ error: "That wallet is no longer available." });
      return;
    }
    set({ busy: true, error: null });
    try {
      const accounts = (await found.provider.request({ method: "eth_requestAccounts" })) as string[];
      const account = accounts[0];
      if (!account) throw new Error("The wallet did not return an address.");
      injected = found.provider;
      sessionKey = null;
      set({ address: getAddress(account).toLowerCase(), source: "injected", providerName: found.name, busy: false });
      found.provider.on?.("accountsChanged", (...args: unknown[]) => {
        const next = args[0] as string[] | undefined;
        if (!next?.[0]) set({ address: null, source: null, providerName: null });
        else set({ address: getAddress(next[0]).toLowerCase() });
      });
    } catch (err) {
      set({ busy: false, error: mapWalletError(err) });
    }
  },
  connectSession: () => {
    let key = readKey();
    if (!key) {
      key = generatePrivateKey();
      writeKey(key);
    }
    const account = privateKeyToAccount(key);
    flag(false);
    sessionKey = key;
    injected = null;
    set({ address: account.address.toLowerCase(), source: "session", providerName: "session wallet", error: null });
  },
  disconnect: () => {
    // The session key stays in this browser, so the same address and its pieces come back on reconnect.
    if (get().source === "session") flag(true);
    injected = null;
    sessionKey = null;
    set({ address: null, source: null, providerName: null, error: null });
  },
  signTyped: async (spec) => {
    set({ busy: true, error: null });
    try {
      let signature: Hex;
      const typed = { domain: DOMAIN, types: spec.types, primaryType: spec.primaryType, message: spec.message };
      if (sessionKey) {
        signature = await privateKeyToAccount(sessionKey).signTypedData(typed as never);
      } else if (injected && get().address) {
        const account = getAddress(get().address!);
        const client = createWalletClient({ account, chain: mainnet, transport: custom(injected) });
        signature = await client.signTypedData({ account, ...typed } as never);
      } else {
        throw new Error("Connect a wallet before signing.");
      }
      set({ busy: false });
      return signature;
    } catch (err) {
      const error = mapWalletError(err);
      set({ busy: false, error });
      throw new Error(error);
    }
  },
}));
