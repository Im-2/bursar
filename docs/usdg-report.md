# USDG on testnets: what was found and verified

Checked on 2026-10-03. Bursar's live deployment still uses **MockUSDG** (`0xF7a631d39aFE37290A500Edcae7C64aA19Ed8524`), and nothing in this repo claims a real USDG payment.

## Official addresses

Source: the Paxos docs page "USDG on Test Networks" (https://docs.paxos.com/guides/stablecoin/usdg/testnet).

| Network | USDG token | Supply control |
|---|---|---|
| Arbitrum Sepolia (421614) | `0xFFC95faa3d63Cde504a05B567C600B78C0b41892` | `0xDDF7d873F5738c2A191624b1ba1Aba7042621E43` |
| Robinhood Chain testnet (46630) | `0x7E955252E15c84f5768B83c41a71F9eba181802F` | `0x4549bb98c667aAb626627C118102c28065E8f54C` |

The same page lists other testnets (Ethereum Sepolia, Ink Sepolia, Mantle Sepolia, X-Layer testnet, Solana devnet). I didn't check those.

## Verified on-chain

| Network | Code at address | `name()` | `symbol()` | `decimals()` | Notes |
|---|---|---|---|---|---|
| Arbitrum Sepolia | yes (proxy) | Global Dollar | USDG | 6 | EIP-1967 implementation `0x0643bc7146ab7a2dd4ea10d506ba95e1b933b236`; totalSupply 2,111,011.0001 |
| Robinhood Chain testnet (RPC `https://rpc.testnet.chain.robinhood.com/rpc`) | yes (proxy) | Global Dollar | USDG | 6 | |

Both match Bursar's assumptions: a standard ERC-20 with 6 decimals. Our wallets (deployer, demo agent, throwaway test wallet) hold **0 USDG** on Arbitrum Sepolia.

## Getting test USDG: not done

- The Paxos docs link to a faucet at https://faucet.paxos.com/.
- From this environment, the in-app browser was denied navigation to it, and a direct HTTP fetch returned **403 Forbidden**. I didn't try to work around either, so I couldn't see its requirements (login, CAPTCHA, etc.).
- Without test USDG, no vault was created with USDG and **no USDG payment was tested**. For the same reason, USDG is not added as a selectable token in the app.

## How to try it yourself

If you get test USDG from the faucet:

1. Deploy a vault for it with the existing v2 factory: `BursarFactory.createVault(0xFFC95faa3d63Cde504a05B567C600B78C0b41892)`, or run `script/Seed.s.sol` with `TOKEN_ADDRESS` set to that address and `SEED_MINT=false`. Real USDG has no public mint, so the deployer must already hold the deposit.
2. Everything else (policies, tasks, `pay`, `PaymentBlocked`, escrow, the dashboard via `?vault=`) is token-agnostic.

What remains untested with real USDG:
- **Fee-on-transfer:** the vault assumes transfers move exactly the amount. USDG is a standard ERC-20, but this hasn't been exercised with it.
- **Freezing:** USDG may support freezing addresses. Bursar's blocklisted-recipient behavior is covered by tests with a mock blocklisting token (see the README), not with USDG itself.
