// Wallet connection via wagmi + viem. Keyless: every signature happens in the visitor's own wallet.
// Connectors: every injected browser wallet found through EIP-6963 (its own name and icon), a generic
// injected fallback for plain window.ethereum, WalletConnect (if VITE_WALLETCONNECT_PROJECT_ID is set)
// and Coinbase Wallet. The connect modal is ours (components/WalletModal.tsx), styled with the design system.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { BaseError, UserRejectedRequestError, type Address, type WalletClient } from "viem";
import {
  createConfig,
  createStorage,
  fallback,
  http,
  noopStorage,
  useBalance,
  useConnect,
  useConnection,
  useConnections,
  useConnectors,
  useDisconnect,
  useSwitchChain,
  useWalletClient,
  WagmiProvider,
  type Connector,
} from "wagmi";
import { coinbaseWallet, injected, walletConnect } from "wagmi/connectors";
import { chain, RPC_FALLBACK_URL, RPC_URL } from "./chain";

export const WALLETCONNECT_PROJECT_ID: string = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID?.trim() ?? "";
if (!WALLETCONNECT_PROJECT_ID) {
  console.warn("[bursar] VITE_WALLETCONNECT_PROJECT_ID is not set: the WalletConnect option is hidden.");
}

/** localStorage that never throws (private mode, blocked storage, previews). */
const safeLocalStorage = (() => {
  try {
    const k = "__bursar_probe__";
    window.localStorage.setItem(k, "1");
    window.localStorage.removeItem(k);
    return {
      getItem: (key: string) => {
        try {
          return window.localStorage.getItem(key);
        } catch {
          return null;
        }
      },
      setItem: (key: string, value: string) => {
        try {
          window.localStorage.setItem(key, value);
        } catch {
          /* ignore */
        }
      },
      removeItem: (key: string) => {
        try {
          window.localStorage.removeItem(key);
        } catch {
          /* ignore */
        }
      },
    };
  } catch {
    return noopStorage;
  }
})();

export const wagmiConfig = createConfig({
  chains: [chain],
  connectors: [
    injected({ shimDisconnect: true }),
    ...(WALLETCONNECT_PROJECT_ID
      ? [
          walletConnect({
            projectId: WALLETCONNECT_PROJECT_ID,
            showQrModal: false, // we render the QR in our own modal
            metadata: {
              name: "Bursar",
              description: "Onchain treasury and policy layer for AI agents",
              url: typeof window !== "undefined" ? window.location.origin : "https://localhost",
              icons: [],
            },
          }),
        ]
      : []),
    coinbaseWallet({ appName: "Bursar" }),
  ],
  transports: {
    [chain.id]: RPC_FALLBACK_URL ? fallback([http(RPC_URL), http(RPC_FALLBACK_URL)]) : http(RPC_URL),
  },
  multiInjectedProviderDiscovery: true, // EIP-6963: each installed wallet becomes its own connector
  storage: createStorage({ storage: safeLocalStorage, key: "bursar.wallet" }), // remembers the last connector
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}

const queryClient = new QueryClient();

export function friendlyError(e: unknown): string {
  if (e instanceof BaseError && e.walk((x) => x instanceof UserRejectedRequestError)) return "Request rejected in your wallet.";
  const err = e as { code?: number; shortMessage?: string; message?: string; name?: string };
  if (err?.code === 4001 || err?.name === "UserRejectedRequestError") return "Request rejected in your wallet.";
  if (err?.name === "ConnectorAlreadyConnectedError") return "That wallet is already connected.";
  if (err?.name === "ProviderNotFoundError") return "That wallet isn't available in this browser.";
  return err?.shortMessage ?? err?.message ?? String(e);
}

// ---------------------------------------------------------------- app-facing wallet state

type WalletState = {
  account: Address | null;
  chainId: number | null;
  onRightChain: boolean;
  connecting: boolean;
  connectorName: string | null;
  error: string | null;
  walletClient: WalletClient | null;
  balance: bigint | null; // native ETH on Arbitrum Sepolia
  modalOpen: boolean;
  /** Opens the connect modal. */
  connect: () => void;
  closeModal: () => void;
  connectWith: (connector: Connector) => Promise<void>;
  switchChain: () => Promise<void>;
  disconnect: () => void;
  clearError: () => void;
};

const WalletContext = createContext<WalletState | null>(null);

function WalletStateProvider({ children }: { children: ReactNode }) {
  const conn = useConnection();
  const { mutateAsync: connectAsync, isPending: connecting } = useConnect();
  const { mutateAsync: switchChainAsync } = useSwitchChain();
  const { mutateAsync: disconnectAsync } = useDisconnect();
  const connections = useConnections();
  const { data: walletClient } = useWalletClient({ chainId: chain.id });
  const account = conn.status === "connected" ? conn.address : null;
  const { data: bal } = useBalance({ address: account ?? undefined, chainId: chain.id, query: { enabled: !!account, refetchInterval: 15000 } });
  const [modalOpen, setModalOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onRightChain = !!account && conn.chainId === chain.id;

  const switchChain = useCallback(async () => {
    setError(null);
    try {
      // wagmi asks the wallet to switch, and to add Arbitrum Sepolia first if it doesn't know it (4902).
      await switchChainAsync({ chainId: chain.id });
    } catch (e) {
      setError(friendlyError(e));
    }
  }, [switchChainAsync]);

  const connectWith = useCallback(
    async (connector: Connector) => {
      setError(null);
      try {
        const res = await connectAsync({ connector });
        setModalOpen(false);
        if (res.chainId !== chain.id) await switchChain(); // prompt to switch right after connecting
      } catch (e) {
        setError(friendlyError(e));
      }
    },
    [connectAsync, switchChain],
  );

  // Close the modal once connected (e.g. after a WalletConnect scan on a phone).
  useEffect(() => {
    if (account) setModalOpen(false);
  }, [account]);

  const value: WalletState = {
    account,
    chainId: account ? conn.chainId ?? null : null,
    onRightChain,
    connecting,
    connectorName: conn.connector?.name ?? null,
    error,
    walletClient: onRightChain ? ((walletClient as WalletClient | undefined) ?? null) : null,
    balance: bal?.value ?? null,
    modalOpen,
    connect: () => {
      setError(null);
      setModalOpen(true);
    },
    closeModal: () => setModalOpen(false),
    connectWith,
    switchChain,
    // Disconnect every connection (wagmi can hold several), not just the current one.
    disconnect: () => {
      for (const c of connections) disconnectAsync({ connector: c.connector }).catch(() => {});
    },
    clearError: () => setError(null),
  };
  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function WalletProvider({ children }: { children: ReactNode }) {
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <WalletStateProvider>{children}</WalletStateProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}

export function useWallet(): WalletState {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used inside <WalletProvider>");
  return ctx;
}

/** Connectors for the modal: discovered EIP-6963 wallets first; the generic injected entry only if none. */
export function useWalletOptions() {
  const connectors = useConnectors();
  return useMemo(() => {
    const discovered = connectors.filter((c) => c.type === "injected" && c.id !== "injected");
    const generic = connectors.find((c) => c.id === "injected");
    const hasWindowEthereum = typeof window !== "undefined" && !!(window as { ethereum?: unknown }).ethereum;
    const browser = discovered.length > 0 ? discovered : generic && hasWindowEthereum ? [generic] : [];
    return {
      browser,
      walletConnect: connectors.find((c) => c.type === "walletConnect") ?? null,
      coinbase: connectors.find((c) => c.type === "coinbaseWallet") ?? null,
    };
  }, [connectors]);
}
