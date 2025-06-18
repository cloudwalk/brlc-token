// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

/**
 * @title IERC20Mintable interface
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev The interface of a token that supports mint and burn operations.
 */
interface IERC20Mintable {
    // ------------------ Events ---------------------------------- //

    /**
     * @dev Emitted when tokens are minted.
     * @param minter The address of the minter.
     * @param to The address of the tokens recipient.
     * @param amount The amount of tokens being minted.
     */
    event Mint(address indexed minter, address indexed to, uint256 amount);

    /**
     * @dev Emitted when tokens are minted from reserve.
     * @param minter The address of the minter.
     * @param to The address of the tokens recipient.
     * @param amount The amount of tokens being minted.
     * @param newReserveSupply The new total reserve supply.
     */
    event MintFromReserve(
        address indexed minter, // Tools: this comment prevents Prettier from formatting into a single line.
        address indexed to,
        uint256 amount,
        uint256 newReserveSupply
    );

    /**
     * @dev Emitted when tokens are preminted.
     * @param minter The address of the minter.
     * @param to The address of the tokens recipient.
     * @param newAmount The new amount of tokens being preminted.
     * @param oldAmount The old amount of tokens being preminted.
     * @param release The timestamp when the tokens will be released.
     */
    event Premint(
        address indexed minter, // Tools: this comment prevents Prettier from formatting into a single line.
        address indexed to,
        uint256 newAmount,
        uint256 oldAmount,
        uint256 release
    );

    /**
     * @dev Emitted when premint release is rescheduled.
     * @param minter The address of the minter who initiated the rescheduling.
     * @param originalRelease The premint release timestamp that has been rescheduled.
     * @param newTargetRelease The new target premint release timestamp set during the rescheduling.
     * @param oldTargetRelease The old target premint release timestamp before the rescheduling.
     */
    event PremintReleaseRescheduled(
        address indexed minter,
        uint256 indexed originalRelease,
        uint256 indexed newTargetRelease,
        uint256 oldTargetRelease
    );

    /**
     * @dev Emitted when tokens are burned.
     * @param burner The address of the tokens burner.
     * @param amount The amount of tokens being burned.
     */
    event Burn(address indexed burner, uint256 amount);

    /**
     * @dev Emitted when tokens are burned to reserve.
     * @param burner The address of the tokens burner.
     * @param amount The amount of tokens being burned.
     * @param newReserveSupply The new total reserve supply.
     */
    event BurnToReserve(
        address indexed burner, // Tools: this comment prevents Prettier from formatting into a single line.
        uint256 amount,
        uint256 newReserveSupply
    );

    /**
     * @dev Emitted when the limit of premints is configured.
     * @param newLimit The new limit of premints.
     */
    event MaxPendingPremintsCountConfigured(uint256 newLimit);

    // ------------------ Transactional functions ----------------- //

    /**
     * @dev Configures the max count of pending premints.
     *
     * Emits a {MaxPendingPremintsCountConfigured} event.
     *
     * @param newLimit The new max count.
     */
    function configureMaxPendingPremintsCount(uint16 newLimit) external;

    /**
     * @dev Mints tokens.
     *
     * Emits a {Mint} event.
     *
     * @param account The address of a tokens recipient.
     * @param amount The amount of tokens to mint.
     * @return True if the operation was successful.
     */
    function mint(address account, uint256 amount) external returns (bool);

    /**
     * @dev Increases the amount of an existing premint or creates a new one if it does not exist.
     *
     * Emits a {Premint} event.
     *
     * @param account The address of a tokens recipient.
     * @param amount The amount of tokens to increase.
     * @param release The timestamp when the tokens will be released.
     */
    function premintIncrease(address account, uint256 amount, uint256 release) external;

    /**
     * @dev Decreases the amount of an existing premint or fails if it does not exist.
     *
     * Emits a {Premint} event.
     *
     * @param account The address of a tokens recipient.
     * @param amount The amount of tokens to decrease.
     * @param release The timestamp when the tokens will be released.
     */
    function premintDecrease(address account, uint256 amount, uint256 release) external;

    /**
     * @dev Reschedules original premint release to a new target release.
     *
     * Emits a {PremintReleaseRescheduled} event.
     *
     * @param originalRelease The timestamp of the original premint release to be rescheduled.
     * @param targetRelease The new timestamp of the premint release to set during the rescheduling.
     */
    function reschedulePremintRelease(uint256 originalRelease, uint256 targetRelease) external;

    /**
     * @dev Mints tokens from reserve.
     *
     * Minting from reserve means that the tokens are minted in a regular way, but we also
     * increase the total reserve supply by the amount of tokens minted.
     *
     * Emits a {Mint} event.
     * Emits a {MintFromReserve} event.
     *
     * @param account The address of a tokens recipient.
     * @param amount The amount of tokens to mint.
     */
    function mintFromReserve(address account, uint256 amount) external;

    /**
     * @dev Burns tokens.
     *
     * Emits a {Burn} event.
     *
     * @param amount The amount of tokens to burn.
     */
    function burn(uint256 amount) external;

    /**
     * @dev Burns tokens to reserve.
     *
     * Burning to reserve means that the tokens are burned in a regular way, but we also
     * decrease the total reserve supply by the amount of tokens burned.
     *
     * Emits a {Burn} event.
     * Emits a {BurnToReserve} event.
     *
     * @param amount The amount of tokens to burn.
     */
    function burnToReserve(uint256 amount) external;

    // ------------------ View functions -------------------------- //

    /**
     * @dev Returns the total reserve supply.
     * @return The total reserve supply.
     */
    function totalReserveSupply() external view returns (uint256);
}
