import { ethers, network, upgrades } from "hardhat";
import { expect } from "chai";
import { BigNumber, Contract, ContractFactory } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";

async function setUpFixture(func: any) {
  if (network.name === "hardhat") {
    return loadFixture(func);
  } else {
    return func();
  }
}

describe("Contract 'InfinitePointsToken'", async () => {
  const TOKEN_NAME = "Infinite Points Coin";
  const TOKEN_SYMBOL = "OOO";
  const TOKEN_DECIMALS = 6;
  const TOTAL_SUPPLY = 1E9 * 1E6;

  const REVERT_MESSAGE_IF_CONTRACT_IS_ALREADY_INITIALIZED = "Initializable: contract is already initialized";

  let infinitePointsTokenFactory: ContractFactory;
  let deployer: SignerWithAddress;

  before(async () => {
    [deployer] = await ethers.getSigners();
    infinitePointsTokenFactory = await ethers.getContractFactory("InfinitePointsToken");
  });

  async function deployInfinitePointsToken(): Promise<{ infinitePointsToken: Contract }> {
    const infinitePointsToken: Contract = await upgrades.deployProxy(
      infinitePointsTokenFactory,
      [TOKEN_NAME, TOKEN_SYMBOL, TOTAL_SUPPLY]
    );
    await infinitePointsToken.deployed();
    return { infinitePointsToken };
  }

  describe("Function 'initialize()'", async () => {
    it("Configures the contract as expected", async () => {
      const { infinitePointsToken } = await setUpFixture(deployInfinitePointsToken);

      expect(await infinitePointsToken.owner()).to.equal(deployer.address);
      expect(await infinitePointsToken.pauser()).to.equal(ethers.constants.AddressZero);
      expect(await infinitePointsToken.rescuer()).to.equal(ethers.constants.AddressZero);
      expect(await infinitePointsToken.blacklister()).to.equal(ethers.constants.AddressZero);
      expect(await infinitePointsToken.decimals()).to.equal(TOKEN_DECIMALS);

      expect(await infinitePointsToken.balanceOf(deployer.address)).to.equal(BigNumber.from(TOTAL_SUPPLY));
    });

    it("Is reverted if it is called a second time", async () => {
      const { infinitePointsToken } = await setUpFixture(deployInfinitePointsToken);
      await expect(
        infinitePointsToken.initialize(TOKEN_NAME, TOKEN_SYMBOL, TOTAL_SUPPLY)
      ).to.be.revertedWith(REVERT_MESSAGE_IF_CONTRACT_IS_ALREADY_INITIALIZED);
    });

    it("Is reverted for the contract implementation if it is called even for the first time", async () => {
      const infinitePointsImplementation: Contract = await infinitePointsTokenFactory.deploy();
      await infinitePointsImplementation.deployed();

      await expect(
        infinitePointsImplementation.initialize(TOKEN_NAME, TOKEN_SYMBOL, TOTAL_SUPPLY)
      ).to.be.revertedWith(REVERT_MESSAGE_IF_CONTRACT_IS_ALREADY_INITIALIZED);
    });
  });
});
