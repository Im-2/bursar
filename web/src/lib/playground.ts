// Playground state: the visitor's own vaults (from the factory), the remembered one, their mock-token
// balance/allowance, and stable demo counterparties. Everything is read from the chain except the
// remembered vault address and the randomly generated demo addresses (localStorage, best effort).
import { useCallback, useEffect, useState } from "react";
import { getAddress, toHex, type Address } from "viem";
import { factoryAbi, tokenAbi } from "../abi";
import { client, DEPLOYMENT, parseAddress, POLL_MS } from "./chain";

// ---------------------------------------------------------------- localStorage (never throws)

function readLS(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeLS(key: string, value: string | null) {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    /* storage unavailable: the playground still works, it just won't remember */
  }
}

const vaultKey = (account: Address) => `bursar.playground.vault.${account.toLowerCase()}`;
const addrsKey = (vault: Address) => `bursar.playground.addrs.${vault.toLowerCase()}`;

// ---------------------------------------------------------------- my vaults

/** Vaults this account created through the factory (on-chain), plus the one it last used (localStorage). */
export function useMyVaults(account: Address | null) {
  const [vaults, setVaults] = useState<Address[] | null>(null);
  const [selected, setSelectedState] = useState<Address | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!account) {
      setVaults(null);
      setSelectedState(null);
      return;
    }
    try {
      const list = (await client.readContract({ address: DEPLOYMENT.factory, abi: factoryAbi, functionName: "vaultsOf", args: [account] })) as readonly Address[];
      const mine = list.map((v) => getAddress(v)).filter((v) => v !== DEPLOYMENT.vault); // never the demo vault
      setVaults(mine);
      const remembered = parseAddress(readLS(vaultKey(account)));
      setSelectedState((cur) => {
        if (cur && mine.includes(cur)) return cur;
        if (remembered && mine.includes(remembered)) return remembered;
        return null; // let the visitor choose: create new or resume
      });
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [account]);

  useEffect(() => {
    load();
  }, [load]);

  const select = useCallback(
    (v: Address | null) => {
      setSelectedState(v);
      if (account) writeLS(vaultKey(account), v);
    },
    [account],
  );

  return { vaults, selected, select, reload: load, error };
}

// ---------------------------------------------------------------- my wallet's mock token

export function useWalletToken(account: Address | null, vault: Address | null) {
  const [state, setState] = useState<{ balance: bigint; allowance: bigint } | null>(null);
  const read = useCallback(async () => {
    if (!account) return setState(null);
    try {
      const [balance, allowance] = await Promise.all([
        client.readContract({ address: DEPLOYMENT.token, abi: tokenAbi, functionName: "balanceOf", args: [account] }),
        vault ? client.readContract({ address: DEPLOYMENT.token, abi: tokenAbi, functionName: "allowance", args: [account, vault] }) : Promise.resolve(0n),
      ]);
      setState({ balance, allowance });
    } catch {
      /* keep last value; the vault panels surface RPC errors */
    }
  }, [account, vault]);
  useEffect(() => {
    read();
    const t = setInterval(read, POLL_MS);
    return () => clearInterval(t);
  }, [read]);
  return { ...state, refresh: read };
}

// ---------------------------------------------------------------- demo counterparties

export type DemoAddresses = { vendor: Address; subAgent: Address; human: Address; stranger: Address };

/** A random, valid address with no known key (just 20 random bytes). */
export function randomAddress(): Address {
  const bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);
  return getAddress(toHex(bytes));
}

/** Stable per-vault demo addresses so scenarios keep paying the same parties across visits. */
export function useDemoAddresses(vault: Address | null): [DemoAddresses | null, (patch: Partial<DemoAddresses>) => void] {
  const [addrs, setAddrs] = useState<DemoAddresses | null>(null);
  useEffect(() => {
    if (!vault) return setAddrs(null);
    let stored: Partial<DemoAddresses> = {};
    try {
      stored = JSON.parse(readLS(addrsKey(vault)) ?? "{}");
    } catch {
      stored = {};
    }
    const next: DemoAddresses = {
      vendor: parseAddress(stored.vendor) ?? randomAddress(),
      subAgent: parseAddress(stored.subAgent) ?? randomAddress(),
      human: parseAddress(stored.human) ?? randomAddress(),
      stranger: parseAddress(stored.stranger) ?? randomAddress(),
    };
    writeLS(addrsKey(vault), JSON.stringify(next));
    setAddrs(next);
  }, [vault]);
  const update = useCallback(
    (patch: Partial<DemoAddresses>) => {
      setAddrs((cur) => {
        if (!cur || !vault) return cur;
        const next = { ...cur, ...patch };
        writeLS(addrsKey(vault), JSON.stringify(next));
        return next;
      });
    },
    [vault],
  );
  return [addrs, update];
}
