import { ethers, network, upgrades } from "hardhat";
import { expect } from "chai";
import { Contract, ContractFactory } from "ethers";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { proveTx } from "../../../test-utils/eth";

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

  const REVERT_MESSAGE_INITIALIZABLE_CONTRACT_IS_ALREADY_INITIALIZED = "Initializable: contract is already initialized";
  const REVERT_MESSAGE_INITIALIZABLE_CONTRACT_IS_NOT_INITIALIZING = "Initializable: contract is not initializing";
  const REVERT_MESSAGE_OWNABLE_CALLER_IS_NOT_THE_OWNER = "Ownable: caller is not the owner";

  const REVERT_ERROR_UNAUTHORIZED_PAUSER = "UnauthorizedPauser";

  let pausableExtFactory: ContractFactory;
  let deployer: HardhatEthersSigner;
  let pauser: HardhatEthersSigner;
  let user: HardhatEthersSigner;

  before(async () => {
    [deployer, pauser, user] = await ethers.getSigners();
    pausableExtFactory = await ethers.getContractFactory("PausableExtUpgradeableMock");
  });

  async function deployPausableExt(): Promise<{ pausableExt: Contract }> {
    let pausableExt: Contract = await upgrades.deployProxy(pausableExtFactory);
    await pausableExt.waitForDeployment();
    pausableExt = pausableExt.connect(deployer) as Contract; // Explicitly specifying the initial account
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
      expect(await pausableExt.owner()).to.equal(deployer.address);
      expect(await pausableExt.pauser()).to.equal(ethers.ZeroAddress);
      expect(await pausableExt.paused()).to.equal(false);
    });

    it("Is reverted if called for the second time", async () => {
      const { pausableExt } = await setUpFixture(deployPausableExt);
      await expect(
        pausableExt.initialize()
      ).to.be.revertedWith(REVERT_MESSAGE_INITIALIZABLE_CONTRACT_IS_ALREADY_INITIALIZED);
    });

    it("Is reverted if the implementation contract is called even for the first time", async () => {
      const pausableExtImplementation: Contract = (await pausableExtFactory.deploy()) as Contract;
      await pausableExtImplementation.waitForDeployment();
      await expect(
        pausableExtImplementation.initialize()
      ).to.be.revertedWith(REVERT_MESSAGE_INITIALIZABLE_CONTRACT_IS_ALREADY_INITIALIZED);
    });

    it("Is reverted if the internal initializer is called outside of the init process", async () => {
      const { pausableExt } = await setUpFixture(deployPausableExt);
      await expect(
        pausableExt.call_parent_initialize()
      ).to.be.revertedWith(REVERT_MESSAGE_INITIALIZABLE_CONTRACT_IS_NOT_INITIALIZING);
    });

    it("Is reverted if the internal unchained initializer is called outside of the init process", async () => {
      const { pausableExt } = await setUpFixture(deployPausableExt);
      await expect(
        pausableExt.call_parent_initialize_unchained()
      ).to.be.revertedWith(REVERT_MESSAGE_INITIALIZABLE_CONTRACT_IS_NOT_INITIALIZING);
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

    it("Is reverted if called not by the owner", async () => {
      const { pausableExt } = await setUpFixture(deployPausableExt);
      await expect(
        (pausableExt.connect(user) as Contract).setPauser(pauser.address)
      ).to.be.revertedWith(REVERT_MESSAGE_OWNABLE_CALLER_IS_NOT_THE_OWNER);
    });
  });

  describe("Function 'pause()'", async () => {
    it("Executes successfully and emits the correct event", async () => {
      const { pausableExt } = await setUpFixture(deployAndConfigurePausableExt);
      await expect((pausableExt.connect(pauser) as Contract).pause())
        .to.emit(pausableExt, EVENT_NAME_PAUSED)
        .withArgs(pauser.address);
      expect(await pausableExt.paused()).to.equal(true);
    });

    it("Is reverted if called not by the pauser", async () => {
      const { pausableExt } = await setUpFixture(deployAndConfigurePausableExt);
      await expect(
        (pausableExt.connect(user) as Contract).pause()
      ).to.be.revertedWithCustomError(pausableExt, REVERT_ERROR_UNAUTHORIZED_PAUSER);
    });
  });

  describe("Function 'unpause()'", async () => {
    it("Executes successfully and emits the correct event", async () => {
      const { pausableExt } = await setUpFixture(deployAndConfigurePausableExt);
      await proveTx((pausableExt.connect(pauser) as Contract).pause());
      await expect((pausableExt.connect(pauser) as Contract).unpause())
        .to.emit(pausableExt, EVENT_NAME_UNPAUSED)
        .withArgs(pauser.address);
      expect(await pausableExt.paused()).to.equal(false);
    });

    it("Is reverted if called not by the pauser", async () => {
      const { pausableExt } = await setUpFixture(deployAndConfigurePausableExt);
      await expect(
        (pausableExt.connect(user) as Contract).unpause()
      ).to.be.revertedWithCustomError(pausableExt, REVERT_ERROR_UNAUTHORIZED_PAUSER);
    });
  });
});
