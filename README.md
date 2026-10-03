# Bursar

**Give your AI agent a budget, not your wallet.** Bursar is a treasury and policy layer for AI agents. Agents spend stablecoins from a vault, but only within rules enforced by smart contracts.

> **Status:** testnet only (Arbitrum Sepolia, chain id 421614), **not audited**, and the live vault uses a mock token (**mUSDG**). Don't use it with real funds.

**Live site:** [trybursar.vercel.app](https://trybursar.vercel.app/)
- [Landing page](https://trybursar.vercel.app/)
- [Live dashboard](https://trybursar.vercel.app/dashboard): the demo vault, read straight from the chain
- [Agent playground](https://trybursar.vercel.app/try): create your own vault and try the policy with your wallet

**Code:** [github.com/Im-2/bursar](https://github.com/Im-2/bursar). All contracts are verified on Arbiscan.

![Bursar landing page](docs/screenshots/landing-hero-desktop.png)

---

## The problem

AI agents increasingly need to spend money: paying for APIs and data, buying services, paying other agents. Today there are two bad options:

- **Give the agent an open wallet or key.** One bug, one prompt injection or one leaked key can drain everything the key controls.
- **Approve every payment by hand.** It's safe, but it removes the autonomy that makes an agent useful.

Neither gives you a clean, per-task audit trail of what an agent spent, on what and why.

## The solution

Bursar sits between the money and the agents:

1. **The owner funds a vault** with a stablecoin and stays in control of it. Bursar is built for USDG (6 decimals); the live demo uses a mock token.
2. **Each agent gets its own key and a policy:** a per-transaction cap, a daily cap, and an approval threshold.
3. **Spending is tied to tasks.** The owner opens a task with a budget and an expiry. That budget is reserved, and the agent can only spend against it.
4. **Recipients are allowlisted,** per agent or vault-wide.
5. **Anything unusual waits for a human.** A payment above the threshold, or to an address that isn't allowlisted, goes into an **approval queue** instead of executing.
6. **Anything over a limit is blocked and logged.** A payment over the per-transaction cap, daily cap or task budget is refused and recorded on-chain as a `PaymentBlocked` event.
7. **Escrow** lets an agent lock funds for a payee. The owner (or a designated approver) releases them; after a deadline they can be refunded to the vault.
8. **Instant kill switches:** the owner can revoke a single agent or pause the whole vault.
9. **Audit trail:** every state-changing action emits an event with the agent, task, recipient, amount and a `bytes32` reason code.

The rules live in the contracts. An agent with a compromised key can do no more than its policy, its task budget and its allowlist permit.

```mermaid
flowchart LR
    Owner([Owner<br/>human / multisig])
    Agent([AI agent<br/>own key])
    Recipient([Recipient])

    subgraph Vault[BursarVault]
        Policy[Policy check<br/>per-tx cap · daily cap<br/>threshold · allowlist<br/>task budget]
        Queue[(Approval queue)]
        Escrow[(Escrow)]
    end

    Owner -- "deposit · set policy · open task<br/>revoke · pause" --> Vault
    Agent -- "pay(taskId, recipient, amount, reason)" --> Policy
    Policy -- "within policy" --> Recipient
    Policy -- "above threshold or<br/>not allowlisted" --> Queue
    Policy -. "over cap / budget:<br/>blocked + PaymentBlocked logged" .-> Agent
    Owner -- "approve / reject" --> Queue
    Queue -- "approved" --> Recipient
    Agent -- "createEscrow" --> Escrow
    Owner -- "release" --> Escrow
    Escrow -- "released" --> Recipient
```

---

## Deployed contracts (Arbitrum Sepolia, v2)

From [`deployments/arbitrum-sepolia.json`](deployments/arbitrum-sepolia.json). The earlier v1 deployment is archived in [`deployments/arbitrum-sepolia.v1.json`](deployments/arbitrum-sepolia.v1.json).

| Contract / role | Address | Verified |
|---|---|---|
| BursarFactory | [`0x8Ab9F56B8dE7dcB8F6FFAB2F02AF4E1A1cEcb7C2`](https://sepolia.arbiscan.io/address/0x8Ab9F56B8dE7dcB8F6FFAB2F02AF4E1A1cEcb7C2) | ✅ |
| BursarVault (demo, created by the factory) | [`0x822Cb3724d64870F6659ceca26534de8f5BD3840`](https://sepolia.arbiscan.io/address/0x822Cb3724d64870F6659ceca26534de8f5BD3840) | ✅ |
| MockUSDG (mUSDG, 6 decimals, testnet mock) | [`0xF7a631d39aFE37290A500Edcae7C64aA19Ed8524`](https://sepolia.arbiscan.io/address/0xF7a631d39aFE37290A500Edcae7C64aA19Ed8524) | ✅ |
| Vault owner / deployer | [`0x4526144B69a6380818B8b118E4F383e0523E1B28`](https://sepolia.arbiscan.io/address/0x4526144B69a6380818B8b118E4F383e0523E1B28) | n/a (wallet) |
| Demo agent | [`0x2ADbae68aA757811b3c4f29CE55873Fe5A800E07`](https://sepolia.arbiscan.io/address/0x2ADbae68aA757811b3c4f29CE55873Fe5A800E07) | n/a (wallet) |
| Demo recipient (allowlisted for the agent) | [`0xE5843118b8E82Fa58fe2d022128a55527C3a5f1B`](https://sepolia.arbiscan.io/address/0xE5843118b8E82Fa58fe2d022128a55527C3a5f1B) | n/a (wallet) |

The demo agent's policy: per-tx cap **100**, daily cap **500**, approval threshold **50** (mUSDG), role `DEMO`. Task `demo-task-1` has a budget of **1,000** mUSDG and expires 2026-10-10 11:30 UTC.

---

## The AI agent run: Claude Code over MCP

An AI agent spent from the live demo vault through the Bursar MCP server ([`agent-mcp/`](agent-mcp/README.md)). **The run was driven by Claude Code on a Claude subscription, with no paid API and no API key.** Claude Code was given only the four `bursar` tools, with its shell, file and web tools switched off. It never saw the private key; the MCP server holds it.

The task (from [`docs/ai-agent-run-plan.md`](docs/ai-agent-run-plan.md)) asked it to:
1. check its policy and list the vendors
2. buy a data feed
3. hire a sub-agent through escrow
4. try an over-limit purchase without working around a block
5. pay a human bounty

The full transcript, with every tool call and result, is in [`docs/ai-agent-run.txt`](docs/ai-agent-run.txt).

| Agent action | Transaction | What the vault did |
|---|---|---|
| Buy a market-prices feed, 20 mUSDG (`DATA_MARKET_PRICES`) | [`0x4c06…4d8c`](https://sepolia.arbiscan.io/tx/0x4c06b19a58c2dd957c06068a02f358a064f6bec502a18fcdfe7c79185e1d4d8c) | **Paid** (`PaymentExecuted`) |
| Hire a research sub-agent, 30 mUSDG escrow (`SUBAGENT_RESEARCH`) | [`0x4dd5…1c61`](https://sepolia.arbiscan.io/tx/0x4dd50e1bece57210aa5cca19734963e131e2a33012845e515a75ffa125651c61) | **Escrow #2 locked** (`EscrowCreated`) |
| Premium dataset, 150 mUSDG (`DATA_PREMIUM_DATASET`) | [`0x1d28…987b`](https://sepolia.arbiscan.io/tx/0x1d286b573a9f0c5ada4c0d4378bdfbaf4a92f42cfbccd50142b6b25f6b9e987b) | **Blocked** (`PaymentBlocked`, per-tx cap). No funds moved, and the agent did not retry. |
| Bug-report bounty to a human, 60 mUSDG (`BOUNTY_BUG_REPORT`) | [`0xae7b…d6be`](https://sepolia.arbiscan.io/tx/0xae7be12b1b138175ebde9e9e0e5f33da1b09ddd6d29e4220f1b541c0643cd6be) | **Queued** as request #3 (recipient not allowlisted). No funds moved. |

All four were checked on-chain after the run: each succeeded, was sent by the agent to the vault, and emitted exactly the event above. To run it yourself, see [Reproduce the agent run](#reproduce-the-agent-run).

### Scripted demo run

Before the MCP server existed, the TypeScript scripts in [`agent/`](agent/README.md) ran the same story, plus the owner's side. The output is in [`docs/demo-run.txt`](docs/demo-run.txt):

| Step | Transaction | What it proves |
|---|---|---|
| Direct payment, 25 mUSDG | [`0x1814…133b`](https://sepolia.arbiscan.io/tx/0x1814efae9fa8b347fe9a5b66ef8cbc29897b8e4879e0ebf4017ef5f86982133b) | The agent pays an allowlisted recipient on its own when the amount is within policy |
| Over-cap attempt, 150 mUSDG | [`0xcc2e…ade3`](https://sepolia.arbiscan.io/tx/0xcc2e8f1f4d32e45c1c9f94c6e14255ca29bb554fd116d3bb3e5f5cdd4921ade3) | A **successful** transaction that emits `PaymentBlocked` (cause `PerTxCap`). Arbiscan shows Status: Success with the event in its logs. Nothing moved, but the attempt is in the audit trail. |
| Above-threshold payment, 75 mUSDG | [`0x0989…24e6`](https://sepolia.arbiscan.io/tx/0x0989779e0fd47aaf44ddf42e951ea7c8afdaaa71a06167b273b3ab143a0624e6) | Lands in the approval queue as request #1; no funds move |
| Escrow created, 40 mUSDG | [`0xf063…a888`](https://sepolia.arbiscan.io/tx/0xf06339be99ce43ee5e7775d8883d79ae6dc5fa3271c739f2779bbcde62b5a888) | Funds are locked from the task budget for the payee |
| Request #1 approved (owner) | [`0xc591…3341`](https://sepolia.arbiscan.io/tx/0xc591786009436b65dfee91ea3a50edf7efab6f843e8bfe7c64019d1f263a3341) | The owner's sign-off executes the queued payment; it doesn't count toward the agent's daily cap |
| Escrow #1 released (owner) | [`0x7996…3c2a`](https://sepolia.arbiscan.io/tx/0x7996fc4c5bc3f0478033f0a20702f75c0484b2dbd08ed2c3dd853dcd20543c2a) | The owner releases the escrow to the payee |

---

## The web app

A keyless web app in [`web/`](web/README.md) (Vite, React, viem, wagmi), deployed at [trybursar.vercel.app](https://trybursar.vercel.app/). It reads the chain directly and holds no keys; every write is signed by the visitor's own wallet.

- **Landing page (`/`):** what Bursar is, how it works, its features, an FAQ, and links into the app.
- **Dashboard (`/dashboard`):** the vault's balance, agents, tasks, approval queue and escrows. Its activity feed includes blocked attempts and config changes, with filters, plain-language labels from reason-code prefixes (`DATA_`/`API_` "Bought data/service", `SUBAGENT_` "Hired a sub-agent", `HUMAN_`/`BOUNTY_` "Paid a human") and a 7-day spend chart.
- **Owner console:** the vault owner can approve or reject requests, release escrows, edit policies and pause the vault.
- **Playground (`/try`):** create your own vault with the factory and run the paid, queued and blocked scenarios as real transactions.

**What was tested:** browser tests in [`web/scripts/e2e/`](web/scripts/) drive the app in headless Chrome. They use a test wallet (EIP-6963) that signs with a throwaway key and send real Arbitrum Sepolia transactions. They cover:
- the owner console and the playground scenarios
- the wallet modal (connect, reject, switch network, disconnect)
- the landing page at 1440, 1024, 768 and 390 px: no horizontal scroll, keyboard navigation and focus rings, no console errors
- the logo, favicon and link-preview tags

The same landing test also passed against the live Vercel site. WalletConnect and Coinbase Wallet are wired in, but they haven't been tested with a real phone wallet.

| Landing page (phone) | Dashboard | Playground: a blocked payment |
|---|---|---|
| ![Landing on a phone](docs/screenshots/landing-hero-mobile.png) | ![Dashboard](docs/screenshots/dashboard-desktop.png) | ![Blocked payment](docs/screenshots/playground-blocked.png) |

More screenshots are in [`docs/screenshots/`](docs/screenshots/).

---

## Security and assumptions

### Read this first

- **Not audited.** Bursar has extensive tests (below) but no professional security audit.
- **Testnet only.** Everything is deployed on Arbitrum Sepolia. The deploy scripts refuse to deploy or mint the mock token on Arbitrum One.
- **Mock token.** The live vault holds **MockUSDG (mUSDG)**, a 6-decimal test token with a public `mint`. It has no value.
- **USDG is supported by configuration, not tested.** The token is a constructor parameter of each vault, so a vault can be created for USDG. The official Paxos USDG contract on Arbitrum Sepolia was checked on-chain (Global Dollar, USDG, 6 decimals). But we couldn't get test USDG (the faucet couldn't be reached), so **no payment with real USDG has been tested**. Details are in [`docs/usdg-report.md`](docs/usdg-report.md).

### What the contracts enforce

Each agent has `Policy { perTxCap, dailyCap, approvalThreshold, active, role }`, with `0 < perTxCap <= dailyCap` and `approvalThreshold <= perTxCap`. `approvalThreshold == 0` means every payment needs approval.

An agent's `pay(taskId, recipient, amount, reason)` goes through these checks in order:

1. The vault is not paused and the agent is active.
2. The task is open, unexpired and belongs to the agent, otherwise it reverts.
3. Over the per-tx cap or the task budget: **blocked**. `pay` emits `PaymentBlocked` and returns `(false, 0)` with no state change, so the attempt stays in the audit trail (a revert would leave no record). The transaction itself succeeds.
4. If the recipient is not allowlisted, or `amount > approvalThreshold`, the payment is **queued**. It reserves nothing and doesn't count toward the daily cap.
5. Otherwise, if the daily cap allows it, the payment executes; if not, it is **blocked** (`PaymentBlocked`, cause `DailyCap`).

Return values: `(true, 0)` paid, `(false, id)` queued, `(false, 0)` blocked. `createEscrow` still reverts on limits.

Other rules:

- **Approvals** re-check that the agent is active, the task is open and unexpired, the budget covers the amount, and the vault is not paused. Approved payments don't count toward the daily cap.
- **Escrow** counts toward `perTxCap` and `dailyCap` like a direct payment, but skips the allowlist and threshold, because release itself needs the owner or approver. After the deadline anyone can refund it to the vault's free balance.
- **Tasks** are opened by the owner only. Their ids can never be reused. The owner can close a task at any time, and anyone can close it once it has expired.
- **Accounting:** `totalReserved = Σ open task budgets + Σ locked escrows`, and `freeBalance = balance − totalReserved`. Only free funds can be withdrawn or reserved for new tasks.
- **Pause** freezes `pay`, `createEscrow`, `approveRequest` and `releaseEscrow`. These still work while paused, so the owner can always exit: `deposit`, `withdraw`, `closeTask`, `refundEscrow`, `rejectRequest`, `revokeAgent` and the config setters.
- **Implementation:**
  - SafeERC20 for every transfer, and checks-effects-interactions with `nonReentrant` on every function that moves tokens.
  - Custom errors throughout.
  - No unbounded loops in state-changing functions; lists are read through paginated views.
  - Two-step ownership transfer, and `renounceOwnership` is disabled.

### Threat model (each item is covered by tests)

| Actor | Attempts that are tested and blocked |
|---|---|
| Malicious agent | Splitting payments to dodge the per-tx cap (the daily cap stops it); spending on another agent's task; spending after revoke, expiry or pause; reusing a closed task id; paying itself; using owner-only functions; flooding the queue to lock funds (queued requests reserve nothing) |
| Owner | Withdrawing reserved or escrowed funds; approving an expired request, after the task closed, or beyond the task budget; refunding an escrow before its deadline |
| Malicious token or recipient | Re-entering `pay`, `approveRequest`, `releaseEscrow` and `withdraw` mid-transfer (blocked by the reentrancy guard); a recipient the token has blocklisted |

### Documented assumptions

- **The owner should be a multisig** for real deployments. Any address, including a multisig, can own a vault today. Reservations prevent double-spending; they don't protect agents from the owner, who can close tasks early and withdraw anything not in escrow.
- **The approver must be a trusted party and never an agent key.** Agents choose escrow payees freely, including addresses they control. Set the approver to `address(0)` to make releases owner-only.
- **Fee-on-transfer and rebasing tokens are unsupported.** The vault assumes a transfer of `x` moves exactly `x`.
- **Up to 2× the daily cap around UTC midnight.** The daily cap uses fixed UTC days (`block.timestamp / 1 days`), so an agent can spend its full cap just before midnight and again just after. A rolling window would need per-payment history. If 2× is too much, set `dailyCap` to half your real 24-hour tolerance.
- **Blocklisted recipients:** if the token blocks a recipient, the transfer reverts and the whole call rolls back:
  - **`pay`:** nothing changes.
  - **`approveRequest`:** the request stays pending, and the owner can reject it.
  - **`releaseEscrow`:** the escrow stays locked, and it can be refunded after its deadline.
  - **The vault itself:** if the vault were blocklisted, no transfers out would work.

---

## Tests

From an actual run of `forge test` (Foundry 1.7.1): **203 tests, 203 passed, 0 failed**, across 9 suites.

| Suite | Tests | Covers |
|---|---|---|
| `test/BursarVault.t.sol` | 151 | Every function, every custom error, every event, including `PaymentBlocked` for each cause |
| `test/Adversarial.t.sol` | 18 + 4 + 4 | Malicious agent, owner overreach, step-by-step accounting scenario; reentrant token; blocklisting token |
| `test/BursarVault.fuzz.t.sol` | 6 | Daily cap across day boundaries, the 2×-around-midnight tradeoff, per-tx cap, task budget accounting, a blocked payment of any amount changes nothing, total paid out ≤ deposits (1,000 runs each) |
| `test/invariant/` | 5 | Handler with ghost variables (256 runs × depth 100): balance ≥ reserved; reserved = Σ tasks + Σ escrows; daily autonomous spend ≤ dailyCap; blocked payments are no-ops; paid out never exceeds deposits |
| `test/Scripts.t.sol` | 10 | Deploy and Seed scripts run end to end |
| `test/BursarFactory.t.sol` | 4 + 1 | Factory; MockUSDG |

Coverage, from `forge coverage --report summary --no-match-coverage "(test|script)/"`:

| File | Lines | Statements | Branches | Functions |
|---|---|---|---|---|
| `src/BursarVault.sol` | 100% (220/220) | 100% (278/278) | 100% (51/51) | 100% (44/44) |
| `src/BursarFactory.sol` | 100% (6/6) | 100% (4/4) | n/a (0/0) | 100% (2/2) |
| `src/mocks/MockUSDG.sol` | 100% (4/4) | 100% (2/2) | n/a (0/0) | 100% (2/2) |
| **Total** | **100% (230/230)** | **100% (284/284)** | **100% (51/51)** | **100% (48/48)** |

---

## Run it yourself

### Build and test

```bash
git clone --recurse-submodules https://github.com/Im-2/bursar.git
cd bursar
forge build
forge test
forge coverage --report summary --no-match-coverage "(test|script)/"
```

Dependencies are git submodules: OpenZeppelin Contracts v5.4.0 and forge-std. Foundry reads `.env` from the repo root automatically. Copy `.env.example` to `.env`; every variable is documented there.

### About the token

The token is never hardcoded: it's a constructor parameter of each vault, and the deploy script reads it from configuration. The testnet deployment uses MockUSDG. To point a new vault at USDG, set `DEPLOY_MOCK_TOKEN=false` and `TOKEN_ADDRESS=<USDG address>` in `.env`. That path is untested with real USDG; see [Security and assumptions](#security-and-assumptions).

### Deploy to Arbitrum Sepolia

Keys never go in `.env` or in the scripts. Sign with an encrypted Foundry keystore:

```bash
cast wallet import deployer --interactive
```

Fund the deployer with Arbitrum Sepolia ETH, set `ARBITRUM_SEPOLIA_RPC_URL` and `ARBISCAN_API_KEY` in `.env`, then:

```bash
# 1. Factory (+ MockUSDG when DEPLOY_MOCK_TOKEN=true). Drop --account/--broadcast/--verify and add --sender <addr> for a dry run.
forge script script/Deploy.s.sol --rpc-url arbitrum_sepolia --account deployer --broadcast --verify

# 2. Demo vault: set FACTORY_ADDRESS, TOKEN_ADDRESS, AGENT_ADDRESS and RECIPIENT_ADDRESS in .env first
forge script script/Seed.s.sol --rpc-url arbitrum_sepolia --account deployer --broadcast --verify
```

If `--verify` didn't cover a contract, verify it manually. The vault needs its constructor arguments:

```bash
forge verify-contract <VAULT_ADDRESS> src/BursarVault.sol:BursarVault --chain arbitrum-sepolia --watch \
  --constructor-args $(cast abi-encode "constructor(address,address)" <TOKEN_ADDRESS> <VAULT_OWNER>)
```

### Run the scripted demo

The TypeScript/viem agent, owner and status scripts are in [`agent/`](agent/README.md). See [`agent/README.md`](agent/README.md) for setting `AGENT_PRIVATE_KEY` and running each script:

```bash
cd agent
npm install
npm run status     # read-only
npm run agent      # the 5-step agent story (signs with AGENT_PRIVATE_KEY from .env)
npm run owner      # approve + release (signs with the Foundry keystore)
```

### Reproduce the agent run

The MCP server is pinned to the live demo vault and the demo agent in `deployments/arbitrum-sepolia.json`. It refuses to start with any other key, so running it against the live vault needs the demo agent's key, which the Bursar team holds. To use your own vault and agent, deploy them (above) and update the deployments file.

1. **Key:** put the agent key in the repo-root `.env` as `AGENT_PRIVATE_KEY=0x…`. The agent needs a little Arbitrum Sepolia ETH for gas; the run above used about 0.00002 ETH.
2. **Build the server:**
   ```bash
   cd agent-mcp
   npm install
   npm run build
   cd ..
   ```
3. **Check it starts** exactly as Claude Code will launch it. This lists the 4 tools and runs the two read-only ones; it sends nothing.
   ```bash
   node agent-mcp/scripts/check-server.mjs
   ```
4. **Start Claude Code:** the server is registered for this project in the repo-root [`.mcp.json`](.mcp.json) (`node agent-mcp/dist/server.js`). It has no secrets; the server reads the key from `.env` at startup. Run `claude` in the repo root, approve `bursar` when asked, and check `/mcp` shows it connected.
5. **Give it the task:** paste the task from [`docs/ai-agent-run-plan.md`](docs/ai-agent-run-plan.md). That doc also predicts what the contract should do at each step.

The recorded run used Claude Code's non-interactive mode, limited to the bursar tools. The exact command is in the header of [`docs/ai-agent-run.txt`](docs/ai-agent-run.txt). To call one tool without Claude Code, use `node agent-mcp/scripts/call-tool.mjs`; see [`agent-mcp/README.md`](agent-mcp/README.md).

### Run the web app locally

```bash
cd web
npm install
npm run dev        # http://localhost:5173
```

Optional settings are in [`web/.env.example`](web/.env.example). For Vercel, use Root Directory `web`; the build settings are in [`web/vercel.json`](web/vercel.json).

---

## Roadmap

**Not built yet.** None of these exist in the code today:

- **Agent swaps and DeFi actions:** let agents rebalance or swap inside the same policy limits.
- **ERC-4337 session keys:** agents get scoped, expiring session keys instead of long-lived keys.
- **Multisig owner by default:** a Safe-style multisig as the default vault owner, as the security assumptions recommend.
- **Real USDG testing:** run a vault and payments with the real USDG testnet token once test USDG is available.

## Repository layout

```
src/            BursarVault, BursarFactory, mocks/MockUSDG
test/           unit, adversarial, fuzz, invariant, script tests
script/         Deploy.s.sol, Seed.s.sol
agent/          TypeScript (viem) demo agent, owner and status scripts
agent-mcp/      MCP server that gives an AI agent (e.g. Claude Code) the vault's pay/escrow tools
.mcp.json       registers that server for Claude Code in this project (no secrets)
web/            landing page, dashboard, owner console and playground (React, viem, wagmi)
deployments/    arbitrum-sepolia.json (v2) and .v1.json (archived): addresses, tx hashes, verification
docs/           DESIGN.md, demo-run.txt, ai-agent-run.txt, ai-agent-run-plan.md, demo-script.md,
                usdg-report.md, screenshots/
```
