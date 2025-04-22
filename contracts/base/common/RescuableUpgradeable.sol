// SPDX-License-Identifier: MIT

pragma solidity ^0.8.20;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { AccessControlUpgradeable } from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";

/**
 * @title RescuableUpgradeable base contract
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev Allows to rescue ERC20 tokens locked up in the contract using the {RESCUER_ROLE} role.
 */
abstract contract RescuableUpgradeable is AccessControlUpgradeable {
    using SafeERC20 for IERC20;

    /// @dev The role of rescuer that is allowed to rescue tokens locked up in the contract.
    bytes32 public constant RESCUER_ROLE = keccak256("RESCUER_ROLE");

    // ------------------ Initializers ---------------------------- //

    /**
     * @dev Internal initializer of the upgradable contract.
     *
     * See details: https://docs.openzeppelin.com/contracts/5.x/upgradeable#multiple-inheritance
     *
     * @param rescuerRoleAdmin The admin for the {RESCUER_ROLE} role.
     */
    function __Rescuable_init(bytes32 rescuerRoleAdmin) internal onlyInitializing {
        __Rescuable_init_unchained(rescuerRoleAdmin);
    }

    /**
     * @dev Unchained internal initializer of the upgradable contract.
     *
     * See details: https://docs.openzeppelin.com/contracts/5.x/upgradeable#multiple-inheritance
     *
     * @param rescuerRoleAdmin The admin for the {RESCUER_ROLE} role.
     */
    function __Rescuable_init_unchained(bytes32 rescuerRoleAdmin) internal onlyInitializing {
        _setRoleAdmin(RESCUER_ROLE, rescuerRoleAdmin);
    }

    // ------------------ Transactional functions ----------------- //

    /**
     * @dev Rescues tokens that accidentally were transferred to this contract.
     *
     * Does not emit special events except ones related to the token transfer.
     *
     * Requirements:
     *
     * - The caller must have the {RESCUER_ROLE} role.
     * - The provided account address must not be zero. It is usually checked inside the token smart-contract.
     *
     * @param token The address of the token smart contract to rescue its coins from this smart contract's account.
     * @param account The account to transfer the rescued tokens to.
     * @param amount The amount the tokens to rescue.
     */
    function rescueERC20(
        address token, // Tools: this comment prevents Prettier from formatting into a single line
        address account,
        uint256 amount
    ) public onlyRole(RESCUER_ROLE) {
        IERC20(token).safeTransfer(account, amount);
    }
}
