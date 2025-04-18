import { ethers, network, upgrades } from "hardhat";
import { expect } from "chai";
import { Contract, ContractFactory } from "ethers";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { proveTx, connect, getAddress } from "../../test-utils/eth";

async function setUpFixture<T>(func: () => Promise<T>): Promise<T> {
  if (network.name === "hardhat") {
    return loadFixture(func);
  } else {
    return func();
  }
}

describe("Contract 'ERC20Freezable'", async () => {
  const TOKEN_NAME = "BRL Coin";
  const TOKEN_SYMBOL = "BRLC";

  const TOKEN_AMOUNT = 100;
  const TOKEN_AMOUNTx2 = TOKEN_AMOUNT * 2;
  const TOKEN_AMOUNTx3 = TOKEN_AMOUNT * 3;

  const EVENT_NAME_FREEZE = "Freeze";
  const EVENT_NAME_FREEZE_TRANSFER = "FreezeTransfer";
  const EVENT_NAME_FREEZER_ASSIGNED = "FreezerAssigned";
  const EVENT_NAME_FREEZER_REMOVED = "FreezerRemoved";

  const REVERT_MESSAGE_ERC20_TRANSFER_AMOUNT_EXCEEDS_BALANCE = "ERC20: transfer amount exceeds balance";
  const REVERT_MESSAGE_INITIALIZABLE_CONTRACT_IS_ALREADY_INITIALIZED = "Initializable: contract is already initialized";
  const REVERT_MESSAGE_INITIALIZABLE_CONTRACT_IS_NOT_INITIALIZING = "Initializable: contract is not initializing";
  const REVERT_MESSAGE_OWNABLE_CALLER_IS_NOT_THE_OWNER = "Ownable: caller is not the owner";
  const REVERT_MESSAGE_PAUSABLE_PAUSED = "Pausable: paused";

  const REVERT_ERROR_ALREADY_CONFIGURED = "AlreadyConfigured";
  const REVERT_ERROR_CONTRACT_BALANCE_FREEZING_ATTEMPT = "ContractBalanceFreezingAttempt";
  const REVERT_ERROR_LACK_OF_FROZEN_BALANCE = "LackOfFrozenBalance";
  const REVERT_ERROR_UNAUTHORIZED_FREEZER = "UnauthorizedFreezer";
  const REVERT_ERROR_ZERO_AMOUNT = "ZeroAmount";
  const REVERT_ERROR_ZERO_ADDRESS = "ZeroAddress";

  let tokenFactory: ContractFactory;
  let deployer: HardhatEthersSigner;
  let pauser: HardhatEthersSigner;
  let freezer: HardhatEthersSigner;
  let user1: HardhatEthersSigner;
  let user2: HardhatEthersSigner;

  before(async () => {
    [deployer, pauser, freezer, user1, user2] = await ethers.getSigners();
    tokenFactory = await ethers.getContractFactory("ERC20FreezableMock");
    tokenFactory = tokenFactory.connect(deployer); // Explicitly specifying the deployer account
  });

  async function deployToken(): Promise<{ token: Contract }> {
    let token: Contract = await upgrades.deployProxy(
      tokenFactory,
      [TOKEN_NAME, TOKEN_SYMBOL],
      { unsafeSkipProxyAdminCheck: true } // This is necessary to run tests on other networks
    ) as Contract;
    await token.waitForDeployment();
    token = connect(token, deployer); // Explicitly specifying the initial account
    return { token };
  }

  async function deployAndConfigureToken(): Promise<{ token: Contract }> {
    const { token } = await deployToken();
    await proveTx(token.setPauser(pauser.address));
    await proveTx(token.configureFreezerBatch([freezer.address], true));
    return { token };
  }

  describe("Function 'initialize()'", async () => {
    it("Configures the contract as expected", async () => {
      const { token } = await setUpFixture(deployToken);
      expect(await token.owner()).to.equal(deployer.address);
      expect(await token.pauser()).to.equal(ethers.ZeroAddress);
      expect(await token.isFreezer(freezer.address)).to.equal(false);

      // To ensure 100% coverage even for the deprecated function
      expect(await token.frozenBalance(user1.address)).to.equal(0);
      await proveTx(token.approveFreezing());
      expect(await token.freezeApproval(user1.address)).to.equal(false);
    });

    it("Is reverted if called for the second time", async () => {
      const { token } = await setUpFixture(deployToken);
      await expect(
        token.initialize(TOKEN_NAME, TOKEN_SYMBOL)
      ).to.be.revertedWith(REVERT_MESSAGE_INITIALIZABLE_CONTRACT_IS_ALREADY_INITIALIZED);
    });

    it("Is reverted if the internal unchained initializer is called outside of the init process", async () => {
      const { token } = await setUpFixture(deployToken);
      await expect(
        token.call_parent_initialize_unchained()
      ).to.be.revertedWith(REVERT_MESSAGE_INITIALIZABLE_CONTRACT_IS_NOT_INITIALIZING);
    });
  });

  describe("Function 'configureFreezerBatch()'", async () => {
    it("Configures several freezers and emits the correct events as expected", async () => {
      const { token } = await setUpFixture(deployToken);
      expect(await token.isFreezer(user1.address)).to.eq(false);
      expect(await token.isFreezer(user2.address)).to.eq(false);
      await expect(connect(token, deployer).configureFreezerBatch([user1.address, user2.address], true))
        .to.emit(token, EVENT_NAME_FREEZER_ASSIGNED)
        .withArgs(user1.address)
        .to.emit(token, EVENT_NAME_FREEZER_ASSIGNED)
        .withArgs(user2.address);
      expect(await token.isFreezer(user1.address)).to.eq(true);
      expect(await token.isFreezer(user2.address)).to.eq(true);
    });

    it("Removes several freezers and emits the correct events as expected", async () => {
      const { token } = await setUpFixture(deployToken);
      await proveTx(connect(token, deployer).configureFreezerBatch([user1.address, user2.address], true));
      expect(await token.isFreezer(user1.address)).to.eq(true);
      expect(await token.isFreezer(user2.address)).to.eq(true);

      await expect(connect(token, deployer).configureFreezerBatch([user1.address, user2.address], false))
        .to.emit(token, EVENT_NAME_FREEZER_REMOVED)
        .withArgs(user1.address)
        .to.emit(token, EVENT_NAME_FREEZER_REMOVED)
        .withArgs(user2.address);
      expect(await token.isFreezer(user1.address)).to.eq(false);
      expect(await token.isFreezer(user2.address)).to.eq(false);
    });

    it("Is reverted if contract is paused", async () => {
      const { token } = await setUpFixture(deployToken);
      await proveTx(token.setPauser(pauser.address));
      await proveTx(connect(token, pauser).pause());
      await expect(
        connect(token, deployer).configureFreezerBatch([user1.address], true)
      ).to.be.revertedWith(REVERT_MESSAGE_PAUSABLE_PAUSED);
    });

    it("Is reverted if the caller is not an owner", async () => {
      const { token } = await setUpFixture(deployToken);
      await expect(
        connect(token, user1).configureFreezerBatch([user1.address], true)
      ).to.be.revertedWith(REVERT_MESSAGE_OWNABLE_CALLER_IS_NOT_THE_OWNER);
    });

    it("Is reverted if freezers with different statuses are already configured", async () => {
      const { token } = await setUpFixture(deployToken);
      await proveTx(connect(token, deployer).configureFreezerBatch([user2.address], true));
      await expect(connect(token, deployer).configureFreezerBatch([user1.address, user2.address], true))
        .to.be.revertedWithCustomError(token, REVERT_ERROR_ALREADY_CONFIGURED);
      await expect(connect(token, deployer).configureFreezerBatch([user1.address, user2.address], false))
        .to.be.revertedWithCustomError(token, REVERT_ERROR_ALREADY_CONFIGURED);
    });
  });

  describe("Function 'freeze()'", async () => {
    it("Freezes tokens and emits the correct events for an externally owned account", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      const tokenUnderFreezer: Contract = connect(token, freezer);

      expect(await token.balanceOf(user1.address)).to.eq(0);

      expect(
        await tokenUnderFreezer.freeze.staticCall(user1.address, TOKEN_AMOUNT)
      ).to.deep.eq([TOKEN_AMOUNT, 0]);
      await expect(tokenUnderFreezer.freeze(user1.address, TOKEN_AMOUNT))
        .to.emit(token, EVENT_NAME_FREEZE)
        .withArgs(user1.address, TOKEN_AMOUNT, 0);
      expect(await token.balanceOfFrozen(user1.address)).to.eq(TOKEN_AMOUNT);

      await proveTx(token.mint(user1.address, TOKEN_AMOUNT));
      expect(await token.balanceOf(user1.address)).to.eq(TOKEN_AMOUNT);
      expect(
        await tokenUnderFreezer.freeze.staticCall(user1.address, TOKEN_AMOUNT + 1)
      ).to.deep.eq([TOKEN_AMOUNT + 1, TOKEN_AMOUNT]);
      await expect(tokenUnderFreezer.freeze(user1.address, TOKEN_AMOUNT + 1))
        .to.emit(token, EVENT_NAME_FREEZE)
        .withArgs(user1.address, TOKEN_AMOUNT + 1, TOKEN_AMOUNT);
      expect(await token.balanceOfFrozen(user1.address)).to.eq(TOKEN_AMOUNT + 1);

      expect(
        await tokenUnderFreezer.freeze.staticCall(user1.address, TOKEN_AMOUNT + 2)
      ).to.deep.eq([TOKEN_AMOUNT + 2, TOKEN_AMOUNT + 1]);
      await expect(tokenUnderFreezer.freeze(user1.address, TOKEN_AMOUNT - 2))
        .to.emit(token, EVENT_NAME_FREEZE)
        .withArgs(user1.address, TOKEN_AMOUNT - 2, TOKEN_AMOUNT + 1);
      expect(await token.balanceOfFrozen(user1.address)).to.eq(TOKEN_AMOUNT - 2);
    });

    it("Executes as expected is the target account is a contract and the new balance is zero", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      const tokenAddress = getAddress(token);
      await proveTx(token.setFrozenBalance(tokenAddress, TOKEN_AMOUNT));
      await expect(connect(token, freezer).freeze(tokenAddress, 0))
        .to.emit(token, EVENT_NAME_FREEZE)
        .withArgs(tokenAddress, 0, TOKEN_AMOUNT);
    });

    it("Is reverted if contract is paused", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(connect(token, pauser).pause());
      await expect(
        connect(token, freezer).freeze(user1.address, TOKEN_AMOUNT)
      ).to.be.revertedWith(REVERT_MESSAGE_PAUSABLE_PAUSED);
    });

    it("Is reverted if the caller is not a freezer", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await expect(connect(token, user1).freeze(user2.address, TOKEN_AMOUNT))
        .to.be.revertedWithCustomError(token, REVERT_ERROR_UNAUTHORIZED_FREEZER);
    });

    it("Is reverted if the provided account is zero", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await expect(
        connect(token, freezer).freeze(ethers.ZeroAddress, TOKEN_AMOUNT)
      ).to.be.revertedWithCustomError(token, REVERT_ERROR_ZERO_ADDRESS);
    });

    it("Is reverted if the provided account is a contract and the new frozen balance is non-zero", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await expect(
        connect(token, freezer).freeze(getAddress(token), TOKEN_AMOUNT)
      ).to.be.revertedWithCustomError(token, REVERT_ERROR_CONTRACT_BALANCE_FREEZING_ATTEMPT);
    });
  });

  describe("Function 'freezeIncrease()'", async () => {
    it("Increase frozen balance and emits the correct event", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      const tokenUnderFreezer: Contract = connect(token, freezer);
      expect(await token.balanceOfFrozen(user1.address)).to.eq(0);

      expect(
        await tokenUnderFreezer.freezeIncrease.staticCall(user1.address, TOKEN_AMOUNT)
      ).to.deep.eq([TOKEN_AMOUNT, 0]);
      await expect(tokenUnderFreezer.freezeIncrease(user1.address, TOKEN_AMOUNT))
        .to.emit(token, EVENT_NAME_FREEZE)
        .withArgs(user1.address, TOKEN_AMOUNT, 0);
      expect(await token.balanceOfFrozen(user1.address)).to.eq(TOKEN_AMOUNT);

      expect(
        await tokenUnderFreezer.freezeIncrease.staticCall(user1.address, TOKEN_AMOUNTx2)
      ).to.deep.eq([TOKEN_AMOUNTx3, TOKEN_AMOUNT]);
      await expect(tokenUnderFreezer.freezeIncrease(user1.address, TOKEN_AMOUNTx2))
        .to.emit(token, EVENT_NAME_FREEZE)
        .withArgs(user1.address, TOKEN_AMOUNTx3, TOKEN_AMOUNT);
      expect(await token.balanceOfFrozen(user1.address)).to.eq(TOKEN_AMOUNTx3);
    });

    it("Is reverted if contract is paused", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(connect(token, pauser).pause());
      await expect(
        connect(token, freezer).freezeIncrease(user1.address, TOKEN_AMOUNT)
      ).to.be.revertedWith(REVERT_MESSAGE_PAUSABLE_PAUSED);
    });

    it("Is reverted if the caller is not a freezer", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await expect(
        connect(token, user1).freezeIncrease(user2.address, TOKEN_AMOUNT)
      ).to.be.revertedWithCustomError(token, REVERT_ERROR_UNAUTHORIZED_FREEZER);
    });

    it("Is reverted if the provided account is zero", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await expect(
        connect(token, freezer).freezeIncrease(ethers.ZeroAddress, TOKEN_AMOUNT)
      ).to.be.revertedWithCustomError(token, REVERT_ERROR_ZERO_ADDRESS);
    });

    it("Is reverted if the provided account is a contract", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await expect(
        connect(token, freezer).freezeIncrease(getAddress(token), TOKEN_AMOUNT)
      ).to.be.revertedWithCustomError(token, REVERT_ERROR_CONTRACT_BALANCE_FREEZING_ATTEMPT);
    });

    it("Is reverted if the provided amount is zero", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await expect(
        connect(token, freezer).freezeIncrease(user1.address, 0)
      ).to.be.revertedWithCustomError(token, REVERT_ERROR_ZERO_AMOUNT);
    });
  });

  describe("Function 'freezeDecrease()'", async () => {
    it("Decrease frozen balance and emits the correct event", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      const tokenUnderFreezer: Contract = connect(token, freezer);

      await proveTx(tokenUnderFreezer.freezeIncrease(user1.address, TOKEN_AMOUNTx3));

      expect(
        await tokenUnderFreezer.freezeDecrease.staticCall(user1.address, TOKEN_AMOUNT)
      ).to.deep.eq([TOKEN_AMOUNTx2, TOKEN_AMOUNTx3]);
      await expect(tokenUnderFreezer.freezeDecrease(user1.address, TOKEN_AMOUNT))
        .to.emit(token, EVENT_NAME_FREEZE)
        .withArgs(user1.address, TOKEN_AMOUNTx2, TOKEN_AMOUNTx3);
      expect(await token.balanceOfFrozen(user1.address)).to.eq(TOKEN_AMOUNTx2);

      expect(
        await tokenUnderFreezer.freezeDecrease.staticCall(user1.address, TOKEN_AMOUNTx2)
      ).to.deep.eq([0, TOKEN_AMOUNTx2]);
      await expect(tokenUnderFreezer.freezeDecrease(user1.address, TOKEN_AMOUNTx2))
        .to.emit(token, EVENT_NAME_FREEZE)
        .withArgs(user1.address, 0, TOKEN_AMOUNTx2);
      expect(await token.balanceOfFrozen(user1.address)).to.eq(0);
    });

    it("Executes as expected is the target account is a contract and the new balance is zero", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      const tokenAddress = getAddress(token);
      await proveTx(token.setFrozenBalance(tokenAddress, TOKEN_AMOUNT));
      await expect(connect(token, freezer).freezeDecrease(tokenAddress, TOKEN_AMOUNT))
        .to.emit(token, EVENT_NAME_FREEZE)
        .withArgs(tokenAddress, 0, TOKEN_AMOUNT);
    });

    it("Is reverted if contract is paused", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(connect(token, pauser).pause());
      await expect(
        connect(token, freezer).freezeDecrease(user1.address, TOKEN_AMOUNT)
      ).to.be.revertedWith(REVERT_MESSAGE_PAUSABLE_PAUSED);
    });

    it("Is reverted if the caller is not a freezer", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await expect(
        connect(token, user1).freezeDecrease(user1.address, TOKEN_AMOUNT)
      ).to.be.revertedWithCustomError(token, REVERT_ERROR_UNAUTHORIZED_FREEZER);
    });

    it("Is reverted if the provided account is zero", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await expect(
        connect(token, freezer).freezeDecrease(ethers.ZeroAddress, TOKEN_AMOUNT)
      ).to.be.revertedWithCustomError(token, REVERT_ERROR_ZERO_ADDRESS);
    });

    it("Is reverted if the provided account is a contract and the new frozen balance is non-zero", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      const tokenAddress = getAddress(token);
      await proveTx(token.setFrozenBalance(tokenAddress, TOKEN_AMOUNTx2));
      await expect(
        connect(token, freezer).freezeDecrease(getAddress(token), TOKEN_AMOUNT)
      ).to.be.revertedWithCustomError(token, REVERT_ERROR_CONTRACT_BALANCE_FREEZING_ATTEMPT);
    });

    it("Is reverted if the provided amount is zero", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await expect(
        connect(token, freezer).freezeDecrease(user1.address, 0)
      ).to.be.revertedWithCustomError(token, REVERT_ERROR_ZERO_AMOUNT);
    });

    it("Is reverted if the provided amount is greater then old balance", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);

      await proveTx(connect(token, freezer).freezeIncrease(user1.address, TOKEN_AMOUNT));
      await expect(
        connect(token, freezer).freezeDecrease(user1.address, TOKEN_AMOUNT + 1)
      ).to.be.revertedWithCustomError(token, REVERT_ERROR_LACK_OF_FROZEN_BALANCE);
    });
  });

  describe("Function 'transferFrozen()'", async () => {
    describe("Executes as expected if", async () => {
      async function executeAndCheckTransferFrozen(props: {
        balance: number;
        frozenAmount: number;
        transferAmount: number;
      }) {
        const { transferAmount } = props;
        const { token } = await setUpFixture(deployAndConfigureToken);
        const oldFrozenAmount = props.frozenAmount;
        const newFrozenAmount = oldFrozenAmount - transferAmount;
        if (transferAmount > props.balance) {
          throw new Error("Incorrect values: transferAmount > balance");
        }
        if (transferAmount > oldFrozenAmount) {
          throw new Error("Incorrect values: transferAmount > oldFrozenAmount");
        }

        await proveTx(token.mint(user1.address, props.balance));
        await proveTx(connect(token, freezer).freeze(user1.address, oldFrozenAmount));
        expect(await connect(token, freezer).transferFrozen.staticCall(
          user1.address,
          user2.address,
          transferAmount
        )).to.deep.eq([newFrozenAmount, oldFrozenAmount]);
        const tx = connect(token, freezer).transferFrozen(
          user1.address,
          user2.address,
          transferAmount
        );
        await expect(tx)
          .to.emit(token, EVENT_NAME_FREEZE_TRANSFER)
          .withArgs(user1.address, transferAmount);
        await expect(tx)
          .to.emit(token, EVENT_NAME_FREEZE)
          .withArgs(user1.address, newFrozenAmount, oldFrozenAmount);
        await expect(tx).to.changeTokenBalances(token, [user1, user2], [-transferAmount, transferAmount]);
      }

      it("The frozen amount is less than the account balance", async () => {
        await executeAndCheckTransferFrozen({
          balance: TOKEN_AMOUNT,
          frozenAmount: TOKEN_AMOUNT - 1,
          transferAmount: TOKEN_AMOUNT - 1
        });
      });

      it("The frozen amount is equal to the account balance", async () => {
        await executeAndCheckTransferFrozen({
          balance: TOKEN_AMOUNT,
          frozenAmount: TOKEN_AMOUNT,
          transferAmount: TOKEN_AMOUNT
        });
      });

      it("The frozen amount is greater than the account balance", async () => {
        await executeAndCheckTransferFrozen({
          balance: TOKEN_AMOUNT,
          frozenAmount: TOKEN_AMOUNT + 1,
          transferAmount: TOKEN_AMOUNT
        });
      });
    });

    describe("Is reverted if", async () => {
      it("The caller is not a freezer", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        await proveTx(token.mint(user1.address, TOKEN_AMOUNT));
        await expect(connect(token, user2).transferFrozen(user1.address, user2.address, TOKEN_AMOUNT))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_UNAUTHORIZED_FREEZER);
      });

      it("The contract is paused", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        await proveTx(token.mint(user1.address, TOKEN_AMOUNT));
        await proveTx(connect(token, pauser).pause());
        await expect(
          connect(token, freezer).transferFrozen(user1.address, user2.address, TOKEN_AMOUNT)
        ).to.be.revertedWith(REVERT_MESSAGE_PAUSABLE_PAUSED);
      });

      it("There is a lack of frozen balance", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        await proveTx(token.mint(user1.address, TOKEN_AMOUNT));
        await proveTx(connect(token, freezer).freeze(user1.address, TOKEN_AMOUNT));
        await expect(
          connect(token, freezer).transferFrozen(user1.address, user2.address, TOKEN_AMOUNT + 1)
        ).to.be.revertedWithCustomError(token, REVERT_ERROR_LACK_OF_FROZEN_BALANCE);
      });

      it("There is a lack of common balance", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        await proveTx(token.mint(user1.address, TOKEN_AMOUNT));
        await proveTx(connect(token, freezer).freeze(user1.address, TOKEN_AMOUNT + 1));
        await expect(
          connect(token, freezer).transferFrozen(user1.address, user2.address, TOKEN_AMOUNT + 1)
        ).to.be.revertedWith(REVERT_MESSAGE_ERC20_TRANSFER_AMOUNT_EXCEEDS_BALANCE);
      });
    });
  });

  describe("Function 'transfer()'", async () => {
    describe("Execute as expected if the frozen balance is not zero and if", async () => {
      async function checkTransfer(
        props: {
          totalBalanceBefore: number;
          frozenBalanceBefore: number;
          transferAmount: number;
        }
      ) {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const { totalBalanceBefore, frozenBalanceBefore, transferAmount } = props;
        await proveTx(token.mint(user1.address, totalBalanceBefore));
        await proveTx(connect(token, freezer).freeze(user1.address, frozenBalanceBefore));
        await expect(
          connect(token, user1).transfer(user2.address, transferAmount)
        ).to.changeTokenBalances(
          token,
          [user1, user2],
          [-transferAmount, transferAmount]
        );
        const totalBalanceAfter = totalBalanceBefore - transferAmount;
        expect(await token.balanceOf(user1.address)).to.equal(totalBalanceAfter);
        expect(await token.balanceOfFrozen(user1.address)).to.equal(frozenBalanceBefore);
      }

      it("Only the free tokens are transferred", async () => {
        await checkTransfer({
          totalBalanceBefore: TOKEN_AMOUNT + 5,
          frozenBalanceBefore: TOKEN_AMOUNT,
          transferAmount: 5
        });
      });

      it("Not only free tokens are transferred", async () => {
        await checkTransfer({
          totalBalanceBefore: TOKEN_AMOUNT + 5,
          frozenBalanceBefore: TOKEN_AMOUNT,
          transferAmount: 10
        });
      });
    });
  });
});
