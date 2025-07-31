// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

/**
 * @title IERC20ComplexBalance interface
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev The interface of a token that supports complex balance tracking.
 */
interface IERC20ComplexBalance {
    /**
     * @dev The complex balance of an accounts.
     *
     * Fields:
     *
     * - total ------- The total amount of tokens that is equal the value returned by the usual `balanceOf()` function.
     * - free -------- The amount of tokens that are available without any limitations described in next fields.
     * - premint ----- The total amount of pre-minted tokens of the account that have not been released yet.
     * - frozen ------ The amount of tokens that are frozen.
     * - restricted -- The total amount of tokens that are restricted (the sum regardless of purposes).
     *
     * NOTE: This `restricted` field is deprecated and is always zero.
     *       See the `LegacyRestrictablePlaceholder` base contract for details.
     */
    struct ComplexBalance {
        uint256 total;
        uint256 free;
        uint256 premint;
        uint256 frozen;
        uint256 restricted;
    }

    /**
     * @dev Retrieves the state of the complex balance for an account.
     * @param account The account to get the complex balance of.
     * @return The struct containing the current state of complex balance.
     */
    function balanceOfComplex(address account) external view returns (ComplexBalance memory);
}
