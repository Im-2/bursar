// Human labels derived from on-chain data. Reason codes are free-form bytes32 strings chosen by the agent;
// Bursar reads a small prefix convention (documented in web/README.md) to label what a payment was for.
import type { Hex } from "viem";
import { decodeBytes32 } from "./format";

export type UseCase = { label: string; kind: "data" | "subagent" | "human" | "generic" };

/** DATA_* or API_* = bought data/service, SUBAGENT_* = hired a sub-agent, HUMAN_* or BOUNTY_* = paid a human. */
export function useCaseFromReason(reason: Hex | undefined): UseCase {
  if (!reason) return { label: "Payment", kind: "generic" };
  const code = decodeBytes32(reason).toUpperCase();
  if (code.startsWith("DATA_") || code.startsWith("API_")) return { label: "Bought data/service", kind: "data" };
  if (code.startsWith("SUBAGENT_")) return { label: "Hired a sub-agent", kind: "subagent" };
  if (code.startsWith("HUMAN_") || code.startsWith("BOUNTY_")) return { label: "Paid a human", kind: "human" };
  return { label: "Payment", kind: "generic" };
}

export const BLOCK_CAUSES = ["per-tx cap", "daily cap", "task budget"] as const;
export const blockCauseLabel = (cause: number | undefined) => BLOCK_CAUSES[cause ?? -1] ?? "limit";
