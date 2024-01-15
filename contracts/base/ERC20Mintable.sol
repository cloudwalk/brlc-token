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
    /// @notice The maximum number of the available premint slots per account
    uint256 private constant MAXIMUM_PREMINTS_NUMBER = 5;

    /// @notice The memory slot used to extend the contract storage with extra variables
    // keccak256(abi.encode(uint256(keccak256("erc20.maintable.extended.storage")) - 1)) & ~bytes32(uint256(0xff));
    bytes32 private constant _EXTENDED_STORAGE_SLOT =
        0x4c1fca302e26e1c6bca3a6099777b1d45211af3104005fea61070d345c61d800;

    /// @notice The structure that represents the premintable storage slot
    //  @custom:storage-location erc7201:erc20.maintable.extended.storage
    struct ExtendedStorageSlot {
        mapping(address => PremintState) premints;
    }

    /// @notice The structure that represents an array of premint records
    struct PremintState {
        PremintRecord[] premintRecords;
    }

    /// @notice The structure that represents a premint record
    struct PremintRecord {
        uint64 amount;
        uint64 releaseTime;
        uint128 reserved;
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

    /// @notice The transfer amount exceeded the preminted amount
    error TransferExceededPremintedAmount();

    /// @notice The premint release time must in the future
    error PremintReleaseTimePassed();

    /// @notice The limit of premints is reached
    error PremintsLimitReached();

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
     * @dev The `amount` value must be greater than zero and not
     * greater than the mint allowance of the minter
     * @dev The number of pending premints should not reach the limit
     */
    function premint(
        address account,
        uint256 amount,
        uint256 releaseTime
    ) external onlyMinter notBlocklisted(_msgSender()) {
        if (releaseTime <= block.timestamp) {
            revert PremintReleaseTimePassed();
        }

        ExtendedStorageSlot storage storageSlot = _getExtendedStorageSlot();
        PremintRecord[] storage premintRecords = storageSlot.premints[account].premintRecords;

        if (premintRecords.length < MAXIMUM_PREMINTS_NUMBER) {
            premintRecords.push(PremintRecord(_toUint64(amount), _toUint64(releaseTime), 0));
        } else {
            bool success = false;
            for (uint256 i = 0; i < premintRecords.length; i++) {
                if (premintRecords[i].releaseTime <= block.timestamp) {
                    // TDB Check if it's cheaper to update fields
                    premintRecords[i] = PremintRecord(_toUint64(amount), _toUint64(releaseTime), 0);
                    success = true;
                    break;
                }
            }
            if (!success) {
                revert PremintsLimitReached();
            }
        }

        emit Premint(_msgSender(), account, amount, releaseTime);

        _mintInternal(account, amount);
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
        if (amount == 0) {
            revert ZeroBurnAmount();
        }

        _burn(_msgSender(), amount);

        emit Burn(_msgSender(), amount);
    }

    /**
     * @notice Returns the total amount of preminted tokens
     * @param account The account to check the preminted balance for
     */
    function balanceOfPremint(address account) public view returns (uint256 balance) {
        ExtendedStorageSlot storage storageSlot = _getExtendedStorageSlot();
        PremintRecord[] storage premints = storageSlot.premints[account].premintRecords;
        for (uint256 i = 0; i < premints.length; i++) {
            if (premints[i].releaseTime > block.timestamp) {
                balance += premints[i].amount;
            }
        }
    }

    /**
     * @notice Returns the array of premint records
     * @param account The address to get the premint records for
     */
    function getPremints(address account) external view returns (PremintRecord[] memory) {
        ExtendedStorageSlot storage storageSlot = _getExtendedStorageSlot();
        return storageSlot.premints[account].premintRecords;
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

    /**
     * @inheritdoc ERC20Base
     */
    function _afterTokenTransfer(address from, address to, uint256 amount) internal virtual override {
        super._afterTokenTransfer(from, to, amount);
        uint256 preminted = balanceOfPremint(from);
        if (preminted != 0) {
            if (_balanceOf_ERC20Mintable(from, to) < preminted) {
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
     * @param recipient The recipient of the tokens during the transfer
     */
    function _balanceOf_ERC20Mintable(address account, address recipient) internal view virtual returns (uint256);
}
