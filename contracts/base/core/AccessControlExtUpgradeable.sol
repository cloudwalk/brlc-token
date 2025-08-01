// SPDX-License-Identifier: MIT

pragma solidity ^0.8.20;

import { AccessControlUpgradeable } from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";

/**
 * @title AccessControlExtUpgradeable base contract
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev Extends the OpenZeppelin's {AccessControlUpgradeable} contract by introducing new roles and
 *      adding functions for granting and revoking roles in batch.
 */
abstract contract AccessControlExtUpgradeable is AccessControlUpgradeable {
    // ------------------ Constants ------------------------------- //

    /// @dev The role of this contract owner.
    bytes32 public constant OWNER_ROLE = keccak256("OWNER_ROLE");

    /// @dev The role of a grantor that is allowed to grant and revoke other roles, except itself and the owner role.
    bytes32 public constant GRANTOR_ROLE = keccak256("GRANTOR_ROLE");

    // ------------------ Initializers ---------------------------- //

    /**
     * @dev The unchained internal initializer of the upgradeable contract.
     *
     * See details: https://docs.openzeppelin.com/contracts/5.x/upgradeable#multiple-inheritance
     *
     * Note: The `..._init()` initializer has not been provided as redundant.
     */
    function __AccessControlExt_init_unchained() internal onlyInitializing {
        _setRoleAdmin(OWNER_ROLE, OWNER_ROLE);
        _setRoleAdmin(GRANTOR_ROLE, OWNER_ROLE);
    }

    // ------------------ Transactional functions ----------------- //

    /**
     * @dev Grants a role to accounts in batch.
     *
     * Emits a {RoleGranted} event for each account that has not been granted the provided role previously.
     *
     * Requirement: the caller must have the role that is the admin for the role that is being granted.
     *
     * @param role The role to grant.
     * @param accounts The accounts to grant the role to.
     */
    function grantRoleBatch(bytes32 role, address[] memory accounts) public virtual onlyRole(getRoleAdmin(role)) {
        uint256 count = accounts.length;
        for (uint256 i = 0; i < count; ) {
            _grantRole(role, accounts[i]);
            unchecked {
                ++i;
            }
        }
    }

    /**
     * @dev Revokes a role from accounts in batch.
     *
     * Emits a {RoleRevoked} event for each account that has the provided role previously.
     *
     * Requirement: the caller must have the role that is the admin for the role that is being revoked.
     *
     * @param role The role to revoke.
     * @param accounts The accounts to revoke the role from.
     */
    function revokeRoleBatch(bytes32 role, address[] memory accounts) public virtual onlyRole(getRoleAdmin(role)) {
        uint256 count = accounts.length;
        for (uint256 i = 0; i < count; ) {
            _revokeRole(role, accounts[i]);
            unchecked {
                ++i;
            }
        }
    }

    /**
     * @dev Sets the admin role for a given role.
     * @param role The role to set the admin role for.
     * @param adminRole The admin role to set.
     */
    function setRoleAdmin(bytes32 role, bytes32 adminRole) external onlyRole(OWNER_ROLE) {
        _setRoleAdmin(role, adminRole);
    }
}
