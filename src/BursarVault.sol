// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title BursarVault
/// @notice A stablecoin treasury owned by one human, spent by AI agents strictly within on-chain policies.
/// @dev Accounting model:
///      - `totalReserved` = sum of open tasks' `remaining` + sum of locked escrow amounts.
///      - `freeBalance()` = token balance - totalReserved. Only free funds can be withdrawn or reserved for new tasks.
///      Fee-on-transfer and rebasing tokens are NOT supported: the vault assumes a transfer of `x` moves exactly `x`.
contract BursarVault is Ownable2Step, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ---------------------------------------------------------------------
    // Types
    // ---------------------------------------------------------------------

    /// @dev `approvalThreshold == 0` means every payment needs owner approval.
    ///      Invariants enforced by `setAgent`: 0 < perTxCap <= dailyCap and approvalThreshold <= perTxCap.
    struct Policy {
        uint128 perTxCap;
        uint128 dailyCap;
        uint128 approvalThreshold; // payments strictly above this are queued
        bool active;
        bytes32 role; // free-form label, e.g. "RESEARCH"
    }

    struct DailySpend {
        uint64 day; // block.timestamp / 1 days
        uint128 spent; // autonomous spend (direct pays + escrow creation) on `day`
    }

    struct Task {
        address agent;
        uint64 expiry; // usable while block.timestamp < expiry
        bool open;
        uint128 remaining; // reserved, not yet spent
        uint128 spent; // paid out directly, via approval, or moved into escrow
    }

    enum RequestStatus {
        None,
        Pending,
        Executed,
        Rejected
    }

    /// @dev "Expired" is not stored: a Pending request with block.timestamp >= expiresAt is expired.
    struct Request {
        address agent;
        uint64 expiresAt;
        RequestStatus status;
        address recipient;
        uint128 amount;
        bytes32 taskId;
        bytes32 reason;
    }

    enum EscrowStatus {
        None,
        Locked,
        Released,
        Refunded
    }

    struct Escrow {
        address agent;
        uint64 deadline; // refundable once block.timestamp >= deadline
        EscrowStatus status;
        address payee;
        uint128 amount;
        bytes32 taskId;
        bytes32 reason;
    }

    enum QueueCause {
        Allowlist,
        Threshold
    }

    // ---------------------------------------------------------------------
    // Storage
    // ---------------------------------------------------------------------

    /// @notice Upper bound on `requestTTL` so stale approvals cannot linger indefinitely.
    uint64 public constant MAX_REQUEST_TTL = 30 days;

    IERC20 public immutable token;

    /// @notice Optional second address allowed to release escrows. address(0) = owner only.
    address public approver;
    /// @notice When false, any recipient may be paid directly (approval threshold still applies).
    bool public enforceAllowlist = true;
    /// @notice Lifetime of a queued payment request.
    uint64 public requestTTL = 3 days;
    /// @notice Funds committed to open tasks and locked escrows.
    uint256 public totalReserved;

    uint256 public requestCount; // ids start at 1
    uint256 public escrowCount; // ids start at 1

    mapping(address recipient => bool) public globalAllowlist;
    mapping(address agent => mapping(address recipient => bool)) public agentAllowlist;

    mapping(address agent => Policy) private _policies;
    mapping(address agent => DailySpend) private _dailySpend;
    mapping(bytes32 taskId => Task) private _tasks;
    mapping(address agent => bytes32[]) private _agentTaskIds; // append-only, read via paginated view
    mapping(uint256 id => Request) private _requests;
    mapping(uint256 id => Escrow) private _escrows;

    // ---------------------------------------------------------------------
    // Events
    // ---------------------------------------------------------------------

    event Deposited(address indexed from, uint256 amount);
    event Withdrawn(address indexed to, uint256 amount);

    event AgentSet(address indexed agent, Policy policy);
    event AgentRevoked(address indexed agent);
    event AgentRecipientSet(address indexed agent, address indexed recipient, bool allowed);
    event GlobalRecipientSet(address indexed recipient, bool allowed);
    event AllowlistModeSet(bool enforced);
    event ApproverSet(address indexed approver);
    event RequestTTLSet(uint64 ttl);

    event TaskOpened(bytes32 indexed taskId, address indexed agent, uint256 budget, uint64 expiry);
    event TaskClosed(bytes32 indexed taskId, address indexed agent, uint256 released);

    event PaymentExecuted(
        address indexed agent, bytes32 indexed taskId, address indexed recipient, uint256 amount, bytes32 reason
    );
    event PaymentQueued(
        uint256 id,
        address indexed agent,
        bytes32 indexed taskId,
        address indexed recipient,
        uint256 amount,
        bytes32 reason,
        QueueCause cause
    );
    event RequestApproved(
        uint256 id, address indexed agent, bytes32 indexed taskId, address indexed recipient, uint256 amount, bytes32 reason
    );
    event RequestRejected(
        uint256 id, address indexed agent, bytes32 indexed taskId, address indexed recipient, uint256 amount, bytes32 reason
    );

    event EscrowCreated(
        uint256 id,
        address indexed agent,
        bytes32 indexed taskId,
        address indexed payee,
        uint256 amount,
        uint64 deadline,
        bytes32 reason
    );
    event EscrowReleased(
        uint256 id, address indexed agent, bytes32 indexed taskId, address indexed payee, uint256 amount, bytes32 reason
    );
    event EscrowRefunded(
        uint256 id, address indexed agent, bytes32 indexed taskId, address indexed payee, uint256 amount, bytes32 reason
    );

    // ---------------------------------------------------------------------
    // Errors
    // ---------------------------------------------------------------------

    error ZeroAddress();
    error ZeroAmount();
    error AmountTooLarge();
    error InvalidRecipient();
    error InsufficientFreeBalance();
    error RenounceDisabled();
    error InvalidTTL();

    error AgentInactive();
    error UnknownAgent();
    error InvalidPolicy();
    error ExceedsPerTxCap();
    error ExceedsDailyCap();

    error InvalidTaskId();
    error TaskExists();
    error TaskNotOpen();
    error TaskExpired();
    error TaskNotExpired();
    error TaskAgentMismatch();
    error ExceedsTaskBudget();
    error InvalidExpiry();

    error RequestNotPending();
    error RequestExpired();

    error EscrowNotLocked();
    error DeadlineNotReached();
    error InvalidDeadline();
    error NotOwnerOrApprover();

    // ---------------------------------------------------------------------
    // Constructor
    // ---------------------------------------------------------------------

    constructor(IERC20 token_, address owner_) Ownable(owner_) {
        if (address(token_) == address(0)) revert ZeroAddress();
        token = token_;
    }

    // ---------------------------------------------------------------------
    // Funding & ownership
    // ---------------------------------------------------------------------

    /// @notice Anyone may top up the vault. Requires prior ERC-20 approval.
    function deposit(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        token.safeTransferFrom(msg.sender, address(this), amount);
        emit Deposited(msg.sender, amount);
    }

    /// @notice Withdraw free (unreserved) funds. Works while paused so the owner can always exit.
    function withdraw(address to, uint256 amount) external onlyOwner nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        if (amount > freeBalance()) revert InsufficientFreeBalance();
        token.safeTransfer(to, amount);
        emit Withdrawn(to, amount);
    }

    /// @notice Freeze all agent spending, approvals and escrow releases.
    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    /// @dev Disabled: an ownerless vault would strand reserved funds and pending approvals forever.
    function renounceOwnership() public pure override {
        revert RenounceDisabled();
    }

    // ---------------------------------------------------------------------
    // Agent & allowlist management (owner)
    // ---------------------------------------------------------------------

    /// @notice Register an agent or replace its policy. Today's spent counter is kept, so lowering
    ///         dailyCap below what was already spent today blocks further autonomous spend until tomorrow.
    function setAgent(address agent, Policy calldata policy) external onlyOwner {
        if (agent == address(0)) revert ZeroAddress();
        if (
            policy.perTxCap == 0 || policy.perTxCap > policy.dailyCap
                || policy.approvalThreshold > policy.perTxCap
        ) revert InvalidPolicy();
        _policies[agent] = policy;
        emit AgentSet(agent, policy);
    }

    /// @notice Instantly stop an agent. Its open tasks stay reserved until closed (see `getAgentTasks`);
    ///         its pending requests can no longer be approved; its escrows are unaffected.
    function revokeAgent(address agent) external onlyOwner {
        // Every registered policy has perTxCap > 0 (enforced by setAgent), so 0 means "never registered".
        if (_policies[agent].perTxCap == 0) revert UnknownAgent();
        _policies[agent].active = false;
        emit AgentRevoked(agent);
    }

    function setAgentRecipient(address agent, address recipient, bool allowed) external onlyOwner {
        if (agent == address(0) || recipient == address(0)) revert ZeroAddress();
        agentAllowlist[agent][recipient] = allowed;
        emit AgentRecipientSet(agent, recipient, allowed);
    }

    function setGlobalRecipient(address recipient, bool allowed) external onlyOwner {
        if (recipient == address(0)) revert ZeroAddress();
        globalAllowlist[recipient] = allowed;
        emit GlobalRecipientSet(recipient, allowed);
    }

    function setEnforceAllowlist(bool enforced) external onlyOwner {
        enforceAllowlist = enforced;
        emit AllowlistModeSet(enforced);
    }

    /// @notice Set the escrow approver. address(0) disables it (owner-only releases).
    function setApprover(address approver_) external onlyOwner {
        approver = approver_;
        emit ApproverSet(approver_);
    }

    /// @notice Set the lifetime of newly queued requests, in (0, MAX_REQUEST_TTL]. Existing requests keep theirs.
    function setRequestTTL(uint64 ttl) external onlyOwner {
        if (ttl == 0 || ttl > MAX_REQUEST_TTL) revert InvalidTTL();
        requestTTL = ttl;
        emit RequestTTLSet(ttl);
    }

    // ---------------------------------------------------------------------
    // Tasks
    // ---------------------------------------------------------------------

    /// @notice Reserve `budget` of free funds for `agent` until `expiry`. Task ids are never reusable.
    function openTask(bytes32 taskId, address agent, uint256 budget, uint64 expiry) external onlyOwner {
        if (taskId == bytes32(0)) revert InvalidTaskId();
        if (agent == address(0)) revert ZeroAddress();
        if (!_policies[agent].active) revert AgentInactive();
        if (budget == 0) revert ZeroAmount();
        if (budget > type(uint128).max) revert AmountTooLarge();
        if (expiry <= block.timestamp) revert InvalidExpiry();
        if (_tasks[taskId].agent != address(0)) revert TaskExists();
        if (budget > freeBalance()) revert InsufficientFreeBalance();

        _tasks[taskId] = Task({agent: agent, expiry: expiry, open: true, remaining: uint128(budget), spent: 0});
        _agentTaskIds[agent].push(taskId);
        totalReserved += budget;
        emit TaskOpened(taskId, agent, budget, expiry);
    }

    /// @notice Release a task's unspent budget back to free balance.
    ///         The owner may close any time; anyone may close once the task has expired.
    function closeTask(bytes32 taskId) external {
        Task storage t = _tasks[taskId];
        if (!t.open) revert TaskNotOpen();
        if (msg.sender != owner() && block.timestamp < t.expiry) revert TaskNotExpired();

        uint256 released = t.remaining;
        t.open = false;
        t.remaining = 0;
        totalReserved -= released;
        emit TaskClosed(taskId, t.agent, released);
    }

    // ---------------------------------------------------------------------
    // Agent payments
    // ---------------------------------------------------------------------

    /// @notice Spend from a task. Executes immediately if the recipient is allowed and
    ///         `amount <= approvalThreshold`; otherwise stores a pending request for the owner.
    /// @return executed True if paid now, false if queued.
    /// @return requestId Id of the queued request (0 if executed).
    function pay(bytes32 taskId, address recipient, uint256 amount, bytes32 reason)
        external
        nonReentrant
        whenNotPaused
        returns (bool executed, uint256 requestId)
    {
        Policy memory p = _activePolicy(msg.sender);
        _validateRecipient(recipient);
        if (amount == 0) revert ZeroAmount();
        if (amount > p.perTxCap) revert ExceedsPerTxCap(); // also guarantees amount fits in uint128
        Task storage t = _usableTask(taskId, msg.sender);
        if (amount > t.remaining) revert ExceedsTaskBudget();

        bool allowed = isRecipientAllowed(msg.sender, recipient);
        if (!allowed || amount > p.approvalThreshold) {
            requestId = ++requestCount;
            _requests[requestId] = Request({
                agent: msg.sender,
                expiresAt: uint64(block.timestamp) + requestTTL,
                status: RequestStatus.Pending,
                recipient: recipient,
                amount: uint128(amount),
                taskId: taskId,
                reason: reason
            });
            emit PaymentQueued(
                requestId, msg.sender, taskId, recipient, amount, reason, allowed ? QueueCause.Threshold : QueueCause.Allowlist
            );
            return (false, requestId);
        }

        _spendDaily(msg.sender, p.dailyCap, amount);
        _debitTask(t, amount);
        totalReserved -= amount;
        token.safeTransfer(recipient, amount);
        emit PaymentExecuted(msg.sender, taskId, recipient, amount, reason);
        return (true, 0);
    }

    // ---------------------------------------------------------------------
    // Approval queue (owner)
    // ---------------------------------------------------------------------

    /// @notice Execute a pending request. Re-checks agent, task and budget at approval time.
    ///         Approved payments bypass and do not count toward the agent's daily cap.
    /// @dev perTxCap is deliberately NOT re-checked: it was enforced when the request was queued, and approving
    ///      is an explicit owner override of any perTxCap change (e.g. a lowered cap) made after queueing.
    ///      Owners who want the new cap to apply should reject the request instead.
    function approveRequest(uint256 id) external onlyOwner nonReentrant whenNotPaused {
        Request storage r = _requests[id];
        if (r.status != RequestStatus.Pending) revert RequestNotPending();
        if (block.timestamp >= r.expiresAt) revert RequestExpired();
        if (!_policies[r.agent].active) revert AgentInactive();
        Task storage t = _usableTask(r.taskId, r.agent);
        uint256 amount = r.amount;
        if (amount > t.remaining) revert ExceedsTaskBudget();

        r.status = RequestStatus.Executed;
        _debitTask(t, amount);
        totalReserved -= amount;
        token.safeTransfer(r.recipient, amount);
        emit RequestApproved(id, r.agent, r.taskId, r.recipient, amount, r.reason);
    }

    /// @notice Reject a pending (or expired-but-pending) request. Moves no funds.
    function rejectRequest(uint256 id) external onlyOwner {
        Request storage r = _requests[id];
        if (r.status != RequestStatus.Pending) revert RequestNotPending();
        r.status = RequestStatus.Rejected;
        emit RequestRejected(id, r.agent, r.taskId, r.recipient, r.amount, r.reason);
    }

    // ---------------------------------------------------------------------
    // Escrow
    // ---------------------------------------------------------------------

    /// @notice Lock part of a task budget for `payee`. Counts toward perTxCap and dailyCap like a direct pay,
    ///         but skips the allowlist and approval threshold because release itself needs owner/approver.
    /// @param deadline After this the escrow can be refunded to the vault. Must be in (now, task.expiry].
    function createEscrow(bytes32 taskId, address payee, uint256 amount, uint64 deadline, bytes32 reason)
        external
        whenNotPaused
        returns (uint256 id)
    {
        Policy memory p = _activePolicy(msg.sender);
        _validateRecipient(payee);
        if (amount == 0) revert ZeroAmount();
        if (amount > p.perTxCap) revert ExceedsPerTxCap();
        Task storage t = _usableTask(taskId, msg.sender);
        if (amount > t.remaining) revert ExceedsTaskBudget();
        if (deadline <= block.timestamp || deadline > t.expiry) revert InvalidDeadline();

        _spendDaily(msg.sender, p.dailyCap, amount);
        _debitTask(t, amount); // reserved funds move from the task to the escrow; totalReserved unchanged

        id = ++escrowCount;
        _escrows[id] = Escrow({
            agent: msg.sender,
            deadline: deadline,
            status: EscrowStatus.Locked,
            payee: payee,
            amount: uint128(amount),
            taskId: taskId,
            reason: reason
        });
        emit EscrowCreated(id, msg.sender, taskId, payee, amount, deadline, reason);
    }

    /// @notice Pay a locked escrow to its payee. Allowed until it has been refunded, even past the deadline.
    function releaseEscrow(uint256 id) external nonReentrant whenNotPaused {
        if (msg.sender != owner() && msg.sender != approver) revert NotOwnerOrApprover(); // approver==0 never matches
        Escrow storage e = _escrows[id];
        if (e.status != EscrowStatus.Locked) revert EscrowNotLocked();

        uint256 amount = e.amount;
        e.status = EscrowStatus.Released;
        totalReserved -= amount;
        token.safeTransfer(e.payee, amount);
        emit EscrowReleased(id, e.agent, e.taskId, e.payee, amount, e.reason);
    }

    /// @notice After the deadline anyone may return a locked escrow to the vault's free balance.
    ///         Works while paused. The owner cannot pull escrowed funds back earlier: that is the payee's guarantee.
    function refundEscrow(uint256 id) external {
        Escrow storage e = _escrows[id];
        if (e.status != EscrowStatus.Locked) revert EscrowNotLocked();
        if (block.timestamp < e.deadline) revert DeadlineNotReached();

        uint256 amount = e.amount;
        e.status = EscrowStatus.Refunded;
        totalReserved -= amount;
        emit EscrowRefunded(id, e.agent, e.taskId, e.payee, amount, e.reason);
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    function freeBalance() public view returns (uint256) {
        uint256 bal = token.balanceOf(address(this));
        return bal > totalReserved ? bal - totalReserved : 0;
    }

    function isRecipientAllowed(address agent, address recipient) public view returns (bool) {
        return !enforceAllowlist || globalAllowlist[recipient] || agentAllowlist[agent][recipient];
    }

    function getPolicy(address agent) external view returns (Policy memory) {
        return _policies[agent];
    }

    /// @notice How much more the agent can spend autonomously today (ignores task budgets).
    function remainingDailyAllowance(address agent) external view returns (uint256) {
        Policy storage p = _policies[agent];
        if (!p.active) return 0;
        uint256 spent = _spentToday(agent);
        return spent >= p.dailyCap ? 0 : p.dailyCap - spent;
    }

    function spentToday(address agent) external view returns (uint256) {
        return _spentToday(agent);
    }

    function getTask(bytes32 taskId) external view returns (Task memory) {
        return _tasks[taskId];
    }

    /// @notice Spendable budget left on a task (0 if closed or expired).
    function taskRemaining(bytes32 taskId) external view returns (uint256) {
        Task storage t = _tasks[taskId];
        return (t.open && block.timestamp < t.expiry) ? t.remaining : 0;
    }

    function agentTaskCount(address agent) external view returns (uint256) {
        return _agentTaskIds[agent].length;
    }

    /// @notice Paginated list of every task ever opened for `agent` (open and closed), with details,
    ///         so an owner can find and close a revoked agent's open tasks.
    function getAgentTasks(address agent, uint256 offset, uint256 limit)
        external
        view
        returns (bytes32[] memory ids, Task[] memory tasks)
    {
        bytes32[] storage all = _agentTaskIds[agent];
        uint256 n = _pageSize(all.length, offset, limit);
        ids = new bytes32[](n);
        tasks = new Task[](n);
        for (uint256 i; i < n; ++i) {
            ids[i] = all[offset + i];
            tasks[i] = _tasks[ids[i]];
        }
    }

    function getRequest(uint256 id) external view returns (Request memory) {
        return _requests[id];
    }

    /// @notice Requests with ids in [fromId, fromId + limit), clipped to `requestCount`.
    function getRequests(uint256 fromId, uint256 limit) external view returns (Request[] memory out) {
        if (fromId == 0) fromId = 1;
        uint256 n = _pageSize(requestCount + 1, fromId, limit);
        out = new Request[](n);
        for (uint256 i; i < n; ++i) {
            out[i] = _requests[fromId + i];
        }
    }

    function isRequestExpired(uint256 id) external view returns (bool) {
        Request storage r = _requests[id];
        return r.status == RequestStatus.Pending && block.timestamp >= r.expiresAt;
    }

    function getEscrow(uint256 id) external view returns (Escrow memory) {
        return _escrows[id];
    }

    /// @notice Escrows with ids in [fromId, fromId + limit), clipped to `escrowCount`.
    function getEscrows(uint256 fromId, uint256 limit) external view returns (Escrow[] memory out) {
        if (fromId == 0) fromId = 1;
        uint256 n = _pageSize(escrowCount + 1, fromId, limit);
        out = new Escrow[](n);
        for (uint256 i; i < n; ++i) {
            out[i] = _escrows[fromId + i];
        }
    }

    // ---------------------------------------------------------------------
    // Internal
    // ---------------------------------------------------------------------

    function _activePolicy(address agent) internal view returns (Policy memory p) {
        p = _policies[agent];
        if (!p.active) revert AgentInactive();
    }

    function _validateRecipient(address recipient) internal view {
        if (recipient == address(0)) revert ZeroAddress();
        if (recipient == address(this)) revert InvalidRecipient();
    }

    /// @dev Task must be open, unexpired and owned by `agent`.
    function _usableTask(bytes32 taskId, address agent) internal view returns (Task storage t) {
        t = _tasks[taskId];
        if (!t.open) revert TaskNotOpen();
        if (t.agent != agent) revert TaskAgentMismatch();
        if (block.timestamp >= t.expiry) revert TaskExpired();
    }

    /// @dev Caller has checked amount <= t.remaining (which fits in uint128).
    function _debitTask(Task storage t, uint256 amount) internal {
        t.remaining -= uint128(amount);
        t.spent += uint128(amount);
    }

    /// @dev Fixed day-window cap: the counter resets when `block.timestamp / 1 days` changes (UTC midnight).
    ///      Tradeoff vs. a rolling 24h window: an agent can spend up to 2x dailyCap in a short span straddling
    ///      midnight (cap just before, cap again just after). A rolling window closes that gap but needs per-payment
    ///      history or a ring buffer, i.e. more storage, more gas and harder reasoning. Owners who need a tighter
    ///      bound should set dailyCap to half their true 24h tolerance.
    function _spendDaily(address agent, uint256 dailyCap, uint256 amount) internal {
        uint64 today = uint64(block.timestamp / 1 days);
        DailySpend storage d = _dailySpend[agent];
        uint256 spent = d.day == today ? d.spent : 0;
        if (spent + amount > dailyCap) revert ExceedsDailyCap();
        d.day = today;
        d.spent = uint128(spent + amount); // <= dailyCap, fits in uint128
    }

    function _spentToday(address agent) internal view returns (uint256) {
        DailySpend storage d = _dailySpend[agent];
        return d.day == uint64(block.timestamp / 1 days) ? d.spent : 0;
    }

    function _pageSize(uint256 end, uint256 start, uint256 limit) internal pure returns (uint256) {
        if (start >= end) return 0;
        uint256 left = end - start;
        return left < limit ? left : limit;
    }
}
