import { ethers, network, upgrades } from "hardhat";
import { expect } from "chai";
import { Contract, ContractFactory } from "ethers";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { connect, proveTx } from "../test-utils/eth";

async function setUpFixture<T>(func: () => Promise<T>): Promise<T> {
  if (network.name === "hardhat") {
    return loadFixture(func);
  } else {
    return func();
  }
}

describe("Contract 'BRLCTokenBridgeable'", async () => {
  const TOKEN_NAME = "BRL Coin";
  const TOKEN_SYMBOL = "BRLC";
  const TOKEN_DECIMALS = 6;

  const REVERT_MESSAGE_INITIALIZABLE_CONTRACT_IS_ALREADY_INITIALIZED = "Initializable: contract is already initialized";

  let tokenFactory: ContractFactory;
  let deployer: HardhatEthersSigner;
  let bridge: HardhatEthersSigner;

  before(async () => {
    [deployer, bridge] = await ethers.getSigners();
    tokenFactory = await ethers.getContractFactory("BRLCTokenBridgeable");
    tokenFactory = tokenFactory.connect(deployer); // Explicitly specifying the deployer account
  });

  async function deployToken(): Promise<{ token: Contract }> {
    let token: Contract = await upgrades.deployProxy(
      tokenFactory,
      [TOKEN_NAME, TOKEN_SYMBOL, bridge.address]
    ) as Contract;
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
      expect(await token.isBridgeSupported(bridge.address)).to.equal(true);
      expect(await token.isIERC20Bridgeable()).to.equal(true);
      expect(await token.bridge()).to.equal(bridge.address);
    });

    it("Is reverted if called for the second time", async () => {
      const { token } = await setUpFixture(deployToken);
      await expect(
        token.initialize(TOKEN_NAME, TOKEN_SYMBOL, bridge.address)
      ).to.be.revertedWith(REVERT_MESSAGE_INITIALIZABLE_CONTRACT_IS_ALREADY_INITIALIZED);
    });

    it("Is reverted if the contract implementation is called even for the first time", async () => {
      const tokenImplementation: Contract = await tokenFactory.deploy() as Contract;
      await tokenImplementation.waitForDeployment();
      await expect(
        tokenImplementation.initialize(TOKEN_NAME, TOKEN_SYMBOL, bridge.address)
      ).to.be.revertedWith(REVERT_MESSAGE_INITIALIZABLE_CONTRACT_IS_ALREADY_INITIALIZED);
    });
  });

  describe("Function 'transfer()'", async () => {
    it("Executes as expected", async () => {
      const { token } = await setUpFixture(deployToken);
      const amount = 123456789;
      await proveTx(connect(token, bridge).mintForBridging(deployer.address, amount));
      const tx = token.transfer(bridge.address, amount);
      expect(tx).to.changeTokenBalances(
        token,
        [deployer, bridge],
        [-amount, +amount]
      );
    });
  });

  describe("Function 'isBRLCoin'", async () => {
    it("Returns true", async () => {
      const { token } = await setUpFixture(deployToken);
      expect(await token.isBRLCoin()).to.eq(true);
    });
  });
});
