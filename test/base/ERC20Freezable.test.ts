import { ethers, network, upgrades } from "hardhat";
import { expect } from "chai";
import { Contract, ContractFactory } from "ethers";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { proveTx, connect } from "../../test-utils/eth";

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

  const EVENT_NAME_FREEZE = "Freeze";
  const EVENT_NAME_FREEZE_APPROVAL = "FreezeApproval";
  const EVENT_NAME_FREEZE_TRANSFER = "FreezeTransfer";
  const EVENT_NAME_FROZEN_UPDATED = "FrozenUpdated";

  const REVERT_MESSAGE_INITIALIZABLE_CONTRACT_IS_ALREADY_INITIALIZED = "Initializable: contract is already initialized";
  const REVERT_MESSAGE_INITIALIZABLE_CONTRACT_IS_NOT_INITIALIZING = "Initializable: contract is not initializing";
  const REVERT_MESSAGE_ERC20_TRANSFER_AMOUNT_EXCEEDS_BALANCE = "ERC20: transfer amount exceeds balance";
  const REVERT_MESSAGE_PAUSABLE_PAUSED = "Pausable: paused";

  const REVERT_ERROR_UNAUTHORIZED_BLOCKLISTER = "UnauthorizedBlocklister";
  const REVERT_ERROR_FREEZING_ALREADY_APPROVED = "FreezingAlreadyApproved";
  const REVERT_ERROR_FREEZING_NOT_APPROVED = "FreezingNotApproved";
  const REVERT_ERROR_LACK_OF_FROZEN_BALANCE = "LackOfFrozenBalance";
  const REVERT_ERROR_ZERO_AMOUNT = "ZeroAmount";
  const REVERT_ERROR_ZERO_ADDRESS = "ZeroAddress";

  let tokenFactory: ContractFactory;
  let deployer: HardhatEthersSigner;
  let pauser: HardhatEthersSigner;
  let blocklister: HardhatEthersSigner;
  let user1: HardhatEthersSigner;
  let user2: HardhatEthersSigner;

  before(async () => {
    [deployer, pauser, blocklister, user1, user2] = await ethers.getSigners();
    tokenFactory = await ethers.getContractFactory("ERC20FreezableMock");
    tokenFactory = tokenFactory.connect(deployer); // Explicitly specifying the deployer account
  });

  async function deployToken(): Promise<{ token: Contract }> {
    let token: Contract = await upgrades.deployProxy(tokenFactory, [TOKEN_NAME, TOKEN_SYMBOL]);
    await token.waitForDeployment();
    token = connect(token, deployer); // Explicitly specifying the initial account
    return { token };
  }

  async function deployAndConfigureToken(): Promise<{ token: Contract }> {
    const { token } = await deployToken();
    await proveTx(token.setPauser(pauser.address));
    await proveTx(token.setMainBlocklister(blocklister.address));
    return { token };
  }

  describe("Function 'initialize()'", async () => {
    it("Configures the contract as expected", async () => {
      const { token } = await setUpFixture(deployToken);
      expect(await token.owner()).to.equal(deployer.address);
      expect(await token.pauser()).to.equal(ethers.ZeroAddress);
      expect(await token.mainBlocklister()).to.equal(ethers.ZeroAddress);

      // To ensure 100% coverage even for the deprecated function
      expect(await token.frozenBalance(user1.address)).to.equal(0);
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

  describe("Function 'approveFreezing()'", async () => {
    it("Approves freezing and emits the correct event", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      expect(await token.freezeApproval(user1.address)).to.eq(false);
      await expect(connect(token, user1).approveFreezing())
        .to.emit(token, EVENT_NAME_FREEZE_APPROVAL)
        .withArgs(user1.address);
      expect(await token.freezeApproval(user1.address)).to.eq(true);
    });

    it("Is reverted if freezing is already approved", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(connect(token, user1).approveFreezing());
      await expect(
        connect(token, user1).approveFreezing()
      ).to.be.revertedWithCustomError(token, REVERT_ERROR_FREEZING_ALREADY_APPROVED);
    });

    it("Is reverted if contract is paused", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(connect(token, pauser).pause());
      await expect(
        connect(token, user1).approveFreezing()
      ).to.be.revertedWith(REVERT_MESSAGE_PAUSABLE_PAUSED);
    });
  });

  describe("Function 'freeze()'", async () => {
    it("Freezes tokens and emits the correct events", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(connect(token, user1).approveFreezing());
      expect(await token.balanceOf(user1.address)).to.eq(0);
      await expect(connect(token, blocklister).freeze(user1.address, TOKEN_AMOUNT))
        .to.emit(token, EVENT_NAME_FREEZE)
        .withArgs(user1.address, TOKEN_AMOUNT, 0);
      expect(await token.balanceOfFrozen(user1.address)).to.eq(TOKEN_AMOUNT);
      await proveTx(token.mint(user1.address, TOKEN_AMOUNT));
      expect(await token.balanceOf(user1.address)).to.eq(TOKEN_AMOUNT);
      await expect(connect(token, blocklister).freeze(user1.address, TOKEN_AMOUNT + 1))
        .to.emit(token, EVENT_NAME_FREEZE)
        .withArgs(user1.address, TOKEN_AMOUNT + 1, TOKEN_AMOUNT);
      expect(await token.balanceOfFrozen(user1.address)).to.eq(TOKEN_AMOUNT + 1);
      await expect(connect(token, blocklister).freeze(user1.address, TOKEN_AMOUNT - 2))
        .to.emit(token, EVENT_NAME_FREEZE)
        .withArgs(user1.address, TOKEN_AMOUNT - 2, TOKEN_AMOUNT + 1);
      expect(await token.balanceOfFrozen(user1.address)).to.eq(TOKEN_AMOUNT - 2);
    });

    it("Is reverted if freezing is not approved", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      expect(await token.freezeApproval(user1.address)).to.eq(false);
      await expect(
        connect(token, blocklister).freeze(user1.address, TOKEN_AMOUNT)
      ).to.be.revertedWithCustomError(token, REVERT_ERROR_FREEZING_NOT_APPROVED);
    });

    it("Is reverted if contract is paused", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(connect(token, pauser).pause());
      await expect(
        connect(token, blocklister).freeze(user1.address, TOKEN_AMOUNT)
      ).to.be.revertedWith(REVERT_MESSAGE_PAUSABLE_PAUSED);
    });

    it("Is reverted if the caller is not a blocklister", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await expect(connect(token, user1).freeze(user2.address, TOKEN_AMOUNT))
        .to.be.revertedWithCustomError(token, REVERT_ERROR_UNAUTHORIZED_BLOCKLISTER)
        .withArgs(user1.address);
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
        await proveTx(connect(token, user1).approveFreezing());
        await proveTx(connect(token, blocklister).freeze(user1.address, oldFrozenAmount));
        const tx = connect(token, blocklister).transferFrozen(
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
      it("The caller is not a blocklister", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        await proveTx(token.mint(user1.address, TOKEN_AMOUNT));
        await proveTx(connect(token, user1).approveFreezing());
        await expect(connect(token, user2).transferFrozen(user1.address, user2.address, TOKEN_AMOUNT))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_UNAUTHORIZED_BLOCKLISTER)
          .withArgs(user2.address);
      });

      it("The contract is paused", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        await proveTx(token.mint(user1.address, TOKEN_AMOUNT));
        await proveTx(connect(token, user1).approveFreezing());
        await proveTx(connect(token, pauser).pause());
        await expect(
          connect(token, blocklister).transferFrozen(user1.address, user2.address, TOKEN_AMOUNT)
        ).to.be.revertedWith(REVERT_MESSAGE_PAUSABLE_PAUSED);
      });

      it("There is a lack of frozen balance", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        await proveTx(token.mint(user1.address, TOKEN_AMOUNT));
        await proveTx(connect(token, user1).approveFreezing());
        await proveTx(connect(token, blocklister).freeze(user1.address, TOKEN_AMOUNT));
        await expect(
          connect(token, blocklister).transferFrozen(user1.address, user2.address, TOKEN_AMOUNT + 1)
        ).to.be.revertedWithCustomError(token, REVERT_ERROR_LACK_OF_FROZEN_BALANCE);
      });

      it("There is a lack of common balance", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        await proveTx(token.mint(user1.address, TOKEN_AMOUNT));
        await proveTx(connect(token, user1).approveFreezing());
        await proveTx(connect(token, blocklister).freeze(user1.address, TOKEN_AMOUNT + 1));
        await expect(
          connect(token, blocklister).transferFrozen(user1.address, user2.address, TOKEN_AMOUNT + 1)
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
        await proveTx(connect(token, user1).approveFreezing());
        await proveTx(connect(token, blocklister).freeze(user1.address, frozenBalanceBefore));
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

  describe("Function 'frozenIncrease()'", async () => {
    it("Increase frozen and emits the correct event", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);

      expect(await token.balanceOfFrozen(user1.address)).to.eq(0);

      await expect(connect(token, blocklister).frozenIncrease(user1.address, 100))
        .to.emit(token, EVENT_NAME_FROZEN_UPDATED)
        .withArgs(user1.address, 100, 0);
      expect(await token.balanceOfFrozen(user1.address)).to.eq(100);

      await expect(connect(token, blocklister).frozenIncrease(user1.address, 100))
        .to.emit(token, EVENT_NAME_FROZEN_UPDATED)
        .withArgs(user1.address, 200, 100);
      expect(await token.balanceOfFrozen(user1.address)).to.eq(200);
    });

    it("Is reverted if the caller is not a blocklister", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await expect(
        connect(token, user1).frozenIncrease(user2.address, 100)
      ).to.be.revertedWithCustomError(token, REVERT_ERROR_UNAUTHORIZED_BLOCKLISTER);
    });

    it("Is reverted if the provided account is zero", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await expect(
        connect(token, blocklister).frozenIncrease(ethers.ZeroAddress, 100)
      ).to.be.revertedWithCustomError(token, REVERT_ERROR_ZERO_ADDRESS);
    });

    it("Is reverted if the provided amount is zero", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await expect(
        connect(token, blocklister).frozenIncrease(user2.address, 0)
      ).to.be.revertedWithCustomError(token, REVERT_ERROR_ZERO_AMOUNT);
    });
  });

  describe("Function 'frozenDecrease()'", async () => {
    it("Decrease frozen and emits the correct event", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);

      await proveTx(connect(token, blocklister).frozenIncrease(user1.address, 200));

      await expect(connect(token, blocklister).frozenDecrease(user1.address, 100))
        .to.emit(token, EVENT_NAME_FROZEN_UPDATED)
        .withArgs(user1.address, 100, 200);
      expect(await token.balanceOfFrozen(user1.address)).to.eq(100);

      await expect(connect(token, blocklister).frozenDecrease(user1.address, 100))
        .to.emit(token, EVENT_NAME_FROZEN_UPDATED)
        .withArgs(user1.address, 0, 100);
      expect(await token.balanceOfFrozen(user1.address)).to.eq(0);
    });

    it("Is reverted if the caller is not a blocklister", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await expect(
        connect(token, user1).frozenDecrease(user1.address, 100)
      ).to.be.revertedWithCustomError(token, REVERT_ERROR_UNAUTHORIZED_BLOCKLISTER);
    });

    it("Is reverted if the provided account is zero", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await expect(
        connect(token, blocklister).frozenDecrease(ethers.ZeroAddress, 100)
      ).to.be.revertedWithCustomError(token, REVERT_ERROR_ZERO_ADDRESS);
    });

    it("Is reverted if the provided amount is zero", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await expect(
        connect(token, blocklister).frozenDecrease(user1.address, 0)
      ).to.be.revertedWithCustomError(token, REVERT_ERROR_ZERO_AMOUNT);
    });
  });
});
