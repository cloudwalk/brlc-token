// SPDX-License-Identifier: MIT

pragma solidity >=0.6.0 <0.8.0;

import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";

/**
 * @title PausableExUpgradeable base contract
 * @notice Extends OpenZeppelin's PausableUpgradeable contract
 */
abstract contract PausableExUpgradeable is
    OwnableUpgradeable,
    PausableUpgradeable
{
    address private _pauser;

    event PauserChanged(address indexed pauser);

    function __PausableEx_init() internal initializer {
        __Context_init_unchained();
        __Ownable_init_unchained();
        __Pausable_init_unchained();
        __PausableEx_init_unchained();
    }

    function __PausableEx_init_unchained() internal initializer {}

    /**
     * @notice Throws if called by any account other than the pauser
     */
    modifier onlyPauser() {
        require(
            getPauser() == _msgSender(),
            "PausableEx: caller is not the pauser"
        );
        _;
    }

    /**
     * @notice Returns pauser address
     */
    function getPauser() public view virtual returns (address) {
        return _pauser;
    }

    /**
     * @notice Updates pauser address
     * Can only be called by the contract owner
     * Emits an {PauserChanged} event
     * @param newPauser The address of new pauser
     */
    function setPauser(address newPauser) external onlyOwner {
        _pauser = newPauser;
        emit PauserChanged(_pauser);
    }

    /**
     * @notice Triggers paused state
     * Can only be called by the pauser account
     * Requirements:
     * - The contract must not be paused
     */
    function pause() external onlyPauser {
        _pause();
    }

    /**
     * @notice Triggers unpaused state
     * Can only be called by the pauser account
     * Requirements:
     * - The contract must be paused
     */
    function unpause() external onlyPauser {
        _unpause();
    }
}