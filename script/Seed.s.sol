// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {BursarFactory} from "../src/BursarFactory.sol";
import {BursarVault} from "../src/BursarVault.sol";
import {MockUSDG} from "../src/mocks/MockUSDG.sol";

/// @notice Demo seeding: creates a vault owned by the broadcaster, funds it, registers one agent,
///         allowlists one recipient for it and opens one task.
/// @dev Env (read only in `loadConfig`). Amounts are WHOLE tokens, scaled by the token's decimals:
///      FACTORY_ADDRESS     (address)  BursarFactory from Deploy.s.sol
///      TOKEN_ADDRESS       (address)  token the vault will hold
///      SEED_MINT           (bool, default false)  call MockUSDG.mint first (testnet mock only)
///      SEED_DEPOSIT        (uint, default 10000)  tokens deposited into the vault
///      AGENT_ADDRESS       (address)  the agent's public address (its key stays with the agent)
///      AGENT_ROLE          (string <= 32 bytes, default "DEMO")
///      PER_TX_CAP          (uint, default 100)
///      DAILY_CAP           (uint, default 500)
///      APPROVAL_THRESHOLD  (uint, default 50; 0 = every payment needs approval)
///      RECIPIENT_ADDRESS   (address)  allowlisted for the agent
///      TASK_LABEL          (string, default "demo-task-1")  taskId = keccak256(TASK_LABEL)
///      TASK_BUDGET         (uint, default 1000)
///      TASK_DURATION_DAYS  (uint, default 7)
contract Seed is Script {
    uint256 internal constant ARBITRUM_ONE = 42161;

    struct Config {
        BursarFactory factory;
        address token;
        bool mint;
        uint256 deposit; // base units
        address agent;
        bytes32 role;
        uint128 perTxCap; // base units
        uint128 dailyCap; // base units
        uint128 threshold; // base units
        address recipient;
        bytes32 taskId;
        uint256 budget; // base units
        uint64 expiry;
    }

    function run() external returns (BursarVault vault) {
        return seed(loadConfig());
    }

    function loadConfig() public view returns (Config memory c) {
        c.factory = BursarFactory(vm.envAddress("FACTORY_ADDRESS"));
        c.token = vm.envAddress("TOKEN_ADDRESS");
        require(c.token.code.length > 0, "Seed: TOKEN_ADDRESS has no code");
        c.mint = vm.envOr("SEED_MINT", false);

        uint256 unit = 10 ** IERC20Metadata(c.token).decimals();
        c.deposit = vm.envOr("SEED_DEPOSIT", uint256(10_000)) * unit;
        c.perTxCap = uint128(vm.envOr("PER_TX_CAP", uint256(100)) * unit);
        c.dailyCap = uint128(vm.envOr("DAILY_CAP", uint256(500)) * unit);
        c.threshold = uint128(vm.envOr("APPROVAL_THRESHOLD", uint256(50)) * unit);
        c.budget = vm.envOr("TASK_BUDGET", uint256(1_000)) * unit;

        c.agent = vm.envAddress("AGENT_ADDRESS");
        c.recipient = vm.envAddress("RECIPIENT_ADDRESS");

        string memory role = vm.envOr("AGENT_ROLE", string("DEMO"));
        require(bytes(role).length <= 32, "Seed: AGENT_ROLE longer than 32 bytes");
        c.role = bytes32(bytes(role));

        c.taskId = keccak256(bytes(vm.envOr("TASK_LABEL", string("demo-task-1"))));
        c.expiry = uint64(block.timestamp + vm.envOr("TASK_DURATION_DAYS", uint256(7)) * 1 days);
    }

    function seed(Config memory c) public returns (BursarVault vault) {
        require(address(c.factory).code.length > 0, "Seed: FACTORY_ADDRESS has no code");
        require(c.token.code.length > 0, "Seed: TOKEN_ADDRESS has no code");
        require(!(c.mint && block.chainid == ARBITRUM_ONE), "Seed: SEED_MINT is testnet-only");
        require(c.budget <= c.deposit, "Seed: TASK_BUDGET exceeds SEED_DEPOSIT");

        vm.startBroadcast();
        (, address broadcaster,) = vm.readCallers(); // the signer chosen on the CLI
        if (c.mint) MockUSDG(c.token).mint(broadcaster, c.deposit);
        vault = c.factory.createVault(IERC20Metadata(c.token));
        IERC20Metadata(c.token).approve(address(vault), c.deposit);
        vault.deposit(c.deposit);
        vault.setAgent(
            c.agent,
            BursarVault.Policy({
                perTxCap: c.perTxCap, dailyCap: c.dailyCap, approvalThreshold: c.threshold, active: true, role: c.role
            })
        );
        vault.setAgentRecipient(c.agent, c.recipient, true);
        vault.openTask(c.taskId, c.agent, c.budget, c.expiry);
        vm.stopBroadcast();

        console.log("BursarVault   ", address(vault));
        console.log("owner         ", vault.owner());
        console.log("agent         ", c.agent);
        console.log("recipient     ", c.recipient);
        console.log("taskId");
        console.logBytes32(c.taskId);
        console.log("free balance  ", vault.freeBalance());
        console.log("reserved      ", vault.totalReserved());
    }
}
