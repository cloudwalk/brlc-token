import { ethers } from "hardhat";
import { expect } from "chai";
import { BigNumber, Contract, ContractFactory } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import { proveTx } from "../test-utils/eth";

describe("Contract 'BRLCTokenBase'", async () => {
  const TOKEN_NAME = "BRL Coin";
  const TOKEN_SYMBOL = "BRLC";

  const REVERT_MESSAGE_IF_CONTRACT_IS_ALREADY_INITIALIZED = "Initializable: contract is already initialized";
  const REVERT_MESSAGE_IF_CONTRACT_IS_NOT_INITIALIZING = "Initializable: contract is not initializing";
  const REVERT_MESSAGE_IF_CONTRACT_IS_PAUSED = "Pausable: paused";
  const REVERT_MESSAGE_IF_CONTRACT_IS_PAUSED_BEFORE_TOKEN_TRANSFER = "ERC20Pausable: token transfer while paused";

  const REVERT_ERROR_IF_ACCOUNT_IS_BLACKLISTED = "BlacklistedAccount";

  let brlcToken: Contract;
  let deployer: SignerWithAddress;
  let user1: SignerWithAddress;
  let user2: SignerWithAddress;

  beforeEach(async () => {
    // Deploy the contract under test
    const BrlcToken: ContractFactory = await ethers.getContractFactory("BRLCTokenBaseMock");
    brlcToken = await BrlcToken.deploy();
    await brlcToken.deployed();
    await proveTx(brlcToken.initialize(TOKEN_NAME, TOKEN_SYMBOL));

    // Get user accounts
    [deployer, user1, user2] = await ethers.getSigners();
  });

  it("The initialize function can't be called more than once", async () => {
    await expect(
      brlcToken.initialize(TOKEN_NAME, TOKEN_SYMBOL)
    ).to.be.revertedWith(REVERT_MESSAGE_IF_CONTRACT_IS_ALREADY_INITIALIZED);
  });

  it("The init function of the ancestor contract can't be called outside the init process", async () => {
    await expect(
      brlcToken.call_parent_initialize(TOKEN_NAME, TOKEN_SYMBOL)
    ).to.be.revertedWith(REVERT_MESSAGE_IF_CONTRACT_IS_NOT_INITIALIZING);
  });

  it("The init unchained function of the ancestor contract can't be called outside the init process", async () => {
    await expect(
      brlcToken.call_parent_initialize_unchained()
    ).to.be.revertedWith(REVERT_MESSAGE_IF_CONTRACT_IS_NOT_INITIALIZING);
  });

  it("The initial contract configuration should be as expected", async () => {
    expect(await brlcToken.owner()).to.equal(deployer.address);
    expect(await brlcToken.pauser()).to.equal(ethers.constants.AddressZero);
    expect(await brlcToken.rescuer()).to.equal(ethers.constants.AddressZero);
    expect(await brlcToken.blacklister()).to.equal(ethers.constants.AddressZero);
    expect(await brlcToken.decimals()).to.equal(6);
  });

  describe("Function 'transfer()'", async () => {
    const tokenAmount: number = 123;

    beforeEach(async () => {
      await proveTx(brlcToken.mint(user1.address, tokenAmount));
    });

    it("Is reverted if the contract is paused", async () => {
      await proveTx(brlcToken.setPauser(deployer.address));
      await proveTx(brlcToken.pause());
      await expect(
        brlcToken.connect(user1).transfer(user2.address, tokenAmount)
      ).to.be.revertedWith(REVERT_MESSAGE_IF_CONTRACT_IS_PAUSED);
    });

    it("Is reverted if the caller is blacklisted", async () => {
      await proveTx(brlcToken.connect(user1).selfBlacklist());
      await expect(
        brlcToken.connect(user1).transfer(user2.address, tokenAmount)
      ).to.be.revertedWithCustomError(brlcToken, REVERT_ERROR_IF_ACCOUNT_IS_BLACKLISTED);
    });

    it("Is reverted if the recipient is blacklisted", async () => {
      await proveTx(brlcToken.connect(user2).selfBlacklist());
      await expect(
        brlcToken.connect(user1).transfer(user2.address, tokenAmount)
      ).to.be.revertedWithCustomError(brlcToken, REVERT_ERROR_IF_ACCOUNT_IS_BLACKLISTED);
    });

    it("Updates the token balances correctly and emits the correct event", async () => {
      await expect(
        brlcToken.connect(user1).transfer(user2.address, tokenAmount)
      ).to.changeTokenBalances(
        brlcToken,
        [user1, user2, brlcToken],
        [-tokenAmount, tokenAmount, 0]
      ).and.to.emit(
        brlcToken,
        "Transfer"
      ).withArgs(
        user1.address,
        user2.address,
        tokenAmount
      );
    });
  });

  describe("Function 'approve()'", async () => {
    const allowance: number = 123;

    it("Is reverted if the contract is paused", async () => {
      await proveTx(brlcToken.setPauser(deployer.address));
      await proveTx(brlcToken.pause());
      await expect(
        brlcToken.approve(user1.address, allowance)
      ).to.be.revertedWith(REVERT_MESSAGE_IF_CONTRACT_IS_PAUSED);
    });

    it("Is reverted if the caller is blacklisted", async () => {
      await proveTx(brlcToken.selfBlacklist());
      await expect(
        brlcToken.approve(user1.address, allowance)
      ).to.be.revertedWithCustomError(brlcToken, REVERT_ERROR_IF_ACCOUNT_IS_BLACKLISTED);
    });

    it("Is reverted if the spender is blacklisted", async () => {
      await proveTx(brlcToken.connect(user1).selfBlacklist());
      await expect(
        brlcToken.approve(user1.address, allowance)
      ).to.be.revertedWithCustomError(brlcToken, REVERT_ERROR_IF_ACCOUNT_IS_BLACKLISTED);
    });

    it("Updates the allowance correctly and emits the correct event", async () => {
      const oldAllowance: BigNumber = await brlcToken.allowance(deployer.address, user1.address);
      const newExpectedAllowance: BigNumber = oldAllowance.add(BigNumber.from(allowance));
      await expect(
        brlcToken.approve(user1.address, allowance)
      ).to.emit(
        brlcToken,
        "Approval"
      ).withArgs(deployer.address, user1.address, allowance);
      const newActualAllowance: BigNumber = await brlcToken.allowance(deployer.address, user1.address);
      expect(newActualAllowance).to.equal(newExpectedAllowance);
    });
  });

  describe("Function 'transferFrom()'", async () => {
    const tokenAmount: number = 123;

    beforeEach(async () => {
      await proveTx(brlcToken.approve(user1.address, tokenAmount));
      await proveTx(brlcToken.mint(deployer.address, tokenAmount + 1));
    });

    it("Is reverted if the contract is paused", async () => {
      await proveTx(brlcToken.setPauser(deployer.address));
      await proveTx(brlcToken.pause());
      await expect(
        brlcToken.connect(user1).transferFrom(deployer.address, user2.address, tokenAmount)
      ).to.be.revertedWith(REVERT_MESSAGE_IF_CONTRACT_IS_PAUSED);
    });

    it("Is reverted if the sender is blacklisted", async () => {
      await proveTx(brlcToken.selfBlacklist());
      await expect(
        brlcToken.connect(user1).transferFrom(deployer.address, user2.address, tokenAmount)
      ).to.be.revertedWithCustomError(brlcToken, REVERT_ERROR_IF_ACCOUNT_IS_BLACKLISTED);
    });

    it("Is reverted if the recipient is blacklisted", async () => {
      await proveTx(brlcToken.connect(user2).selfBlacklist());
      await expect(
        brlcToken.connect(user1).transferFrom(deployer.address, user2.address, tokenAmount)
      ).to.be.revertedWithCustomError(brlcToken, REVERT_ERROR_IF_ACCOUNT_IS_BLACKLISTED);
    });

    it("Updates the token balances correctly and emits the correct event", async () => {
      await expect(
        brlcToken.connect(user1).transferFrom(deployer.address, user2.address, tokenAmount)
      ).to.changeTokenBalances(
        brlcToken,
        [deployer, user2, user1, brlcToken],
        [-tokenAmount, tokenAmount, 0, 0]
      ).and.to.emit(
        brlcToken,
        "Transfer"
      ).withArgs(
        deployer.address,
        user2.address,
        tokenAmount
      );
    });
  });

  describe("Function 'increaseAllowance()'", async () => {
    const initialAllowance: number = 123;
    const allowanceAddedValue: number = 456;

    beforeEach(async () => {
      await proveTx(brlcToken.approve(user1.address, initialAllowance));
    });

    it("Is reverted if the contract is paused", async () => {
      await proveTx(brlcToken.setPauser(deployer.address));
      await proveTx(brlcToken.pause());
      await expect(
        brlcToken.increaseAllowance(user1.address, allowanceAddedValue)
      ).to.be.revertedWith(REVERT_MESSAGE_IF_CONTRACT_IS_PAUSED);
    });

    it("Is reverted if the caller is blacklisted", async () => {
      await proveTx(brlcToken.selfBlacklist());
      await expect(
        brlcToken.increaseAllowance(user1.address, allowanceAddedValue)
      ).to.be.revertedWithCustomError(brlcToken, REVERT_ERROR_IF_ACCOUNT_IS_BLACKLISTED);
    });

    it("Is reverted if the spender is blacklisted", async () => {
      await proveTx(brlcToken.connect(user1).selfBlacklist());
      await expect(
        brlcToken.increaseAllowance(user1.address, allowanceAddedValue)
      ).to.be.revertedWithCustomError(brlcToken, REVERT_ERROR_IF_ACCOUNT_IS_BLACKLISTED);
    });

    it("Updates the allowance correctly and emits the correct event", async () => {
      const oldAllowance: BigNumber = await brlcToken.allowance(deployer.address, user1.address);
      const newExpectedAllowance: BigNumber = oldAllowance.add(BigNumber.from(allowanceAddedValue));
      await expect(
        brlcToken.increaseAllowance(user1.address, allowanceAddedValue)
      ).to.emit(
        brlcToken,
        "Approval"
      ).withArgs(
        deployer.address,
        user1.address,
        initialAllowance + allowanceAddedValue
      );
      const newActualAllowance: BigNumber = await brlcToken.allowance(deployer.address, user1.address);
      expect(newActualAllowance).to.equal(newExpectedAllowance);
    });
  });

  describe("Function 'decreaseAllowance()'", async () => {
    const initialAllowance: number = 456;
    const allowanceSubtractedValue: number = 123;

    beforeEach(async () => {
      await proveTx(brlcToken.approve(user1.address, initialAllowance));
    });

    it("Is reverted if the contract is paused", async () => {
      await proveTx(brlcToken.setPauser(deployer.address));
      await proveTx(brlcToken.pause());
      await expect(
        brlcToken.decreaseAllowance(user1.address, allowanceSubtractedValue)
      ).to.be.revertedWith(REVERT_MESSAGE_IF_CONTRACT_IS_PAUSED);
    });

    it("Is reverted if the caller is blacklisted", async () => {
      await proveTx(brlcToken.selfBlacklist());
      await expect(
        brlcToken.decreaseAllowance(user1.address, allowanceSubtractedValue)
      ).to.be.revertedWithCustomError(brlcToken, REVERT_ERROR_IF_ACCOUNT_IS_BLACKLISTED);
    });

    it("Is reverted if the spender is blacklisted", async () => {
      await proveTx(brlcToken.connect(user1).selfBlacklist());
      await expect(
        brlcToken.decreaseAllowance(user1.address, allowanceSubtractedValue)
      ).to.be.revertedWithCustomError(brlcToken, REVERT_ERROR_IF_ACCOUNT_IS_BLACKLISTED);
    });

    it("Updates the allowance correctly and emits the correct event", async () => {
      const oldAllowance: BigNumber = await brlcToken.allowance(deployer.address, user1.address);
      const newExpectedAllowance: BigNumber = oldAllowance.sub(BigNumber.from(allowanceSubtractedValue));
      await expect(
        brlcToken.decreaseAllowance(user1.address, allowanceSubtractedValue)
      ).to.emit(
        brlcToken,
        "Approval"
      ).withArgs(
        deployer.address,
        user1.address,
        initialAllowance - allowanceSubtractedValue
      );
      const newActualAllowance: BigNumber = await brlcToken.allowance(deployer.address, user1.address);
      expect(newActualAllowance).to.equal(newExpectedAllowance);
    });
  });

  describe("Function '_beforeTokenTransfer()'", async () => {
    const tokenAmount: number = 123;

    it("Is reverted if the contract is paused", async () => {
      await proveTx(brlcToken.setPauser(deployer.address));
      await proveTx(brlcToken.pause());
      await expect(
        brlcToken.testBeforeTokenTransfer(user1.address, user2.address, tokenAmount)
      ).to.be.revertedWith(REVERT_MESSAGE_IF_CONTRACT_IS_PAUSED_BEFORE_TOKEN_TRANSFER);
    });

    it("Is not reverted if the contract is not paused", async () => {
      await expect(
        brlcToken.testBeforeTokenTransfer(user1.address, user2.address, tokenAmount)
      ).to.emit(brlcToken, "TestBeforeTokenTransferSucceeded");
    });
  });
});
