// SPDX-License-Identifier: MIT

pragma solidity 0.8.16;

import {BRLCTokenUpgradeable} from "../../tokens/BRLCTokenUpgradeable.sol";

/**
 * @title BRLCTokenUpgradeableMock contract
 * @dev An implementation of the {BRLCTokenUpgradeable} contract for test purposes.
 */
contract BRLCTokenUpgradeableMock is BRLCTokenUpgradeable {

    event TestBeforeTokenTransferSucceeded();

    /**
     * @dev The initialize function of the upgradable contract
     * but without modifier {initializer} to test that the ancestor contract has it.
     * @param name_ The name of the token to set for this ERC20-comparable contract.
     * @param symbol_ The symbol of the token to set for this ERC20-comparable contract.
     */
    function initialize(
        string memory name_,
        string memory symbol_
    ) public {
        __BRLCToken_init(name_, symbol_);
    }

    /**
     * @dev The unchained initialize function of the upgradable contract
     * but without modifier {initializer} to test that the ancestor contract has it.
     */
    function initialize_unchained() public {
        __BRLCToken_init_unchained();
    }

    /**
     * @dev Cals the appropriate internal function to mint needed amount of tokens for an account.
     * @param account The address of an account to mint for.
     * @param amount The amount of tokens to mint.
     */
    function mint(address account, uint256 amount) external returns (bool) {
        _mint(account, amount);
        return true;
    }

    /**
     * @dev Cals the appropriate internal function.
     * If that function executed without reverting emits an event {TestBeforeTokenTransferSucceeded}.
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
