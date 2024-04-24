import { ethers, network, upgrades } from "hardhat";
import { expect } from "chai";
import { Contract, ContractFactory } from "ethers";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { proveTx } from "../../test-utils/eth";

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

  const TOKEN_AMOUNT: number = 100;
  const TOKEN_ALLOWANCE: number = 200;

  const EVENT_NAME_APPROVAL = "Approval";
  const EVENT_NAME_TRANSFER = "Transfer";

  const REVERT_MESSAGE_INITIALIZABLE_CONTRACT_IS_ALREADY_INITIALIZED = "Initializable: contract is already initialized";
  const REVERT_MESSAGE_INITIALIZABLE_CONTRACT_IS_NOT_INITIALIZING = "Initializable: contract is not initializing";
  const REVERT_MESSAGE_PAUSABLE_PAUSED = "Pausable: paused";

  const REVERT_ERROR_BLOCKLISTED_ACCOUNT = "BlocklistedAccount";

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
    let token: Contract = await upgrades.deployProxy(tokenFactory, [TOKEN_NAME, TOKEN_SYMBOL]);
    await token.waitForDeployment();
    token = token.connect(deployer) as Contract; // Explicitly specifying the initial account
    await proveTx(token.enableBlocklist(true));
    return { token };
  }

  async function deployAndConfigureToken(): Promise<{ token: Contract }> {
    const { token } = await deployToken();
    await proveTx(token.setPauser(pauser.address));
    return { token };
  }

  describe("Function 'initialize()'", async () => {
    it("Configures the contract as expected", async () => {
      const { token } = await setUpFixture(deployToken);
      expect(await token.name()).to.equal(TOKEN_NAME);
      expect(await token.symbol()).to.equal(TOKEN_SYMBOL);
      expect(await token.decimals()).to.equal(TOKEN_DECIMALS);
      expect(await token.owner()).to.equal(deployer.address);
      expect(await token.pauser()).to.equal(ethers.ZeroAddress);
      expect(await token.rescuer()).to.equal(ethers.ZeroAddress);
      expect(await token.mainBlocklister()).to.equal(ethers.ZeroAddress);
    });

    it("Is reverted if called for the second time", async () => {
      const { token } = await setUpFixture(deployToken);
      await expect(
        token.initialize(TOKEN_NAME, TOKEN_SYMBOL)
      ).to.be.revertedWith(REVERT_MESSAGE_INITIALIZABLE_CONTRACT_IS_ALREADY_INITIALIZED);
    });

    it("Is reverted if the implementation contract is called even for the first time", async () => {
      const tokenImplementation: Contract = (await tokenFactory.deploy()) as Contract;
      await tokenImplementation.waitForDeployment();
      await expect(
        tokenImplementation.initialize(TOKEN_NAME, TOKEN_SYMBOL)
      ).to.be.revertedWith(REVERT_MESSAGE_INITIALIZABLE_CONTRACT_IS_ALREADY_INITIALIZED);
    });

    it("Is reverted if the internal initializer is called outside of the init process", async () => {
      const { token } = await setUpFixture(deployToken);
      await expect(
        token.call_parent_initialize(TOKEN_NAME, TOKEN_SYMBOL)
      ).to.be.revertedWith(REVERT_MESSAGE_INITIALIZABLE_CONTRACT_IS_NOT_INITIALIZING);
    });

    it("Is reverted if the internal unchained initializer is called outside of the init process", async () => {
      const { token } = await setUpFixture(deployToken);
      await expect(
        token.call_parent_initialize_unchained()
      ).to.be.revertedWith(REVERT_MESSAGE_INITIALIZABLE_CONTRACT_IS_NOT_INITIALIZING);
    });
  });

  describe("Function 'transfer()'", async () => {
    it("Executes as expected and emits the correct event", async () => {
      const { token } = await setUpFixture(deployToken);
      await proveTx(token.mintForTest(user1.address, TOKEN_AMOUNT));
      const tx = (token.connect(user1) as Contract).transfer(user2.address, TOKEN_AMOUNT);
      await expect(tx).to.changeTokenBalances(
        token,
        [user1, user2, token],
        [-TOKEN_AMOUNT, TOKEN_AMOUNT, 0]
      );
      await expect(tx)
        .to.emit(token, EVENT_NAME_TRANSFER)
        .withArgs(user1.address, user2.address, TOKEN_AMOUNT);
    });

    it("Is reverted if the contract is paused", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.mintForTest(user1.address, TOKEN_AMOUNT));
      await proveTx((token.connect(pauser) as Contract).pause());
      await expect(
        (token.connect(user1) as Contract).transfer(user2.address, TOKEN_AMOUNT)
      ).to.be.revertedWith(REVERT_MESSAGE_PAUSABLE_PAUSED);
    });

    it("Is reverted if the caller is blocklisted", async () => {
      const { token } = await setUpFixture(deployToken);
      await proveTx(token.mintForTest(user1.address, TOKEN_AMOUNT));
      await proveTx((token.connect(user1) as Contract).selfBlocklist());
      await expect((token.connect(user1) as Contract).transfer(user2.address, TOKEN_AMOUNT))
        .to.be.revertedWithCustomError(token, REVERT_ERROR_BLOCKLISTED_ACCOUNT)
        .withArgs(user1.address);
    });

    it("Is reverted if the recipient is blocklisted", async () => {
      const { token } = await setUpFixture(deployToken);
      await proveTx(token.mintForTest(user1.address, TOKEN_AMOUNT));
      await proveTx((token.connect(user2) as Contract).selfBlocklist());
      await expect((token.connect(user1) as Contract).transfer(user2.address, TOKEN_AMOUNT))
        .to.be.revertedWithCustomError(token, REVERT_ERROR_BLOCKLISTED_ACCOUNT)
        .withArgs(user2.address);
    });
  });

  describe("Function 'approve()'", async () => {
    it("Executes as expected and emits the correct event", async () => {
      const { token } = await setUpFixture(deployToken);
      const oldAllowance: bigint = await token.allowance(user1.address, user2.address);
      const newExpectedAllowance: bigint = oldAllowance + BigInt(TOKEN_ALLOWANCE);
      await expect((token.connect(user1) as Contract).approve(user2.address, TOKEN_ALLOWANCE))
        .to.emit(token, EVENT_NAME_APPROVAL)
        .withArgs(user1.address, user2.address, TOKEN_ALLOWANCE);
      const newActualAllowance = await token.allowance(user1.address, user2.address);
      expect(newActualAllowance).to.equal(newExpectedAllowance);
    });

    it("Is reverted if the contract is paused", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx((token.connect(pauser) as Contract).pause());
      await expect(
        (token.connect(user1) as Contract).approve(user2.address, TOKEN_ALLOWANCE)
      ).to.be.revertedWith(REVERT_MESSAGE_PAUSABLE_PAUSED);
    });

    it("Is reverted if the caller is blocklisted", async () => {
      const { token } = await setUpFixture(deployToken);
      await proveTx((token.connect(user1) as Contract).selfBlocklist());
      await expect((token.connect(user1) as Contract).approve(user2.address, TOKEN_ALLOWANCE))
        .to.be.revertedWithCustomError(token, REVERT_ERROR_BLOCKLISTED_ACCOUNT)
        .withArgs(user1.address);
    });

    it("Is reverted if the spender is blocklisted", async () => {
      const { token } = await setUpFixture(deployToken);
      await proveTx((token.connect(user2) as Contract).selfBlocklist());
      await expect((token.connect(user1) as Contract).approve(user2.address, TOKEN_ALLOWANCE))
        .to.be.revertedWithCustomError(token, REVERT_ERROR_BLOCKLISTED_ACCOUNT)
        .withArgs(user2.address);
    });
  });

  describe("Function 'transferFrom()'", async () => {
    it("Executes as expected and emits the correct event", async () => {
      const { token } = await setUpFixture(deployToken);
      await proveTx(token.mintForTest(user1.address, TOKEN_AMOUNT));
      await proveTx((token.connect(user1) as Contract).approve(user2.address, TOKEN_AMOUNT));
      const tx = (token.connect(user2) as Contract).transferFrom(user1.address, user2.address, TOKEN_AMOUNT);
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
      await proveTx((token.connect(user1) as Contract).approve(user2.address, TOKEN_AMOUNT));
      await proveTx((token.connect(pauser) as Contract).pause());
      await expect(
        (token.connect(user2) as Contract).transferFrom(user1.address, user2.address, TOKEN_AMOUNT)
      ).to.be.revertedWith(REVERT_MESSAGE_PAUSABLE_PAUSED);
    });

    it("Is reverted if the sender is blocklisted", async () => {
      const { token } = await setUpFixture(deployToken);
      await proveTx(token.mintForTest(user1.address, TOKEN_AMOUNT));
      await proveTx((token.connect(user1) as Contract).approve(user2.address, TOKEN_AMOUNT));
      await proveTx((token.connect(user1) as Contract).selfBlocklist());
      await expect((token.connect(user2) as Contract).transferFrom(user1.address, user2.address, TOKEN_AMOUNT))
        .to.be.revertedWithCustomError(token, REVERT_ERROR_BLOCKLISTED_ACCOUNT)
        .withArgs(user1.address);
    });

    it("Is reverted if the recipient is blocklisted", async () => {
      const { token } = await setUpFixture(deployToken);
      await proveTx(token.mintForTest(user1.address, TOKEN_AMOUNT));
      await proveTx((token.connect(user1) as Contract).approve(user2.address, TOKEN_AMOUNT));
      await proveTx((token.connect(user2) as Contract).selfBlocklist());
      await expect((token.connect(user2) as Contract).transferFrom(user1.address, user2.address, TOKEN_AMOUNT))
        .to.be.revertedWithCustomError(token, REVERT_ERROR_BLOCKLISTED_ACCOUNT)
        .withArgs(user2.address);
    });
  });

  describe("Function 'increaseAllowance()'", async () => {
    const initialAllowance: number = TOKEN_ALLOWANCE;
    const allowanceAddedValue: number = TOKEN_ALLOWANCE + 1;

    it("Executes as expected and emits the correct event", async () => {
      const { token } = await setUpFixture(deployToken);
      await proveTx((token.connect(user1) as Contract).approve(user2.address, initialAllowance));
      const oldAllowance: bigint = await token.allowance(user1.address, user2.address);
      const newExpectedAllowance: bigint = oldAllowance + BigInt(allowanceAddedValue);
      await expect((token.connect(user1) as Contract).increaseAllowance(user2.address, allowanceAddedValue))
        .to.emit(token, EVENT_NAME_APPROVAL)
        .withArgs(user1.address, user2.address, initialAllowance + allowanceAddedValue);
      const newActualAllowance = await token.allowance(user1.address, user2.address);
      expect(newActualAllowance).to.equal(newExpectedAllowance);
    });

    it("Is reverted if the contract is paused", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx((token.connect(pauser) as Contract).pause());
      await expect(
        token.increaseAllowance(user1.address, allowanceAddedValue)
      ).to.be.revertedWith(REVERT_MESSAGE_PAUSABLE_PAUSED);
    });

    it("Is reverted if the caller is blocklisted", async () => {
      const { token } = await setUpFixture(deployToken);
      await proveTx((token.connect(user1) as Contract).selfBlocklist());
      await expect((token.connect(user1) as Contract).increaseAllowance(user2.address, allowanceAddedValue))
        .to.be.revertedWithCustomError(token, REVERT_ERROR_BLOCKLISTED_ACCOUNT)
        .withArgs(user1.address);
    });

    it("Is reverted if the spender is blocklisted", async () => {
      const { token } = await setUpFixture(deployToken);
      await proveTx((token.connect(user2) as Contract).selfBlocklist());
      await expect((token.connect(user1) as Contract).increaseAllowance(user2.address, allowanceAddedValue))
        .to.be.revertedWithCustomError(token, REVERT_ERROR_BLOCKLISTED_ACCOUNT)
        .withArgs(user2.address);
    });
  });

  describe("Function 'decreaseAllowance()'", async () => {
    const initialAllowance: number = TOKEN_ALLOWANCE + 1;
    const allowanceSubtractedValue: number = TOKEN_ALLOWANCE;

    it("Executes as expected and emits the correct event", async () => {
      const { token } = await setUpFixture(deployToken);
      await proveTx((token.connect(user1) as Contract).approve(user2.address, initialAllowance));
      const oldAllowance: bigint = await token.allowance(user1.address, user2.address);
      const newExpectedAllowance: bigint = oldAllowance - BigInt(allowanceSubtractedValue);
      await expect((token.connect(user1) as Contract).decreaseAllowance(user2.address, allowanceSubtractedValue))
        .to.emit(token, EVENT_NAME_APPROVAL)
        .withArgs(user1.address, user2.address, initialAllowance - allowanceSubtractedValue);
      const newActualAllowance = await token.allowance(user1.address, user2.address);
      expect(newActualAllowance).to.equal(newExpectedAllowance);
    });

    it("Is reverted if the contract is paused", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx((token.connect(user1) as Contract).approve(user2.address, initialAllowance));
      await proveTx((token.connect(pauser) as Contract).pause());
      await expect(
        (token.connect(user1) as Contract).decreaseAllowance(user2.address, allowanceSubtractedValue)
      ).to.be.revertedWith(REVERT_MESSAGE_PAUSABLE_PAUSED);
    });

    it("Is reverted if the caller is blocklisted", async () => {
      const { token } = await setUpFixture(deployToken);
      await proveTx((token.connect(user1) as Contract).approve(user2.address, initialAllowance));
      await proveTx((token.connect(user1) as Contract).selfBlocklist());
      await expect((token.connect(user1) as Contract).decreaseAllowance(user2.address, allowanceSubtractedValue))
        .to.be.revertedWithCustomError(token, REVERT_ERROR_BLOCKLISTED_ACCOUNT)
        .withArgs(user1.address);
    });

    it("Is reverted if the spender is blocklisted", async () => {
      const { token } = await setUpFixture(deployToken);
      await proveTx((token.connect(user1) as Contract).approve(user2.address, initialAllowance));
      await proveTx((token.connect(user2) as Contract).selfBlocklist());
      await expect((token.connect(user1) as Contract).decreaseAllowance(user2.address, allowanceSubtractedValue))
        .to.be.revertedWithCustomError(token, REVERT_ERROR_BLOCKLISTED_ACCOUNT)
        .withArgs(user2.address);
    });
  });
});
