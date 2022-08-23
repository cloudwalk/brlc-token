// SPDX-License-Identifier: MIT

pragma solidity 0.8.16;

import { OwnableUpgradeable } from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import { PausableUpgradeable } from "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";

/**
 * @title PausableExUpgradeable base contract
 * @dev Extends OpenZeppelin's PausableUpgradeable contract.
 */
abstract contract PausableExUpgradeable is OwnableUpgradeable, PausableUpgradeable {
    address private _pauser;

    event PauserChanged(address indexed pauser);

    error UnauthorizedPauser(address account);

    function __PausableEx_init() internal onlyInitializing {
        __Context_init_unchained();
        __Ownable_init_unchained();
        __Pausable_init_unchained();
        __PausableEx_init_unchained();
    }

    function __PausableEx_init_unchained() internal onlyInitializing {}

    /**
     * @dev Throws if called by any account other than the pauser.
     */
    modifier onlyPauser() {
        if (_msgSender() != _pauser) {
            revert UnauthorizedPauser(_msgSender());
        }
        _;
    }

    /**
     * @dev Returns the pauser address.
     */
    function pauser() public view virtual returns (address) {
        return _pauser;
    }

    /**
     * @dev Updates the pauser address.
     * Can only be called by the contract owner.
     * Emits a {PauserChanged} event.
     * @param newPauser The address of a new pauser.
     */
    function setPauser(address newPauser) external onlyOwner {
        if (_pauser == newPauser) {
            return;
        }

        _pauser = newPauser;

        emit PauserChanged(_pauser);
    }

    /**
     * @dev Triggers the paused state.
     * Can only be called by the pauser account.
     * Requirements:
     * - The contract must not be paused.
     */
    function pause() external onlyPauser {
        _pause();
    }

    /**
     * @dev Triggers the unpaused state.
     * Can only be called by the pauser account.
     * Requirements:
     * - The contract must be paused.
     */
    function unpause() external onlyPauser {
        _unpause();
    }
}
