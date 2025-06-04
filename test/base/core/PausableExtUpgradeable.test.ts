import { ethers, upgrades } from "hardhat";
import { expect } from "chai";
import { Contract } from "ethers";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { connect, proveTx } from "../../../test-utils/eth";
import { setUpFixture } from "../../../test-utils/common";

describe("Contract 'PausableExtUpgradeable'", async () => {
  // Events of the lib contracts
  const EVENT_NAME_PAUSED = "Paused";
  const EVENT_NAME_UNPAUSED = "Unpaused";

  // Errors of the lib contracts
  const ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED_ACCOUNT = "AccessControlUnauthorizedAccount";
  const ERROR_NAME_INVALID_INITIALIZATION = "InvalidInitialization";
  const ERROR_NAME_NOT_INITIALIZING = "NotInitializing";

  const OWNER_ROLE: string = ethers.id("OWNER_ROLE");
  const GRANTOR_ROLE: string = ethers.id("GRANTOR_ROLE");
  const PAUSER_ROLE: string = ethers.id("PAUSER_ROLE");

  let deployer: HardhatEthersSigner;
  let pauser: HardhatEthersSigner;

  before(async () => {
    [deployer, pauser] = await ethers.getSigners();
  });

  async function deployPausableExtMock(): Promise<{ pausableExtMock: Contract }> {
    // The contract factory with the explicitly specified deployer account
    let pausableExtMockFactory = await ethers.getContractFactory("PausableExtUpgradeableMock");
    pausableExtMockFactory = pausableExtMockFactory.connect(deployer);

    // The contract under test with the explicitly specified initial account
    let pausableExtMock = await upgrades.deployProxy(pausableExtMockFactory) as Contract;
    await pausableExtMock.waitForDeployment();
    pausableExtMock = connect(pausableExtMock, deployer);

    return { pausableExtMock };
  }

  async function deployAndConfigurePausableExtMock(): Promise<{ pausableExtMock: Contract }> {
    const { pausableExtMock } = await deployPausableExtMock();
    await proveTx(pausableExtMock.grantRole(GRANTOR_ROLE, deployer.address));
    await proveTx(pausableExtMock.grantRole(PAUSER_ROLE, pauser.address));

    return { pausableExtMock };
  }

  describe("Function 'initialize()' and internal initializers", async () => {
    it("The external initializer configures the contract as expected", async () => {
      const { pausableExtMock } = await setUpFixture(deployPausableExtMock);

      // The role hashes
      expect((await pausableExtMock.OWNER_ROLE()).toLowerCase()).to.equal(OWNER_ROLE);
      expect((await pausableExtMock.GRANTOR_ROLE()).toLowerCase()).to.equal(GRANTOR_ROLE);
      expect((await pausableExtMock.PAUSER_ROLE()).toLowerCase()).to.equal(PAUSER_ROLE);

      // The role admins
      expect(await pausableExtMock.getRoleAdmin(OWNER_ROLE)).to.equal(OWNER_ROLE);
      expect(await pausableExtMock.getRoleAdmin(GRANTOR_ROLE)).to.equal(OWNER_ROLE);
      expect(await pausableExtMock.getRoleAdmin(PAUSER_ROLE)).to.equal(GRANTOR_ROLE);

      // The deployer should have the owner role, but not the other roles
      expect(await pausableExtMock.hasRole(OWNER_ROLE, deployer.address)).to.equal(true);
      expect(await pausableExtMock.hasRole(GRANTOR_ROLE, deployer.address)).to.equal(false);
      expect(await pausableExtMock.hasRole(PAUSER_ROLE, deployer.address)).to.equal(false);

      // The initial contract state is unpaused
      expect(await pausableExtMock.paused()).to.equal(false);
    });

    it("The external initializer is reverted if it is called a second time", async () => {
      const { pausableExtMock } = await setUpFixture(deployPausableExtMock);
      await expect(pausableExtMock.initialize())
        .to.be.revertedWithCustomError(pausableExtMock, ERROR_NAME_INVALID_INITIALIZATION);
    });

    it("The internal unchained initializer is reverted if it is called outside the init process", async () => {
      const { pausableExtMock } = await setUpFixture(deployPausableExtMock);
      await expect(pausableExtMock.callParentInitializerUnchained())
        .to.be.revertedWithCustomError(pausableExtMock, ERROR_NAME_NOT_INITIALIZING);
    });
  });

  describe("Function 'pause()'", async () => {
    it("Executes successfully and emits the correct event", async () => {
      const { pausableExtMock } = await setUpFixture(deployAndConfigurePausableExtMock);

      await expect(connect(pausableExtMock, pauser).pause())
        .to.emit(pausableExtMock, EVENT_NAME_PAUSED)
        .withArgs(pauser.address);

      expect(await pausableExtMock.paused()).to.equal(true);
    });

    it("Is reverted if it is called by an account without the pauser role", async () => {
      const { pausableExtMock } = await setUpFixture(deployAndConfigurePausableExtMock);

      await expect(pausableExtMock.pause())
        .to.be.revertedWithCustomError(pausableExtMock, ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED_ACCOUNT)
        .withArgs(deployer.address, PAUSER_ROLE);
    });
  });

  describe("Function 'unpause()'", async () => {
    it("Executes successfully and emits the correct event", async () => {
      const { pausableExtMock } = await setUpFixture(deployAndConfigurePausableExtMock);
      await proveTx(connect(pausableExtMock, pauser).pause());

      await expect(connect(pausableExtMock, pauser).unpause())
        .to.emit(pausableExtMock, EVENT_NAME_UNPAUSED)
        .withArgs(pauser.address);

      expect(await pausableExtMock.paused()).to.equal(false);
    });

    it("Is reverted if the caller does not have the pauser role", async () => {
      const { pausableExtMock } = await setUpFixture(deployAndConfigurePausableExtMock);

      await expect(pausableExtMock.unpause())
        .to.be.revertedWithCustomError(pausableExtMock, ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED_ACCOUNT)
        .withArgs(deployer.address, PAUSER_ROLE);
    });
  });
});
