import { ethers } from "hardhat";
import { expect } from "chai";
import { Contract, ContractFactory } from "ethers";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { connect, proveTx } from "../../test-utils/eth";
import { setUpFixture } from "../../test-utils/common";

describe("Contract 'ERC20HookMock'", async () => {
  const TOKEN_AMOUNT = 100;

  const PANIC_ERROR_CODE = "0x1";
  const REVERT_REASON_MESSAGE = "error message";

  // Events of the contracts under test
  const EVENT_NAME_TEST_AFTER_TOKEN_TRANSFER_HOOK = "TestAfterTokenTransferHookEvent";
  const EVENT_NAME_TEST_BEFORE_TOKEN_TRANSFER_HOOK = "TestBeforeTokenTransferHookEvent";

  // Errors of the contracts under test
  const ERROR_NAME_TEST_AFTER_TOKEN_TRANSFER_HOOK = "TestAfterTokenTransferHookError";
  const ERROR_NAME_TEST_BEFORE_TOKEN_TRANSFER_HOOK = "TestBeforeTokenTransferHookError";

  let hookFactory: ContractFactory;
  let deployer: HardhatEthersSigner;
  let user1: HardhatEthersSigner;
  let user2: HardhatEthersSigner;

  before(async () => {
    [deployer, user1, user2] = await ethers.getSigners();
    hookFactory = await ethers.getContractFactory("ERC20HookMock");
    hookFactory = hookFactory.connect(deployer); // Explicitly specifying the deployer account
  });

  async function deployHookable(): Promise<{ hookable: Contract }> {
    let hookable = await hookFactory.deploy() as Contract;
    await hookable.waitForDeployment();
    hookable = connect(hookable, deployer); // Explicitly specifying the initial account
    return { hookable };
  }

  describe("Function 'setRevertWithPanic()'", async () => {
    it("Executes as expected", async () => {
      const { hookable } = await setUpFixture(deployHookable);
      expect(await hookable.revertWithPanic()).to.equal(false);
      await proveTx(hookable.setRevertWithPanic(true));
      expect(await hookable.revertWithPanic()).to.equal(true);
      await proveTx(hookable.setRevertWithPanic(false));
      expect(await hookable.revertWithPanic()).to.equal(false);
    });
  });

  describe("Function 'setRevertWithReasonMessage()'", async () => {
    it("Executes as expected", async () => {
      const { hookable } = await setUpFixture(deployHookable);
      expect(await hookable.revertWithReasonMessage()).to.equal(false);
      await proveTx(hookable.setRevertWithReasonMessage(true));
      expect(await hookable.revertWithReasonMessage()).to.equal(true);
      await proveTx(hookable.setRevertWithReasonMessage(false));
      expect(await hookable.revertWithReasonMessage()).to.equal(false);
    });
  });

  describe("Function 'setRevertWithoutReasonMessage()'", async () => {
    it("Executes as expected", async () => {
      const { hookable } = await setUpFixture(deployHookable);
      expect(await hookable.revertWithoutReasonMessage()).to.equal(false);
      await proveTx(hookable.setRevertWithoutReasonMessage(true));
      expect(await hookable.revertWithoutReasonMessage()).to.equal(true);
      await proveTx(hookable.setRevertWithoutReasonMessage(false));
      expect(await hookable.revertWithoutReasonMessage()).to.equal(false);
    });
  });

  describe("Function 'beforeTokenTransfer()'", async () => {
    it("Executes as expected and emits the correct event", async () => {
      const { hookable } = await setUpFixture(deployHookable);
      expect(await hookable.revertWithPanic()).to.equal(false);
      expect(await hookable.revertWithReasonMessage()).to.equal(false);
      expect(await hookable.revertWithoutReasonMessage()).to.equal(false);
      await proveTx(hookable.setRevertWithPanic(true));
      await expect(hookable.beforeTokenTransfer(user1.address, user2.address, TOKEN_AMOUNT))
        .to.be.revertedWithPanic(PANIC_ERROR_CODE);
      await proveTx(hookable.setRevertWithPanic(false));
      await proveTx(hookable.setRevertWithReasonMessage(true));
      await expect(hookable.beforeTokenTransfer(user1.address, user2.address, TOKEN_AMOUNT))
        .to.be.revertedWith(REVERT_REASON_MESSAGE);
      await proveTx(hookable.setRevertWithReasonMessage(false));
      await proveTx(hookable.setRevertWithoutReasonMessage(true));
      await expect(hookable.beforeTokenTransfer(user1.address, user2.address, TOKEN_AMOUNT))
        .to.be.revertedWithCustomError(hookable, ERROR_NAME_TEST_BEFORE_TOKEN_TRANSFER_HOOK);
      await proveTx(hookable.setRevertWithoutReasonMessage(false));
      await expect(hookable.beforeTokenTransfer(user1.address, user2.address, TOKEN_AMOUNT))
        .to.emit(hookable, EVENT_NAME_TEST_BEFORE_TOKEN_TRANSFER_HOOK);
    });
  });

  describe("Function 'afterTokenTransfer()'", async () => {
    it("Executes as expected and emits the correct event", async () => {
      const { hookable } = await setUpFixture(deployHookable);
      expect(await hookable.revertWithPanic()).to.equal(false);
      expect(await hookable.revertWithReasonMessage()).to.equal(false);
      expect(await hookable.revertWithoutReasonMessage()).to.equal(false);
      await proveTx(hookable.setRevertWithPanic(true));
      await expect(hookable.afterTokenTransfer(user1.address, user2.address, TOKEN_AMOUNT))
        .to.be.revertedWithPanic(PANIC_ERROR_CODE);
      await proveTx(hookable.setRevertWithPanic(false));
      await proveTx(hookable.setRevertWithReasonMessage(true));
      await expect(hookable.afterTokenTransfer(user1.address, user2.address, TOKEN_AMOUNT))
        .to.be.revertedWith(REVERT_REASON_MESSAGE);
      await proveTx(hookable.setRevertWithReasonMessage(false));
      await proveTx(hookable.setRevertWithoutReasonMessage(true));
      await expect(hookable.afterTokenTransfer(user1.address, user2.address, TOKEN_AMOUNT))
        .to.be.revertedWithCustomError(hookable, ERROR_NAME_TEST_AFTER_TOKEN_TRANSFER_HOOK);
      await proveTx(hookable.setRevertWithoutReasonMessage(false));
      await expect(hookable.afterTokenTransfer(user1.address, user2.address, TOKEN_AMOUNT))
        .to.emit(hookable, EVENT_NAME_TEST_AFTER_TOKEN_TRANSFER_HOOK);
    });
  });
});
