// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BursarVault} from "../src/BursarVault.sol";
import {BaseTest} from "./BaseTest.sol";

contract BursarVaultFuzzTest is BaseTest {
    bytes32 internal constant BIG = keccak256("big-task");

    /// @dev A long-lived task with a huge budget so only the cap under test can bind.
    function _bigTask() internal {
        vm.startPrank(owner);
        vault.deposit(500_000e6);
        vault.setAgent(agent, _policy(PER_TX, DAILY, PER_TX)); // everything allowlisted pays directly
        vm.stopPrank();
        _openTask(BIG, agent, 500_000e6, uint64(block.timestamp + 365 days));
    }

    /// @notice Daily cap holds within every UTC day and resets exactly at day boundaries.
    function testFuzz_dailyCapAcrossDayBoundaries(uint256 seed, uint8 steps) public {
        _bigTask();
        uint256 n = bound(steps, 1, 60);
        uint256 curDay = block.timestamp / 1 days;
        uint256 spent;

        for (uint256 i; i < n; ++i) {
            uint256 amount = bound(uint256(keccak256(abi.encode(seed, i, "amt"))), 1, PER_TX);
            uint256 dt = bound(uint256(keccak256(abi.encode(seed, i, "dt"))), 0, 10 hours);
            vm.warp(block.timestamp + dt);

            uint256 day = block.timestamp / 1 days;
            if (day != curDay) {
                curDay = day;
                spent = 0;
            }

            if (spent + amount > DAILY) {
                // Logged and refused; counts as zero spend.
                _expectBlocked(agent, BIG, recipient, amount, BursarVault.BlockCause.DailyCap);
            } else {
                vm.prank(agent);
                (bool executed,) = vault.pay(BIG, recipient, amount, REASON);
                assertTrue(executed);
                spent += amount;
            }
            assertEq(vault.spentToday(agent), spent);
            assertLe(vault.spentToday(agent), DAILY);
            assertEq(vault.remainingDailyAllowance(agent), DAILY - spent);
        }
    }

    /// @notice Documents the fixed-window tradeoff: up to 2x dailyCap across midnight, never more within one day.
    function testFuzz_twoXAcrossMidnightButNotWithinDay(uint256 secondsBeforeMidnight) public {
        _bigTask();
        uint256 nextMidnight = (block.timestamp / 1 days + 1) * 1 days;
        vm.warp(nextMidnight - bound(secondsBeforeMidnight, 1, 1 hours));

        for (uint256 i; i < DAILY / PER_TX; ++i) {
            _pay(agent, BIG, recipient, PER_TX);
        }
        _expectBlocked(agent, BIG, recipient, 1, BursarVault.BlockCause.DailyCap);

        vm.warp(nextMidnight);
        for (uint256 i; i < DAILY / PER_TX; ++i) {
            _pay(agent, BIG, recipient, PER_TX);
        }
        assertEq(token.balanceOf(recipient), 2 * uint256(DAILY));
        _expectBlocked(agent, BIG, recipient, 1, BursarVault.BlockCause.DailyCap);
    }

    /// @notice perTxCap is a hard ceiling for both pay (blocked + logged) and createEscrow (reverts), whatever the threshold.
    function testFuzz_perTxCap(uint256 amount, uint128 threshold) public {
        amount = bound(amount, 1, BUDGET);
        threshold = uint128(bound(threshold, 0, PER_TX));
        vm.prank(owner);
        vault.setAgent(agent, _policy(PER_TX, DAILY, threshold));

        if (amount > PER_TX) {
            _expectBlocked(agent, TASK, recipient, amount, BursarVault.BlockCause.PerTxCap);
            vm.prank(agent);
            vm.expectRevert(BursarVault.ExceedsPerTxCap.selector);
            vault.createEscrow(TASK, recipient, amount, expiry, REASON);
        } else {
            vm.prank(agent);
            (bool executed,) = vault.pay(TASK, recipient, amount, REASON);
            assertEq(executed, amount <= threshold);
            assertEq(token.balanceOf(recipient), executed ? amount : 0);
        }
    }

    /// @notice remaining + spent == budget throughout; overspending is blocked (pay) or reverts (escrow).
    function testFuzz_taskBudgetAccounting(uint256 budget, uint256 seed, uint8 steps) public {
        budget = bound(budget, 1, 20_000e6);
        vm.prank(owner);
        vault.setAgent(agent, _policy(PER_TX, 1_000_000e6, PER_TX)); // daily cap out of the way
        _openTask(TASK2, agent, budget, expiry);

        uint256 n = bound(steps, 1, 40);
        uint256 spent;
        for (uint256 i; i < n; ++i) {
            uint256 amount = bound(uint256(keccak256(abi.encode(seed, i))), 1, PER_TX);
            bool useEscrow = uint256(keccak256(abi.encode(seed, i, "kind"))) % 2 == 0;
            uint256 remaining = budget - spent;

            if (amount > remaining) {
                if (useEscrow) {
                    vm.prank(agent);
                    vm.expectRevert(BursarVault.ExceedsTaskBudget.selector);
                    vault.createEscrow(TASK2, outsider, amount, expiry, REASON);
                } else {
                    _expectBlocked(agent, TASK2, recipient, amount, BursarVault.BlockCause.TaskBudget);
                }
            } else {
                spent += amount;
                vm.prank(agent);
                if (useEscrow) vault.createEscrow(TASK2, outsider, amount, expiry, REASON);
                else vault.pay(TASK2, recipient, amount, REASON);
            }

            BursarVault.Task memory t = vault.getTask(TASK2);
            assertEq(t.spent, spent);
            assertEq(uint256(t.remaining) + t.spent, budget);
            _assertAccounting();
        }

        // Closing releases exactly the unspent part.
        uint256 freeBefore = vault.freeBalance();
        vm.prank(owner);
        vault.closeTask(TASK2);
        assertEq(vault.freeBalance(), freeBefore + (budget - spent));
        _assertAccounting();
    }

    /// @notice Any amount above the per-tx cap, up to uint256 max, is logged as blocked with no state change
    ///         (no truncating cast, no request, no spend).
    function testFuzz_blockedAnyAmountChangesNothing(uint256 amount, bool allowlisted) public {
        amount = bound(amount, uint256(PER_TX) + 1, type(uint256).max);
        address to = allowlisted ? recipient : outsider;
        _expectBlocked(agent, TASK, to, amount, BursarVault.BlockCause.PerTxCap);
        _assertAccounting();
    }

    /// @notice Whatever mix of pays, approvals, escrows, refunds and withdrawals happens,
    ///         money out never exceeds money in, and the vault balance is exactly the difference.
    function testFuzz_totalPaidOutNeverExceedsDeposits(uint256 seed, uint8 steps) public {
        vm.prank(owner);
        vault.setApprover(approverAddr);
        uint256 deposited = DEPOSIT;
        uint256 paidOut;
        address sink = makeAddr("sink");

        uint256 n = bound(steps, 1, 50);
        for (uint256 i; i < n; ++i) {
            uint256 r = uint256(keccak256(abi.encode(seed, i)));
            uint256 amount = bound(r >> 8, 1, PER_TX);
            uint256 action = r % 7;

            if (action == 0) {
                vm.prank(owner);
                vault.deposit(amount);
                deposited += amount;
            } else if (action == 1) {
                uint256 free = vault.freeBalance();
                if (free == 0) continue;
                amount = bound(amount, 1, free);
                vm.prank(owner);
                vault.withdraw(sink, amount);
                paidOut += amount;
            } else if (action == 2) {
                vm.prank(agent);
                try vault.pay(TASK, recipient, amount, REASON) returns (bool executed, uint256) {
                    if (executed) paidOut += amount;
                } catch {}
            } else if (action == 3) {
                uint256 count = vault.requestCount();
                if (count == 0) continue;
                uint256 id = bound(r >> 16, 1, count);
                uint256 amt = vault.getRequest(id).amount;
                vm.prank(owner);
                try vault.approveRequest(id) {
                    paidOut += amt;
                } catch {}
            } else if (action == 4) {
                vm.prank(agent);
                try vault.createEscrow(TASK, outsider, amount, uint64(block.timestamp + 1 hours), REASON) {} catch {}
            } else if (action == 5) {
                uint256 count = vault.escrowCount();
                if (count == 0) continue;
                uint256 id = bound(r >> 16, 1, count);
                uint256 amt = vault.getEscrow(id).amount;
                vm.prank(approverAddr);
                try vault.releaseEscrow(id) {
                    paidOut += amt;
                } catch {}
            } else {
                vm.warp(block.timestamp + bound(r >> 24, 1 minutes, 6 hours));
                uint256 count = vault.escrowCount();
                if (count > 0) try vault.refundEscrow(bound(r >> 32, 1, count)) {} catch {}
            }

            assertLe(paidOut, deposited);
            assertEq(token.balanceOf(address(vault)), deposited - paidOut);
            _assertAccounting();
        }
    }
}
