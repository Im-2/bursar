// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {BursarVault} from "./BursarVault.sol";

/// @title BursarFactory
/// @notice Deploys one BursarVault per call, owned by the caller.
/// @dev Plain `new` (not clones) so the vault's token stays `immutable` and there is no initializer to front-run.
///      `vaultsOf` records the creator; it is not updated if vault ownership is later transferred.
contract BursarFactory {
    mapping(address creator => address[]) private _vaultsOf;

    event VaultCreated(address indexed owner, address indexed vault, address indexed token);

    function createVault(IERC20 token) external returns (BursarVault vault) {
        vault = new BursarVault(token, msg.sender);
        _vaultsOf[msg.sender].push(address(vault));
        emit VaultCreated(msg.sender, address(vault), address(token));
    }

    function vaultsOf(address creator) external view returns (address[] memory) {
        return _vaultsOf[creator];
    }
}
