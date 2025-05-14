// SPDX-License-Identifier: MIT

pragma solidity ^0.8.20;

import { ERC20Base } from "./ERC20Base.sol";
import { ERC20Mintable } from "./ERC20Mintable.sol";
import { ERC20Freezable } from "./ERC20Freezable.sol";
import { ERC20Hookable } from "./ERC20Hookable.sol";
import { ERC20Trustable } from "./ERC20Trustable.sol";
import { Versionable } from "./Versionable.sol";

import { IERC20ComplexBalance } from "./interfaces/IERC20ComplexBalance.sol";

import { LegacyMintablePlaceholder } from "../legacy/LegacyMintablePlaceholder.sol";
import { LegacyRestrictablePlaceholder } from "../legacy/LegacyRestrictablePlaceholder.sol";
import { LegacyTrustablePlaceholder } from "../legacy/LegacyTrustablePlaceholder.sol";

/**
 * @title CWToken contract
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @notice The CloudWalk token that extends the standard ERC20 token implementation with additional functionality
 */
abstract contract CWToken is
    ERC20Base,
    LegacyMintablePlaceholder,
    ERC20Mintable,
    ERC20Freezable,
    LegacyRestrictablePlaceholder,
    ERC20Hookable,
    LegacyTrustablePlaceholder,
    ERC20Trustable,
    IERC20ComplexBalance,
    Versionable
{
    // -------------------- Initializers -------------------------- //

    /**
     * @notice The internal initializer of the upgradable contract
     *
     * @dev See details: https://docs.openzeppelin.com/contracts/4.x/upgradeable#multiple-inheritance
     * @param name_ The name of the token
     * @param symbol_ The symbol of the token
     */
    function __CWToken_init(string memory name_, string memory symbol_) internal onlyInitializing {
        __ERC20Base_init(name_, symbol_);
        __ERC20Mintable_init_unchained();
        __ERC20Freezable_init_unchained();
        __ERC20Hookable_init_unchained();
        __ERC20Trustable_init_unchained();
    }

    /**
     * @notice The internal unchained initializer of the upgradable contract
     *
     * @dev See details: https://docs.openzeppelin.com/contracts/4.x/upgradeable#multiple-inheritance
     */
    function __CWToken_init_unchained() internal onlyInitializing {}

    // -------------------- View functions ------------------------ //

    /**
     * @inheritdoc IERC20ComplexBalance
     */
    function balanceOfComplex(address account) external view returns (ComplexBalance memory) {
        return _calculateComplexBalance(account);
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

    // -------------------- Internal functions ------------------------ //

    /**
     * @dev Returns the current state of the account`s balances
     */
    function _calculateComplexBalance(address account) internal view returns (ComplexBalance memory) {
        ComplexBalance memory balance;

        balance.total = balanceOf(account);
        balance.premint = balanceOfPremint(account);
        balance.frozen = balanceOfFrozen(account);

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
}
