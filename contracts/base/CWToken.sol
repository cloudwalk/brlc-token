// SPDX-License-Identifier: MIT

pragma solidity ^0.8.20;

import { ERC20Base } from "./ERC20Base.sol";
import { ERC20Mintable } from "./ERC20Mintable.sol";
import { ERC20Freezable } from "./ERC20Freezable.sol";
import { ERC20Hookable } from "./ERC20Hookable.sol";
import { ERC20Trustable } from "./ERC20Trustable.sol";
import { Versionable } from "./Versionable.sol";

import { IERC20ComplexBalance } from "./interfaces/IERC20ComplexBalance.sol";

import { LegacyRestrictablePlaceholder } from "../legacy/LegacyRestrictablePlaceholder.sol";

/**
 * @title CWToken contract
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @notice The CloudWalk token that extends the standard ERC20 token implementation with additional functionality
 */
contract CWToken is
    ERC20Base,
    ERC20Mintable,
    ERC20Freezable,
    LegacyRestrictablePlaceholder,
    ERC20Hookable,
    ERC20Trustable,
    IERC20ComplexBalance,
    Versionable
{
    /**
     * @notice Constructor that prohibits the initialization of the implementation of the upgradable contract
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
     * @notice The initializer of the upgradable contract
     *
     * See details https://docs.openzeppelin.com/upgrades-plugins/1.x/writing-upgradeable
     *
     * @param name_ The name of the token
     * @param symbol_ The symbol of the token
     */
    function initialize(string memory name_, string memory symbol_) external virtual initializer {
        __CWToken_init(name_, symbol_);
    }

    /**
     * @notice The internal initializer of the upgradable contract
     */
    function __CWToken_init(string memory name_, string memory symbol_) internal onlyInitializing {
        __Context_init_unchained();
        __Ownable_init_unchained();
        __Pausable_init_unchained();
        __PausableExt_init_unchained();
        __ERC20_init_unchained(name_, symbol_);
        __ERC20Base_init_unchained();
        __ERC20Mintable_init_unchained();
        __ERC20Freezable_init_unchained();
        __ERC20Hookable_init_unchained();
        __ERC20Trustable_init_unchained();
        __CWToken_init_unchained();
    }

    /**
     * @notice The internal unchained initializer of the upgradable contract
     *
     * See {CWToken-initialize}
     */
    function __CWToken_init_unchained() internal onlyInitializing {}

    /**
     * @inheritdoc IERC20ComplexBalance
     */
    function balanceOfComplex(address account) external view returns (ComplexBalance memory) {
        return _calculateComplexBalance(account);
    }

    /**
     * @dev Returns the current state of the account`s balances
     */
    function _calculateComplexBalance(address account) internal view returns (ComplexBalance memory) {
        ComplexBalance memory balance;

        balance.total = balanceOf(account);
        balance.premint = balanceOfPremint(account);
        balance.frozen = balanceOfFrozen(account);
        balance.restricted = 0;

        uint256 detained = balance.premint + balance.frozen + balance.restricted;
        balance.free = balance.total > detained ? balance.total - detained : 0;
        return balance;
    }

    /**
     * @dev See {ERC20Base-_beforeTokenTransfer}
     * @dev See {ERC20Hookable-_beforeTokenTransfer}
     */
    function _beforeTokenTransfer(
        address from,
        address to,
        uint256 amount
    ) internal virtual override(ERC20Base, ERC20Hookable) {
        super._beforeTokenTransfer(from, to, amount);
    }

    /**
     * @dev See {ERC20Base-_afterTokenTransfer}
     * @dev See {ERC20Hookable-_afterTokenTransfer}
     */
    function _afterTokenTransfer(
        address from,
        address to,
        uint256 amount
    ) internal virtual override(ERC20Base, ERC20Hookable) {
        super._afterTokenTransfer(from, to, amount);

        uint256 balanceTotal = balanceOf(from);
        uint256 balanceFrozen = balanceOfFrozen(from);
        uint256 balancePreminted = balanceOfPremint(from);

        if (balanceTotal < balanceFrozen + balancePreminted) {
            uint256 balanceFreezable = (balanceTotal >= balancePreminted) ? balanceTotal - balancePreminted : 0;

            if (balanceTotal < balancePreminted) {
                revert TransferExceededPremintedAmount();
            } else if (balanceFreezable < balanceFrozen && msg.sig != this.transferFrozen.selector) {
                revert TransferExceededFrozenAmount();
            }
        }
    }

    /**
     * @dev See {ERC20Base-allowance}
     * @dev See {ERC20Trustable-allowance}
     */
    function allowance(
        address owner,
        address spender
    ) public view override(ERC20Base, ERC20Trustable) returns (uint256) {
        return super.allowance(owner, spender);
    }
}
