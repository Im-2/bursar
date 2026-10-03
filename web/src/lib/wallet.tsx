// Browser-wallet connection through the injected EIP-1193 provider (window.ethereum).
// No private keys exist in this app: every signature happens inside the visitor's wallet.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { createWalletClient, custom, getAddress, numberToHex, type Address, type EIP1193Provider, type WalletClient } from "viem";
import { chain, RPC_URL, EXPLORER } from "./chain";

type WalletState = {
  hasProvider: boolean;
  account: Address | null;
  chainId: number | null;
  onRightChain: boolean;
  connecting: boolean;
  error: string | null;
  walletClient: WalletClient | null;
  connect: () => Promise<void>;
  switchChain: () => Promise<void>;
};

const WalletContext = createContext<WalletState | null>(null);

function getProvider(): EIP1193Provider | undefined {
  return (window as unknown as { ethereum?: EIP1193Provider }).ethereum;
}

function errorText(e: unknown): string {
  const err = e as { code?: number; shortMessage?: string; message?: string };
  if (err?.code === 4001) return "Request rejected in your wallet.";
  return err?.shortMessage ?? err?.message ?? String(e);
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const [provider] = useState(getProvider);
  const [account, setAccount] = useState<Address | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Silent reconnect (eth_accounts never prompts) and live account/network tracking.
  useEffect(() => {
    if (!provider) return;
    const onAccounts = (accs: string[]) => setAccount(accs[0] ? getAddress(accs[0]) : null);
    const onChain = (id: string) => setChainId(Number(id));
    provider.request({ method: "eth_accounts" }).then((a) => onAccounts(a as string[])).catch(() => {});
    provider.request({ method: "eth_chainId" }).then((id) => onChain(id as string)).catch(() => {});
    provider.on("accountsChanged", onAccounts as never);
    provider.on("chainChanged", onChain as never);
    return () => {
      provider.removeListener("accountsChanged", onAccounts as never);
      provider.removeListener("chainChanged", onChain as never);
    };
  }, [provider]);

  const switchChain = useCallback(async () => {
    if (!provider) return;
    setError(null);
    const hexId = numberToHex(chain.id);
    try {
      await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hexId }] });
    } catch (e) {
      if ((e as { code?: number }).code === 4902) {
        // The wallet doesn't know Arbitrum Sepolia yet: offer to add it.
        try {
          await provider.request({
            method: "wallet_addEthereumChain",
            params: [
              {
                chainId: hexId,
                chainName: chain.name,
                nativeCurrency: chain.nativeCurrency,
                rpcUrls: [RPC_URL],
                blockExplorerUrls: [EXPLORER],
              },
            ],
          });
        } catch (e2) {
          setError(errorText(e2));
        }
      } else {
        setError(errorText(e));
      }
    }
    const id = (await provider.request({ method: "eth_chainId" }).catch(() => null)) as string | null;
    if (id) setChainId(Number(id));
  }, [provider]);

  const connect = useCallback(async () => {
    if (!provider) return;
    setConnecting(true);
    setError(null);
    try {
      const accs = (await provider.request({ method: "eth_requestAccounts" })) as string[];
      setAccount(accs[0] ? getAddress(accs[0]) : null);
      const id = Number(await provider.request({ method: "eth_chainId" }));
      setChainId(id);
      if (id !== chain.id) await switchChain(); // prompt to switch straight away
    } catch (e) {
      setError(errorText(e));
    } finally {
      setConnecting(false);
    }
  }, [provider, switchChain]);

  const walletClient = useMemo(
    () => (provider && account ? createWalletClient({ account, chain, transport: custom(provider) }) : null),
    [provider, account],
  );

  const value: WalletState = {
    hasProvider: !!provider,
    account,
    chainId,
    onRightChain: chainId === chain.id,
    connecting,
    error,
    walletClient,
    connect,
    switchChain,
  };
  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet(): WalletState {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used inside <WalletProvider>");
  return ctx;
}
