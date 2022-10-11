import { ethers } from "hardhat";
import { expect } from "chai";
import { Contract, ContractFactory } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import { proveTx } from "../../test-utils/eth";

describe("Contract 'BlacklistableUpgradeable'", async () => {
  const REVERT_MESSAGE_IF_CONTRACT_IS_ALREADY_INITIALIZED = "Initializable: contract is already initialized";
  const REVERT_MESSAGE_IF_CONTRACT_IS_NOT_INITIALIZING = "Initializable: contract is not initializing";
  const REVERT_MESSAGE_IF_CALLER_IS_NOT_OWNER = "Ownable: caller is not the owner";

  const REVERT_ERROR_IF_CALLER_IS_NOT_BLACKLISTER = "UnauthorizedBlacklister";
  const REVERT_ERROR_IF_ACCOUNT_IS_BLACKLISTED = "BlacklistedAccount";

  let blacklistableMock: Contract;
  let deployer: SignerWithAddress;
  let blacklister: SignerWithAddress;
  let user: SignerWithAddress;

  beforeEach(async () => {
    const BlacklistableMock: ContractFactory = await ethers.getContractFactory("BlacklistableUpgradeableMock");
    blacklistableMock = await BlacklistableMock.deploy();
    await blacklistableMock.deployed();
    await proveTx(blacklistableMock.initialize());

    [deployer, blacklister, user] = await ethers.getSigners();
  });

  it("The initialize function can't be called more than once", async () => {
    await expect(
      blacklistableMock.initialize()
    ).to.be.revertedWith(REVERT_MESSAGE_IF_CONTRACT_IS_ALREADY_INITIALIZED);
  });

  it("The init function of the ancestor contract can't be called outside the init process", async () => {
    await expect(
      blacklistableMock.call_parent_initialize()
    ).to.be.revertedWith(REVERT_MESSAGE_IF_CONTRACT_IS_NOT_INITIALIZING);
  });

  it("The init unchained function of the ancestor contract can't be called outside the init process", async () => {
    await expect(
      blacklistableMock.call_parent_initialize_unchained()
    ).to.be.revertedWith(REVERT_MESSAGE_IF_CONTRACT_IS_NOT_INITIALIZING);
  });

  it("The initial contract configuration should be as expected", async () => {
    expect(await blacklistableMock.owner()).to.equal(deployer.address);
    expect(await blacklistableMock.blacklister()).to.equal(ethers.constants.AddressZero);
  });

  describe("Function 'setBlacklister()'", async () => {
    it("Is reverted if is called not by the owner", async () => {
      await expect(
        blacklistableMock.connect(blacklister).setBlacklister(blacklister.address)
      ).to.be.revertedWith(REVERT_MESSAGE_IF_CALLER_IS_NOT_OWNER);
    });

    it("Executes successfully and emits the correct event if is called by the owner", async () => {
      await expect(
        blacklistableMock.setBlacklister(blacklister.address)
      ).to.emit(
        blacklistableMock,
        "BlacklisterChanged"
      ).withArgs(blacklister.address);
      expect(await blacklistableMock.blacklister()).to.equal(blacklister.address);

      // The second call with the same argument should not emit an event
      await expect(
        blacklistableMock.setBlacklister(blacklister.address)
      ).not.to.emit(blacklistableMock, "BlacklisterChanged");
    });
  });

  describe("Function 'blacklist()'", async () => {
    beforeEach(async () => {
      await proveTx(blacklistableMock.setBlacklister(blacklister.address));
    });

    it("Is reverted if is called not by the blacklister", async () => {
      await expect(
        blacklistableMock.blacklist(user.address)
      ).to.be.revertedWithCustomError(blacklistableMock, REVERT_ERROR_IF_CALLER_IS_NOT_BLACKLISTER);
    });

    it("Executes successfully and emits the correct event if is called by the blacklister", async () => {
      expect(await blacklistableMock.isBlacklisted(user.address)).to.equal(false);
      await expect(
        blacklistableMock.connect(blacklister).blacklist(user.address)
      ).to.emit(
        blacklistableMock,
        "Blacklisted"
      ).withArgs(user.address);
      expect(await blacklistableMock.isBlacklisted(user.address)).to.equal(true);

      // The second call with the same argument should not emit an event
      await expect(
        blacklistableMock.connect(blacklister).blacklist(user.address)
      ).not.to.emit(blacklistableMock, "Blacklisted");
    });
  });

  describe("Function 'unBlacklist()'", async () => {
    beforeEach(async () => {
      await proveTx(blacklistableMock.setBlacklister(blacklister.address));
      await proveTx(blacklistableMock.connect(blacklister).blacklist(user.address));
    });

    it("Is reverted if is called not by the blacklister", async () => {
      await expect(
        blacklistableMock.unBlacklist(user.address)
      ).to.be.revertedWithCustomError(blacklistableMock, REVERT_ERROR_IF_CALLER_IS_NOT_BLACKLISTER);
    });

    it("Executes successfully and emits the correct event if is called by the blacklister", async () => {
      expect(await blacklistableMock.isBlacklisted(user.address)).to.equal(true);
      await expect(
        blacklistableMock.connect(blacklister).unBlacklist(user.address)
      ).to.emit(
        blacklistableMock,
        "UnBlacklisted"
      ).withArgs(user.address);
      expect(await blacklistableMock.isBlacklisted(user.address)).to.equal(false);

      // The second call with the same argument should not emit an event
      await expect(
        blacklistableMock.connect(blacklister).unBlacklist(user.address)
      ).not.to.emit(blacklistableMock, "UnBlacklisted");
    });
  });

  describe("Function 'selfBlacklist()'", async () => {
    it("Executes successfully and emits the correct events if is called by any account", async () => {
      expect(await blacklistableMock.isBlacklisted(user.address)).to.equal(false);
      await expect(
        blacklistableMock.connect(user).selfBlacklist()
      ).to.emit(
        blacklistableMock,
        "Blacklisted"
      ).withArgs(
        user.address
      ).and.to.emit(
        blacklistableMock, "SelfBlacklisted"
      ).withArgs(
        user.address
      );
      expect(await blacklistableMock.isBlacklisted(user.address)).to.equal(true);

      // The second call should not emit an event
      await expect(
        blacklistableMock.connect(user).selfBlacklist()
      ).not.to.emit(blacklistableMock, "SelfBlacklisted");
    });
  });

  describe("Modifier 'notBlacklisted'", async () => {
    it("Reverts the target function if the caller is blacklisted", async () => {
      await proveTx(blacklistableMock.setBlacklister(blacklister.address));
      await proveTx(blacklistableMock.connect(blacklister).blacklist(deployer.address));
      await expect(
        blacklistableMock.testNotBlacklistedModifier()
      ).to.be.revertedWithCustomError(blacklistableMock, REVERT_ERROR_IF_ACCOUNT_IS_BLACKLISTED);
    });

    it("Does not revert the target function if the caller is not blacklisted", async () => {
      await expect(
        blacklistableMock.connect(user).testNotBlacklistedModifier()
      ).to.emit(blacklistableMock, "TestNotBlacklistedModifierSucceeded");
    });
  });
});
