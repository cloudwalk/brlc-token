import { ethers } from "hardhat";
import { expect } from "chai";
import { Contract, ContractFactory } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import { proveTx } from "../../test-utils/eth";

describe("Contract 'PausableExtUpgradeable'", async () => {
  const REVERT_MESSAGE_IF_CONTRACT_IS_ALREADY_INITIALIZED = "Initializable: contract is already initialized";
  const REVERT_MESSAGE_IF_CONTRACT_IS_NOT_INITIALIZING = "Initializable: contract is not initializing";
  const REVERT_MESSAGE_IF_CALLER_IS_NOT_OWNER = "Ownable: caller is not the owner";
  const REVERT_MESSAGE_IF_CONTRACT_IS_ALREADY_PAUSED = "Pausable: paused";
  const REVERT_MESSAGE_IF_CONTRACT_IS_ALREADY_UNPAUSED = "Pausable: not paused";

  const REVERT_ERROR_IF_CALLER_IS_NOT_PAUSER = "UnauthorizedPauser";

  let pausableExtMock: Contract;
  let deployer: SignerWithAddress;
  let pauser: SignerWithAddress;

  beforeEach(async () => {
    const PausableExtMock: ContractFactory = await ethers.getContractFactory("PausableExtUpgradeableMock");
    pausableExtMock = await PausableExtMock.deploy();
    await pausableExtMock.deployed();
    await proveTx(pausableExtMock.initialize());

    [deployer, pauser] = await ethers.getSigners();
  });

  it("The initialize function can't be called more than once", async () => {
    await expect(
      pausableExtMock.initialize()
    ).to.be.revertedWith(REVERT_MESSAGE_IF_CONTRACT_IS_ALREADY_INITIALIZED);
  });

  it("The init function of the ancestor contract can't be called outside the init process", async () => {
    await expect(
      pausableExtMock.call_parent_initialize()
    ).to.be.revertedWith(REVERT_MESSAGE_IF_CONTRACT_IS_NOT_INITIALIZING);
  });

  it("The init unchained function of the ancestor contract can't be called outside the init process", async () => {
    await expect(
      pausableExtMock.call_parent_initialize_unchained()
    ).to.be.revertedWith(REVERT_MESSAGE_IF_CONTRACT_IS_NOT_INITIALIZING);
  });

  it("The initial contract configuration should be as expected", async () => {
    expect(await pausableExtMock.owner()).to.equal(deployer.address);
    expect(await pausableExtMock.pauser()).to.equal(ethers.constants.AddressZero);
  });

  describe("Function 'setPauser()'", async () => {
    it("Is reverted if is called not by the owner", async () => {
      await expect(
        pausableExtMock.connect(pauser).setPauser(pauser.address)
      ).to.be.revertedWith(REVERT_MESSAGE_IF_CALLER_IS_NOT_OWNER);
    });

    it("Executes successfully and emits the correct event if is called by the owner", async () => {
      await expect(
        pausableExtMock.setPauser(pauser.address)
      ).to.emit(
        pausableExtMock,
        "PauserChanged"
      ).withArgs(pauser.address);
      expect(await pausableExtMock.pauser()).to.equal(pauser.address);

      // The second call with the same argument should not emit an event
      await expect(
        pausableExtMock.setPauser(pauser.address)
      ).not.to.emit(pausableExtMock, "PauserChanged");
    });
  });

  describe("Function 'pause()'", async () => {
    beforeEach(async () => {
      await proveTx(pausableExtMock.setPauser(pauser.address));
    });

    it("Is reverted if is called not by the pauser", async () => {
      await expect(
        pausableExtMock.pause()
      ).to.be.revertedWithCustomError(pausableExtMock, REVERT_ERROR_IF_CALLER_IS_NOT_PAUSER);
    });

    it("Executes successfully and emits the correct event if is called by the pauser", async () => {
      expect(await pausableExtMock.paused()).to.equal(false);
      await expect(
        pausableExtMock.connect(pauser).pause()
      ).to.emit(
        pausableExtMock,
        "Paused"
      ).withArgs(pauser.address);
      expect(await pausableExtMock.paused()).to.equal(true);
    });

    it("Is reverted if the contract is already paused", async () => {
      pausableExtMock.connect(pauser).pause();
      await expect(
        pausableExtMock.connect(pauser).pause()
      ).to.be.revertedWith(REVERT_MESSAGE_IF_CONTRACT_IS_ALREADY_PAUSED);
    });
  });

  describe("Function 'unpause()'", async () => {
    beforeEach(async () => {
      await proveTx(pausableExtMock.setPauser(pauser.address));
    });

    it("Is reverted if is called not by the pauser", async () => {
      await expect(
        pausableExtMock.unpause()
      ).to.be.revertedWithCustomError(pausableExtMock, REVERT_ERROR_IF_CALLER_IS_NOT_PAUSER);
    });

    it("Is reverted if the contract is already unpaused", async () => {
      await expect(
        pausableExtMock.connect(pauser).unpause()
      ).to.be.revertedWith(REVERT_MESSAGE_IF_CONTRACT_IS_ALREADY_UNPAUSED);
    });

    it("Executes successfully and emits the correct event if is called by the pauser", async () => {
      await proveTx(pausableExtMock.connect(pauser).pause());
      expect(await pausableExtMock.paused()).to.equal(true);
      await expect(
        pausableExtMock.connect(pauser).unpause()
      ).to.emit(
        pausableExtMock,
        "Unpaused"
      ).withArgs(pauser.address);
      expect(await pausableExtMock.paused()).to.equal(false);
    });
  });
});
