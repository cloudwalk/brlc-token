// SPDX-License-Identifier: MIT

pragma solidity ^0.8.20;

import { ERC20Hookable } from "../../base/ERC20Hookable.sol";

/**
 * @title ERC20HookableMock contract
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @notice An implementation of the {ERC20Hookable} contract for testing purposes
 */
contract ERC20HookableMock is ERC20Hookable {
    /**
     * @notice The initialize function of the upgradeable contract
     *
     * See details https://docs.openzeppelin.com/upgrades-plugins/1.x/writing-upgradeable
     *
     * @param name_ The name of the token
     * @param symbol_ The symbol of the token
     */
    function initialize(string memory name_, string memory symbol_) public initializer {
        __ERC20Base_init(name_, symbol_);
        __ERC20Hookable_init_unchained();
    }

    /**
     * @notice Calls the parent internal unchained initializing function to verify the 'onlyInitializing' modifier
     */
    function callParentInitializerUnchained() public {
        __ERC20Hookable_init_unchained();
    }
}
