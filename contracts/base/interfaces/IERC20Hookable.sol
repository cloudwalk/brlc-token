// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

/**
 * @title IERC20Hookable interface
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev The interface of a token that supports hooking operations.
 */
interface IERC20Hookable {
    /**
     * @dev Possible policies of the hook error handling.
     *
     * The values:
     *
     * - Revert = 0 -- Revert the transaction if the hook fails.
     * - Event = 1 --- Emit an event if the hook fails.
     */
    enum ErrorHandlingPolicy {
        Revert,
        Event
    }

    /**
     * @dev The data of a single hook.
     *
     * Fields:
     *
     * - account -- The address of the contract to call the hook.
     * - policy --- The error handling policy of the hook.
     */
    struct Hook {
        address account;
        ErrorHandlingPolicy policy;
    }

    /**
     * @dev Updates the `beforeTokenTransfer` hooks attached to the token.
     * @param hooks The hooks to be attached.
     */
    function setBeforeTokenTransferHooks(Hook[] calldata hooks) external;

    /**
     * @dev Updates the `afterTokenTransfer` hooks attached to the token.
     * @param hooks The hooks to be attached.
     */
    function setAfterTokenTransferHooks(Hook[] calldata hooks) external;

    /**
     * @dev Returns the array of `beforeTokenTransfer` hooks attached to the token.
     */
    function getBeforeTokenTransferHooks() external view returns (Hook[] memory);

    /**
     * @dev Returns the array of `afterTokenTransfer` hooks attached to the token.
     */
    function getAfterTokenTransferHooks() external view returns (Hook[] memory);
}
