import { ethers, upgrades } from "hardhat";
import { expect } from "chai";
import { Contract, ContractFactory } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import { proveTx } from "../../test-utils/eth";

describe("Contract 'BlacklistableUpgradeable'", async () => {
  const REVERT_MESSAGE_IF_CALLER_IS_NOT_OWNER = "Ownable: caller is not the owner";
  const REVERT_MESSAGE_IF_CALLER_IS_NOT_BLACKLISTER = "Blacklistable: caller is not the blacklister";
  const REVERT_MESSAGE_IF_ACCOUNT_IS_BLACKLISTED = 'Blacklistable: account is blacklisted';
  const REVERT_MESSAGE_IF_NEW_BLACKLISTER_IS_ZERO = 'Blacklistable: new blacklister is the zero address';
  const REVERT_MESSAGE_IF_CONTRACT_IS_ALREADY_INITIALIZED = 'Initializable: contract is already initialized';

  let blacklistableMock: Contract;
  let deployer: SignerWithAddress;
  let user1: SignerWithAddress;
  let user2: SignerWithAddress;

  beforeEach(async () => {
    const BlacklistableMock: ContractFactory = await ethers.getContractFactory("BlacklistableUpgradeableMock");
    blacklistableMock = await upgrades.deployProxy(BlacklistableMock);
    await blacklistableMock.deployed();

    [deployer, user1, user2] = await ethers.getSigners();
  });

  it("The initialize function can't be called more than once", async () => {
    await expect(blacklistableMock.initialize())
      .to.be.revertedWith(REVERT_MESSAGE_IF_CONTRACT_IS_ALREADY_INITIALIZED);
  });

  it("The initialize unchained function can't be called more than once", async () => {
    await expect(blacklistableMock.initialize_unchained())
      .to.be.revertedWith(REVERT_MESSAGE_IF_CONTRACT_IS_ALREADY_INITIALIZED);
  });

  describe("Function 'setBlacklister()'", async () => {
    it("Is reverted if is called not by the owner", async () => {
      await expect(blacklistableMock.connect(user1).setBlacklister(user1.address))
        .to.be.revertedWith(REVERT_MESSAGE_IF_CALLER_IS_NOT_OWNER);
    });

    it("Is reverted if is called with zero address", async () => {
      await expect(blacklistableMock.setBlacklister(ethers.constants.AddressZero))
        .to.be.revertedWith(REVERT_MESSAGE_IF_NEW_BLACKLISTER_IS_ZERO);
    });

    it("Executes successfully if is called by the owner", async () => {
      const expectedBlacklisterAddress: string = user1.address;
      await proveTx(blacklistableMock.setBlacklister(expectedBlacklisterAddress));
      const actualBlacklisterAddress: string = await blacklistableMock.getBlacklister();
      expect(actualBlacklisterAddress).to.equal(expectedBlacklisterAddress);
    });

    it("Emits the correct event", async () => {
      const blacklisterAddress: string = user1.address;
      await expect(blacklistableMock.setBlacklister(blacklisterAddress))
        .to.emit(blacklistableMock, "BlacklisterChanged")
        .withArgs(blacklisterAddress);
    });
  });

  describe("Function 'blacklist()'", async () => {
    beforeEach(async () => {
      await proveTx(blacklistableMock.setBlacklister(user1.address));
    });

    it("Is reverted if is called not by the blacklister", async () => {
      await expect(blacklistableMock.blacklist(user2.address))
        .to.be.revertedWith(REVERT_MESSAGE_IF_CALLER_IS_NOT_BLACKLISTER);
    });

    it("Executes successfully if is called by the blacklister", async () => {
      expect(await blacklistableMock.isBlacklisted(user2.address)).to.equal(false);
      await proveTx(blacklistableMock.connect(user1).blacklist(user2.address));
      expect(await blacklistableMock.isBlacklisted(user2.address)).to.equal(true);
    });

    it("Emits the correct event", async () => {
      await expect(blacklistableMock.connect(user1).blacklist(user2.address))
        .to.emit(blacklistableMock, "Blacklisted")
        .withArgs(user2.address);
    });
  });

  describe("Function 'unBlacklist()'", async () => {
    beforeEach(async () => {
      await proveTx(blacklistableMock.setBlacklister(user1.address));
      await proveTx(blacklistableMock.connect(user1).blacklist(user2.address));
    })

    it("Is reverted if is called not by the blacklister", async () => {
      await expect(blacklistableMock.unBlacklist(user2.address))
        .to.be.revertedWith(REVERT_MESSAGE_IF_CALLER_IS_NOT_BLACKLISTER);
    });

    it("Executes successfully if is called by the blacklister", async () => {
      expect(await blacklistableMock.isBlacklisted(user2.address)).to.equal(true);
      await proveTx(await blacklistableMock.connect(user1).unBlacklist(user2.address));
      expect(await blacklistableMock.isBlacklisted(user2.address)).to.equal(false);
    });

    it("Emits the correct event", async () => {
      await expect(blacklistableMock.connect(user1).unBlacklist(user2.address))
        .to.emit(blacklistableMock, "UnBlacklisted")
        .withArgs(user2.address);
    });
  });

  describe("Function 'selfBlacklist()'", async () => {
    it("Executes successfully if is called by the owner", async () => {
      expect(await blacklistableMock.isBlacklisted(deployer.address)).to.equal(false);
      await proveTx(blacklistableMock.selfBlacklist());
      expect(await blacklistableMock.isBlacklisted(deployer.address)).to.equal(true);
    });

    it("Executes successfully if is called by any account", async () => {
      expect(await blacklistableMock.isBlacklisted(user1.address)).to.equal(false);
      await proveTx(blacklistableMock.connect(user1).selfBlacklist());
      expect(await blacklistableMock.isBlacklisted(user1.address)).to.equal(true);
    });

    it("Emits the correct events", async () => {
      await expect(blacklistableMock.selfBlacklist())
        .to.emit(blacklistableMock, "Blacklisted")
        .withArgs(deployer.address)
        .to.emit(blacklistableMock, "SelfBlacklisted")
        .withArgs(deployer.address);
    });
  });

  describe("Modifier 'notBlacklisted'", async () => {
    it("Reverts the target function if the caller is blacklisted", async () => {
      await proveTx(blacklistableMock.setBlacklister(user1.address));
      await proveTx(blacklistableMock.connect(user1).blacklist(deployer.address));
      await expect(blacklistableMock.testNotBlacklistedModifier())
        .to.be.revertedWith(REVERT_MESSAGE_IF_ACCOUNT_IS_BLACKLISTED);
    });

    it("Does not revert the target function if the caller is not blacklisted", async () => {
      await expect(blacklistableMock.connect(user2).testNotBlacklistedModifier())
        .to.emit(blacklistableMock, "TestNotBlacklistedModifierSucceeded");
    });
  });
});
