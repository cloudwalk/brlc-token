// SPDX-License-Identifier: MIT

pragma solidity ^0.8.20;

import { ERC20Base } from "../../base/ERC20Base.sol";

/**
 * @title ERC20BaseMock contract
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev An implementation of the {ERC20Base} contract for testing purposes.
 */
contract ERC20BaseMock is ERC20Base {
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
    }

    /**
     * @dev Calls the parent internal initializing function to verify the 'onlyInitializing' modifier.
     * @param name_ The name of the token,
     * @param symbol_ The symbol of the token,
     */
    function callParentInitializer(string memory name_, string memory symbol_) public {
        __ERC20Base_init(name_, symbol_);
    }

    /**
     * @dev Calls the parent internal unchained initializing function to verify the 'onlyInitializing' modifier.
     */
    function callParentInitializerUnchained() public {
        __ERC20Base_init_unchained();
    }

    /**
     * @dev Calls the appropriate internal function to mint needed amount of tokens for an account.
     * @param account The address of an account to mint for.
     * @param amount The amount of tokens to mint.
     */
    function mintForTest(address account, uint256 amount) external returns (bool) {
        _mint(account, amount);
        return true;
    }
}
