// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

import "./interfaces/IVersionable.sol";

/**
 * @title Versionable base contract
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev Defines the contract version.
 */
abstract contract Versionable is IVersionable {
    /// @inheritdoc IVersionable
    function $__VERSION() external pure returns (Version memory) {
        return Version(1, 5, 1);
    }
}
