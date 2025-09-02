import { ethers, upgrades } from "hardhat";
import { expect } from "chai";
import { Contract, ContractFactory } from "ethers";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { connect, proveTx } from "../../test-utils/eth";
import { setUpFixture } from "../../test-utils/common";

describe("Contract 'ERC20Trustable'", async () => {
  const TOKEN_NAME = "BRL Coin";
  const TOKEN_SYMBOL = "BRLC";

  const APPROVE_AMOUNT = 123;
  const MAX_APPROVE_AMOUNT = ethers.MaxUint256;

  // Errors of the lib contracts
  const ERROR_NAME_INVALID_INITIALIZATION = "InvalidInitialization";
  const ERROR_NAME_NOT_INITIALIZING = "NotInitializing";

  const OWNER_ROLE: string = ethers.id("OWNER_ROLE");
  const GRANTOR_ROLE: string = ethers.id("GRANTOR_ROLE");
  const PAUSER_ROLE: string = ethers.id("PAUSER_ROLE");
  const RESCUER_ROLE: string = ethers.id("RESCUER_ROLE");
  const TRUSTED_SPENDER_ROLE: string = ethers.id("TRUSTED_SPENDER_ROLE");

  let tokenFactory: ContractFactory;
  let deployer: HardhatEthersSigner;
  let user: HardhatEthersSigner;
  let trustedAccount: HardhatEthersSigner;

  before(async () => {
    [deployer, user, trustedAccount] = await ethers.getSigners();
    tokenFactory = await ethers.getContractFactory("ERC20TrustableMock");
    tokenFactory = tokenFactory.connect(deployer); // Explicitly specifying the deployer account
  });

  async function deployToken(): Promise<{ token: Contract }> {
    const token = await upgrades.deployProxy(
      tokenFactory,
      [TOKEN_NAME, TOKEN_SYMBOL],
      { unsafeSkipProxyAdminCheck: true }, // This is necessary to run tests on other networks
    ) as Contract;
    await token.waitForDeployment();
    return { token };
  }

  describe("Function 'initialize()'", async () => {
    it("Configures the contract as expected", async () => {
      const { token } = await setUpFixture(deployToken);

      // The role hashes
      expect(await token.OWNER_ROLE()).to.equal(OWNER_ROLE);
      expect(await token.GRANTOR_ROLE()).to.equal(GRANTOR_ROLE);
      expect(await token.PAUSER_ROLE()).to.equal(PAUSER_ROLE);
      expect(await token.RESCUER_ROLE()).to.equal(RESCUER_ROLE);
      expect(await token.TRUSTED_SPENDER_ROLE()).to.equal(TRUSTED_SPENDER_ROLE);

      // The role admins
      expect(await token.getRoleAdmin(OWNER_ROLE)).to.equal(OWNER_ROLE);
      expect(await token.getRoleAdmin(GRANTOR_ROLE)).to.equal(OWNER_ROLE);
      expect(await token.getRoleAdmin(PAUSER_ROLE)).to.equal(GRANTOR_ROLE);
      expect(await token.getRoleAdmin(RESCUER_ROLE)).to.equal(GRANTOR_ROLE);
      expect(await token.getRoleAdmin(TRUSTED_SPENDER_ROLE)).to.equal(GRANTOR_ROLE);

      // The deployer should have the owner role, but not the other roles
      expect(await token.hasRole(OWNER_ROLE, deployer.address)).to.equal(true);
      expect(await token.hasRole(GRANTOR_ROLE, deployer.address)).to.equal(false);
      expect(await token.hasRole(PAUSER_ROLE, deployer.address)).to.equal(false);
      expect(await token.hasRole(RESCUER_ROLE, deployer.address)).to.equal(false);
      expect(await token.hasRole(TRUSTED_SPENDER_ROLE, deployer.address)).to.equal(false);
    });

    it("Is reverted if called for the second time", async () => {
      const { token } = await setUpFixture(deployToken);
      await expect(token.initialize(TOKEN_NAME, TOKEN_SYMBOL))
        .to.be.revertedWithCustomError(token, ERROR_NAME_INVALID_INITIALIZATION);
    });

    it("Is reverted if the internal unchained initializer is called outside of the init process", async () => {
      const { token } = await setUpFixture(deployToken);
      await expect(token.callParentInitializerUnchained())
        .to.be.revertedWithCustomError(token, ERROR_NAME_NOT_INITIALIZING);
    });
  });

  describe("Function 'allowance()'", async () => {
    it("Returns correct allowance if spender is marked as trusted", async () => {
      const { token } = await setUpFixture(deployToken);

      expect(await (token.allowance(user.address, trustedAccount.address)))
        .to.eq(0);

      await proveTx(connect(token, user).approve(trustedAccount.address, APPROVE_AMOUNT));
      expect(await (token.allowance(user.address, trustedAccount.address)))
        .to.eq(APPROVE_AMOUNT);

      await proveTx(token.grantRole(GRANTOR_ROLE, deployer.address));
      await proveTx(token.grantRole(TRUSTED_SPENDER_ROLE, trustedAccount.address));
      expect(await (token.allowance(user.address, trustedAccount.address)))
        .to.eq(MAX_APPROVE_AMOUNT);

      await proveTx(connect(token, user).approve(trustedAccount.address, APPROVE_AMOUNT * 2));
      expect(await (token.allowance(user.address, trustedAccount.address)))
        .to.eq(MAX_APPROVE_AMOUNT);

      await proveTx(token.revokeRole(TRUSTED_SPENDER_ROLE, trustedAccount.address));
      expect(await (token.allowance(user.address, trustedAccount.address)))
        .to.eq(APPROVE_AMOUNT * 2);
    });
  });
});
