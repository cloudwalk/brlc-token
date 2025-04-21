// SPDX-License-Identifier: MIT

pragma solidity ^0.8.20;

import { UUPSUpgradeable } from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

import { OwnableUpgradeable } from "../../../base/common/OwnableUpgradeable.sol";

/**
 * @title AccessControlExtUpgradeableMock contract
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev An implementation of the {OwnableUpgradeable} contract for test purposes.
 */
contract OwnableUpgradeableMock is OwnableUpgradeable, UUPSUpgradeable {
    // ------------------ Initializers ---------------------------- //

    /**
     * @dev The initialize function of the upgradable contract.
     *
     * See details: https://docs.openzeppelin.com/upgrades-plugins/writing-upgradeable
     */
    function initialize() public initializer {
        __Ownable_init_unchained(); // This is needed only to avoid errors during coverage assessment

        _grantRole(OWNER_ROLE, _msgSender());

        // Only to provide the 100 % test coverage
        _authorizeUpgrade(address(0));
    }

    // ------------------ Transactional functions ----------------- //

    /// @dev Calls the parent internal unchained initializing function to verify the 'onlyInitializing' modifier.
    function callParentInitializerUnchained() external {
        __Ownable_init_unchained();
    }

    // ------------------ Pure functions -------------------------- //

    /// @dev This function is used to check that the 'onlyOwner' modifier works correctly.
    function checkModifierOnlyOwner() external view onlyOwner returns (bool) {
        return true;
    }

    // ------------------ Internal functions ---------------------- //

    /**
     * @dev The implementation of the upgrade authorization function of the parent UUPSProxy contract.
     * @param newImplementation The address of the new implementation.
     */
    function _authorizeUpgrade(address newImplementation) internal pure override {
        newImplementation; // Suppresses a compiler warning about the unused variable.
    }
}
