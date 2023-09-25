// SPDX-License-Identifier: MIT

pragma solidity 0.8.16;

import { OwnableUpgradeable } from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

/**
 * @title BlacklistableUpgradeable base contract
 * @author CloudWalk Inc.
 * @notice Allows to blacklist and unblacklist accounts using the `blacklister` account
 * @dev This contract is used through inheritance. It makes available the modifier `notBlacklisted`,
 * which can be applied to functions to restrict their usage to not blacklisted accounts only.
 */
abstract contract BlacklistableUpgradeable is OwnableUpgradeable {
    /// @notice The address of the blacklister that is allowed to add and remove accounts from the blacklist
    address private _blacklister;

    /// @notice Mapping of presence in the blacklist for a given address
    mapping(address => bool) private _blacklisted;

    // -------------------- Events -----------------------------------

    /**
     * @notice Emitted when an account is blacklisted
     *
     * @param account The address of the blacklisted account
     */
    event Blacklisted(address indexed account);

    /**
     * @notice Emitted when an account is unblacklisted
     *
     * @param account The address of the unblacklisted account
     */
    event UnBlacklisted(address indexed account);

    /**
     * @notice Emitted when an account is self blacklisted
     *
     * @param account The address of the self blacklisted account
     */
    event SelfBlacklisted(address indexed account);

    /**
     * @notice Emitted when the blacklister is changed
     *
     * @param newBlacklister The address of the new blacklister
     */
    event BlacklisterChanged(address indexed newBlacklister);

    // -------------------- Errors -----------------------------------

    /**
     * @notice The transaction sender is not a blacklister
     *
     * @param account The address of the transaction sender
     */
    error UnauthorizedBlacklister(address account);

    /**
     * @notice The account is blacklisted
     *
     * @param account The address of the blacklisted account
     */
    error BlacklistedAccount(address account);

    /**
     * @notice The address to blacklist is zero address
    */
    error ZeroAddressBlacklisted();

    // -------------------- Modifiers --------------------------------

    /**
     * @notice Throws if called by any account other than the blacklister
     */
    modifier onlyBlacklister() {
        if (_msgSender() != _blacklister) {
            revert UnauthorizedBlacklister(_msgSender());
        }
        _;
    }

    /**
     * @notice Throws if called by a blacklisted account
     *
     * @param account The address to check for presence in the blacklist
     */
    modifier notBlacklisted(address account) {
        if (_blacklisted[account]) {
            revert BlacklistedAccount(account);
        }
        _;
    }

    // -------------------- Functions --------------------------------

    /**
     * @notice The internal initializer of the upgradable contract
     *
     * See details https://docs.openzeppelin.com/upgrades-plugins/1.x/writing-upgradeable
     */
    function __Blacklistable_init() internal onlyInitializing {
        __Context_init_unchained();
        __Ownable_init_unchained();
        __Blacklistable_init_unchained();
    }

    /**
     * @notice The unchained internal initializer of the upgradable contract
     *
     * See {BlacklistableUpgradeable-__Blacklistable_init}
     */
    function __Blacklistable_init_unchained() internal onlyInitializing {}

    /**
     * @notice Adds an account to the blacklist
     *
     * Requirements:
     *
     * - Can only be called by the blacklister account
     *
     * Emits a {Blacklisted} event
     *
     * @param account The address to blacklist
     */
    function blacklist(address account) external onlyBlacklister {
        if (account == address(0)) {
            revert ZeroAddressBlacklisted();
        }
        if (_blacklisted[account]) {
            return;
        }

        _blacklisted[account] = true;

        emit Blacklisted(account);
    }

    /**
     * @notice Removes an account from the blacklist
     *
     * Requirements:
     *
     * - Can only be called by the blacklister account
     *
     * Emits an {UnBlacklisted} event
     *
     * @param account The address to remove from the blacklist
     */
    function unBlacklist(address account) external onlyBlacklister {
        if (!_blacklisted[account]) {
            return;
        }

        _blacklisted[account] = false;

        emit UnBlacklisted(account);
    }

    /**
     * @notice Adds the transaction sender to the blacklist
     *
     * Emits a {SelfBlacklisted} event
     * Emits a {Blacklisted} event
     */
    function selfBlacklist() external {
        address sender = _msgSender();

        if (_blacklisted[sender]) {
            return;
        }

        _blacklisted[sender] = true;

        emit SelfBlacklisted(sender);
        emit Blacklisted(sender);
    }

    /**
     * @notice Updates the blacklister address
     *
     * Requirements:
     *
     * - Can only be called by the contract owner
     *
     * Emits a {BlacklisterChanged} event
     *
     * @param newBlacklister The address of a new blacklister
     */
    function setBlacklister(address newBlacklister) external onlyOwner {
        if (_blacklister == newBlacklister) {
            return;
        }

        _blacklister = newBlacklister;

        emit BlacklisterChanged(_blacklister);
    }

    /**
     * @notice Returns the address of the blacklister
     */
    function blacklister() public view virtual returns (address) {
        return _blacklister;
    }

    /**
     * @notice Checks if an account is present in the blacklist
     *
     * @param account The address to check for presence in the blacklist
     * @return True if the account is present in the blacklist, false otherwise
     */
    function isBlacklisted(address account) public view returns (bool) {
        return _blacklisted[account];
    }
}
