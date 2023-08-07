// SPDX-License-Identifier: MIT

pragma solidity 0.8.16;

/**
 * @title IERC20Hookable interface
 * @author CloudWalk Inc.
 * @notice The interface of a token that supports hooking operations
 */
interface IERC20Hookable {
    /// @notice A structure describing a hook
    struct Hook {
        /// @notice The address of the hook contract
        address account;
        /// @notice The error handling policy of the hook
        ErrorHandlingPolicy policy;
    }

    /// @notice An enumeration describing the error handling policy of a hook
    enum ErrorHandlingPolicy {
        Revert,
        Event
    }

    /**
     * @notice Updates the `beforeTokenTransfer` hooks attached to the token
     * @param hooks The hooks to be attached
     */
    function updateBeforeTokenTransferHooks(Hook[] memory hooks) external;

    /**
     * @notice Updates the `afterTokenTransfer` hooks attached to the token
     * @param hooks The hooks to be attached
     */
    function updateAfterTokenTransferHooks(Hook[] memory hooks) external;

    /**
     * @notice Returns the array of `beforeTokenTransfer` hooks attached to the token
     */
    function getBeforeTokenTransferHooks() external view returns (Hook[] memory);

    /**
     * @notice Returns the array of `afterTokenTransfer` hooks attached to the token
     */
    function getAfterTokenTransferHooks() external view returns (Hook[] memory);
}
