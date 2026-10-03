// Read helpers over the live vault, shared by the agent, owner and status scripts.
import { BaseError, ContractFunctionRevertedError, type Address } from "viem";
import { vaultAbi, tokenAbi } from "./abi.js";
import { deployment, publicClient } from "./config.js";

const vault = { address: deployment.vault, abi: vaultAbi } as const;

export const RequestStatus = ["None", "Pending", "Executed", "Rejected"] as const;
export const EscrowStatus = ["None", "Locked", "Released", "Refunded"] as const;

export async function balanceOf(who: Address): Promise<bigint> {
  return publicClient.readContract({ address: deployment.token, abi: tokenAbi, functionName: "balanceOf", args: [who] });
}

/** Everything the story shows before and after each step. */
export async function snapshot() {
  const [policy, task, taskRemaining, allowance, spentToday, freeBalance, reserved, paused, vaultBal, recipientBal] =
    await Promise.all([
      publicClient.readContract({ ...vault, functionName: "getPolicy", args: [deployment.agent] }),
      publicClient.readContract({ ...vault, functionName: "getTask", args: [deployment.taskId] }),
      publicClient.readContract({ ...vault, functionName: "taskRemaining", args: [deployment.taskId] }),
      publicClient.readContract({ ...vault, functionName: "remainingDailyAllowance", args: [deployment.agent] }),
      publicClient.readContract({ ...vault, functionName: "spentToday", args: [deployment.agent] }),
      publicClient.readContract({ ...vault, functionName: "freeBalance" }),
      publicClient.readContract({ ...vault, functionName: "totalReserved" }),
      publicClient.readContract({ ...vault, functionName: "paused" }),
      balanceOf(deployment.vault),
      balanceOf(deployment.recipient),
    ]);
  return { policy, task, taskRemaining, allowance, spentToday, freeBalance, reserved, paused, vaultBal, recipientBal };
}
export type Snapshot = Awaited<ReturnType<typeof snapshot>>;

export async function allRequests() {
  const count = await publicClient.readContract({ ...vault, functionName: "requestCount" });
  if (count === 0n) return [];
  const list = await publicClient.readContract({ ...vault, functionName: "getRequests", args: [1n, count] });
  return list.map((r, i) => ({ id: BigInt(i + 1), ...r }));
}

export async function allEscrows() {
  const count = await publicClient.readContract({ ...vault, functionName: "escrowCount" });
  if (count === 0n) return [];
  const list = await publicClient.readContract({ ...vault, functionName: "getEscrows", args: [1n, count] });
  return list.map((e, i) => ({ id: BigInt(i + 1), ...e }));
}

/** Custom error name from a failed simulation, e.g. "ExceedsPerTxCap", or null if it was not a revert. */
export function revertName(err: unknown): string | null {
  if (!(err instanceof BaseError)) return null;
  const revert = err.walk((e) => e instanceof ContractFunctionRevertedError);
  if (revert instanceof ContractFunctionRevertedError) {
    return revert.data?.errorName ?? revert.reason ?? "unknown revert";
  }
  return null;
}
