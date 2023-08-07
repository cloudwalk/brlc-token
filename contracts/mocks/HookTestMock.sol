// SPDX-License-Identifier: MIT

pragma solidity 0.8.16;

import { IHook } from "./../base/interfaces/IHook.sol";

/**
 * @title HookTestMock contract
 * @author CloudWalk Inc.
 * @notice An implementation of the {IHook} contract for testing purposes
 */
contract HookTestMock is IHook {
    /// @notice Emitted when the `beforeTokenTransfer` hook function is successfully executed
    event TestBeforeTokenTransferHookEvent();

    /// @notice Emitted when the `afterTokenTransfer` hook function is successfully executed
    event TestAfterTokenTransferHookEvent();

    /// @notice Custome error to be reverted with from the `beforeTokenTransfer` hook function
    error TestBeforeTokenTransferHookError();

    /// @notice Custome error to be reverted with from the `afterTokenTransfer` hook function
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
     * @inheritdoc IHook
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
            require(false, "error message");
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
     * @inheritdoc IHook
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
            require(false, "error message");
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
