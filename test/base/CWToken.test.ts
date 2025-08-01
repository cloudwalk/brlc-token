import { ethers, upgrades } from "hardhat";
import { expect } from "chai";
import { Contract, ContractFactory } from "ethers";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { connect } from "../../test-utils/eth";
import { setUpFixture } from "../../test-utils/common";

interface Version {
  major: number;
  minor: number;
  patch: number;

  [key: string]: number; // Indexing signature to ensure that fields are iterated over in a key-value style
}

describe("Contract 'CWToken'", async () => {
  const TOKEN_NAME = "CW Token";
  const TOKEN_SYMBOL = "CWT";
  const TOKEN_DECIMALS = 6;
  const EXPECTED_VERSION: Version = {
    major: 1,
    minor: 5,
    patch: 2
  };

  // Errors of the lib contracts
  const ERROR_NAME_INVALID_INITIALIZATION = "InvalidInitialization";
  const ERROR_NAME_NOT_INITIALIZING = "NotInitializing";

  const OWNER_ROLE: string = ethers.id("OWNER_ROLE");
  const GRANTOR_ROLE: string = ethers.id("GRANTOR_ROLE");
  const PAUSER_ROLE: string = ethers.id("PAUSER_ROLE");
  const RESCUER_ROLE: string = ethers.id("RESCUER_ROLE");
  const MINTER_ROLE: string = ethers.id("MINTER_ROLE");
  const BURNER_ROLE: string = ethers.id("BURNER_ROLE");
  const RESERVE_MINTER_ROLE: string = ethers.id("RESERVE_MINTER_ROLE");
  const RESERVE_BURNER_ROLE: string = ethers.id("RESERVE_BURNER_ROLE");
  const PREMINT_MANAGER_ROLE: string = ethers.id("PREMINT_MANAGER_ROLE");
  const PREMINT_SCHEDULER_ROLE: string = ethers.id("PREMINT_SCHEDULER_ROLE");
  const BALANCE_FREEZER_ROLE: string = ethers.id("BALANCE_FREEZER_ROLE");
  const FROZEN_TRANSFEROR_ROLE: string = ethers.id("FROZEN_TRANSFEROR_ROLE");
  const TRUSTED_SPENDER_ROLE: string = ethers.id("TRUSTED_SPENDER_ROLE");

  let tokenFactory: ContractFactory;
  let deployer: HardhatEthersSigner;

  before(async () => {
    [deployer] = await ethers.getSigners();
    tokenFactory = await ethers.getContractFactory("CWTokenMock");
    tokenFactory = tokenFactory.connect(deployer); // Explicitly specifying the deployer account
  });

  async function deployToken(): Promise<{ token: Contract }> {
    let token = await upgrades.deployProxy(
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
      expect(await token.MINTER_ROLE()).to.equal(MINTER_ROLE);
      expect(await token.BURNER_ROLE()).to.equal(BURNER_ROLE);
      expect(await token.RESERVE_MINTER_ROLE()).to.equal(RESERVE_MINTER_ROLE);
      expect(await token.RESERVE_BURNER_ROLE()).to.equal(RESERVE_BURNER_ROLE);
      expect(await token.PREMINT_MANAGER_ROLE()).to.equal(PREMINT_MANAGER_ROLE);
      expect(await token.PREMINT_SCHEDULER_ROLE()).to.equal(PREMINT_SCHEDULER_ROLE);
      expect(await token.BALANCE_FREEZER_ROLE()).to.equal(BALANCE_FREEZER_ROLE);
      expect(await token.FROZEN_TRANSFEROR_ROLE()).to.equal(FROZEN_TRANSFEROR_ROLE);
      expect(await token.TRUSTED_SPENDER_ROLE()).to.equal(TRUSTED_SPENDER_ROLE);

      // The role admins
      expect(await token.getRoleAdmin(OWNER_ROLE)).to.equal(OWNER_ROLE);
      expect(await token.getRoleAdmin(GRANTOR_ROLE)).to.equal(OWNER_ROLE);
      expect(await token.getRoleAdmin(PAUSER_ROLE)).to.equal(GRANTOR_ROLE);
      expect(await token.getRoleAdmin(RESCUER_ROLE)).to.equal(GRANTOR_ROLE);
      expect(await token.getRoleAdmin(MINTER_ROLE)).to.equal(GRANTOR_ROLE);
      expect(await token.getRoleAdmin(BURNER_ROLE)).to.equal(GRANTOR_ROLE);
      expect(await token.getRoleAdmin(RESERVE_MINTER_ROLE)).to.equal(GRANTOR_ROLE);
      expect(await token.getRoleAdmin(RESERVE_BURNER_ROLE)).to.equal(GRANTOR_ROLE);
      expect(await token.getRoleAdmin(PREMINT_MANAGER_ROLE)).to.equal(GRANTOR_ROLE);
      expect(await token.getRoleAdmin(PREMINT_SCHEDULER_ROLE)).to.equal(GRANTOR_ROLE);
      expect(await token.getRoleAdmin(BALANCE_FREEZER_ROLE)).to.equal(GRANTOR_ROLE);
      expect(await token.getRoleAdmin(FROZEN_TRANSFEROR_ROLE)).to.equal(GRANTOR_ROLE);
      expect(await token.getRoleAdmin(TRUSTED_SPENDER_ROLE)).to.equal(GRANTOR_ROLE);

      // The deployer should have the owner role, but not the other roles
      expect(await token.hasRole(OWNER_ROLE, deployer.address)).to.equal(true);
      expect(await token.hasRole(GRANTOR_ROLE, deployer.address)).to.equal(false);
      expect(await token.hasRole(PAUSER_ROLE, deployer.address)).to.equal(false);
      expect(await token.hasRole(RESCUER_ROLE, deployer.address)).to.equal(false);
      expect(await token.hasRole(MINTER_ROLE, deployer.address)).to.equal(false);
      expect(await token.hasRole(BURNER_ROLE, deployer.address)).to.equal(false);
      expect(await token.hasRole(RESERVE_MINTER_ROLE, deployer.address)).to.equal(false);
      expect(await token.hasRole(RESERVE_BURNER_ROLE, deployer.address)).to.equal(false);
      expect(await token.hasRole(PREMINT_MANAGER_ROLE, deployer.address)).to.equal(false);
      expect(await token.hasRole(PREMINT_SCHEDULER_ROLE, deployer.address)).to.equal(false);
      expect(await token.hasRole(BALANCE_FREEZER_ROLE, deployer.address)).to.equal(false);
      expect(await token.hasRole(FROZEN_TRANSFEROR_ROLE, deployer.address)).to.equal(false);
      expect(await token.hasRole(TRUSTED_SPENDER_ROLE, deployer.address)).to.equal(false);
    });

    it("Is reverted if called for the second time", async () => {
      const { token } = await setUpFixture(deployToken);
      await expect(token.initialize(TOKEN_NAME, TOKEN_SYMBOL))
        .to.be.revertedWithCustomError(token, ERROR_NAME_INVALID_INITIALIZATION);
    });

    it("Is reverted if the internal initializer is called outside of the init process", async () => {
      const { token } = await setUpFixture(deployToken);
      await expect(token.callParentInitializer(TOKEN_NAME, TOKEN_SYMBOL))
        .to.be.revertedWithCustomError(token, ERROR_NAME_NOT_INITIALIZING);
    });

    it("Is reverted if the internal unchained initializer is called outside of the init process", async () => {
      const { token } = await setUpFixture(deployToken);
      await expect(token.callParentInitializerUnchained())
        .to.be.revertedWithCustomError(token, ERROR_NAME_NOT_INITIALIZING);
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
