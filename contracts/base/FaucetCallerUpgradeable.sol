// SPDX-License-Identifier: MIT

pragma solidity >=0.6.0 <0.8.0;

import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {IFaucet} from "./interfaces/IFaucet.sol";

/**
 * @title FaucetCallerUpgradeable base contract
 * @dev Allows accounts to renew their native balance.
 */
abstract contract FaucetCallerUpgradeable is OwnableUpgradeable {
    address private _faucet;

    event FaucetChanged(address indexed faucet);

    function __FaucetCaller_init() internal initializer {
        __Context_init_unchained();
        __Ownable_init_unchained();
        __FaucetCaller_init_unchained();
    }

    function __FaucetCaller_init_unchained() internal initializer {}

    /**
     * @dev Renews recipient's native balance.
     * @param recipient The address of recipient.
     */
    function _faucetRequest(address recipient) internal {
        if (_faucet != address(0)) {
            IFaucet(_faucet).withdraw(payable(recipient));
        }
    }

    /**
     * @dev Returns faucet address.
     */
    function getFaucet() external view returns (address) {
        return _faucet;
    }

    /**
     * @dev Updates faucet contract address.
     * Can only be called by the contract owner.
     * Emits an {FaucetChanged} event.
     * @param newFaucet The address of faucet contract.
     */
    function setFaucet(address newFaucet) external onlyOwner {
        if (newFaucet != address(0)) {
            require(
                IFaucet(newFaucet).isFaucet(),
                "FaucetCaller: address isn't faucet"
            );
        }
        _faucet = newFaucet;
        emit FaucetChanged(_faucet);
    }
}
