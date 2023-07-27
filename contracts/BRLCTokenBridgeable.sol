// SPDX-License-Identifier: MIT

pragma solidity 0.8.16;

import { IERC20Bridgeable } from "./base/interfaces/IERC20Bridgeable.sol";
import { IERC20Freezable } from "./base/interfaces/IERC20Freezable.sol";
import { ERC20Base } from "./base/ERC20Base.sol";

/**
 * @title BRLCTokenBridgeable contract
 * @author CloudWalk Inc.
 * @dev The BRLC token implementation that supports the bridge operations.
 */
contract BRLCTokenBridgeable is ERC20Base, IERC20Bridgeable, IERC20Freezable {
    /// @dev The address of the bridge.
    address private _bridge;

    /// @dev The mapping of the freeze approvals.
    mapping(address => bool) private _freezeApprovals;

    /// @dev The mapping of the frozen balances.
    mapping(address => uint256) private _frozenBalances;

    // -------------------- Errors -----------------------------------

    /// @dev The transaction sender is not a bridge.
    error UnauthorizedBridge(address account);

    /// @dev The zero amount of tokens is passed during the mint operation.
    error ZeroMintForBridgingAmount();

    /// @dev The zero amount of tokens is passed during the burn operation.
    error ZeroBurnForBridgingAmount();

    /// @dev The token freezing operation is not approved by the account.
    error FreezingNotApproved();

    /// @dev The token freezing is already approved by the account.
    error FreezingAlreadyApproved();

    /// @dev The frozen balance is exceeded during the operation.
    error LackOfFrozenBalance();

    /// @dev The transfer amount exceeded the frozen amount.
    error TransferExceededFrozenAmount();

    // -------------------- Modifiers --------------------------------

    /// @dev Throws if called by any account other than the bridge.
    modifier onlyBridge() {
        if (_msgSender() != _bridge) {
            revert UnauthorizedBridge(_msgSender());
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
     * Requirements:
     *
     * - The passed bridge address must not be zero.
     *
     * @param name_ The name of the token.
     * @param symbol_ The symbol of the token.
     * @param bridge_ The address of a bridge contract to support by this contract.
     */
    function initialize(
        string memory name_,
        string memory symbol_,
        address bridge_
    ) external virtual initializer {
        __BRLCTokenBridgeable_init(name_, symbol_, bridge_);
    }

    /**
     * @dev The internal initializer of the upgradable contract.
     *
     * See {BRLCTokenBridgeable-initialize}.
     */
    function __BRLCTokenBridgeable_init(
        string memory name_,
        string memory symbol_,
        address bridge_
    ) internal onlyInitializing {
        __Context_init_unchained();
        __Ownable_init_unchained();
        __Pausable_init_unchained();
        __PausableExt_init_unchained();
        __Blacklistable_init_unchained();
        __ERC20_init_unchained(name_, symbol_);
        __ERC20Base_init_unchained();
        __BRLCTokenBridgeable_init_unchained(bridge_);
    }

    /**
     * @dev The internal unchained initializer of the upgradable contract.
     *
     * See {BRLCTokenBridgeable-initialize}.
     */
    function __BRLCTokenBridgeable_init_unchained(address bridge_) internal onlyInitializing {
        _setBridge(bridge_);
    }

    /**
     * @dev See {IERC20Bridgeable-setBridge}.
     */
    function setBridge(address newBridge) external onlyOwner {
        _setBridge(newBridge);
    }

    /**
     * @dev See {IERC20Bridgeable-mintForBridging}.
     *
     * Requirements:
     *
     * - Can only be called by the bridge.
     * - The `amount` value must be greater than zero.
     */
    function mintForBridging(address account, uint256 amount) external onlyBridge returns (bool) {
        if (amount == 0) {
            revert ZeroMintForBridgingAmount();
        }

        _mint(account, amount);
        emit MintForBridging(account, amount);

        return true;
    }

    /**
     * @dev See {IERC20Bridgeable-burnForBridging}.
     *
     * Requirements:
     *
     * - Can only be called by the bridge.
     * - The `amount` value must be greater than zero.
     */
    function burnForBridging(address account, uint256 amount) external onlyBridge returns (bool) {
        if (amount == 0) {
            revert ZeroBurnForBridgingAmount();
        }

        _burn(account, amount);
        emit BurnForBridging(account, amount);

        return true;
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
     * @dev See {IERC20Bridgeable-isBridgeSupported}.
     */
    function isBridgeSupported(address bridge_) external view returns (bool) {
        return _bridge == bridge_;
    }

    /// @dev Returns the bridge address.
    function bridge() external view virtual returns (address) {
        return _bridge;
    }

    /**
     * @dev See {IERC20Bridgeable-isIERC20Bridgeable}.
     */
    function isIERC20Bridgeable() external pure returns (bool) {
        return true;
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

    function _beforeTokenTransfer(address from, address to, uint256 amount) internal virtual override {
        super._beforeTokenTransfer(from, to, amount);
        uint256 frozen = _frozenBalances[from];
        if (frozen != 0) {
            if(balanceOf(from) < frozen + amount) {
                revert TransferExceededFrozenAmount();
            }
        }
    }

    function _setBridge(address newBridge) internal {
        emit SetBridge(newBridge, _bridge);
        _bridge = newBridge;
    }
}
