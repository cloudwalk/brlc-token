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

describe("Contract 'BlacklistableUpgradeable'", async () => {
  const EVENT_NAME_BLACKLISTED = "Blacklisted";
  const EVENT_NAME_BLACKLISTER_CHANGED = "BlacklisterChanged";
  const EVENT_NAME_SELFBLACKLISTED = "SelfBlacklisted";
  const EVENT_NAME_TEST_NOT_BLACKLISTED_MODIFIER_SUCCEEDED = "TestNotBlacklistedModifierSucceeded";
  const EVENT_NAME_UNBLACKLISTED = "UnBlacklisted";

  const REVERT_MESSAGE_IF_CONTRACT_IS_ALREADY_INITIALIZED = "Initializable: contract is already initialized";
  const REVERT_MESSAGE_IF_CONTRACT_IS_NOT_INITIALIZING = "Initializable: contract is not initializing";
  const REVERT_MESSAGE_IF_CALLER_IS_NOT_OWNER = "Ownable: caller is not the owner";

  const REVERT_ERROR_IF_CALLER_IS_NOT_BLACKLISTER = "UnauthorizedBlacklister";
  const REVERT_ERROR_IF_ACCOUNT_IS_BLACKLISTED = "BlacklistedAccount";

  let blacklistableMockFactory: ContractFactory;

  let deployer: SignerWithAddress;
  let blacklister: SignerWithAddress;
  let user: SignerWithAddress;

  before(async () => {
    [deployer, blacklister, user] = await ethers.getSigners();
    blacklistableMockFactory = await ethers.getContractFactory("BlacklistableUpgradeableMock");
  });

  async function deployBlacklistableMock(): Promise<{ blacklistableMock: Contract }> {
    const blacklistableMock: Contract = await upgrades.deployProxy(blacklistableMockFactory);
    await blacklistableMock.deployed();
    return { blacklistableMock };
  }

  async function deployAndConfigureBlacklistableMock(): Promise<{ blacklistableMock: Contract }> {
    const { blacklistableMock } = await deployBlacklistableMock();
    await proveTx(blacklistableMock.setBlacklister(blacklister.address));
    return { blacklistableMock };
  }

  describe("Initializers", async () => {
    it("The external initializer configures the contract as expected", async () => {
      const { blacklistableMock } = await setUpFixture(deployBlacklistableMock);
      expect(await blacklistableMock.owner()).to.equal(deployer.address);
      expect(await blacklistableMock.blacklister()).to.equal(ethers.constants.AddressZero);
    });

    it("The external initializer is reverted if it is called a second time", async () => {
      const { blacklistableMock } = await setUpFixture(deployBlacklistableMock);
      await expect(
        blacklistableMock.initialize()
      ).to.be.revertedWith(REVERT_MESSAGE_IF_CONTRACT_IS_ALREADY_INITIALIZED);
    });

    it("The internal initializer is reverted if it is called outside the init process", async () => {
      const { blacklistableMock } = await setUpFixture(deployBlacklistableMock);
      await expect(
        blacklistableMock.call_parent_initialize()
      ).to.be.revertedWith(REVERT_MESSAGE_IF_CONTRACT_IS_NOT_INITIALIZING);
    });

    it("The internal unchained initializer is reverted if it is called outside the init process", async () => {
      const { blacklistableMock } = await setUpFixture(deployBlacklistableMock);
      await expect(
        blacklistableMock.call_parent_initialize_unchained()
      ).to.be.revertedWith(REVERT_MESSAGE_IF_CONTRACT_IS_NOT_INITIALIZING);
    });
  });

  describe("Function 'setBlacklister()'", async () => {
    it("Executes as expected and emits the correct event", async () => {
      const { blacklistableMock } = await setUpFixture(deployBlacklistableMock);

      await expect(
        blacklistableMock.setBlacklister(blacklister.address)
      ).to.emit(
        blacklistableMock,
        EVENT_NAME_BLACKLISTER_CHANGED
      ).withArgs(blacklister.address);
      expect(await blacklistableMock.blacklister()).to.equal(blacklister.address);

      // The second call with the same argument should not emit an event
      await expect(
        blacklistableMock.setBlacklister(blacklister.address)
      ).not.to.emit(blacklistableMock, EVENT_NAME_BLACKLISTER_CHANGED);
    });

    it("Is reverted if it is called not by the owner", async () => {
      const { blacklistableMock } = await setUpFixture(deployBlacklistableMock);
      await expect(
        blacklistableMock.connect(blacklister).setBlacklister(blacklister.address)
      ).to.be.revertedWith(REVERT_MESSAGE_IF_CALLER_IS_NOT_OWNER);
    });
  });

  describe("Function 'blacklist()'", async () => {
    it("Executes as expected and emits the correct event if it is called by the blacklister", async () => {
      const { blacklistableMock } = await setUpFixture(deployAndConfigureBlacklistableMock);
      expect(await blacklistableMock.isBlacklisted(user.address)).to.equal(false);

      await expect(
        blacklistableMock.connect(blacklister).blacklist(user.address)
      ).to.emit(
        blacklistableMock,
        EVENT_NAME_BLACKLISTED
      ).withArgs(user.address);
      expect(await blacklistableMock.isBlacklisted(user.address)).to.equal(true);

      // The second call with the same argument should not emit an event
      await expect(
        blacklistableMock.connect(blacklister).blacklist(user.address)
      ).not.to.emit(blacklistableMock, EVENT_NAME_BLACKLISTED);
    });

    it("Is reverted if it is called not by the blacklister", async () => {
      const { blacklistableMock } = await setUpFixture(deployAndConfigureBlacklistableMock);
      await expect(
        blacklistableMock.blacklist(user.address)
      ).to.be.revertedWithCustomError(blacklistableMock, REVERT_ERROR_IF_CALLER_IS_NOT_BLACKLISTER);
    });
  });

  describe("Function 'unBlacklist()'", async () => {
    it("Executes as expected and emits the correct event if it is called by the blacklister", async () => {
      const { blacklistableMock } = await setUpFixture(deployAndConfigureBlacklistableMock);
      await proveTx(blacklistableMock.connect(blacklister).blacklist(user.address));
      expect(await blacklistableMock.isBlacklisted(user.address)).to.equal(true);

      await expect(
        blacklistableMock.connect(blacklister).unBlacklist(user.address)
      ).to.emit(
        blacklistableMock,
        EVENT_NAME_UNBLACKLISTED
      ).withArgs(user.address);
      expect(await blacklistableMock.isBlacklisted(user.address)).to.equal(false);

      // The second call with the same argument should not emit an event
      await expect(
        blacklistableMock.connect(blacklister).unBlacklist(user.address)
      ).not.to.emit(blacklistableMock, EVENT_NAME_UNBLACKLISTED);
    });

    it("Is reverted if it is called not by the blacklister", async () => {
      const { blacklistableMock } = await setUpFixture(deployAndConfigureBlacklistableMock);
      await expect(
        blacklistableMock.unBlacklist(user.address)
      ).to.be.revertedWithCustomError(blacklistableMock, REVERT_ERROR_IF_CALLER_IS_NOT_BLACKLISTER);
    });
  });

  describe("Function 'selfBlacklist()'", async () => {
    it("Executes as expected and emits the correct events if it is called by any account", async () => {
      const { blacklistableMock } = await setUpFixture(deployAndConfigureBlacklistableMock);
      expect(await blacklistableMock.isBlacklisted(user.address)).to.equal(false);

      await expect(
        blacklistableMock.connect(user).selfBlacklist()
      ).to.emit(
        blacklistableMock,
        EVENT_NAME_BLACKLISTED
      ).withArgs(
        user.address
      ).and.to.emit(
        blacklistableMock,
        EVENT_NAME_SELFBLACKLISTED
      ).withArgs(
        user.address
      );

      expect(await blacklistableMock.isBlacklisted(user.address)).to.equal(true);

      // The second call should not emit an event
      await expect(
        blacklistableMock.connect(user).selfBlacklist()
      ).not.to.emit(blacklistableMock, EVENT_NAME_SELFBLACKLISTED);
    });
  });

  describe("Modifier 'notBlacklisted'", async () => {
    it("Reverts the target function if the caller is blacklisted", async () => {
      const { blacklistableMock } = await setUpFixture(deployAndConfigureBlacklistableMock);
      await proveTx(blacklistableMock.connect(blacklister).blacklist(deployer.address));

      await expect(
        blacklistableMock.testNotBlacklistedModifier()
      ).to.be.revertedWithCustomError(blacklistableMock, REVERT_ERROR_IF_ACCOUNT_IS_BLACKLISTED);
    });

    it("Does not revert the target function if the caller is not blacklisted", async () => {
      const { blacklistableMock } = await setUpFixture(deployAndConfigureBlacklistableMock);
      await expect(
        blacklistableMock.connect(user).testNotBlacklistedModifier()
      ).to.emit(blacklistableMock, EVENT_NAME_TEST_NOT_BLACKLISTED_MODIFIER_SUCCEEDED);
    });
  });
});
