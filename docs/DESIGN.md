# Bursar — Smart Contract Design Doc (v1, approved)

Bursar is a treasury and policy layer for AI agents on Arbitrum. A human owner funds a vault with a stablecoin (USDG, 6-decimal ERC-20), defines spending policies, and authorizes AI agents (each with its own key) to spend only within those policies. Rules are enforced on-chain.

Stack: Foundry, Solidity ^0.8.24, OpenZeppelin (SafeERC20, Ownable2Step, Pausable, ReentrancyGuard). Target: Arbitrum Sepolia, then Arbitrum One. The token address is always a constructor/env parameter (never hardcoded).

---

## 1. Contracts

| Contract | Purpose |
|---|---|
| `BursarVault` | One per owner. Holds funds and enforces policies, tasks, the approval queue and escrow. `Ownable2Step`, `Pausable`, `ReentrancyGuard`. The token is `immutable` and set in the constructor. |
| `BursarFactory` | `createVault(token)` deploys with plain `new` with owner = `msg.sender`, emits `VaultCreated`, and keeps `vaultsOf[msg.sender]`. |
| `MockUSDG` | 6-decimal ERC-20 with a public `mint`. Tests and testnet only. |

**Tradeoff:** plain `new` instead of clones. Clones need an initializer, so the token couldn't be `immutable` and there's an init front-running surface; on Arbitrum the extra deploy gas is small. A single `Ownable2Step` owner fits better than `AccessControl`, because the only other role is one `approver` address.

## 2. Data structures

```solidity
struct Policy {            // 2 slots + label
    uint128 perTxCap;
    uint128 dailyCap;
    uint128 approvalThreshold;   // requiresApprovalAbove
    bool    active;
    bytes32 role;
}
struct DailySpend { uint64 day; uint192 spent; }        // per agent

struct Task {
    address agent;
    uint64  expiry;
    bool    open;
    uint128 remaining;     // reserved, unspent budget
    uint128 spent;
}                                                       // keyed by bytes32 taskId (caller-chosen)

enum ReqStatus { None, Pending, Executed, Rejected }    // "Expired" is derived from block.timestamp
struct Request { address agent; address recipient; bytes32 taskId; uint128 amount;
                 uint64 expiresAt; ReqStatus status; bytes32 reason; }   // uint256 id, auto-increment

enum EscrowStatus { None, Locked, Released, Refunded }
struct Escrow { address agent; address payee; bytes32 taskId; uint128 amount;
                uint64 deadline; EscrowStatus status; }                  // uint256 id, auto-increment
```

Vault-level state:
- `approver`: an extra address that can release escrows
- `enforceAllowlist` (bool)
- `globalAllowlist[recipient]` and `agentAllowlist[agent][recipient]`
- `requestTTL`
- `totalReserved`: sum of open tasks' `remaining` plus locked escrows

**Balance model:** `freeBalance = token.balanceOf(vault) - totalReserved`.
- `withdraw` and `openTask` can only use free balance.
- Tokens sent directly to the vault simply become free balance.
- Fee-on-transfer and rebasing tokens are out of scope (documented).

## 3. Functions

**Owner**
- Funds: `deposit(amt)` (anyone may call), `withdraw(to, amt)`, `pause()`, `unpause()`
- Agents: `setAgent(agent, Policy)` (register or update), `revokeAgent(agent)` (sets `active = false`)
- Allowlists: `setAgentRecipient(agent, r, bool)`, `setGlobalRecipient(r, bool)`, `setEnforceAllowlist(bool)`
- Tasks: `openTask(taskId, agent, budget, expiry)` moves budget from free to reserved; `closeTask(taskId)` returns the remainder to free
- Queue: `approveRequest(id)`, `rejectRequest(id)`, `setRequestTTL(s)`
- Escrow: `setApprover(a)`
- Ownership transfer inherited from `Ownable2Step`

**Agent**
- `pay(taskId, recipient, amount, reason)` returns `(executed, requestId)`. Checks, in order:
  1. Agent is active and vault is not paused.
  2. Task is open, not expired, and belongs to this agent.
  3. `amount <= perTxCap` and `amount <= task remaining`.
  4. If the recipient isn't allowed, or `amount > approvalThreshold`, the payment is queued (`PaymentQueued`).
  5. Otherwise the daily cap is checked, the payment is sent, and `PaymentExecuted` is emitted.
- `createEscrow(taskId, payee, amount, deadline, reason)` moves funds from the task's `remaining` into the escrow (both count toward `totalReserved`).

**Permissionless**
- `closeTask(taskId)` once expired. Expiry can't fire by itself, so anyone may release an expired task's budget; this only moves reserved funds back to free.
- `refundEscrow(id)` after the deadline; funds return to the vault's free balance.

**Owner or approver:** `releaseEscrow(id)` sends funds to the payee.

**Views (for the frontend)**
- `getPolicy`, `remainingDailyAllowance(agent)`, `getTask`, `taskRemaining`
- `getRequest`, `getRequests(fromId, count)` (paginated), `requestCount`
- `getEscrow`, `getEscrows(fromId, count)`, `escrowCount`
- `isRecipientAllowed(agent, r)`, `freeBalance`, `totalReserved`

**Daily cap:** window is `day = block.timestamp / 1 days`; `spent` resets lazily when the stored day is older than today. Tradeoff (documented in code): an agent can spend up to 2x its cap within minutes either side of UTC midnight. A rolling window fixes that but needs a ring buffer or per-payment history: more storage, more gas, harder to reason about.

## 4. Events

Every value-moving event carries `agent`, `taskId`, `recipient`, `amount`, and `bytes32 reason` where applicable.

- Value-moving: `Deposited`, `Withdrawn`, `TaskOpened`, `TaskClosed(taskId, agent, released)`, `PaymentExecuted`, `PaymentQueued(id, ..., cause)` (cause = allowlist or threshold), `RequestApproved`, `RequestRejected`, `EscrowCreated`, `EscrowReleased`, `EscrowRefunded`
- Configuration: `AgentSet`, `AgentRevoked`, `AgentRecipientSet`, `GlobalRecipientSet`, `AllowlistModeSet`, `ApproverSet`, `RequestTTLSet`. `Paused`, `Unpaused` and ownership events come from OpenZeppelin.

**Why `bytes32 reason` instead of `string`:** a fixed-size calldata word with no length prefix, no memory copy and no unbounded cost. It can be indexed and filtered, and decodes to a short ASCII tag such as `"API_FEE"` in the UI. Longer free text lives off-chain, referenced by hash.

## 5. Custom errors

| Area | Errors |
|---|---|
| General | `ZeroAddress`, `ZeroAmount`, `AmountTooLarge` (above uint128) |
| Funds | `InsufficientFreeBalance` |
| Agent | `NotAgent`, `AgentInactive` |
| Caps | `ExceedsPerTxCap`, `ExceedsDailyCap` |
| Tasks | `TaskExists`, `TaskNotOpen`, `TaskExpired`, `TaskNotExpired`, `TaskAgentMismatch`, `ExceedsTaskBudget`, `InvalidExpiry` |
| Queue | `RequestNotPending`, `RequestExpired` |
| Escrow | `EscrowNotLocked`, `DeadlineNotReached`, `InvalidDeadline`, `NotOwnerOrApprover` |
| Policy | `InvalidPolicy` (e.g. `perTxCap > dailyCap`) |

## 6. Threat model (each item becomes a test)

- **Malicious agent:** splitting payments to dodge the per-tx cap (stopped by daily cap); spending on another agent's task; spending after expiry or revocation; flooding the queue (no loops, agent pays gas); escrowing to a payee it controls (release needs owner/approver); reusing a closed `taskId`.
- **Owner:** withdrawing reserved or escrowed funds; approving beyond the task budget; approving an expired request; pulling escrowed funds back before the deadline (payees are guaranteed that).
- **Malicious recipient / token:** reentrancy into `pay`, `approveRequest` or `releaseEscrow`, tested with a reentrant mock ERC-20; covered by checks-effects-interactions plus `nonReentrant`.

Note: the owner can still close tasks early and withdraw that money. That is intentional: reservations prevent double-spending, they don't protect agents from the owner. Escrow is the one place a third party is protected.

**Planned tests:** unit tests for every function and revert path; fuzz tests for daily cap across day boundaries, per-tx cap, task budget accounting, and total paid out never exceeding deposits; invariant tests for `balance >= totalReserved` and no agent exceeding its daily cap within a day; coverage reported via `forge coverage`.

## 7. Open decisions (recommendations in bold)

1. **Over the daily cap:** revert or queue? **Revert.** Caps are hard limits; the queue is only for threshold and allowlist cases. `perTxCap` also always reverts, so `approvalThreshold` should be set below `perTxCap`.
2. **Owner-approved requests vs. daily cap:** **They neither count against nor are blocked by the daily cap.** The daily cap then measures autonomous agent spend, keeping the invariant clean; approved payments still respect task budget and balance. Charging the cap at queue time makes rejections and day rollovers messy.
3. **Do queued requests reserve funds?** **No.** They're checked against the task budget at approval time, so an agent can't lock funds by spamming the queue.
4. **Allowlist model:** recipient allowed if `agentAllowlist[agent][r] || globalAllowlist[r]`. `enforceAllowlist` defaults to **true**; when false, any recipient can be paid directly (threshold still applies).
5. **Who opens tasks:** **Owner only** for v1. Agent-opened tasks would let agents reserve or grief the owner's free balance.
6. **Escrow rules:** creation checks `perTxCap`, `dailyCap` and task budget, but **skips allowlist and threshold**, since release already requires owner or approver. `approver` is **one vault-wide address set by the owner**, never chosen by the agent. Refunds go to the vault's free balance, not back to the task.
7. **Pause scope:** pausing blocks `pay`, `createEscrow`, `approveRequest`, `releaseEscrow`. Still allowed while paused: `withdraw`, `deposit`, `closeTask`, `refundEscrow`, `revokeAgent` and config setters, so the owner can always exit in an emergency.
8. **Revoked agents:** their pending requests can't be approved. Their escrows and open tasks stay until the owner acts or they expire (deliberately no loop over them).
9. **Defaults:** `requestTTL = 3 days`. Task expiry must be in the future; escrow deadline must be at or before the task's expiry (alternative: allow deadlines past task expiry).

---

## 8. Approved changes (v1)

All section 7 recommendations are accepted, plus:

- **Factory:** `createVault(token)`; owner is `msg.sender`; `vaultsOf` is indexed by creator.
- **`renounceOwnership`** is overridden to always revert (`RenounceDisabled`).
- **Policy validation:** `InvalidPolicy` also covers `approvalThreshold > perTxCap`. `approvalThreshold == 0` means every payment requires approval.
- **Escrow creation** increments the agent's daily spent like an autonomous pay, and is subject to `perTxCap`, `dailyCap` and task budget.
- **`approveRequest`** requires: agent still active, task open and unexpired, amount <= task remaining, vault not paused. Approved requests do not count against the daily cap.
- **Blocklisting token test:** a mock token that reverts transfers to a blocklisted address, covering `pay`, `approveRequest` and `releaseEscrow`; behavior documented in the README.
- **Invariants:** (a) token balance >= `totalReserved`; (b) sum(open task remaining) + sum(locked escrow amounts) == `totalReserved`, via ghost variables; (c) per agent per day, autonomous pay + escrow-creation spend <= `dailyCap` (approved requests excluded).
- **View:** `getAgentTasks(agent, offset, limit)` (paginated) so an owner can find and close a revoked agent's open tasks.
- **README security assumptions:** owner should be a multisig for real deployments; fee-on-transfer and rebasing tokens unsupported; 2x-cap-across-UTC-midnight tradeoff.
