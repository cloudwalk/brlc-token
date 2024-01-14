import { ethers, network, upgrades } from "hardhat";
import { expect } from "chai";
import { Contract, ContractFactory } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { proveTx } from "../../test-utils/eth";

async function setUpFixture(func: any) {
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

  const REVERT_MESSAGE_INITIALIZABLE_CONTRACT_IS_ALREADY_INITIALIZED = "Initializable: contract is already initialized";
  const REVERT_MESSAGE_INITIALIZABLE_CONTRACT_IS_NOT_INITIALIZING = "Initializable: contract is not initializing";
  const REVERT_MESSAGE_ERC20_TRANSFER_AMOUNT_EXCEEDS_BALANCE = "ERC20: transfer amount exceeds balance";
  const REVERT_MESSAGE_PAUSABLE_PAUSED = "Pausable: paused";

  const REVERT_ERROR_UNAUTHORIZED_BLOCKLISTER = "UnauthorizedBlocklister";
  const REVERT_ERROR_FREEZING_ALREADY_APPROVED = "FreezingAlreadyApproved";
  const REVERT_ERROR_FREEZING_NOT_APPROVED = "FreezingNotApproved";
  const REVERT_ERROR_LACK_OF_FROZEN_BALANCE = "LackOfFrozenBalance";
  const REVERT_ERROR_TRANSFER_EXCEEDED_FROZEN_AMOUNT = "TransferExceededFrozenAmount";

  let tokenFactory: ContractFactory;
  let deployer: SignerWithAddress;
  let pauser: SignerWithAddress;
  let blocklister: SignerWithAddress;
  let user1: SignerWithAddress;
  let user2: SignerWithAddress;

  before(async () => {
    [deployer, pauser, blocklister, user1, user2] = await ethers.getSigners();
    tokenFactory = await ethers.getContractFactory("ERC20FreezableMock");
  });

  async function deployToken(): Promise<{ token: Contract }> {
    const token: Contract = await upgrades.deployProxy(tokenFactory, [TOKEN_NAME, TOKEN_SYMBOL]);
    await token.deployed();
    return { token };
  }

  async function deployAndConfigureToken(): Promise<{ token: Contract }> {
    const { token } = await deployToken();
    await proveTx(token.connect(deployer).setPauser(pauser.address));
    await proveTx(token.connect(deployer).setMainBlocklister(blocklister.address));
    return { token };
  }

  describe("Function 'initialize()'", async () => {
    it("Configures the contract as expected", async () => {
      const { token } = await setUpFixture(deployToken);
      expect(await token.owner()).to.equal(deployer.address);
      expect(await token.pauser()).to.equal(ethers.constants.AddressZero);
      expect(await token.mainBlocklister()).to.equal(ethers.constants.AddressZero);
    });

    it("Is reverted if called for the second time", async () => {
      const { token } = await setUpFixture(deployToken);
      await expect(
        token.initialize(TOKEN_NAME, TOKEN_SYMBOL)
      ).to.be.revertedWith(REVERT_MESSAGE_INITIALIZABLE_CONTRACT_IS_ALREADY_INITIALIZED);
    });

    it("Is reverted if the contract implementation is called even for the first time", async () => {
      const tokenImplementation: Contract = await tokenFactory.deploy();
      await tokenImplementation.deployed();
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
      await expect(token.connect(user1).approveFreezing())
        .to.emit(token, EVENT_NAME_FREEZE_APPROVAL)
        .withArgs(user1.address);
      expect(await token.freezeApproval(user1.address)).to.eq(true);
    });

    it("Is reverted if freezing is already approved", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.connect(user1).approveFreezing());
      await expect(
        token.connect(user1).approveFreezing()
      ).to.be.revertedWithCustomError(token, REVERT_ERROR_FREEZING_ALREADY_APPROVED);
    });

    it("Is reverted if contract is paused", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.connect(pauser).pause());
      await expect(token.connect(user1).approveFreezing()).to.be.revertedWith(REVERT_MESSAGE_PAUSABLE_PAUSED);
    });
  });

  describe("Function 'freeze()'", async () => {
    it("Freezes tokens and emits the correct events", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.connect(user1).approveFreezing());
      expect(await token.balanceOf(user1.address)).to.eq(ethers.constants.Zero);
      await expect(token.connect(blocklister).freeze(user1.address, TOKEN_AMOUNT))
        .to.emit(token, EVENT_NAME_FREEZE)
        .withArgs(user1.address, TOKEN_AMOUNT, 0);
      expect(await token.balanceOfFrozen(user1.address)).to.eq(TOKEN_AMOUNT);
      await proveTx(token.connect(deployer).mint(user1.address, TOKEN_AMOUNT));
      expect(await token.balanceOf(user1.address)).to.eq(TOKEN_AMOUNT);
      await expect(token.connect(blocklister).freeze(user1.address, TOKEN_AMOUNT + 1))
        .to.emit(token, EVENT_NAME_FREEZE)
        .withArgs(user1.address, TOKEN_AMOUNT + 1, TOKEN_AMOUNT);
      expect(await token.balanceOfFrozen(user1.address)).to.eq(TOKEN_AMOUNT + 1);
      await expect(token.connect(blocklister).freeze(user1.address, TOKEN_AMOUNT - 2))
        .to.emit(token, EVENT_NAME_FREEZE)
        .withArgs(user1.address, TOKEN_AMOUNT - 2, TOKEN_AMOUNT + 1);
      expect(await token.balanceOfFrozen(user1.address)).to.eq(TOKEN_AMOUNT - 2);
    });

    it("Is reverted if freezing is not approved", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      expect(await token.freezeApproval(user1.address)).to.eq(false);
      await expect(
        token.connect(blocklister).freeze(user1.address, TOKEN_AMOUNT)
      ).to.be.revertedWithCustomError(token, REVERT_ERROR_FREEZING_NOT_APPROVED);
    });

    it("Is reverted if contract is paused", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.connect(pauser).pause());
      await expect(
        token.connect(blocklister).freeze(user1.address, TOKEN_AMOUNT)
      ).to.be.revertedWith(REVERT_MESSAGE_PAUSABLE_PAUSED);
    });

    it("Is reverted if the caller is not a blocklister", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await expect(token.connect(user1).freeze(user2.address, TOKEN_AMOUNT))
        .to.be.revertedWithCustomError(token, REVERT_ERROR_UNAUTHORIZED_BLOCKLISTER)
        .withArgs(user1.address);
    });
  });

  describe("Function 'transferFrozen()'", async () => {
    it("Transfers frozen tokens and emits correct events", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.connect(user1).approveFreezing());
      await proveTx(token.connect(deployer).mint(user1.address, TOKEN_AMOUNT));
      await proveTx(token.connect(blocklister).freeze(user1.address, TOKEN_AMOUNT));
      await expect(token.connect(blocklister).transferFrozen(user1.address, user2.address, TOKEN_AMOUNT))
        .to.emit(token, EVENT_NAME_FREEZE_TRANSFER)
        .withArgs(user1.address, TOKEN_AMOUNT)
        .to.emit(token, EVENT_NAME_FREEZE)
        .withArgs(user1.address, TOKEN_AMOUNT, 0)
        .to.changeTokenBalances(token, [user1, user2], [-TOKEN_AMOUNT, TOKEN_AMOUNT]);
    });

    it("Is reverted if the caller is not a blocklister", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.connect(user1).approveFreezing());
      await proveTx(token.connect(deployer).mint(user1.address, TOKEN_AMOUNT));
      await expect(token.connect(user2).transferFrozen(user1.address, user2.address, TOKEN_AMOUNT))
        .to.be.revertedWithCustomError(token, REVERT_ERROR_UNAUTHORIZED_BLOCKLISTER)
        .withArgs(user2.address);
    });

    it("Is reverted if the contract is paused", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.connect(user1).approveFreezing());
      await proveTx(token.connect(deployer).mint(user1.address, TOKEN_AMOUNT));
      await proveTx(token.connect(pauser).pause());
      await expect(
        token.connect(blocklister).transferFrozen(user1.address, user2.address, TOKEN_AMOUNT)
      ).to.be.revertedWith(REVERT_MESSAGE_PAUSABLE_PAUSED);
    });

    it("Is reverted if there is a lack of frozen balance", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.connect(user1).approveFreezing());
      await proveTx(token.connect(deployer).mint(user1.address, TOKEN_AMOUNT));
      await proveTx(token.connect(blocklister).freeze(user1.address, TOKEN_AMOUNT));
      await expect(
        token.connect(blocklister).transferFrozen(user1.address, user2.address, TOKEN_AMOUNT + 1)
      ).to.be.revertedWithCustomError(token, REVERT_ERROR_LACK_OF_FROZEN_BALANCE);
    });

    it("Is reverted if there is a lack of common balance", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.connect(user1).approveFreezing());
      await proveTx(token.connect(deployer).mint(user1.address, TOKEN_AMOUNT));
      await proveTx(token.connect(blocklister).freeze(user1.address, TOKEN_AMOUNT + 1));
      await expect(
        token.connect(blocklister).transferFrozen(user1.address, user2.address, TOKEN_AMOUNT + 1)
      ).to.be.revertedWith(REVERT_MESSAGE_ERC20_TRANSFER_AMOUNT_EXCEEDS_BALANCE);
    });
  });

  describe("Frozen token scenarios", async () => {
    it("Tokens above the frozen balance can be transferred successfully", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.connect(user1).approveFreezing());
      await proveTx(token.connect(deployer).mint(user1.address, TOKEN_AMOUNT + 1));
      await proveTx(token.connect(blocklister).freeze(user1.address, TOKEN_AMOUNT));
      await expect(
        token.connect(user1).transfer(user2.address, 1)
      ).to.changeTokenBalances(
        token,
        [user1, user2],
        [-1, 1]
      );
    });

    it("Tokens below the frozen balance cannot be transferred successfully", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.connect(user1).approveFreezing());
      await proveTx(token.connect(deployer).mint(user1.address, TOKEN_AMOUNT + 1));
      await proveTx(token.connect(blocklister).freeze(user1.address, TOKEN_AMOUNT));
      await expect(
        token.connect(user1).transfer(user2.address, 2)
      ).to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_FROZEN_AMOUNT);
    });
  });
});
