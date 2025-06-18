// SPDX-License-Identifier: MIT

pragma solidity ^0.8.20;

import { ERC20Trustable } from "../../base/ERC20Trustable.sol";

/**
 * @title ERC20TrustableMock contract
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev An implementation of the {ERC20Trustable} contract for testing purposes.
 */
contract ERC20TrustableMock is ERC20Trustable {
    /**
     * @dev The initialize function of the upgradeable contract.
     *
     * See details: https://docs.openzeppelin.com/upgrades-plugins/writing-upgradeable
     *
     * @param name_ The name of the token.
     * @param symbol_ The symbol of the token.
     */
    function initialize(string memory name_, string memory symbol_) public initializer {
        __ERC20Base_init(name_, symbol_);
        __ERC20Trustable_init_unchained();
    }

    /**
     * @dev Calls the parent internal unchained initializing function to verify the 'onlyInitializing' modifier.
     */
    function callParentInitializerUnchained() public {
        __ERC20Trustable_init_unchained();
    }
}
