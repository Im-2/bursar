// Network + deployment config. Read-only: there is no wallet, signer or key anywhere in this app.
import { createPublicClient, fallback, getAddress, http, type Address } from "viem";
import { arbitrumSepolia } from "viem/chains";
import deployment from "../../../deployments/arbitrum-sepolia.json";

export const RPC_URL: string = import.meta.env.VITE_RPC_URL || "https://sepolia-rollup.arbitrum.io/rpc";
// Second public endpoint, used only when the primary fails (the official endpoint occasionally returns a
// malformed CORS header to browsers). Set VITE_RPC_FALLBACK_URL to "" to disable.
export const RPC_FALLBACK_URL: string =
  import.meta.env.VITE_RPC_FALLBACK_URL ?? "https://arbitrum-sepolia-rpc.publicnode.com";
export const POLL_MS: number = Number(import.meta.env.VITE_POLL_MS) || 6000;
export const EXPLORER = "https://sepolia.arbiscan.io";

export const chain = arbitrumSepolia;

if (deployment.chainId !== chain.id) {
  throw new Error(`deployments file is for chain ${deployment.chainId}, app is built for ${chain.id}`);
}

export const DEPLOYMENT = {
  chainId: deployment.chainId,
  network: deployment.network,
  vault: getAddress(deployment.contracts.BursarVault.address),
  vaultDeployBlock: BigInt(deployment.contracts.BursarVault.block),
  token: getAddress(deployment.contracts.MockUSDG.address),
  factory: getAddress(deployment.contracts.BursarFactory.address),
  demoAgent: getAddress(deployment.demo.agent.address),
};

// batch.multicall folds every readContract issued in the same tick into one multicall3 request.
export const client = createPublicClient({
  chain,
  transport: RPC_FALLBACK_URL ? fallback([http(RPC_URL), http(RPC_FALLBACK_URL)]) : http(RPC_URL),
  batch: { multicall: true },
});

export const addressUrl = (a: Address) => `${EXPLORER}/address/${a}`;
export const txUrl = (h: string) => `${EXPLORER}/tx/${h}`;
