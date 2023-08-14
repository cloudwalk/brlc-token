// SPDX-License-Identifier: MIT

pragma solidity 0.8.16;

import { IERC20Hookable } from "./interfaces/IERC20Hookable.sol";
import { IERC20Hook } from "./interfaces/IERC20Hook.sol";
import { ERC20Base } from "./ERC20Base.sol";

/**
 * @title ERC20Hookable contract
 * @author CloudWalk Inc.
 * @notice The ERC20 token implementation that supports hooking operations
 */
abstract contract ERC20Hookable is ERC20Base, IERC20Hookable {
    /// @notice The array of the attached hook contracts that are triggered before the token transfer
    Hook[] private _beforeTokenTransferHooks;

    /// @notice The array of the attached hook contracts that are triggered after the token transfer
    Hook[] private _afterTokenTransferHooks;

    /**
     * @notice Emitted when the `beforeTokenTransfer` hooks are updated
     *
     * @param hooks The array of the updated hooks
     */
    event BeforeTokenTransferHooksSet(Hook[] hooks);

    /**
     * @notice Emitted when the `afterTokenTransfer` hooks are updated
     *
     * @param hooks The array of the updated hooks
     */
    event AfterTokenTransferHooksSet(Hook[] hooks);

    /**
     * @notice Emitted when a call of the `beforeTokenTransfer` hook failed
     *
     * @param hook The address of the hook contract that was called
     * @param reason The reason message of the hook failure
     * @param code The error code of the hook failure
     * @param data The low level error data
     */
    event BeforeTokenTransferHookFailure(address indexed hook, string reason, uint256 code, bytes data);

    /**
     * @notice Emitted when a call of the `afterTokenTransfer` hook failed
     *
     * @param hook The address of the hook contract that was called
     * @param reason The reason message of the hook failure
     * @param code The error code of the hook failure
     * @param data The low level error data
     */
    event AfterTokenTransferHookFailure(address indexed hook, string reason, uint256 code, bytes data);

    // -------------------- Functions --------------------------------

    /**
     * @notice The internal initializer of the upgradable contract
     */
    function __ERC20Hookable_init(string memory name_, string memory symbol_) internal onlyInitializing {
        __Context_init_unchained();
        __Ownable_init_unchained();
        __Pausable_init_unchained();
        __PausableExt_init_unchained();
        __Blacklistable_init_unchained();
        __ERC20_init_unchained(name_, symbol_);
        __ERC20Base_init_unchained();
        __ERC20Hookable_init_unchained();
    }

    /**
     * @notice The internal unchained initializer of the upgradable contract
     */
    function __ERC20Hookable_init_unchained() internal onlyInitializing {}

    /**
     * @inheritdoc IERC20Hookable
     */
    function setBeforeTokenTransferHooks(Hook[] calldata hooks) external onlyOwner {
        delete _beforeTokenTransferHooks;
        for (uint i = 0; i < hooks.length; ++i) {
            _beforeTokenTransferHooks.push(hooks[i]);
        }
        emit BeforeTokenTransferHooksSet(hooks);
    }

    /**
     * @inheritdoc IERC20Hookable
     */
    function setAfterTokenTransferHooks(Hook[] calldata hooks) external onlyOwner {
        delete _afterTokenTransferHooks;
        for (uint i = 0; i < hooks.length; ++i) {
            _afterTokenTransferHooks.push(hooks[i]);
        }
        emit AfterTokenTransferHooksSet(hooks);
    }

    /**
     * @inheritdoc IERC20Hookable
     */
    function getBeforeTokenTransferHooks() external view returns (Hook[] memory) {
        return _beforeTokenTransferHooks;
    }

    /**
     * @inheritdoc IERC20Hookable
     */
    function getAfterTokenTransferHooks() external view returns (Hook[] memory) {
        return _afterTokenTransferHooks;
    }

    /**
     * @dev Overrides the `_beforeTokenTransfer` function by calling attached hooks after the base logic
     */
    function _beforeTokenTransfer(address from, address to, uint256 amount) internal virtual override(ERC20Base) {
        super._beforeTokenTransfer(from, to, amount);
        for (uint256 i = 0; i < _beforeTokenTransferHooks.length; ++i) {
            if (_beforeTokenTransferHooks[i].policy == ErrorHandlingPolicy.Revert) {
                IERC20Hook(_beforeTokenTransferHooks[i].account).beforeTokenTransfer(from, to, amount);
            } else {
                // ErrorHandlingPolicy.Event
                try IERC20Hook(_beforeTokenTransferHooks[i].account).beforeTokenTransfer(from, to, amount) {
                    // Do nothing
                } catch Error(string memory reason) {
                    emit BeforeTokenTransferHookFailure(_beforeTokenTransferHooks[i].account, reason, 0, "");
                } catch Panic(uint errorCode) {
                    emit BeforeTokenTransferHookFailure(_beforeTokenTransferHooks[i].account, "", errorCode, "");
                } catch (bytes memory lowLevelData) {
                    emit BeforeTokenTransferHookFailure(_beforeTokenTransferHooks[i].account, "", 0, lowLevelData);
                }
            }
        }
    }

    /**
     * @dev Overrides the `_afterTokenTransfer` function by calling attached hooks after the base logic
     */
    function _afterTokenTransfer(address from, address to, uint256 amount) internal virtual override {
        super._afterTokenTransfer(from, to, amount);
        for (uint256 i = 0; i < _afterTokenTransferHooks.length; ++i) {
            if (_afterTokenTransferHooks[i].policy == ErrorHandlingPolicy.Revert) {
                IERC20Hook(_afterTokenTransferHooks[i].account).afterTokenTransfer(from, to, amount);
            } else {
                // ErrorHandlingPolicy.Event
                try IERC20Hook(_afterTokenTransferHooks[i].account).afterTokenTransfer(from, to, amount) {
                    // Do nothing
                } catch Error(string memory reason) {
                    emit AfterTokenTransferHookFailure(_afterTokenTransferHooks[i].account, reason, 0, "");
                } catch Panic(uint errorCode) {
                    emit AfterTokenTransferHookFailure(_afterTokenTransferHooks[i].account, "", errorCode, "");
                } catch (bytes memory lowLevelData) {
                    emit AfterTokenTransferHookFailure(_afterTokenTransferHooks[i].account, "", 0, lowLevelData);
                }
            }
        }
    }
}
