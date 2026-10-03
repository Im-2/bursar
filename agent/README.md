# Bursar demo agent

TypeScript ([viem](https://viem.sh)) scripts that act against the live Bursar vault on Arbitrum Sepolia. Addresses come from `../deployments/arbitrum-sepolia.json`, and settings come from the gitignored repo-root `.env`.

| Script | Signs with | What it does |
|---|---|---|
| `npm run status` | nothing (read-only) | Vault balances, the agent's policy, the task budget, the approval queue and escrows |
| `npm run agent` | `AGENT_PRIVATE_KEY` from `.env` | The 5-step agent story below |
| `npm run owner:dry` | nothing | Lists what the owner would approve and release, and simulates each action |
| `npm run owner` | Foundry keystore `deployer` via `cast send` | Approves the agent's pending requests and releases its locked escrows |

## Setup

Requires Node ≥ 20.12, plus Foundry's `cast` for the owner script.

On Windows PowerShell, if `npm` fails with *"running scripts is disabled on this system"*, use `npm.cmd` instead (for example `npm.cmd run agent`). It's the same npm and needs no change to the execution policy.

```bash
cd agent
npm install
```

## Setting `AGENT_PRIVATE_KEY`

The agent script signs as the demo agent `0x2ADbae68aA757811b3c4f29CE55873Fe5A800E07`, so it needs that address's private key. The key lives **only** in the repo-root `.env`, which git ignores. The script never prints it, removes it from the process environment as soon as it has read it, and refuses to run if the key's address isn't the demo agent.

1. Get the agent's private key, as a 0x-prefixed 64-character hex string:
   - If you created the agent with `cast wallet new`, it's the "Private key" that command printed.
   - If you imported it into a Foundry keystore, for example as `demo-agent`, run this in your own terminal: `cast wallet private-key --account demo-agent`
2. Open the repo-root `.env` in an editor (`notepad ..\.env` on Windows, `nano ../.env` elsewhere), and add or replace this line:
   ```
   AGENT_PRIVATE_KEY=0x<64 hex characters>
   ```
   Use an editor rather than `echo … >> .env`, which would leave the key in your shell history.
3. Check that git still ignores it: `git check-ignore -v ../.env` should print a `.gitignore` match.

Use a key that only ever holds testnet funds.

## The agent story (`npm run agent`)

The amounts are chosen relative to the seeded policy: per-tx cap 100, daily cap 500, approval threshold 50.

1. **Read** the policy, the task budget and today's remaining allowance.
2. **Direct payment** of 25 to the allowlisted recipient. This is at or below the threshold, so it executes.
3. **Over-cap payment** of 150. The script simulates it first, and the vault rejects it with `ExceedsPerTxCap()`. Nothing is signed, and the script shows the balances, task budget and agent nonce unchanged.
4. **Payment above the threshold** of 75. It goes into the approval queue as a pending request.
5. **Escrow** of 40 for the recipient. It stays locked until the owner or approver releases it, or it can be refunded after its deadline.

Every transaction prints its hash and an Arbiscan link (`https://sepolia.arbiscan.io/tx/<hash>`). Each amount is shown human-readable alongside its base-unit value (6 decimals).

One run spends 65 of the 500 daily allowance (25 + 40; the queued 75 doesn't count) and up to 140 of the task budget, so it can run several times a day.

## Owner side (`npm run owner`)

The script first simulates each approval and release as the vault owner, so anything that would revert is printed by its custom error name and skipped. It then signs each transaction with `cast send --account deployer`. Foundry prompts for the keystore password once per transaction, and the owner key never enters Node.js. Set `OWNER_ACCOUNT` to use a different keystore name, or `CAST_BIN` if `cast` isn't in `~/.foundry/bin`.

## Regenerating ABIs

After changing the contracts, run `forge build` in the repo root, then `npm run abi`.
