import { ethers } from "hardhat";
import { expect } from "chai";
import { Contract, ContractFactory } from "ethers";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { connect, proveTx } from "../../test-utils/eth";
import { setUpFixture } from "../../test-utils/common";

describe("Contract 'ERC20TokenMock'", async () => {
  const TOKEN_NAME = "ERC20 Test";
  const TOKEN_SYMBOL = "TEST";
  const TOKEN_DECIMALS = 18;

  const MINT_AMOUNT = 100;

  let tokenFactory: ContractFactory;
  let deployer: HardhatEthersSigner;
  let user: HardhatEthersSigner;

  before(async () => {
    [deployer, user] = await ethers.getSigners();
    tokenFactory = await ethers.getContractFactory("ERC20TokenMock");
    tokenFactory = tokenFactory.connect(deployer); // Explicitly specifying the deployer account
  });

  async function deployToken(): Promise<{ token: Contract }> {
    let token = await tokenFactory.deploy(TOKEN_NAME, TOKEN_SYMBOL) as Contract;
    await token.waitForDeployment();
    token = connect(token, deployer); // Explicitly specifying the initial account
    return { token };
  }

  describe("Constructor", async () => {
    it("Configures the contract as expected", async () => {
      const { token } = await setUpFixture(deployToken);
      expect(await token.name()).to.equal(TOKEN_NAME);
      expect(await token.symbol()).to.equal(TOKEN_SYMBOL);
      expect(await token.decimals()).to.equal(TOKEN_DECIMALS);
    });
  });

  describe("Function 'mint()", async () => {
    it("Executes as expected and emits the correct events", async () => {
      const { token } = await setUpFixture(deployToken);
      expect(await token.balanceOf(user.address)).to.equal(0);
      await proveTx(connect(token, user).mint(user.address, MINT_AMOUNT));
      expect(await token.balanceOf(user.address)).to.equal(MINT_AMOUNT);
    });
  });
});
