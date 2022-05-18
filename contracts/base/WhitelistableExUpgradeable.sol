// SPDX-License-Identifier: MIT

pragma solidity >=0.6.0 <0.8.0;

import {WhitelistableUpgradeable} from "./WhitelistableUpgradeable.sol";

/**
 * @title WhitelistableExUpgradeable base contract
 * @dev Extends the WhitelistableUpgradeable contract.
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
     * @dev Checks if the whitelister is enabled.
     * @return True if enabled.
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
     * @dev Checks if the whitelist is enabled.
     * @return True if enabled.
     */
    function isWhitelistEnabled() public view override returns (bool) {
        return _isWhitelistEnabled;
    }

    /**
     * @dev Updates the whitelister address.
     * Can only be called by the whitelist admin.
     * Emits a {WhitelisterChanged} event.
     * @param whitelister The address of a whitelister.
     * @param enabled True if a whitelister is enabled.
     */
    function updateWhitelister(address whitelister, bool enabled)
        public
        onlyWhitelistAdmin
    {
        _whitelisters[whitelister] = enabled;
        emit WhitelisterChanged(whitelister, enabled);
    }

    /**
     * @dev Allows to enable or disable the whitelist.
     * Can only be called by the contract owner.
     * Emits a {WhitelistEnabled} event.
     * @param enabled True for enabling, False - for disabling.
     */
    function setWhitelistEnabled(bool enabled) public onlyOwner {
        _isWhitelistEnabled = enabled;
        emit WhitelistEnabled(_isWhitelistEnabled);
    }
}
