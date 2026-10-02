// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console} from "forge-std/Test.sol";
import {BursarVault} from "../../src/BursarVault.sol";
import {MockUSDG} from "../../src/mocks/MockUSDG.sol";
import {Handler} from "./Handler.sol";

contract BursarVaultInvariantTest is Test {
    BursarVault internal vault;
    MockUSDG internal token;
    Handler internal handler;

    address internal owner = makeAddr("owner");
    address internal approver = makeAddr("approver");
    uint256 internal constant INITIAL_DEPOSIT = 100_000e6; // funded before the handler starts tracking

    function setUp() public {
        vm.warp(1_700_000_000);
        token = new MockUSDG();
        vault = new BursarVault(token, owner);

        address[] memory agents = new address[](3);
        agents[0] = makeAddr("agentA");
        agents[1] = makeAddr("agentB");
        agents[2] = makeAddr("agentC");

        handler = new Handler(vault, token, owner, approver, agents);

        token.mint(owner, INITIAL_DEPOSIT);
        vm.startPrank(owner);
        token.approve(address(vault), type(uint256).max);
        vault.deposit(INITIAL_DEPOSIT);
        vault.setApprover(approver);
        for (uint256 i; i < agents.length; ++i) {
            vault.setAgent(
                agents[i],
                BursarVault.Policy({
                    perTxCap: handler.PER_TX(),
                    dailyCap: handler.DAILY(),
                    approvalThreshold: handler.THRESHOLD(),
                    active: true,
                    role: "INV"
                })
            );
            vault.setAgentRecipient(agents[i], handler.recipients(0), true);
        }
        vm.stopPrank();

        bytes4[] memory selectors = new bytes4[](14);
        selectors[0] = Handler.deposit.selector;
        selectors[1] = Handler.withdraw.selector;
        selectors[2] = Handler.openTask.selector;
        selectors[3] = Handler.closeTask.selector;
        selectors[4] = Handler.revokeAgent.selector;
        selectors[5] = Handler.reinstateAgent.selector;
        selectors[6] = Handler.togglePause.selector;
        selectors[7] = Handler.approveRequest.selector;
        selectors[8] = Handler.rejectRequest.selector;
        selectors[9] = Handler.pay.selector;
        selectors[10] = Handler.createEscrow.selector;
        selectors[11] = Handler.releaseEscrow.selector;
        selectors[12] = Handler.refundEscrow.selector;
        selectors[13] = Handler.warp.selector;
        targetContract(address(handler));
        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
    }

    /// (a) The vault can always cover every reservation.
    function invariant_balanceCoversReserved() public view {
        assertGe(token.balanceOf(address(vault)), vault.totalReserved());
    }

    /// (b) totalReserved is exactly the open tasks' remaining budgets plus locked escrows.
    function invariant_reservedEqualsTasksPlusEscrows() public view {
        assertEq(vault.totalReserved(), handler.sumOpenTaskRemaining() + handler.sumLockedEscrows());
    }

    /// (c) Per agent per day, autonomous spend (pay + escrow creation) never exceeds dailyCap.
    ///     Approved requests are excluded from the ghost by construction.
    function invariant_dailyCapNeverExceeded() public {
        assertFalse(handler.ghost_dailyCapViolated());
        vm.warp(handler.currentTime());
        uint256 today = block.timestamp / 1 days;
        for (uint256 i; i < handler.agentCount(); ++i) {
            address a = handler.agents(i);
            uint256 spent = vault.spentToday(a);
            assertLe(spent, vault.getPolicy(a).dailyCap);
            assertEq(spent, handler.ghost_autoSpend(a, today)); // on-chain counter matches the ghost
        }
    }

    /// Money out never exceeds money in, and the balance is exactly the difference.
    function invariant_paidOutNeverExceedsDeposits() public view {
        uint256 deposited = INITIAL_DEPOSIT + handler.ghost_deposited();
        uint256 out = handler.ghost_paidOut() + handler.ghost_withdrawn();
        assertLe(out, deposited);
        assertEq(token.balanceOf(address(vault)), deposited - out);
    }

    function afterInvariant() external view {
        console.log("tasks opened", handler.taskCount());
        console.log("requests", vault.requestCount());
        console.log("escrows", vault.escrowCount());
    }
}
