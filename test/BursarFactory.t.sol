// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {BursarFactory} from "../src/BursarFactory.sol";
import {BursarVault} from "../src/BursarVault.sol";
import {MockUSDG} from "../src/mocks/MockUSDG.sol";

contract BursarFactoryTest is Test {
    BursarFactory internal factory;
    MockUSDG internal token;
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");

    function setUp() public {
        factory = new BursarFactory();
        token = new MockUSDG();
    }

    function test_createVault_ownerIsCaller() public {
        vm.prank(alice);
        BursarVault vault = factory.createVault(token);

        assertEq(vault.owner(), alice);
        assertEq(address(vault.token()), address(token));
        address[] memory vaults = factory.vaultsOf(alice);
        assertEq(vaults.length, 1);
        assertEq(vaults[0], address(vault));
        assertEq(factory.vaultsOf(bob).length, 0);
    }

    function test_createVault_emits() public {
        // Vault address is the factory's first CREATE address.
        address predicted = vm.computeCreateAddress(address(factory), 1);
        vm.expectEmit(address(factory));
        emit BursarFactory.VaultCreated(alice, predicted, address(token));
        vm.prank(alice);
        factory.createVault(token);
    }

    function test_createVault_multiplePerOwnerAndIndependent() public {
        vm.startPrank(alice);
        BursarVault v1 = factory.createVault(token);
        BursarVault v2 = factory.createVault(token);
        vm.stopPrank();
        vm.prank(bob);
        BursarVault v3 = factory.createVault(token);

        assertTrue(address(v1) != address(v2));
        assertEq(factory.vaultsOf(alice).length, 2);
        assertEq(factory.vaultsOf(bob).length, 1);
        assertEq(v3.owner(), bob);
    }

    function test_createVault_revert_zeroToken() public {
        vm.prank(alice);
        vm.expectRevert(BursarVault.ZeroAddress.selector);
        factory.createVault(IERC20(address(0)));
    }
}

contract MockUSDGTest is Test {
    function test_metadataAndMint() public {
        MockUSDG t = new MockUSDG();
        assertEq(t.decimals(), 6);
        assertEq(t.symbol(), "mUSDG");
        t.mint(address(this), 123e6);
        assertEq(t.balanceOf(address(this)), 123e6);
        assertEq(t.totalSupply(), 123e6);
    }
}
