import { ethers, upgrades } from "hardhat";
import { expect } from "chai";
import { BigNumber, Contract, ContractFactory } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import { proveTx } from "../../test-utils/eth";

describe("Contract 'BaseTokenUpgradeable'", async () => {
  const TOKEN_NAME = "BRL Coin";
  const TOKEN_SYMBOL = "BRLC";
  const TOKEN_DECIMALS = 6;

  const REVERT_MESSAGE_IF_CONTRACT_IS_ALREADY_INITIALIZED = 'Initializable: contract is already initialized';
  const REVERT_MESSAGE_IF_CONTRACT_IS_PAUSED = "Pausable: paused";
  const REVERT_MESSAGE_IF_ACCOUNT_IS_BLACKLISTED = 'Blacklistable: account is blacklisted';
  const REVERT_MESSAGE_IF_CONTRACT_ERC20_IS_PAUSED = "ERC20Pausable: token transfer while paused";

  let baseToken: Contract;
  let deployer: SignerWithAddress;
  let user1: SignerWithAddress;
  let user2: SignerWithAddress;

  beforeEach(async () => {
    // Deploy the contract under test
    const BaseToken: ContractFactory = await ethers.getContractFactory("BaseTokenUpgradeableMock");
    baseToken = await upgrades.deployProxy(BaseToken, [TOKEN_NAME, TOKEN_SYMBOL, TOKEN_DECIMALS]);
    await baseToken.deployed();

    // Get user accounts
    [deployer, user1, user2] = await ethers.getSigners();
  });

  it("The initialize function can't be called more than once", async () => {
    await expect(baseToken.initialize(TOKEN_NAME, TOKEN_SYMBOL, TOKEN_DECIMALS))
      .to.be.revertedWith(REVERT_MESSAGE_IF_CONTRACT_IS_ALREADY_INITIALIZED);
  });

  it("The initialize unchained function can't be called more than once", async () => {
    await expect(baseToken.initialize_unchained(TOKEN_DECIMALS))
      .to.be.revertedWith(REVERT_MESSAGE_IF_CONTRACT_IS_ALREADY_INITIALIZED);
  });

  describe("Function 'transfer()'", async () => {
    const tokenAmount: number = 123;

    beforeEach(async () => {
      await proveTx(baseToken.mint(user1.address, tokenAmount));
    });

    it("Is reverted if the contract is paused", async () => {
      await proveTx(baseToken.setPauser(deployer.address));
      await proveTx(baseToken.pause());
      await expect(baseToken.connect(user1).transfer(user2.address, tokenAmount))
        .to.be.revertedWith(REVERT_MESSAGE_IF_CONTRACT_IS_PAUSED);
    });

    it("Is reverted if the caller is blacklisted", async () => {
      await proveTx(baseToken.connect(user1).selfBlacklist());
      await expect(baseToken.connect(user1).transfer(user2.address, tokenAmount))
        .to.be.revertedWith(REVERT_MESSAGE_IF_ACCOUNT_IS_BLACKLISTED);
    });

    it("Is reverted if the recipient is blacklisted", async () => {
      await proveTx(baseToken.connect(user2).selfBlacklist());
      await expect(baseToken.connect(user1).transfer(user2.address, tokenAmount))
        .to.be.revertedWith(REVERT_MESSAGE_IF_ACCOUNT_IS_BLACKLISTED);
    });

    it("Updates the token balances correctly", async () => {
      await expect(async () => {
        await proveTx(baseToken.connect(user1).transfer(user2.address, tokenAmount));
      }).to.changeTokenBalances(
        baseToken,
        [user1, user2],
        [-tokenAmount, tokenAmount]
      );
    });

    it("Emits the correct event", async () => {
      await expect(baseToken.connect(user1).transfer(user2.address, tokenAmount))
        .to.emit(baseToken, "Transfer")
        .withArgs(user1.address, user2.address, tokenAmount);
    });
  });

  describe("Function 'approve()'", async () => {
    const allowance: number = 123;

    it("Is reverted if the contract is paused", async () => {
      await proveTx(baseToken.setPauser(deployer.address));
      await proveTx(baseToken.pause());
      await expect(baseToken.approve(user1.address, allowance))
        .to.be.revertedWith(REVERT_MESSAGE_IF_CONTRACT_IS_PAUSED);
    });

    it("Is reverted if the caller is blacklisted", async () => {
      await proveTx(baseToken.selfBlacklist());
      await expect(baseToken.approve(user1.address, allowance))
        .to.be.revertedWith(REVERT_MESSAGE_IF_ACCOUNT_IS_BLACKLISTED);
    });

    it("Is reverted if the spender is blacklisted", async () => {
      await proveTx(baseToken.connect(user1).selfBlacklist());
      await expect(baseToken.approve(user1.address, allowance))
        .to.be.revertedWith(REVERT_MESSAGE_IF_ACCOUNT_IS_BLACKLISTED);
    });

    it("Updates the allowance correctly", async () => {
      const oldAllowance: BigNumber = await baseToken.allowance(deployer.address, user1.address);
      await proveTx(baseToken.approve(user1.address, allowance));
      const newAllowance: BigNumber = await baseToken.allowance(deployer.address, user1.address);
      expect(newAllowance).to.equal(oldAllowance.add(BigNumber.from(allowance)));
    });

    it("Emits the correct event", async () => {
      await expect(baseToken.approve(user1.address, allowance))
        .to.emit(baseToken, "Approval")
        .withArgs(deployer.address, user1.address, allowance);
    });
  });

  describe("Function 'transferFrom()'", async () => {
    const tokenAmount: number = 123;

    beforeEach(async () => {
      await proveTx(baseToken.approve(user1.address, tokenAmount));
      await proveTx(baseToken.mint(deployer.address, tokenAmount));
    })

    it("Is reverted if the contract is paused", async () => {
      await proveTx(baseToken.setPauser(deployer.address));
      await proveTx(baseToken.pause());
      await expect(baseToken.connect(user1).transferFrom(deployer.address, user2.address, tokenAmount))
        .to.be.revertedWith(REVERT_MESSAGE_IF_CONTRACT_IS_PAUSED);
    });

    it("Is reverted if the sender is blacklisted", async () => {
      await proveTx(baseToken.selfBlacklist());
      await expect(baseToken.connect(user1).transferFrom(deployer.address, user2.address, tokenAmount))
        .to.be.revertedWith(REVERT_MESSAGE_IF_ACCOUNT_IS_BLACKLISTED);
    });

    it("Is reverted if the recipient is blacklisted", async () => {
      await proveTx(baseToken.connect(user2).selfBlacklist());
      await expect(baseToken.connect(user1).transferFrom(deployer.address, user2.address, tokenAmount))
        .to.be.revertedWith(REVERT_MESSAGE_IF_ACCOUNT_IS_BLACKLISTED);
    });

    it("Updates the token balances correctly", async () => {
      await expect(async () => {
        await proveTx(baseToken.connect(user1).transferFrom(deployer.address, user2.address, tokenAmount));
      }).to.changeTokenBalances(
        baseToken,
        [deployer, user2],
        [-tokenAmount, tokenAmount]
      );
    });

    it("Emits the correct event", async () => {
      await expect(baseToken.connect(user1).transferFrom(deployer.address, user2.address, tokenAmount))
        .to.emit(baseToken, "Transfer")
        .withArgs(deployer.address, user2.address, tokenAmount);
    });
  });

  describe("Function 'increaseAllowance()'", async () => {
    const initialAllowance: number = 123;
    const allowanceAddedValue: number = 456;

    beforeEach(async () => {
      await proveTx(baseToken.approve(user1.address, initialAllowance));
    })

    it("Is reverted if the contract is paused", async () => {
      await proveTx(baseToken.setPauser(deployer.address));
      await proveTx(baseToken.pause());
      await expect(baseToken.increaseAllowance(user1.address, allowanceAddedValue))
        .to.be.revertedWith(REVERT_MESSAGE_IF_CONTRACT_IS_PAUSED);
    });

    it("Is reverted if the caller is blacklisted", async () => {
      await proveTx(baseToken.selfBlacklist());
      await expect(baseToken.increaseAllowance(user1.address, allowanceAddedValue))
        .to.be.revertedWith(REVERT_MESSAGE_IF_ACCOUNT_IS_BLACKLISTED);
    });

    it("Is reverted if the spender is blacklisted", async () => {
      await proveTx(baseToken.connect(user1).selfBlacklist());
      await expect(baseToken.increaseAllowance(user1.address, allowanceAddedValue))
        .to.be.revertedWith(REVERT_MESSAGE_IF_ACCOUNT_IS_BLACKLISTED);
    });

    it("Updates the allowance correctly", async () => {
      const oldAllowance: BigNumber = await baseToken.allowance(deployer.address, user1.address);
      await proveTx(baseToken.increaseAllowance(user1.address, allowanceAddedValue));
      const newAllowance: BigNumber = await baseToken.allowance(deployer.address, user1.address);
      expect(newAllowance).to.equal(oldAllowance.add(BigNumber.from(allowanceAddedValue)));
    });

    it("Emits the correct event", async () => {
      await expect(baseToken.increaseAllowance(user1.address, allowanceAddedValue))
        .to.emit(baseToken, "Approval")
        .withArgs(deployer.address, user1.address, initialAllowance + allowanceAddedValue);
    });
  });

  describe("Function 'decreaseAllowance()'", async () => {
    const initialAllowance: number = 456;
    const allowanceSubtractedValue: number = 123;

    beforeEach(async () => {
      await proveTx(baseToken.approve(user1.address, initialAllowance));
    })

    it("Is reverted if the contract is paused", async () => {
      await proveTx(baseToken.setPauser(deployer.address));
      await proveTx(baseToken.pause());
      await expect(baseToken.decreaseAllowance(user1.address, allowanceSubtractedValue))
        .to.be.revertedWith(REVERT_MESSAGE_IF_CONTRACT_IS_PAUSED);
    });

    it("Is reverted if the caller is blacklisted", async () => {
      await proveTx(baseToken.selfBlacklist());
      await expect(baseToken.decreaseAllowance(user1.address, allowanceSubtractedValue))
        .to.be.revertedWith(REVERT_MESSAGE_IF_ACCOUNT_IS_BLACKLISTED);
    });

    it("Is reverted if the spender is blacklisted", async () => {
      await proveTx(baseToken.connect(user1).selfBlacklist());
      await expect(baseToken.decreaseAllowance(user1.address, allowanceSubtractedValue))
        .to.be.revertedWith(REVERT_MESSAGE_IF_ACCOUNT_IS_BLACKLISTED);
    });

    it("Updates the allowance correctly", async () => {
      const oldAllowance: BigNumber = await baseToken.allowance(deployer.address, user1.address);
      await proveTx(baseToken.decreaseAllowance(user1.address, allowanceSubtractedValue));
      const newAllowance: BigNumber = await baseToken.allowance(deployer.address, user1.address);
      expect(newAllowance).to.equal(oldAllowance.sub(BigNumber.from(allowanceSubtractedValue)));
    });

    it("Emits the correct event", async () => {
      await expect(baseToken.decreaseAllowance(user1.address, allowanceSubtractedValue))
        .to.emit(baseToken, "Approval")
        .withArgs(deployer.address, user1.address, initialAllowance - allowanceSubtractedValue);
    });
  });

  describe("Function '_beforeTokenTransfer()'", async () => {
    const tokenAmount: number = 123;

    it("Is reverted if the contract is paused", async () => {
      await proveTx(baseToken.setPauser(deployer.address));
      await proveTx(baseToken.pause());
      await expect(baseToken.testBeforeTokenTransfer(user1.address, user2.address, tokenAmount))
        .to.be.revertedWith(REVERT_MESSAGE_IF_CONTRACT_ERC20_IS_PAUSED);
    });

    it("Is not reverted if the contract is not paused", async () => {
      await expect(baseToken.testBeforeTokenTransfer(user1.address, user2.address, tokenAmount))
        .to.emit(baseToken, "TestBeforeTokenTransferSucceeded");
    });
  });
});
