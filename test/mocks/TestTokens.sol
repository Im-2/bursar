// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice Common surface of every token the tests deploy.
interface ITestToken is IERC20 {
    function mint(address to, uint256 amount) external;
}

/// @notice 6-decimal token that re-enters a target contract when it transfers out of `hookFrom`.
///         Models a malicious token / ERC-777-style recipient hook. The re-entrant call is made with
///         this token as msg.sender, so tests make the token an agent, the owner or the approver as needed.
///         If the re-entrant call reverts, the revert bubbles up and fails the outer transaction.
contract ReentrantToken is ERC20 {
    address public hookFrom;
    address public target;
    bytes public data;

    constructor() ERC20("Reentrant", "RE") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function arm(address from, address target_, bytes calldata data_) external {
        hookFrom = from;
        target = target_;
        data = data_;
    }

    function _update(address from, address to, uint256 value) internal override {
        super._update(from, to, value);
        if (from == hookFrom && target != address(0)) {
            address t = target;
            target = address(0); // one shot
            (bool ok, bytes memory ret) = t.call(data);
            if (!ok) {
                assembly {
                    revert(add(ret, 32), mload(ret))
                }
            }
        }
    }
}

/// @notice 6-decimal token that reverts any transfer to a blocklisted address (like USDC/USDT-style blocklists).
contract BlocklistToken is ERC20 {
    mapping(address => bool) public blocked;

    error Blocklisted(address account);

    constructor() ERC20("Blocklist", "BL") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function setBlocked(address account, bool isBlocked) external {
        blocked[account] = isBlocked;
    }

    function _update(address from, address to, uint256 value) internal override {
        if (blocked[to]) revert Blocklisted(to);
        super._update(from, to, value);
    }
}
