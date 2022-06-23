// SPDX-License-Identifier: MIT

pragma solidity >=0.6.0 <0.8.0;

/**
 * @title IERC20Bridgeable interface
 */
interface IERC20Bridgeable {
    event MintAndAccommodate(address indexed account, uint256 amount);
    event BurnAndRelocate(address indexed account, uint256 amount);

    function mintAndAccommodate(address account, uint256 amount)
        external
        returns (bool);
    function burnAndRelocate(address account, uint256 amount)
        external
        returns (bool);
    function bridge() external view returns (address);
}
