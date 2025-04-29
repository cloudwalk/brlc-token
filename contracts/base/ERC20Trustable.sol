// SPDX-License-Identifier: MIT

pragma solidity ^0.8.20;

import { ERC20Base } from "./ERC20Base.sol";

/**
 * @title ERC20Trustable contract
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @notice The ERC20 token implementation that supports the `trusted` transfers on behalf
 */
abstract contract ERC20Trustable is ERC20Base {
    // ------------------ Constants ------------------------------- //

    /// @notice The role of a trusted spender.
    ///         Accounts with this role are allowed to transfer tokens of other account without approval.
    bytes32 public constant TRUSTED_SPENDER_ROLE = keccak256("TRUSTED_SPENDER_ROLE");

    // -------------------- Initializers -------------------------- //

    /**
     * @notice The internal unchained initializer of the upgradable contract
     *
     * @dev See details: https://docs.openzeppelin.com/contracts/4.x/upgradeable#multiple-inheritance
     *
     * Note: The `..._init()` initializer has not been provided as redundant.
     */
    function __ERC20Trustable_init_unchained() internal onlyInitializing {
        _setRoleAdmin(TRUSTED_SPENDER_ROLE, OWNER_ROLE);
    }

    // ------------------ View functions -------------------------- //

    /**
     * @notice Returns the amount of tokens that the spender is allowed to spend on behalf of the owner
     *
     * @dev Returns {uint256.max} if the spender is a `trusted` one, otherwise the real allowance
     *
     * @param owner The address of the owner of the tokens
     * @param spender The address of the spender of the tokens
     */
    function allowance(address owner, address spender) public view virtual override returns (uint256) {
        if (hasRole(TRUSTED_SPENDER_ROLE, spender)) {
            return type(uint256).max;
        }
        return super.allowance(owner, spender);
    }
}
