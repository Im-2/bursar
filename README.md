# Bursar

A treasury and policy layer for AI agents on Arbitrum. A human owner funds a vault with a stablecoin (USDG, 6 decimals), defines spending policies, and authorizes AI agents (each with its own key) to spend only within those policies. The rules are enforced by smart contracts, not trust.


## Architecture

| Contract | Role |
|---|---|
| `src/BursarVault.sol` | One vault per owner: funds, agent policies, recipient allowlists, task budgets, approval queue, escrow. `Ownable2Step`, `Pausable`, `ReentrancyGuard`. |
| `src/BursarFactory.sol` | `createVault(token)` deploys a vault owned by the caller and indexes it under `vaultsOf(caller)`. |
| `src/mocks/MockUSDG.sol` | 6-decimal ERC-20 with public `mint`, for tests and testnet only. |
| `script/Deploy.s.sol` | Deploys the factory, plus a MockUSDG when `DEPLOY_MOCK_TOKEN=true` (refused on Arbitrum One). |
| `script/Seed.s.sol` | Demo seeding: vault, funds, one agent + policy, one allowlisted recipient, one task. |

The token address is a constructor parameter, never hardcoded.

### Balance model

```
totalReserved = Σ open task.remaining + Σ locked escrow.amount
freeBalance   = token.balanceOf(vault) − totalReserved
```

Only free funds can be withdrawn or reserved for new tasks. Paying, approving and releasing reduce `totalReserved` by exactly what leaves the vault, so reserved funds can never be withdrawn or double-spent.

## Policy model

Each agent has a `Policy { perTxCap, dailyCap, approvalThreshold, active, role }`, with `0 < perTxCap <= dailyCap` and `approvalThreshold <= perTxCap`.

An agent's `pay(taskId, recipient, amount, reason)` goes through these checks in order:

1. The vault is not paused and the agent is active.
2. `amount <= perTxCap`, otherwise it reverts.
3. The task is open, unexpired, belongs to the agent, and `amount <= remaining`, otherwise it reverts.
4. If the recipient is not allowlisted, or `amount > approvalThreshold`, the payment is **queued** for the owner. It reserves nothing and doesn't count toward the daily cap.
5. Otherwise, if the daily cap allows it, the payment executes. If not, it reverts.

- `approvalThreshold == 0` means **every** payment requires owner approval.
- A recipient is allowed if it is on the agent's allowlist or on the vault-wide allowlist, or if `enforceAllowlist` is off.
- **Approvals** re-check that the agent is active, the task is open and unexpired, the task budget covers the amount, and the vault is not paused. Approved payments don't count against the daily cap: they are explicit human sign-offs. `perTxCap` is not re-checked; approving is an explicit owner override of any cap change made after queueing.
- **Escrow** (`createEscrow`) locks funds from a task budget for a payee. It counts toward `perTxCap` and `dailyCap` like a direct payment, but skips the allowlist and threshold because release needs the owner or approver. After the deadline anyone can refund it to the vault's free balance.
- **Tasks** are opened by the owner only. The owner can close one at any time; anyone can close it after expiry. Task ids are never reusable.

## Security assumptions

- **The owner should be a multisig** (e.g. Safe) for real deployments. The owner can close tasks early and withdraw everything that isn't escrowed: reservations stop double-spending, they don't protect agents from the owner. Ownership transfer is two-step, and `renounceOwnership` is disabled so funds can never be stranded.
- **The approver must be a trusted party and never an agent key.** Agents choose escrow payees freely, including addresses they control, and the approver can release escrows to those payees. The only thing between an agent and an escrowed payout is the owner/approver. Set the approver to `address(0)` to make releases owner-only.
- **Fee-on-transfer and rebasing tokens are unsupported.** The vault assumes a transfer of `x` moves exactly `x`. USDG is a standard ERC-20.
- **Daily cap uses fixed UTC days**, `block.timestamp / 1 days`. An agent can spend up to **2× dailyCap** in a short window around UTC midnight (the full cap at 23:59, the full cap again at 00:00). A rolling window would need per-payment history, which costs more storage and gas. If 2× is too much, set `dailyCap` to half your real 24h tolerance.
- **Blocklisting tokens:** if the token blocks a recipient (as USDC-style blocklists do), transfers to that address revert and the whole call rolls back with no state change:
  - **Direct `pay`** reverts; budget, daily spend and reservations are untouched.
  - **`approveRequest`** reverts and the request stays pending. The owner should `rejectRequest` it.
  - **`releaseEscrow`** reverts and the escrow stays locked. Once the deadline passes, `refundEscrow` returns the funds to the vault's free balance.
  - If the **vault itself** were blocklisted, no transfers out would work, including withdrawals.
- **Pause** freezes `pay`, `createEscrow`, `approveRequest` and `releaseEscrow`. These still work while paused so the owner can always exit: `deposit`, `withdraw`, `closeTask`, `refundEscrow`, `rejectRequest`, `revokeAgent` and the config setters.
- **Reentrancy:** every function that sends tokens is `nonReentrant` and updates state before transferring (checks-effects-interactions). This is tested with a token that calls back into the vault mid-transfer.
- **No unbounded loops** in state-changing functions. Lists such as an agent's tasks, requests and escrows are read through paginated views.

## Testing

```bash
forge build
forge test
forge test --match-contract Invariant -vv
forge coverage --report summary
```

| Suite | Covers |
|---|---|
| `test/BursarVault.t.sol` | Every function, every custom error, every event |
| `test/Adversarial.t.sol` | Malicious agent, owner overreach, reentrant token, blocklisting token, step-by-step accounting scenario |
| `test/BursarVault.fuzz.t.sol` | Daily cap across day boundaries, per-tx cap, task budget accounting, total paid out ≤ deposits |
| `test/invariant/` | Handler with ghost variables: balance ≥ reserved; reserved = Σ tasks + Σ escrows; daily autonomous spend ≤ dailyCap; balance = deposits − outflows |
| `test/BursarFactory.t.sol` | Factory and MockUSDG |
| `test/Scripts.t.sol` | Deploy and Seed scripts run end to end in-process |

## Setup

```bash
git clone --recurse-submodules <repo-url>
# or, in an existing clone:
git submodule update --init --recursive
```

Dependencies are git submodules pinned to OpenZeppelin Contracts v5.4.0 and forge-std. Foundry reads `.env` from the project root automatically.

## Deploying to Arbitrum Sepolia

No private key ever goes in `.env` or in a script. The scripts call `vm.startBroadcast()` and sign with whatever you pass on the command line. Use an encrypted keystore:

```bash
cast wallet import deployer --interactive     # paste the key into YOUR terminal; it is stored encrypted
cast wallet address --account deployer        # prints the deployer address
```

The deployer needs Arbitrum Sepolia ETH for gas. Then `cp .env.example .env` and fill in `ARBITRUM_SEPOLIA_RPC_URL` and `ARBISCAN_API_KEY`. An Etherscan V2 key works for Arbiscan.

### 1. Deploy the factory (and MockUSDG)

```bash
# dry run: simulates against live Arbitrum Sepolia state, sends nothing
forge script script/Deploy.s.sol --rpc-url arbitrum_sepolia --sender <DEPLOYER_ADDRESS>

# real deploy + verification
forge script script/Deploy.s.sol --rpc-url arbitrum_sepolia --account deployer --broadcast --verify
```

Copy the printed `BursarFactory` and `MockUSDG` addresses into `.env` as `FACTORY_ADDRESS` and `TOKEN_ADDRESS`, and set `DEPLOY_MOCK_TOKEN=false` so a later run doesn't deploy another mock. For a real stablecoin, set `DEPLOY_MOCK_TOKEN=false` and `TOKEN_ADDRESS` before deploying.

### 2. Seed a demo vault

Fill in `AGENT_ADDRESS` and `RECIPIENT_ADDRESS` (and optionally the policy values) in `.env`, then:

```bash
forge script script/Seed.s.sol --rpc-url arbitrum_sepolia --sender <DEPLOYER_ADDRESS>      # dry run
forge script script/Seed.s.sol --rpc-url arbitrum_sepolia --account deployer --broadcast   # real
```

The vault is owned by the deployer address. Task ids can't be reused, so change `TASK_LABEL` before seeding again.

### 3. Manual verification (if `--verify` was skipped or failed)

```bash
forge verify-contract <FACTORY_ADDRESS> src/BursarFactory.sol:BursarFactory --chain arbitrum-sepolia --watch
forge verify-contract <TOKEN_ADDRESS> src/mocks/MockUSDG.sol:MockUSDG --chain arbitrum-sepolia --watch
forge verify-contract <VAULT_ADDRESS> src/BursarVault.sol:BursarVault --chain arbitrum-sepolia --watch   --constructor-args $(cast abi-encode "constructor(address,address)" <TOKEN_ADDRESS> <VAULT_OWNER>)
```

The API key is taken from the `[etherscan]` section of `foundry.toml`. To pass it explicitly, add `--etherscan-api-key <KEY>`.

### Arbitrum One later

Same commands with `--rpc-url arbitrum_one` and `--chain arbitrum`, `DEPLOY_MOCK_TOKEN=false`, and `TOKEN_ADDRESS` set to the real USDG address. Both scripts refuse to deploy or mint the mock on chain id 42161. Use a multisig as vault owner (see Security assumptions).
