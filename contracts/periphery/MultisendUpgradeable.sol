// SPDX-License-Identifier: MIT

pragma solidity >=0.6.0 <0.8.0;

import {IERC20Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import {SafeMathUpgradeable} from "@openzeppelin/contracts-upgradeable/math/SafeMathUpgradeable.sol";
import {WhitelistableExUpgradeable} from "../base/WhitelistableExUpgradeable.sol";
import {PausableExUpgradeable} from "../base/PausableExUpgradeable.sol";
import {RescuableUpgradeable} from "../base/RescuableUpgradeable.sol";

/**
 * @title MultisendUpgradeable contract
 * @notice Used for ERC20 token distribution & airdrops
 */
contract MultisendUpgradeable is
    RescuableUpgradeable,
    PausableExUpgradeable,
    WhitelistableExUpgradeable
{
    using SafeMathUpgradeable for uint256;

    event Multisend(address indexed token, uint256 total);

    function initialize() public initializer {
        __Multisend_init();
    }

    function __Multisend_init() internal initializer {
        __Context_init_unchained();
        __Ownable_init_unchained();
        __Rescuable_init_unchained();
        __Pausable_init_unchained();
        __PausableEx_init_unchained();
        __Whitelistable_init_unchained();
        __WhitelistableEx_init_unchained();
        __Multisend_init_unchained();
    }

    function __Multisend_init_unchained() internal initializer {}

    /**
     * @notice Executes token distribution/airdrop
     * Can only be called when contract is not paused
     * Can only be called by whitelisted address
     * Emits an {Multisend} event
     * @param token The address of distribution token
     * @param recipients Token recipient addresses
     * @param balances Token recipient balances
     */
    function multisendToken(
        address token,
        address[] memory recipients,
        uint256[] memory balances
    ) external whenNotPaused onlyWhitelisted(_msgSender()) {
        require(
            token != address(0),
            "Multisend: zero token address"
        );
        require(
            recipients.length != 0,
            "Multisend: recipients array is empty"
        );
        require(
            recipients.length == balances.length,
            "Multisend: length of recipients and balances arrays must be equal"
        );

        IERC20Upgradeable erc20 = IERC20Upgradeable(token);
        uint256 total = 0;

        for (uint8 i = 0; i < recipients.length; i++) {
            erc20.transfer(recipients[i], balances[i]);
            total = total.add(balances[i]);
        }

        emit Multisend(token, total);
    }
}
