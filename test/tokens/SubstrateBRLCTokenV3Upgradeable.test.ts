import { ethers, upgrades } from "hardhat";
import { expect } from "chai";
import { Contract, ContractFactory } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";

describe("Contract 'SubstrateBRLCTokenV3Upgradeable'", async () => {
  const TOKEN_NAME = "BRL Coin";
  const TOKEN_SYMBOL = "BRLC";
  const TOKEN_DECIMALS = 6;

  const REVERT_MESSAGE_IF_CONTRACT_IS_ALREADY_INITIALIZED = 'Initializable: contract is already initialized';

  let brlcToken: Contract;
  let deployer: SignerWithAddress;
  let user1: SignerWithAddress;
  let user2: SignerWithAddress;

  beforeEach(async () => {
    // Deploy the contract under test
    const BrlcToken: ContractFactory = await ethers.getContractFactory("SubstrateBRLCTokenV3Upgradeable");
    brlcToken = await upgrades.deployProxy(BrlcToken, [TOKEN_NAME, TOKEN_SYMBOL, TOKEN_DECIMALS]);
    await brlcToken.deployed();

    // Get user accounts
    [deployer, user1, user2] = await ethers.getSigners();
  });

  it("The initialize function can't be called more than once", async () => {
    await expect(brlcToken.initialize(TOKEN_NAME, TOKEN_SYMBOL, TOKEN_DECIMALS))
      .to.be.revertedWith(REVERT_MESSAGE_IF_CONTRACT_IS_ALREADY_INITIALIZED);
  });

  // All other checks are in the test files for the ancestor contracts
});
