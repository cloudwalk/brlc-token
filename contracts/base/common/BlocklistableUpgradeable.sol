// SPDX-License-Identifier: MIT

pragma solidity 0.8.16;

import { OwnableUpgradeable } from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

/**
 * @title BlocklistableUpgradeable base contract
 * @author CloudWalk Inc.
 * @notice Allows to blocklist and unblocklist accounts using the `blocklister` account
 * @dev This contract is used through inheritance. It makes available the modifier `notBlocklisted`,
 * which can be applied to functions to restrict their usage to not blocklisted accounts only.
 */
abstract contract BlocklistableUpgradeable is OwnableUpgradeable {
    /// @notice The structure that represents blocklistable contract storage
    struct BlocklistableStorageSlot {
        /// @notice The mapping of presence in the blocklist for a given address
        mapping(address => bool) blocklisters;
        /// @notice The enabled/disabled status of the blocklist
        bool enabled;
    }

    /// @notice The memory slot used to store the blocklistable contract storage
    bytes32 private constant _BLOCKLISTABLE_STORAGE_SLOT =
        0xff11fdfa16fed3260ed0e7147f7cc6da11a60208b5b9406d12a635614ffd9141;

    /// @notice The address of the blocklister that is allowed to add and remove accounts from the blocklist
    address private _mainBlocklister;

    /// @notice Mapping of presence in the blocklist for a given address
    mapping(address => bool) private _blocklisted;

    // -------------------- Events -----------------------------------

    /**
     * @notice Emitted when an account is blocklisted
     *
     * @param account The address of the blocklisted account
     */
    event Blocklisted(address indexed account);

    /**
     * @notice Emitted when an account is unblocklisted
     *
     * @param account The address of the unblocklisted account
     */
    event UnBlocklisted(address indexed account);

    /**
     * @notice Emitted when an account is self blocklisted
     *
     * @param account The address of the self blocklisted account
     */
    event SelfBlocklisted(address indexed account);

    /**
     * @notice Emitted when the main blocklister was changed
     *
     * @param newMainBlocklister The address of the new main blocklister
     */
    event MainBlockListerChanged(address indexed newMainBlocklister);

    /**
     * @notice Emitted when the blocklister configuration is updated
     *
     * @param blocklister The address of the blocklister
     * @param status The new status of the blocklister
     */
    event BlocklisterConfigured(address indexed blocklister, bool status);

    /**
     * @notice Emitted when the blocklist is enabled or disabled
     *
     * @param status The new enabled/disabled status of the blocklist
     */
    event BlocklistEnabled(bool indexed status);

    // -------------------- Errors -----------------------------------

    /**
     * @notice The transaction sender is not a blocklister
     *
     * @param account The address of the transaction sender
     */
    error UnauthorizedBlocklister(address account);

    /**
     * @notice The transaction sender is not a main blocklister
     *
     * @param account The address of the transaction sender
     */
    error UnauthorizedMainBlocklister(address account);

    /**
     * @notice The account is blocklisted
     *
     * @param account The address of the blocklisted account
     */
    error BlocklistedAccount(address account);

    /**
     * @notice The address to blocklist is zero address
     */
    error ZeroAddressToBlocklist();

    /**
     * @notice The account is already configured
     */
    error AlreadyConfigured();

    // -------------------- Modifiers --------------------------------

    /**
     * @notice Throws if called by any account other than the blocklister or main blocklister
     */
    modifier onlyBlocklister() {
        address sender = _msgSender();
        if (!isBlocklister(sender) && sender != _mainBlocklister) {
            revert UnauthorizedBlocklister(_msgSender());
        }
        _;
    }

    /**
     * @notice Throws if called by any account other than the main blocklister
     */
    modifier onlyMainBlocklister() {
        if (_msgSender() != _mainBlocklister) {
            revert UnauthorizedMainBlocklister(_msgSender());
        }
        _;
    }

    /**
     * @notice Throws if the account is blocklisted
     *
     * @param account The address to check for presence in the blocklist
     */
    modifier notBlocklisted(address account) {
        if (_blocklisted[account] && isBlocklistEnabled()) {
            revert BlocklistedAccount(account);
        }
        _;
    }

    /**
     * @notice Throws if the account is blocklisted, but allows the blocklister to bypass the check
     *
     * @param account The address to check for presence in the blocklist
     */
    modifier notBlocklistedOrBypassIfBlocklister(address account) {
        if (_blocklisted[account] && isBlocklistEnabled() && !isBlocklister(_msgSender())) {
            revert BlocklistedAccount(account);
        }
        _;
    }

    // -------------------- Functions --------------------------------

    /**
     * @notice The internal initializer of the upgradable contract
     *
     * See details https://docs.openzeppelin.com/upgrades-plugins/1.x/writing-upgradeable
     */
    function __Blocklistable_init() internal onlyInitializing {
        __Context_init_unchained();
        __Ownable_init_unchained();
        __Blocklistable_init_unchained();
    }

    /**
     * @notice The unchained internal initializer of the upgradable contract
     *
     * See {BlocklistableUpgradeable-__Blocklistable_init}
     */
    function __Blocklistable_init_unchained() internal onlyInitializing {}

    /**
     * @notice Adds an account to the blocklist
     *
     * Requirements:
     *
     * - Can only be called by the blocklister account
     *
     * Emits a {Blocklisted} event
     *
     * @param account The address to blocklist
     */
    function blocklist(address account) public onlyBlocklister {
        if (account == address(0)) {
            revert ZeroAddressToBlocklist();
        }
        if (_blocklisted[account]) {
            return;
        }

        _blocklisted[account] = true;

        emit Blocklisted(account);
    }

    /**
     * @notice Removes an account from the blocklist
     *
     * Requirements:
     *
     * - Can only be called by the blocklister account
     *
     * Emits an {UnBlocklisted} event
     *
     * @param account The address to remove from the blocklist
     */
    function unBlocklist(address account) public onlyBlocklister {
        if (!_blocklisted[account]) {
            return;
        }

        _blocklisted[account] = false;

        emit UnBlocklisted(account);
    }

    /**
     * @notice Adds the transaction sender to the blocklist
     *
     * Emits a {SelfBlocklisted} event
     * Emits a {Blocklisted} event
     */
    function selfBlocklist() public {
        address sender = _msgSender();

        if (_blocklisted[sender]) {
            return;
        }

        _blocklisted[sender] = true;

        emit SelfBlocklisted(sender);
        emit Blocklisted(sender);
    }

    /**
     * @notice Enables or disables the blocklist
     *
     * Requirements:
     *
     * - Can only be called by the owner
     *
     * Emits a {BlocklistEnabled} event
     *
     * @param status The new enabled/disabled status of the blocklist
     */
    function enableBlocklist(bool status) external onlyOwner {
        BlocklistableStorageSlot storage storageSlot = _getBlocklistableSlot(
            _BLOCKLISTABLE_STORAGE_SLOT
        );
        if (storageSlot.enabled == status) {
            revert AlreadyConfigured();
        }

        storageSlot.enabled = status;
        emit BlocklistEnabled(status);
    }

    /**
     * @notice Updates the main blocklister address
     *
     * Requirements:
     *
     * - Can only be called by the owner
     *
     * Emits a {MainBlockListerChanged} event
     *
     * @param newMainBlocklister The address of the new main blocklister
     */
    function setMainBlocklister(address newMainBlocklister) external onlyOwner {
        if (_mainBlocklister == newMainBlocklister) {
            revert AlreadyConfigured();
        }

        _mainBlocklister = newMainBlocklister;
        emit MainBlockListerChanged(newMainBlocklister);
    }

    /**
     * @notice Updates the blocklister address
     *
     * Requirements:
     *
     * - Can only be called by the main blocklister
     *
     * Emits a {BlocklisterConfigured} event
     *
     * @param account The address of the blocklister to be configured
     * @param status The new status of the blocklister
     */
    function configureBlocklister(address account, bool status) external onlyMainBlocklister {
        BlocklistableStorageSlot storage storageSlot = _getBlocklistableSlot(
            _BLOCKLISTABLE_STORAGE_SLOT
        );
        if (storageSlot.blocklisters[account] == status) {
            revert AlreadyConfigured();
        }

        storageSlot.blocklisters[account] = status;
        emit BlocklisterConfigured(account, status);
    }

    /**
     * @notice Returns the address of the blocklister
     */
    function mainBlocklister() public view virtual returns (address) {
        return _mainBlocklister;
    }

    /**
     * @notice Checks if an account is present in the blocklist
     *
     * @param account The address to check for presence in the blocklist
     * @return True if the account is present in the blocklist, false otherwise
     */
    function isBlocklisted(address account) public view returns (bool) {
        return _blocklisted[account];
    }

    /**
     * @notice Checks if the account is a blocklister
     *
     * @param account The address to check for blocklister configuration
     * @return True if the account is a configured blocklister, False otherwise
     */
    function isBlocklister(address account) public view returns (bool) {
        return _getBlocklistableSlot(_BLOCKLISTABLE_STORAGE_SLOT).blocklisters[account];
    }

    /**
     * @notice Checks if the blocklist is enabled
     *
     * @return True if the blocklist is enabled, False otherwise
     */
    function isBlocklistEnabled() public view returns (bool) {
        return _getBlocklistableSlot(_BLOCKLISTABLE_STORAGE_SLOT).enabled;
    }

    /**
     * @dev Returns an `MappingSlot` with member `value` located at `slot`
     */
    function _getBlocklistableSlot(
        bytes32 slot
    ) internal pure returns (BlocklistableStorageSlot storage r) {
        /// @solidity memory-safe-assembly
        assembly {
            r.slot := slot
        }
    }

    //*************** Service Functions For Backward Compatibility ***************

    function blacklist(address account) external onlyBlocklister {
        blocklist(account);
    }

    function unBlacklist(address account) external onlyBlocklister {
        unBlocklist(account);
    }

    function selfBlacklist() external {
        selfBlocklist();
    }

    function isBlacklisted(address account) external view returns (bool) {
        return isBlocklisted(account);
    }
}
