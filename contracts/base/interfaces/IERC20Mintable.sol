// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

/**
 * @title IERC20Mintable interface
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @notice The interface of a token that supports mint and burn operations
 */
interface IERC20Mintable {
    /**
     * @notice Emitted when the main minter is changed
     *
     * @param newMainMinter The address of a new main minter
     */
    event MainMinterChanged(address indexed newMainMinter);

    /**
     * @notice Emitted when a minter account is configured
     *
     * @param minter The address of the minter to configure
     * @param mintAllowance The mint allowance
     */
    event MinterConfigured(address indexed minter, uint256 mintAllowance);

    /**
     * @notice Emitted when a minter account is removed
     *
     * @param oldMinter The address of the minter to remove
     */
    event MinterRemoved(address indexed oldMinter);

    /**
     * @notice Emitted when tokens are minted
     *
     * @param minter The address of the minter
     * @param to The address of the tokens recipient
     * @param amount The amount of tokens being minted
     */
    event Mint(address indexed minter, address indexed to, uint256 amount);

    /**
     * @notice Emitted when tokens are minted from reserve
     *
     * @param minter The address of the minter
     * @param to The address of the tokens recipient
     * @param amount The amount of tokens being minted
     * @param newReserveSupply The new total reserve supply
     */
    event MintFromReserve(
        address indexed minter, // Tools: this comment prevents Prettier from formatting into a single line.
        address indexed to,
        uint256 amount,
        uint256 newReserveSupply
    );

    /**
     * @notice Emitted when tokens are preminted
     *
     * @param minter The address of the minter
     * @param to The address of the tokens recipient
     * @param newAmount The new amount of tokens being preminted
     * @param oldAmount The old amount of tokens being preminted
     * @param release The timestamp when the tokens will be released
     */
    event Premint(
        address indexed minter, // Tools: this comment prevents Prettier from formatting into a single line.
        address indexed to,
        uint256 newAmount,
        uint256 oldAmount,
        uint256 release
    );

    /**
     * @notice Emitted when premint release is rescheduled
     *
     * @param minter The address of the minter who initiated the rescheduling
     * @param originalRelease The premint release timestamp that has been rescheduled
     * @param newTargetRelease The new target premint release timestamp set during the rescheduling
     * @param oldTargetRelease The old target premint release timestamp before the rescheduling
     */
    event PremintReleaseRescheduled(
        address indexed minter,
        uint256 indexed originalRelease,
        uint256 indexed newTargetRelease,
        uint256 oldTargetRelease
    );

    /**
     * @notice Emitted when tokens are burned
     *
     * @param burner The address of the tokens burner
     * @param amount The amount of tokens being burned
     */
    event Burn(address indexed burner, uint256 amount);

    /**
     * @notice Emitted when tokens are burned to reserve
     *
     * @param burner The address of the tokens burner
     * @param amount The amount of tokens being burned
     * @param newReserveSupply The new total reserve supply
     */
    event BurnToReserve(
        address indexed burner, // Tools: this comment prevents Prettier from formatting into a single line.
        uint256 amount,
        uint256 newReserveSupply
    );

    /**
     * @notice Emitted when the limit of premints is configured
     *
     * @param newLimit The new limit of premints
     */
    event MaxPendingPremintsCountConfigured(uint256 newLimit);

    /**
     * @notice Returns the main minter address
     */
    function mainMinter() external view returns (address);

    /**
     * @notice Checks if the account is configured as a minter
     *
     * @param account The address to check
     * @return True if the account is a minter
     */
    function isMinter(address account) external view returns (bool);

    /**
     * @notice Returns the mint allowance of a minter
     *
     * @param minter The minter to check
     * @return The mint allowance of the minter
     */
    function minterAllowance(address minter) external view returns (uint256);

    /**
     * @notice Returns the total reserve supply
     *
     * @return The total reserve supply
     */
    function totalReserveSupply() external view returns (uint256);

    /**
     * @notice Updates the main minter address
     *
     * Emits a {MainMinterChanged} event
     *
     * @param newMainMinter The address of a new main minter
     */
    function updateMainMinter(address newMainMinter) external;

    /**
     * @notice Configures a minter
     *
     * Emits a {MinterConfigured} event
     *
     * @param minter The address of the minter to configure
     * @param mintAllowance The mint allowance
     * @return True if the operation was successful
     */
    function configureMinter(address minter, uint256 mintAllowance) external returns (bool);

    /**
     * @notice Removes a minter
     *
     * Emits a {MinterRemoved} event
     *
     * @param minter The address of the minter to remove
     * @return True if the operation was successful
     */
    function removeMinter(address minter) external returns (bool);

    /**
     * @notice Configures the max count of pending premints
     *
     * Emits a {MaxPendingPremintsCountConfigured} event
     *
     * @param newLimit The new max count
     */
    function configureMaxPendingPremintsCount(uint16 newLimit) external;

    /**
     * @notice Mints tokens
     *
     * Emits a {Mint} event
     *
     * @param account The address of a tokens recipient
     * @param amount The amount of tokens to mint
     * @return True if the operation was successful
     */
    function mint(address account, uint256 amount) external returns (bool);

    /**
     * @notice Increases the amount of an existing premint or creates a new one if it does not exist
     *
     * Emits a {Premint} event
     *
     * @param account The address of a tokens recipient
     * @param amount The amount of tokens to increase
     * @param release The timestamp when the tokens will be released
     */
    function premintIncrease(address account, uint256 amount, uint256 release) external;

    /**
     * @notice Decreases the amount of an existing premint or fails if it does not exist
     *
     * Emits a {Premint} event
     *
     * @param account The address of a tokens recipient
     * @param amount The amount of tokens to decrease
     * @param release The timestamp when the tokens will be released
     */
    function premintDecrease(address account, uint256 amount, uint256 release) external;

    /**
     * @notice Reschedules original premint release to a new target release
     *
     * Emits a {PremintReleaseRescheduled} event
     *
     * @param originalRelease The timestamp of the original premint release to be rescheduled
     * @param targetRelease The new timestamp of the premint release to set during the rescheduling
     */
    function reschedulePremintRelease(uint256 originalRelease, uint256 targetRelease) external;

    /**
     * @notice Mints tokens from reserve
     *
     * @dev Minting from reserve means that the tokens are minted in a regular way, but we also
     * increase the total reserve supply by the amount of tokens minted
     *
     * Emits a {Mint} event
     * Emits a {MintFromReserve} event
     *
     * @param account The address of a tokens recipient
     * @param amount The amount of tokens to mint
     */
    function mintFromReserve(address account, uint256 amount) external;

    /**
     * @notice Burns tokens
     *
     * Emits a {Burn} event
     *
     * @param amount The amount of tokens to burn
     */
    function burn(uint256 amount) external;

    /**
     * @notice Burns tokens to reserve
     *
     * @dev Burning to reserve means that the tokens are burned in a regular way, but we also
     * decrease the total reserve supply by the amount of tokens burned
     *
     * Emits a {Burn} event
     * Emits a {BurnToReserve} event
     *
     * @param amount The amount of tokens to burn
     */
    function burnToReserve(uint256 amount) external;
}
