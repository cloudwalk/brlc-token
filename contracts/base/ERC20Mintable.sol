// SPDX-License-Identifier: MIT

pragma solidity 0.8.16;

import { IERC20Mintable } from "./interfaces/IERC20Mintable.sol";
import { ERC20Base } from "./ERC20Base.sol";

/**
 * @title ERC20Mintable contract
 * @author CloudWalk Inc.
 * @notice The ERC20 token implementation that supports the mint, premint, and burn operations
 */
abstract contract ERC20Mintable is ERC20Base, IERC20Mintable {
    /// @notice The memory slot used to extend the contract storage with extra variables
    // keccak256(abi.encode(uint256(keccak256("erc20.mintable.extended.storage")) - 1)) & ~bytes32(uint256(0xff));
    bytes32 private constant _EXTENDED_STORAGE_SLOT =
        0xcffb5f8035ad3742159fc75053ecd1333a8c2fb755e4113d8e5d284905de8700;

    /// @notice The structure that represents the premintable storage slot
    //  @custom:storage-location erc7201:erc20.mintable.extended.storage
    struct ExtendedStorageSlot {
        mapping(address => PremintState) premints;
        uint16 maxPendingPremintsCount;
    }

    /// @notice The structure that represents an array of premint records
    struct PremintState {
        PremintRecord[] premintRecords;
    }

    /// @notice The structure that represents a premint record
    struct PremintRecord {
        uint64 amount;
        uint64 release;
    }

    /// @notice The address of the main minter
    address private _mainMinter;

    /// @notice The mapping of the configured minters
    mapping(address => bool) private _minters;

    /// @notice The mapping of the configured mint allowances
    mapping(address => uint256) private _mintersAllowance;

    // -------------------- Errors -----------------------------------

    /**
     * @notice The transaction sender is not a main minter
     *
     * @param account The address of the transaction sender
     */
    error UnauthorizedMainMinter(address account);

    /**
     * @notice The transaction sender is not a minter
     *
     * @param account The address of the transaction sender
     */
    error UnauthorizedMinter(address account);

    /// @notice The mint allowance is exceeded during the mint operation
    error ExceededMintAllowance();

    /// @notice The zero amount of tokens is passed during the mint operation
    error ZeroMintAmount();

    /// @notice The zero amount of tokens is passed during the burn operation
    error ZeroBurnAmount();

    /// @notice The zero amount of tokens is passed during the premint operation
    error ZeroPremintAmount();

    /// @notice The transfer amount exceeded the preminted (not available) amount
    error TransferExceededPremintedAmount();

    /// @notice The same maximum count of pending premints is already configured
    error MaxPendingPremintsCountAlreadyConfigured();

    /// @notice The maximum number of pending premints has been reached
    error MaxPendingPremintsLimitReached();

    /// @notice The premint release time must be in the future
    error PremintReleaseTimePassed();

    /// @notice The premint restrictions are not fit to the operation
    error PremintRestrictionFailure();

    /// @notice The existing premint has not been changed during the operation
    error PremintUnchanged();

    // -------------------- Modifiers --------------------------------

    /**
     * @notice Throws if called by any account other than the main minter
     */
    modifier onlyMainMinter() {
        if (_msgSender() != _mainMinter) {
            revert UnauthorizedMainMinter(_msgSender());
        }
        _;
    }

    /**
     * @notice Throws if called by any account other than the minter
     */
    modifier onlyMinter() {
        if (!_minters[_msgSender()]) {
            revert UnauthorizedMinter(_msgSender());
        }
        _;
    }

    // -------------------- Functions --------------------------------

    /**
     * @notice The internal initializer of the upgradable contract
     */
    function __ERC20Mintable_init(string memory name_, string memory symbol_) internal onlyInitializing {
        __Context_init_unchained();
        __Ownable_init_unchained();
        __Pausable_init_unchained();
        __PausableExt_init_unchained();
        __Blocklistable_init_unchained();
        __ERC20_init_unchained(name_, symbol_);
        __ERC20Base_init_unchained();
        __ERC20Mintable_init_unchained();
    }

    /**
     * @notice The internal unchained initializer of the upgradable contract
     */
    function __ERC20Mintable_init_unchained() internal onlyInitializing {}

    /**
     * @inheritdoc IERC20Mintable
     *
     * @dev Can only be called by the contract owner
     */
    function updateMainMinter(address newMainMinter) public onlyOwner {
        if (_mainMinter == newMainMinter) {
            return;
        }

        _mainMinter = newMainMinter;

        emit MainMinterChanged(_mainMinter);
    }

    /**
     * @inheritdoc IERC20Mintable
     *
     * @dev The contract must not be paused
     * @dev Can only be called by the main minter
     */
    function configureMinter(
        address minter,
        uint256 mintAllowance
    ) external override whenNotPaused onlyMainMinter returns (bool) {
        _minters[minter] = true;
        _mintersAllowance[minter] = mintAllowance;

        emit MinterConfigured(minter, mintAllowance);

        return true;
    }

    /**
     * @inheritdoc IERC20Mintable
     *
     * @dev Can only be called by the main minter
     */
    function removeMinter(address minter) external onlyMainMinter returns (bool) {
        if (!_minters[minter]) {
            return true;
        }

        _minters[minter] = false;
        _mintersAllowance[minter] = 0;

        emit MinterRemoved(minter);

        return true;
    }

    /**
     * @inheritdoc IERC20Mintable
     *
     * @dev Can only be called by the contract owner
     * @dev The same limit cannot be configured twice
     */
    function configureMaxPendingPremintsCount(uint16 newLimit) external onlyOwner {
        ExtendedStorageSlot storage storageSlot = _getExtendedStorageSlot();
        if (storageSlot.maxPendingPremintsCount == newLimit) {
            revert MaxPendingPremintsCountAlreadyConfigured();
        }

        storageSlot.maxPendingPremintsCount = newLimit;

        emit MaxPendingPremintsCountConfigured(newLimit);
    }

    /**
     * @inheritdoc IERC20Mintable
     *
     * @dev The contract must not be paused
     * @dev Can only be called by a minter account
     * @dev The message sender must not be blocklisted
     * @dev The `account` address must not be blocklisted
     * @dev The `amount` value must be greater than zero and not
     * greater than the mint allowance of the minter
     */
    function mint(address account, uint256 amount) external onlyMinter notBlocklisted(_msgSender()) returns (bool) {
        return _mintInternal(account, amount);
    }

    /**
     * @inheritdoc IERC20Mintable
     *
     * @dev Can only be called by a minter account
     * @dev The message sender must not be blocklisted
     * @dev The `account` address must not be blocklisted
     * @dev The `amount` and `release` values must be less or equal to uint64 max value
     * @dev The `amount` value must be greater than zero and not greater than the mint allowance of the minter
     * @dev The `restriction` value must be one of PremintRestriction enum values
     * @dev The number of pending premints must be less than the limit
     */
    function premint(
        address account,
        uint256 amount,
        uint256 release,
        PremintRestriction restriction
    ) external onlyMinter notBlocklisted(_msgSender()) {
        if (release <= block.timestamp) {
            revert PremintReleaseTimePassed();
        }

        ExtendedStorageSlot storage storageSlot = _getExtendedStorageSlot();
        PremintRecord[] storage premintRecords = storageSlot.premints[account].premintRecords;

        uint256 oldAmount = 0;
        uint256 mintAmount = 0;
        uint256 burnAmount = 0;

        for (uint256 i = 0; i < premintRecords.length;) {
            if (premintRecords[i].release < block.timestamp) { // Delete released premint
                premintRecords[i] = premintRecords[premintRecords.length - 1];
                premintRecords.pop();
                continue;
            }

            if (premintRecords[i].release == release) {
                if (restriction == PremintRestriction.Update) {
                    revert PremintRestrictionFailure();
                }

                oldAmount = premintRecords[i].amount;
                if (amount == 0) { // Cancel pending premint
                    burnAmount = oldAmount;
                    premintRecords[i] = premintRecords[premintRecords.length - 1];
                    premintRecords.pop();
                } else if (oldAmount < amount) { // Update pending premint - increase
                    mintAmount = amount - oldAmount;
                    premintRecords[i].amount = _toUint64(amount);
                } else if (oldAmount > amount) { // Update pending premint - decrease
                    burnAmount = oldAmount - amount;
                    premintRecords[i].amount = _toUint64(amount);
                }
            }
            ++i;
        }

        if (oldAmount == 0) {
            if (amount == 0) {
                revert ZeroPremintAmount();
            }
            if (premintRecords.length >= storageSlot.maxPendingPremintsCount) {
                revert MaxPendingPremintsLimitReached();
            }
            if (restriction == PremintRestriction.Create) {
                revert PremintRestrictionFailure();
            }

            _mintInternal(account, _toUint64(amount));
            premintRecords.push(PremintRecord(_toUint64(amount), _toUint64(release)));
        } else if (burnAmount > 0) { // Burn on premint update
            _burnInternal(account, _toUint64(burnAmount));
            amount = oldAmount - burnAmount;
        } else if (mintAmount > 0) { // Mint on premint update
            _mintInternal(account, _toUint64(mintAmount));
            amount = oldAmount + mintAmount;
        } else {
            revert PremintUnchanged();
        }
        emit Premint(_msgSender(), account, amount, oldAmount, release);
    }

    /**
     * @inheritdoc IERC20Mintable
     *
     * @dev The contract must not be paused
     * @dev Can only be called by a minter account
     * @dev The message sender must not be blocklisted
     * @dev The `amount` value must be greater than zero
     */
    function burn(uint256 amount) external onlyMinter notBlocklisted(_msgSender()) {
        _burnInternal(_msgSender(), amount);
    }

    /**
     * @notice Returns the total amount of preminted tokens
     * @param account The account to check the preminted balance for
     */
    function balanceOfPremint(address account) public view returns (uint256 balance) {
        ExtendedStorageSlot storage storageSlot = _getExtendedStorageSlot();
        PremintRecord[] storage premints = storageSlot.premints[account].premintRecords;
        for (uint256 i = 0; i < premints.length; i++) {
            if (premints[i].release > block.timestamp) {
                balance += premints[i].amount;
            }
        }
    }

    /**
     * @notice Returns the array of premint records for a given account
     * @param account The address of the account to get the premint records for
     */
    function getPremints(address account) external view returns (PremintRecord[] memory) {
        ExtendedStorageSlot storage storageSlot = _getExtendedStorageSlot();
        return storageSlot.premints[account].premintRecords;
    }

    /**
     * @notice Returns the maximum number of pending premints
     */
    function maxPendingPremintsCount() external view returns (uint256) {
        ExtendedStorageSlot storage storageSlot = _getExtendedStorageSlot();
        return storageSlot.maxPendingPremintsCount;
    }

    /**
     * @inheritdoc IERC20Mintable
     */
    function mainMinter() external view returns (address) {
        return _mainMinter;
    }

    /**
     * @inheritdoc IERC20Mintable
     */
    function isMinter(address account) external view returns (bool) {
        return _minters[account];
    }

    /**
     * @inheritdoc IERC20Mintable
     */
    function minterAllowance(address minter) external view returns (uint256) {
        return _mintersAllowance[minter];
    }

    function _mintInternal(address account, uint256 amount) internal returns (bool) {
        if (amount == 0) {
            revert ZeroMintAmount();
        }

        uint256 mintAllowance = _mintersAllowance[_msgSender()];
        if (amount > mintAllowance) {
            revert ExceededMintAllowance();
        }

        _mintersAllowance[_msgSender()] = mintAllowance - amount;
        emit Mint(_msgSender(), account, amount);

        _mint(account, amount);

        return true;
    }

    function _burnInternal(address account, uint256 amount) internal returns (bool) {
        if (amount == 0) {
            revert ZeroBurnAmount();
        }

        _burn(account, amount);

        emit Burn(_msgSender(), amount);

        return true;
    }

    /**
     * @inheritdoc ERC20Base
     */
    function _afterTokenTransfer(address from, address to, uint256 amount) internal virtual override {
        super._afterTokenTransfer(from, to, amount);
        uint256 preminted = balanceOfPremint(from);
        if (preminted != 0) {
            if (_balanceOf_ERC20Mintable(from) < preminted) {
                revert TransferExceededPremintedAmount();
            }
        }
    }

    function _getExtendedStorageSlot() internal pure returns (ExtendedStorageSlot storage r) {
        /// @solidity memory-safe-assembly
        assembly {
            r.slot := _EXTENDED_STORAGE_SLOT
        }
    }

    function _toUint64(uint256 value) internal pure returns (uint64) {
        if (value > type(uint64).max) {
            revert("ERC20Mintable: uint64 overflow");
        }
        return uint64(value);
    }

    /**
     * @notice Returns the transferable amount of tokens owned by account
     *
     * @param account The account to get the balance of
     */
    function _balanceOf_ERC20Mintable(address account) internal view virtual returns (uint256);
}
