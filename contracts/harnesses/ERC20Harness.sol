// SPDX-License-Identifier: MIT

pragma solidity 0.8.16;

import { OwnableUpgradeable } from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import { ERC20Upgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import { HarnessAdministrable } from "./HarnessAdministrable.sol";

/**
 * @title ERC20Harness contract
 * @author CloudWalk Inc.
 * @notice An implementation of the {ERC20Upgradeable} contract for testing purposes
 */
contract ERC20Harness is OwnableUpgradeable, ERC20Upgradeable, HarnessAdministrable {
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
     * @notice The initialize function of the upgradable contract
     *
     * See details https://docs.openzeppelin.com/upgrades-plugins/1.x/writing-upgradeable
     *
     * @param name_ The name of the token
     * @param symbol_ The symbol of the token
     */
    function initialize(string memory name_, string memory symbol_) public initializer {
        __Context_init_unchained();
        __Ownable_init_unchained();
        __ERC20_init(name_, symbol_);
    }

    /**
     * @notice Calls the appropriate internal function to mint needed amount of tokens for an account
     *
     * @param account The address of an account to mint for
     * @param amount The amount of tokens to mint
     */
    function mint(address account, uint256 amount) external onlyHarnessAdmin {
        _mint(account, amount);
    }

    /**
     * @notice Calls the appropriate internal function to burn needed amount of tokens for an account
     *
     * @param account The address of an account to mint for
     * @param amount The amount of tokens to burn
     */
    function burn(address account, uint256 amount) external onlyHarnessAdmin {
        _burn(account, amount);
    }

    /**
     * @notice Calls the appropriate internal function to burn all tokens for an account
     *
     * @param account The address of an account to mint for
     */
    function burnAll(address account) external onlyHarnessAdmin {
        uint256 amount = balanceOf(account);
        _burn(account, amount);
    }

    function decimals() public pure virtual override returns (uint8) {
        return 6;
    }
}
