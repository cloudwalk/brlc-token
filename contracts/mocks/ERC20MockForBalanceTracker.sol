// SPDX-License-Identifier: MIT

pragma solidity 0.8.16;

import { BalanceTracker } from "../periphery/BalanceTracker.sol";

/**
 * @title ERC20MockForBalanceTracker contract
 * @author CloudWalk Inc.
 * @notice A simplified implementation of the ERC20 token contract for testing the BalanceTracker contract
 */
contract ERC20MockForBalanceTracker {
    uint256 internal _totalSupply;
    mapping(address => uint256) internal _balances;

    function setBalance(address account, uint256 amount) external {
        _totalSupply -= _balances[account];
        _balances[account] = amount;
        _totalSupply += amount;
    }

    function totalSupply() public view returns (uint256) {
        return _totalSupply;
    }

    function balanceOf(address account) public view returns (uint256) {
        return _balances[account];
    }

    function simulateHookedTransfer(address balanceTracker, address from, address to, uint256 amount) external {
        BalanceTracker(balanceTracker).beforeTokenTransfer(from, to, amount);
        if (from != address(0)) {
            _balances[from] -= amount;
        } else {
            _totalSupply -= amount;
        }
        if (to != address(0)) {
            _balances[to] += amount;
        } else {
            _totalSupply += amount;
        }
        BalanceTracker(balanceTracker).afterTokenTransfer(from, to, amount);
    }
}
