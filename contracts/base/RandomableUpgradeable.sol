// SPDX-License-Identifier: MIT

pragma solidity >=0.6.0 <0.8.0;

import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {IRandomProvider} from "./interfaces/IRandomProvider.sol";

/**
 * @title RandomableUpgradeable base contract
 */
abstract contract RandomableUpgradeable is OwnableUpgradeable {
    address private _randomProvider;

    event RandomProviderChanged(address indexed randomProvider);

    function __Randomable_init() internal initializer {
        __Context_init_unchained();
        __Ownable_init_unchained();
        __Randomable_init_unchained();
    }

    function __Randomable_init_unchained() internal initializer {}

    /**
     * @dev Requests and returns random number form random provider.
     */
    function _getRandomness() internal view returns (uint256) {
        return IRandomProvider(_randomProvider).getRandomness();
    }

    /**
     * @dev Updates randomProvider address.
     * Can only be called by the contract owner.
     * Emits an {RandomProviderChanged} event.
     */
    function setRandomProvider(address newRandomProvider) external onlyOwner {
        _randomProvider = newRandomProvider;
        emit RandomProviderChanged(_randomProvider);
    }

    /**
     * @dev Returns randomProvider address.
     */
    function getRandomProvider() external view returns (address) {
        return _randomProvider;
    }
}
