import { ethers, upgrades } from "hardhat";
import { expect } from "chai";
import { Contract, ContractFactory } from "ethers";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { connect } from "../test-utils/eth";
import { setUpFixture } from "../test-utils/common";

describe("Contract 'USJimToken'", async () => {
  const TOKEN_NAME = "USJim Coin";
  const TOKEN_SYMBOL = "USJIM";
  const TOKEN_DECIMALS = 6;

  const REVERT_ERROR_CONTRACT_INITIALIZATION_IS_INVALID = "InvalidInitialization";

  const OWNER_ROLE: string = ethers.id("OWNER_ROLE");
  const GRANTOR_ROLE: string = ethers.id("GRANTOR_ROLE");
  const PAUSER_ROLE: string = ethers.id("PAUSER_ROLE");
  const RESCUER_ROLE: string = ethers.id("RESCUER_ROLE");
  const MINTER_ORDINARY_ROLE: string = ethers.id("MINTER_ORDINARY_ROLE");
  const BURNER_ORDINARY_ROLE: string = ethers.id("BURNER_ORDINARY_ROLE");
  const MINTER_RESERVE_ROLE: string = ethers.id("MINTER_RESERVE_ROLE");
  const BURNER_RESERVE_ROLE: string = ethers.id("BURNER_RESERVE_ROLE");
  const PREMINTER_AGENT_ROLE: string = ethers.id("PREMINTER_AGENT_ROLE");
  const PREMINTER_RESCHEDULER_ROLE: string = ethers.id("PREMINTER_RESCHEDULER_ROLE");
  const FREEZER_AGENT_ROLE: string = ethers.id("FREEZER_AGENT_ROLE");
  const FREEZER_TRANSFEROR_ROLE: string = ethers.id("FREEZER_TRANSFEROR_ROLE");
  const TRUSTED_SPENDER_ROLE: string = ethers.id("TRUSTED_SPENDER_ROLE");

  let tokenFactory: ContractFactory;
  let deployer: HardhatEthersSigner;

  before(async () => {
    [deployer] = await ethers.getSigners();
    tokenFactory = await ethers.getContractFactory("USJimToken");
    tokenFactory = tokenFactory.connect(deployer); // Explicitly specifying the deployer account
  });

  async function deployToken(): Promise<{ token: Contract }> {
    let token: Contract = await upgrades.deployProxy(
      tokenFactory,
      [TOKEN_NAME, TOKEN_SYMBOL],
      { unsafeSkipProxyAdminCheck: true } // This is necessary to run tests on other networks
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

      // The role hashes
      expect(await token.OWNER_ROLE()).to.equal(OWNER_ROLE);
      expect(await token.GRANTOR_ROLE()).to.equal(GRANTOR_ROLE);
      expect(await token.PAUSER_ROLE()).to.equal(PAUSER_ROLE);
      expect(await token.RESCUER_ROLE()).to.equal(RESCUER_ROLE);
      expect(await token.MINTER_ORDINARY_ROLE()).to.equal(MINTER_ORDINARY_ROLE);
      expect(await token.BURNER_ORDINARY_ROLE()).to.equal(BURNER_ORDINARY_ROLE);
      expect(await token.MINTER_RESERVE_ROLE()).to.equal(MINTER_RESERVE_ROLE);
      expect(await token.BURNER_RESERVE_ROLE()).to.equal(BURNER_RESERVE_ROLE);
      expect(await token.PREMINTER_AGENT_ROLE()).to.equal(PREMINTER_AGENT_ROLE);
      expect(await token.PREMINTER_RESCHEDULER_ROLE()).to.equal(PREMINTER_RESCHEDULER_ROLE);
      expect(await token.FREEZER_AGENT_ROLE()).to.equal(FREEZER_AGENT_ROLE);
      expect(await token.FREEZER_TRANSFEROR_ROLE()).to.equal(FREEZER_TRANSFEROR_ROLE);
      expect(await token.TRUSTED_SPENDER_ROLE()).to.equal(TRUSTED_SPENDER_ROLE);

      // The role admins
      expect(await token.getRoleAdmin(OWNER_ROLE)).to.equal(OWNER_ROLE);
      expect(await token.getRoleAdmin(GRANTOR_ROLE)).to.equal(OWNER_ROLE);
      expect(await token.getRoleAdmin(PAUSER_ROLE)).to.equal(GRANTOR_ROLE);
      expect(await token.getRoleAdmin(RESCUER_ROLE)).to.equal(GRANTOR_ROLE);
      expect(await token.getRoleAdmin(MINTER_ORDINARY_ROLE)).to.equal(GRANTOR_ROLE);
      expect(await token.getRoleAdmin(BURNER_ORDINARY_ROLE)).to.equal(GRANTOR_ROLE);
      expect(await token.getRoleAdmin(MINTER_RESERVE_ROLE)).to.equal(GRANTOR_ROLE);
      expect(await token.getRoleAdmin(BURNER_RESERVE_ROLE)).to.equal(GRANTOR_ROLE);
      expect(await token.getRoleAdmin(PREMINTER_AGENT_ROLE)).to.equal(GRANTOR_ROLE);
      expect(await token.getRoleAdmin(PREMINTER_RESCHEDULER_ROLE)).to.equal(GRANTOR_ROLE);
      expect(await token.getRoleAdmin(FREEZER_AGENT_ROLE)).to.equal(GRANTOR_ROLE);
      expect(await token.getRoleAdmin(FREEZER_TRANSFEROR_ROLE)).to.equal(GRANTOR_ROLE);
      expect(await token.getRoleAdmin(TRUSTED_SPENDER_ROLE)).to.equal(GRANTOR_ROLE);

      // The deployer should have the owner role, but not the other roles
      expect(await token.hasRole(OWNER_ROLE, deployer.address)).to.equal(true);
      expect(await token.hasRole(GRANTOR_ROLE, deployer.address)).to.equal(false);
      expect(await token.hasRole(PAUSER_ROLE, deployer.address)).to.equal(false);
      expect(await token.hasRole(RESCUER_ROLE, deployer.address)).to.equal(false);
      expect(await token.hasRole(MINTER_ORDINARY_ROLE, deployer.address)).to.equal(false);
      expect(await token.hasRole(BURNER_ORDINARY_ROLE, deployer.address)).to.equal(false);
      expect(await token.hasRole(MINTER_RESERVE_ROLE, deployer.address)).to.equal(false);
      expect(await token.hasRole(BURNER_RESERVE_ROLE, deployer.address)).to.equal(false);
      expect(await token.hasRole(PREMINTER_AGENT_ROLE, deployer.address)).to.equal(false);
      expect(await token.hasRole(PREMINTER_RESCHEDULER_ROLE, deployer.address)).to.equal(false);
      expect(await token.hasRole(FREEZER_AGENT_ROLE, deployer.address)).to.equal(false);
      expect(await token.hasRole(FREEZER_TRANSFEROR_ROLE, deployer.address)).to.equal(false);
      expect(await token.hasRole(TRUSTED_SPENDER_ROLE, deployer.address)).to.equal(false);
    });

    it("Is reverted if called for the second time", async () => {
      const { token } = await setUpFixture(deployToken);
      await expect(
        token.initialize(TOKEN_NAME, TOKEN_SYMBOL)
      ).to.be.revertedWithCustomError(token, REVERT_ERROR_CONTRACT_INITIALIZATION_IS_INVALID);
    });

    it("Is reverted if the contract implementation is called even for the first time", async () => {
      const tokenImplementation: Contract = await tokenFactory.deploy() as Contract;
      await tokenImplementation.waitForDeployment();
      await expect(
        tokenImplementation.initialize(TOKEN_NAME, TOKEN_SYMBOL)
      ).to.be.revertedWithCustomError(tokenImplementation, REVERT_ERROR_CONTRACT_INITIALIZATION_IS_INVALID);
    });
  });

  describe("Function 'isUSJim()'", async () => {
    it("Returns true", async () => {
      const { token } = await setUpFixture(deployToken);
      expect(await token.isUSJim()).to.eq(true);
    });
  });
});
