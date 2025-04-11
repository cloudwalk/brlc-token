// SPDX-License-Identifier: MIT

pragma solidity ^0.8.8;

import { ERC20Bridgeable } from "../../base/ERC20Bridgeable.sol";

/**
 * @title ERC20BridgeableMock contract
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @notice An implementation of the {ERC20Bridgeable} contract for testing purposes
 */
contract ERC20BridgeableMock is ERC20Bridgeable {
    /**
     * @notice The initialize function of the upgradable contract
     *
     * See details https://docs.openzeppelin.com/upgrades-plugins/1.x/writing-upgradeable
     *
     * @param name_ The name of the token
     * @param symbol_ The symbol of the token
     * @param bridge_ The address of the bridge contract
     */
    function initialize(string memory name_, string memory symbol_, address bridge_) public initializer {
        __ERC20Base_init(name_, symbol_);
        __ERC20Bridgeable_init_unchained(bridge_);
    }

    /**
     * @notice Needed to check that the unchained initialize function of the ancestor contract
     * has the 'onlyInitializing' modifier
     *
     * @param bridge_ The address of the bridge contract
     */
    function call_parent_initialize_unchained(address bridge_) public {
        __ERC20Bridgeable_init_unchained(bridge_);
    }
}
