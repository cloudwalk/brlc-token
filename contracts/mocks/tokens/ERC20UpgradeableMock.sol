// SPDX-License-Identifier: MIT
pragma solidity >=0.6.0 <0.8.0;

import {ERC20Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";

/**
 * @title ERC20UpgradeableMock contract.
 * @notice For usage as ERC20-compatible contract int test purposes.
 */
contract ERC20UpgradeableMock is ERC20Upgradeable {

    function initialize(
        string memory name_,
        string memory symbol_,
        uint8 decimals_
    ) public initializer {
        __ERC20_init(name_, symbol_);
        _setupDecimals(decimals_);
    }

    function mint(address account, uint256 amount) external returns (bool) {
        _mint(account, amount);
        return true;
    }

    function burn(uint256 amount) external {
        _burn(msg.sender, amount);
    }
}
