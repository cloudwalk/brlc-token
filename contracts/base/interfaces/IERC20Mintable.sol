// SPDX-License-Identifier: MIT

pragma solidity 0.8.16;

/**
 * @title IERC20Mintable interface
 * @dev The interface of a token that supports mint and burn operations.
 */
interface IERC20Mintable {
    /// @dev Emitted when the master minter is changed.
    event MasterMinterChanged(address indexed newMasterMinter);

    /// @dev Emitted when a minter account is configured.
    event MinterConfigured(address indexed minter, uint256 mintAllowance);

    /// @dev Emitted when a minter account is removed.
    event MinterRemoved(address indexed oldMinter);

    /// @dev Emitted when tokens are minted.
    event Mint(address indexed minter, address indexed to, uint256 amount);

    /// @dev Emitted when tokens are burned.
    event Burn(address indexed burner, uint256 amount);

    /**
     * @dev Returns the master minter address.
     */
    function masterMinter() external view returns (address);

    /**
     * @dev Checks if the account is configured as a minter.
     * @param account The address to check.
     * @return True if the account is a minter.
     */
    function isMinter(address account) external view returns (bool);

    /**
     * @dev Returns a mint allowance of the minter.
     * @param minter The minter to check.
     * @return The mint allowance of the minter.
     */
    function minterAllowance(address minter) external view returns (uint256);

    /**
     * @dev Updates the master minter address.
     *
     * Emits a {MasterMinterChanged} event.
     *
     * @param newMasterMinter The address of a new master minter.
     */
    function updateMasterMinter(address newMasterMinter) external;

    /**
     * @dev Configures the minter.
     *
     * Emits a {MinterConfigured} event.
     *
     * @param minter The address of the minter to configure.
     * @param mintAllowance The mint allowance.
     * @return True if the operation was successful.
     */
    function configureMinter(address minter, uint256 mintAllowance) external returns (bool);

    /**
     * @dev Removes the minter.
     *
     * Emits a {MinterRemoved} event.
     *
     * @param minter The address of the minter to remove.
     * @return True if the operation was successful.
     */
    function removeMinter(address minter) external returns (bool);

    /**
     * @dev Mints tokens.
     *
     * Emits a {Mint} event.
     *
     * @param account The address of tokens recipient.
     * @param amount The amount of tokens to mint.
     * @return True if the operation was successful.
     */
    function mint(address account, uint256 amount) external returns (bool);

    /**
     * @dev Burns tokens.
     *
     * Emits a {Burn} event.
     *
     * @param amount The amount of tokens to burn.
     */
    function burn(uint256 amount) external;
}
