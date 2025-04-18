import { ethers, upgrades } from "hardhat";
import { expect } from "chai";
import { Contract, TransactionResponse } from "ethers";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { connect, proveTx } from "../../test-utils/eth";
import { setUpFixture } from "../../test-utils/common";

describe("Contract 'AccessControlExtUpgradeable'", async () => {
  const EVENT_NAME_ROLE_GRANTED = "RoleGranted";
  const EVENT_NAME_ROLE_REVOKED = "RoleRevoked";

  const REVERT_ERROR_IF_CONTRACT_INITIALIZATION_IS_INVALID = "InvalidInitialization";
  const REVERT_ERROR_IF_CONTRACT_IS_NOT_INITIALIZING = "NotInitializing";
  const REVERT_ERROR_IF_UNAUTHORIZED_ACCOUNT = "AccessControlUnauthorizedAccount";

  const DEFAULT_ADMIN_ROLE: string = ethers.ZeroHash;
  const OWNER_ROLE: string = ethers.id("OWNER_ROLE");
  const USER_ROLE: string = ethers.id("USER_ROLE");

  let deployer: HardhatEthersSigner;
  let attacker: HardhatEthersSigner;
  let users: HardhatEthersSigner[];
  let userAddresses: string[];

  before(async () => {
    [deployer, attacker, ...users] = await ethers.getSigners();
    userAddresses = [users[0].address, users[1].address, users[2].address];
  });

  async function deployAccessControlExtMock(): Promise<{ accessControlExtMock: Contract }> {
    // The contract factory with the explicitly specified deployer account
    let accessControlExtMockFactory = await ethers.getContractFactory("AccessControlExtUpgradeableMock");
    accessControlExtMockFactory = accessControlExtMockFactory.connect(deployer);

    // The contract under test with the explicitly specified initial account
    let accessControlExtMock: Contract = await upgrades.deployProxy(accessControlExtMockFactory) as Contract;
    await accessControlExtMock.waitForDeployment();
    accessControlExtMock = connect(accessControlExtMock, deployer);

    return { accessControlExtMock };
  }

  describe("Function 'initialize()' and internal initializers", async () => {
    it("The external initializer configures the contract as expected", async () => {
      const { accessControlExtMock } = await setUpFixture(deployAccessControlExtMock);

      // The roles
      expect((await accessControlExtMock.OWNER_ROLE()).toLowerCase()).to.equal(OWNER_ROLE);
      expect((await accessControlExtMock.USER_ROLE()).toLowerCase()).to.equal(USER_ROLE);

      // The role admins
      expect(await accessControlExtMock.getRoleAdmin(OWNER_ROLE)).to.equal(DEFAULT_ADMIN_ROLE);
      expect(await accessControlExtMock.getRoleAdmin(USER_ROLE)).to.equal(OWNER_ROLE);

      // The deployer should have the owner role, but not the other roles
      expect(await accessControlExtMock.hasRole(OWNER_ROLE, deployer.address)).to.equal(true);
    });

    it("The external initializer is reverted if it is called a second time", async () => {
      const { accessControlExtMock } = await setUpFixture(deployAccessControlExtMock);
      await expect(
        accessControlExtMock.initialize()
      ).to.be.revertedWithCustomError(accessControlExtMock, REVERT_ERROR_IF_CONTRACT_INITIALIZATION_IS_INVALID);
    });

    it("The internal unchained initializer is reverted if it is called outside the init process", async () => {
      const { accessControlExtMock } = await setUpFixture(deployAccessControlExtMock);
      await expect(
        accessControlExtMock.callParentInitializerUnchained()
      ).to.be.revertedWithCustomError(accessControlExtMock, REVERT_ERROR_IF_CONTRACT_IS_NOT_INITIALIZING);
    });
  });

  describe("Function 'grantRoleBatch()'", async () => {
    describe("Executes as expected if the input account array contains", async () => {
      it("A single account without the previously granted role", async () => {
        const { accessControlExtMock } = await setUpFixture(deployAccessControlExtMock);
        expect(await accessControlExtMock.hasRole(USER_ROLE, userAddresses[0])).to.equal(false);

        await expect(
          accessControlExtMock.grantRoleBatch(USER_ROLE, [userAddresses[0]])
        ).to.emit(
          accessControlExtMock,
          EVENT_NAME_ROLE_GRANTED
        ).withArgs(USER_ROLE, userAddresses[0], deployer.address);

        expect(await accessControlExtMock.hasRole(USER_ROLE, userAddresses[0])).to.equal(true);
      });

      it("A single account with the previously granted role", async () => {
        const { accessControlExtMock } = await setUpFixture(deployAccessControlExtMock);
        await proveTx(accessControlExtMock.grantRoleBatch(USER_ROLE, [userAddresses[0]]));
        expect(await accessControlExtMock.hasRole(USER_ROLE, userAddresses[0])).to.equal(true);

        await expect(
          accessControlExtMock.grantRoleBatch(USER_ROLE, [userAddresses[0]])
        ).not.to.emit(accessControlExtMock, EVENT_NAME_ROLE_GRANTED);
      });

      it("Multiple accounts without the previously granted role", async () => {
        const { accessControlExtMock } = await setUpFixture(deployAccessControlExtMock);
        for (const userAddress of userAddresses) {
          expect(await accessControlExtMock.hasRole(USER_ROLE, userAddress)).to.equal(false);
        }

        const tx: Promise<TransactionResponse> = accessControlExtMock.grantRoleBatch(USER_ROLE, userAddresses);

        for (const userAddress of userAddresses) {
          await expect(tx)
            .to.emit(accessControlExtMock, EVENT_NAME_ROLE_GRANTED)
            .withArgs(USER_ROLE, userAddress, deployer.address);
          expect(await accessControlExtMock.hasRole(USER_ROLE, userAddress)).to.equal(true);
        }
      });

      it("No accounts", async () => {
        const { accessControlExtMock } = await setUpFixture(deployAccessControlExtMock);

        await expect(
          accessControlExtMock.grantRoleBatch(USER_ROLE, [])
        ).not.to.emit(accessControlExtMock, EVENT_NAME_ROLE_GRANTED);
      });
    });

    describe("Is reverted if", async () => {
      it("The sender does not have the expected admin role", async () => {
        const { accessControlExtMock } = await setUpFixture(deployAccessControlExtMock);

        await expect(
          connect(accessControlExtMock, attacker).grantRoleBatch(USER_ROLE, [])
        ).to.be.revertedWithCustomError(
          accessControlExtMock,
          REVERT_ERROR_IF_UNAUTHORIZED_ACCOUNT
        ).withArgs(attacker.address, OWNER_ROLE);
      });
    });

    describe("Function 'revokeRoleBatch()'", async () => {
      describe("Executes as expected if the input account array contains", async () => {
        it("A single account with the previously granted role", async () => {
          const { accessControlExtMock } = await setUpFixture(deployAccessControlExtMock);
          await proveTx(accessControlExtMock.grantRoleBatch(USER_ROLE, [userAddresses[0]]));
          expect(await accessControlExtMock.hasRole(USER_ROLE, userAddresses[0])).to.equal(true);

          await expect(
            accessControlExtMock.revokeRoleBatch(USER_ROLE, [userAddresses[0]])
          ).to.emit(
            accessControlExtMock,
            EVENT_NAME_ROLE_REVOKED
          ).withArgs(USER_ROLE, userAddresses[0], deployer.address);

          expect(await accessControlExtMock.hasRole(USER_ROLE, userAddresses[0])).to.equal(false);
        });

        it("A single account without the previously granted role", async () => {
          const { accessControlExtMock } = await setUpFixture(deployAccessControlExtMock);
          expect(await accessControlExtMock.hasRole(USER_ROLE, userAddresses[0])).to.equal(false);

          await expect(
            accessControlExtMock.revokeRoleBatch(USER_ROLE, [userAddresses[0]])
          ).not.to.emit(accessControlExtMock, EVENT_NAME_ROLE_REVOKED);
        });

        it("Multiple accounts with the previously granted role", async () => {
          const { accessControlExtMock } = await setUpFixture(deployAccessControlExtMock);
          await proveTx(accessControlExtMock.grantRoleBatch(USER_ROLE, userAddresses));
          for (const userAddress of userAddresses) {
            expect(await accessControlExtMock.hasRole(USER_ROLE, userAddress)).to.equal(true);
          }

          const tx: Promise<TransactionResponse> = accessControlExtMock.revokeRoleBatch(USER_ROLE, userAddresses);

          for (const userAddress of userAddresses) {
            await expect(tx)
              .to.emit(accessControlExtMock, EVENT_NAME_ROLE_REVOKED)
              .withArgs(USER_ROLE, userAddress, deployer.address);
            expect(await accessControlExtMock.hasRole(USER_ROLE, userAddress)).to.equal(false);
          }
        });

        it("No accounts", async () => {
          const { accessControlExtMock } = await setUpFixture(deployAccessControlExtMock);

          await expect(
            accessControlExtMock.revokeRoleBatch(USER_ROLE, [])
          ).not.to.emit(accessControlExtMock, EVENT_NAME_ROLE_REVOKED);
        });
      });

      describe("Is reverted if", async () => {
        it("The sender does not have the expected admin role", async () => {
          const { accessControlExtMock } = await setUpFixture(deployAccessControlExtMock);

          await expect(
            connect(accessControlExtMock, attacker).revokeRoleBatch(USER_ROLE, [])
          ).to.be.revertedWithCustomError(
            accessControlExtMock,
            REVERT_ERROR_IF_UNAUTHORIZED_ACCOUNT
          ).withArgs(attacker.address, OWNER_ROLE);
        });
      });
    });
  });
});
