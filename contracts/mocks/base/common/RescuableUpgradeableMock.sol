// SPDX-License-Identifier: MIT

pragma solidity ^0.8.20;

import { UUPSUpgradeable } from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

import { RescuableUpgradeable } from "../../../base/common/RescuableUpgradeable.sol";

/**
 * @title RescuableUpgradeableMock contract
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev An implementation of the {RescuableUpgradeable} contract for test purposes.
 */
contract RescuableUpgradeableMock is RescuableUpgradeable, UUPSUpgradeable {
    /// @dev The role of this contract owner.
    bytes32 public constant OWNER_ROLE = keccak256("OWNER_ROLE");

    // ------------------ Initializers ---------------------------- //

    /**
     * @dev The initialize function of the upgradable contract.
     *
     * See details: https://docs.openzeppelin.com/upgrades-plugins/writing-upgradeable
     */
    function initialize() public initializer {
        __Rescuable_init(OWNER_ROLE);

        _grantRole(OWNER_ROLE, _msgSender());

        // Only to provide the 100 % test coverage
        _authorizeUpgrade(address(0));
    }

    // ------------------ Transactional functions ----------------- //

    /// @dev Calls the parent internal initializing function to verify the 'onlyInitializing' modifier.
    function callParentInitializer() external {
        __Rescuable_init(OWNER_ROLE);
    }

    /// @dev Calls the parent internal unchained initializing function to verify the 'onlyInitializing' modifier.
    function callParentInitializerUnchained() external {
        __Rescuable_init_unchained(OWNER_ROLE);
    }

    // ------------------ Internal functions ---------------------- //

    /**
     * @dev The implementation of the upgrade authorization function of the parent UUPSProxy contract.
     * @param newImplementation The address of the new implementation.
     */
    function _authorizeUpgrade(address newImplementation) internal pure override {
        newImplementation; // Suppresses a compiler warning about the unused variable
    }
}
