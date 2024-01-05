import { ethers, network, upgrades } from "hardhat";
import { expect } from "chai";
import { Contract, ContractFactory } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { proveTx } from "../../../test-utils/eth";

async function setUpFixture(func: any) {
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
  let deployer: SignerWithAddress;
  let pauser: SignerWithAddress;
  let user: SignerWithAddress;

  before(async () => {
    [deployer, pauser, user] = await ethers.getSigners();
    pausableExtFactory = await ethers.getContractFactory("PausableExtUpgradeableMock");
  });

  async function deployPausableExt(): Promise<{ pausableExt: Contract }> {
    const pausableExt: Contract = await upgrades.deployProxy(pausableExtFactory);
    await pausableExt.deployed();
    return { pausableExt };
  }

  async function deployAndConfigurePausableExt(): Promise<{ pausableExt: Contract }> {
    const { pausableExt } = await deployPausableExt();
    await proveTx(pausableExt.connect(deployer).setPauser(pauser.address));
    return { pausableExt };
  }

  describe("Function 'initialize()'", async () => {
    it("Configures the contract as expected", async () => {
      const { pausableExt } = await setUpFixture(deployPausableExt);
      expect(await pausableExt.owner()).to.equal(deployer.address);
      expect(await pausableExt.pauser()).to.equal(ethers.constants.AddressZero);
      expect(await pausableExt.paused()).to.equal(false);
    });

    it("Is reverted if called for the second time", async () => {
      const { pausableExt } = await setUpFixture(deployPausableExt);
      await expect(pausableExt.initialize()).to.be.revertedWith(
        REVERT_MESSAGE_INITIALIZABLE_CONTRACT_IS_ALREADY_INITIALIZED
      );
    });

    it("Is reverted if the implementation contract is called even for the first time", async () => {
      const pausableExtImplementation: Contract = await pausableExtFactory.deploy();
      await pausableExtImplementation.deployed();
      await expect(pausableExtImplementation.initialize()).to.be.revertedWith(
        REVERT_MESSAGE_INITIALIZABLE_CONTRACT_IS_ALREADY_INITIALIZED
      );
    });

    it("Is reverted if the internal initializer is called outside of the init process", async () => {
      const { pausableExt } = await setUpFixture(deployPausableExt);
      await expect(pausableExt.call_parent_initialize()).to.be.revertedWith(
        REVERT_MESSAGE_INITIALIZABLE_CONTRACT_IS_NOT_INITIALIZING
      );
    });

    it("Is reverted if the internal unchained initializer is called outside of the init process", async () => {
      const { pausableExt } = await setUpFixture(deployPausableExt);
      await expect(pausableExt.call_parent_initialize_unchained()).to.be.revertedWith(
        REVERT_MESSAGE_INITIALIZABLE_CONTRACT_IS_NOT_INITIALIZING
      );
    });
  });

  describe("Function 'setPauser()'", async () => {
    it("Executes successfully and emits the correct event", async () => {
      const { pausableExt } = await setUpFixture(deployPausableExt);
      await expect(pausableExt.connect(deployer).setPauser(pauser.address))
        .to.emit(pausableExt, EVENT_NAME_PAUSER_CHANGED)
        .withArgs(pauser.address);
      expect(await pausableExt.connect(deployer).pauser()).to.equal(pauser.address);
      await expect(pausableExt.connect(deployer).setPauser(pauser.address)).not.to.emit(
        pausableExt,
        EVENT_NAME_PAUSER_CHANGED
      );
    });

    it("Is reverted if called not by the owner", async () => {
      const { pausableExt } = await setUpFixture(deployPausableExt);
      await expect(pausableExt.connect(user).setPauser(pauser.address)).to.be.revertedWith(
        REVERT_MESSAGE_OWNABLE_CALLER_IS_NOT_THE_OWNER
      );
    });
  });

  describe("Function 'pause()'", async () => {
    it("Executes successfully and emits the correct event", async () => {
      const { pausableExt } = await setUpFixture(deployAndConfigurePausableExt);
      await expect(pausableExt.connect(pauser).pause())
        .to.emit(pausableExt, EVENT_NAME_PAUSED)
        .withArgs(pauser.address);
      expect(await pausableExt.paused()).to.equal(true);
    });

    it("Is reverted if called not by the pauser", async () => {
      const { pausableExt } = await setUpFixture(deployAndConfigurePausableExt);
      await expect(pausableExt.connect(user).pause()).to.be.revertedWithCustomError(
        pausableExt,
        REVERT_ERROR_UNAUTHORIZED_PAUSER
      );
    });
  });

  describe("Function 'unpause()'", async () => {
    it("Executes successfully and emits the correct event", async () => {
      const { pausableExt } = await setUpFixture(deployAndConfigurePausableExt);
      await proveTx(pausableExt.connect(pauser).pause());
      await expect(pausableExt.connect(pauser).unpause())
        .to.emit(pausableExt, EVENT_NAME_UNPAUSED)
        .withArgs(pauser.address);
      expect(await pausableExt.paused()).to.equal(false);
    });

    it("Is reverted if called not by the pauser", async () => {
      const { pausableExt } = await setUpFixture(deployAndConfigurePausableExt);
      await expect(pausableExt.connect(user).unpause()).to.be.revertedWithCustomError(
        pausableExt,
        REVERT_ERROR_UNAUTHORIZED_PAUSER
      );
    });
  });
});
