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
    /// @notice The structure that represents balacklistable contract storage
    struct BlacklistableStorageSlot {
        /// @notice The mapping of presence in the blacklist for a given address
        mapping(address => bool) blacklisters;
        /// @notice The enabled/disabled status of the blacklist
        bool enabled;
    }

    /// @notice The memory slot used to store the blacklistable contract storage
    bytes32 private constant _BLACKLISTABLE_STORAGE_SLOT =
        0xff11fdfa16fed3260ed0e7147f7cc6da11a60208b5b9406d12a635614ffd9141;

    /// @notice The address of the blacklister that is allowed to add and remove accounts from the blacklist
    address private _mainBlacklister;

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
     * @notice Emitted when the main blacklister was changed
     *
     * @param newMainBlacklister The address of the new main blacklister
     */
    event MainBlackListerChanged(address indexed newMainBlacklister);

    /**
     * @notice Emitted when the blacklister configuration is updated
     *
     * @param blacklister The address of the blacklister
     * @param status The new status of the blacklister
     */
    event BlacklisterConfigured(address indexed blacklister, bool status);

    /**
     * @notice Emitted when the blacklist is enabled or disabled
     *
     * @param status The new enabled/disabled status of the blacklist
     */
    event BlacklistEnabled(bool indexed status);

    // -------------------- Errors -----------------------------------

    /**
     * @notice The transaction sender is not a blacklister
     *
     * @param account The address of the transaction sender
     */
    error UnauthorizedBlacklister(address account);

    /**
     * @notice The transaction sender is not a main blacklister
     *
     * @param account The address of the transaction sender
     */
    error UnauthorizedMainBlacklister(address account);

    /**
     * @notice The account is blacklisted
     *
     * @param account The address of the blacklisted account
     */
    error BlacklistedAccount(address account);

    /**
     * @notice The address to blacklist is zero address
     */
    error ZeroAddressToBlacklist();

    /**
     * @notice The account is already configured
     */
    error AlreadyConfigured();

    // -------------------- Modifiers --------------------------------

    /**
     * @notice Throws if called by any account other than the blacklister or main blacklister
     */
    modifier onlyBlacklister() {
        address sender = _msgSender();
        if (!isBlacklister(sender) && sender != _mainBlacklister) {
            revert UnauthorizedBlacklister(_msgSender());
        }
        _;
    }

    /**
     * @notice Throws if called by any account other than the main blacklister
     */
    modifier onlyMainBlacklister() {
        if (_msgSender() != _mainBlacklister) {
            revert UnauthorizedMainBlacklister(_msgSender());
        }
        _;
    }

    /**
     * @notice Throws if the account is blacklisted
     *
     * @param account The address to check for presence in the blacklist
     */
    modifier notBlacklisted(address account) {
        if (_blacklisted[account] && isBlacklistEnabled()) {
            revert BlacklistedAccount(account);
        }
        _;
    }

    /**
     * @notice Throws if the account is blacklisted, but allows the blacklister to bypass the check
     *
     * @param account The address to check for presence in the blacklist
     */
    modifier notBlacklistedOrBypassIfBlacklister(address account) {
        if (_blacklisted[account] && isBlacklistEnabled() && !isBlacklister(_msgSender())) {
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
            revert ZeroAddressToBlacklist();
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
     * @notice Enables or disables the blacklist
     *
     * Requirements:
     *
     * - Can only be called by the owner
     *
     * Emits a {BlacklistEnabled} event
     *
     * @param status The new enabled/disabled status of the blacklist
     */
    function enableBlacklist(bool status) external onlyOwner {
        BlacklistableStorageSlot storage storageSlot = _getBlacklistableSlot(_BLACKLISTABLE_STORAGE_SLOT);
        if (storageSlot.enabled == status) {
            revert AlreadyConfigured();
        }

        storageSlot.enabled = status;
        emit BlacklistEnabled(status);
    }

    /**
     * @notice Updates the main blacklister address
     *
     * Requirements:
     *
     * - Can only be called by the owner
     *
     * Emits a {MainBlackListerChanged} event
     *
     * @param newMainBlacklister The address of the new main blacklister
     */
    function setMainBlacklister(address newMainBlacklister) external onlyOwner {
        if (_mainBlacklister == newMainBlacklister) {
            revert AlreadyConfigured();
        }

        _mainBlacklister = newMainBlacklister;
        emit MainBlackListerChanged(newMainBlacklister);
    }

    /**
     * @notice Updates the blacklister address
     *
     * Requirements:
     *
     * - Can only be called by the main blacklister
     *
     * Emits a {BlacklisterConfigured} event
     *
     * @param account The address of the blacklister to be configured
     * @param status The new status of the blacklister
     */
    function configureBlacklister(address account, bool status) external onlyMainBlacklister {
        BlacklistableStorageSlot storage storageSlot = _getBlacklistableSlot(_BLACKLISTABLE_STORAGE_SLOT);
        if (storageSlot.blacklisters[account] == status) {
            revert AlreadyConfigured();
        }

        storageSlot.blacklisters[account] = status;
        emit BlacklisterConfigured(account, status);
    }

    /**
     * @notice Returns the address of the blacklister
     */
    function mainBlacklister() public view virtual returns (address) {
        return _mainBlacklister;
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

    /**
     * @notice Checks if the account is a blacklister
     *
     * @param account The address to check for blacklister configuration
     * @return True if the account is a configured blacklister, False otherwise
     */
    function isBlacklister(address account) public view returns (bool) {
        return _getBlacklistableSlot(_BLACKLISTABLE_STORAGE_SLOT).blacklisters[account];
    }

    /**
     * @notice Checks if the blacklist is enabled
     *
     * @return True if the blacklist is enabled, False otherwise
     */
    function isBlacklistEnabled() public view returns (bool) {
        return _getBlacklistableSlot(_BLACKLISTABLE_STORAGE_SLOT).enabled;
    }

    /**
     * @dev Returns an `MappingSlot` with member `value` located at `slot`
     */
    function _getBlacklistableSlot(bytes32 slot) internal pure returns (BlacklistableStorageSlot storage r) {
        /// @solidity memory-safe-assembly
        assembly {
            r.slot := slot
        }
    }
}
