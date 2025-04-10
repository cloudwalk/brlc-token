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

describe("Contract 'ERC20Base'", async () => {
  const TOKEN_NAME = "BRL Coin";
  const TOKEN_SYMBOL = "BRLC";
  const TOKEN_DECIMALS = 6;

  const TOKEN_AMOUNT: number = 100;
  const TOKEN_ALLOWANCE: number = 200;

  const EVENT_NAME_APPROVAL = "Approval";
  const EVENT_NAME_TRANSFER = "Transfer";

  const REVERT_MESSAGE_INITIALIZABLE_CONTRACT_IS_ALREADY_INITIALIZED = "Initializable: contract is already initialized";
  const REVERT_MESSAGE_INITIALIZABLE_CONTRACT_IS_NOT_INITIALIZING = "Initializable: contract is not initializing";
  const REVERT_MESSAGE_PAUSABLE_PAUSED = "Pausable: paused";

  let tokenFactory: ContractFactory;
  let deployer: HardhatEthersSigner;
  let pauser: HardhatEthersSigner;
  let user1: HardhatEthersSigner;
  let user2: HardhatEthersSigner;

  before(async () => {
    [deployer, pauser, user1, user2] = await ethers.getSigners();
    tokenFactory = await ethers.getContractFactory("ERC20BaseMock");
    tokenFactory = tokenFactory.connect(deployer); // Explicitly specifying the deployer account
  });

  async function deployToken(): Promise<{ token: Contract }> {
    let token: Contract = await upgrades.deployProxy(tokenFactory, [TOKEN_NAME, TOKEN_SYMBOL]) as Contract;
    await token.waitForDeployment();
    token = connect(token, deployer); // Explicitly specifying the initial account
    return { token };
  }

  async function deployAndConfigureToken(): Promise<{ token: Contract }> {
    const { token } = await deployToken();
    await proveTx(token.setPauser(pauser.address));
    return { token };
  }

  describe("Function 'initialize()'", async () => {
    it("Configures the contract as expected", async () => {
      const { token } = await setUpFixture(deployToken);
      expect(await token.name()).to.equal(TOKEN_NAME);
      expect(await token.symbol()).to.equal(TOKEN_SYMBOL);
      expect(await token.decimals()).to.equal(TOKEN_DECIMALS);
      expect(await token.owner()).to.equal(deployer.address);
      expect(await token.pauser()).to.equal(ethers.ZeroAddress);
      expect(await token.rescuer()).to.equal(ethers.ZeroAddress);
    });

    it("Is reverted if called for the second time", async () => {
      const { token } = await setUpFixture(deployToken);
      await expect(
        token.initialize(TOKEN_NAME, TOKEN_SYMBOL)
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

  describe("Function 'transfer()'", async () => {
    it("Executes as expected and emits the correct event", async () => {
      const { token } = await setUpFixture(deployToken);
      await proveTx(token.mintForTest(user1.address, TOKEN_AMOUNT));
      const tx = connect(token, user1).transfer(user2.address, TOKEN_AMOUNT);
      await expect(tx).to.changeTokenBalances(
        token,
        [user1, user2, token],
        [-TOKEN_AMOUNT, TOKEN_AMOUNT, 0]
      );
      await expect(tx)
        .to.emit(token, EVENT_NAME_TRANSFER)
        .withArgs(user1.address, user2.address, TOKEN_AMOUNT);
    });

    it("Is reverted if the contract is paused", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.mintForTest(user1.address, TOKEN_AMOUNT));
      await proveTx(connect(token, pauser).pause());
      await expect(
        connect(token, user1).transfer(user2.address, TOKEN_AMOUNT)
      ).to.be.revertedWith(REVERT_MESSAGE_PAUSABLE_PAUSED);
    });
  });

  describe("Function 'approve()'", async () => {
    it("Executes as expected and emits the correct event", async () => {
      const { token } = await setUpFixture(deployToken);
      const oldAllowance: bigint = await token.allowance(user1.address, user2.address);
      const newExpectedAllowance: bigint = oldAllowance + BigInt(TOKEN_ALLOWANCE);
      await expect(connect(token, user1).approve(user2.address, TOKEN_ALLOWANCE))
        .to.emit(token, EVENT_NAME_APPROVAL)
        .withArgs(user1.address, user2.address, TOKEN_ALLOWANCE);
      const newActualAllowance = await token.allowance(user1.address, user2.address);
      expect(newActualAllowance).to.equal(newExpectedAllowance);
    });

    it("Is reverted if the contract is paused", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(connect(token, pauser).pause());
      await expect(
        connect(token, user1).approve(user2.address, TOKEN_ALLOWANCE)
      ).to.be.revertedWith(REVERT_MESSAGE_PAUSABLE_PAUSED);
    });
  });

  describe("Function 'transferFrom()'", async () => {
    it("Executes as expected and emits the correct event", async () => {
      const { token } = await setUpFixture(deployToken);
      await proveTx(token.mintForTest(user1.address, TOKEN_AMOUNT));
      await proveTx(connect(token, user1).approve(user2.address, TOKEN_AMOUNT));
      const tx = connect(token, user2).transferFrom(user1.address, user2.address, TOKEN_AMOUNT);
      await expect(tx).to.changeTokenBalances(
        token,
        [user1, user2],
        [-TOKEN_AMOUNT, TOKEN_AMOUNT]
      );
      await expect(tx)
        .to.emit(token, EVENT_NAME_TRANSFER)
        .withArgs(user1.address, user2.address, TOKEN_AMOUNT);
    });

    it("Is reverted if the contract is paused", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.mintForTest(user1.address, TOKEN_AMOUNT));
      await proveTx(connect(token, user1).approve(user2.address, TOKEN_AMOUNT));
      await proveTx(connect(token, pauser).pause());
      await expect(
        connect(token, user2).transferFrom(user1.address, user2.address, TOKEN_AMOUNT)
      ).to.be.revertedWith(REVERT_MESSAGE_PAUSABLE_PAUSED);
    });
  });

  describe("Function 'increaseAllowance()'", async () => {
    const initialAllowance: number = TOKEN_ALLOWANCE;
    const allowanceAddedValue: number = TOKEN_ALLOWANCE + 1;

    it("Executes as expected and emits the correct event", async () => {
      const { token } = await setUpFixture(deployToken);
      await proveTx(connect(token, user1).approve(user2.address, initialAllowance));
      const oldAllowance: bigint = await token.allowance(user1.address, user2.address);
      const newExpectedAllowance: bigint = oldAllowance + BigInt(allowanceAddedValue);
      await expect(connect(token, user1).increaseAllowance(user2.address, allowanceAddedValue))
        .to.emit(token, EVENT_NAME_APPROVAL)
        .withArgs(user1.address, user2.address, initialAllowance + allowanceAddedValue);
      const newActualAllowance = await token.allowance(user1.address, user2.address);
      expect(newActualAllowance).to.equal(newExpectedAllowance);
    });

    it("Is reverted if the contract is paused", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(connect(token, pauser).pause());
      await expect(
        token.increaseAllowance(user1.address, allowanceAddedValue)
      ).to.be.revertedWith(REVERT_MESSAGE_PAUSABLE_PAUSED);
    });
  });

  describe("Function 'decreaseAllowance()'", async () => {
    const initialAllowance: number = TOKEN_ALLOWANCE + 1;
    const allowanceSubtractedValue: number = TOKEN_ALLOWANCE;

    it("Executes as expected and emits the correct event", async () => {
      const { token } = await setUpFixture(deployToken);
      await proveTx(connect(token, user1).approve(user2.address, initialAllowance));
      const oldAllowance: bigint = await token.allowance(user1.address, user2.address);
      const newExpectedAllowance: bigint = oldAllowance - BigInt(allowanceSubtractedValue);
      await expect(connect(token, user1).decreaseAllowance(user2.address, allowanceSubtractedValue))
        .to.emit(token, EVENT_NAME_APPROVAL)
        .withArgs(user1.address, user2.address, initialAllowance - allowanceSubtractedValue);
      const newActualAllowance = await token.allowance(user1.address, user2.address);
      expect(newActualAllowance).to.equal(newExpectedAllowance);
    });

    it("Is reverted if the contract is paused", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(connect(token, user1).approve(user2.address, initialAllowance));
      await proveTx(connect(token, pauser).pause());
      await expect(
        connect(token, user1).decreaseAllowance(user2.address, allowanceSubtractedValue)
      ).to.be.revertedWith(REVERT_MESSAGE_PAUSABLE_PAUSED);
    });
  });
});
