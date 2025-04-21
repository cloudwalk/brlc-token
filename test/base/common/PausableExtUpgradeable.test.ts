import { ethers, network, upgrades } from "hardhat";
import { expect } from "chai";
import { Contract, ContractFactory } from "ethers";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { proveTx, connect } from "../../../test-utils/eth";

async function setUpFixture<T>(func: () => Promise<T>): Promise<T> {
  if (network.name === "hardhat") {
    return loadFixture(func);
  } else {
    return func();
  }
}

describe("Contract 'PausableExtUpgradeable'", async () => {
  const EVENT_NAME_PAUSED = "Paused";
  const EVENT_NAME_UNPAUSED = "Unpaused";
  const EVENT_NAME_PAUSER_CHANGED = "PauserChanged";

  // Errors of the lib contracts
  const REVERT_ERROR_CONTRACT_INITIALIZATION_IS_INVALID = "InvalidInitialization";
  const REVERT_ERROR_CONTRACT_IS_NOT_INITIALIZING = "NotInitializing";
  const REVERT_ERROR_UNAUTHORIZED_ACCOUNT = "AccessControlUnauthorizedAccount";

  // Errors of the contracts under test
  const REVERT_ERROR_UNAUTHORIZED_PAUSER = "UnauthorizedPauser";

  const OWNER_ROLE: string = ethers.id("OWNER_ROLE");

  let pausableExtFactory: ContractFactory;
  let deployer: HardhatEthersSigner;
  let pauser: HardhatEthersSigner;
  let user: HardhatEthersSigner;

  before(async () => {
    [deployer, pauser, user] = await ethers.getSigners();
    pausableExtFactory = await ethers.getContractFactory("PausableExtUpgradeableMock");
    pausableExtFactory = pausableExtFactory.connect(deployer); // Explicitly specifying the deployer account
  });

  async function deployPausableExt(): Promise<{ pausableExt: Contract }> {
    let pausableExt: Contract = await upgrades.deployProxy(
      pausableExtFactory,
      { unsafeSkipProxyAdminCheck: true } // This is necessary to run tests on other networks
    ) as Contract;
    await pausableExt.waitForDeployment();
    pausableExt = connect(pausableExt, deployer); // Explicitly specifying the initial account
    return { pausableExt };
  }

  async function deployAndConfigurePausableExt(): Promise<{ pausableExt: Contract }> {
    const { pausableExt } = await deployPausableExt();
    await proveTx(pausableExt.setPauser(pauser.address));
    return { pausableExt };
  }

  describe("Function 'initialize()'", async () => {
    it("Configures the contract as expected", async () => {
      const { pausableExt } = await setUpFixture(deployPausableExt);
      expect(await pausableExt.hasRole(OWNER_ROLE, deployer.address)).to.equal(true);
      expect(await pausableExt.pauser()).to.equal(ethers.ZeroAddress);
      expect(await pausableExt.paused()).to.equal(false);
    });

    it("Is reverted if called for the second time", async () => {
      const { pausableExt } = await setUpFixture(deployPausableExt);
      await expect(
        pausableExt.initialize()
      ).to.be.revertedWithCustomError(pausableExt, REVERT_ERROR_CONTRACT_INITIALIZATION_IS_INVALID);
    });

    it("Is reverted if the internal unchained initializer is called outside of the init process", async () => {
      const { pausableExt } = await setUpFixture(deployPausableExt);
      await expect(
        pausableExt.call_parent_initialize_unchained()
      ).to.be.revertedWithCustomError(pausableExt, REVERT_ERROR_CONTRACT_IS_NOT_INITIALIZING);
    });
  });

  describe("Function 'setPauser()'", async () => {
    it("Executes successfully and emits the correct event", async () => {
      const { pausableExt } = await setUpFixture(deployPausableExt);
      await expect(pausableExt.setPauser(pauser.address))
        .to.emit(pausableExt, EVENT_NAME_PAUSER_CHANGED)
        .withArgs(pauser.address);
      expect(await pausableExt.pauser()).to.equal(pauser.address);
      await expect(
        pausableExt.setPauser(pauser.address)
      ).not.to.emit(pausableExt, EVENT_NAME_PAUSER_CHANGED);
    });

    it("Is reverted if the caller does not have the owner role", async () => {
      const { pausableExt } = await setUpFixture(deployPausableExt);
      await expect(connect(pausableExt, user).setPauser(pauser.address))
        .to.be.revertedWithCustomError(pausableExt, REVERT_ERROR_UNAUTHORIZED_ACCOUNT)
        .withArgs(user.address, OWNER_ROLE);
    });
  });

  describe("Function 'pause()'", async () => {
    it("Executes successfully and emits the correct event", async () => {
      const { pausableExt } = await setUpFixture(deployAndConfigurePausableExt);
      await expect(connect(pausableExt, pauser).pause())
        .to.emit(pausableExt, EVENT_NAME_PAUSED)
        .withArgs(pauser.address);
      expect(await pausableExt.paused()).to.equal(true);
    });

    it("Is reverted if called not by the pauser", async () => {
      const { pausableExt } = await setUpFixture(deployAndConfigurePausableExt);
      await expect(
        connect(pausableExt, user).pause()
      ).to.be.revertedWithCustomError(pausableExt, REVERT_ERROR_UNAUTHORIZED_PAUSER);
    });
  });

  describe("Function 'unpause()'", async () => {
    it("Executes successfully and emits the correct event", async () => {
      const { pausableExt } = await setUpFixture(deployAndConfigurePausableExt);
      await proveTx(connect(pausableExt, pauser).pause());
      await expect(connect(pausableExt, pauser).unpause())
        .to.emit(pausableExt, EVENT_NAME_UNPAUSED)
        .withArgs(pauser.address);
      expect(await pausableExt.paused()).to.equal(false);
    });

    it("Is reverted if called not by the pauser", async () => {
      const { pausableExt } = await setUpFixture(deployAndConfigurePausableExt);
      await expect(
        connect(pausableExt, user).unpause()
      ).to.be.revertedWithCustomError(pausableExt, REVERT_ERROR_UNAUTHORIZED_PAUSER);
    });
  });
});
