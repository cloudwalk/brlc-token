// SPDX-License-Identifier: MIT

pragma solidity 0.8.16;

import { IERC20Mintable } from "./interfaces/IERC20Mintable.sol";
import { ERC20Base } from "./ERC20Base.sol";

/**
 * @title ERC20Mintable contract
 * @author CloudWalk Inc.
 * @dev The ERC20 token implementation that supports the mint and burn operations.
 */
abstract contract ERC20Mintable is ERC20Base, IERC20Mintable {
    /// @dev The address of the master minter.
    address private _masterMinter;

    /// @dev The mapping of the configured minters.
    mapping(address => bool) private _minters;

    /// @dev The mapping of the configured mint allowances.
    mapping(address => uint256) private _mintersAllowance;

    // -------------------- Errors -----------------------------------

    /// @dev The transaction sender is not a master minter.
    error UnauthorizedMasterMinter(address account);

    /// @dev The transaction sender is not a minter.
    error UnauthorizedMinter(address account);

    /// @dev The mint allowance is exceeded during the mint operation.
    error ExceededMintAllowance();

    /// @dev The zero amount of tokens is passed during the mint operation.
    error ZeroMintAmount();

    /// @dev The zero amount of tokens is passed during the burn operation.
    error ZeroBurnAmount();

    // -------------------- Modifiers --------------------------------

    /**
     * @dev Throws if called by any account other than the master minter.
     */
    modifier onlyMasterMinter() {
        if (_msgSender() != _masterMinter) {
            revert UnauthorizedMasterMinter(_msgSender());
        }
        _;
    }

    /**
     * @dev Throws if called by any account other than the minter.
     */
    modifier onlyMinter() {
        if (!_minters[_msgSender()]) {
            revert UnauthorizedMinter(_msgSender());
        }
        _;
    }

    // -------------------- Functions --------------------------------

    /**
     * @dev The internal initializer of the upgradable contract.
     */
    function __ERC20Mintable_init(string memory name_, string memory symbol_) internal onlyInitializing {
        __Context_init_unchained();
        __Ownable_init_unchained();
        __Pausable_init_unchained();
        __PausableExt_init_unchained();
        __Blacklistable_init_unchained();
        __ERC20_init_unchained(name_, symbol_);
        __ERC20Base_init_unchained();
        __ERC20Mintable_init_unchained();
    }

    /**
     * @dev The internal unchained initializer of the upgradable contract.
     */
    function __ERC20Mintable_init_unchained() internal onlyInitializing {}

    /**
     * @dev See {IERC20Mintable-updateMasterMinter}.
     *
     * Requirements:
     *
     * - Can only be called by the contract owner.
     */
    function updateMasterMinter(address newMasterMinter) external onlyOwner {
        if (_masterMinter == newMasterMinter) {
            return;
        }

        _masterMinter = newMasterMinter;

        emit MasterMinterChanged(_masterMinter);
    }

    /**
     * @dev See {IERC20Mintable-configureMinter}.
     *
     * Requirements:
     *
     * - The contract must not be paused.
     * - Can only be called by the master minter.
     */
    function configureMinter(
        address minter,
        uint256 mintAllowance
    ) external override whenNotPaused onlyMasterMinter returns (bool) {
        _minters[minter] = true;
        _mintersAllowance[minter] = mintAllowance;

        emit MinterConfigured(minter, mintAllowance);

        return true;
    }

    /**
     * @dev See {IERC20Mintable-removeMinter}.
     *
     * Requirements:
     *
     * - Can only be called by the master minter.
     */
    function removeMinter(address minter) external onlyMasterMinter returns (bool) {
        if (!_minters[minter]) {
            return true;
        }

        _minters[minter] = false;
        _mintersAllowance[minter] = 0;

        emit MinterRemoved(minter);

        return true;
    }

    /**
     * @dev See {IERC20Mintable-mint}.
     *
     * Requirements:
     *
     * - The contract must not be paused.
     * - Can only be called by a minter account.
     * - The `_msgSender()` address must not be blacklisted.
     * - The `account` address must not be blacklisted.
     * - The `amount` value must be greater than zero and
     *   not greater than the mint allowance of the minter.
     */
    function mint(
        address account,
        uint256 amount
    ) external whenNotPaused onlyMinter notBlacklisted(_msgSender()) notBlacklisted(account) returns (bool) {
        if (amount == 0) {
            revert ZeroMintAmount();
        }

        uint256 mintAllowance = _mintersAllowance[_msgSender()];
        if (amount > mintAllowance) {
            revert ExceededMintAllowance();
        }

        _mint(account, amount);

        _mintersAllowance[_msgSender()] = mintAllowance - amount;
        emit Mint(_msgSender(), account, amount);

        return true;
    }

    /**
     * @dev See {IERC20Mintable-burn}.
     *
     * Requirements:
     *
     * - The contract must not be paused.
     * - Can only be called by a minter account.
     * - The `_msgSender()` address must not be blacklisted.
     * - The `amount` value must be greater than zero.
     */
    function burn(uint256 amount) external whenNotPaused onlyMinter notBlacklisted(_msgSender()) {
        if (amount == 0) {
            revert ZeroBurnAmount();
        }

        _burn(_msgSender(), amount);

        emit Burn(_msgSender(), amount);
    }

    /**
     * @dev See {IERC20Mintable-masterMinter}.
     */
    function masterMinter() external view returns (address) {
        return _masterMinter;
    }

    /**
     * @dev See {IERC20Mintable-isMinter}.
     */
    function isMinter(address account) external view returns (bool) {
        return _minters[account];
    }

    /**
     * @dev See {IERC20Mintable-minterAllowance}.
     */
    function minterAllowance(address minter) external view returns (uint256) {
        return _mintersAllowance[minter];
    }
}