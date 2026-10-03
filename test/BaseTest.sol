// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {BursarVault} from "../src/BursarVault.sol";
import {MockUSDG} from "../src/mocks/MockUSDG.sol";
import {ITestToken} from "./mocks/TestTokens.sol";

/// @notice Shared fixture: one funded vault, two agents with the same policy, one open task for `agent`.
abstract contract BaseTest is Test {
    ITestToken internal token;
    BursarVault internal vault;

    address internal owner = makeAddr("owner");
    address internal agent = makeAddr("agent");
    address internal agent2 = makeAddr("agent2");
    address internal recipient = makeAddr("recipient"); // allowlisted for both agents
    address internal outsider = makeAddr("outsider"); // never allowlisted
    address internal approverAddr = makeAddr("approver");
    address internal stranger = makeAddr("stranger");

    bytes32 internal constant TASK = keccak256("task-1");
    bytes32 internal constant TASK2 = keccak256("task-2");
    bytes32 internal constant REASON = "API_FEE";

    uint128 internal constant PER_TX = 1_000e6;
    uint128 internal constant DAILY = 5_000e6;
    uint128 internal constant THRESHOLD = 500e6;
    uint256 internal constant DEPOSIT = 100_000e6;
    uint256 internal constant BUDGET = 10_000e6;
    uint256 internal constant START = 1_700_000_000; // realistic timestamp

    uint64 internal expiry;
    bytes32[] internal trackedTasks; // every task opened through _openTask, for accounting sums

    function setUp() public virtual {
        vm.warp(START);
        token = ITestToken(_deployToken());
        vault = new BursarVault(token, owner);
        token.mint(owner, 1_000_000e6);

        vm.startPrank(owner);
        token.approve(address(vault), type(uint256).max);
        vault.deposit(DEPOSIT);
        vault.setAgent(agent, _policy(PER_TX, DAILY, THRESHOLD));
        vault.setAgent(agent2, _policy(PER_TX, DAILY, THRESHOLD));
        vault.setAgentRecipient(agent, recipient, true);
        vault.setAgentRecipient(agent2, recipient, true);
        vm.stopPrank();

        expiry = uint64(block.timestamp + 7 days);
        _openTask(TASK, agent, BUDGET, expiry);
    }

    function _deployToken() internal virtual returns (address) {
        return address(new MockUSDG());
    }

    // ---------------------------------------------------------------- helpers

    function _policy(uint128 perTx, uint128 daily, uint128 threshold) internal pure returns (BursarVault.Policy memory) {
        return BursarVault.Policy({
            perTxCap: perTx, dailyCap: daily, approvalThreshold: threshold, active: true, role: "OPS"
        });
    }

    function _openTask(bytes32 id, address a, uint256 budget, uint64 exp) internal {
        vm.prank(owner);
        vault.openTask(id, a, budget, exp);
        trackedTasks.push(id);
    }

    /// @dev Agent pays; returns the request id (0 if executed directly).
    function _pay(address a, bytes32 id, address to, uint256 amount) internal returns (uint256 requestId) {
        vm.prank(a);
        (, requestId) = vault.pay(id, to, amount, REASON);
    }

    function _escrow(address a, bytes32 id, address payee, uint256 amount, uint64 deadline)
        internal
        returns (uint256 escrowId)
    {
        vm.prank(a);
        escrowId = vault.createEscrow(id, payee, amount, deadline, REASON);
    }

    struct PayState {
        uint256 vaultBal;
        uint256 recipientBal;
        uint256 reserved;
        uint256 taskRemaining;
        uint256 taskSpent;
        uint256 spentToday;
        uint256 requestCount;
    }

    function _payState(address a, bytes32 id, address to) internal view returns (PayState memory st) {
        BursarVault.Task memory t = vault.getTask(id);
        st = PayState({
            vaultBal: token.balanceOf(address(vault)),
            recipientBal: token.balanceOf(to),
            reserved: vault.totalReserved(),
            taskRemaining: t.remaining,
            taskSpent: t.spent,
            spentToday: vault.spentToday(a),
            requestCount: vault.requestCount()
        });
    }

    /// @dev pay() must log PaymentBlocked with `cause`, return (false, 0) and change nothing at all.
    function _expectBlocked(address a, bytes32 id, address to, uint256 amount, BursarVault.BlockCause cause) internal {
        PayState memory before = _payState(a, id, to);
        vm.expectEmit(address(vault));
        emit BursarVault.PaymentBlocked(a, id, to, amount, REASON, cause);
        vm.prank(a);
        (bool executed, uint256 requestId) = vault.pay(id, to, amount, REASON);
        assertFalse(executed, "blocked: executed");
        assertEq(requestId, 0, "blocked: request id");
        PayState memory afterSt = _payState(a, id, to);
        assertEq(afterSt.vaultBal, before.vaultBal, "blocked: vault balance");
        assertEq(afterSt.recipientBal, before.recipientBal, "blocked: recipient balance");
        assertEq(afterSt.reserved, before.reserved, "blocked: totalReserved");
        assertEq(afterSt.taskRemaining, before.taskRemaining, "blocked: task remaining");
        assertEq(afterSt.taskSpent, before.taskSpent, "blocked: task spent");
        assertEq(afterSt.spentToday, before.spentToday, "blocked: daily spend");
        assertEq(afterSt.requestCount, before.requestCount, "blocked: request created");
    }

    function _sumOpenRemaining() internal view returns (uint256 sum) {
        for (uint256 i; i < trackedTasks.length; ++i) {
            BursarVault.Task memory t = vault.getTask(trackedTasks[i]);
            if (t.open) sum += t.remaining;
        }
    }

    function _sumLockedEscrows() internal view returns (uint256 sum) {
        BursarVault.Escrow[] memory es = vault.getEscrows(1, vault.escrowCount());
        for (uint256 i; i < es.length; ++i) {
            if (es[i].status == BursarVault.EscrowStatus.Locked) sum += es[i].amount;
        }
    }

    /// @dev The two accounting invariants, checked after every step of scripted scenarios.
    function _assertAccounting() internal view {
        assertGe(token.balanceOf(address(vault)), vault.totalReserved(), "balance < reserved");
        assertEq(vault.totalReserved(), _sumOpenRemaining() + _sumLockedEscrows(), "reserved != tasks + escrows");
    }
}
