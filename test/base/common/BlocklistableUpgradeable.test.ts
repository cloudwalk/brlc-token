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

describe("Contract 'BlocklistableUpgradeable'", async () => {
  const EVENT_NAME_BLOCKLISTED = "Blocklisted";
  const EVENT_NAME_UNBLOCKLISTED = "UnBlocklisted";
  const EVENT_NAME_SELFBLOCKLISTED = "SelfBlocklisted";
  const EVENT_NAME_MAIN_BLOCKLISTER_CHANGED = "MainBlockListerChanged";
  const EVENT_NAME_BLOCKLISTER_CHANGED = "BlocklisterConfigured";
  const EVENT_NAME_TEST_NOT_BLOCKLISTED_MODIFIER_SUCCEEDED = "TestNotBlocklistedModifierSucceeded";
  const EVENT_NAME_TEST_NOT_BLOCKLISTED_OR_BYPASS_IF_BLOCKLISTER_MODIFIER_SUCCEEDED =
    "TestNotBlocklistedOrBypassIfBlocklisterModifierSucceeded";
  const EVENT_NAME_BLOCKLIST_ENABLED = "BlocklistEnabled";

  const REVERT_MESSAGE_INITIALIZABLE_CONTRACT_IS_ALREADY_INITIALIZED = "Initializable: contract is already initialized";
  const REVERT_MESSAGE_INITIALIZABLE_CONTRACT_IS_NOT_INITIALIZING = "Initializable: contract is not initializing";
  const REVERT_MESSAGE_OWNABLE_CALLER_IS_NOT_THE_OWNER = "Ownable: caller is not the owner";

  const REVERT_ERROR_UNAUTHORIZED_BLOCKLISTER = "UnauthorizedBlocklister";
  const REVERT_ERROR_UNAUTHORIZED_MAIN_BLOCKLISTER = "UnauthorizedMainBlocklister";
  const REVERT_ERROR_BLOCKLISTED_ACCOUNT = "BlocklistedAccount";
  const REVERT_ERROR_ZERO_ADDRESS_BLOCKLISTED = "ZeroAddressToBlocklist";
  const REVERT_ERROR_ALREADY_CONFIGURED = "AlreadyConfigured";

  const ZERO_ADDRESS = ethers.ZeroAddress;

  let blocklistableFactory: ContractFactory;

  let deployer: HardhatEthersSigner;
  let blocklister: HardhatEthersSigner;
  let user: HardhatEthersSigner;

  before(async () => {
    [deployer, blocklister, user] = await ethers.getSigners();
    blocklistableFactory = await ethers.getContractFactory("BlocklistableUpgradeableMock");
    blocklistableFactory = blocklistableFactory.connect(deployer); // Explicitly specifying the deployer account
  });

  async function deployBlocklistable(): Promise<{ blocklistable: Contract }> {
    let blocklistable: Contract = await upgrades.deployProxy(blocklistableFactory);
    await blocklistable.waitForDeployment();
    blocklistable = connect(blocklistable, deployer); // Explicitly specifying the initial account
    await proveTx(blocklistable.enableBlocklist(true));
    return { blocklistable };
  }

  async function deployAndConfigureBlocklistable(): Promise<{
    blocklistable: Contract;
  }> {
    const { blocklistable } = await deployBlocklistable();
    await proveTx(blocklistable.setMainBlocklister(deployer.address));
    await proveTx(blocklistable.configureBlocklister(blocklister.address, true));
    return { blocklistable };
  }

  describe("Function 'initialize()'", async () => {
    it("Configures the contract as expected", async () => {
      const { blocklistable } = await setUpFixture(deployBlocklistable);
      expect(await blocklistable.owner()).to.equal(deployer.address);
      expect(await blocklistable.mainBlocklister()).to.equal(ZERO_ADDRESS);
    });

    it("Is reverted if called for the second time", async () => {
      const { blocklistable } = await setUpFixture(deployBlocklistable);
      await expect(
        blocklistable.initialize()
      ).to.be.revertedWith(REVERT_MESSAGE_INITIALIZABLE_CONTRACT_IS_ALREADY_INITIALIZED);
    });

    it("Is reverted if the implementation contract is called even for the first time", async () => {
      const blocklistableImplementation: Contract = await blocklistableFactory.deploy() as Contract;
      await blocklistableImplementation.waitForDeployment();
      await expect(
        blocklistableImplementation.initialize()
      ).to.be.revertedWith(REVERT_MESSAGE_INITIALIZABLE_CONTRACT_IS_ALREADY_INITIALIZED);
    });

    it("Is reverted if the internal initializer is called outside of the init process", async () => {
      const { blocklistable } = await setUpFixture(deployBlocklistable);
      await expect(
        blocklistable.call_parent_initialize()
      ).to.be.revertedWith(REVERT_MESSAGE_INITIALIZABLE_CONTRACT_IS_NOT_INITIALIZING);
    });

    it("Is reverted if the internal unchained initializer is called outside of the init process", async () => {
      const { blocklistable } = await setUpFixture(deployBlocklistable);
      await expect(
        blocklistable.call_parent_initialize_unchained()
      ).to.be.revertedWith(REVERT_MESSAGE_INITIALIZABLE_CONTRACT_IS_NOT_INITIALIZING);
    });
  });

  describe("Function 'enableBlocklist()'", async () => {
    it("Executes as expected and emits the correct event", async () => {
      const { blocklistable } = await setUpFixture(deployBlocklistable);
      expect(await blocklistable.isBlocklistEnabled()).to.equal(true);
      await expect(blocklistable.enableBlocklist(false))
        .to.emit(blocklistable, EVENT_NAME_BLOCKLIST_ENABLED)
        .withArgs(false);
      expect(await blocklistable.isBlocklistEnabled()).to.equal(false);
      await expect(blocklistable.enableBlocklist(true))
        .to.emit(blocklistable, EVENT_NAME_BLOCKLIST_ENABLED)
        .withArgs(true);
      expect(await blocklistable.isBlocklistEnabled()).to.equal(true);
    });

    it("Is reverted if blocklist is already enabled", async () => {
      const { blocklistable } = await setUpFixture(deployBlocklistable);
      expect(await blocklistable.isBlocklistEnabled()).to.equal(true);
      await expect(
        blocklistable.enableBlocklist(true)
      ).to.be.revertedWithCustomError(blocklistable, REVERT_ERROR_ALREADY_CONFIGURED);
    });

    it("Is reverted if blocklist already disabled", async () => {
      const { blocklistable } = await setUpFixture(deployBlocklistable);
      await proveTx(blocklistable.enableBlocklist(false));
      expect(await blocklistable.isBlocklistEnabled()).to.equal(false);
      await expect(
        blocklistable.enableBlocklist(false)
      ).to.be.revertedWithCustomError(blocklistable, REVERT_ERROR_ALREADY_CONFIGURED);
    });

    it("Is reverted if called not by the owner", async () => {
      const { blocklistable } = await setUpFixture(deployBlocklistable);
      await expect(
        connect(blocklistable, user).enableBlocklist(true)
      ).to.be.revertedWith(REVERT_MESSAGE_OWNABLE_CALLER_IS_NOT_THE_OWNER);
    });
  });

  describe("Function 'setMainBlocklister()'", async () => {
    it("Executes as expected and emits the correct event", async () => {
      const { blocklistable } = await setUpFixture(deployBlocklistable);
      expect(await blocklistable.mainBlocklister()).not.to.equal(blocklister.address);
      await expect(blocklistable.setMainBlocklister(blocklister.address))
        .to.emit(blocklistable, EVENT_NAME_MAIN_BLOCKLISTER_CHANGED)
        .withArgs(blocklister.address);
      expect(await blocklistable.mainBlocklister()).to.equal(blocklister.address);
    });

    it("Is reverted if called not by the owner", async () => {
      const { blocklistable } = await setUpFixture(deployBlocklistable);
      await expect(
        connect(blocklistable, user).setMainBlocklister(user.address)
      ).to.be.revertedWith(REVERT_MESSAGE_OWNABLE_CALLER_IS_NOT_THE_OWNER);
    });

    it("Is reverted the the account is already a main blocklister", async () => {
      const { blocklistable } = await setUpFixture(deployAndConfigureBlocklistable);
      expect(await blocklistable.mainBlocklister()).to.eq(deployer.address);
      await expect(
        blocklistable.setMainBlocklister(deployer.address)
      ).to.be.revertedWithCustomError(blocklistable, REVERT_ERROR_ALREADY_CONFIGURED);
    });
  });

  describe("Function 'blocklist()'", async () => {
    it("Executes as expected and emits the correct event if it is called by the blocklister", async () => {
      const { blocklistable } = await setUpFixture(deployAndConfigureBlocklistable);
      expect(await blocklistable.isBlocklisted(user.address)).to.equal(false);
      await expect(connect(blocklistable, blocklister).blocklist(user.address))
        .to.emit(blocklistable, EVENT_NAME_BLOCKLISTED)
        .withArgs(user.address);
      expect(await blocklistable.isBlocklisted(user.address)).to.equal(true);
      await expect(
        connect(blocklistable, blocklister).blocklist(user.address)
      ).not.to.emit(blocklistable, EVENT_NAME_BLOCKLISTED);
    });

    it("Is reverted if called not by the blocklister", async () => {
      const { blocklistable } = await setUpFixture(deployAndConfigureBlocklistable);
      await expect(connect(blocklistable, user).blocklist(user.address))
        .to.be.revertedWithCustomError(blocklistable, REVERT_ERROR_UNAUTHORIZED_BLOCKLISTER)
        .withArgs(user.address);
    });

    it("Is reverted if blocklisted address is zero", async () => {
      const { blocklistable } = await setUpFixture(deployAndConfigureBlocklistable);
      await expect(
        connect(blocklistable, blocklister).blocklist(ZERO_ADDRESS)
      ).to.be.revertedWithCustomError(blocklistable, REVERT_ERROR_ZERO_ADDRESS_BLOCKLISTED);
    });
  });

  describe("Function 'unBlocklist()'", async () => {
    it("Executes as expected and emits the correct event if it is called by the blocklister", async () => {
      const { blocklistable } = await setUpFixture(deployAndConfigureBlocklistable);
      await proveTx(connect(blocklistable, blocklister).blocklist(user.address));
      expect(await blocklistable.isBlocklisted(user.address)).to.equal(true);
      await expect(connect(blocklistable, blocklister).unBlocklist(user.address))
        .to.emit(blocklistable, EVENT_NAME_UNBLOCKLISTED)
        .withArgs(user.address);
      expect(await blocklistable.isBlocklisted(user.address)).to.equal(false);
      await expect(
        connect(blocklistable, blocklister).unBlocklist(user.address)
      ).not.to.emit(blocklistable, EVENT_NAME_UNBLOCKLISTED);
    });

    it("Is reverted if called not by the blocklister", async () => {
      const { blocklistable } = await setUpFixture(deployAndConfigureBlocklistable);
      await expect(connect(blocklistable, user).unBlocklist(user.address))
        .to.be.revertedWithCustomError(blocklistable, REVERT_ERROR_UNAUTHORIZED_BLOCKLISTER)
        .withArgs(user.address);
    });
  });

  describe("Function 'selfBlocklist()'", async () => {
    it("Executes as expected and emits the correct events if it is called by any account", async () => {
      const { blocklistable } = await setUpFixture(deployAndConfigureBlocklistable);
      expect(await blocklistable.isBlocklisted(user.address)).to.equal(false);
      await expect(connect(blocklistable, user).selfBlocklist())
        .to.emit(blocklistable, EVENT_NAME_BLOCKLISTED)
        .withArgs(user.address)
        .and.to.emit(blocklistable, EVENT_NAME_SELFBLOCKLISTED)
        .withArgs(user.address);
      expect(await blocklistable.isBlocklisted(user.address)).to.equal(true);
      await expect(
        connect(blocklistable, user).selfBlocklist()
      ).not.to.emit(blocklistable, EVENT_NAME_SELFBLOCKLISTED);
    });
  });

  describe("Function 'configureBlocklister()'", async () => {
    it("Executes as expected and emits the correct event", async () => {
      const { blocklistable } = await setUpFixture(deployAndConfigureBlocklistable);
      expect(await blocklistable.isBlocklister(user.address)).to.equal(false);
      await expect(blocklistable.configureBlocklister(user.address, true))
        .to.emit(blocklistable, EVENT_NAME_BLOCKLISTER_CHANGED)
        .withArgs(user.address, true);

      expect(await blocklistable.isBlocklister(user.address)).to.equal(true);
      await proveTx(blocklistable.configureBlocklister(user.address, false));
      expect(await blocklistable.isBlocklister(user.address)).to.equal(false);
    });

    it("Is reverted if called not by the main blocklister", async () => {
      const { blocklistable } = await setUpFixture(deployAndConfigureBlocklistable);
      await expect(connect(blocklistable, user).configureBlocklister(user.address, true))
        .to.be.revertedWithCustomError(blocklistable, REVERT_ERROR_UNAUTHORIZED_MAIN_BLOCKLISTER)
        .withArgs(user.address);
    });

    it("Is reverted if the account is already configured", async () => {
      const { blocklistable } = await setUpFixture(deployAndConfigureBlocklistable);
      await expect(blocklistable.configureBlocklister(user.address, true))
        .to.emit(blocklistable, EVENT_NAME_BLOCKLISTER_CHANGED)
        .withArgs(user.address, true);
      await expect(
        blocklistable.configureBlocklister(user.address, true)
      ).to.be.revertedWithCustomError(blocklistable, REVERT_ERROR_ALREADY_CONFIGURED);
    });
  });

  describe("Modifier 'notBlocklisted'", async () => {
    it("Is not reverted if the caller is not blocklisted", async () => {
      const { blocklistable } = await setUpFixture(deployAndConfigureBlocklistable);
      expect(await blocklistable.isBlocklistEnabled()).to.equal(true);
      await expect(
        connect(blocklistable, user).testNotBlocklistedModifier()
      ).to.emit(blocklistable, EVENT_NAME_TEST_NOT_BLOCKLISTED_MODIFIER_SUCCEEDED);
    });

    it("Is not reverted if the caller is blocklisted and blocklist is disabled", async () => {
      const { blocklistable } = await setUpFixture(deployAndConfigureBlocklistable);
      await proveTx(blocklistable.blocklist(user.address));
      await proveTx(blocklistable.enableBlocklist(false));
      await expect(
        connect(blocklistable, user).testNotBlocklistedModifier()
      ).to.emit(blocklistable, EVENT_NAME_TEST_NOT_BLOCKLISTED_MODIFIER_SUCCEEDED);
    });

    it("Is reverted if the caller is blocklisted", async () => {
      const { blocklistable } = await setUpFixture(deployAndConfigureBlocklistable);
      await proveTx(connect(blocklistable, blocklister).blocklist(user.address));
      await expect(connect(blocklistable, user).testNotBlocklistedModifier())
        .to.be.revertedWithCustomError(blocklistable, REVERT_ERROR_BLOCKLISTED_ACCOUNT)
        .withArgs(user.address);
    });
  });

  describe("Modifier 'notBlocklistedOrBypassIfBlocklister'", async () => {
    it("Is not reverted if the caller not blocklisted", async () => {
      const { blocklistable } = await setUpFixture(deployAndConfigureBlocklistable);
      expect(await blocklistable.isBlocklistEnabled()).to.equal(true);
      await expect(
        connect(blocklistable, user).testNotBlocklistedOrBypassIfBlocklister()
      ).to.emit(blocklistable, EVENT_NAME_TEST_NOT_BLOCKLISTED_OR_BYPASS_IF_BLOCKLISTER_MODIFIER_SUCCEEDED);
    });

    it("Is not reverted if the caller is blocklisted and is blocklister", async () => {
      const { blocklistable } = await setUpFixture(deployAndConfigureBlocklistable);
      expect(await blocklistable.isBlocklistEnabled()).to.equal(true);
      await proveTx(connect(blocklistable, blocklister).blocklist(user.address));
      await proveTx(blocklistable.configureBlocklister(user.address, true));
      await expect(
        connect(blocklistable, user).testNotBlocklistedOrBypassIfBlocklister()
      ).to.emit(blocklistable, EVENT_NAME_TEST_NOT_BLOCKLISTED_OR_BYPASS_IF_BLOCKLISTER_MODIFIER_SUCCEEDED);
    });

    it("Is not reverted if the caller is blocklisted and blocklist is disabled", async () => {
      const { blocklistable } = await setUpFixture(deployAndConfigureBlocklistable);
      await proveTx(connect(blocklistable, blocklister).blocklist(user.address));
      await proveTx(blocklistable.enableBlocklist(false));
      await expect(
        connect(blocklistable, user).testNotBlocklistedOrBypassIfBlocklister()
      ).to.emit(blocklistable, EVENT_NAME_TEST_NOT_BLOCKLISTED_OR_BYPASS_IF_BLOCKLISTER_MODIFIER_SUCCEEDED);
    });

    it("Is reverted if the caller is blocklisted and isn't blocklister", async () => {
      const { blocklistable } = await setUpFixture(deployAndConfigureBlocklistable);
      expect(await blocklistable.isBlocklistEnabled()).to.equal(true);
      await proveTx(connect(blocklistable, blocklister).blocklist(user.address));
      await expect(connect(blocklistable, user).testNotBlocklistedOrBypassIfBlocklister())
        .to.be.revertedWithCustomError(blocklistable, REVERT_ERROR_BLOCKLISTED_ACCOUNT)
        .withArgs(user.address);
    });
  });

  describe("Backward Compatibility functions", async () => {
    it("Function 'blacklist()' executes as expected if it is called by the blocklister", async () => {
      const { blocklistable } = await setUpFixture(deployAndConfigureBlocklistable);
      expect(await blocklistable.isBlocklisted(user.address)).to.equal(false);
      await expect(connect(blocklistable, blocklister).blacklist(user.address))
        .to.emit(blocklistable, EVENT_NAME_BLOCKLISTED)
        .withArgs(user.address);
      expect(await blocklistable.isBlocklisted(user.address)).to.equal(true);
      await expect(
        connect(blocklistable, blocklister).blacklist(user.address)
      ).not.to.emit(blocklistable, EVENT_NAME_BLOCKLISTED);
    });

    it("Function 'blacklist()' is reverted if called not by the blocklister", async () => {
      const { blocklistable } = await setUpFixture(deployAndConfigureBlocklistable);
      await expect(connect(blocklistable, user).blacklist(user.address))
        .to.be.revertedWithCustomError(blocklistable, REVERT_ERROR_UNAUTHORIZED_BLOCKLISTER)
        .withArgs(user.address);
    });

    it("Function 'blacklist()' is reverted if blocklisted address is zero", async () => {
      const { blocklistable } = await setUpFixture(deployAndConfigureBlocklistable);
      await expect(
        connect(blocklistable, blocklister).blacklist(ZERO_ADDRESS)
      ).to.be.revertedWithCustomError(blocklistable, REVERT_ERROR_ZERO_ADDRESS_BLOCKLISTED);
    });

    it("Function 'unBlacklist()' executes as expected if it is called by the blocklister", async () => {
      const { blocklistable } = await setUpFixture(deployAndConfigureBlocklistable);
      await proveTx(connect(blocklistable, blocklister).blacklist(user.address));
      expect(await blocklistable.isBlocklisted(user.address)).to.equal(true);
      await expect(connect(blocklistable, blocklister).unBlacklist(user.address))
        .to.emit(blocklistable, EVENT_NAME_UNBLOCKLISTED)
        .withArgs(user.address);
      expect(await blocklistable.isBlocklisted(user.address)).to.equal(false);
      await expect(
        connect(blocklistable, blocklister).unBlacklist(user.address)
      ).not.to.emit(blocklistable, EVENT_NAME_UNBLOCKLISTED);
    });

    it("Function 'unBlacklist()' is reverted if called not by the blocklister", async () => {
      const { blocklistable } = await setUpFixture(deployAndConfigureBlocklistable);
      await expect(connect(blocklistable, user).unBlacklist(user.address))
        .to.be.revertedWithCustomError(blocklistable, REVERT_ERROR_UNAUTHORIZED_BLOCKLISTER)
        .withArgs(user.address);
    });

    it("Function 'selfBlacklist()' executes as expected if it is called by any account", async () => {
      const { blocklistable } = await setUpFixture(deployAndConfigureBlocklistable);
      expect(await blocklistable.isBlocklisted(user.address)).to.equal(false);
      await expect(connect(blocklistable, user).selfBlacklist())
        .to.emit(blocklistable, EVENT_NAME_BLOCKLISTED)
        .withArgs(user.address)
        .and.to.emit(blocklistable, EVENT_NAME_SELFBLOCKLISTED)
        .withArgs(user.address);
      expect(await blocklistable.isBlocklisted(user.address)).to.equal(true);
      await expect(
        connect(blocklistable, user).selfBlacklist()
      ).not.to.emit(blocklistable, EVENT_NAME_SELFBLOCKLISTED);
    });

    it("Function 'isBlacklisted' executes as expected", async () => {
      const { blocklistable } = await setUpFixture(deployAndConfigureBlocklistable);
      expect(await blocklistable.isBlacklisted(user.address)).to.equal(false);
      await proveTx(connect(blocklistable, user).selfBlocklist());
      expect(await blocklistable.isBlacklisted(user.address)).to.equal(true);
    });
  });
});
