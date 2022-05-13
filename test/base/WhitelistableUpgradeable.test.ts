import { ethers, upgrades } from "hardhat";
import { expect } from "chai";
import { Contract, ContractFactory } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import { proveTx } from "../../test-utils/eth";

describe("Contract 'WhitelistableUpgradeable'", async () => {
  const REVERT_MESSAGE_IF_CALLER_IS_NOT_OWNER = "Ownable: caller is not the owner";
  const REVERT_MESSAGE_IF_CALLER_IS_NOT_WHITELISTER = "Whitelistable: caller is not the whitelister";
  const REVERT_MESSAGE_IF_ACCOUNT_IS_NOT_WHITELISTED = 'Whitelistable: account is not whitelisted';
  const REVERT_MESSAGE_IF_CONTRACT_IS_ALREADY_INITIALIZED = 'Initializable: contract is already initialized';
  const REVERT_MESSAGE_IF_CALLER_IS_NOT_WHITELIST_ADMIN = 'Whitelistable: caller is not the whitelist admin';

  let whitelistableMock: Contract;
  let deployer: SignerWithAddress;
  let user: SignerWithAddress;

  beforeEach(async () => {
    const WhitelistableMock: ContractFactory = await ethers.getContractFactory("WhitelistableUpgradeableMock");
    whitelistableMock = await upgrades.deployProxy(WhitelistableMock);
    await whitelistableMock.deployed();

    [deployer, user] = await ethers.getSigners();
  });

  it("The initialize function can't be called more than once", async () => {
    await expect(whitelistableMock.initialize())
      .to.be.revertedWith(REVERT_MESSAGE_IF_CONTRACT_IS_ALREADY_INITIALIZED);
  });

  it("The initialize unchained function can't be called more than once", async () => {
    await expect(whitelistableMock.initialize_unchained())
      .to.be.revertedWith(REVERT_MESSAGE_IF_CONTRACT_IS_ALREADY_INITIALIZED);
  });

  describe("Function 'setWhitelistAdmin()'", async () => {
    it("Is reverted if is called not by the owner", async () => {
      await expect(whitelistableMock.connect(user).setWhitelistAdmin(deployer.address))
        .to.be.revertedWith(REVERT_MESSAGE_IF_CALLER_IS_NOT_OWNER);
    });

    it("Executes successfully if is called by the owner", async () => {
      const expectedWhitelistAdminAddress: string = user.address;
      await proveTx(whitelistableMock.setWhitelistAdmin(expectedWhitelistAdminAddress));
      const actualWhitelistAdminAddress: string = await whitelistableMock.getWhitelistAdmin();
      expect(actualWhitelistAdminAddress).to.equal(expectedWhitelistAdminAddress);
    });

    it("Emits the correct event", async () => {
      const whitelistAdminAddress: string = user.address;
      await expect(whitelistableMock.setWhitelistAdmin(whitelistAdminAddress))
        .to.emit(whitelistableMock, "WhitelistAdminChanged")
        .withArgs(whitelistAdminAddress);
    });
  });

  describe("Modifier 'onlyWhitelistAdmin'", async () => {
    it("Reverts the target function if the caller is not a whitelist admin", async () => {
      await expect(whitelistableMock.testOnlyWhitelistAdminModifier())
        .to.be.revertedWith(REVERT_MESSAGE_IF_CALLER_IS_NOT_WHITELIST_ADMIN);
    });

    it("Does not revert the target function if the caller is the whitelist admin", async () => {
      await proveTx(whitelistableMock.setWhitelistAdmin(user.address));
      await expect(whitelistableMock.connect(user).testOnlyWhitelistAdminModifier())
        .to.emit(whitelistableMock, "TestOnlyWhitelistAdminModifierSucceeded");
    });
  });

  describe("Function 'isWhitelistEnabled()'", async () => {
    it("Returns an expected value", async () => {
      let valueOfWhitelistEnabling: boolean = true;
      await proveTx(whitelistableMock.setWhitelistEnabled(valueOfWhitelistEnabling));

      expect(await whitelistableMock.isWhitelistEnabled()).to.equal(valueOfWhitelistEnabling);

      valueOfWhitelistEnabling = false;
      await proveTx(whitelistableMock.setWhitelistEnabled(valueOfWhitelistEnabling));

      expect(await whitelistableMock.isWhitelistEnabled()).to.equal(valueOfWhitelistEnabling);
    });
  });

  describe("Function 'whitelist()'", async () => {
    beforeEach(async () => {
      await proveTx(whitelistableMock.setStubWhitelister(user.address));
    });

    it("Is reverted if is called not by a whitelister", async () => {
      await expect(whitelistableMock.whitelist(user.address))
        .to.be.revertedWith(REVERT_MESSAGE_IF_CALLER_IS_NOT_WHITELISTER);
    });

    it("Executes successfully if is called by a whitelister", async () => {
      expect(await whitelistableMock.isWhitelisted(deployer.address)).to.equal(false);
      await proveTx(whitelistableMock.connect(user).whitelist(deployer.address));
      expect(await whitelistableMock.isWhitelisted(deployer.address)).to.equal(true);
    });

    it("Emits the correct event", async () => {
      await expect(whitelistableMock.connect(user).whitelist(deployer.address))
        .to.emit(whitelistableMock, "Whitelisted")
        .withArgs(deployer.address);
    });
  });

  describe("Function 'unWhitelist()'", async () => {
    beforeEach(async () => {
      await proveTx(whitelistableMock.setStubWhitelister(user.address));
      await proveTx(whitelistableMock.connect(user).whitelist(deployer.address));
    });

    it("Is reverted if is called not by a whitelister", async () => {
      await expect(whitelistableMock.unWhitelist(user.address))
        .to.be.revertedWith(REVERT_MESSAGE_IF_CALLER_IS_NOT_WHITELISTER);
    });

    it("Executes successfully if is called by a whitelister", async () => {
      expect(await whitelistableMock.isWhitelisted(deployer.address)).to.equal(true);
      await proveTx(whitelistableMock.connect(user).unWhitelist(deployer.address));
      expect(await whitelistableMock.isWhitelisted(deployer.address)).to.equal(false);
    });

    it("Emits the correct event", async () => {
      await expect(whitelistableMock.connect(user).unWhitelist(user.address))
        .to.emit(whitelistableMock, "UnWhitelisted")
        .withArgs(user.address);
    });
  });

  describe("Modifier 'onlyWhitelisted'", async () => {
    beforeEach(async () => {
      await proveTx(whitelistableMock.setWhitelistEnabled(true));
      await proveTx(whitelistableMock.setStubWhitelister(user.address));
    })

    it("Reverts the target function if the caller is not whitelisted", async () => {
      await expect(whitelistableMock.testOnlyWhitelistedModifier())
        .to.be.revertedWith(REVERT_MESSAGE_IF_ACCOUNT_IS_NOT_WHITELISTED);
    });

    it("Does not revert the target function if the caller is whitelisted", async () => {
      await proveTx(whitelistableMock.connect(user).whitelist(deployer.address));
      await expect(whitelistableMock.testOnlyWhitelistedModifier())
        .to.emit(whitelistableMock, "TestOnlyWhitelistedModifierSucceeded");
    });

    it("Does not revert the target function if the whitelist is disabled", async () => {
      await proveTx(whitelistableMock.connect(user).unWhitelist(deployer.address));
      await proveTx(whitelistableMock.setWhitelistEnabled(false));
      await expect(whitelistableMock.testOnlyWhitelistedModifier())
        .to.emit(whitelistableMock, "TestOnlyWhitelistedModifierSucceeded");
    });
  });
});
