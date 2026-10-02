// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {BursarFactory} from "../src/BursarFactory.sol";
import {MockUSDG} from "../src/mocks/MockUSDG.sol";

/// @notice Deploys BursarFactory and, on testnets, optionally a MockUSDG.
/// @dev Env (read only in `run`):
///      DEPLOY_MOCK_TOKEN  (bool, default false)  deploy a MockUSDG and use it as the token
///      TOKEN_ADDRESS      (address)              existing stablecoin; required when DEPLOY_MOCK_TOKEN is false
///      The signer comes from the CLI (--account / --ledger / --private-key), never from this script or .env.
///      The factory stores no token: the token is chosen per vault via createVault(token) (see Seed.s.sol).
contract Deploy is Script {
    uint256 internal constant ARBITRUM_ONE = 42161;

    function run() external returns (BursarFactory factory, address token) {
        bool deployMock = vm.envOr("DEPLOY_MOCK_TOKEN", false);
        address existing = deployMock ? address(0) : vm.envAddress("TOKEN_ADDRESS");
        return deploy(deployMock, existing);
    }

    function deploy(bool deployMock, address existingToken) public returns (BursarFactory factory, address token) {
        if (deployMock) {
            require(block.chainid != ARBITRUM_ONE, "Deploy: refusing to deploy MockUSDG on Arbitrum One");
        } else {
            require(existingToken != address(0), "Deploy: TOKEN_ADDRESS is zero");
            require(existingToken.code.length > 0, "Deploy: TOKEN_ADDRESS has no code on this chain");
            token = existingToken;
        }

        vm.startBroadcast();
        factory = new BursarFactory();
        if (deployMock) token = address(new MockUSDG());
        vm.stopBroadcast();

        console.log("chain id      ", block.chainid);
        console.log("BursarFactory ", address(factory));
        console.log(deployMock ? "MockUSDG      " : "token (env)   ", token);
    }
}
