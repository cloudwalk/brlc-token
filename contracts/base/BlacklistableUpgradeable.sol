// SPDX-License-Identifier: MIT

pragma solidity 0.8.16;

import { OwnableUpgradeable } from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

/**
 * @title BlacklistableUpgradeable base contract
 * @dev Allows accounts to be blacklisted by a "blacklister" role.
 */
abstract contract BlacklistableUpgradeable is OwnableUpgradeable {
    address private _blacklister;
    mapping(address => bool) private _blacklisted;

    event Blacklisted(address indexed account);
    event UnBlacklisted(address indexed account);
    event SelfBlacklisted(address indexed account);
    event BlacklisterChanged(address indexed newBlacklister);

    function __Blacklistable_init() internal initializer {
        __Context_init_unchained();
        __Ownable_init_unchained();
        __Blacklistable_init_unchained();
    }

    function __Blacklistable_init_unchained() internal initializer {}

    /**
     * @dev Throws if called by any account other than the blacklister.
     */
    modifier onlyBlacklister() {
        require(getBlacklister() == _msgSender(), "Blacklistable: caller is not the blacklister");
        _;
    }

    /**
     * @dev Throws if an argument account is blacklisted.
     * @param account An address to check.
     */
    modifier notBlacklisted(address account) {
        require(!_blacklisted[account], "Blacklistable: account is blacklisted");
        _;
    }

    /**
     * @dev Returns the blacklister address.
     */
    function getBlacklister() public view virtual returns (address) {
        return _blacklister;
    }

    /**
     * @dev Checks if an account is blacklisted.
     * @param account An address to check.
     * @return True if blacklisted.
     */
    function isBlacklisted(address account) public view returns (bool) {
        return _blacklisted[account];
    }

    /**
     * @dev Adds an account to blacklist.
     * Can only be called by the blacklister.
     * Emits a {Blacklisted} event.
     * @param account An address to blacklist.
     */
    function blacklist(address account) external onlyBlacklister {
        _blacklisted[account] = true;
        emit Blacklisted(account);
    }

    /**
     * @dev Removes an account from blacklist.
     * Can only be called by the blacklister.
     * Emits a {Blacklisted} event.
     * @param account An address to remove from the blacklist.
     */
    function unBlacklist(address account) external onlyBlacklister {
        _blacklisted[account] = false;
        emit UnBlacklisted(account);
    }

    /**
     * @dev Updates the blacklister address.
     * Can only be called by the contract owner.
     * Emits a {BlacklisterChanged} event.
     * @param newBlacklister The address of a new blacklister.
     */
    function setBlacklister(address newBlacklister) external onlyOwner {
        require(newBlacklister != address(0), "Blacklistable: new blacklister is the zero address");
        _blacklister = newBlacklister;
        emit BlacklisterChanged(_blacklister);
    }

    /**
     * @dev Adds _msgSender() to the blacklist (self-blacklist).
     * Emits a {SelfBlacklisted} event.
     * Emits a {Blacklisted} event.
     */
    function selfBlacklist() external {
        _blacklisted[_msgSender()] = true;
        emit SelfBlacklisted(_msgSender());
        emit Blacklisted(_msgSender());
    }
}
