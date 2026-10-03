// Shared setup: loads the gitignored repo-root .env, the deployment file and a read-only client.
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createPublicClient, getAddress, http, type Address, type Hex } from "viem";
import { arbitrumSepolia } from "viem/chains";
import { tokenAbi } from "./abi.js";

const repoRoot = new URL("../../", import.meta.url);

// Node's built-in .env loader. Existing environment variables win over the file.
const envPath = fileURLToPath(new URL(".env", repoRoot));
if (existsSync(envPath)) process.loadEnvFile(envPath);

const dep = JSON.parse(readFileSync(new URL("deployments/arbitrum-sepolia.json", repoRoot), "utf8"));

export const deployment = {
  chainId: dep.chainId as number,
  vault: getAddress(dep.contracts.BursarVault.address),
  token: getAddress(dep.contracts.MockUSDG.address),
  owner: getAddress(dep.contracts.BursarVault.owner),
  agent: getAddress(dep.demo.agent.address),
  recipient: getAddress(dep.demo.recipient.address),
  taskId: dep.demo.task.taskId as Hex,
  taskLabel: dep.demo.task.label as string,
};

export const rpcUrl = process.env.ARBITRUM_SEPOLIA_RPC_URL || "https://sepolia-rollup.arbitrum.io/rpc";
export const chain = arbitrumSepolia;
export const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });

export type TokenInfo = { symbol: string; decimals: number };

/** Confirms the RPC is the chain the deployment file describes, and reads token metadata. */
export async function preflight(): Promise<TokenInfo> {
  const chainId = await publicClient.getChainId();
  if (chainId !== deployment.chainId) {
    throw new Error(`RPC is on chain ${chainId}, deployment file is for chain ${deployment.chainId}`);
  }
  const [symbol, decimals] = await Promise.all([
    publicClient.readContract({ address: deployment.token, abi: tokenAbi, functionName: "symbol" }),
    publicClient.readContract({ address: deployment.token, abi: tokenAbi, functionName: "decimals" }),
  ]);
  return { symbol, decimals };
}

export function shortAddr(a: Address): string {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}
