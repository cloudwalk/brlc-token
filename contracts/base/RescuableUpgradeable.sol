// SPDX-License-Identifier: MIT

pragma solidity 0.8.16;

import { IERC20Upgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import { SafeERC20Upgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import { OwnableUpgradeable } from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

/**
 * @title Rescuable base contract
 */
abstract contract RescuableUpgradeable is OwnableUpgradeable {
    using SafeERC20Upgradeable for IERC20Upgradeable;

    address private _rescuer;

    event RescuerChanged(address indexed newRescuer);

    function __Rescuable_init() internal initializer {
        __Context_init_unchained();
        __Ownable_init_unchained();
        __Rescuable_init_unchained();
    }

    function __Rescuable_init_unchained() internal initializer {}

    /**
     * @dev Revert if called by any account other than the rescuer.
     */
    modifier onlyRescuer() {
        require(getRescuer() == _msgSender(), "Rescuable: caller is not the rescuer");
        _;
    }

    /**
     * @dev Returns the current rescuer.
     * @return Rescuer's address.
     */
    function getRescuer() public view virtual returns (address) {
        return _rescuer;
    }

    /**
     * @dev Assign the rescuer role to a given address.
     * Can only be called by the contract owner.
     * Emits a {RescuerChanged} event.
     * @param newRescuer A new rescuer's address.
     */
    function setRescuer(address newRescuer) external onlyOwner {
        _rescuer = newRescuer;
        emit RescuerChanged(newRescuer);
    }

    /**
     * @dev Rescue ERC20 tokens locked up in this contract.
     * Can only be called by the rescuer.
     * @param tokenContract The ERC20 token contract address.
     * @param to The recipient address.
     * @param amount The amount to withdraw.
     */
    function rescueERC20(
        IERC20Upgradeable tokenContract,
        address to,
        uint256 amount
    ) external onlyRescuer {
        tokenContract.safeTransfer(to, amount);
    }
}
