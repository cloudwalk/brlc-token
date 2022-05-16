// SPDX-License-Identifier: MIT

pragma solidity >=0.6.0 <0.8.0;

import {BRLCTokenUpgradeable} from "../../tokens/BRLCTokenUpgradeable.sol";

/**
 * @title BRLCTokenUpgradeableMock contract.
 * @notice For test purpose of the "BRLCTokenUpgradeable" contract.
 */
contract BRLCTokenUpgradeableMock is BRLCTokenUpgradeable {

    event TestBeforeTokenTransferSucceeded();

    // This function is intentionally deprived the "initializer" modifier to test that the ancestor contract has it
    function initialize(
        string memory name_,
        string memory symbol_,
        uint8 decimals_
    ) public {
        __BRLCToken_init(name_, symbol_, decimals_);
    }

    // This function is intentionally deprived the "initializer" modifier to test that the ancestor contract has it
    function initialize_unchained(
        uint8 decimals_
    ) public {
        __BRLCToken_init_unchained(decimals_);
    }

    function mint(address account, uint256 amount) external returns (bool) {
        _mint(account, amount);
        return true;
    }

    function testBeforeTokenTransfer(
        address from,
        address to,
        uint256 amount
    ) external {
        _beforeTokenTransfer(from, to, amount);
        emit TestBeforeTokenTransferSucceeded();
    }
}
