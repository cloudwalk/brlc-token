// SPDX-License-Identifier: MIT

pragma solidity 0.8.16;

/**
 * @title IYieldStreamer interface
 * @author CloudWalk Inc.
 * @notice The interface of a contract that supports yield streaming
 */
interface IYieldStreamer {
    /**
     * @notice Emitted when an account claims accrued yield
     * @param account The address of the account
     * @param yield The amount of yield before tax
     * @param tax The yield tax
     */
    event Claim(address indexed account, uint256 yield, uint256 tax);

    /**
     * @notice A struct describing the details of the result of the claim operation
     */
    struct ClaimResult {
        uint256 nextClaimDay;   // The index of the day from which the subsequent yield will be calculated next time
        uint256 nextClaimDebit; // The amount of yield that will already be considered claimed for the next claim day
        uint256 primaryYield;   // The yield primary amount based on the number of whole days passed since the previous claim
        uint256 streamYield;    // The yield stream amount based on the time passed since the beginning of the current day
        uint256 shortfall;      // The amount of yield that is not enough to cover this claim
        uint256 tax;            // The amount of tax for this claim
    }

    /**
     * @notice Claims all accrued yield
     *
     * Emits a {Claim} event
     */
    function claimAll() external;

    /**
     * @notice Claims a portion of accrued yield
     *
     * @param amount The portion of yield to claim
     *
     * Emits a {Claim} event
     */
    function claim(uint256 amount) external;

    /**
     * @notice Previews the result of claiming all accrued yield
     *
     * @param account The address to preview the claim for
     */
    function claimAllPreview(address account) external view returns (ClaimResult memory);

    /**
     * @notice Previews the result of claiming a portion of accrued yield
     *
     * @param account The address to preview the claim for
     * @param amount The portion of yield to be claimed
     */
    function claimPreview(address account, uint256 amount) external view returns (ClaimResult memory);
}