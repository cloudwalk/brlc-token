// SPDX-License-Identifier: MIT
 pragma solidity ^0.8.4;

/**
 * @title IERC20ComplexBalance interface
 * @author CloudWalk Inc.
 * @notice The interface of a token that supports complex balance tracking
 */
interface IERC20ComplexBalance {
    /// @notice A struct that defines the current state of the complex balance of the account
    struct ComplexBalance {
        /// The total amount of tokens that is equal the value returned by the usual `ERC20.balanceOf()` function
        uint256 total;
        /// The amount of tokens that are available without any limitations described in the subsequent fields
        uint256 free;
        /// The total amount of pre-minted tokens of the account that have not been released yet
        uint256 premint;
        /// The amount of tokens that are frozen
        uint256 frozen;
        /// The total amount of tokens that are restricted (Sum of all restricted balances regardless of purpose)
        uint256 restricted;
    }

    /**
     * @notice Retrieves the state of the complex balance for an account
     *
     * @param account The account to get the complex balance of
     * @return The struct containing the current state of complex balance
     */
    function balanceOfComplex(address account) external view returns (ComplexBalance memory);
}
