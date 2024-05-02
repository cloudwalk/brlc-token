// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

/**
 * @title IERC20Bridgeable interface
 * @author CloudWalk Inc.
 * @notice The interface of a token that supports bridging operations
 */
interface IERC20Bridgeable {
    /**
     * @notice Emitted when a minting is performed as part of a bridge operation
     *
     * @param account The owner of the tokens passing through the bridge
     * @param amount The amount of tokens passing through the bridge
     */
    event MintForBridging(address indexed account, uint256 amount);

    /**
     * @notice Emitted when a burning is performed as part of a bridge operation
     *
     * @param account The owner of the tokens passing through the bridge
     * @param amount The amount of tokens passing through the bridge
     */
    event BurnForBridging(address indexed account, uint256 amount);

    /**
     * @notice Emitted when the bridge contract is configured
     *
     * @param newBridge The address of the new bridge contract
     * @param oldBridge The address of the old bridge contract
     */
    event SetBridge(address newBridge, address oldBridge);

    /**
     * @notice Sets the new bridge contract
     *
     * @param newBridge The address of the new bridge contract
     *
     * It is expected that this function can be called only by a contract owner
     *
     * Emits a {SetBridge} event
     */
    function setBridge(address newBridge) external;

    /**
     * @notice Mints tokens as part of a bridge operation
     *
     * It is expected that this function can be called only by a bridge contract
     *
     * Emits a {MintForBridging} event
     *
     * @param account The owner of the tokens passing through the bridge
     * @param amount The amount of tokens passing through the bridge
     * @return True if the operation was successful
     */
    function mintForBridging(address account, uint256 amount) external returns (bool);

    /**
     * @notice Burns tokens as part of a bridge operation
     *
     * It is expected that this function can be called only by a bridge contract
     *
     * Emits a {BurnForBridging} event
     *
     * @param account The owner of the tokens passing through the bridge
     * @param amount The amount of tokens passing through the bridge
     * @return True if the operation was successful
     */
    function burnForBridging(address account, uint256 amount) external returns (bool);

    /**
     * @notice Checks whether a bridge is supported by the token or not
     *
     * @param bridge The address of the bridge to check
     * @return True if the bridge is supported by the token
     */
    function isBridgeSupported(address bridge) external view returns (bool);

    /**
     * @notice Checks whether the token supports bridging operations
     * by implementing IERC20Bridgeable interface
     *
     * @return True in any case
     */
    function isIERC20Bridgeable() external view returns (bool);
}
