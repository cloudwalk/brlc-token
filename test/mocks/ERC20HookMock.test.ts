import { ethers, network } from "hardhat";
import { expect } from "chai";
import { Contract, ContractFactory } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { proveTx } from "../../test-utils/eth";

async function setUpFixture<T>(func: () => Promise<T>): Promise<T> {
  if (network.name === "hardhat") {
    return loadFixture(func);
  } else {
    return func();
  }
}

describe("Contract 'ERC20HookMock'", async () => {
  const TOKEN_AMOUNT = 100;

  const PANIC_ERROR_CODE = "0x1";
  const REVERT_REASON_MESSAGE = "error message";

  const EVENT_NAME_TEST_BEFORE_TOKEN_TRANSFER_HOOK = "TestBeforeTokenTransferHookEvent";
  const EVENT_NAME_TEST_AFTER_TOKEN_TRANSFER_HOOK = "TestAfterTokenTransferHookEvent";

  const REVERT_ERROR_TEST_BEFORE_TOKEN_TRANSFER_HOOK = "TestBeforeTokenTransferHookError";
  const REVERT_ERROR_TEST_AFTER_TOKEN_TRANSFER_HOOK = "TestAfterTokenTransferHookError";

  let hookFactory: ContractFactory;
  let deployer: SignerWithAddress;
  let user1: SignerWithAddress;
  let user2: SignerWithAddress;

  before(async () => {
    [deployer, user1, user2] = await ethers.getSigners();
    hookFactory = await ethers.getContractFactory("ERC20HookMock");
  });

  async function deployHookable(): Promise<{ hookable: Contract }> {
    const hookable: Contract = await hookFactory.deploy();
    return { hookable };
  }

  describe("Function 'setRevertWithPanic()'", async () => {
    it("Executes as expected", async () => {
      const { hookable } = await setUpFixture(deployHookable);
      expect(await hookable.revertWithPanic()).to.equal(false);
      await proveTx(hookable.connect(deployer).setRevertWithPanic(true));
      expect(await hookable.revertWithPanic()).to.equal(true);
      await proveTx(hookable.connect(deployer).setRevertWithPanic(false));
      expect(await hookable.revertWithPanic()).to.equal(false);
    });
  });

  describe("Function 'setRevertWithReasonMessage()'", async () => {
    it("Executes as expected", async () => {
      const { hookable } = await setUpFixture(deployHookable);
      expect(await hookable.revertWithReasonMessage()).to.equal(false);
      await proveTx(hookable.connect(deployer).setRevertWithReasonMessage(true));
      expect(await hookable.revertWithReasonMessage()).to.equal(true);
      await proveTx(hookable.connect(deployer).setRevertWithReasonMessage(false));
      expect(await hookable.revertWithReasonMessage()).to.equal(false);
    });
  });

  describe("Function 'setRevertWithoutReasonMessage()'", async () => {
    it("Executes as expected", async () => {
      const { hookable } = await setUpFixture(deployHookable);
      expect(await hookable.revertWithoutReasonMessage()).to.equal(false);
      await proveTx(hookable.connect(deployer).setRevertWithoutReasonMessage(true));
      expect(await hookable.revertWithoutReasonMessage()).to.equal(true);
      await proveTx(hookable.connect(deployer).setRevertWithoutReasonMessage(false));
      expect(await hookable.revertWithoutReasonMessage()).to.equal(false);
    });
  });

  describe("Function 'beforeTokenTransfer()'", async () => {
    it("Executes as expected and emits the correct event", async () => {
      const { hookable } = await setUpFixture(deployHookable);
      expect(await hookable.revertWithPanic()).to.equal(false);
      expect(await hookable.revertWithReasonMessage()).to.equal(false);
      expect(await hookable.revertWithoutReasonMessage()).to.equal(false);
      await proveTx(hookable.connect(deployer).setRevertWithPanic(true));
      await expect(
        hookable.beforeTokenTransfer(user1.address, user2.address, TOKEN_AMOUNT)
      ).to.be.revertedWithPanic(PANIC_ERROR_CODE);
      await proveTx(hookable.connect(deployer).setRevertWithPanic(false));
      await proveTx(hookable.connect(deployer).setRevertWithReasonMessage(true));
      await expect(
        hookable.beforeTokenTransfer(user1.address, user2.address, TOKEN_AMOUNT)
      ).to.be.revertedWith(REVERT_REASON_MESSAGE);
      await proveTx(hookable.connect(deployer).setRevertWithReasonMessage(false));
      await proveTx(hookable.connect(deployer).setRevertWithoutReasonMessage(true));
      await expect(
        hookable.beforeTokenTransfer(user1.address, user2.address, TOKEN_AMOUNT)
      ).to.be.revertedWithCustomError(hookable, REVERT_ERROR_TEST_BEFORE_TOKEN_TRANSFER_HOOK);
      await proveTx(hookable.connect(deployer).setRevertWithoutReasonMessage(false));
      await expect(
        hookable.beforeTokenTransfer(user1.address, user2.address, TOKEN_AMOUNT)
      ).to.emit(hookable, EVENT_NAME_TEST_BEFORE_TOKEN_TRANSFER_HOOK);
    });
  });

  describe("Function 'afterTokenTransfer()'", async () => {
    it("Executes as expected and emits the correct event", async () => {
      const { hookable } = await setUpFixture(deployHookable);
      expect(await hookable.revertWithPanic()).to.equal(false);
      expect(await hookable.revertWithReasonMessage()).to.equal(false);
      expect(await hookable.revertWithoutReasonMessage()).to.equal(false);
      await proveTx(hookable.connect(deployer).setRevertWithPanic(true));
      await expect(
        hookable.afterTokenTransfer(user1.address, user2.address, TOKEN_AMOUNT)
      ).to.be.revertedWithPanic(PANIC_ERROR_CODE);
      await proveTx(hookable.connect(deployer).setRevertWithPanic(false));
      await proveTx(hookable.connect(deployer).setRevertWithReasonMessage(true));
      await expect(
        hookable.afterTokenTransfer(user1.address, user2.address, TOKEN_AMOUNT)
      ).to.be.revertedWith(REVERT_REASON_MESSAGE);
      await proveTx(hookable.connect(deployer).setRevertWithReasonMessage(false));
      await proveTx(hookable.connect(deployer).setRevertWithoutReasonMessage(true));
      await expect(
        hookable.afterTokenTransfer(user1.address, user2.address, TOKEN_AMOUNT)
      ).to.be.revertedWithCustomError(hookable, REVERT_ERROR_TEST_AFTER_TOKEN_TRANSFER_HOOK);
      await proveTx(hookable.connect(deployer).setRevertWithoutReasonMessage(false));
      await expect(
        hookable.afterTokenTransfer(user1.address, user2.address, TOKEN_AMOUNT)
      ).to.emit(hookable, EVENT_NAME_TEST_AFTER_TOKEN_TRANSFER_HOOK);
    });
  });
});
