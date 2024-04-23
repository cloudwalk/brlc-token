// SPDX-License-Identifier: MIT

 pragma solidity ^0.8.8;

import { IERC20Hook } from "./../base/interfaces/IERC20Hook.sol";

/**
 * @title ERC20HookMock contract
 * @author CloudWalk Inc.
 * @notice An implementation of the {IERC20Hook} contract for testing purposes
 */
contract ERC20HookMock is IERC20Hook {
    /// @notice Emitted when the `beforeTokenTransfer` hook function is successfully executed
    event TestBeforeTokenTransferHookEvent();

    /// @notice Emitted when the `afterTokenTransfer` hook function is successfully executed
    event TestAfterTokenTransferHookEvent();

    /// @notice Custom error to be reverted with from the `beforeTokenTransfer` hook function
    error TestBeforeTokenTransferHookError();

    /// @notice Custom error to be reverted with from the `afterTokenTransfer` hook function
    error TestAfterTokenTransferHookError();

    /// @notice Flag indicating whether hook functions should revert with panic
    bool public revertWithPanic;

    /// @notice Flag indicating whether hook functions should revert with reason message
    bool public revertWithReasonMessage;

    /// @notice Flag indicating whether hook functions should revert without reason message
    bool public revertWithoutReasonMessage;

    /**
     * @notice Sets the flag indicating whether hook functions should revert with panic
     *
     * @param value The value to set the flag to
     */
    function setRevertWithPanic(bool value) external {
        revertWithPanic = value;
    }

    /**
     * @notice Sets the flag indicating whether hook functions should revert with reason message
     *
     * @param value The value to set the flag to
     */
    function setRevertWithReasonMessage(bool value) external {
        revertWithReasonMessage = value;
    }

    /**
     * @notice Sets the flag indicating whether hook functions should revert without reason message
     *
     * @param value The value to set the flag to
     */
    function setRevertWithoutReasonMessage(bool value) external {
        revertWithoutReasonMessage = value;
    }

    /**
     * @inheritdoc IERC20Hook
     */
    function beforeTokenTransfer(address from, address to, uint256 amount) external {
        amount;
        from;
        to;

        if (revertWithPanic) {
            // uint8 n = 0;
            // n--;
            // OR
            assert(false);
        }

        if (revertWithReasonMessage) {
            revert("error message");
        }

        if (revertWithoutReasonMessage) {
            // revert();
            // require(false);
            // OR
            revert TestBeforeTokenTransferHookError();
        }

        emit TestBeforeTokenTransferHookEvent();
    }

    /**
     * @inheritdoc IERC20Hook
     */
    function afterTokenTransfer(address from, address to, uint256 amount) external {
        amount;
        from;
        to;

        if (revertWithPanic) {
            // uint8 n = 0;
            // n--;
            // OR
            assert(false);
        }

        if (revertWithReasonMessage) {
            revert("error message");
        }

        if (revertWithoutReasonMessage) {
            // revert();
            // require(false);
            // OR
            revert TestAfterTokenTransferHookError();
        }

        emit TestAfterTokenTransferHookEvent();
    }
}
