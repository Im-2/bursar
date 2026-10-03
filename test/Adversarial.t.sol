// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {BursarVault} from "../src/BursarVault.sol";
import {BaseTest} from "./BaseTest.sol";
import {ReentrantToken, BlocklistToken} from "./mocks/TestTokens.sol";

/// @notice Attempts by a malicious agent, a careless/malicious owner, and malicious recipients/tokens.
contract AdversarialTest is BaseTest {
    // =====================================================================
    // Malicious agent
    // =====================================================================

    function test_agent_splittingPaymentsStillHitsDailyCap() public {
        // Agent wants to move 6,000 but perTxCap is 1,000 and dailyCap 5,000: splitting stops at the daily cap,
        // and the refused attempt is logged (PaymentBlocked) instead of reverting.
        vm.prank(owner);
        vault.setAgent(agent, _policy(PER_TX, DAILY, PER_TX));
        uint256 paid;
        for (uint256 i; i < 50; ++i) {
            if (paid + 120e6 > DAILY) {
                _expectBlocked(agent, TASK, recipient, 120e6, BursarVault.BlockCause.DailyCap);
                break;
            }
            vm.prank(agent);
            (bool executed,) = vault.pay(TASK, recipient, 120e6, REASON);
            assertTrue(executed);
            paid += 120e6;
        }
        assertLe(paid, DAILY);
        assertEq(token.balanceOf(recipient), paid);
        assertEq(vault.spentToday(agent), paid);
    }

    function test_agent_splittingAcrossPayAndEscrowSharesCap() public {
        vm.prank(owner);
        vault.setAgent(agent, _policy(PER_TX, DAILY, PER_TX));
        for (uint256 i; i < 3; ++i) {
            _pay(agent, TASK, recipient, PER_TX);
        }
        _escrow(agent, TASK, outsider, PER_TX, expiry);
        _escrow(agent, TASK, outsider, PER_TX, expiry);
        // createEscrow still reverts on the cap; pay logs the attempt instead.
        vm.prank(agent);
        vm.expectRevert(BursarVault.ExceedsDailyCap.selector);
        vault.createEscrow(TASK, outsider, 1, expiry, REASON);
        _expectBlocked(agent, TASK, recipient, 1, BursarVault.BlockCause.DailyCap);
    }

    function test_agent_cannotUseAnotherAgentsTask() public {
        vm.startPrank(agent2);
        vm.expectRevert(BursarVault.TaskAgentMismatch.selector);
        vault.pay(TASK, recipient, 1e6, REASON);
        vm.expectRevert(BursarVault.TaskAgentMismatch.selector);
        vault.createEscrow(TASK, recipient, 1e6, expiry, REASON);
        vm.stopPrank();
    }

    function test_agent_cannotSpendAfterRevoke() public {
        vm.prank(owner);
        vault.revokeAgent(agent);
        vm.startPrank(agent);
        vm.expectRevert(BursarVault.AgentInactive.selector);
        vault.pay(TASK, recipient, 1e6, REASON);
        vm.expectRevert(BursarVault.AgentInactive.selector);
        vault.createEscrow(TASK, recipient, 1e6, expiry, REASON);
        vm.stopPrank();
    }

    function test_agent_cannotSpendAfterExpiry() public {
        vm.warp(expiry);
        vm.startPrank(agent);
        vm.expectRevert(BursarVault.TaskExpired.selector);
        vault.pay(TASK, recipient, 1e6, REASON);
        vm.expectRevert(BursarVault.TaskExpired.selector);
        vault.createEscrow(TASK, recipient, 1e6, expiry + 1, REASON);
        vm.stopPrank();
    }

    function test_agent_cannotSpendWhilePaused() public {
        vm.prank(owner);
        vault.pause();
        vm.startPrank(agent);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        vault.pay(TASK, recipient, 1e6, REASON);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        vault.createEscrow(TASK, recipient, 1e6, expiry, REASON);
        vm.stopPrank();
    }

    function test_agent_cannotReuseClosedTaskId() public {
        vm.prank(owner);
        vault.closeTask(TASK);
        // Agent cannot spend on it...
        vm.prank(agent);
        vm.expectRevert(BursarVault.TaskNotOpen.selector);
        vault.pay(TASK, recipient, 1e6, REASON);
        // ...and nobody can resurrect the id with a fresh budget.
        vm.prank(owner);
        vm.expectRevert(BursarVault.TaskExists.selector);
        vault.openTask(TASK, agent, 1e6, expiry);
    }

    function test_agent_payingItselfIsQueued() public {
        uint256 id = _pay(agent, TASK, agent, 1e6);
        assertGt(id, 0);
        assertEq(token.balanceOf(agent), 0);
    }

    function test_agent_cannotUseOwnerPowers() public {
        uint256 reqId = _pay(agent, TASK, outsider, 1e6);
        uint256 escId = _escrow(agent, TASK, agent, 1e6, expiry); // escrow to itself
        bytes memory unauthorized = abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, agent);

        vm.startPrank(agent);
        vm.expectRevert(unauthorized);
        vault.approveRequest(reqId);
        vm.expectRevert(unauthorized);
        vault.withdraw(agent, 1);
        vm.expectRevert(unauthorized);
        vault.setAgent(agent, _policy(DAILY, DAILY, DAILY));
        vm.expectRevert(unauthorized);
        vault.setAgentRecipient(agent, agent, true);
        vm.expectRevert(unauthorized);
        vault.openTask(TASK2, agent, 1e6, expiry);
        vm.expectRevert(unauthorized);
        vault.unpause();
        vm.expectRevert(BursarVault.NotOwnerOrApprover.selector);
        vault.releaseEscrow(escId);
        vm.expectRevert(BursarVault.TaskNotExpired.selector);
        vault.closeTask(TASK);
        vm.expectRevert(BursarVault.DeadlineNotReached.selector);
        vault.refundEscrow(escId);
        vm.stopPrank();
        assertEq(token.balanceOf(agent), 0);
    }

    function test_agent_queueSpamLocksNoFunds() public {
        uint256 freeBefore = vault.freeBalance();
        for (uint256 i; i < 30; ++i) {
            _pay(agent, TASK, outsider, PER_TX);
        }
        assertEq(vault.requestCount(), 30);
        assertEq(vault.freeBalance(), freeBefore);
        assertEq(vault.totalReserved(), BUDGET);
        assertEq(vault.getTask(TASK).remaining, BUDGET);
        _assertAccounting();
    }

    // =====================================================================
    // Owner mistakes / overreach
    // =====================================================================

    function test_owner_cannotWithdrawReservedFunds() public {
        vm.prank(owner);
        vm.expectRevert(BursarVault.InsufficientFreeBalance.selector);
        vault.withdraw(owner, DEPOSIT);
    }

    function test_owner_cannotWithdrawEscrowedFundsEvenAfterClosingTask() public {
        _escrow(agent, TASK, outsider, PER_TX, expiry);
        vm.startPrank(owner);
        vault.closeTask(TASK);
        assertEq(vault.totalReserved(), PER_TX); // escrow still locked
        vault.withdraw(owner, vault.freeBalance());
        vm.expectRevert(BursarVault.InsufficientFreeBalance.selector);
        vault.withdraw(owner, 1);
        vm.stopPrank();
        assertEq(token.balanceOf(address(vault)), PER_TX);
        _assertAccounting();
    }

    function test_owner_cannotRefundEscrowBeforeDeadline() public {
        uint256 id = _escrow(agent, TASK, outsider, PER_TX, expiry);
        vm.prank(owner);
        vm.expectRevert(BursarVault.DeadlineNotReached.selector);
        vault.refundEscrow(id);
    }

    function test_owner_cannotApproveExpiredRequest() public {
        uint256 id = _pay(agent, TASK, outsider, 1e6);
        vm.warp(block.timestamp + 3 days);
        vm.prank(owner);
        vm.expectRevert(BursarVault.RequestExpired.selector);
        vault.approveRequest(id);
    }

    function test_owner_cannotApproveAfterTaskClosed() public {
        uint256 id = _pay(agent, TASK, outsider, 1e6);
        vm.startPrank(owner);
        vault.closeTask(TASK);
        vm.expectRevert(BursarVault.TaskNotOpen.selector);
        vault.approveRequest(id);
        vm.stopPrank();
    }

    function test_owner_cannotApproveBeyondTaskBudget() public {
        _openTask(TASK2, agent, PER_TX, expiry);
        uint256 a = _pay(agent, TASK2, outsider, PER_TX);
        uint256 b = _pay(agent, TASK2, outsider, PER_TX);
        vm.startPrank(owner);
        vault.approveRequest(a);
        vm.expectRevert(BursarVault.ExceedsTaskBudget.selector);
        vault.approveRequest(b);
        vm.stopPrank();
    }

    function test_owner_canFindAndCloseRevokedAgentsOpenTasks() public {
        _openTask(TASK2, agent, 500e6, expiry);
        vm.prank(owner);
        vault.revokeAgent(agent);

        (bytes32[] memory ids, BursarVault.Task[] memory tasks) = vault.getAgentTasks(agent, 0, 50);
        vm.startPrank(owner);
        for (uint256 i; i < ids.length; ++i) {
            if (tasks[i].open) vault.closeTask(ids[i]);
        }
        vm.stopPrank();
        assertEq(vault.totalReserved(), 0);
        assertEq(vault.freeBalance(), DEPOSIT);
    }

    // =====================================================================
    // Scripted scenario: accounting checked after every step
    // =====================================================================

    function test_scenario_accountingHoldsAfterEveryStep() public {
        vm.prank(owner);
        vault.setApprover(approverAddr);
        _assertAccounting();

        _openTask(TASK2, agent2, 3_000e6, expiry);
        _assertAccounting();

        _pay(agent, TASK, recipient, 400e6); // direct
        _assertAccounting();

        uint256 r1 = _pay(agent, TASK, recipient, 900e6); // queued (threshold)
        uint256 r2 = _pay(agent2, TASK2, outsider, 50e6); // queued (allowlist)
        _assertAccounting();

        uint256 e1 = _escrow(agent, TASK, outsider, 700e6, uint64(block.timestamp + 1 days));
        uint256 e2 = _escrow(agent2, TASK2, outsider, 600e6, uint64(block.timestamp + 2 days));
        _assertAccounting();

        vm.prank(owner);
        vault.approveRequest(r1);
        _assertAccounting();

        vm.prank(owner);
        vault.rejectRequest(r2);
        _assertAccounting();

        vm.prank(approverAddr);
        vault.releaseEscrow(e1);
        _assertAccounting();

        vm.prank(owner);
        vault.withdraw(owner, 1_000e6);
        _assertAccounting();

        vm.warp(block.timestamp + 2 days);
        vault.refundEscrow(e2);
        _assertAccounting();

        vm.prank(owner);
        vault.closeTask(TASK2);
        _assertAccounting();

        vm.warp(expiry);
        vm.prank(stranger);
        vault.closeTask(TASK);
        _assertAccounting();

        assertEq(vault.totalReserved(), 0);
        uint256 paidOut = 400e6 + 900e6 + 700e6;
        assertEq(token.balanceOf(address(vault)), DEPOSIT - paidOut - 1_000e6);
        assertEq(vault.freeBalance(), token.balanceOf(address(vault)));
    }
}

/// @notice A token that calls back into the vault mid-transfer. Each re-entry must hit the ReentrancyGuard.
contract ReentrancyTest is BaseTest {
    ReentrantToken internal rt;
    bytes32 internal constant RT_TASK = keccak256("rt-task");

    function _deployToken() internal override returns (address) {
        rt = new ReentrantToken();
        return address(rt);
    }

    function test_reentrancy_pay() public {
        // The token itself is a registered agent with its own task, so the inner call gets past the auth checks.
        vm.startPrank(owner);
        vault.setAgent(address(rt), _policy(PER_TX, DAILY, PER_TX));
        vault.setAgentRecipient(address(rt), recipient, true);
        vm.stopPrank();
        _openTask(RT_TASK, address(rt), BUDGET, expiry);

        rt.arm(address(vault), address(vault), abi.encodeCall(vault.pay, (RT_TASK, recipient, 1e6, REASON)));
        vm.prank(agent);
        vm.expectRevert(ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        vault.pay(TASK, recipient, 100e6, REASON);

        assertEq(rt.balanceOf(recipient), 0);
        assertEq(vault.getTask(TASK).remaining, BUDGET);
        assertEq(vault.getTask(RT_TASK).remaining, BUDGET);
    }

    function test_reentrancy_approveRequest() public {
        // The token becomes the owner, so the inner approveRequest passes onlyOwner and reaches nonReentrant.
        vm.prank(owner);
        vault.transferOwnership(address(rt));
        vm.prank(address(rt));
        vault.acceptOwnership();

        uint256 id1 = _pay(agent, TASK, outsider, 300e6);
        uint256 id2 = _pay(agent, TASK, outsider, 300e6);

        rt.arm(address(vault), address(vault), abi.encodeCall(vault.approveRequest, (id2)));
        vm.prank(address(rt));
        vm.expectRevert(ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        vault.approveRequest(id1);

        assertEq(uint8(vault.getRequest(id1).status), uint8(BursarVault.RequestStatus.Pending));
        assertEq(uint8(vault.getRequest(id2).status), uint8(BursarVault.RequestStatus.Pending));
        assertEq(rt.balanceOf(outsider), 0);
    }

    function test_reentrancy_releaseEscrow() public {
        // The token is the approver, so the inner releaseEscrow passes the auth check and reaches nonReentrant.
        vm.prank(owner);
        vault.setApprover(address(rt));
        uint256 e1 = _escrow(agent, TASK, outsider, 300e6, expiry);
        uint256 e2 = _escrow(agent, TASK, outsider, 300e6, expiry);

        rt.arm(address(vault), address(vault), abi.encodeCall(vault.releaseEscrow, (e2)));
        vm.prank(owner);
        vm.expectRevert(ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        vault.releaseEscrow(e1);

        assertEq(uint8(vault.getEscrow(e1).status), uint8(BursarVault.EscrowStatus.Locked));
        assertEq(uint8(vault.getEscrow(e2).status), uint8(BursarVault.EscrowStatus.Locked));
        assertEq(rt.balanceOf(outsider), 0);
        _assertAccounting();
    }

    function test_reentrancy_withdraw() public {
        vm.prank(owner);
        vault.transferOwnership(address(rt));
        vm.prank(address(rt));
        vault.acceptOwnership();

        rt.arm(address(vault), address(vault), abi.encodeCall(vault.withdraw, (stranger, 1e6)));
        vm.prank(address(rt));
        vm.expectRevert(ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        vault.withdraw(stranger, 1e6);
    }
}

/// @notice A token with a blocklist (USDC-style). Transfers to a blocked address revert; the vault must stay
///         consistent and give the owner a way to recover.
contract BlocklistTest is BaseTest {
    BlocklistToken internal bl;

    function _deployToken() internal override returns (address) {
        bl = new BlocklistToken();
        return address(bl);
    }

    function test_blocklist_payRevertsAtomically() public {
        bl.setBlocked(recipient, true);
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(BlocklistToken.Blocklisted.selector, recipient));
        vault.pay(TASK, recipient, 100e6, REASON);

        // Whole call rolled back: budget, daily spend and reservation untouched.
        assertEq(vault.getTask(TASK).remaining, BUDGET);
        assertEq(vault.spentToday(agent), 0);
        assertEq(vault.totalReserved(), BUDGET);
        _assertAccounting();
    }

    function test_blocklist_approveRevertsThenOwnerRejects() public {
        uint256 id = _pay(agent, TASK, outsider, 100e6);
        bl.setBlocked(outsider, true);

        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(BlocklistToken.Blocklisted.selector, outsider));
        vault.approveRequest(id);
        assertEq(uint8(vault.getRequest(id).status), uint8(BursarVault.RequestStatus.Pending));

        // Recovery: reject the request. Nothing was ever reserved for it.
        vm.prank(owner);
        vault.rejectRequest(id);
        assertEq(vault.getTask(TASK).remaining, BUDGET);
        _assertAccounting();
    }

    function test_blocklist_releaseRevertsThenRefundAfterDeadline() public {
        uint64 dl = uint64(block.timestamp + 1 days);
        uint256 id = _escrow(agent, TASK, outsider, 300e6, dl);
        bl.setBlocked(outsider, true);

        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(BlocklistToken.Blocklisted.selector, outsider));
        vault.releaseEscrow(id);
        assertEq(uint8(vault.getEscrow(id).status), uint8(BursarVault.EscrowStatus.Locked));
        _assertAccounting();

        // Recovery: after the deadline the escrow is refunded to the vault's free balance.
        uint256 freeBefore = vault.freeBalance();
        vm.warp(dl);
        vault.refundEscrow(id);
        assertEq(vault.freeBalance(), freeBefore + 300e6);
        _assertAccounting();
    }

    function test_blocklist_otherRecipientsUnaffected() public {
        bl.setBlocked(outsider, true);
        _pay(agent, TASK, recipient, 100e6);
        assertEq(bl.balanceOf(recipient), 100e6);
    }
}
