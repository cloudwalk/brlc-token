// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

/**
 * @title IVersionable interface
 * @author CloudWalk Inc. (See https://cloudwalk.io)
 * @dev Defines the function to get the contract version.
 */
interface IVersionable {
    /**
     * @dev The struct for the contract version.
     */
    struct Version {
        uint16 major; // -- The major version of contract
        uint16 minor; // -- The minor version of contract
        uint16 patch; // -- The patch version of contract
    }

    /**
     * @dev Returns the version of the contract.
     */
    function $__VERSION() external pure returns (Version memory);
}
