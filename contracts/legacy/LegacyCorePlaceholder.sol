// SPDX-License-Identifier: MIT

pragma solidity ^0.8.4;

import { LegacyBlocklistablePlaceholder } from "./core/LegacyBlocklistablePlaceholder.sol";
import { LegacyInitializablePlaceholder } from "./core/LegacyInitializablePlaceholder.sol";
import { LegacyOwnablePlaceholder } from "./core/LegacyOwnablePlaceholder.sol";
import { LegacyPausablePlaceholder } from "./core/LegacyPausablePlaceholder.sol";
import { LegacyRescuablePlaceholder } from "./core/LegacyRescuablePlaceholder.sol";

/**
 * @title LegacyCorePlaceholder contract
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev Safely replaces the storage of the several obsolete core smart contracts.
 *
 * This contract is used through inheritance. It has the same storage as the smart contracts it replaces,
 * and also contains all of its events and custom errors for backward compatibility when searching in databases.
 *
 * For details see each legacy placeholder contract that this contract inherits from.
 */
abstract contract LegacyCorePlaceholder is
    LegacyInitializablePlaceholder,
    LegacyOwnablePlaceholder,
    LegacyRescuablePlaceholder,
    LegacyPausablePlaceholder,
    LegacyBlocklistablePlaceholder
{}
