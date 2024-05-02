import { ethers, network, upgrades } from "hardhat";
import { expect } from "chai";
import { Contract, ContractFactory } from "ethers";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { connect } from "../test-utils/eth";

async function setUpFixture<T>(func: () => Promise<T>): Promise<T> {
  if (network.name === "hardhat") {
    return loadFixture(func);
  } else {
    return func();
  }
}

describe("Contract 'USJimToken'", async () => {
  const TOKEN_NAME = "USJim Coin";
  const TOKEN_SYMBOL = "USJIM";
  const TOKEN_DECIMALS = 6;

  const REVERT_MESSAGE_INITIALIZABLE_CONTRACT_IS_ALREADY_INITIALIZED = "Initializable: contract is already initialized";

  let tokenFactory: ContractFactory;
  let deployer: HardhatEthersSigner;

  before(async () => {
    [deployer] = await ethers.getSigners();
    tokenFactory = await ethers.getContractFactory("USJimToken");
    tokenFactory = tokenFactory.connect(deployer); // Explicitly specifying the deployer account
  });

  async function deployToken(): Promise<{ token: Contract }> {
    let token: Contract = await upgrades.deployProxy(tokenFactory, [TOKEN_NAME, TOKEN_SYMBOL]);
    await token.waitForDeployment();
    token = connect(token, deployer); // Explicitly specifying the initial account
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
  });

  describe("Function 'isUSJim()'", async () => {
    it("Returns true", async () => {
      const { token } = await setUpFixture(deployToken);
      expect(await token.isUSJim()).to.eq(true);
    });
  });
});
