// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

/**
 * @title IVersionable interface
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev Defines code entities to get the version of a contract.
 */
interface IVersionable {
    // ------------------ Types ---------------------------------- //

    /**
     * @dev Defines the version of a contract.
     *
     * The fields:
     *
     * - major -- The major version of the contract.
     * - minor -- The minor version of the contract.
     * - patch -- The patch version of the contract.
     */
    struct Version {
        uint16 major;
        uint16 minor;
        uint16 patch;
    }

    // ------------------ Pure functions -------------------------- //

    /// @dev Returns the version of the contract.
    function $__VERSION() external pure returns (Version memory);
}
