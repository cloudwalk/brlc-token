// SPDX-License-Identifier: MIT

pragma solidity 0.8.16;

/**
 * @title IERC20Mintable interface
 */
interface IERC20Mintable {
    event MasterMinterChanged(address indexed newMasterMinter);
    event MinterConfigured(address indexed minter, uint256 mintAllowance);
    event MinterRemoved(address indexed oldMinter);
    event Mint(address indexed minter, address indexed to, uint256 amount);
    event Burn(address indexed burner, uint256 amount);

    function masterMinter() external view returns (address);

    function isMinter(address account) external view returns (bool);

    function minterAllowance(address minter) external view returns (uint256);

    function updateMasterMinter(address newMasterMinter) external;

    function configureMinter(address minter, uint256 mintAllowance) external returns (bool);

    function removeMinter(address minter) external returns (bool);

    function mint(address to, uint256 amount) external returns (bool);

    function burn(uint256 amount) external;
}
