// SPDX-License-Identifier: MIT

pragma solidity >=0.6.0 <0.8.0;

import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

/**
 * @title WhitelistableUpgradeable base contract
 * @notice Allows accounts to be whitelisted by a "whitelister" role
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
     * @notice Throws if called by any account other than the whitelist admin
     */
    modifier onlyWhitelistAdmin() {
        require(
            getWhitelistAdmin() == _msgSender(),
            "Whitelistable: caller is not the whitelist admin"
        );
        _;
    }

    /**
     * @notice Throws if called by any account other than the whitelister
     */
    modifier onlyWhitelister() {
        require(
            isWhitelister(_msgSender()),
            "Whitelistable: caller is not the whitelister"
        );
        _;
    }

    /**
     * @notice Throws if whitelist is enabled and argument account is not whitelisted
     * @param account The address to check.
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
     * @notice Returns whitelist admin address
     */
    function getWhitelistAdmin() public view virtual returns (address) {
        return _whitelistAdmin;
    }

    /**
     * @notice Checks if account is whitelisted
     * @param account The address to check.
     * @return True if whitelisted.
     */
    function isWhitelisted(address account) public view returns (bool) {
        return _whitelisted[account];
    }

    /**
     * @notice Adds account to whitelist
     * Can only be called by the whitelister
     * Emits an {Whitelisted} event
     * @param account The address to whitelist
     */
    function whitelist(address account) external onlyWhitelister {
        _whitelisted[account] = true;
        emit Whitelisted(account);
    }

    /**
     * @notice Removes account from whitelist
     * Can only be called by the whitelister
     * Emits an {UnWhitelisted} event
     * @param account The address to remove from the whitelist
     */
    function unWhitelist(address account) external onlyWhitelister {
        _whitelisted[account] = false;
        emit UnWhitelisted(account);
    }

    /**
     * @notice Updates whitelist admin address
     * Can only be called by the contract owner
     * Emits an {WhitelistAdminChanged} event
     * @param newWhitelistAdmin The address of new whitelist admin
     */
    function setWhitelistAdmin(address newWhitelistAdmin) external onlyOwner {
        _whitelistAdmin = newWhitelistAdmin;
        emit WhitelistAdminChanged(_whitelistAdmin);
    }

    /**
     * @notice Returns True if whitelist is enabled
     */
    function isWhitelistEnabled() public view virtual returns (bool);

    /**
     * @notice Returns True if account is a whitelister
     */
    function isWhitelister(address account) public view virtual returns (bool);
}
