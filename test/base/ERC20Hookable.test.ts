import { ethers, network, upgrades } from "hardhat";
import { expect } from "chai";
import { Contract, ContractFactory } from "ethers";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { proveTx, connect } from "../../test-utils/eth";

enum ErrorHandlingPolicy {
  Revert = 0,
  Event = 1
}

interface HookConfig {
  account: string;
  policy: ErrorHandlingPolicy;
}

async function setUpFixture<T>(func: () => Promise<T>): Promise<T> {
  if (network.name === "hardhat") {
    return loadFixture(func);
  } else {
    return func();
  }
}

function checkHookConfigEquality(actualHookConfig: Record<string, unknown>, expectedHookConfig: HookConfig) {
  expect(actualHookConfig.account).to.eq(expectedHookConfig.account);
  expect(actualHookConfig.policy).to.eq(expectedHookConfig.policy);
}

function checkHookConfigsEquality(actualHookConfigs: Record<string, unknown>[], expectedHookConfigs: HookConfig[]) {
  expect(actualHookConfigs.length).to.eq(expectedHookConfigs.length);
  for (let i = 0; i < actualHookConfigs.length; i++) {
    checkHookConfigEquality(actualHookConfigs[i], expectedHookConfigs[i]);
  }
}

describe("Contract 'ERC20Hookable'", async () => {
  const TOKEN_NAME = "BRL Coin";
  const TOKEN_SYMBOL = "BRLC";

  const PANIC_ERROR_CODE = "0x1";
  const REVERT_LOW_LEVEL_DATA_BEFORE = "0x6621cfad";
  const REVERT_LOW_LEVEL_DATA_AFTER = "0xea12450f";
  const REVERT_REASON_MESSAGE = "error message";

  const ZERO_PANIC_ERROR_CODE = "0x0";
  const ZERO_REVERT_LOW_LEVEL_DATA = "0x";
  const ZERO_REVERT_REASON_MESSAGE = "";

  const EVENT_NAME_BEFORE_TOKEN_TRANSFER_HOOKS_UPDATED = "BeforeTokenTransferHooksSet";
  const EVENT_NAME_BEFORE_TOKEN_TRANSFER_HOOK_FAILURE = "BeforeTokenTransferHookFailure";
  const EVENT_NAME_TEST_BEFORE_TOKEN_TRANSFER_HOOK = "TestBeforeTokenTransferHookEvent";
  const EVENT_NAME_AFTER_TOKEN_TRANSFER_HOOKS_UPDATED = "AfterTokenTransferHooksSet";
  const EVENT_NAME_AFTER_TOKEN_TRANSFER_HOOK_FAILURE = "AfterTokenTransferHookFailure";
  const EVENT_NAME_TEST_AFTER_TOKEN_TRANSFER_HOOK = "TestAfterTokenTransferHookEvent";

  const REVERT_ERROR_TEST_BEFORE_TOKEN_TRANSFER_HOOK = "TestBeforeTokenTransferHookError";
  const REVERT_ERROR_TEST_AFTER_TOKEN_TRANSFER_HOOK = "TestAfterTokenTransferHookError";

  const REVERT_MESSAGE_INITIALIZABLE_CONTRACT_IS_ALREADY_INITIALIZED = "Initializable: contract is already initialized";
  const REVERT_MESSAGE_INITIALIZABLE_CONTRACT_IS_NOT_INITIALIZING = "Initializable: contract is not initializing";
  const REVERT_MESSAGE_OWNABLE_CALLER_IS_NOT_THE_OWNER = "Ownable: caller is not the owner";

  let tokenFactory: ContractFactory;
  let hookFactory: ContractFactory;
  let deployer: HardhatEthersSigner;
  let pauser: HardhatEthersSigner;
  let user: HardhatEthersSigner;

  before(async () => {
    [deployer, pauser, user] = await ethers.getSigners();
    tokenFactory = await ethers.getContractFactory("ERC20HookableMock");
    hookFactory = await ethers.getContractFactory("ERC20HookMock");
    tokenFactory = tokenFactory.connect(deployer); // Explicitly specifying the deployer account
    hookFactory = hookFactory.connect(deployer); // Explicitly specifying the deployer account
  });

  async function deployToken(): Promise<{ token: Contract }> {
    let token: Contract = await upgrades.deployProxy(tokenFactory, [TOKEN_NAME, TOKEN_SYMBOL]);
    await token.waitForDeployment();
    token = connect(token, deployer); // Explicitly specifying the initial account
    return { token };
  }

  async function deployTokenAndHooks(): Promise<{
    token: Contract;
    hook1: Contract;
    hook2: Contract;
  }> {
    const { token } = await deployToken();
    let hook1: Contract = await hookFactory.deploy() as Contract;
    let hook2: Contract = await hookFactory.deploy() as Contract;
    await proveTx(token.setPauser(pauser.address));

    hook1 = connect(hook1, deployer); // Explicitly specifying the initial account
    hook2 = connect(hook2, deployer); // Explicitly specifying the initial account

    return { token, hook1, hook2 };
  }

  describe("Function 'initialize()'", async () => {
    it("Configures the contract as expected", async () => {
      const { token } = await setUpFixture(deployToken);
      expect(await token.owner()).to.equal(deployer.address);
      expect(await token.pauser()).to.equal(ethers.ZeroAddress);
      expect(await token.mainBlocklister()).to.equal(ethers.ZeroAddress);
    });

    it("Is reverted if called for the second time", async () => {
      const { token } = await setUpFixture(deployToken);
      await expect(
        token.initialize(TOKEN_NAME, TOKEN_SYMBOL)
      ).to.be.revertedWith(REVERT_MESSAGE_INITIALIZABLE_CONTRACT_IS_ALREADY_INITIALIZED);
    });

    it("Is reverted if the contract implementation is called even for the first time", async () => {
      const tokenImplementation: Contract = await tokenFactory.deploy() as Contract;
      await tokenImplementation.waitForDeployment();
      await expect(
        tokenImplementation.initialize(TOKEN_NAME, TOKEN_SYMBOL)
      ).to.be.revertedWith(REVERT_MESSAGE_INITIALIZABLE_CONTRACT_IS_ALREADY_INITIALIZED);
    });

    it("Is reverted if the internal initializer is called outside of the init process", async () => {
      const { token } = await setUpFixture(deployToken);
      await expect(
        token.call_parent_initialize(TOKEN_NAME, TOKEN_SYMBOL)
      ).to.be.revertedWith(REVERT_MESSAGE_INITIALIZABLE_CONTRACT_IS_NOT_INITIALIZING);
    });

    it("Is reverted if the internal unchained initializer is called outside of the init process", async () => {
      const { token } = await setUpFixture(deployToken);
      await expect(
        token.call_parent_initialize_unchained()
      ).to.be.revertedWith(REVERT_MESSAGE_INITIALIZABLE_CONTRACT_IS_NOT_INITIALIZING);
    });
  });

  describe("Function 'setBeforeTokenTransferHooks()'", async () => {
    it("Executes as expected and emits the correct event", async () => {
      const { token, hook1, hook2 } = await setUpFixture(deployTokenAndHooks);
      const hooks: HookConfig[] = [
        {
          account: await hook1.getAddress(),
          policy: ErrorHandlingPolicy.Event
        },
        {
          account: await hook2.getAddress(),
          policy: ErrorHandlingPolicy.Revert
        }
      ];
      expect(await token.getBeforeTokenTransferHooks()).to.deep.equal([]);
      await expect(
        token.setBeforeTokenTransferHooks(hooks)
      ).to.emit(token, EVENT_NAME_BEFORE_TOKEN_TRANSFER_HOOKS_UPDATED);
      checkHookConfigsEquality(await token.getBeforeTokenTransferHooks(), hooks);
    });

    it("Is reverted if called not by the owner", async () => {
      const { token, hook1, hook2 } = await setUpFixture(deployTokenAndHooks);
      const hooks: HookConfig[] = [
        {
          account: await hook1.getAddress(),
          policy: ErrorHandlingPolicy.Event
        },
        {
          account: await hook2.getAddress(),
          policy: ErrorHandlingPolicy.Revert
        }
      ];
      await expect(
        connect(token, user).setBeforeTokenTransferHooks(hooks)
      ).to.be.revertedWith(REVERT_MESSAGE_OWNABLE_CALLER_IS_NOT_THE_OWNER);
    });
  });

  describe("Function 'setAfterTokenTransferHooks()'", async () => {
    it("Executes as expected and emits the correct event", async () => {
      const { token, hook1, hook2 } = await setUpFixture(deployTokenAndHooks);
      const hooks: HookConfig[] = [
        {
          account: await hook1.getAddress(),
          policy: ErrorHandlingPolicy.Event
        },
        {
          account: await hook2.getAddress(),
          policy: ErrorHandlingPolicy.Revert
        }
      ];
      expect(await token.getAfterTokenTransferHooks()).to.deep.equal([]);
      await expect(
        token.setAfterTokenTransferHooks(hooks)
      ).to.emit(token, EVENT_NAME_AFTER_TOKEN_TRANSFER_HOOKS_UPDATED);
      checkHookConfigsEquality(await token.getAfterTokenTransferHooks(), hooks);
    });

    it("Is reverted if called not by the owner", async () => {
      const { token, hook1, hook2 } = await setUpFixture(deployTokenAndHooks);
      const hooks: HookConfig[] = [
        {
          account: await hook1.getAddress(),
          policy: ErrorHandlingPolicy.Event
        },
        {
          account: await hook2.getAddress(),
          policy: ErrorHandlingPolicy.Revert
        }
      ];
      await expect(
        connect(token, user).setAfterTokenTransferHooks(hooks)
      ).to.be.revertedWith(REVERT_MESSAGE_OWNABLE_CALLER_IS_NOT_THE_OWNER);
    });
  });

  describe("Function 'beforeTokenTransfer()'", async () => {
    it("Reverted with panic error", async () => {
      const { token, hook1, hook2 } = await setUpFixture(deployTokenAndHooks);
      const hooks: HookConfig[] = [
        {
          account: await hook1.getAddress(),
          policy: ErrorHandlingPolicy.Event
        },
        {
          account: await hook2.getAddress(),
          policy: ErrorHandlingPolicy.Revert
        }
      ];
      await proveTx(token.setBeforeTokenTransferHooks(hooks));
      await expect(connect(token, user).transfer(user.address, 0))
        .to.emit(hook1, EVENT_NAME_TEST_BEFORE_TOKEN_TRANSFER_HOOK)
        .to.emit(hook2, EVENT_NAME_TEST_BEFORE_TOKEN_TRANSFER_HOOK)
        .not.to.emit(token, EVENT_NAME_BEFORE_TOKEN_TRANSFER_HOOK_FAILURE);
      await proveTx(hook2.setRevertWithPanic(true));
      await expect(connect(token, user).transfer(user.address, 0)).to.be.revertedWithPanic(1);
    });

    it("Reverted with reason message", async () => {
      const { token, hook1, hook2 } = await setUpFixture(deployTokenAndHooks);
      const hooks: HookConfig[] = [
        {
          account: await hook1.getAddress(),
          policy: ErrorHandlingPolicy.Event
        },
        {
          account: await hook2.getAddress(),
          policy: ErrorHandlingPolicy.Revert
        }
      ];
      await proveTx(token.setBeforeTokenTransferHooks(hooks));
      await expect(connect(token, user).transfer(user.address, 0))
        .to.emit(hook1, EVENT_NAME_TEST_BEFORE_TOKEN_TRANSFER_HOOK)
        .to.emit(hook2, EVENT_NAME_TEST_BEFORE_TOKEN_TRANSFER_HOOK)
        .not.to.emit(token, EVENT_NAME_BEFORE_TOKEN_TRANSFER_HOOK_FAILURE);
      await proveTx(hook2.setRevertWithReasonMessage(true));
      await expect(connect(token, user).transfer(user.address, 0)).to.be.revertedWith("error message");
    });

    it("Reverted without reason message", async () => {
      const { token, hook1, hook2 } = await setUpFixture(deployTokenAndHooks);
      const hooks: HookConfig[] = [
        {
          account: await hook1.getAddress(),
          policy: ErrorHandlingPolicy.Event
        },
        {
          account: await hook2.getAddress(),
          policy: ErrorHandlingPolicy.Revert
        }
      ];
      await proveTx(token.setBeforeTokenTransferHooks(hooks));
      await expect(connect(token, user).transfer(user.address, 0))
        .to.emit(hook1, EVENT_NAME_TEST_BEFORE_TOKEN_TRANSFER_HOOK)
        .to.emit(hook2, EVENT_NAME_TEST_BEFORE_TOKEN_TRANSFER_HOOK)
        .not.to.emit(token, EVENT_NAME_BEFORE_TOKEN_TRANSFER_HOOK_FAILURE);
      await proveTx(hook2.setRevertWithoutReasonMessage(true));
      await expect(
        connect(token, user).transfer(user.address, 0)
      ).to.be.revertedWithCustomError(hook2, REVERT_ERROR_TEST_BEFORE_TOKEN_TRANSFER_HOOK);
    });

    it("Emit if reverted with panic error", async () => {
      const { token, hook1, hook2 } = await setUpFixture(deployTokenAndHooks);
      const hooks: HookConfig[] = [
        {
          account: await hook1.getAddress(),
          policy: ErrorHandlingPolicy.Event
        },
        {
          account: await hook2.getAddress(),
          policy: ErrorHandlingPolicy.Event
        }
      ];
      await proveTx(token.setBeforeTokenTransferHooks(hooks));
      await expect(connect(token, user).transfer(user.address, 0))
        .to.emit(hook1, EVENT_NAME_TEST_BEFORE_TOKEN_TRANSFER_HOOK)
        .to.emit(hook2, EVENT_NAME_TEST_BEFORE_TOKEN_TRANSFER_HOOK)
        .not.to.emit(token, EVENT_NAME_BEFORE_TOKEN_TRANSFER_HOOK_FAILURE);
      await proveTx(hook1.setRevertWithPanic(true));
      await proveTx(hook2.setRevertWithPanic(true));
      await expect(connect(token, user).transfer(user.address, 0))
        .to.emit(token, EVENT_NAME_BEFORE_TOKEN_TRANSFER_HOOK_FAILURE)
        .withArgs(await hook1.getAddress(), ZERO_REVERT_REASON_MESSAGE, PANIC_ERROR_CODE, ZERO_REVERT_LOW_LEVEL_DATA)
        .to.emit(token, EVENT_NAME_BEFORE_TOKEN_TRANSFER_HOOK_FAILURE)
        .withArgs(await hook2.getAddress(), ZERO_REVERT_REASON_MESSAGE, PANIC_ERROR_CODE, ZERO_REVERT_LOW_LEVEL_DATA)
        .not.to.emit(hook1, EVENT_NAME_TEST_BEFORE_TOKEN_TRANSFER_HOOK)
        .not.to.emit(hook2, EVENT_NAME_TEST_BEFORE_TOKEN_TRANSFER_HOOK);
      await proveTx(hook1.setRevertWithPanic(true));
      await proveTx(hook2.setRevertWithPanic(false));
      await expect(connect(token, user).transfer(user.address, 0))
        .to.emit(token, EVENT_NAME_BEFORE_TOKEN_TRANSFER_HOOK_FAILURE)
        .withArgs(await hook1.getAddress(), ZERO_REVERT_REASON_MESSAGE, PANIC_ERROR_CODE, ZERO_REVERT_LOW_LEVEL_DATA)
        .to.emit(hook2, EVENT_NAME_TEST_BEFORE_TOKEN_TRANSFER_HOOK)
        .not.to.emit(hook1, EVENT_NAME_TEST_BEFORE_TOKEN_TRANSFER_HOOK);
      await proveTx(hook1.setRevertWithPanic(false));
      await proveTx(hook2.setRevertWithPanic(true));
      await expect(connect(token, user).transfer(user.address, 0))
        .to.emit(token, EVENT_NAME_BEFORE_TOKEN_TRANSFER_HOOK_FAILURE)
        .withArgs(await hook2.getAddress(), ZERO_REVERT_REASON_MESSAGE, PANIC_ERROR_CODE, ZERO_REVERT_LOW_LEVEL_DATA)
        .to.emit(hook1, EVENT_NAME_TEST_BEFORE_TOKEN_TRANSFER_HOOK)
        .not.to.emit(hook2, EVENT_NAME_TEST_BEFORE_TOKEN_TRANSFER_HOOK);
    });

    it("Emit if reverted with reason message", async () => {
      const { token, hook1, hook2 } = await setUpFixture(deployTokenAndHooks);
      const hooks: HookConfig[] = [
        {
          account: await hook1.getAddress(),
          policy: ErrorHandlingPolicy.Event
        },
        {
          account: await hook2.getAddress(),
          policy: ErrorHandlingPolicy.Event
        }
      ];
      await proveTx(token.setBeforeTokenTransferHooks(hooks));
      await expect(connect(token, user).transfer(user.address, 0))
        .to.emit(hook1, EVENT_NAME_TEST_BEFORE_TOKEN_TRANSFER_HOOK)
        .to.emit(hook2, EVENT_NAME_TEST_BEFORE_TOKEN_TRANSFER_HOOK)
        .not.to.emit(token, EVENT_NAME_BEFORE_TOKEN_TRANSFER_HOOK_FAILURE);
      await proveTx(hook1.setRevertWithReasonMessage(true));
      await proveTx(hook2.setRevertWithReasonMessage(true));
      await expect(connect(token, user).transfer(user.address, 0))
        .to.emit(token, EVENT_NAME_BEFORE_TOKEN_TRANSFER_HOOK_FAILURE)
        .withArgs(await hook1.getAddress(), REVERT_REASON_MESSAGE, ZERO_PANIC_ERROR_CODE, ZERO_REVERT_LOW_LEVEL_DATA)
        .to.emit(token, EVENT_NAME_BEFORE_TOKEN_TRANSFER_HOOK_FAILURE)
        .withArgs(await hook2.getAddress(), REVERT_REASON_MESSAGE, ZERO_PANIC_ERROR_CODE, ZERO_REVERT_LOW_LEVEL_DATA)
        .not.to.emit(hook1, EVENT_NAME_TEST_BEFORE_TOKEN_TRANSFER_HOOK)
        .not.to.emit(hook2, EVENT_NAME_TEST_BEFORE_TOKEN_TRANSFER_HOOK);
      await proveTx(hook1.setRevertWithReasonMessage(true));
      await proveTx(hook2.setRevertWithReasonMessage(false));
      await expect(connect(token, user).transfer(user.address, 0))
        .to.emit(token, EVENT_NAME_BEFORE_TOKEN_TRANSFER_HOOK_FAILURE)
        .withArgs(await hook1.getAddress(), REVERT_REASON_MESSAGE, ZERO_PANIC_ERROR_CODE, ZERO_REVERT_LOW_LEVEL_DATA)
        .to.emit(hook2, EVENT_NAME_TEST_BEFORE_TOKEN_TRANSFER_HOOK)
        .not.to.emit(hook1, EVENT_NAME_TEST_BEFORE_TOKEN_TRANSFER_HOOK);
      await proveTx(hook1.setRevertWithReasonMessage(false));
      await proveTx(hook2.setRevertWithReasonMessage(true));
      await expect(connect(token, user).transfer(user.address, 0))
        .to.emit(token, EVENT_NAME_BEFORE_TOKEN_TRANSFER_HOOK_FAILURE)
        .withArgs(await hook2.getAddress(), REVERT_REASON_MESSAGE, ZERO_PANIC_ERROR_CODE, ZERO_REVERT_LOW_LEVEL_DATA)
        .to.emit(hook1, EVENT_NAME_TEST_BEFORE_TOKEN_TRANSFER_HOOK)
        .not.to.emit(hook2, EVENT_NAME_TEST_BEFORE_TOKEN_TRANSFER_HOOK);
    });

    it("Emit if reverted without reason message", async () => {
      const { token, hook1, hook2 } = await setUpFixture(deployTokenAndHooks);
      const hooks: HookConfig[] = [
        {
          account: await hook1.getAddress(),
          policy: ErrorHandlingPolicy.Event
        },
        {
          account: await hook2.getAddress(),
          policy: ErrorHandlingPolicy.Event
        }
      ];
      await proveTx(token.setBeforeTokenTransferHooks(hooks));
      await expect(connect(token, user).transfer(user.address, 0))
        .to.emit(hook1, EVENT_NAME_TEST_BEFORE_TOKEN_TRANSFER_HOOK)
        .to.emit(hook2, EVENT_NAME_TEST_BEFORE_TOKEN_TRANSFER_HOOK)
        .not.to.emit(token, EVENT_NAME_BEFORE_TOKEN_TRANSFER_HOOK_FAILURE);
      await proveTx(hook1.setRevertWithoutReasonMessage(true));
      await proveTx(hook2.setRevertWithoutReasonMessage(true));
      await expect(connect(token, user).transfer(user.address, 0))
        .to.emit(token, EVENT_NAME_BEFORE_TOKEN_TRANSFER_HOOK_FAILURE)
        .withArgs(
          await hook1.getAddress(),
          ZERO_REVERT_REASON_MESSAGE,
          ZERO_PANIC_ERROR_CODE,
          REVERT_LOW_LEVEL_DATA_BEFORE
        )
        .to.emit(token, EVENT_NAME_BEFORE_TOKEN_TRANSFER_HOOK_FAILURE)
        .withArgs(
          await hook2.getAddress(),
          ZERO_REVERT_REASON_MESSAGE,
          ZERO_PANIC_ERROR_CODE,
          REVERT_LOW_LEVEL_DATA_BEFORE
        )
        .not.to.emit(hook1, EVENT_NAME_TEST_BEFORE_TOKEN_TRANSFER_HOOK)
        .not.to.emit(hook2, EVENT_NAME_TEST_BEFORE_TOKEN_TRANSFER_HOOK);
    });
  });

  describe("Function 'afterTokenTransfer()'", async () => {
    it("Reverted with panic error", async () => {
      const { token, hook1, hook2 } = await setUpFixture(deployTokenAndHooks);
      const hooks: HookConfig[] = [
        {
          account: await hook1.getAddress(),
          policy: ErrorHandlingPolicy.Event
        },
        {
          account: await hook2.getAddress(),
          policy: ErrorHandlingPolicy.Revert
        }
      ];
      await proveTx(token.setAfterTokenTransferHooks(hooks));
      await expect(connect(token, user).transfer(user.address, 0))
        .to.emit(hook1, EVENT_NAME_TEST_AFTER_TOKEN_TRANSFER_HOOK)
        .to.emit(hook2, EVENT_NAME_TEST_AFTER_TOKEN_TRANSFER_HOOK)
        .not.to.emit(token, EVENT_NAME_AFTER_TOKEN_TRANSFER_HOOK_FAILURE);
      await proveTx(hook2.setRevertWithPanic(true));
      await expect(connect(token, user).transfer(user.address, 0)).to.be.revertedWithPanic(1);
    });

    it("Reverted with reason message", async () => {
      const { token, hook1, hook2 } = await setUpFixture(deployTokenAndHooks);
      const hooks: HookConfig[] = [
        {
          account: await hook1.getAddress(),
          policy: ErrorHandlingPolicy.Event
        },
        {
          account: await hook2.getAddress(),
          policy: ErrorHandlingPolicy.Revert
        }
      ];
      await proveTx(token.setAfterTokenTransferHooks(hooks));
      await expect(connect(token, user).transfer(user.address, 0))
        .to.emit(hook1, EVENT_NAME_TEST_AFTER_TOKEN_TRANSFER_HOOK)
        .to.emit(hook2, EVENT_NAME_TEST_AFTER_TOKEN_TRANSFER_HOOK)
        .not.to.emit(token, EVENT_NAME_AFTER_TOKEN_TRANSFER_HOOK_FAILURE);
      await proveTx(hook2.setRevertWithReasonMessage(true));
      await expect(connect(token, user).transfer(user.address, 0)).to.be.revertedWith("error message");
    });

    it("Reverted without reason message", async () => {
      const { token, hook1, hook2 } = await setUpFixture(deployTokenAndHooks);
      const hooks: HookConfig[] = [
        {
          account: await hook1.getAddress(),
          policy: ErrorHandlingPolicy.Event
        },
        {
          account: await hook2.getAddress(),
          policy: ErrorHandlingPolicy.Revert
        }
      ];
      await proveTx(token.setAfterTokenTransferHooks(hooks));
      await expect(connect(token, user).transfer(user.address, 0))
        .to.emit(hook1, EVENT_NAME_TEST_AFTER_TOKEN_TRANSFER_HOOK)
        .to.emit(hook2, EVENT_NAME_TEST_AFTER_TOKEN_TRANSFER_HOOK)
        .not.to.emit(token, EVENT_NAME_AFTER_TOKEN_TRANSFER_HOOK_FAILURE);
      await proveTx(hook2.setRevertWithoutReasonMessage(true));
      await expect(connect(token, user).transfer(user.address, 0)).to.be.revertedWithCustomError(
        hook2,
        REVERT_ERROR_TEST_AFTER_TOKEN_TRANSFER_HOOK
      );
    });

    it("Emit if reverted with panic error", async () => {
      const { token, hook1, hook2 } = await setUpFixture(deployTokenAndHooks);
      const hooks: HookConfig[] = [
        {
          account: await hook1.getAddress(),
          policy: ErrorHandlingPolicy.Event
        },
        {
          account: await hook2.getAddress(),
          policy: ErrorHandlingPolicy.Event
        }
      ];
      await proveTx(token.setAfterTokenTransferHooks(hooks));
      await expect(connect(token, user).transfer(user.address, 0))
        .to.emit(hook1, EVENT_NAME_TEST_AFTER_TOKEN_TRANSFER_HOOK)
        .to.emit(hook2, EVENT_NAME_TEST_AFTER_TOKEN_TRANSFER_HOOK)
        .not.to.emit(token, EVENT_NAME_AFTER_TOKEN_TRANSFER_HOOK_FAILURE);
      await proveTx(hook1.setRevertWithPanic(true));
      await proveTx(hook2.setRevertWithPanic(true));
      await expect(connect(token, user).transfer(user.address, 0))
        .to.emit(token, EVENT_NAME_AFTER_TOKEN_TRANSFER_HOOK_FAILURE)
        .withArgs(await hook1.getAddress(), ZERO_REVERT_REASON_MESSAGE, PANIC_ERROR_CODE, ZERO_REVERT_LOW_LEVEL_DATA)
        .to.emit(token, EVENT_NAME_AFTER_TOKEN_TRANSFER_HOOK_FAILURE)
        .withArgs(await hook2.getAddress(), ZERO_REVERT_REASON_MESSAGE, PANIC_ERROR_CODE, ZERO_REVERT_LOW_LEVEL_DATA)
        .not.to.emit(hook1, EVENT_NAME_TEST_AFTER_TOKEN_TRANSFER_HOOK)
        .not.to.emit(hook2, EVENT_NAME_TEST_AFTER_TOKEN_TRANSFER_HOOK);
      await proveTx(hook1.setRevertWithPanic(true));
      await proveTx(hook2.setRevertWithPanic(false));
      await expect(connect(token, user).transfer(user.address, 0))
        .to.emit(token, EVENT_NAME_AFTER_TOKEN_TRANSFER_HOOK_FAILURE)
        .withArgs(await hook1.getAddress(), ZERO_REVERT_REASON_MESSAGE, PANIC_ERROR_CODE, ZERO_REVERT_LOW_LEVEL_DATA)
        .to.emit(hook2, EVENT_NAME_TEST_AFTER_TOKEN_TRANSFER_HOOK)
        .not.to.emit(hook1, EVENT_NAME_TEST_AFTER_TOKEN_TRANSFER_HOOK);
      await proveTx(hook1.setRevertWithPanic(false));
      await proveTx(hook2.setRevertWithPanic(true));
      await expect(connect(token, user).transfer(user.address, 0))
        .to.emit(token, EVENT_NAME_AFTER_TOKEN_TRANSFER_HOOK_FAILURE)
        .withArgs(await hook2.getAddress(), ZERO_REVERT_REASON_MESSAGE, PANIC_ERROR_CODE, ZERO_REVERT_LOW_LEVEL_DATA)
        .to.emit(hook1, EVENT_NAME_TEST_AFTER_TOKEN_TRANSFER_HOOK)
        .not.to.emit(hook2, EVENT_NAME_TEST_AFTER_TOKEN_TRANSFER_HOOK);
    });

    it("Emit if reverted with reason message", async () => {
      const { token, hook1, hook2 } = await setUpFixture(deployTokenAndHooks);
      const hooks: HookConfig[] = [
        {
          account: await hook1.getAddress(),
          policy: ErrorHandlingPolicy.Event
        },
        {
          account: await hook2.getAddress(),
          policy: ErrorHandlingPolicy.Event
        }
      ];
      await proveTx(token.setAfterTokenTransferHooks(hooks));
      await expect(connect(token, user).transfer(user.address, 0))
        .to.emit(hook1, EVENT_NAME_TEST_AFTER_TOKEN_TRANSFER_HOOK)
        .to.emit(hook2, EVENT_NAME_TEST_AFTER_TOKEN_TRANSFER_HOOK)
        .not.to.emit(token, EVENT_NAME_AFTER_TOKEN_TRANSFER_HOOK_FAILURE);
      await proveTx(hook1.setRevertWithReasonMessage(true));
      await proveTx(hook2.setRevertWithReasonMessage(true));
      await expect(connect(token, user).transfer(user.address, 0))
        .to.emit(token, EVENT_NAME_AFTER_TOKEN_TRANSFER_HOOK_FAILURE)
        .withArgs(await hook1.getAddress(), REVERT_REASON_MESSAGE, ZERO_PANIC_ERROR_CODE, ZERO_REVERT_LOW_LEVEL_DATA)
        .to.emit(token, EVENT_NAME_AFTER_TOKEN_TRANSFER_HOOK_FAILURE)
        .withArgs(await hook2.getAddress(), REVERT_REASON_MESSAGE, ZERO_PANIC_ERROR_CODE, ZERO_REVERT_LOW_LEVEL_DATA)
        .not.to.emit(hook1, EVENT_NAME_TEST_AFTER_TOKEN_TRANSFER_HOOK)
        .not.to.emit(hook2, EVENT_NAME_TEST_AFTER_TOKEN_TRANSFER_HOOK);
      await proveTx(hook1.setRevertWithReasonMessage(true));
      await proveTx(hook2.setRevertWithReasonMessage(false));
      await expect(connect(token, user).transfer(user.address, 0))
        .to.emit(token, EVENT_NAME_AFTER_TOKEN_TRANSFER_HOOK_FAILURE)
        .withArgs(await hook1.getAddress(), REVERT_REASON_MESSAGE, ZERO_PANIC_ERROR_CODE, ZERO_REVERT_LOW_LEVEL_DATA)
        .to.emit(hook2, EVENT_NAME_TEST_AFTER_TOKEN_TRANSFER_HOOK)
        .not.to.emit(hook1, EVENT_NAME_TEST_AFTER_TOKEN_TRANSFER_HOOK);
      await proveTx(hook1.setRevertWithReasonMessage(false));
      await proveTx(hook2.setRevertWithReasonMessage(true));
      await expect(connect(token, user).transfer(user.address, 0))
        .to.emit(token, EVENT_NAME_AFTER_TOKEN_TRANSFER_HOOK_FAILURE)
        .withArgs(await hook2.getAddress(), REVERT_REASON_MESSAGE, ZERO_PANIC_ERROR_CODE, ZERO_REVERT_LOW_LEVEL_DATA)
        .to.emit(hook1, EVENT_NAME_TEST_AFTER_TOKEN_TRANSFER_HOOK)
        .not.to.emit(hook2, EVENT_NAME_TEST_AFTER_TOKEN_TRANSFER_HOOK);
    });

    it("Emit if reverted without reason message", async () => {
      const { token, hook1, hook2 } = await setUpFixture(deployTokenAndHooks);
      const hooks: HookConfig[] = [
        {
          account: await hook1.getAddress(),
          policy: ErrorHandlingPolicy.Event
        },
        {
          account: await hook2.getAddress(),
          policy: ErrorHandlingPolicy.Event
        }
      ];
      await proveTx(token.setAfterTokenTransferHooks(hooks));
      await expect(connect(token, user).transfer(user.address, 0))
        .to.emit(hook1, EVENT_NAME_TEST_AFTER_TOKEN_TRANSFER_HOOK)
        .to.emit(hook2, EVENT_NAME_TEST_AFTER_TOKEN_TRANSFER_HOOK)
        .not.to.emit(token, EVENT_NAME_AFTER_TOKEN_TRANSFER_HOOK_FAILURE);
      await proveTx(hook1.setRevertWithoutReasonMessage(true));
      await proveTx(hook2.setRevertWithoutReasonMessage(true));
      await expect(connect(token, user).transfer(user.address, 0))
        .to.emit(token, EVENT_NAME_AFTER_TOKEN_TRANSFER_HOOK_FAILURE)
        .withArgs(
          await hook1.getAddress(),
          ZERO_REVERT_REASON_MESSAGE,
          ZERO_PANIC_ERROR_CODE,
          REVERT_LOW_LEVEL_DATA_AFTER
        )
        .to.emit(token, EVENT_NAME_AFTER_TOKEN_TRANSFER_HOOK_FAILURE)
        .withArgs(
          await hook2.getAddress(),
          ZERO_REVERT_REASON_MESSAGE,
          ZERO_PANIC_ERROR_CODE,
          REVERT_LOW_LEVEL_DATA_AFTER
        )
        .not.to.emit(hook1, EVENT_NAME_TEST_AFTER_TOKEN_TRANSFER_HOOK)
        .not.to.emit(hook2, EVENT_NAME_TEST_AFTER_TOKEN_TRANSFER_HOOK);
    });
  });
});
