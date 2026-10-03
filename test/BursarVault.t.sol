// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {Vm} from "forge-std/Vm.sol";
import {BursarVault} from "../src/BursarVault.sol";
import {BaseTest} from "./BaseTest.sol";

/// @notice Unit tests: every function, every revert path, every event.
contract BursarVaultTest is BaseTest {
    // =====================================================================
    // Constructor & defaults
    // =====================================================================

    function test_constructor_setsState() public view {
        assertEq(address(vault.token()), address(token));
        assertEq(vault.owner(), owner);
        assertTrue(vault.enforceAllowlist());
        assertEq(vault.requestTTL(), 3 days);
        assertEq(vault.MAX_REQUEST_TTL(), 30 days);
        assertEq(vault.approver(), address(0));
    }

    function test_constructor_revert_zeroToken() public {
        vm.expectRevert(BursarVault.ZeroAddress.selector);
        new BursarVault(IERC20(address(0)), owner);
    }

    function test_constructor_revert_zeroOwner() public {
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableInvalidOwner.selector, address(0)));
        new BursarVault(token, address(0));
    }

    // =====================================================================
    // deposit / withdraw
    // =====================================================================

    function test_deposit_anyoneCanDeposit() public {
        token.mint(stranger, 50e6);
        vm.startPrank(stranger);
        token.approve(address(vault), 50e6);
        vm.expectEmit(address(vault));
        emit BursarVault.Deposited(stranger, 50e6);
        vault.deposit(50e6);
        vm.stopPrank();
        assertEq(token.balanceOf(address(vault)), DEPOSIT + 50e6);
    }

    function test_deposit_worksWhilePaused() public {
        vm.startPrank(owner);
        vault.pause();
        vault.deposit(1e6);
        vm.stopPrank();
        assertEq(token.balanceOf(address(vault)), DEPOSIT + 1e6);
    }

    function test_deposit_revert_zeroAmount() public {
        vm.prank(owner);
        vm.expectRevert(BursarVault.ZeroAmount.selector);
        vault.deposit(0);
    }

    function test_withdraw_freeFunds() public {
        uint256 free = vault.freeBalance();
        assertEq(free, DEPOSIT - BUDGET);
        vm.expectEmit(address(vault));
        emit BursarVault.Withdrawn(stranger, free);
        vm.prank(owner);
        vault.withdraw(stranger, free);
        assertEq(token.balanceOf(stranger), free);
        assertEq(vault.freeBalance(), 0);
        _assertAccounting();
    }

    function test_withdraw_worksWhilePaused() public {
        vm.startPrank(owner);
        vault.pause();
        vault.withdraw(owner, 1e6);
        vm.stopPrank();
    }

    function test_withdraw_revert_notOwner() public {
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        vault.withdraw(stranger, 1);
    }

    function test_withdraw_revert_zeroTo() public {
        vm.prank(owner);
        vm.expectRevert(BursarVault.ZeroAddress.selector);
        vault.withdraw(address(0), 1);
    }

    function test_withdraw_revert_zeroAmount() public {
        vm.prank(owner);
        vm.expectRevert(BursarVault.ZeroAmount.selector);
        vault.withdraw(owner, 0);
    }

    function test_withdraw_revert_reservedFunds() public {
        vm.prank(owner);
        vm.expectRevert(BursarVault.InsufficientFreeBalance.selector);
        vault.withdraw(owner, DEPOSIT - BUDGET + 1);
    }

    // =====================================================================
    // pause / ownership
    // =====================================================================

    function test_pause_unpause() public {
        vm.startPrank(owner);
        vault.pause();
        assertTrue(vault.paused());
        vault.unpause();
        assertFalse(vault.paused());
        vm.stopPrank();
    }

    function test_pause_revert_notOwner() public {
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        vault.pause();
    }

    function test_unpause_revert_notOwner() public {
        vm.prank(owner);
        vault.pause();
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, agent));
        vault.unpause();
    }

    function test_renounceOwnership_alwaysReverts() public {
        vm.prank(owner);
        vm.expectRevert(BursarVault.RenounceDisabled.selector);
        vault.renounceOwnership();
        vm.prank(stranger);
        vm.expectRevert(BursarVault.RenounceDisabled.selector);
        vault.renounceOwnership();
        assertEq(vault.owner(), owner);
    }

    function test_ownership_twoStepTransfer() public {
        address newOwner = makeAddr("newOwner");
        vm.prank(owner);
        vault.transferOwnership(newOwner);
        assertEq(vault.owner(), owner); // not yet
        assertEq(vault.pendingOwner(), newOwner);

        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        vault.acceptOwnership();

        vm.prank(newOwner);
        vault.acceptOwnership();
        assertEq(vault.owner(), newOwner);
    }

    // =====================================================================
    // setAgent / revokeAgent
    // =====================================================================

    function test_setAgent_storesAndEmits() public {
        address a = makeAddr("newAgent");
        BursarVault.Policy memory p = _policy(100e6, 300e6, 50e6);
        vm.expectEmit(address(vault));
        emit BursarVault.AgentSet(a, p);
        vm.prank(owner);
        vault.setAgent(a, p);

        BursarVault.Policy memory got = vault.getPolicy(a);
        assertEq(got.perTxCap, 100e6);
        assertEq(got.dailyCap, 300e6);
        assertEq(got.approvalThreshold, 50e6);
        assertTrue(got.active);
        assertEq(got.role, bytes32("OPS"));
    }

    function test_setAgent_thresholdEqualPerTxAllowed() public {
        vm.prank(owner);
        vault.setAgent(agent, _policy(PER_TX, DAILY, PER_TX));
        assertEq(vault.getPolicy(agent).approvalThreshold, PER_TX);
    }

    function test_setAgent_perTxEqualDailyAllowed() public {
        vm.prank(owner);
        vault.setAgent(agent, _policy(DAILY, DAILY, 0));
        assertEq(vault.getPolicy(agent).perTxCap, DAILY);
    }

    function test_setAgent_revert_notOwner() public {
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, agent));
        vault.setAgent(agent, _policy(PER_TX, DAILY, THRESHOLD));
    }

    function test_setAgent_revert_zeroAgent() public {
        vm.prank(owner);
        vm.expectRevert(BursarVault.ZeroAddress.selector);
        vault.setAgent(address(0), _policy(PER_TX, DAILY, THRESHOLD));
    }

    function test_setAgent_revert_zeroPerTx() public {
        vm.prank(owner);
        vm.expectRevert(BursarVault.InvalidPolicy.selector);
        vault.setAgent(agent, _policy(0, DAILY, 0));
    }

    function test_setAgent_revert_perTxAboveDaily() public {
        vm.prank(owner);
        vm.expectRevert(BursarVault.InvalidPolicy.selector);
        vault.setAgent(agent, _policy(DAILY + 1, DAILY, 0));
    }

    function test_setAgent_revert_thresholdAbovePerTx() public {
        vm.prank(owner);
        vm.expectRevert(BursarVault.InvalidPolicy.selector);
        vault.setAgent(agent, _policy(PER_TX, DAILY, PER_TX + 1));
    }

    function test_setAgent_updateKeepsTodaysSpend() public {
        _pay(agent, TASK, recipient, 400e6);
        vm.prank(owner);
        vault.setAgent(agent, _policy(THRESHOLD, 300e6 + 400e6, THRESHOLD)); // cap now 700
        assertEq(vault.spentToday(agent), 400e6);
        assertEq(vault.remainingDailyAllowance(agent), 300e6);
    }

    function test_setAgent_loweringCapBelowSpentBlocksRestOfDay() public {
        _pay(agent, TASK, recipient, 400e6);
        vm.prank(owner);
        vault.setAgent(agent, _policy(200e6, 200e6, 200e6));
        assertEq(vault.remainingDailyAllowance(agent), 0);
        _expectBlocked(agent, TASK, recipient, 1, BursarVault.BlockCause.DailyCap);
    }

    function test_revokeAgent() public {
        vm.expectEmit(address(vault));
        emit BursarVault.AgentRevoked(agent);
        vm.prank(owner);
        vault.revokeAgent(agent);
        assertFalse(vault.getPolicy(agent).active);
        assertEq(vault.getPolicy(agent).perTxCap, PER_TX); // rest of the policy kept for the record
    }

    function test_revokeAgent_twiceIsFine() public {
        vm.startPrank(owner);
        vault.revokeAgent(agent);
        vault.revokeAgent(agent);
        vm.stopPrank();
    }

    function test_revokeAgent_revert_notOwner() public {
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, agent));
        vault.revokeAgent(agent);
    }

    function test_revokeAgent_revert_unknownAgent() public {
        vm.prank(owner);
        vm.expectRevert(BursarVault.UnknownAgent.selector);
        vault.revokeAgent(stranger);
    }

    // =====================================================================
    // Allowlists & config setters
    // =====================================================================

    function test_setAgentRecipient() public {
        vm.expectEmit(address(vault));
        emit BursarVault.AgentRecipientSet(agent, outsider, true);
        vm.prank(owner);
        vault.setAgentRecipient(agent, outsider, true);
        assertTrue(vault.agentAllowlist(agent, outsider));
        assertTrue(vault.isRecipientAllowed(agent, outsider));
        assertFalse(vault.isRecipientAllowed(agent2, outsider)); // per-agent only

        vm.prank(owner);
        vault.setAgentRecipient(agent, outsider, false);
        assertFalse(vault.isRecipientAllowed(agent, outsider));
    }

    function test_setAgentRecipient_revert_notOwner() public {
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, agent));
        vault.setAgentRecipient(agent, outsider, true);
    }

    function test_setAgentRecipient_revert_zeroAgent() public {
        vm.prank(owner);
        vm.expectRevert(BursarVault.ZeroAddress.selector);
        vault.setAgentRecipient(address(0), outsider, true);
    }

    function test_setAgentRecipient_revert_zeroRecipient() public {
        vm.prank(owner);
        vm.expectRevert(BursarVault.ZeroAddress.selector);
        vault.setAgentRecipient(agent, address(0), true);
    }

    function test_setGlobalRecipient() public {
        vm.expectEmit(address(vault));
        emit BursarVault.GlobalRecipientSet(outsider, true);
        vm.prank(owner);
        vault.setGlobalRecipient(outsider, true);
        assertTrue(vault.globalAllowlist(outsider));
        assertTrue(vault.isRecipientAllowed(agent, outsider));
        assertTrue(vault.isRecipientAllowed(agent2, outsider));
    }

    function test_setGlobalRecipient_revert_notOwner() public {
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, agent));
        vault.setGlobalRecipient(outsider, true);
    }

    function test_setGlobalRecipient_revert_zero() public {
        vm.prank(owner);
        vm.expectRevert(BursarVault.ZeroAddress.selector);
        vault.setGlobalRecipient(address(0), true);
    }

    function test_setEnforceAllowlist() public {
        vm.expectEmit(address(vault));
        emit BursarVault.AllowlistModeSet(false);
        vm.prank(owner);
        vault.setEnforceAllowlist(false);
        assertFalse(vault.enforceAllowlist());
        assertTrue(vault.isRecipientAllowed(agent, outsider));

        // Direct payment to a non-listed recipient now executes (threshold still applies).
        assertEq(_pay(agent, TASK, outsider, THRESHOLD), 0);
        assertEq(token.balanceOf(outsider), THRESHOLD);
        assertGt(_pay(agent, TASK, outsider, THRESHOLD + 1), 0);
    }

    function test_setEnforceAllowlist_revert_notOwner() public {
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, agent));
        vault.setEnforceAllowlist(false);
    }

    function test_setApprover() public {
        vm.expectEmit(address(vault));
        emit BursarVault.ApproverSet(approverAddr);
        vm.prank(owner);
        vault.setApprover(approverAddr);
        assertEq(vault.approver(), approverAddr);

        vm.prank(owner);
        vault.setApprover(address(0)); // disabling is allowed
        assertEq(vault.approver(), address(0));
    }

    function test_setApprover_revert_notOwner() public {
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, agent));
        vault.setApprover(agent);
    }

    function test_setRequestTTL() public {
        vm.expectEmit(address(vault));
        emit BursarVault.RequestTTLSet(1 days);
        vm.prank(owner);
        vault.setRequestTTL(1 days);
        assertEq(vault.requestTTL(), 1 days);
    }

    function test_setRequestTTL_maxAllowed() public {
        vm.prank(owner);
        vault.setRequestTTL(30 days);
        assertEq(vault.requestTTL(), 30 days);
    }

    function test_setRequestTTL_revert_notOwner() public {
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, agent));
        vault.setRequestTTL(1 days);
    }

    function test_setRequestTTL_revert_zero() public {
        vm.prank(owner);
        vm.expectRevert(BursarVault.InvalidTTL.selector);
        vault.setRequestTTL(0);
    }

    function test_setRequestTTL_revert_aboveMax() public {
        vm.prank(owner);
        vm.expectRevert(BursarVault.InvalidTTL.selector);
        vault.setRequestTTL(30 days + 1);
    }

    // =====================================================================
    // openTask / closeTask
    // =====================================================================

    function test_openTask_reservesAndEmits() public {
        uint64 exp = uint64(block.timestamp + 1 days);
        vm.expectEmit(address(vault));
        emit BursarVault.TaskOpened(TASK2, agent2, 2_000e6, exp);
        _openTask(TASK2, agent2, 2_000e6, exp);

        BursarVault.Task memory t = vault.getTask(TASK2);
        assertEq(t.agent, agent2);
        assertEq(t.expiry, exp);
        assertTrue(t.open);
        assertEq(t.remaining, 2_000e6);
        assertEq(t.spent, 0);
        assertEq(vault.totalReserved(), BUDGET + 2_000e6);
        assertEq(vault.freeBalance(), DEPOSIT - BUDGET - 2_000e6);
        assertEq(vault.agentTaskCount(agent2), 1);
        _assertAccounting();
    }

    function test_openTask_allowedWhilePaused() public {
        vm.prank(owner);
        vault.pause();
        _openTask(TASK2, agent, 1e6, expiry);
        assertTrue(vault.getTask(TASK2).open);
    }

    function test_openTask_exactlyFreeBalance() public {
        _openTask(TASK2, agent, DEPOSIT - BUDGET, expiry);
        assertEq(vault.freeBalance(), 0);
    }

    function test_openTask_revert_notOwner() public {
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, agent));
        vault.openTask(TASK2, agent, 1e6, expiry);
    }

    function test_openTask_revert_zeroId() public {
        vm.prank(owner);
        vm.expectRevert(BursarVault.InvalidTaskId.selector);
        vault.openTask(bytes32(0), agent, 1e6, expiry);
    }

    function test_openTask_revert_zeroAgent() public {
        vm.prank(owner);
        vm.expectRevert(BursarVault.ZeroAddress.selector);
        vault.openTask(TASK2, address(0), 1e6, expiry);
    }

    function test_openTask_revert_unregisteredAgent() public {
        vm.prank(owner);
        vm.expectRevert(BursarVault.AgentInactive.selector);
        vault.openTask(TASK2, stranger, 1e6, expiry);
    }

    function test_openTask_revert_revokedAgent() public {
        vm.startPrank(owner);
        vault.revokeAgent(agent2);
        vm.expectRevert(BursarVault.AgentInactive.selector);
        vault.openTask(TASK2, agent2, 1e6, expiry);
        vm.stopPrank();
    }

    function test_openTask_revert_zeroBudget() public {
        vm.prank(owner);
        vm.expectRevert(BursarVault.ZeroAmount.selector);
        vault.openTask(TASK2, agent, 0, expiry);
    }

    function test_openTask_revert_budgetTooLarge() public {
        vm.prank(owner);
        vm.expectRevert(BursarVault.AmountTooLarge.selector);
        vault.openTask(TASK2, agent, uint256(type(uint128).max) + 1, expiry);
    }

    function test_openTask_revert_expiryNow() public {
        vm.prank(owner);
        vm.expectRevert(BursarVault.InvalidExpiry.selector);
        vault.openTask(TASK2, agent, 1e6, uint64(block.timestamp));
    }

    function test_openTask_revert_expiryPast() public {
        vm.prank(owner);
        vm.expectRevert(BursarVault.InvalidExpiry.selector);
        vault.openTask(TASK2, agent, 1e6, uint64(block.timestamp - 1));
    }

    function test_openTask_revert_exists() public {
        vm.prank(owner);
        vm.expectRevert(BursarVault.TaskExists.selector);
        vault.openTask(TASK, agent, 1e6, expiry);
    }

    function test_openTask_revert_insufficientFree() public {
        vm.prank(owner);
        vm.expectRevert(BursarVault.InsufficientFreeBalance.selector);
        vault.openTask(TASK2, agent, DEPOSIT - BUDGET + 1, expiry);
    }

    function test_closeTask_ownerEarly() public {
        _pay(agent, TASK, recipient, 300e6);
        vm.expectEmit(address(vault));
        emit BursarVault.TaskClosed(TASK, agent, BUDGET - 300e6);
        vm.prank(owner);
        vault.closeTask(TASK);

        BursarVault.Task memory t = vault.getTask(TASK);
        assertFalse(t.open);
        assertEq(t.remaining, 0);
        assertEq(t.spent, 300e6);
        assertEq(vault.totalReserved(), 0);
        assertEq(vault.freeBalance(), DEPOSIT - 300e6);
        _assertAccounting();
    }

    function test_closeTask_anyoneAfterExpiry() public {
        vm.warp(expiry);
        vm.prank(stranger);
        vault.closeTask(TASK);
        assertFalse(vault.getTask(TASK).open);
        assertEq(vault.totalReserved(), 0);
    }

    function test_closeTask_worksWhilePaused() public {
        vm.startPrank(owner);
        vault.pause();
        vault.closeTask(TASK);
        vm.stopPrank();
    }

    function test_closeTask_revert_strangerBeforeExpiry() public {
        vm.warp(expiry - 1);
        vm.prank(stranger);
        vm.expectRevert(BursarVault.TaskNotExpired.selector);
        vault.closeTask(TASK);
    }

    function test_closeTask_revert_agentBeforeExpiry() public {
        vm.prank(agent);
        vm.expectRevert(BursarVault.TaskNotExpired.selector);
        vault.closeTask(TASK);
    }

    function test_closeTask_revert_unknown() public {
        vm.prank(owner);
        vm.expectRevert(BursarVault.TaskNotOpen.selector);
        vault.closeTask(TASK2);
    }

    function test_closeTask_revert_alreadyClosed() public {
        vm.startPrank(owner);
        vault.closeTask(TASK);
        vm.expectRevert(BursarVault.TaskNotOpen.selector);
        vault.closeTask(TASK);
        vm.stopPrank();
    }

    // =====================================================================
    // pay
    // =====================================================================

    function test_pay_direct() public {
        vm.expectEmit(address(vault));
        emit BursarVault.PaymentExecuted(agent, TASK, recipient, 200e6, REASON);
        vm.prank(agent);
        (bool executed, uint256 id) = vault.pay(TASK, recipient, 200e6, REASON);

        assertTrue(executed);
        assertEq(id, 0);
        assertEq(token.balanceOf(recipient), 200e6);
        assertEq(token.balanceOf(address(vault)), DEPOSIT - 200e6);
        assertEq(vault.getTask(TASK).remaining, BUDGET - 200e6);
        assertEq(vault.getTask(TASK).spent, 200e6);
        assertEq(vault.taskRemaining(TASK), BUDGET - 200e6);
        assertEq(vault.totalReserved(), BUDGET - 200e6);
        assertEq(vault.spentToday(agent), 200e6);
        assertEq(vault.remainingDailyAllowance(agent), DAILY - 200e6);
        assertEq(vault.requestCount(), 0);
        _assertAccounting();
    }

    function test_pay_exactlyThresholdIsDirect() public {
        assertEq(_pay(agent, TASK, recipient, THRESHOLD), 0);
        assertEq(token.balanceOf(recipient), THRESHOLD);
    }

    function test_pay_globalAllowlistedRecipient() public {
        vm.prank(owner);
        vault.setGlobalRecipient(outsider, true);
        assertEq(_pay(agent, TASK, outsider, 100e6), 0);
        assertEq(token.balanceOf(outsider), 100e6);
    }

    function test_pay_queuedAboveThreshold() public {
        uint64 exp = uint64(block.timestamp + 3 days);
        vm.expectEmit(address(vault));
        emit BursarVault.PaymentQueued(1, agent, TASK, recipient, THRESHOLD + 1, REASON, BursarVault.QueueCause.Threshold);
        vm.prank(agent);
        (bool executed, uint256 id) = vault.pay(TASK, recipient, THRESHOLD + 1, REASON);

        assertFalse(executed);
        assertEq(id, 1);
        assertEq(vault.requestCount(), 1);
        BursarVault.Request memory r = vault.getRequest(1);
        assertEq(r.agent, agent);
        assertEq(r.recipient, recipient);
        assertEq(r.amount, THRESHOLD + 1);
        assertEq(r.taskId, TASK);
        assertEq(r.reason, REASON);
        assertEq(r.expiresAt, exp);
        assertEq(uint8(r.status), uint8(BursarVault.RequestStatus.Pending));

        // Queuing moves no funds and consumes neither daily allowance nor task budget.
        assertEq(token.balanceOf(recipient), 0);
        assertEq(vault.spentToday(agent), 0);
        assertEq(vault.getTask(TASK).remaining, BUDGET);
        _assertAccounting();
    }

    function test_pay_queuedNonAllowlisted() public {
        vm.expectEmit(address(vault));
        emit BursarVault.PaymentQueued(1, agent, TASK, outsider, 10e6, REASON, BursarVault.QueueCause.Allowlist);
        vm.prank(agent);
        (bool executed,) = vault.pay(TASK, outsider, 10e6, REASON);
        assertFalse(executed);
        assertEq(token.balanceOf(outsider), 0);
    }

    function test_pay_queuedBothCausesReportsAllowlist() public {
        vm.expectEmit(address(vault));
        emit BursarVault.PaymentQueued(1, agent, TASK, outsider, PER_TX, REASON, BursarVault.QueueCause.Allowlist);
        _pay(agent, TASK, outsider, PER_TX);
    }

    function test_pay_thresholdZeroQueuesEverything() public {
        vm.prank(owner);
        vault.setAgent(agent, _policy(PER_TX, DAILY, 0));
        uint256 id = _pay(agent, TASK, recipient, 1);
        assertEq(id, 1);
        assertEq(token.balanceOf(recipient), 0);
    }

    function test_pay_exactlyDailyCap() public {
        _openTask(TASK2, agent, DAILY, expiry);
        vm.prank(owner);
        vault.setAgent(agent, _policy(PER_TX, DAILY, PER_TX));
        for (uint256 i; i < DAILY / PER_TX; ++i) {
            _pay(agent, TASK2, recipient, PER_TX);
        }
        assertEq(vault.spentToday(agent), DAILY);
        assertEq(vault.remainingDailyAllowance(agent), 0);
    }

    function test_pay_revert_paused() public {
        vm.prank(owner);
        vault.pause();
        vm.prank(agent);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        vault.pay(TASK, recipient, 1e6, REASON);
    }

    function test_pay_revert_notAgent() public {
        vm.prank(stranger);
        vm.expectRevert(BursarVault.AgentInactive.selector);
        vault.pay(TASK, recipient, 1e6, REASON);
    }

    function test_pay_revert_revoked() public {
        vm.prank(owner);
        vault.revokeAgent(agent);
        vm.prank(agent);
        vm.expectRevert(BursarVault.AgentInactive.selector);
        vault.pay(TASK, recipient, 1e6, REASON);
    }

    function test_pay_revert_zeroRecipient() public {
        vm.prank(agent);
        vm.expectRevert(BursarVault.ZeroAddress.selector);
        vault.pay(TASK, address(0), 1e6, REASON);
    }

    function test_pay_revert_vaultAsRecipient() public {
        vm.prank(agent);
        vm.expectRevert(BursarVault.InvalidRecipient.selector);
        vault.pay(TASK, address(vault), 1e6, REASON);
    }

    function test_pay_revert_zeroAmount() public {
        vm.prank(agent);
        vm.expectRevert(BursarVault.ZeroAmount.selector);
        vault.pay(TASK, recipient, 0, REASON);
    }

    // ---------------------------------------------------------------- limit violations are logged, not reverted

    function test_pay_blocked_aboveperTxCap() public {
        _expectBlocked(agent, TASK, recipient, PER_TX + 1, BursarVault.BlockCause.PerTxCap);
    }

    function test_pay_blocked_hugeAmountIsLoggedNotTruncated() public {
        // Far above uint128: must be blocked by the per-tx check before any uint128 cast.
        _expectBlocked(agent, TASK, recipient, type(uint256).max, BursarVault.BlockCause.PerTxCap);
    }

    function test_pay_overCapOnInvalidTaskReverts() public {
        // The task is validated before any limit: an over-cap attempt on a task the agent doesn't own, or one
        // that is unknown, expired or closed, reverts and is never logged as PaymentBlocked.
        vm.recordLogs();
        vm.prank(agent);
        vm.expectRevert(BursarVault.TaskNotOpen.selector);
        vault.pay(TASK2, recipient, PER_TX + 1, REASON); // unknown task

        _openTask(TASK2, agent2, 100e6, expiry);
        vm.prank(agent);
        vm.expectRevert(BursarVault.TaskAgentMismatch.selector);
        vault.pay(TASK2, recipient, PER_TX + 1, REASON); // another agent's task

        vm.warp(expiry);
        vm.prank(agent);
        vm.expectRevert(BursarVault.TaskExpired.selector);
        vault.pay(TASK, recipient, PER_TX + 1, REASON); // expired task

        vm.warp(START);
        vm.prank(owner);
        vault.closeTask(TASK);
        vm.prank(agent);
        vm.expectRevert(BursarVault.TaskNotOpen.selector);
        vault.pay(TASK, recipient, type(uint256).max, REASON); // closed task, huge amount

        bytes32 blockedTopic = BursarVault.PaymentBlocked.selector;
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i; i < logs.length; ++i) {
            assertTrue(logs[i].topics[0] != blockedTopic, "no PaymentBlocked for an invalid task");
        }
    }

    function test_pay_blocked_aboveThresholdAndOverCapIsNotQueued() public {
        // Over the per-tx cap AND above the approval threshold AND not allowlisted: blocked, never queued.
        _expectBlocked(agent, TASK, outsider, PER_TX + 1, BursarVault.BlockCause.PerTxCap);
        assertEq(vault.requestCount(), 0);
    }

    function test_pay_blocked_doesNotConsumeDailyCapOrBudget() public {
        vm.prank(owner);
        vault.setAgent(agent, _policy(PER_TX, DAILY, PER_TX));
        for (uint256 i; i < 4; ++i) {
            _pay(agent, TASK, recipient, PER_TX); // 4,000 of 5,000 used
        }
        _expectBlocked(agent, TASK, recipient, PER_TX + 1, BursarVault.BlockCause.PerTxCap);
        _expectBlocked(agent, TASK, recipient, PER_TX + 1, BursarVault.BlockCause.PerTxCap);
        // The blocked attempts used nothing: the full remaining 1,000 is still spendable today.
        assertEq(vault.remainingDailyAllowance(agent), PER_TX);
        vm.prank(agent);
        (bool executed,) = vault.pay(TASK, recipient, PER_TX, REASON);
        assertTrue(executed);
        assertEq(vault.spentToday(agent), DAILY);
        _assertAccounting();
    }

    function test_pay_blocked_stillRevertsOnNonLimitErrors() public {
        // Only the three limit checks were softened; everything else still reverts.
        vm.prank(stranger);
        vm.expectRevert(BursarVault.AgentInactive.selector);
        vault.pay(TASK, recipient, PER_TX + 1, REASON);
        vm.prank(owner);
        vault.pause();
        vm.prank(agent);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        vault.pay(TASK, recipient, PER_TX + 1, REASON);
    }

    function test_pay_revert_unknownTask() public {
        vm.prank(agent);
        vm.expectRevert(BursarVault.TaskNotOpen.selector);
        vault.pay(TASK2, recipient, 1e6, REASON);
    }

    function test_pay_revert_otherAgentsTask() public {
        vm.prank(agent2);
        vm.expectRevert(BursarVault.TaskAgentMismatch.selector);
        vault.pay(TASK, recipient, 1e6, REASON);
    }

    function test_pay_revert_taskExpired() public {
        vm.warp(expiry);
        vm.prank(agent);
        vm.expectRevert(BursarVault.TaskExpired.selector);
        vault.pay(TASK, recipient, 1e6, REASON);
    }

    function test_pay_blocked_exceedsTaskBudget() public {
        _openTask(TASK2, agent, 100e6, expiry);
        _expectBlocked(agent, TASK2, recipient, 100e6 + 1, BursarVault.BlockCause.TaskBudget);
        _assertAccounting();
    }

    function test_pay_blocked_exceedsDailyCap() public {
        vm.prank(owner);
        vault.setAgent(agent, _policy(PER_TX, DAILY, PER_TX));
        for (uint256 i; i < 5; ++i) {
            _pay(agent, TASK, recipient, PER_TX);
        }
        _expectBlocked(agent, TASK, recipient, 1, BursarVault.BlockCause.DailyCap);
        _assertAccounting();
    }

    function test_pay_dailyCapOnlyBlocksTheDirectPath() public {
        // Unchanged rule: a payment that would be queued is queued even when today's cap is used up.
        vm.prank(owner);
        vault.setAgent(agent, _policy(PER_TX, DAILY, THRESHOLD));
        for (uint256 i; i < 10; ++i) {
            _pay(agent, TASK, recipient, THRESHOLD); // 10 x 500 = daily cap
        }
        assertEq(vault.remainingDailyAllowance(agent), 0);
        uint256 id = _pay(agent, TASK, recipient, THRESHOLD + 1); // above threshold -> queued, not blocked
        assertEq(id, 1);
        _expectBlocked(agent, TASK, recipient, 1, BursarVault.BlockCause.DailyCap);
    }

    // =====================================================================
    // approveRequest / rejectRequest
    // =====================================================================

    function test_approveRequest_executes() public {
        uint256 id = _pay(agent, TASK, outsider, PER_TX);
        vm.expectEmit(address(vault));
        emit BursarVault.RequestApproved(id, agent, TASK, outsider, PER_TX, REASON);
        vm.prank(owner);
        vault.approveRequest(id);

        assertEq(token.balanceOf(outsider), PER_TX);
        assertEq(uint8(vault.getRequest(id).status), uint8(BursarVault.RequestStatus.Executed));
        assertEq(vault.getTask(TASK).remaining, BUDGET - PER_TX);
        assertEq(vault.getTask(TASK).spent, PER_TX);
        assertEq(vault.spentToday(agent), 0); // approvals never count against the daily cap
        _assertAccounting();
    }

    function test_approveRequest_bypassesDailyCap() public {
        vm.prank(owner);
        vault.setAgent(agent, _policy(PER_TX, DAILY, PER_TX));
        for (uint256 i; i < 5; ++i) {
            _pay(agent, TASK, recipient, PER_TX); // exhaust daily cap
        }
        uint256 id = _pay(agent, TASK, outsider, PER_TX); // queued (allowlist)
        vm.prank(owner);
        vault.approveRequest(id);
        assertEq(token.balanceOf(outsider), PER_TX);
        assertEq(vault.spentToday(agent), DAILY);
    }

    function test_approveRequest_ignoresLaterPerTxCapChange() public {
        uint256 id = _pay(agent, TASK, outsider, PER_TX);
        vm.prank(owner);
        vault.setAgent(agent, _policy(10e6, DAILY, 10e6)); // cap lowered after queueing
        vm.prank(owner);
        vault.approveRequest(id); // explicit owner override
        assertEq(token.balanceOf(outsider), PER_TX);
    }

    function test_approveRequest_revert_notOwner() public {
        uint256 id = _pay(agent, TASK, outsider, 1e6);
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, agent));
        vault.approveRequest(id);
    }

    function test_approveRequest_revert_paused() public {
        uint256 id = _pay(agent, TASK, outsider, 1e6);
        vm.startPrank(owner);
        vault.pause();
        vm.expectRevert(Pausable.EnforcedPause.selector);
        vault.approveRequest(id);
        vm.stopPrank();
    }

    function test_approveRequest_revert_unknownId() public {
        vm.prank(owner);
        vm.expectRevert(BursarVault.RequestNotPending.selector);
        vault.approveRequest(42);
    }

    function test_approveRequest_revert_alreadyExecuted() public {
        uint256 id = _pay(agent, TASK, outsider, 1e6);
        vm.startPrank(owner);
        vault.approveRequest(id);
        vm.expectRevert(BursarVault.RequestNotPending.selector);
        vault.approveRequest(id);
        vm.stopPrank();
    }

    function test_approveRequest_revert_rejected() public {
        uint256 id = _pay(agent, TASK, outsider, 1e6);
        vm.startPrank(owner);
        vault.rejectRequest(id);
        vm.expectRevert(BursarVault.RequestNotPending.selector);
        vault.approveRequest(id);
        vm.stopPrank();
    }

    function test_approveRequest_revert_expired() public {
        uint256 id = _pay(agent, TASK, outsider, 1e6);
        vm.warp(block.timestamp + 3 days);
        assertTrue(vault.isRequestExpired(id));
        vm.prank(owner);
        vm.expectRevert(BursarVault.RequestExpired.selector);
        vault.approveRequest(id);
    }

    function test_approveRequest_revert_agentRevoked() public {
        uint256 id = _pay(agent, TASK, outsider, 1e6);
        vm.startPrank(owner);
        vault.revokeAgent(agent);
        vm.expectRevert(BursarVault.AgentInactive.selector);
        vault.approveRequest(id);
        vm.stopPrank();
    }

    function test_approveRequest_revert_taskClosed() public {
        uint256 id = _pay(agent, TASK, outsider, 1e6);
        vm.startPrank(owner);
        vault.closeTask(TASK);
        vm.expectRevert(BursarVault.TaskNotOpen.selector);
        vault.approveRequest(id);
        vm.stopPrank();
    }

    function test_approveRequest_revert_taskExpired() public {
        _openTask(TASK2, agent, 1_000e6, uint64(block.timestamp + 1 days));
        uint256 id = _pay(agent, TASK2, outsider, 1e6); // request lives 3 days, task only 1
        vm.warp(block.timestamp + 1 days);
        vm.prank(owner);
        vm.expectRevert(BursarVault.TaskExpired.selector);
        vault.approveRequest(id);
    }

    function test_approveRequest_revert_exceedsTaskBudget() public {
        _openTask(TASK2, agent, 1_000e6, expiry);
        uint256 id1 = _pay(agent, TASK2, outsider, 800e6);
        uint256 id2 = _pay(agent, TASK2, outsider, 800e6); // both fit individually
        vm.startPrank(owner);
        vault.approveRequest(id1);
        vm.expectRevert(BursarVault.ExceedsTaskBudget.selector);
        vault.approveRequest(id2);
        vm.stopPrank();
    }

    function test_rejectRequest() public {
        uint256 id = _pay(agent, TASK, outsider, 1e6);
        vm.expectEmit(address(vault));
        emit BursarVault.RequestRejected(id, agent, TASK, outsider, 1e6, REASON);
        vm.prank(owner);
        vault.rejectRequest(id);
        assertEq(uint8(vault.getRequest(id).status), uint8(BursarVault.RequestStatus.Rejected));
        assertEq(token.balanceOf(outsider), 0);
        assertFalse(vault.isRequestExpired(id));
    }

    function test_rejectRequest_expiredAndWhilePaused() public {
        uint256 id = _pay(agent, TASK, outsider, 1e6);
        vm.warp(block.timestamp + 4 days);
        vm.startPrank(owner);
        vault.pause();
        vault.rejectRequest(id);
        vm.stopPrank();
        assertEq(uint8(vault.getRequest(id).status), uint8(BursarVault.RequestStatus.Rejected));
    }

    function test_rejectRequest_revert_notOwner() public {
        uint256 id = _pay(agent, TASK, outsider, 1e6);
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, agent));
        vault.rejectRequest(id);
    }

    function test_rejectRequest_revert_notPending() public {
        vm.prank(owner);
        vm.expectRevert(BursarVault.RequestNotPending.selector);
        vault.rejectRequest(1);
    }

    function test_requestUsesTTLAtQueueTime() public {
        vm.prank(owner);
        vault.setRequestTTL(1 hours);
        uint256 id = _pay(agent, TASK, outsider, 1e6);
        assertEq(vault.getRequest(id).expiresAt, block.timestamp + 1 hours);
    }

    // =====================================================================
    // Escrow
    // =====================================================================

    function test_createEscrow() public {
        uint64 dl = uint64(block.timestamp + 1 days);
        vm.expectEmit(address(vault));
        emit BursarVault.EscrowCreated(1, agent, TASK, outsider, PER_TX, dl, REASON);
        uint256 id = _escrow(agent, TASK, outsider, PER_TX, dl);

        assertEq(id, 1);
        assertEq(vault.escrowCount(), 1);
        BursarVault.Escrow memory e = vault.getEscrow(id);
        assertEq(e.agent, agent);
        assertEq(e.payee, outsider);
        assertEq(e.amount, PER_TX);
        assertEq(e.deadline, dl);
        assertEq(e.taskId, TASK);
        assertEq(e.reason, REASON);
        assertEq(uint8(e.status), uint8(BursarVault.EscrowStatus.Locked));

        // Non-allowlisted payee and above threshold are fine; caps and budget are charged.
        assertEq(vault.getTask(TASK).remaining, BUDGET - PER_TX);
        assertEq(vault.getTask(TASK).spent, PER_TX);
        assertEq(vault.totalReserved(), BUDGET); // moved from task to escrow
        assertEq(vault.spentToday(agent), PER_TX);
        assertEq(token.balanceOf(address(vault)), DEPOSIT);
        _assertAccounting();
    }

    function test_createEscrow_deadlineEqualsTaskExpiry() public {
        _escrow(agent, TASK, outsider, 1e6, expiry);
        assertEq(vault.getEscrow(1).deadline, expiry);
    }

    function test_createEscrow_revert_paused() public {
        vm.prank(owner);
        vault.pause();
        vm.prank(agent);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        vault.createEscrow(TASK, outsider, 1e6, expiry, REASON);
    }

    function test_createEscrow_revert_notAgent() public {
        vm.prank(stranger);
        vm.expectRevert(BursarVault.AgentInactive.selector);
        vault.createEscrow(TASK, outsider, 1e6, expiry, REASON);
    }

    function test_createEscrow_revert_zeroPayee() public {
        vm.prank(agent);
        vm.expectRevert(BursarVault.ZeroAddress.selector);
        vault.createEscrow(TASK, address(0), 1e6, expiry, REASON);
    }

    function test_createEscrow_revert_vaultPayee() public {
        vm.prank(agent);
        vm.expectRevert(BursarVault.InvalidRecipient.selector);
        vault.createEscrow(TASK, address(vault), 1e6, expiry, REASON);
    }

    function test_createEscrow_revert_zeroAmount() public {
        vm.prank(agent);
        vm.expectRevert(BursarVault.ZeroAmount.selector);
        vault.createEscrow(TASK, outsider, 0, expiry, REASON);
    }

    function test_createEscrow_revert_perTxCap() public {
        vm.prank(agent);
        vm.expectRevert(BursarVault.ExceedsPerTxCap.selector);
        vault.createEscrow(TASK, outsider, PER_TX + 1, expiry, REASON);
    }

    function test_createEscrow_revert_taskNotOpen() public {
        vm.prank(agent);
        vm.expectRevert(BursarVault.TaskNotOpen.selector);
        vault.createEscrow(TASK2, outsider, 1e6, expiry, REASON);
    }

    function test_createEscrow_revert_otherAgentsTask() public {
        vm.prank(agent2);
        vm.expectRevert(BursarVault.TaskAgentMismatch.selector);
        vault.createEscrow(TASK, outsider, 1e6, expiry, REASON);
    }

    function test_createEscrow_revert_taskExpired() public {
        vm.warp(expiry);
        vm.prank(agent);
        vm.expectRevert(BursarVault.TaskExpired.selector);
        vault.createEscrow(TASK, outsider, 1e6, expiry + 1, REASON);
    }

    function test_createEscrow_revert_taskBudget() public {
        _openTask(TASK2, agent, 10e6, expiry);
        vm.prank(agent);
        vm.expectRevert(BursarVault.ExceedsTaskBudget.selector);
        vault.createEscrow(TASK2, outsider, 10e6 + 1, expiry, REASON);
    }

    function test_createEscrow_revert_deadlineNow() public {
        vm.prank(agent);
        vm.expectRevert(BursarVault.InvalidDeadline.selector);
        vault.createEscrow(TASK, outsider, 1e6, uint64(block.timestamp), REASON);
    }

    function test_createEscrow_revert_deadlineAfterTaskExpiry() public {
        vm.prank(agent);
        vm.expectRevert(BursarVault.InvalidDeadline.selector);
        vault.createEscrow(TASK, outsider, 1e6, expiry + 1, REASON);
    }

    function test_createEscrow_revert_dailyCap() public {
        vm.prank(owner);
        vault.setAgent(agent, _policy(PER_TX, DAILY, PER_TX));
        for (uint256 i; i < 4; ++i) {
            _pay(agent, TASK, recipient, PER_TX);
        }
        _escrow(agent, TASK, outsider, PER_TX, expiry); // pays + escrows share the cap
        vm.prank(agent);
        vm.expectRevert(BursarVault.ExceedsDailyCap.selector);
        vault.createEscrow(TASK, outsider, 1, expiry, REASON);
    }

    function test_releaseEscrow_byOwner() public {
        uint256 id = _escrow(agent, TASK, outsider, 300e6, expiry);
        vm.expectEmit(address(vault));
        emit BursarVault.EscrowReleased(id, agent, TASK, outsider, 300e6, REASON);
        vm.prank(owner);
        vault.releaseEscrow(id);

        assertEq(token.balanceOf(outsider), 300e6);
        assertEq(uint8(vault.getEscrow(id).status), uint8(BursarVault.EscrowStatus.Released));
        assertEq(vault.totalReserved(), BUDGET - 300e6);
        _assertAccounting();
    }

    function test_releaseEscrow_byApprover() public {
        vm.prank(owner);
        vault.setApprover(approverAddr);
        uint256 id = _escrow(agent, TASK, outsider, 300e6, expiry);
        vm.prank(approverAddr);
        vault.releaseEscrow(id);
        assertEq(token.balanceOf(outsider), 300e6);
    }

    function test_releaseEscrow_afterDeadlineBeforeRefund() public {
        uint256 id = _escrow(agent, TASK, outsider, 300e6, uint64(block.timestamp + 1 hours));
        vm.warp(block.timestamp + 2 hours);
        vm.prank(owner);
        vault.releaseEscrow(id);
        assertEq(token.balanceOf(outsider), 300e6);
    }

    function test_releaseEscrow_afterTaskClosed() public {
        uint256 id = _escrow(agent, TASK, outsider, 300e6, expiry);
        vm.startPrank(owner);
        vault.closeTask(TASK); // escrow is independent of the task
        vault.releaseEscrow(id);
        vm.stopPrank();
        assertEq(token.balanceOf(outsider), 300e6);
        _assertAccounting();
    }

    function test_releaseEscrow_revert_stranger() public {
        uint256 id = _escrow(agent, TASK, outsider, 1e6, expiry);
        vm.prank(stranger);
        vm.expectRevert(BursarVault.NotOwnerOrApprover.selector);
        vault.releaseEscrow(id);
    }

    function test_releaseEscrow_revert_agentCannotReleaseOwnEscrow() public {
        uint256 id = _escrow(agent, TASK, outsider, 1e6, expiry);
        vm.prank(agent);
        vm.expectRevert(BursarVault.NotOwnerOrApprover.selector);
        vault.releaseEscrow(id);
    }

    function test_releaseEscrow_revert_formerApprover() public {
        vm.prank(owner);
        vault.setApprover(approverAddr);
        uint256 id = _escrow(agent, TASK, outsider, 1e6, expiry);
        vm.prank(owner);
        vault.setApprover(address(0));
        vm.prank(approverAddr);
        vm.expectRevert(BursarVault.NotOwnerOrApprover.selector);
        vault.releaseEscrow(id);
    }

    function test_releaseEscrow_revert_paused() public {
        uint256 id = _escrow(agent, TASK, outsider, 1e6, expiry);
        vm.startPrank(owner);
        vault.pause();
        vm.expectRevert(Pausable.EnforcedPause.selector);
        vault.releaseEscrow(id);
        vm.stopPrank();
    }

    function test_releaseEscrow_revert_unknown() public {
        vm.prank(owner);
        vm.expectRevert(BursarVault.EscrowNotLocked.selector);
        vault.releaseEscrow(7);
    }

    function test_releaseEscrow_revert_twice() public {
        uint256 id = _escrow(agent, TASK, outsider, 1e6, expiry);
        vm.startPrank(owner);
        vault.releaseEscrow(id);
        vm.expectRevert(BursarVault.EscrowNotLocked.selector);
        vault.releaseEscrow(id);
        vm.stopPrank();
    }

    function test_releaseEscrow_revert_afterRefund() public {
        uint64 dl = uint64(block.timestamp + 1 hours);
        uint256 id = _escrow(agent, TASK, outsider, 1e6, dl);
        vm.warp(dl);
        vault.refundEscrow(id);
        vm.prank(owner);
        vm.expectRevert(BursarVault.EscrowNotLocked.selector);
        vault.releaseEscrow(id);
    }

    function test_refundEscrow_anyoneAfterDeadline() public {
        uint64 dl = uint64(block.timestamp + 1 hours);
        uint256 id = _escrow(agent, TASK, outsider, 400e6, dl);
        uint256 freeBefore = vault.freeBalance();
        vm.warp(dl);
        vm.expectEmit(address(vault));
        emit BursarVault.EscrowRefunded(id, agent, TASK, outsider, 400e6, REASON);
        vm.prank(stranger);
        vault.refundEscrow(id);

        assertEq(uint8(vault.getEscrow(id).status), uint8(BursarVault.EscrowStatus.Refunded));
        assertEq(vault.freeBalance(), freeBefore + 400e6); // back to free, not to the task
        assertEq(vault.getTask(TASK).remaining, BUDGET - 400e6);
        assertEq(token.balanceOf(outsider), 0);
        _assertAccounting();
    }

    function test_refundEscrow_worksWhilePaused() public {
        uint64 dl = uint64(block.timestamp + 1 hours);
        uint256 id = _escrow(agent, TASK, outsider, 1e6, dl);
        vm.prank(owner);
        vault.pause();
        vm.warp(dl);
        vault.refundEscrow(id);
    }

    function test_refundEscrow_revert_beforeDeadline() public {
        uint64 dl = uint64(block.timestamp + 1 hours);
        uint256 id = _escrow(agent, TASK, outsider, 1e6, dl);
        vm.warp(dl - 1);
        vm.prank(owner);
        vm.expectRevert(BursarVault.DeadlineNotReached.selector);
        vault.refundEscrow(id);
    }

    function test_refundEscrow_revert_notLocked() public {
        vm.expectRevert(BursarVault.EscrowNotLocked.selector);
        vault.refundEscrow(1);
    }

    function test_refundEscrow_revert_afterRelease() public {
        uint256 id = _escrow(agent, TASK, outsider, 1e6, uint64(block.timestamp + 1 hours));
        vm.prank(owner);
        vault.releaseEscrow(id);
        vm.warp(block.timestamp + 2 hours);
        vm.expectRevert(BursarVault.EscrowNotLocked.selector);
        vault.refundEscrow(id);
    }

    // =====================================================================
    // Views
    // =====================================================================

    function test_freeBalance_neverUnderflows() public {
        deal(address(token), address(vault), BUDGET - 1); // balance somehow below reserved (e.g. token seizure)
        assertEq(vault.freeBalance(), 0);
    }

    function test_remainingDailyAllowance_inactiveIsZero() public {
        vm.prank(owner);
        vault.revokeAgent(agent);
        assertEq(vault.remainingDailyAllowance(agent), 0);
        assertEq(vault.remainingDailyAllowance(stranger), 0);
    }

    function test_spentToday_resetsNextDay() public {
        _pay(agent, TASK, recipient, 100e6);
        assertEq(vault.spentToday(agent), 100e6);
        vm.warp((block.timestamp / 1 days + 1) * 1 days); // next UTC midnight
        assertEq(vault.spentToday(agent), 0);
        assertEq(vault.remainingDailyAllowance(agent), DAILY);
    }

    function test_taskRemaining_zeroWhenClosedOrExpired() public {
        assertEq(vault.taskRemaining(TASK), BUDGET);
        vm.warp(expiry);
        assertEq(vault.taskRemaining(TASK), 0);
        vm.warp(START);
        vm.prank(owner);
        vault.closeTask(TASK);
        assertEq(vault.taskRemaining(TASK), 0);
        assertEq(vault.taskRemaining(TASK2), 0);
    }

    function test_getAgentTasks_pagination() public {
        _openTask(TASK2, agent, 1e6, expiry);
        _openTask(keccak256("task-3"), agent, 1e6, expiry);
        vm.prank(owner);
        vault.closeTask(TASK2);

        assertEq(vault.agentTaskCount(agent), 3);
        (bytes32[] memory ids, BursarVault.Task[] memory tasks) = vault.getAgentTasks(agent, 0, 10);
        assertEq(ids.length, 3);
        assertEq(ids[0], TASK);
        assertEq(ids[1], TASK2);
        assertTrue(tasks[0].open);
        assertFalse(tasks[1].open);
        assertTrue(tasks[2].open);

        (ids,) = vault.getAgentTasks(agent, 1, 1);
        assertEq(ids.length, 1);
        assertEq(ids[0], TASK2);

        (ids,) = vault.getAgentTasks(agent, 3, 5);
        assertEq(ids.length, 0);
        (ids,) = vault.getAgentTasks(agent2, 0, 5);
        assertEq(ids.length, 0);
    }

    function test_getRequests_pagination() public {
        _pay(agent, TASK, outsider, 1e6);
        _pay(agent, TASK, outsider, 2e6);
        _pay(agent, TASK, outsider, 3e6);

        BursarVault.Request[] memory rs = vault.getRequests(0, 10); // 0 treated as 1
        assertEq(rs.length, 3);
        assertEq(rs[0].amount, 1e6);
        assertEq(rs[2].amount, 3e6);

        rs = vault.getRequests(2, 1);
        assertEq(rs.length, 1);
        assertEq(rs[0].amount, 2e6);

        rs = vault.getRequests(4, 10);
        assertEq(rs.length, 0);
    }

    function test_getEscrows_pagination() public {
        _escrow(agent, TASK, outsider, 1e6, expiry);
        _escrow(agent, TASK, outsider, 2e6, expiry);

        BursarVault.Escrow[] memory es = vault.getEscrows(0, 10);
        assertEq(es.length, 2);
        assertEq(es[1].amount, 2e6);

        es = vault.getEscrows(2, 10);
        assertEq(es.length, 1);
        es = vault.getEscrows(3, 10);
        assertEq(es.length, 0);
    }

    function test_isRequestExpired() public {
        uint256 id = _pay(agent, TASK, outsider, 1e6);
        assertFalse(vault.isRequestExpired(id));
        vm.warp(block.timestamp + 3 days - 1);
        assertFalse(vault.isRequestExpired(id));
        vm.warp(block.timestamp + 1);
        assertTrue(vault.isRequestExpired(id));
        assertFalse(vault.isRequestExpired(99));
    }
}
