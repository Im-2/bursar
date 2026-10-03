# Bursar

**A treasury and policy layer for AI agents: agents spend stablecoins from a vault, but only within rules enforced by smart contracts.**

Live on **Arbitrum Sepolia (chain id 421614)**. All contracts are verified on Arbiscan.

---

## The problem

AI agents increasingly need to spend money: paying for APIs and data, buying services, paying other agents. Today there are two bad options:

- **Give the agent an open wallet or key.** One bug, one prompt injection or one leaked key can drain everything the key controls.
- **Approve every payment by hand.** It's safe, but it removes the autonomy that makes an agent useful.

Neither gives you a clean, per-task audit trail of what an agent spent, on what and why.

## The solution

Bursar sits between the money and the agents:

1. **The owner funds a vault** with a stablecoin (USDG, 6 decimals) and stays in control of it.
2. **Each agent gets its own key and a policy:** a per-transaction cap, a daily cap, and an approval threshold.
3. **Spending is tied to tasks.** The owner opens a task with a budget and an expiry. That budget is reserved, and the agent can only spend against it.
4. **Recipients are allowlisted,** per agent or vault-wide.
5. **Anything unusual waits for a human.** A payment above the threshold, or to an address that isn't allowlisted, goes into an **approval queue** instead of executing.
6. **Escrow** lets an agent lock funds for a payee. The owner (or a designated approver) releases them; after a deadline they can be refunded to the vault.
7. **Instant kill switches:** the owner can revoke a single agent or pause the whole vault.
8. **Audit trail:** every state-changing action emits an event with the agent, task, recipient, amount and a `bytes32` reason code.

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
    Policy -. "over cap / budget:<br/>revert" .-> Agent
    Owner -- "approve / reject" --> Queue
    Queue -- "approved" --> Recipient
    Agent -- "createEscrow" --> Escrow
    Owner -- "release" --> Escrow
    Escrow -- "released" --> Recipient
```

---

## Deployed contracts (Arbitrum Sepolia)

From [`deployments/arbitrum-sepolia.json`](deployments/arbitrum-sepolia.json):

| Contract / role | Address | Verified |
|---|---|---|
| BursarFactory | [`0x8e6F4173742401009462712A5B898d10aEe402Dc`](https://sepolia.arbiscan.io/address/0x8e6F4173742401009462712A5B898d10aEe402Dc) | ✅ |
| MockUSDG (6 decimals, testnet mock) | [`0xF7a631d39aFE37290A500Edcae7C64aA19Ed8524`](https://sepolia.arbiscan.io/address/0xF7a631d39aFE37290A500Edcae7C64aA19Ed8524) | ✅ |
| BursarVault (demo, created by the factory) | [`0x3bb637f613473ed4e4801220e4F7292e6b1949B6`](https://sepolia.arbiscan.io/address/0x3bb637f613473ed4e4801220e4F7292e6b1949B6) | ✅ |
| Vault owner / deployer | [`0x4526144B69a6380818B8b118E4F383e0523E1B28`](https://sepolia.arbiscan.io/address/0x4526144B69a6380818B8b118E4F383e0523E1B28) | n/a (wallet) |
| Demo agent | [`0x2ADbae68aA757811b3c4f29CE55873Fe5A800E07`](https://sepolia.arbiscan.io/address/0x2ADbae68aA757811b3c4f29CE55873Fe5A800E07) | n/a (wallet) |
| Demo recipient (allowlisted for the agent) | [`0xE5843118b8E82Fa58fe2d022128a55527C3a5f1B`](https://sepolia.arbiscan.io/address/0xE5843118b8E82Fa58fe2d022128a55527C3a5f1B) | n/a (wallet) |

The demo agent's policy: per-tx cap **100**, daily cap **500**, approval threshold **50** (mUSDG), role `DEMO`. Task `demo-task-1` has a budget of **1,000** mUSDG.

## Live demo results

These are real transactions from the run recorded in [`docs/demo-run.txt`](docs/demo-run.txt), produced by the scripts in [`agent/`](agent/README.md):

| Step | Transaction | What it proves |
|---|---|---|
| Direct payment, 25 mUSDG | [`0xde3b…2399`](https://sepolia.arbiscan.io/tx/0xde3b81e1fec2230def5b84d605f6ef28bd4fdf54c8df07674edaeea683a62399) | The agent pays an allowlisted recipient on its own when the amount is within policy |
| Over-cap payment, 150 mUSDG | none: blocked in simulation | The vault rejects it with `ExceedsPerTxCap()`. Recipient balance, vault balance, task budget and agent nonce were all unchanged. |
| Above-threshold payment, 75 mUSDG | [`0xc214…7b55`](https://sepolia.arbiscan.io/tx/0xc214da380fea07774e20ffa383bba230b4f3188a1d788b2d01dc76efe5ff7b55) | Lands in the approval queue as request #1 (cause: threshold); no funds move |
| Escrow created, 40 mUSDG | [`0x071a…70e4`](https://sepolia.arbiscan.io/tx/0x071a0195599584cd76003d2f9d7575d667921432d88f85e5feba4635ce3d70e4) | Funds are locked from the task budget for the payee |
| Request #1 approved (owner) | [`0x36fe…6b42`](https://sepolia.arbiscan.io/tx/0x36fe88ba2d83217988797e4aa88bcd3e1d210aeeafcb4f24daa1dfeb01836b42) | The owner's sign-off executes the queued payment; it doesn't count toward the agent's daily cap |
| Escrow #1 released (owner) | [`0x599c…0699`](https://sepolia.arbiscan.io/tx/0x599c52fd40bbd4f2d35e9b142c0ac97dbb6e7250ecc87ad5bc4cf7e663790699) | The owner releases the escrow to the payee |

**End state:**
- **Recipient:** received 140 mUSDG (25 + 75 + 40).
- **Vault:** 10,000 → 9,860 mUSDG.
- **Agent:** 65 of its 500 daily cap used (the approved 75 isn't counted).
- **Task:** 860 of 1,000 left.

---

## Policy model and security

### What the contracts enforce

Each agent has `Policy { perTxCap, dailyCap, approvalThreshold, active, role }`, with `0 < perTxCap <= dailyCap` and `approvalThreshold <= perTxCap`. `approvalThreshold == 0` means every payment needs approval.

An agent's `pay(taskId, recipient, amount, reason)` goes through these checks in order:

1. The vault is not paused and the agent is active.
2. `amount <= perTxCap`, otherwise it reverts.
3. The task is open, unexpired, belongs to the agent, and covers the amount, otherwise it reverts.
4. If the recipient is not allowlisted, or `amount > approvalThreshold`, the payment is **queued**. It reserves nothing and doesn't count toward the daily cap.
5. Otherwise, if the daily cap allows it, the payment executes. If not, it reverts.

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

- **The owner should be a multisig** for real deployments. Reservations prevent double-spending; they don't protect agents from the owner, who can close tasks early and withdraw anything not in escrow.
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

From an actual run of `forge test` (Foundry 1.7.1): **195 tests, 195 passed, 0 failed**, across 9 suites.

| Suite | Tests | Covers |
|---|---|---|
| `test/BursarVault.t.sol` | 145 | Every function, every custom error, every event |
| `test/Adversarial.t.sol` | 18 + 4 + 4 | Malicious agent, owner overreach, step-by-step accounting scenario; reentrant token; blocklisting token |
| `test/BursarVault.fuzz.t.sol` | 5 | Daily cap across day boundaries, the 2×-around-midnight tradeoff, per-tx cap, task budget accounting, total paid out ≤ deposits (1,000 runs each) |
| `test/invariant/` | 4 | Handler with ghost variables (256 runs × 100 calls): balance ≥ reserved; reserved = Σ tasks + Σ escrows; daily autonomous spend ≤ dailyCap; balance = deposits − outflows |
| `test/Scripts.t.sol` | 10 | Deploy and Seed scripts run end to end |
| `test/BursarFactory.t.sol` | 4 + 1 | Factory; MockUSDG |

Coverage, from `forge coverage --report summary --no-match-coverage "(test|script)/"`:

| File | Lines | Statements | Branches | Functions |
|---|---|---|---|---|
| `src/BursarVault.sol` | 100% (213/213) | 100% (269/269) | 100% (49/49) | 100% (42/42) |
| `src/BursarFactory.sol` | 100% (6/6) | 100% (4/4) | n/a (0/0) | 100% (2/2) |
| `src/mocks/MockUSDG.sol` | 100% (4/4) | 100% (2/2) | n/a (0/0) | 100% (2/2) |
| **Total** | **100% (223/223)** | **100% (275/275)** | **100% (49/49)** | **100% (46/46)** |

---

## Run it yourself

### Build and test

```bash
git clone --recurse-submodules <repo-url>
cd Bursar
forge build
forge test
forge coverage --report summary --no-match-coverage "(test|script)/"
```

Dependencies are git submodules: OpenZeppelin Contracts v5.4.0 and forge-std. Foundry reads `.env` from the repo root automatically. Copy `.env.example` to `.env`; every variable is documented there.

### About the token

**USDG is the intended stablecoin.** The testnet deployment uses **MockUSDG**, a 6-decimal ERC-20 with a public `mint`, because it's testnet. The token is never hardcoded: it's a constructor parameter of each vault, and the deploy script reads it from configuration. To use real USDG, set `DEPLOY_MOCK_TOKEN=false` and `TOKEN_ADDRESS=<USDG address>` in `.env`. Both scripts refuse to deploy or mint the mock on Arbitrum One (chain id 42161).

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

### Run the agent demo

The TypeScript/viem agent, owner and status scripts are in [`agent/`](agent/README.md). See [`agent/README.md`](agent/README.md) for setting `AGENT_PRIVATE_KEY` and running each script:

```bash
cd agent
npm install
npm run status     # read-only
npm run agent      # the 5-step agent story (signs with AGENT_PRIVATE_KEY from .env)
npm run owner      # approve + release (signs with the Foundry keystore)
```

---

## Roadmap

None of these are implemented yet:

- **Dashboard:** a frontend for owners to fund vaults, set policies, open tasks, and review the approval queue and audit trail. The contracts' paginated view functions are built for it.
- **Real USDG integration:** deploy against the real USDG address via `TOKEN_ADDRESS`, and validate against its actual token behavior.
- **ERC-4337 session keys:** agents get scoped, expiring session keys instead of long-lived EOAs.
- **Multisig ownership:** a multisig such as Safe as the default vault owner, as the security assumptions already recommend.

## Repository layout

```
src/            BursarVault, BursarFactory, mocks/MockUSDG
test/           unit, adversarial, fuzz, invariant, script tests
script/         Deploy.s.sol, Seed.s.sol
agent/          TypeScript (viem) demo agent, owner and status scripts
deployments/    arbitrum-sepolia.json (addresses, tx hashes, verification)
docs/           DESIGN.md (design doc), demo-run.txt (live demo output)
```
