// SPDX-License-Identifier: MIT

pragma solidity ^0.8.20;

import { ERC20Freezable } from "../../base/ERC20Freezable.sol";

/**
 * @title ERC20FreezableMock contract
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @notice An implementation of the {ERC20Freezable} contract for testing purposes
 */
contract ERC20FreezableMock is ERC20Freezable {
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
        __ERC20Freezable_init_unchained();
    }

    /**
     * @notice Needed to check that the unchained initialize function of the ancestor contract
     * has the 'onlyInitializing' modifier
     */
    function call_parent_initialize_unchained() public {
        __ERC20Freezable_init_unchained();
    }

    /**
     * @notice Calls the appropriate internal function to mint needed amount of tokens for an account
     *
     * @param account The address of an account to mint for
     * @param amount The amount of tokens to mint
     */
    function mint(address account, uint256 amount) external returns (bool) {
        _mint(account, amount);
        return true;
    }

    /**
     * @notice Directly sets the frozen balance for an account ignoring any checks
     *
     * @param account The address of an account to set the frozen balance
     * @param newBalance The value of the frozen balance to set
     */
    function setFrozenBalance(address account, uint256 newBalance) external {
        _freeze(account, newBalance, balanceOfFrozen(account));
    }
}
