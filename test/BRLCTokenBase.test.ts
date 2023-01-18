import { ethers, network, upgrades } from "hardhat";
import { expect } from "chai";
import { BigNumber, Contract, ContractFactory } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { proveTx } from "../test-utils/eth";

async function setUpFixture(func: any) {
  if (network.name === "hardhat") {
    return loadFixture(func);
  } else {
    return func();
  }
}

describe("Contract 'BRLCTokenBase'", async () => {
  const TOKEN_NAME = "BRL Coin";
  const TOKEN_SYMBOL = "BRLC";
  const TOKEN_DECIMALS = 6;
  const TOKEN_AMOUNT: number = 123;
  const TOKEN_ALLOWANCE: number = 123;

  const EVENT_NAME_APPROVAL = "Approval";
  const EVENT_NAME_TRANSFER = "Transfer";
  const EVENT_NAME_TEST_BEFORE_TOKEN_TRANSFER_SUCCEEDED = "TestBeforeTokenTransferSucceeded";

  const REVERT_MESSAGE_IF_CONTRACT_IS_ALREADY_INITIALIZED = "Initializable: contract is already initialized";
  const REVERT_MESSAGE_IF_CONTRACT_IS_NOT_INITIALIZING = "Initializable: contract is not initializing";
  const REVERT_MESSAGE_IF_CONTRACT_IS_PAUSED = "Pausable: paused";
  const REVERT_MESSAGE_IF_CONTRACT_IS_PAUSED_BEFORE_TOKEN_TRANSFER = "ERC20Pausable: token transfer while paused";

  const REVERT_ERROR_IF_ACCOUNT_IS_BLACKLISTED = "BlacklistedAccount";

  let brlcTokenFactory: ContractFactory;
  let deployer: SignerWithAddress;
  let user1: SignerWithAddress;
  let user2: SignerWithAddress;

  before(async () => {
    [deployer, user1, user2] = await ethers.getSigners();
    brlcTokenFactory = await ethers.getContractFactory("BRLCTokenBaseMock");
  });

  async function deployContractUnderTest(): Promise<{ brlcToken: Contract }> {
    const brlcToken: Contract = await upgrades.deployProxy(brlcTokenFactory, [TOKEN_NAME, TOKEN_SYMBOL]);
    await brlcToken.deployed();
    return { brlcToken };
  }

  describe("Initializers", async () => {
    it("The external initializer configures the contract as expected", async () => {
      const { brlcToken } = await setUpFixture(deployContractUnderTest);
      expect(await brlcToken.owner()).to.equal(deployer.address);
      expect(await brlcToken.pauser()).to.equal(ethers.constants.AddressZero);
      expect(await brlcToken.rescuer()).to.equal(ethers.constants.AddressZero);
      expect(await brlcToken.blacklister()).to.equal(ethers.constants.AddressZero);
      expect(await brlcToken.decimals()).to.equal(TOKEN_DECIMALS);
    });

    it("The external initializer is reverted if it is called a second time", async () => {
      const { brlcToken } = await setUpFixture(deployContractUnderTest);
      await expect(
        brlcToken.initialize(TOKEN_NAME, TOKEN_SYMBOL)
      ).to.be.revertedWith(REVERT_MESSAGE_IF_CONTRACT_IS_ALREADY_INITIALIZED);
    });

    it("The internal initializer is reverted if it is called outside the init process", async () => {
      const { brlcToken } = await setUpFixture(deployContractUnderTest);
      await expect(
        brlcToken.call_parent_init(TOKEN_NAME, TOKEN_SYMBOL)
      ).to.be.revertedWith(REVERT_MESSAGE_IF_CONTRACT_IS_NOT_INITIALIZING);
    });

    it("The internal unchained initializer is reverted if it is called outside the init process", async () => {
      const { brlcToken } = await setUpFixture(deployContractUnderTest);
      await expect(
        brlcToken.call_parent_init_unchained()
      ).to.be.revertedWith(REVERT_MESSAGE_IF_CONTRACT_IS_NOT_INITIALIZING);
    });
  });

  describe("Function 'transfer()'", async () => {
    it("Executes as expected and emits the correct event", async () => {
      const { brlcToken } = await setUpFixture(deployContractUnderTest);
      await proveTx(brlcToken.mint(user1.address, TOKEN_AMOUNT));

      await expect(
        brlcToken.connect(user1).transfer(user2.address, TOKEN_AMOUNT)
      ).to.changeTokenBalances(
        brlcToken,
        [user1, user2, brlcToken],
        [-TOKEN_AMOUNT, TOKEN_AMOUNT, 0]
      ).and.to.emit(
        brlcToken,
        EVENT_NAME_TRANSFER
      ).withArgs(
        user1.address,
        user2.address,
        TOKEN_AMOUNT
      );
    });

    it("Is reverted if the contract is paused", async () => {
      const { brlcToken } = await setUpFixture(deployContractUnderTest);
      await proveTx(brlcToken.setPauser(deployer.address));
      await proveTx(brlcToken.pause());

      await expect(
        brlcToken.connect(user1).transfer(user2.address, TOKEN_AMOUNT)
      ).to.be.revertedWith(REVERT_MESSAGE_IF_CONTRACT_IS_PAUSED);
    });

    it("Is reverted if the caller is blacklisted", async () => {
      const { brlcToken } = await setUpFixture(deployContractUnderTest);
      await proveTx(brlcToken.connect(user1).selfBlacklist());

      await expect(
        brlcToken.connect(user1).transfer(user2.address, TOKEN_AMOUNT)
      ).to.be.revertedWithCustomError(brlcToken, REVERT_ERROR_IF_ACCOUNT_IS_BLACKLISTED);
    });

    it("Is reverted if the recipient is blacklisted", async () => {
      const { brlcToken } = await setUpFixture(deployContractUnderTest);
      await proveTx(brlcToken.connect(user2).selfBlacklist());

      await expect(
        brlcToken.connect(user1).transfer(user2.address, TOKEN_AMOUNT)
      ).to.be.revertedWithCustomError(brlcToken, REVERT_ERROR_IF_ACCOUNT_IS_BLACKLISTED);
    });
  });

  describe("Function 'approve()'", async () => {
    it("Executes as expected and emits the correct event", async () => {
      const { brlcToken } = await setUpFixture(deployContractUnderTest);
      const oldAllowance: BigNumber = await brlcToken.allowance(deployer.address, user1.address);
      const newExpectedAllowance: BigNumber = oldAllowance.add(BigNumber.from(TOKEN_ALLOWANCE));

      await expect(
        brlcToken.approve(user1.address, TOKEN_ALLOWANCE)
      ).to.emit(
        brlcToken,
        EVENT_NAME_APPROVAL
      ).withArgs(deployer.address, user1.address, TOKEN_ALLOWANCE);
      const newActualAllowance: BigNumber = await brlcToken.allowance(deployer.address, user1.address);
      expect(newActualAllowance).to.equal(newExpectedAllowance);
    });

    it("Is reverted if the contract is paused", async () => {
      const { brlcToken } = await setUpFixture(deployContractUnderTest);
      await proveTx(brlcToken.setPauser(deployer.address));
      await proveTx(brlcToken.pause());

      await expect(
        brlcToken.approve(user1.address, TOKEN_ALLOWANCE)
      ).to.be.revertedWith(REVERT_MESSAGE_IF_CONTRACT_IS_PAUSED);
    });

    it("Is reverted if the caller is blacklisted", async () => {
      const { brlcToken } = await setUpFixture(deployContractUnderTest);
      await proveTx(brlcToken.selfBlacklist());

      await expect(
        brlcToken.approve(user1.address, TOKEN_ALLOWANCE)
      ).to.be.revertedWithCustomError(brlcToken, REVERT_ERROR_IF_ACCOUNT_IS_BLACKLISTED);
    });

    it("Is reverted if the spender is blacklisted", async () => {
      const { brlcToken } = await setUpFixture(deployContractUnderTest);
      await proveTx(brlcToken.connect(user1).selfBlacklist());

      await expect(
        brlcToken.approve(user1.address, TOKEN_ALLOWANCE)
      ).to.be.revertedWithCustomError(brlcToken, REVERT_ERROR_IF_ACCOUNT_IS_BLACKLISTED);
    });
  });

  describe("Function 'transferFrom()'", async () => {
    it("Executes as expected and emits the correct event", async () => {
      const { brlcToken } = await setUpFixture(deployContractUnderTest);
      await proveTx(brlcToken.approve(user1.address, TOKEN_AMOUNT));
      await proveTx(brlcToken.mint(deployer.address, TOKEN_AMOUNT));

      await expect(
        brlcToken.connect(user1).transferFrom(deployer.address, user2.address, TOKEN_AMOUNT)
      ).to.changeTokenBalances(
        brlcToken,
        [deployer, user2, user1, brlcToken],
        [-TOKEN_AMOUNT, TOKEN_AMOUNT, 0, 0]
      ).and.to.emit(
        brlcToken,
        EVENT_NAME_TRANSFER
      ).withArgs(
        deployer.address,
        user2.address,
        TOKEN_AMOUNT
      );
    });

    it("Is reverted if the contract is paused", async () => {
      const { brlcToken } = await setUpFixture(deployContractUnderTest);
      await proveTx(brlcToken.setPauser(deployer.address));
      await proveTx(brlcToken.pause());

      await expect(
        brlcToken.connect(user1).transferFrom(deployer.address, user2.address, TOKEN_AMOUNT)
      ).to.be.revertedWith(REVERT_MESSAGE_IF_CONTRACT_IS_PAUSED);
    });

    it("Is reverted if the sender is blacklisted", async () => {
      const { brlcToken } = await setUpFixture(deployContractUnderTest);
      await proveTx(brlcToken.selfBlacklist());

      await expect(
        brlcToken.connect(user1).transferFrom(deployer.address, user2.address, TOKEN_AMOUNT)
      ).to.be.revertedWithCustomError(brlcToken, REVERT_ERROR_IF_ACCOUNT_IS_BLACKLISTED);
    });

    it("Is reverted if the recipient is blacklisted", async () => {
      const { brlcToken } = await setUpFixture(deployContractUnderTest);
      await proveTx(brlcToken.connect(user2).selfBlacklist());

      await expect(
        brlcToken.connect(user1).transferFrom(deployer.address, user2.address, TOKEN_AMOUNT)
      ).to.be.revertedWithCustomError(brlcToken, REVERT_ERROR_IF_ACCOUNT_IS_BLACKLISTED);
    });
  });

  describe("Function 'increaseAllowance()'", async () => {
    const initialAllowance: number = 123;
    const allowanceAddedValue: number = 456;

    it("Executes as expected and emits the correct event", async () => {
      const { brlcToken } = await setUpFixture(deployContractUnderTest);
      await proveTx(brlcToken.approve(user1.address, initialAllowance));
      const oldAllowance: BigNumber = await brlcToken.allowance(deployer.address, user1.address);
      const newExpectedAllowance: BigNumber = oldAllowance.add(BigNumber.from(allowanceAddedValue));

      await expect(
        brlcToken.increaseAllowance(user1.address, allowanceAddedValue)
      ).to.emit(
        brlcToken,
        EVENT_NAME_APPROVAL
      ).withArgs(
        deployer.address,
        user1.address,
        initialAllowance + allowanceAddedValue
      );

      const newActualAllowance: BigNumber = await brlcToken.allowance(deployer.address, user1.address);
      expect(newActualAllowance).to.equal(newExpectedAllowance);
    });

    it("Is reverted if the contract is paused", async () => {
      const { brlcToken } = await setUpFixture(deployContractUnderTest);
      await proveTx(brlcToken.setPauser(deployer.address));
      await proveTx(brlcToken.pause());

      await expect(
        brlcToken.increaseAllowance(user1.address, allowanceAddedValue)
      ).to.be.revertedWith(REVERT_MESSAGE_IF_CONTRACT_IS_PAUSED);
    });

    it("Is reverted if the caller is blacklisted", async () => {
      const { brlcToken } = await setUpFixture(deployContractUnderTest);
      await proveTx(brlcToken.selfBlacklist());

      await expect(
        brlcToken.increaseAllowance(user1.address, allowanceAddedValue)
      ).to.be.revertedWithCustomError(brlcToken, REVERT_ERROR_IF_ACCOUNT_IS_BLACKLISTED);
    });

    it("Is reverted if the spender is blacklisted", async () => {
      const { brlcToken } = await setUpFixture(deployContractUnderTest);
      await proveTx(brlcToken.connect(user1).selfBlacklist());

      await expect(
        brlcToken.increaseAllowance(user1.address, allowanceAddedValue)
      ).to.be.revertedWithCustomError(brlcToken, REVERT_ERROR_IF_ACCOUNT_IS_BLACKLISTED);
    });
  });

  describe("Function 'decreaseAllowance()'", async () => {
    const initialAllowance: number = 456;
    const allowanceSubtractedValue: number = 123;

    it("Executes as expected and emits the correct event", async () => {
      const { brlcToken } = await setUpFixture(deployContractUnderTest);
      await proveTx(brlcToken.approve(user1.address, initialAllowance));
      const oldAllowance: BigNumber = await brlcToken.allowance(deployer.address, user1.address);
      const newExpectedAllowance: BigNumber = oldAllowance.sub(BigNumber.from(allowanceSubtractedValue));

      await expect(
        brlcToken.decreaseAllowance(user1.address, allowanceSubtractedValue)
      ).to.emit(
        brlcToken,
        EVENT_NAME_APPROVAL
      ).withArgs(
        deployer.address,
        user1.address,
        initialAllowance - allowanceSubtractedValue
      );

      const newActualAllowance: BigNumber = await brlcToken.allowance(deployer.address, user1.address);
      expect(newActualAllowance).to.equal(newExpectedAllowance);
    });

    it("Is reverted if the contract is paused", async () => {
      const { brlcToken } = await setUpFixture(deployContractUnderTest);
      await proveTx(brlcToken.setPauser(deployer.address));
      await proveTx(brlcToken.pause());

      await expect(
        brlcToken.decreaseAllowance(user1.address, allowanceSubtractedValue)
      ).to.be.revertedWith(REVERT_MESSAGE_IF_CONTRACT_IS_PAUSED);
    });

    it("Is reverted if the caller is blacklisted", async () => {
      const { brlcToken } = await setUpFixture(deployContractUnderTest);
      await proveTx(brlcToken.selfBlacklist());

      await expect(
        brlcToken.decreaseAllowance(user1.address, allowanceSubtractedValue)
      ).to.be.revertedWithCustomError(brlcToken, REVERT_ERROR_IF_ACCOUNT_IS_BLACKLISTED);
    });

    it("Is reverted if the spender is blacklisted", async () => {
      const { brlcToken } = await setUpFixture(deployContractUnderTest);
      await proveTx(brlcToken.connect(user1).selfBlacklist());

      await expect(
        brlcToken.decreaseAllowance(user1.address, allowanceSubtractedValue)
      ).to.be.revertedWithCustomError(brlcToken, REVERT_ERROR_IF_ACCOUNT_IS_BLACKLISTED);
    });
  });

  describe("Function '_beforeTokenTransfer()'", async () => {
    it("Executes as expected if the contract is not paused", async () => {
      const { brlcToken } = await setUpFixture(deployContractUnderTest);

      await expect(
        brlcToken.testBeforeTokenTransfer(user1.address, user2.address, TOKEN_AMOUNT)
      ).to.emit(brlcToken, EVENT_NAME_TEST_BEFORE_TOKEN_TRANSFER_SUCCEEDED);
    });

    it("Is reverted if the contract is paused", async () => {
      const { brlcToken } = await setUpFixture(deployContractUnderTest);
      await proveTx(brlcToken.setPauser(deployer.address));
      await proveTx(brlcToken.pause());

      await expect(
        brlcToken.testBeforeTokenTransfer(user1.address, user2.address, TOKEN_AMOUNT)
      ).to.be.revertedWith(REVERT_MESSAGE_IF_CONTRACT_IS_PAUSED_BEFORE_TOKEN_TRANSFER);
    });
  });
});
