// SPDX-License-Identifier: MIT

pragma solidity 0.8.16;

import { BRLCTokenBase } from "../../base/BRLCTokenBase.sol";

/**
 * @title BRLCTokenBaseMock contract
 * @author CloudWalk Inc.
 * @dev An implementation of the {BRLCTokenBase} contract for test purposes.
 */
contract BRLCTokenBaseMock is BRLCTokenBase {
    /// @dev Emitted when the `testBeforeTokenTransfer` function executes successfully.
    event TestBeforeTokenTransferSucceeded();

    /**
     * @dev The initialize function of the upgradable contract.
     *
     * See details https://docs.openzeppelin.com/upgrades-plugins/1.x/writing-upgradeable.
     *
     * @param name_ The name of the token.
     * @param symbol_ The symbol of the token.
     */
    function initialize(string memory name_, string memory symbol_) public initializer {
        __BRLCTokenBase_init(name_, symbol_);
    }

    /**
     * @dev Needed to check that the initialize function of the ancestor contract
     * has the 'onlyInitializing' modifier.
     *
     * @param name_ The name of the token.
     * @param symbol_ The symbol of the token.
     */
    function call_parent_initialize(string memory name_, string memory symbol_) public {
        __BRLCTokenBase_init(name_, symbol_);
    }

    /**
     * @dev Needed to check that the unchained initialize function of the ancestor contract
     * has the 'onlyInitializing' modifier.
     */
    function call_parent_initialize_unchained() public {
        __BRLCTokenBase_init_unchained();
    }

    /**
     * @dev Calls the appropriate internal function to mint needed amount of tokens for an account.
     *
     * @param account The address of an account to mint for.
     * @param amount The amount of tokens to mint.
     */
    function mint(address account, uint256 amount) external returns (bool) {
        _mint(account, amount);
        return true;
    }

    /**
     * @dev Calls the appropriate internal function.
     *
     * If that function executed without reverting emits an event {TestBeforeTokenTransferSucceeded}.
     *
     * @param from The address of an account to transfer tokens from.
     * @param to The address of an account to transfer tokens to.
     * @param amount The amount of tokens to transfer.
     */
    function testBeforeTokenTransfer(
        address from,
        address to,
        uint256 amount
    ) external {
        _beforeTokenTransfer(from, to, amount);
        emit TestBeforeTokenTransferSucceeded();
    }
}
