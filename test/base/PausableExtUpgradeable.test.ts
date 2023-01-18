import { ethers, network, upgrades } from "hardhat";
import { expect } from "chai";
import { Contract, ContractFactory } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { proveTx } from "../../test-utils/eth";

async function setUpFixture(func: any) {
  if (network.name === "hardhat") {
    return loadFixture(func);
  } else {
    return func();
  }
}

describe("Contract 'PausableExtUpgradeable'", async () => {
  const EVENT_NAME_PAUSED = "Paused";
  const EVENT_NAME_PAUSER_CHANGED = "PauserChanged";
  const EVENT_NAME_UNPAUSED = "Unpaused";

  const REVERT_MESSAGE_IF_CONTRACT_IS_ALREADY_INITIALIZED = "Initializable: contract is already initialized";
  const REVERT_MESSAGE_IF_CONTRACT_IS_NOT_INITIALIZING = "Initializable: contract is not initializing";
  const REVERT_MESSAGE_IF_CALLER_IS_NOT_OWNER = "Ownable: caller is not the owner";

  const REVERT_ERROR_IF_CALLER_IS_NOT_PAUSER = "UnauthorizedPauser";

  let pausableExtMockFactory: ContractFactory;

  let deployer: SignerWithAddress;
  let pauser: SignerWithAddress;

  before(async () => {
    [deployer, pauser] = await ethers.getSigners();
    pausableExtMockFactory = await ethers.getContractFactory("PausableExtUpgradeableMock");
  });

  async function deployPausableExtMock(): Promise<{ pausableExtMock: Contract }> {
    const pausableExtMock: Contract = await upgrades.deployProxy(pausableExtMockFactory);
    await pausableExtMock.deployed();
    return { pausableExtMock };
  }

  async function deployAndConfigurePausableExtMock(): Promise<{ pausableExtMock: Contract }> {
    const { pausableExtMock } = await deployPausableExtMock();
    await proveTx(pausableExtMock.setPauser(pauser.address));
    return { pausableExtMock };
  }

  describe("Function 'initialize()'", async () => {
    it("The external initializer configures the contract as expected", async () => {
      const { pausableExtMock } = await setUpFixture(deployPausableExtMock);

      expect(await pausableExtMock.owner()).to.equal(deployer.address);
      expect(await pausableExtMock.pauser()).to.equal(ethers.constants.AddressZero);

      // The initial contract state is unpaused
      expect(await pausableExtMock.paused()).to.equal(false);
    });

    it("The external initializer is reverted if it is called a second time", async () => {
      const { pausableExtMock } = await setUpFixture(deployPausableExtMock);
      await expect(
        pausableExtMock.initialize()
      ).to.be.revertedWith(REVERT_MESSAGE_IF_CONTRACT_IS_ALREADY_INITIALIZED);
    });

    it("The internal initializer is reverted if it is called outside the init process", async () => {
      const { pausableExtMock } = await setUpFixture(deployPausableExtMock);
      await expect(
        pausableExtMock.call_parent_initialize()
      ).to.be.revertedWith(REVERT_MESSAGE_IF_CONTRACT_IS_NOT_INITIALIZING);
    });

    it("The internal unchained initializer is reverted if it is called outside the init process", async () => {
      const { pausableExtMock } = await setUpFixture(deployPausableExtMock);
      await expect(
        pausableExtMock.call_parent_initialize_unchained()
      ).to.be.revertedWith(REVERT_MESSAGE_IF_CONTRACT_IS_NOT_INITIALIZING);
    });
  });

  describe("Function 'setPauser()'", async () => {
    it("Executes successfully and emits the correct event", async () => {
      const { pausableExtMock } = await setUpFixture(deployPausableExtMock);

      await expect(
        pausableExtMock.setPauser(pauser.address)
      ).to.emit(
        pausableExtMock,
        EVENT_NAME_PAUSER_CHANGED
      ).withArgs(pauser.address);
      expect(await pausableExtMock.pauser()).to.equal(pauser.address);

      // The second call with the same argument should not emit an event
      await expect(
        pausableExtMock.setPauser(pauser.address)
      ).not.to.emit(pausableExtMock, EVENT_NAME_PAUSER_CHANGED);
    });

    it("Is reverted if it is called not by the owner", async () => {
      const { pausableExtMock } = await setUpFixture(deployPausableExtMock);
      await expect(
        pausableExtMock.connect(pauser).setPauser(pauser.address)
      ).to.be.revertedWith(REVERT_MESSAGE_IF_CALLER_IS_NOT_OWNER);
    });
  });

  describe("Function 'pause()'", async () => {
    it("Executes successfully and emits the correct event", async () => {
      const { pausableExtMock } = await setUpFixture(deployAndConfigurePausableExtMock);

      await expect(
        pausableExtMock.connect(pauser).pause()
      ).to.emit(
        pausableExtMock,
        EVENT_NAME_PAUSED
      ).withArgs(pauser.address);

      expect(await pausableExtMock.paused()).to.equal(true);
    });

    it("Is reverted if it is called not by the pauser", async () => {
      const { pausableExtMock } = await setUpFixture(deployAndConfigurePausableExtMock);
      await expect(
        pausableExtMock.pause()
      ).to.be.revertedWithCustomError(pausableExtMock, REVERT_ERROR_IF_CALLER_IS_NOT_PAUSER);
    });
  });

  describe("Function 'unpause()'", async () => {
    it("Executes successfully and emits the correct event", async () => {
      const { pausableExtMock } = await setUpFixture(deployAndConfigurePausableExtMock);
      await proveTx(pausableExtMock.connect(pauser).pause());

      await expect(
        pausableExtMock.connect(pauser).unpause()
      ).to.emit(
        pausableExtMock,
        EVENT_NAME_UNPAUSED
      ).withArgs(pauser.address);

      expect(await pausableExtMock.paused()).to.equal(false);
    });

    it("Is reverted if it is called not by the pauser", async () => {
      const { pausableExtMock } = await setUpFixture(deployAndConfigurePausableExtMock);
      await expect(
        pausableExtMock.unpause()
      ).to.be.revertedWithCustomError(pausableExtMock, REVERT_ERROR_IF_CALLER_IS_NOT_PAUSER);
    });
  });
});
