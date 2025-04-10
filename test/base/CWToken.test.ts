import { ethers, network, upgrades } from "hardhat";
import { expect } from "chai";
import { Contract, ContractFactory } from "ethers";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { connect } from "../../test-utils/eth";

interface Version {
  major: number;
  minor: number;
  patch: number;

  [key: string]: number; // Indexing signature to ensure that fields are iterated over in a key-value style
}

async function setUpFixture<T>(func: () => Promise<T>): Promise<T> {
  if (network.name === "hardhat") {
    return loadFixture(func);
  } else {
    return func();
  }
}

describe("Contract 'CWToken'", async () => {
  const TOKEN_NAME = "CW Token";
  const TOKEN_SYMBOL = "CWT";
  const TOKEN_DECIMALS = 6;
  const EXPECTED_VERSION: Version = {
    major: 1,
    minor: 2,
    patch: 0
  };
  const REVERT_MESSAGE_INITIALIZABLE_CONTRACT_IS_ALREADY_INITIALIZED = "Initializable: contract is already initialized";
  const REVERT_MESSAGE_INITIALIZABLE_CONTRACT_IS_NOT_INITIALIZING = "Initializable: contract is not initializing";

  let tokenFactory: ContractFactory;
  let deployer: HardhatEthersSigner;

  before(async () => {
    [deployer] = await ethers.getSigners();
    tokenFactory = await ethers.getContractFactory("CWTokenMock");
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

  describe("Function '$__VERSION()'", async () => {
    it("Returns expected values", async () => {
      const { token } = await setUpFixture(deployToken);
      const tokenVersion = await token.$__VERSION();
      Object.keys(EXPECTED_VERSION).forEach(property => {
        const value = tokenVersion[property];
        if (typeof value === "undefined" || typeof value === "function" || typeof value === "object") {
          throw Error(`Property "${property}" is not found`);
        }
        expect(value).to.eq(
          EXPECTED_VERSION[property],
          `Mismatch in the "${property}" property`
        );
      });
    });
  });
});
