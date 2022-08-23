import { ethers, upgrades } from "hardhat";
import { expect } from "chai";
import { Contract, ContractFactory } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import { proveTx } from "../../test-utils/eth";

describe("Contract 'PausableExtUpgradeable'", async () => {
  const REVERT_MESSAGE_IF_CALLER_IS_NOT_OWNER = "Ownable: caller is not the owner";
  const REVERT_MESSAGE_IF_CALLER_IS_NOT_PAUSER = "PausableExt: caller is not the pauser";
  const REVERT_MESSAGE_IF_CONTRACT_IS_ALREADY_INITIALIZED = 'Initializable: contract is already initialized';

  let pausableExtMock: Contract;
  let deployer: SignerWithAddress;
  let user: SignerWithAddress;

  beforeEach(async () => {
    const PausableExtMock: ContractFactory = await ethers.getContractFactory("PausableExtUpgradeableMock");
    pausableExtMock = await upgrades.deployProxy(PausableExtMock);
    await pausableExtMock.deployed();

    [deployer, user] = await ethers.getSigners();
  });

  it("The initialize function can't be called more than once", async () => {
    await expect(pausableExtMock.initialize())
      .to.be.revertedWith(REVERT_MESSAGE_IF_CONTRACT_IS_ALREADY_INITIALIZED);
  });

  it("The initialize unchained function can't be called more than once", async () => {
    await expect(pausableExtMock.initialize_unchained())
      .to.be.revertedWith(REVERT_MESSAGE_IF_CONTRACT_IS_ALREADY_INITIALIZED);
  });

  describe("Function 'setPauser()'", async () => {
    it("Is reverted if is called not by the owner", async () => {
      await expect(pausableExtMock.connect(user).setPauser(user.address))
        .to.be.revertedWith(REVERT_MESSAGE_IF_CALLER_IS_NOT_OWNER);
    });

    it("Executes successfully if is called by the owner", async () => {
      const expectedPauserAddress: string = user.address;
      await proveTx(pausableExtMock.setPauser(expectedPauserAddress));
      const actualPauserAddress: string = await pausableExtMock.getPauser();
      expect(actualPauserAddress).to.equal(expectedPauserAddress);
    });

    it("Emits the correct event", async () => {
      const pauserAddress: string = user.address;
      await expect(pausableExtMock.setPauser(pauserAddress))
        .to.emit(pausableExtMock, "PauserChanged")
        .withArgs(pauserAddress);
    });
  });

  describe("Function 'pause()'", async () => {
    beforeEach(async () => {
      await proveTx(pausableExtMock.setPauser(user.address));
    });

    it("Is reverted if is called not by the pauser", async () => {
      await expect(pausableExtMock.pause())
        .to.be.revertedWith(REVERT_MESSAGE_IF_CALLER_IS_NOT_PAUSER);
    });

    it("Executes successfully if is called by the pauser", async () => {
      await proveTx(pausableExtMock.connect(user).pause());
      expect(await pausableExtMock.paused()).to.equal(true);
    });

    it("Emits the correct event", async () => {
      await expect(pausableExtMock.connect(user).pause())
        .to.emit(pausableExtMock, "Paused")
        .withArgs(user.address);
    });
  });

  describe("Function 'unpause()'", async () => {
    beforeEach(async () => {
      await proveTx(pausableExtMock.setPauser(user.address));
      await proveTx(pausableExtMock.connect(user).pause());
    });

    it("Is reverted if is called not by the pauser", async () => {
      await expect(pausableExtMock.unpause())
        .to.be.revertedWith(REVERT_MESSAGE_IF_CALLER_IS_NOT_PAUSER);
    });

    it("Executes successfully if is called by the pauser", async () => {
      await proveTx(pausableExtMock.connect(user).unpause());
      expect(await pausableExtMock.paused()).to.equal(false);
    });

    it("Emits the correct event", async () => {
      await expect(pausableExtMock.connect(user).unpause())
        .to.emit(pausableExtMock, "Unpaused")
        .withArgs(user.address);
    });
  });
});
