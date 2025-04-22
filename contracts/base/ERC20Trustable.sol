// SPDX-License-Identifier: MIT

pragma solidity ^0.8.20;

import { ERC20Base } from "./ERC20Base.sol";
import { IERC20Trustable } from "./interfaces/IERC20Trustable.sol";

/**
 * @title ERC20Trustable contract
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @notice The ERC20 token implementation that supports the `trusted` transfers on behalf
 */
abstract contract ERC20Trustable is ERC20Base, IERC20Trustable {
    /// @notice The mapping of the configured `trusted` status of the accounts
    mapping(address => bool) private _trusted;

    // -------------------- Errors -----------------------------------

    /// @notice Thrown when the account is already configured with the same `trusted` status
    error TrustedAccountAlreadyConfigured();

    // -------------------- Initializers -----------------------------

    /**
     * @notice The internal unchained initializer of the upgradable contract
     *
     * @dev See details: https://docs.openzeppelin.com/contracts/4.x/upgradeable#multiple-inheritance
     *
     * Note: The `..._init()` initializer has not been provided as redundant.
     */
    function __ERC20Trustable_init_unchained() internal onlyInitializing {}

    // -------------------- Functions --------------------------------

    /**
     * @inheritdoc IERC20Trustable
     *
     * @dev Can only be called by the owner
     * @dev Emits a {TrustedAccountConfigured} event
     */
    function configureTrustedAccount(address account, bool status) external onlyOwner {
        if (_trusted[account] == status) {
            revert TrustedAccountAlreadyConfigured();
        }

        _trusted[account] = status;

        emit TrustedAccountConfigured(account, status);
    }

    /**
     * @inheritdoc IERC20Trustable
     */
    function isTrustedAccount(address account) external view returns (bool) {
        return _trusted[account];
    }

    /**
     * @notice Returns the amount of tokens that the spender is allowed to spend on behalf of the owner
     *
     * @dev Returns {uint256.max} if the spender is a `trusted` account, otherwise the real allowance
     *
     * @param owner The address of the owner of the tokens
     * @param spender The address of the spender of the tokens
     */
    function allowance(address owner, address spender) public view virtual override returns (uint256) {
        if (_trusted[spender]) {
            return type(uint256).max;
        }
        return super.allowance(owner, spender);
    }

    /**
     * @dev This empty reserved space is put in place to allow future versions
     * to add new variables without shifting down storage in the inheritance chain
     */
    uint256[49] private __gap;
}
