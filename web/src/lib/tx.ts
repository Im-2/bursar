// One write = simulate (decode custom errors before anything is signed) -> sign in the wallet -> wait for
// the receipt. Each call site gets its own status so the UI can show pending/confirmed per action.
import { useCallback, useState } from "react";
import { BaseError, ContractFunctionRevertedError, UserRejectedRequestError, type Abi, type Address, type Hex, type TransactionReceipt } from "viem";
import { client } from "./chain";
import { useWallet } from "./wallet";

export type TxStatus = "idle" | "simulating" | "signing" | "pending" | "confirmed" | "failed";
export type TxState = {
  status: TxStatus;
  label?: string;
  hash?: Hex;
  errorName?: string; // decoded custom error, e.g. "ExceedsPerTxCap"
  error?: string; // human message
};

export type ContractCall = {
  address: Address;
  abi: Abi | readonly unknown[];
  functionName: string;
  args?: readonly unknown[];
};

/** Decodes a viem error into a custom-error name (when the contract reverted) and a readable message. */
export function decodeError(e: unknown): { errorName?: string; error: string } {
  if (e instanceof BaseError) {
    if (e.walk((x) => x instanceof UserRejectedRequestError)) return { error: "Rejected in your wallet." };
    const revert = e.walk((x) => x instanceof ContractFunctionRevertedError);
    if (revert instanceof ContractFunctionRevertedError) {
      const name = revert.data?.errorName ?? revert.reason ?? "unknown revert";
      const args = revert.data?.args?.length ? `(${revert.data.args.map(String).join(", ")})` : "()";
      return { errorName: name, error: `The vault would revert with ${name}${args}. Nothing was sent.` };
    }
    return { error: e.shortMessage };
  }
  if ((e as { code?: number })?.code === 4001) return { error: "Rejected in your wallet." };
  return { error: e instanceof Error ? e.message : String(e) };
}

/** Simulates a call as `account` without signing. Returns the decoded error, or null if it would succeed. */
export async function simulateOnly(account: Address, call: ContractCall): Promise<{ errorName?: string; error: string } | null> {
  try {
    await client.simulateContract({ ...call, account } as never);
    return null;
  } catch (e) {
    return decodeError(e);
  }
}

export function useTx(onConfirmed?: (receipt: TransactionReceipt) => void) {
  const { walletClient, account, onRightChain } = useWallet();
  const [state, setState] = useState<TxState>({ status: "idle" });

  const run = useCallback(
    async (label: string, call: ContractCall): Promise<TransactionReceipt | null> => {
      if (!walletClient || !account) {
        setState({ status: "failed", label, error: "Connect your wallet first." });
        return null;
      }
      if (!onRightChain) {
        setState({ status: "failed", label, error: "Switch your wallet to Arbitrum Sepolia first." });
        return null;
      }
      setState({ status: "simulating", label });
      try {
        const { request } = await client.simulateContract({ ...call, account } as never);
        setState({ status: "signing", label });
        const hash = await walletClient.writeContract(request as never);
        setState({ status: "pending", label, hash });
        const receipt = await client.waitForTransactionReceipt({ hash });
        if (receipt.status !== "success") {
          setState({ status: "failed", label, hash, error: "Transaction reverted on-chain." });
          return null;
        }
        setState({ status: "confirmed", label, hash });
        onConfirmed?.(receipt);
        return receipt;
      } catch (e) {
        setState((s) => ({ status: "failed", label, hash: s.hash, ...decodeError(e) }));
        return null;
      }
    },
    [walletClient, account, onRightChain, onConfirmed],
  );

  const reset = useCallback(() => setState({ status: "idle" }), []);
  const busy = state.status === "simulating" || state.status === "signing" || state.status === "pending";
  return { state, run, reset, busy };
}
