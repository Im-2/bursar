// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Deploy} from "../script/Deploy.s.sol";
import {Seed} from "../script/Seed.s.sol";
import {BursarFactory} from "../src/BursarFactory.sol";
import {BursarVault} from "../src/BursarVault.sol";
import {MockUSDG} from "../src/mocks/MockUSDG.sol";

/// @notice Runs the deploy and seed scripts in-process (no RPC, no keys) to prove they work end to end.
/// @dev vm.setEnv is process-wide and tests run in parallel, so only `test_runFromEnv` touches env vars;
///      everything else goes through the scripts' parameterized entry points.
contract ScriptsTest is Test {
    address internal agent = makeAddr("demoAgent");
    address internal recipient = makeAddr("demoRecipient");
    bytes32 internal constant TASK_ID = keccak256("demo-task-1");

    function setUp() public {
        vm.warp(1_700_000_000);
    }

    function _config(BursarFactory factory, address token) internal view returns (Seed.Config memory c) {
        c.factory = factory;
        c.token = token;
        c.mint = true;
        c.deposit = 10_000e6;
        c.agent = agent;
        c.role = "RESEARCH";
        c.perTxCap = 100e6;
        c.dailyCap = 500e6;
        c.threshold = 50e6;
        c.recipient = recipient;
        c.taskId = TASK_ID;
        c.budget = 1_000e6;
        c.expiry = uint64(block.timestamp + 7 days);
    }

    // ------------------------------------------------------------ Deploy

    function test_deploy_withMockToken() public {
        (BursarFactory factory, address token) = new Deploy().deploy(true, address(0));
        assertGt(address(factory).code.length, 0);
        assertEq(MockUSDG(token).decimals(), 6);
    }

    function test_deploy_withExistingToken() public {
        MockUSDG existing = new MockUSDG();
        (BursarFactory factory, address token) = new Deploy().deploy(false, address(existing));
        assertGt(address(factory).code.length, 0);
        assertEq(token, address(existing));
    }

    function test_deploy_revert_zeroToken() public {
        Deploy d = new Deploy();
        vm.expectRevert("Deploy: TOKEN_ADDRESS is zero");
        d.deploy(false, address(0));
    }

    function test_deploy_revert_tokenWithoutCode() public {
        Deploy d = new Deploy();
        address eoa = makeAddr("eoa");
        vm.expectRevert("Deploy: TOKEN_ADDRESS has no code on this chain");
        d.deploy(false, eoa);
    }

    function test_deploy_revert_mockOnArbitrumOne() public {
        vm.chainId(42161);
        Deploy d = new Deploy();
        vm.expectRevert("Deploy: refusing to deploy MockUSDG on Arbitrum One");
        d.deploy(true, address(0));
    }

    // ------------------------------------------------------------ Seed

    function test_seed_endToEnd() public {
        (BursarFactory factory, address token) = new Deploy().deploy(true, address(0));
        BursarVault vault = new Seed().seed(_config(factory, token));

        BursarVault.Policy memory p = vault.getPolicy(agent);
        assertEq(p.perTxCap, 100e6);
        assertEq(p.dailyCap, 500e6);
        assertEq(p.approvalThreshold, 50e6);
        assertTrue(p.active);
        assertEq(p.role, bytes32("RESEARCH"));
        assertTrue(vault.agentAllowlist(agent, recipient));

        BursarVault.Task memory t = vault.getTask(TASK_ID);
        assertEq(t.agent, agent);
        assertEq(t.remaining, 1_000e6);
        assertEq(t.expiry, block.timestamp + 7 days);

        assertEq(MockUSDG(token).balanceOf(address(vault)), 10_000e6);
        assertEq(vault.totalReserved(), 1_000e6);
        assertEq(factory.vaultsOf(vault.owner()).length, 1);

        // The seeded agent can actually spend.
        vm.prank(agent);
        (bool executed,) = vault.pay(TASK_ID, recipient, 10e6, "DEMO");
        assertTrue(executed);
        assertEq(MockUSDG(token).balanceOf(recipient), 10e6);
    }

    function test_seed_revert_budgetAboveDeposit() public {
        (BursarFactory factory, address token) = new Deploy().deploy(true, address(0));
        Seed.Config memory c = _config(factory, token);
        c.budget = c.deposit + 1;
        Seed s = new Seed();
        vm.expectRevert("Seed: TASK_BUDGET exceeds SEED_DEPOSIT");
        s.seed(c);
    }

    function test_seed_revert_mintOnArbitrumOne() public {
        (BursarFactory factory, address token) = new Deploy().deploy(true, address(0));
        Seed.Config memory c = _config(factory, token);
        vm.chainId(42161);
        Seed s = new Seed();
        vm.expectRevert("Seed: SEED_MINT is testnet-only");
        s.seed(c);
    }

    function test_seed_revert_factoryWithoutCode() public {
        (, address token) = new Deploy().deploy(true, address(0));
        Seed.Config memory c = _config(BursarFactory(makeAddr("noFactory")), token);
        Seed s = new Seed();
        vm.expectRevert("Seed: FACTORY_ADDRESS has no code");
        s.seed(c);
    }

    // ------------------------------------------------------------ env wiring (the only test using setEnv)

    function test_runFromEnv() public {
        vm.setEnv("DEPLOY_MOCK_TOKEN", "true");
        (BursarFactory factory, address token) = new Deploy().run();

        vm.setEnv("FACTORY_ADDRESS", vm.toString(address(factory)));
        vm.setEnv("TOKEN_ADDRESS", vm.toString(token));
        vm.setEnv("SEED_MINT", "true");
        vm.setEnv("SEED_DEPOSIT", "2000");
        vm.setEnv("AGENT_ADDRESS", vm.toString(agent));
        vm.setEnv("AGENT_ROLE", "OPS");
        vm.setEnv("PER_TX_CAP", "40");
        vm.setEnv("DAILY_CAP", "200");
        vm.setEnv("APPROVAL_THRESHOLD", "0");
        vm.setEnv("RECIPIENT_ADDRESS", vm.toString(recipient));
        vm.setEnv("TASK_LABEL", "env-task");
        vm.setEnv("TASK_BUDGET", "300");
        vm.setEnv("TASK_DURATION_DAYS", "3");

        Seed s = new Seed();
        Seed.Config memory c = s.loadConfig();
        assertEq(c.deposit, 2_000e6);
        assertEq(c.perTxCap, 40e6);
        assertEq(c.threshold, 0);
        assertEq(c.role, bytes32("OPS"));
        assertEq(c.taskId, keccak256("env-task"));
        assertEq(c.expiry, block.timestamp + 3 days);

        BursarVault vault = s.run();
        assertEq(vault.getTask(keccak256("env-task")).remaining, 300e6);
        assertEq(MockUSDG(token).balanceOf(address(vault)), 2_000e6);
    }
}
