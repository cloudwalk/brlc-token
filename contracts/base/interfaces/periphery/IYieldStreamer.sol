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
     * @param yield The amount of yield before fee
     * @param fee The yield fee
     */
    event Claim(address indexed account, uint256 yield, uint256 fee);

    /**
     * @notice A structure describing the result details of a claim operation
     */
    struct ClaimResult {
        uint256 nextClaimDay;   // The index of the day from which the subsequent yield will be calculated next time
        uint256 nextClaimDebit; // The amount of yield that will already be considered claimed for the next claim day
        uint256 firstYieldDay;  // The index of the first day from which the current yield was calculated for this claim
        uint256 prevClaimDebit; // The amount of yield that was already claimed previously for the first yield day
        uint256 primaryYield;   // The yield primary amount based on the number of whole days passed since the previous claim
        uint256 streamYield;    // The yield stream amount based on the time passed since the beginning of the current day
        uint256 lastDayYield;   // The whole-day yield for the last day in the time range of this claim
        uint256 shortfall;      // The amount of yield that is not enough to cover this claim
        uint256 fee;            // The amount of fee for this claim, rounded upward
        uint256 yield;          // The amount of final yield for this claim before applying the fee, rounded down
    }

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
