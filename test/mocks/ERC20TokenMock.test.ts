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

describe("Contract 'ERC20TokenMock'", async () => {
  const TOKEN_NAME = "ERC20 Test";
  const TOKEN_SYMBOL = "TEST";
  const TOKEN_DECIMALS = 18;

  const MINT_AMOUNT = 100;

  const REVERT_MESSAGE_INITIALIZABLE_CONTRACT_IS_ALREADY_INITIALIZED = "Initializable: contract is already initialized";
  const REVERT_MESSAGE_INITIALIZABLE_CONTRACT_IS_NOT_INITIALIZING = "Initializable: contract is not initializing";

  let tokenFactory: ContractFactory;
  let deployer: HardhatEthersSigner;
  let user: HardhatEthersSigner;

  before(async () => {
    [deployer, user] = await ethers.getSigners();
    tokenFactory = await ethers.getContractFactory("ERC20TokenMock");
    tokenFactory = tokenFactory.connect(deployer); // Explicitly specifying the deployer account
  });

  async function deployToken(): Promise<{ token: Contract }> {
    const token: Contract = await upgrades.deployProxy(tokenFactory, [TOKEN_NAME, TOKEN_SYMBOL]);
    await token.waitForDeployment();
    connect(token, deployer); // Explicitly specifying the initial account
    return { token };
  }

  describe("Function 'initialize()'", async () => {
    it("Configures the contract as expected", async () => {
      const { token } = await setUpFixture(deployToken);
      expect(await token.name()).to.equal(TOKEN_NAME);
      expect(await token.symbol()).to.equal(TOKEN_SYMBOL);
      expect(await token.decimals()).to.equal(TOKEN_DECIMALS);
    });

    it("Is reverted if called for the second time", async () => {
      const { token } = await setUpFixture(deployToken);
      await expect(
        token.initialize(TOKEN_NAME, TOKEN_SYMBOL)
      ).to.be.revertedWith(REVERT_MESSAGE_INITIALIZABLE_CONTRACT_IS_ALREADY_INITIALIZED);
    });

    it("Is reverted if the implementation contract is called even for the first time", async () => {
      const tokenImplementation: Contract = (await tokenFactory.deploy()) as Contract;
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
        token.call_parent_initialize_unchained(TOKEN_NAME, TOKEN_SYMBOL)
      ).to.be.revertedWith(REVERT_MESSAGE_INITIALIZABLE_CONTRACT_IS_NOT_INITIALIZING);
    });
  });

  describe("Function 'mintForTest()", async () => {
    it("Executes as expected and emits the correct events", async () => {
      const { token } = await setUpFixture(deployToken);
      expect(await token.balanceOf(user.address)).to.equal(0);
      await proveTx(connect(token, user).mintForTest(user.address, MINT_AMOUNT));
      expect(await token.balanceOf(user.address)).to.equal(MINT_AMOUNT);
    });
  });
});
