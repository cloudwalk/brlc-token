// SPDX-License-Identifier: MIT

pragma solidity >=0.6.0 <0.8.0;

import {IERC20Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import {SafeERC20Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/SafeERC20Upgradeable.sol";
import {SafeMathUpgradeable} from "@openzeppelin/contracts-upgradeable/math/SafeMathUpgradeable.sol";
import {MathUpgradeable} from "@openzeppelin/contracts-upgradeable/math/MathUpgradeable.sol";
import {WhitelistableUpgradeable} from "../base/WhitelistableUpgradeable.sol";
import {FaucetCallerUpgradeable} from "../base/FaucetCallerUpgradeable.sol";
import {PausableExUpgradeable} from "../base/PausableExUpgradeable.sol";
import {RescuableUpgradeable} from "../base/RescuableUpgradeable.sol";
import {RandomableUpgradeable} from "../base/RandomableUpgradeable.sol";
import {ISpinMachine} from "../base/interfaces/ISpinMachine.sol";

/**
 * @title SpinMachineUpgradeable contract
 * @notice Allows accounts to execute spins and win underlying tokens
 */
abstract contract SpinMachineUpgradeable is
    RescuableUpgradeable,
    PausableExUpgradeable,
    WhitelistableUpgradeable,
    FaucetCallerUpgradeable,
    RandomableUpgradeable,
    ISpinMachine
{
    using SafeERC20Upgradeable for IERC20Upgradeable;
    using SafeMathUpgradeable for uint256;

    address public token;
    mapping(address => uint256) public lastFreeSpin;
    mapping(address => uint256) public extraSpins;
    uint256 public extraSpinPrice;
    uint256 public freeSpinDelay;
    uint256[] private _prizes;

    event PrizesDistributionChanged(uint256[] prizes);
    event FreeSpinDelayChanged(uint256 newDelay, uint256 oldDelay);
    event ExtraSpinPriceChanged(uint256 newPrice, uint256 oldPrice);
    event ExtraSpinPurchased(
        address indexed sender,
        address indexed spinOwner,
        uint256 count
    );
    event ExtraSpinGranted(
        address indexed sender,
        address indexed spinOwner,
        uint256 count
    );
    event Spin(
        address indexed sender,
        uint256 winnings,
        uint256 sent,
        bool extra
    );

    function __SpinMachine_init(address token_) internal initializer {
        __Context_init_unchained();
        __Ownable_init_unchained();
        __Rescuable_init_unchained();
        __Pausable_init_unchained();
        __PausableEx_init_unchained();
        __Whitelistable_init_unchained();
        __FaucetCaller_init_unchained();
        __Randomable_init_unchained();
        __SpinMachine_init_unchained(token_);
    }

    function __SpinMachine_init_unchained(address token_) internal initializer {
        token = token_;
        freeSpinDelay = 1 days;
        _prizes.push(0);
    }

    /**
     * @notice Updates time delay before the next free spin
     * Can only be called by the contract owner
     * Emits an {FreeSpinDelayChanged} event
     */
    function setFreeSpinDelay(uint256 newDelay) public onlyOwner {
        emit FreeSpinDelayChanged(newDelay, freeSpinDelay);
        freeSpinDelay = newDelay;
    }

    /**
     * @notice Updates price of a single extra spin
     * Can only be called by the contract owner
     * Emits an {ExtraSpinPriceChanged} event
     */
    function setExtraSpinPrice(uint256 newPrice) public onlyOwner {
        emit ExtraSpinPriceChanged(newPrice, extraSpinPrice);
        extraSpinPrice = newPrice;
    }

    /**
     * @notice Allows to purchase extra spins
     * Can only be called when contract is not paused
     * Emits an {ExtraSpinPurchased} event
     * Requirements:
     * - `spinOwner` cannot be the zero address
     * - `count` must be greater than 0
     * - ERC20 allowance required
     * @param spinOwner The address of extra spins owner
     * @param count The number of purchased extra spins
     */
    function buyExtraSpin(address spinOwner, uint256 count)
        public
        whenNotPaused
    {
        require(
            spinOwner != address(0),
            "SpinMachine: spinOwner is the zero address"
        );
        require(count > 0, "SpinMachine: spins count must be greater than 0");
        IERC20Upgradeable(token).safeTransferFrom(
            _msgSender(),
            address(this),
            extraSpinPrice.mul(count)
        );
        extraSpins[spinOwner] = extraSpins[spinOwner].add(count);
        emit ExtraSpinPurchased(_msgSender(), spinOwner, count);
    }

    /**
     * @notice Allows to grant extra spins
     * Can only be called by the contract owner
     * Emits an {ExtraSpinGranted} event
     * Requirements:
     * - `spinOwner` cannot be the zero address
     * - `count` must be greater than 0
     * @param spinOwner The address of extra spins owner
     * @param count The number of granted extra spins
     */
    function grantExtraSpin(address spinOwner, uint256 count) public onlyOwner {
        require(
            spinOwner != address(0),
            "SpinMachine: spinOwner is the zero address"
        );
        require(count > 0, "SpinMachine: spins count must be greater than 0");
        extraSpins[spinOwner] = extraSpins[spinOwner].add(count);
        emit ExtraSpinGranted(_msgSender(), spinOwner, count);
    }

    /**
     * @notice Executes spin. Makes faucet request internally
     * Can only be called when contract is not paused
     * Can only be called if caller is whitelisted
     * Emits an {Spin} event
     */
    function spin()
        external
        override
        whenNotPaused
        onlyWhitelisted(_msgSender())
        returns (bool success, uint256 winnings)
    {
        if (getBalance() > 0) {
            (success, winnings) = _freeSpin(_msgSender());
            if (!success) (success, winnings) = _extraSpin(_msgSender());
        }
        _faucetRequest(_msgSender());
    }

    /**
     * @notice Updates prizes distribution array
     * Can only be called by the contract owner
     * Emits an {PrizesDistributionChanged} event
     * Requirements:
     * - `prizes` array cannot be empty
     * @param prizes New prizes distribution array
     */
    function setPrizes(uint256[] memory prizes) public onlyOwner {
        require(
            prizes.length != 0,
            "SpinMachineV1: prizes array cannot be empty"
        );
        _prizes = prizes;
        emit PrizesDistributionChanged(prizes);
    }

    /**
     * @notice Returns prizes distribution array
     */
    function getPrizes() public view returns (uint256[] memory) {
        return _prizes;
    }

    /**
     * @notice Returns balance of underlying token
     */
    function getBalance() public view returns (uint256) {
        return IERC20Upgradeable(token).balanceOf(address(this));
    }

    /**
     * @notice Checks if an account is allowed to execute a spin regardless of the paused state of the contract
     * @param account The address to check
     * @return True if allowed
     */
    function canSpin(address account) external view override returns (bool) {
        return
            (!isWhitelistEnabled() || isWhitelisted(account)) &&
            (_hasFreeSpin(account) || _hasExtraSpin(account));
    }

    /**
     * @notice Checks if an account is allowed to execute a free spin regardless of the paused state of the contract
     * @param account The address to check
     * @return True if allowed
     */
    function canFreeSpin(address account)
        external
        view
        override
        returns (bool)
    {
        return
            (!isWhitelistEnabled() || isWhitelisted(account)) &&
            _hasFreeSpin(account);
    }

    function _extraSpin(address account)
        private
        returns (bool success, uint256 winnings)
    {
        if (_hasExtraSpin(account)) {
            extraSpins[account] = extraSpins[account].sub(1);
            success = true;
            winnings = _winnings();
            uint256 sent = _send(account, winnings);
            emit Spin(account, winnings, sent, true);
        }
    }

    function _freeSpin(address account)
        private
        returns (bool success, uint256 winnings)
    {
        if (_hasFreeSpin(account)) {
            lastFreeSpin[account] = block.timestamp;
            success = true;
            winnings = _winnings();
            uint256 sent = _send(account, winnings);
            emit Spin(account, winnings, sent, false);
        }
    }

    function _send(address to, uint256 winnings) private returns (uint256) {
        uint256 balance = IERC20Upgradeable(token).balanceOf(address(this));
        uint256 send = MathUpgradeable.min(winnings, balance);
        if (send > 0) {
            IERC20Upgradeable(token).safeTransfer(to, send);
        }
        return send;
    }

    function _hasExtraSpin(address account) private view returns (bool) {
        return extraSpins[account] > 0;
    }

    function _hasFreeSpin(address account) private view returns (bool) {
        return lastFreeSpin[account].add(freeSpinDelay) <= block.timestamp;
    }

    function _randomIndex() private view returns (uint256) {
        return _getRandomness() % _prizes.length;
    }

    function _winnings() private view returns (uint256) {
        return _prizes[_randomIndex()];
    }
}
