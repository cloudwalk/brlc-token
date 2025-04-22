import { ethers, network, upgrades } from "hardhat";
import { expect } from "chai";
import { Contract, ContractFactory } from "ethers";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { connect, proveTx } from "../../test-utils/eth";

async function setUpFixture<T>(func: () => Promise<T>): Promise<T> {
  if (network.name === "hardhat") {
    return loadFixture(func);
  } else {
    return func();
  }
}

describe("Contract 'ERC20Base'", async () => {
  const TOKEN_NAME = "BRL Coin";
  const TOKEN_SYMBOL = "BRLC";
  const TOKEN_DECIMALS = 6;
  const ADDRESS_ZERO = ethers.ZeroAddress;

  const TOKEN_AMOUNT: number = 100;
  const TOKEN_ALLOWANCE: number = 200;

  const EVENT_NAME_APPROVAL = "Approval";
  const EVENT_NAME_TRANSFER = "Transfer";
  const EVENT_NAME_ROLE_ADMIN_CHANGED = "RoleAdminChanged";
  const EVENT_NAME_ROLE_GRANTED = "RoleGranted";

  // Errors of the lib contracts
  const REVERT_ERROR_CONTRACT_INITIALIZATION_IS_INVALID = "InvalidInitialization";
  const REVERT_ERROR_CONTRACT_IS_NOT_INITIALIZING = "NotInitializing";
  const REVERT_ERROR_CONTRACT_IS_PAUSED = "EnforcedPause";

  const DEFAULT_ADMIN_ROLE: string = ethers.ZeroHash;
  const OWNER_ROLE: string = ethers.id("OWNER_ROLE");
  const PAUSER_ROLE: string = ethers.id("PAUSER_ROLE");
  const RESCUER_ROLE: string = ethers.id("RESCUER_ROLE");

  let tokenFactory: ContractFactory;
  let deployer: HardhatEthersSigner;
  let pauser: HardhatEthersSigner;
  let user1: HardhatEthersSigner;
  let user2: HardhatEthersSigner;

  before(async () => {
    [deployer, pauser, user1, user2] = await ethers.getSigners();
    tokenFactory = await ethers.getContractFactory("ERC20BaseMock");
    tokenFactory = tokenFactory.connect(deployer); // Explicitly specifying the deployer account
  });

  async function deployToken(): Promise<{ token: Contract }> {
    let token: Contract = await upgrades.deployProxy(
      tokenFactory,
      [TOKEN_NAME, TOKEN_SYMBOL],
      { unsafeSkipProxyAdminCheck: true } // This is necessary to run tests on other networks
    ) as Contract;
    await token.waitForDeployment();
    token = connect(token, deployer); // Explicitly specifying the initial account
    return { token };
  }

  async function deployAndConfigureToken(): Promise<{ token: Contract }> {
    const { token } = await deployToken();
    await proveTx(token.grantRole(PAUSER_ROLE, pauser.address));
    return { token };
  }

  describe("Function 'initialize()'", async () => {
    it("Configures the contract as expected", async () => {
      const { token } = await setUpFixture(deployToken);
      expect(await token.name()).to.equal(TOKEN_NAME);
      expect(await token.symbol()).to.equal(TOKEN_SYMBOL);
      expect(await token.decimals()).to.equal(TOKEN_DECIMALS);
      expect(await token.getRoleAdmin(OWNER_ROLE)).to.equal(OWNER_ROLE);
      expect(await token.getRoleAdmin(PAUSER_ROLE)).to.equal(OWNER_ROLE);
      expect(await token.getRoleAdmin(RESCUER_ROLE)).to.equal(OWNER_ROLE);
      expect(await token.hasRole(OWNER_ROLE, deployer.address)).to.equal(true);
      expect(await token.hasRole(PAUSER_ROLE, deployer.address)).to.equal(false);
      expect(await token.hasRole(RESCUER_ROLE, deployer.address)).to.equal(false);
    });

    it("Is reverted if called for the second time", async () => {
      const { token } = await setUpFixture(deployToken);
      await expect(
        token.initialize(TOKEN_NAME, TOKEN_SYMBOL)
      ).to.be.revertedWithCustomError(token, REVERT_ERROR_CONTRACT_INITIALIZATION_IS_INVALID);
    });

    it("Is reverted if the internal initializer is called outside of the init process", async () => {
      const { token } = await setUpFixture(deployToken);
      await expect(
        token.call_parent_initialize(TOKEN_NAME, TOKEN_SYMBOL)
      ).to.be.revertedWithCustomError(token, REVERT_ERROR_CONTRACT_IS_NOT_INITIALIZING);
    });

    it("Is reverted if the internal unchained initializer is called outside of the init process", async () => {
      const { token } = await setUpFixture(deployToken);
      await expect(
        token.call_parent_initialize_unchained()
      ).to.be.revertedWithCustomError(token, REVERT_ERROR_CONTRACT_IS_NOT_INITIALIZING);
    });
  });

  describe("Function 'transfer()'", async () => {
    it("Executes as expected and emits the correct event", async () => {
      const { token } = await setUpFixture(deployToken);
      await proveTx(token.mintForTest(user1.address, TOKEN_AMOUNT));
      expect(await token.totalSupply()).to.equal(TOKEN_AMOUNT);

      const tx = connect(token, user1).transfer(user2.address, TOKEN_AMOUNT);
      await expect(tx).to.changeTokenBalances(
        token,
        [user1, user2, token],
        [-TOKEN_AMOUNT, TOKEN_AMOUNT, 0]
      );
      await expect(tx)
        .to.emit(token, EVENT_NAME_TRANSFER)
        .withArgs(user1.address, user2.address, TOKEN_AMOUNT);

      expect(await token.totalSupply()).to.equal(TOKEN_AMOUNT);
    });

    it("Is reverted if the contract is paused", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.mintForTest(user1.address, TOKEN_AMOUNT));
      await proveTx(connect(token, pauser).pause());
      await expect(
        connect(token, user1).transfer(user2.address, TOKEN_AMOUNT)
      ).to.be.revertedWithCustomError(token, REVERT_ERROR_CONTRACT_IS_PAUSED);
    });
  });

  describe("Function 'approve()'", async () => {
    it("Executes as expected and emits the correct event", async () => {
      const { token } = await setUpFixture(deployToken);
      const oldAllowance: bigint = await token.allowance(user1.address, user2.address);
      const newExpectedAllowance: bigint = oldAllowance + BigInt(TOKEN_ALLOWANCE);
      await expect(connect(token, user1).approve(user2.address, TOKEN_ALLOWANCE))
        .to.emit(token, EVENT_NAME_APPROVAL)
        .withArgs(user1.address, user2.address, TOKEN_ALLOWANCE);
      const newActualAllowance = await token.allowance(user1.address, user2.address);
      expect(newActualAllowance).to.equal(newExpectedAllowance);
    });

    it("Is reverted if the contract is paused", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(connect(token, pauser).pause());
      await expect(
        connect(token, user1).approve(user2.address, TOKEN_ALLOWANCE)
      ).to.be.revertedWithCustomError(token, REVERT_ERROR_CONTRACT_IS_PAUSED);
    });
  });

  describe("Function 'transferFrom()'", async () => {
    it("Executes as expected and emits the correct event", async () => {
      const { token } = await setUpFixture(deployToken);
      await proveTx(token.mintForTest(user1.address, TOKEN_AMOUNT));
      await proveTx(connect(token, user1).approve(user2.address, TOKEN_AMOUNT));
      const tx = connect(token, user2).transferFrom(user1.address, user2.address, TOKEN_AMOUNT);
      await expect(tx).to.changeTokenBalances(
        token,
        [user1, user2],
        [-TOKEN_AMOUNT, TOKEN_AMOUNT]
      );
      await expect(tx)
        .to.emit(token, EVENT_NAME_TRANSFER)
        .withArgs(user1.address, user2.address, TOKEN_AMOUNT);
    });

    it("Is reverted if the contract is paused", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.mintForTest(user1.address, TOKEN_AMOUNT));
      await proveTx(connect(token, user1).approve(user2.address, TOKEN_AMOUNT));
      await proveTx(connect(token, pauser).pause());
      await expect(
        connect(token, user2).transferFrom(user1.address, user2.address, TOKEN_AMOUNT)
      ).to.be.revertedWithCustomError(token, REVERT_ERROR_CONTRACT_IS_PAUSED);
    });
  });

  describe("Function 'increaseAllowance()'", async () => {
    const initialAllowance: number = TOKEN_ALLOWANCE;
    const allowanceAddedValue: number = TOKEN_ALLOWANCE + 1;

    it("Executes as expected and emits the correct event", async () => {
      const { token } = await setUpFixture(deployToken);
      await proveTx(connect(token, user1).approve(user2.address, initialAllowance));
      const oldAllowance: bigint = await token.allowance(user1.address, user2.address);
      const newExpectedAllowance: bigint = oldAllowance + BigInt(allowanceAddedValue);
      await expect(connect(token, user1).increaseAllowance(user2.address, allowanceAddedValue))
        .to.emit(token, EVENT_NAME_APPROVAL)
        .withArgs(user1.address, user2.address, initialAllowance + allowanceAddedValue);
      const newActualAllowance = await token.allowance(user1.address, user2.address);
      expect(newActualAllowance).to.equal(newExpectedAllowance);
    });

    it("Is reverted if the contract is paused", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(connect(token, pauser).pause());
      await expect(
        token.increaseAllowance(user1.address, allowanceAddedValue)
      ).to.be.revertedWithCustomError(token, REVERT_ERROR_CONTRACT_IS_PAUSED);
    });
  });

  describe("Function 'decreaseAllowance()'", async () => {
    const initialAllowance: number = TOKEN_ALLOWANCE + 1;
    const allowanceSubtractedValue: number = TOKEN_ALLOWANCE;

    it("Executes as expected and emits the correct event", async () => {
      const { token } = await setUpFixture(deployToken);
      await proveTx(connect(token, user1).approve(user2.address, initialAllowance));
      const oldAllowance: bigint = await token.allowance(user1.address, user2.address);
      const newExpectedAllowance: bigint = oldAllowance - BigInt(allowanceSubtractedValue);
      await expect(connect(token, user1).decreaseAllowance(user2.address, allowanceSubtractedValue))
        .to.emit(token, EVENT_NAME_APPROVAL)
        .withArgs(user1.address, user2.address, initialAllowance - allowanceSubtractedValue);
      const newActualAllowance = await token.allowance(user1.address, user2.address);
      expect(newActualAllowance).to.equal(newExpectedAllowance);
    });

    it("Is reverted if the contract is paused", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(connect(token, user1).approve(user2.address, initialAllowance));
      await proveTx(connect(token, pauser).pause());
      await expect(
        connect(token, user1).decreaseAllowance(user2.address, allowanceSubtractedValue)
      ).to.be.revertedWithCustomError(token, REVERT_ERROR_CONTRACT_IS_PAUSED);
    });
  });

  describe("Function 'migrateStorage()'", async () => {
    it("Executes as expected and emits the correct events", async () => {
      const { token } = await setUpFixture(deployToken);
      expect(await token.getNewStorageInitializedState()).to.eq(1);
      expect(await token.getOldStorageVariables()).to.deep.eq([
        0, // initialized_
        ADDRESS_ZERO, // owner_
        ADDRESS_ZERO, // pasuer_
        ADDRESS_ZERO // rescuer_
      ]);

      await proveTx(token.configureStorageValuesAsBeforeMigration());
      expect(await token.getOldStorageVariables()).to.deep.eq([
        1, // initialized_
        deployer.address, // owner_
        deployer.address, // pasuer_
        deployer.address // rescuer_
      ]);

      // Call the first time
      const tx1 = token.migrateStorage();
      await expect(tx1)
        .to.emit(token, EVENT_NAME_ROLE_ADMIN_CHANGED)
        .withArgs(OWNER_ROLE, DEFAULT_ADMIN_ROLE, OWNER_ROLE);
      await expect(tx1)
        .to.emit(token, EVENT_NAME_ROLE_ADMIN_CHANGED)
        .withArgs(PAUSER_ROLE, DEFAULT_ADMIN_ROLE, OWNER_ROLE);
      await expect(tx1)
        .to.emit(token, EVENT_NAME_ROLE_ADMIN_CHANGED)
        .withArgs(RESCUER_ROLE, DEFAULT_ADMIN_ROLE, OWNER_ROLE);

      await expect(tx1)
        .to.emit(token, EVENT_NAME_ROLE_GRANTED)
        .withArgs(OWNER_ROLE, deployer.address, deployer.address);
      await expect(tx1)
        .to.emit(token, EVENT_NAME_ROLE_GRANTED)
        .withArgs(PAUSER_ROLE, deployer.address, deployer.address);
      await expect(tx1)
        .to.emit(token, EVENT_NAME_ROLE_GRANTED)
        .withArgs(RESCUER_ROLE, deployer.address, deployer.address);

      expect(await token.getOldStorageVariables()).to.deep.eq([
        0, // initialized_
        ADDRESS_ZERO, // owner_
        ADDRESS_ZERO, // pasuer_
        ADDRESS_ZERO // rescuer_
      ]);
      expect(await token.getNewStorageInitializedState()).to.eq(1);
      expect(await token.getRoleAdmin(OWNER_ROLE)).to.equal(OWNER_ROLE);
      expect(await token.getRoleAdmin(PAUSER_ROLE)).to.equal(OWNER_ROLE);
      expect(await token.getRoleAdmin(RESCUER_ROLE)).to.equal(OWNER_ROLE);
      expect(await token.hasRole(OWNER_ROLE, deployer.address)).to.equal(true);
      expect(await token.hasRole(PAUSER_ROLE, deployer.address)).to.equal(true);
      expect(await token.hasRole(RESCUER_ROLE, deployer.address)).to.equal(true);

      // Call the second time
      const tx2 = token.migrateStorage();
      await expect(tx2).not.to.emit(token, EVENT_NAME_ROLE_ADMIN_CHANGED);
      await expect(tx2).not.to.emit(token, EVENT_NAME_ROLE_GRANTED);
    });
  });
});
