// SPDX-License-Identifier: MIT

pragma solidity ^0.8.20;

import { IERC20Hookable } from "./interfaces/IERC20Hookable.sol";
import { IERC20Hook } from "./interfaces/IERC20Hook.sol";
import { ERC20Base } from "./ERC20Base.sol";

/**
 * @title ERC20Hookable contract
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev The ERC20 token implementation that supports hooking operations.
 */
abstract contract ERC20Hookable is ERC20Base, IERC20Hookable {
    // ------------------ Storage variables ----------------------- //

    /// @dev The array of the attached hook contracts that are triggered before the token transfer.
    Hook[] private _beforeTokenTransferHooks;

    /// @dev The array of the attached hook contracts that are triggered after the token transfer.
    Hook[] private _afterTokenTransferHooks;

    // ------------------ Events ---------------------------------- //

    /**
     * @dev Emitted when the `beforeTokenTransfer` hooks are updated.
     * @param hooks The array of the updated hooks.
     */
    event BeforeTokenTransferHooksSet(Hook[] hooks);

    /**
     * @dev Emitted when the `afterTokenTransfer` hooks are updated.
     * @param hooks The array of the updated hooks.
     */
    event AfterTokenTransferHooksSet(Hook[] hooks);

    /**
     * @dev Emitted when a call of the `beforeTokenTransfer` hook failed.
     * @param hook The address of the hook contract that was called.
     * @param reason The reason message of the hook failure.
     * @param code The error code of the hook failure.
     * @param data The low level error data.
     */
    event BeforeTokenTransferHookFailure(address indexed hook, string reason, uint256 code, bytes data);

    /**
     * @dev Emitted when a call of the `afterTokenTransfer` hook failed.
     * @param hook The address of the hook contract that was called.
     * @param reason The reason message of the hook failure.
     * @param code The error code of the hook failure.
     * @param data The low level error data.
     */
    event AfterTokenTransferHookFailure(address indexed hook, string reason, uint256 code, bytes data);

    // -------------------- Initializers -------------------------- //

    /**
     * @dev The unchained internal initializer of the upgradeable contract.
     *
     * See details: https://docs.openzeppelin.com/contracts/5.x/upgradeable#multiple-inheritance
     *
     * Note: The `..._init()` initializer has not been provided as redundant.
     */
    function __ERC20Hookable_init_unchained() internal onlyInitializing {}

    // ------------------ Transactional functions ----------------- //

    /**
     * @inheritdoc IERC20Hookable
     */
    function setBeforeTokenTransferHooks(Hook[] calldata hooks) external onlyRole(OWNER_ROLE) {
        delete _beforeTokenTransferHooks;
        for (uint i = 0; i < hooks.length; ++i) {
            _beforeTokenTransferHooks.push(hooks[i]);
        }
        emit BeforeTokenTransferHooksSet(hooks);
    }

    /**
     * @inheritdoc IERC20Hookable
     */
    function setAfterTokenTransferHooks(Hook[] calldata hooks) external onlyRole(OWNER_ROLE) {
        delete _afterTokenTransferHooks;
        for (uint i = 0; i < hooks.length; ++i) {
            _afterTokenTransferHooks.push(hooks[i]);
        }
        emit AfterTokenTransferHooksSet(hooks);
    }

    // ------------------ View functions -------------------------- //

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

    // ------------------ Internal functions ---------------------- //

    /**
     * @dev Overrides the `_beforeTokenTransfer` function by calling attached hooks after the base logic.
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
     * @dev Overrides the `_afterTokenTransfer` function by calling attached hooks after the base logic.
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
