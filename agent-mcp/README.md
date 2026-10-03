# Bursar agent over MCP (`agent-mcp/`)

A small [MCP](https://modelcontextprotocol.io) server (TypeScript, official SDK, stdio) that lets an AI agent spend from the live Bursar demo vault on Arbitrum Sepolia. In the run documented here, **the agent is Claude, connected to this server through MCP in Claude Code**. No Anthropic API key is used: Claude Code runs on your normal Claude login.

The point: the agent gets real spending power, and the vault contract still enforces the policy. The limits apply to any agent that holds this key, whether Claude, another model or a script.

## Tools

| Tool | What it does |
|---|---|
| `get_policy_and_budget` | Reads the agent's policy (per-tx cap, daily cap, approval threshold), what it spent today, the task budget left, whether the vault is paused, and which vendors are allowlisted |
| `list_vendors` | Lists the three **simulated** vendors: a data API, a research sub-agent and a human reviewer |
| `pay(recipient, amount, reason, taskId?)` | Pays from the vault. Returns **PAID**, **QUEUED FOR APPROVAL** (with the request id and why), **BLOCKED** (with the cause from `PaymentBlocked`), or the decoded revert name |
| `create_escrow(payee, amount, deadlineSeconds, reason, taskId?)` | Locks funds for a payee. Returns **ESCROW LOCKED** with the escrow id, or the decoded revert name (escrows revert on limits) |

Every call is **simulated first**. If it would revert, nothing is sent and the result names the custom error. Otherwise the transaction is sent, and the result is decoded from the receipt's events, always with the transaction hash and Arbiscan link. A blocked payment is a *successful* transaction that emits `PaymentBlocked`, so Arbiscan shows Status: Success with the event in its logs.

## Safety

- The key is read from `AGENT_PRIVATE_KEY` in the gitignored repo-root `.env` and removed from the process environment once loaded.
- **Startup check:** the server refuses to start unless the key's address is the demo agent in `deployments/arbitrum-sepolia.json`.
- **No tool prints or returns the key.** MCP traffic is on stdout and diagnostics on stderr; neither contains it.
- **No owner powers:** there are no tools to change policy, allowlists or tasks, or to pause. The contract would reject those calls from the agent key anyway.
- **What stays in force on-chain:** per-tx cap, daily cap, approval threshold, allowlist and task budget. The vault enforces all of them regardless of what the agent asks for.

## The vendors are simulated

The services and prices are made up. The addresses are real Arbitrum Sepolia addresses controlled by the Bursar team:

| Vendor id | Name | Address | Price | How it's paid |
|---|---|---|---|---|
| `data-api` | Data API (simulated) | `0xE5843118b8E82Fa58fe2d022128a55527C3a5f1B` (the demo recipient; allowlisted) | 20 mUSDG | `pay` |
| `sub-agent` | Research sub-agent (simulated) | `0xc6D1f61Db88a207d1Ee37cE1C6b2A7Ca0b9731Ae` (the e2e test wallet) | 60 mUSDG | `create_escrow` |
| `human-reviewer` | Human reviewer (simulated) | `0x4526144B69a6380818B8b118E4F383e0523E1B28` (the vault owner's address) | 40 mUSDG | `create_escrow` |

Reason codes use the dashboard's label prefixes (`DATA_`/`API_`, `SUBAGENT_`, `HUMAN_`/`BOUNTY_`), so the activity feed shows "Bought data/service", "Hired a sub-agent" and "Paid a human".

## Setup

```bash
cd agent-mcp
npm install
```

1. Put the demo agent's key in the repo-root `.env` as `AGENT_PRIVATE_KEY=0x…`; see [`agent/README.md`](../agent/README.md). The agent also needs a little Arbitrum Sepolia ETH for gas.
2. Connect it to Claude Code from the **repo root**. The example config [`.mcp.json`](.mcp.json) holds no key or secret:

   ```bash
   claude --mcp-config agent-mcp/.mcp.json
   ```

   Or copy its `bursar` entry into a project-level `.mcp.json`. Check it's connected with `/mcp`. The tools appear as `mcp__bursar__pay` and so on.

## Example prompts

**1. A normal purchase run**
> Use the bursar tools. Check your policy and budget, list the vendors, then buy two calls from the data API at its listed price with reason DATA_MARKET_PRICES. Report each result with its Arbiscan link.

Expected: two **PAID** results (20 mUSDG each, at or under the 50 mUSDG approval threshold).

**2. Hire a sub-agent and a human**
> Use the bursar tools. Hire the research sub-agent for its listed price with reason SUBAGENT_RESEARCH and a 1-day deadline, then put the human reviewer's bounty in escrow with reason HUMAN_REVIEW and a 1-day deadline. Tell me the escrow ids and who can release them.

Expected: two **ESCROW LOCKED** results. The owner releases them later from the dashboard (Escrows → Release) or with `npm run owner` in `agent/`.

**3. An over-limit attempt**
> Use the bursar tools. Buy a premium dataset from the data API for 150 mUSDG with reason DATA_PREMIUM_DATASET. Don't try to work around any limit; just report what the vault did.

Expected: **BLOCKED**, over the per-tx cap (100 mUSDG), logged on-chain as `PaymentBlocked`, with no funds moved.

A prompt that combines a payment, a queued request and a blocked attempt, and its full transcript from a real run, is in [`docs/ai-agent-run.txt`](../docs/ai-agent-run.txt).
