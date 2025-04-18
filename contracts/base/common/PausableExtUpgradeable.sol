// SPDX-License-Identifier: MIT

pragma solidity ^0.8.4;

import { OwnableUpgradeable } from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import { PausableUpgradeable } from "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";

/**
 * @title PausableExtUpgradeable base contract
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @notice Extends the OpenZeppelin's {PausableUpgradeable} contract by adding the `pauser` account
 * @dev This contract is used through inheritance. It introduces the `pauser` role that is allowed to
 * trigger the paused or unpaused state of the contract that is inherited from this one.
 */
abstract contract PausableExtUpgradeable is OwnableUpgradeable, PausableUpgradeable {
    /// @notice The address of the pauser that is allowed to trigger the paused or unpaused state of the contract
    address private _pauser;

    // -------------------- Events -----------------------------------

    /**
     * @notice Emitted when the pauser is changed
     *
     * @param pauser The address of the new pauser
     */
    event PauserChanged(address indexed pauser);

    // -------------------- Errors -----------------------------------

    /**
     * @notice The transaction sender is not a pauser
     *
     * @param account The address of the transaction sender
     */
    error UnauthorizedPauser(address account);

    // -------------------- Modifiers --------------------------------

    /**
     * @notice Throws if called by any account other than the pauser
     */
    modifier onlyPauser() {
        if (_msgSender() != _pauser) {
            revert UnauthorizedPauser(_msgSender());
        }
        _;
    }

    // -------------------- Initializers -----------------------------

    /**
     * @notice The unchained internal initializer of the upgradable contract
     *
     * @dev See details: https://docs.openzeppelin.com/contracts/4.x/upgradeable#multiple-inheritance
     *
     * Note: The `..._init()` initializer has not been provided as redundant.
     */
    function __PausableExt_init_unchained() internal onlyInitializing {}

    // -------------------- Functions --------------------------------

    /**
     * @notice Triggers the paused state of the contract
     *
     * Requirements:
     *
     * - Can only be called by the contract pauser
     */
    function pause() external onlyPauser {
        _pause();
    }

    /**
     * @notice Triggers the unpaused state of the contract
     *
     * Requirements:
     *
     * - Can only be called by the contract pauser
     */
    function unpause() external onlyPauser {
        _unpause();
    }

    /**
     * @notice Updates the pauser address
     *
     * Requirements:
     *
     * - Can only be called by the contract owner
     *
     * Emits a {PauserChanged} event
     *
     * @param newPauser The address of a new pauser
     */
    function setPauser(address newPauser) external onlyOwner {
        if (_pauser == newPauser) {
            return;
        }

        _pauser = newPauser;

        emit PauserChanged(newPauser);
    }

    /**
     * @notice Returns the pauser address
     */
    function pauser() public view virtual returns (address) {
        return _pauser;
    }
}
