// SPDX-License-Identifier: MIT

pragma solidity 0.8.16;

/**
 * @title IYieldStreamer interface
 * @author CloudWalk Inc.
 * @notice The interface of a contract that supports yield streaming
 */
interface IYieldStreamer {
    /**
     * @notice Emitted when an account claims accrued income
     * @param account The address of the account
     * @param income The amount of income
     * @param tax The income tax
     */
    event Claim(address indexed account, uint256 income, uint256 tax);

    /**
     * @notice The struct of a claim result
     * @param day The day of the claim applied for the account
     * @param debt The amount of income consumed on the day of the claim
     * @param shortfall The amount of income that is not enough to cover the claim
     * @param heldIncome The amount of income held for the claim excluding stream income
     * @param streamIncome The amount of income held for the claim as stream income
     * @param tax The amount of income tax from the claim amount
     */
    struct ClaimResult {
        uint256 day;
        uint256 debt;
        uint256 shortfall;
        uint256 heldIncome;
        uint256 streamIncome;
        uint256 tax;
    }

    /**
     * @notice Claims all accrued income
     *
     * Emits a {Claim} event
     */
    function claimAll() external;

    /**
     * @notice Claims a portion of accrued income
     *
     * @param amount The portion of income to claim
     *
     * Emits a {Claim} event
     */
    function claimAmount(uint256 amount) external;

    /**
     * @notice Returns the result of claiming all accrued income
     *
     * @param account The address of the account to preview the claim
     */
    function claimAllPreview(address account) external view returns (ClaimResult memory);

    /**
     * @notice Returns the result of claiming a portion of accrued income
     *
     * @param account The address of the account to preview the claim
     * @param amount The portion of income to claim
     */
    function claimAmountPreview(address account, uint256 amount) external view returns (ClaimResult memory);
}
