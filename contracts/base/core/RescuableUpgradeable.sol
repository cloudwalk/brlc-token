// SPDX-License-Identifier: MIT

pragma solidity ^0.8.20;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import { AccessControlExtUpgradeable } from "./AccessControlExtUpgradeable.sol";

/**
 * @title RescuableUpgradeable base contract
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev Allows rescuing ERC20 tokens locked in the contract using the {RESCUER_ROLE} role.
 */
abstract contract RescuableUpgradeable is AccessControlExtUpgradeable {
    // ------------------ Types ----------------------------------- //

    using SafeERC20 for IERC20;

    // ------------------ Constants ------------------------------- //

    /// @dev The role of a rescuer that is allowed to rescue tokens locked in the contract.
    bytes32 public constant RESCUER_ROLE = keccak256("RESCUER_ROLE");

    // ------------------ Initializers ---------------------------- //

    /**
     * @dev The unchained internal initializer of the upgradeable contract
     *
     * See details: https://docs.openzeppelin.com/contracts/5.x/upgradeable#multiple-inheritance
     *
     * Note: The `..._init()` initializer has not been provided as redundant.
     */
    function __Rescuable_init_unchained() internal onlyInitializing {
        _setRoleAdmin(RESCUER_ROLE, GRANTOR_ROLE);
    }

    // ------------------ Transactional functions ----------------- //

    /**
     * @dev Rescues tokens that were accidentally transferred to this contract.
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
     * @param amount The amount of tokens to rescue.
     */
    function rescueERC20(
        address token, // Tools: this comment prevents Prettier from formatting into a single line
        address account,
        uint256 amount
    ) public onlyRole(RESCUER_ROLE) {
        IERC20(token).safeTransfer(account, amount);
    }
}
