// SPDX-License-Identifier: MIT

pragma solidity >=0.6.0 <0.8.0;

import {WhitelistableUpgradeable} from "./WhitelistableUpgradeable.sol";

/**
 * @title WhitelistableExUpgradeable base contract
 * @notice Extends WhitelistableUpgradeable contract
 */
abstract contract WhitelistableExUpgradeable is WhitelistableUpgradeable {
    bool private _isWhitelistEnabled;
    mapping(address => bool) private _whitelisters;

    event WhitelistEnabled(bool enabled);
    event WhitelisterChanged(address indexed whitelister, bool enabled);

    function __WhitelistableEx_init() internal initializer {
        __Context_init_unchained();
        __Ownable_init_unchained();
        __Whitelistable_init_unchained();
        __WhitelistableEx_init_unchained();
    }

    function __WhitelistableEx_init_unchained() internal initializer {}

    /**
     * @notice Checks if whitelister is enabled
     * @return True if enabled
     */
    function isWhitelister(address account)
        public
        view
        override
        returns (bool)
    {
        return _whitelisters[account];
    }

    /**
     * @notice Checks if whitelist is enabled
     * @return True if enabled
     */
    function isWhitelistEnabled() public view override returns (bool) {
        return _isWhitelistEnabled;
    }

    /**
     * @notice Updates whitelister address
     * Can only be called by the whitelist admin
     * Emits an {WhitelisterChanged} event
     * @param whitelister The address of the whitelister
     * @param enabled True if whitelister is enabled
     */
    function updateWhitelister(address whitelister, bool enabled)
        public
        onlyWhitelistAdmin
    {
        _whitelisters[whitelister] = enabled;
        emit WhitelisterChanged(whitelister, enabled);
    }

    /**
     * @notice Allows to enable or disable whitelist
     * Can only be called by the contract owner
     * Emits an {WhitelistEnabled} event
     * @param enabled True for enabling, False - for disabling
     */
    function setWhitelistEnabled(bool enabled) public onlyOwner {
        _isWhitelistEnabled = enabled;
        emit WhitelistEnabled(_isWhitelistEnabled);
    }
}
