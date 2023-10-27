// SPDX-License-Identifier: MIT

pragma solidity 0.8.16;

import { OwnableUpgradeable } from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

/**
 * @title HarnessAdministrable contract
 * @author CloudWalk Inc.
 * @notice Provides the harness admin role for accounts to restrict access to some function of descendant contracts
 * @dev This contract is used through inheritance. It makes available the modifier `onlyHarnessAdmin`,
 * which can be applied to functions to restrict their usage
 * @dev This contract use a pseudo random storage slot to save its state, so no storage layout control is needed
 */
abstract contract HarnessAdministrable is OwnableUpgradeable {
    /// @notice The structure with the contract state
    struct HarnessAdministrableState {
        mapping(address => bool) harnessAdminStatuses;
    }

    /// @notice The memory slot used to store the contract state
    /// @dev It is the same as keccak256("harness administrable storage slot")
    bytes32 private constant _STORAGE_SLOT = 0xfe59a931f94e2aa9825bd975f0e041e1561aab13eea3c8ef2be9da7a34db16e2;

    // ----------------------- Events ------------------------------------------

    /**
     * @notice Emitted when configuration of a harness admin is updated
     *
     * @param harnessAdmin The address of the configured harness admin
     * @param status The new status of the harness admin
     */
    event HarnessAdminConfigured(address indexed harnessAdmin, bool status);

    // ----------------------- Errors ------------------------------------------

    /**
     * @notice The transaction sender is not a harness admin
     *
     * @param account The address of the transaction sender
     */
    error UnauthorizedHarnessAdmin(address account);

    // ----------------------- Modifiers ---------------------------------------

    /// @notice Throws if called by any account other than a harness admin
    modifier onlyHarnessAdmin() {
        _checkHarnessAdmin(_msgSender());
        _;
    }

    // ----------------------- Functions ---------------------------------------
    /**
     * @notice Updates configuration of a harness admin
     *
     * Requirements:
     *
     * - Can only be called by the contract owner
     *
     * Emits a {HarnessAdminConfigured} event if the configuration was changed
     *
     * @param account The address of the harness admin to be configured
     * @param newStatus The new status of the harness admin
     */
    function configureHarnessAdmin(address account, bool newStatus) external onlyOwner {
        _configureHarnessAdmin(account, newStatus);
    }

    /**
     * @notice Checks if an account is a harness admin
     *
     * @param account The account to check for the harness admin configuration
     * @return True if the account is a configured harness admin, False otherwise
     */
    function isHarnessAdmin(address account) external view returns (bool) {
        return _isHarnessAdmin(account);
    }

    /**
     * @notice Updates configuration of a harness admin internally
     *
     * Emits a {HarnessAdminConfigured} event if the configuration was changed
     *
     * @param account The address of the harness admin to be configured
     * @param newStatus The new status of the harness admin
     */
    function _configureHarnessAdmin(address account, bool newStatus) internal {
        HarnessAdministrableState storage state = _getHarnessAdministrableState();
        bool oldStatus = state.harnessAdminStatuses[account];
        if (oldStatus == newStatus) {
            return;
        }
        state.harnessAdminStatuses[account] = newStatus;
        emit HarnessAdminConfigured(account, newStatus);
    }

    /**
     * @notice Checks if an account is a harness admin internally and reverts if not
     *
     * @param account The account to check for the harness admin configuration
     */
    function _checkHarnessAdmin(address account) internal view {
        if (!_isHarnessAdmin(account)) {
            revert UnauthorizedHarnessAdmin(account);
        }
    }

    /**
     * @notice Checks if an account is a harness admin internally
     *
     * @param account The account to check for the harness admin configuration
     * @return True if the account is a configured harness admin, False otherwise
     */
    function _isHarnessAdmin(address account) internal view returns (bool) {
        HarnessAdministrableState storage state = _getHarnessAdministrableState();
        return state.harnessAdminStatuses[account];
    }

    /**
     * @notice Returns the contract stored state structure
     */
    function _getHarnessAdministrableState() internal pure returns (HarnessAdministrableState storage) {
        HarnessAdministrableState storage state;
        /// @solidity memory-safe-assembly
        assembly {
            state.slot := _STORAGE_SLOT
        }
        return state;
    }
}
