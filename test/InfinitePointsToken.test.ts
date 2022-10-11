import { ethers } from "hardhat";
import { expect } from "chai";
import { BigNumber, Contract, ContractFactory } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import { proveTx } from "../test-utils/eth";

describe("Contract 'InfinitePointsToken'", async () => {
  const TOKEN_NAME = "Infinite Points Coin";
  const TOKEN_SYMBOL = "OOO";
  const TOTAL_SUPPLY = 1E9 * 1E6;

  const REVERT_MESSAGE_IF_CONTRACT_IS_ALREADY_INITIALIZED = "Initializable: contract is already initialized";

  let infinitePointsToken: Contract;
  let deployer: SignerWithAddress;

  beforeEach(async () => {
    // Get user accounts
    [deployer] = await ethers.getSigners();

    // Deploy the contract under test
    const InfinitePointsToken: ContractFactory = await ethers.getContractFactory("InfinitePointsToken");
    infinitePointsToken = await InfinitePointsToken.deploy();
    await infinitePointsToken.deployed();
  });

  describe("Initialization and configuration", async () => {

    it("The initialize function can't be called more than once", async () => {
      await proveTx(infinitePointsToken.initialize(TOKEN_NAME, TOKEN_SYMBOL, TOTAL_SUPPLY));
      await expect(
        infinitePointsToken.initialize(TOKEN_NAME, TOKEN_SYMBOL, TOTAL_SUPPLY)
      ).to.be.revertedWith(REVERT_MESSAGE_IF_CONTRACT_IS_ALREADY_INITIALIZED);
    });

    it("The initial contract configuration should be as expected", async () => {
      await proveTx(infinitePointsToken.initialize(TOKEN_NAME, TOKEN_SYMBOL, TOTAL_SUPPLY));

      expect(await infinitePointsToken.owner()).to.equal(deployer.address);
      expect(await infinitePointsToken.pauser()).to.equal(ethers.constants.AddressZero);
      expect(await infinitePointsToken.rescuer()).to.equal(ethers.constants.AddressZero);
      expect(await infinitePointsToken.blacklister()).to.equal(ethers.constants.AddressZero);
      expect(await infinitePointsToken.decimals()).to.equal(6);

      expect(await infinitePointsToken.balanceOf(deployer.address)).to.equal(BigNumber.from(TOTAL_SUPPLY));
    });
  });
});
