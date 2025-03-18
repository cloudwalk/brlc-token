// SPDX-License-Identifier: MIT

pragma solidity ^0.8.20;

import { IERC20Mintable } from "./interfaces/IERC20Mintable.sol";
import { ERC20Base } from "./ERC20Base.sol";

/**
 * @title ERC20Mintable contract
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
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
        mapping(uint256 => uint256) premintReschedulings;
        mapping(uint256 => uint256) premintReschedulingCounters;
        uint256 TotalReserveSupply;
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

    /// @notice The premint release timestamp must be in the future
    error PremintReleaseTimePassed();

    /// @notice The premint rescheduling with the provided parameters is already configured
    error PremintReschedulingAlreadyConfigured();

    /// @notice The target premint release timestamp for the premint rescheduling must be in the future
    error PremintReschedulingTimePassed();

    /// @notice The premint rescheduling leads to a rescheduling chain like A => B => C that is prohibited
    error PremintReschedulingChain();

    /// @notice The premint operation assumes changing of an existing premint, but it is not found
    error PremintNonExistent();

    /// @notice The premint operation assumes decreasing an existing premint amount but it is too small
    error PremintInsufficientAmount();

    /// @notice The existing premint has not been changed during the operation
    error PremintUnchanged();

    /// @notice The provided value cannot be cast to uint64 type
    error InappropriateUint64Value(uint256 value);

    /// @notice The amount of tokens to burn is greater than the total reserve supply
    error InsufficientReserveSupply();

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
     * @dev The contract must not be paused
     * @dev Can only be called by a minter account
     * @dev The message sender must not be blocklisted
     */
    function mintFromReserve(
        address account,
        uint256 amount
    ) external whenNotPaused onlyMinter notBlocklisted(_msgSender()) {
        _mintInternal(account, amount);

        ExtendedStorageSlot storage storageSlot = _getExtendedStorageSlot();
        storageSlot.TotalReserveSupply += amount;

        emit MintFromReserve(_msgSender(), account, amount);
    }

    /**
     * @inheritdoc IERC20Mintable
     *
     * @dev Can only be called by a minter account
     * @dev The message sender must not be blocklisted
     * @dev The `account` address must not be blocklisted
     * @dev The `amount` and `release` values must be less or equal to uint64 max value
     * @dev The `amount` value must be greater than zero and not greater than the mint allowance of the minter
     * @dev The number of pending premints must be less than the limit
     */
    function premintIncrease(
        address account,
        uint256 amount,
        uint256 release
    ) external onlyMinter notBlocklisted(_msgSender()) {
        _premint(
            account,
            amount,
            release,
            false // decreasing
        );
    }

    /**
     * @inheritdoc IERC20Mintable
     *
     * @dev Can only be called by a minter account
     * @dev The message sender must not be blocklisted
     * @dev The `account` address must not be blocklisted
     * @dev The `amount` and `release` values must be less or equal to uint64 max value
     * @dev The `amount` value must be greater than zero and not greater than the mint allowance of the minter
     * @dev The number of pending premints must be less than the limit
     */
    function premintDecrease(
        address account,
        uint256 amount,
        uint256 release
    ) external onlyMinter notBlocklisted(_msgSender()) {
        _premint(
            account,
            amount,
            release,
            true // decreasing
        );
    }

    /**
     * @inheritdoc IERC20Mintable
     *
     * @dev The contract must not be paused
     * @dev Can only be called by a minter account
     * @dev The message sender must not be blocklisted
     * @dev The provided target release timestamp must be in the future
     * @dev The being rescheduled release must be in the future taking into account existing reschedulings if any
     * @dev The rescheduling with the provided parameters must not be already configured
     * @dev The rescheduling must not make a chain of reschedulings, like A => B => C
     * @dev The original and target release timestamps must be not greater than uint64 max value
     */
    function reschedulePremintRelease(
        uint256 originalRelease,
        uint256 targetRelease
    ) external whenNotPaused onlyMinter notBlocklisted(_msgSender()) {
        _reschedulePremintRelease(originalRelease, targetRelease);
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
     * @inheritdoc IERC20Mintable
     *
     * @dev The contract must not be paused
     * @dev Can only be called by a minter account
     * @dev The message sender must not be blocklisted
     * @dev The amount of tokens to burn must be less than or equal to the total reserve supply
     */
    function burnToReserve(uint256 amount) external whenNotPaused onlyMinter notBlocklisted(_msgSender()) {
        _burnInternal(_msgSender(), amount);

        ExtendedStorageSlot storage storageSlot = _getExtendedStorageSlot();

        if (storageSlot.TotalReserveSupply < amount) {
            revert InsufficientReserveSupply();
        }

        storageSlot.TotalReserveSupply -= amount;

        emit BurnToReserve(_msgSender(), amount);
    }

    /**
     * @notice Returns the total amount of preminted tokens
     * @param account The account to check the preminted balance for
     */
    function balanceOfPremint(address account) public view returns (uint256 balance) {
        ExtendedStorageSlot storage storageSlot = _getExtendedStorageSlot();
        PremintRecord[] storage premints = storageSlot.premints[account].premintRecords;
        for (uint256 i = 0; i < premints.length; i++) {
            uint256 targetRelease = _resolvePremintRelease(premints[i].release, storageSlot.premintReschedulings);
            if (targetRelease > block.timestamp) {
                balance += premints[i].amount;
            }
        }
    }

    /**
     * @notice Returns the array of premint records for a given account including release reschedulings
     * @param account The address of the account to get the premint records for
     */
    function getPremints(address account) external view returns (PremintRecord[] memory) {
        ExtendedStorageSlot storage storageSlot = _getExtendedStorageSlot();
        PremintRecord[] memory records = storageSlot.premints[account].premintRecords;
        for (uint256 i = 0; i < records.length; ++i) {
            records[i].release = _toUint64(
                _resolvePremintRelease(records[i].release, storageSlot.premintReschedulings)
            );
        }
        return records;
    }

    /**
     * @notice Returns the maximum number of pending premints
     */
    function maxPendingPremintsCount() external view returns (uint256) {
        ExtendedStorageSlot storage storageSlot = _getExtendedStorageSlot();
        return storageSlot.maxPendingPremintsCount;
    }

    /**
     * @notice Returns the target premint release timestamp corresponding to a provided one with possible reschedulings
     * @param release The original premint release timestamp to check
     */
    function resolvePremintRelease(uint256 release) external view returns (uint256) {
        ExtendedStorageSlot storage storageSlot = _getExtendedStorageSlot();
        return _resolvePremintRelease(release, storageSlot.premintReschedulings);
    }

    /**
     * @notice Returns the number of original premint releases that have been rescheduled to a provided release
     * @param release The premint release timestamp to check for usage as a target release in existing reschedulings
     */
    function getPremintReschedulingCounter(uint256 release) external view returns (uint256) {
        ExtendedStorageSlot storage storageSlot = _getExtendedStorageSlot();
        return storageSlot.premintReschedulingCounters[release];
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

    /**
     * @inheritdoc IERC20Mintable
     */
    function totalReserveSupply() external view returns (uint256) {
        ExtendedStorageSlot storage storageSlot = _getExtendedStorageSlot();
        return storageSlot.TotalReserveSupply;
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

    function _getExtendedStorageSlot() internal pure returns (ExtendedStorageSlot storage r) {
        /// @solidity memory-safe-assembly
        assembly {
            r.slot := _EXTENDED_STORAGE_SLOT
        }
    }

    function _premint(
        address account,
        uint256 amount,
        uint256 release,
        bool decreasing
    ) internal {
        if (release <= block.timestamp) {
            revert PremintReleaseTimePassed();
        }

        ExtendedStorageSlot storage storageSlot = _getExtendedStorageSlot();
        PremintRecord[] storage premintRecords = storageSlot.premints[account].premintRecords;

        uint256 oldAmount = 0;
        uint256 newAmount = amount;

        for (uint256 i = 0; i < premintRecords.length; ) {
            PremintRecord storage premintRecord = premintRecords[i];
            uint256 targetRelease = _resolvePremintRelease(premintRecord.release, storageSlot.premintReschedulings);
            if (targetRelease < block.timestamp) {
                _deletePremintRecord(premintRecords, i);
                continue;
            }

            if (premintRecord.release == release) {
                oldAmount = premintRecord.amount;
                if (decreasing) {
                    if (oldAmount >= amount) {
                        unchecked {
                            newAmount = oldAmount - amount;
                        }
                    } else {
                        revert PremintInsufficientAmount();
                    }
                } else {
                    newAmount = oldAmount + amount;
                }
                if (newAmount == 0) {
                    _deletePremintRecord(premintRecords, i);
                    continue;
                } else {
                    premintRecord.amount = _toUint64(newAmount);
                }
            }

            ++i;
        }

        if (oldAmount == 0) {
            if (newAmount == 0) {
                revert ZeroPremintAmount();
            }
            if (premintRecords.length >= storageSlot.maxPendingPremintsCount) {
                revert MaxPendingPremintsLimitReached();
            }
            if (decreasing) {
                revert PremintNonExistent();
            }

            // Create a new premint record
            premintRecords.push(PremintRecord(_toUint64(newAmount), _toUint64(release)));
            _mintInternal(account, newAmount);
        } else if (newAmount < oldAmount) {
            _burnInternal(account, oldAmount - newAmount);
        } else if (newAmount > oldAmount) {
            _mintInternal(account, newAmount - oldAmount);
        } else {
            revert PremintUnchanged();
        }

        emit Premint(_msgSender(), account, newAmount, oldAmount, release);
    }

    function _reschedulePremintRelease(uint256 originalRelease, uint256 newTargetRelease) internal {
        if (newTargetRelease <= block.timestamp) {
            revert PremintReschedulingTimePassed();
        }
        originalRelease = _toUint64(originalRelease);
        ExtendedStorageSlot storage storageSlot = _getExtendedStorageSlot();
        uint256 oldTargetRelease = _resolvePremintRelease(originalRelease, storageSlot.premintReschedulings);
        if (oldTargetRelease <= block.timestamp) {
            revert PremintReleaseTimePassed();
        }
        if (oldTargetRelease == newTargetRelease) {
            revert PremintReschedulingAlreadyConfigured();
        }
        uint256 precedingOriginalReleaseCounter = storageSlot.premintReschedulingCounters[originalRelease];
        if (precedingOriginalReleaseCounter != 0) {
            revert PremintReschedulingChain();
        }
        if (oldTargetRelease != originalRelease) {
            storageSlot.premintReschedulingCounters[oldTargetRelease] -= 1;
        }
        if (newTargetRelease == originalRelease) {
            storageSlot.premintReschedulings[originalRelease] = 0;
        } else {
            storageSlot.premintReschedulings[originalRelease] = _toUint64(newTargetRelease);
            storageSlot.premintReschedulingCounters[newTargetRelease] += 1;
        }
        emit PremintReleaseRescheduled(_msgSender(), originalRelease, newTargetRelease, oldTargetRelease);
    }

    function _resolvePremintRelease(
        uint256 release,
        mapping(uint256 => uint256) storage reschedulings
    ) internal view returns (uint256) {
        uint256 targetRelease = reschedulings[release];
        if (targetRelease == 0) {
            return release;
        } else {
            return targetRelease;
        }
    }

    function _toUint64(uint256 value) internal pure returns (uint64) {
        if (value > type(uint64).max) {
            revert InappropriateUint64Value(value);
        }
        return uint64(value);
    }

    function _deletePremintRecord(PremintRecord[] storage premintRecords, uint256 index) internal {
        uint256 lastIndex = premintRecords.length - 1;
        if (index < lastIndex) {
            premintRecords[index] = premintRecords[lastIndex];
        }
        premintRecords.pop();
    }
}
