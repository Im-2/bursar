// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {BursarVault} from "../../src/BursarVault.sol";
import {MockUSDG} from "../../src/mocks/MockUSDG.sol";

/// @notice Drives the vault through random but well-formed sequences of owner, agent, approver and
///         permissionless actions, and keeps ghost variables the invariants are checked against.
contract Handler is Test {
    BursarVault public immutable vault;
    MockUSDG public immutable token;
    address public immutable owner;
    address public immutable approver;
    address public immutable sink = makeAddr("sink");

    uint128 public constant PER_TX = 1_000e6;
    uint128 public constant DAILY = 3_000e6;
    uint128 public constant THRESHOLD = 600e6;

    address[] public agents;
    address[] public recipients; // [0] allowlisted for every agent, [1] never allowlisted
    bytes32[] public taskIds;

    // ------------------------------------------------------------ ghosts
    uint256 public currentTime;
    uint256 public ghost_deposited; // deposits made through the handler (excludes the initial funding)
    uint256 public ghost_paidOut; // pays, approvals, escrow releases
    uint256 public ghost_withdrawn;
    /// @dev autonomous spend only (direct pay + escrow creation); approvals are excluded by design
    mapping(address agent => mapping(uint256 day => uint256)) public ghost_autoSpend;
    bool public ghost_dailyCapViolated;
    uint256 internal nonce;

    mapping(bytes4 => uint256) public calls;

    modifier useTime() {
        vm.warp(currentTime);
        _;
    }

    modifier count(bytes4 sel) {
        calls[sel]++;
        _;
    }

    constructor(BursarVault vault_, MockUSDG token_, address owner_, address approver_, address[] memory agents_) {
        vault = vault_;
        token = token_;
        owner = owner_;
        approver = approver_;
        agents = agents_;
        recipients.push(makeAddr("allowedRecipient"));
        recipients.push(makeAddr("unlistedRecipient"));
        currentTime = block.timestamp;
    }

    // ------------------------------------------------------------ owner actions

    function deposit(uint256 amount) external useTime count(this.deposit.selector) {
        amount = bound(amount, 1, 50_000e6);
        token.mint(owner, amount);
        vm.startPrank(owner);
        token.approve(address(vault), amount);
        vault.deposit(amount);
        vm.stopPrank();
        ghost_deposited += amount;
    }

    function withdraw(uint256 amount) external useTime count(this.withdraw.selector) {
        uint256 free = vault.freeBalance();
        if (free == 0) return;
        amount = bound(amount, 1, free);
        vm.prank(owner);
        vault.withdraw(sink, amount);
        ghost_withdrawn += amount;
    }

    function openTask(uint256 agentSeed, uint256 budget, uint256 duration) external useTime count(this.openTask.selector) {
        uint256 free = vault.freeBalance();
        if (free == 0) return;
        address a = agents[agentSeed % agents.length];
        if (!vault.getPolicy(a).active) return;
        budget = bound(budget, free < 100e6 ? free : 100e6, free < 20_000e6 ? free : 20_000e6);
        uint64 exp = uint64(block.timestamp + bound(duration, 1 hours, 5 days));
        bytes32 id = keccak256(abi.encode("task", nonce++));
        vm.prank(owner);
        vault.openTask(id, a, budget, exp);
        taskIds.push(id);
    }

    function closeTask(uint256 seed, bool asOwner) external useTime count(this.closeTask.selector) {
        if (taskIds.length == 0) return;
        bytes32 id = taskIds[seed % taskIds.length];
        BursarVault.Task memory t = vault.getTask(id);
        if (!t.open) return;
        address caller = (asOwner || block.timestamp < t.expiry) ? owner : sink;
        vm.prank(caller);
        vault.closeTask(id);
    }

    /// @dev Revokes only 1 in 4 times so agents are active most of the run (reinstate always succeeds).
    function revokeAgent(uint256 seed) external useTime count(this.revokeAgent.selector) {
        if (seed % 4 != 0) return;
        vm.prank(owner);
        vault.revokeAgent(agents[seed % agents.length]);
    }

    function reinstateAgent(uint256 seed) external useTime count(this.reinstateAgent.selector) {
        vm.prank(owner);
        vault.setAgent(agents[seed % agents.length], _policy());
    }

    /// @dev Unpauses whenever paused, pauses 1 in 4 times otherwise, so the vault is live most of the run.
    function togglePause(uint256 seed) external useTime count(this.togglePause.selector) {
        vm.startPrank(owner);
        if (vault.paused()) vault.unpause();
        else if (seed % 4 == 0) vault.pause();
        vm.stopPrank();
    }

    // Value-moving actions call the vault directly (no try/catch). A revert rolls back the whole handler call,
    // ghosts included, and shows up in Foundry's per-selector "Reverts" column (fail_on_revert = false),
    // which doubles as a health check that the handler is mostly exercising successful paths.

    function approveRequest(uint256 seed) external useTime count(this.approveRequest.selector) {
        uint256 n = vault.requestCount();
        if (n == 0) return;
        uint256 id = bound(seed, 1, n);
        uint256 amount = vault.getRequest(id).amount;
        vm.prank(owner);
        vault.approveRequest(id);
        ghost_paidOut += amount; // deliberately NOT added to ghost_autoSpend
    }

    function rejectRequest(uint256 seed) external useTime count(this.rejectRequest.selector) {
        uint256 n = vault.requestCount();
        if (n == 0) return;
        vm.prank(owner);
        vault.rejectRequest(bound(seed, 1, n));
    }

    // ------------------------------------------------------------ agent actions

    function pay(uint256 taskSeed, uint256 recipientSeed, uint256 amount) external useTime count(this.pay.selector) {
        if (taskIds.length == 0) return;
        bytes32 id = _recentTask(taskSeed);
        address a = vault.getTask(id).agent;
        // Two thirds of calls aim at the direct path (allowlisted, <= threshold); the rest may queue.
        bool aimDirect = recipientSeed % 3 != 0;
        address to = aimDirect ? recipients[0] : recipients[(recipientSeed / 3) % recipients.length];
        amount = bound(amount, 1, aimDirect ? THRESHOLD : PER_TX);

        vm.prank(a);
        (bool executed,) = vault.pay(id, to, amount, "INV");
        if (executed) {
            ghost_paidOut += amount;
            _recordAutonomous(a, amount);
        }
    }

    function createEscrow(uint256 taskSeed, uint256 amount, uint256 deadlineSeed)
        external
        useTime
        count(this.createEscrow.selector)
    {
        if (taskIds.length == 0) return;
        bytes32 id = _recentTask(taskSeed);
        BursarVault.Task memory t = vault.getTask(id);
        if (t.expiry <= block.timestamp) return;
        amount = bound(amount, 1, PER_TX);
        uint64 deadline = uint64(bound(deadlineSeed, block.timestamp + 1, t.expiry));

        vm.prank(t.agent);
        vault.createEscrow(id, recipients[1], amount, deadline, "INV");
        _recordAutonomous(t.agent, amount);
    }

    // ------------------------------------------------------------ approver / permissionless

    function releaseEscrow(uint256 seed, bool asApprover) external useTime count(this.releaseEscrow.selector) {
        uint256 n = vault.escrowCount();
        if (n == 0) return;
        uint256 id = bound(seed, 1, n);
        uint256 amount = vault.getEscrow(id).amount;
        vm.prank(asApprover ? approver : owner);
        vault.releaseEscrow(id);
        ghost_paidOut += amount;
    }

    function refundEscrow(uint256 seed) external useTime count(this.refundEscrow.selector) {
        uint256 n = vault.escrowCount();
        if (n == 0) return;
        vault.refundEscrow(bound(seed, 1, n));
    }

    function warp(uint256 dt) external count(this.warp.selector) {
        currentTime += bound(dt, 1 minutes, 12 hours);
        vm.warp(currentTime);
    }

    // ------------------------------------------------------------ helpers & views

    /// @dev One of the three most recently opened tasks (older ones are usually closed or expired).
    function _recentTask(uint256 seed) internal view returns (bytes32) {
        uint256 len = taskIds.length;
        uint256 window = len < 3 ? len : 3;
        return taskIds[len - 1 - (seed % window)];
    }

    function _recordAutonomous(address a, uint256 amount) internal {
        uint256 day = block.timestamp / 1 days;
        ghost_autoSpend[a][day] += amount;
        if (ghost_autoSpend[a][day] > vault.getPolicy(a).dailyCap) ghost_dailyCapViolated = true;
    }

    function _policy() internal pure returns (BursarVault.Policy memory) {
        return BursarVault.Policy({
            perTxCap: PER_TX, dailyCap: DAILY, approvalThreshold: THRESHOLD, active: true, role: "INV"
        });
    }

    function taskCount() external view returns (uint256) {
        return taskIds.length;
    }

    function agentCount() external view returns (uint256) {
        return agents.length;
    }

    function sumOpenTaskRemaining() external view returns (uint256 sum) {
        for (uint256 i; i < taskIds.length; ++i) {
            BursarVault.Task memory t = vault.getTask(taskIds[i]);
            if (t.open) sum += t.remaining;
        }
    }

    function sumLockedEscrows() external view returns (uint256 sum) {
        BursarVault.Escrow[] memory es = vault.getEscrows(1, vault.escrowCount());
        for (uint256 i; i < es.length; ++i) {
            if (es[i].status == BursarVault.EscrowStatus.Locked) sum += es[i].amount;
        }
    }
}
