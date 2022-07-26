// SPDX-License-Identifier: MIT

pragma solidity >=0.6.0 <0.8.0;

/**
 * @title IERC20Bridgeable interface
 */
interface IERC20Bridgeable {
    event MintForBridging(address indexed account, uint256 amount);
    event BurnForBridging(address indexed account, uint256 amount);

    function mintForBridging(address account, uint256 amount)
        external
        returns (bool);
    function burnForBridging(address account, uint256 amount)
        external
        returns (bool);
    function isBridgeSupported(address bridge) external view returns (bool);
    function isIERC20Bridgeable() external pure returns (bool);
}
