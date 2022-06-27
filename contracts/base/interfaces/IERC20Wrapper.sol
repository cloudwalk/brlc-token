// SPDX-License-Identifier: MIT

pragma solidity >=0.6.0 <0.8.0;

/**
 * @title IERC20Wrapper interface
 */
interface IERC20Wrapper {
    event Wrap(address indexed account, uint256 amount);
    event Unwrap(address indexed account, uint256 amount);

    function isIERC20Wrapper() external view returns (bool);
    function wrapFor(address account, uint256 amount) external returns (bool);
    function unwrapFor(address account, uint256 amount) external returns (bool);
    function underlying() external view returns (address);
}
