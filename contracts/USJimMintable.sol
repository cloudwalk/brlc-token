// SPDX-License-Identifier: MIT

pragma solidity 0.8.16;

import { IERC20Mintable } from "./base/interfaces/IERC20Mintable.sol";
import { IERC20Freezable } from "./base/interfaces/IERC20Freezable.sol";
import { BRLCTokenBase } from "./BRLCTokenBase.sol";

/**
 * @title USJimMintable contract
 * @author CloudWalk Inc.
 * @dev The USJim token implementation that supports mint, burn and freeze operations.
 */
contract USJimMintable is BRLCTokenBase, IERC20Mintable, IERC20Freezable {
    /// @dev The address of the master minter.
    address private _masterMinter;

    /// @dev The mapping of the configured minters.
    mapping(address => bool) private _minters;

    /// @dev The mapping of the configured mint allowances.
    mapping(address => uint256) private _mintersAllowance;

    /// @dev The mapping of the freeze approvals.
    mapping(address => bool) private _freezeApprovals;

    /// @dev The mapping of the frozen balances.
    mapping(address => uint256) private _frozenBalances;

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

    /// @dev The token freezing operation is not approved by the account.
    error FreezingNotApproved();

    /// @dev The token freezing is already approved by the account.
    error FreezingAlreadyApproved();

    /// @dev The frozen balance is exceeded during the operation.
    error LackOfFrozenBalance();

    /// @dev The transfer amount exceeded the frozen amount.
    error TransferExceededFrozenAmount();

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
     * @dev Constructor that prohibits the initialization of the implementation of the upgradable contract.
     *
     * See details
     * https://docs.openzeppelin.com/upgrades-plugins/1.x/writing-upgradeable#initializing_the_implementation_contract
     *
     * @custom:oz-upgrades-unsafe-allow constructor
     */
    constructor() {
        _disableInitializers();
    }

    /**
     * @dev The initializer of the upgradable contract.
     *
     * See details https://docs.openzeppelin.com/upgrades-plugins/1.x/writing-upgradeable .
     *
     * @param name_ The name of the token.
     * @param symbol_ The symbol of the token.
     */
    function initialize(string memory name_, string memory symbol_) external virtual initializer {
        __USJimMintable_init(name_, symbol_);
    }

    /**
     * @dev The internal initializer of the upgradable contract.
     *
     * See {USJimMintable-initialize}.
     */
    function __USJimMintable_init(string memory name_, string memory symbol_) internal onlyInitializing {
        __Context_init_unchained();
        __Ownable_init_unchained();
        __Pausable_init_unchained();
        __PausableExt_init_unchained();
        __Blacklistable_init_unchained();
        __ERC20_init_unchained(name_, symbol_);
        __BRLCTokenBase_init_unchained();
        __USJimMintable_init_unchained();
    }

    /**
     * @dev The internal unchained initializer of the upgradable contract.
     *
     * See {USJimMintable-initialize}.
     */
    function __USJimMintable_init_unchained() internal onlyInitializing {}

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
    function configureMinter(address minter, uint256 mintAllowance)
        external
        override
        whenNotPaused
        onlyMasterMinter
        returns (bool)
    {
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
    function mint(address account, uint256 amount)
        external
        whenNotPaused
        onlyMinter
        notBlacklisted(_msgSender())
        notBlacklisted(account)
        returns (bool)
    {
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
     * @dev See {IERC20Freezable-approveFreezing}.
     *
     * Requirements:
     *
     * - The contract must not be paused.
     */
    function approveFreezing() whenNotPaused external {
        if (_freezeApprovals[_msgSender()]) {
            revert FreezingAlreadyApproved();
        }

        _freezeApprovals[_msgSender()] = true;

        emit FreezeApproval(_msgSender());
    }

    /**
     * @dev See {IERC20Freezable-freeze}.
     *
     * Requirements:
     *
     * - The contract must not be paused.
     * - Can only be called by the blacklister account.
     * - The token freezing must be approved by the `account`.
     */
    function freeze(address account, uint256 amount) external whenNotPaused onlyBlacklister {
        if(!_freezeApprovals[account]) {
            revert FreezingNotApproved();
        }

        emit Freeze(account, amount, _frozenBalances[account]);

        _frozenBalances[account] = amount;
    }

    /**
     * @dev See {IERC20Freezable-transferFrozen}.
     *
     * Requirements:
     *
     * - The contract must not be paused.
     * - Can only be called by the blacklister account.
     * - The frozen balance must be greater than the `amount`.
     */
    function transferFrozen(address from, address to, uint256 amount) public virtual whenNotPaused onlyBlacklister {
        uint256 balance = _frozenBalances[from];

        if(amount > balance) {
            revert LackOfFrozenBalance();
        }

        unchecked {
            _frozenBalances[from] -= amount;
        }

        emit FreezeTransfer(from, amount);
        emit Freeze(from, _frozenBalances[from], balance);

        _transfer(from, to, amount);
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

    /**
     * @dev See {IERC20Freezable-freezeApproval}.
     */
    function freezeApproval(address account) external view returns (bool) {
        return _freezeApprovals[account];
    }

    /**
     * @dev See {IERC20Freezable-frozenBalance}.
     */
    function frozenBalance(address account) external view returns (uint256) {
        return _frozenBalances[account];
    }

    /**
     * @dev Returns true if token is USJim implementation.
     */
    function isUSJim() external pure returns (bool) {
        return true;
    }

    function _beforeTokenTransfer(address from, address to, uint256 amount) internal virtual override {
        super._beforeTokenTransfer(from, to, amount);
        uint256 frozen = _frozenBalances[from];
        if (frozen != 0) {
            if(balanceOf(from) < frozen + amount) {
                revert TransferExceededFrozenAmount();
            }
        }
    }
}
