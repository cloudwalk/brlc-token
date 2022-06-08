// SPDX-License-Identifier: MIT

pragma solidity >=0.6.0 <0.8.0;

import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

/**
 * @title WhitelistableUpgradeable base contract
 * @dev Allows accounts to be whitelisted by a "whitelister" role.
 */
abstract contract WhitelistableUpgradeable is OwnableUpgradeable {
    address private _whitelistAdmin;
    mapping(address => bool) private _whitelisted;

    event Whitelisted(address indexed account);
    event UnWhitelisted(address indexed account);
    event WhitelistAdminChanged(address indexed newWhitelistAdmin);

    function __Whitelistable_init() internal initializer {
        __Context_init_unchained();
        __Ownable_init_unchained();
        __Whitelistable_init_unchained();
    }

    function __Whitelistable_init_unchained() internal initializer {}

    /**
     * @dev Throws if called by any account other than the whitelist admin.
     */
    modifier onlyWhitelistAdmin() {
        require(
            getWhitelistAdmin() == _msgSender(),
            "Whitelistable: caller is not the whitelist admin"
        );
        _;
    }

    /**
     * @dev Throws if called by any account other than the whitelister.
     */
    modifier onlyWhitelister() {
        require(
            isWhitelister(_msgSender()),
            "Whitelistable: caller is not the whitelister"
        );
        _;
    }

    /**
     * @dev Throws if the whitelist is enabled and the argument account is not whitelisted.
     * @param account An address to check.
     */
    modifier onlyWhitelisted(address account) {
        if (isWhitelistEnabled()) {
            require(
                _whitelisted[account],
                "Whitelistable: account is not whitelisted"
            );
        }
        _;
    }

    /**
     * @dev Returns the whitelist admin address.
     */
    function getWhitelistAdmin() public view virtual returns (address) {
        return _whitelistAdmin;
    }

    /**
     * @dev Checks if an account is whitelisted.
     * @param account An address to check.
     * @return True if whitelisted.
     */
    function isWhitelisted(address account) public view returns (bool) {
        return _whitelisted[account];
    }

    /**
     * @dev Adds account to the whitelist.
     * Can only be called by the whitelister.
     * Emits a {Whitelisted} event.
     * @param account An address to whitelist.
     */
    function whitelist(address account) external onlyWhitelister {
        _whitelisted[account] = true;
        emit Whitelisted(account);
    }

    /**
     * @dev Removes account from the whitelist.
     * Can only be called by the whitelister.
     * Emits an {UnWhitelisted} event.
     * @param account An address to remove from the whitelist.
     */
    function unWhitelist(address account) external onlyWhitelister {
        _whitelisted[account] = false;
        emit UnWhitelisted(account);
    }

    /**
     * @dev Updates the whitelist admin address.
     * Can only be called by the contract owner.
     * Emits a {WhitelistAdminChanged} event.
     * @param newWhitelistAdmin The address of a new whitelist admin.
     */
    function setWhitelistAdmin(address newWhitelistAdmin) external onlyOwner {
        _whitelistAdmin = newWhitelistAdmin;
        emit WhitelistAdminChanged(_whitelistAdmin);
    }

    /**
     * @dev Returns True if the whitelist is enabled.
     */
    function isWhitelistEnabled() public view virtual returns (bool);

    /**
     * @dev Returns True if an account is a whitelister.
     */
    function isWhitelister(address account) public view virtual returns (bool);
}
