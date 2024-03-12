import { ethers, network, upgrades } from "hardhat";
import { expect } from "chai";
import { Contract, ContractFactory } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { proveTx } from "../../test-utils/eth";

async function setUpFixture<T>(func: () => Promise<T>): Promise<T> {
  if (network.name === "hardhat") {
    return loadFixture(func);
  } else {
    return func();
  }
}

describe("Contract 'CWToken' - Premintable, Freezable & Restrictable scenarios", async () => {
  const TOKEN_NAME = "CW Token";
  const TOKEN_SYMBOL = "CWT";
  const MAX_PENDING_PREMINTS_COUNT = 5;

  const REVERT_ERROR_TRANSFER_EXCEEDED_FROZEN_AMOUNT = "TransferExceededFrozenAmount";
  const REVERT_ERROR_TRANSFER_EXCEEDED_RESTRICTED_AMOUNT = "TransferExceededRestrictedAmount";
  const REVERT_ERROR_TRANSFER_EXCEEDED_PREMINT_AMOUNT = "TransferExceededPremintedAmount";
  const REVERT_MESSAGE_ERC20_TRANSFER_AMOUNT_EXCEEDS_BALANCE = "ERC20: transfer amount exceeds balance";
  const REVERT_MESSAGE_INSUFFICIENT_ALLOWANCE = "ERC20: insufficient allowance";

  const PURPOSE = "0x0000000000000000000000000000000000000000000000000000000000000001";

  enum PremintRestriction {
    None = 0
    // Create = 1 -- not used in this test file
    // Update = 2 -- not used in this test file
  }

  let tokenFactory: ContractFactory;
  let deployer: SignerWithAddress;
  let user: SignerWithAddress;
  let purposeAccount: SignerWithAddress;
  let nonPurposeAccount: SignerWithAddress;

  before(async () => {
    [deployer, user, purposeAccount, nonPurposeAccount] = await ethers.getSigners();
    tokenFactory = await ethers.getContractFactory("CWToken");
  });

  async function deployToken(): Promise<{ token: Contract }> {
    const token: Contract = await upgrades.deployProxy(tokenFactory, [TOKEN_NAME, TOKEN_SYMBOL]);
    await token.deployed();
    return { token };
  }

  async function deployAndConfigureToken(): Promise<{ token: Contract }> {
    const { token } = await deployToken();
    await proveTx(token.connect(deployer).setMainBlocklister(deployer.address));
    await proveTx(token.connect(deployer).configureBlocklister(deployer.address, true));
    await proveTx(token.connect(deployer).assignPurposes(purposeAccount.address, [PURPOSE]));
    await proveTx(token.connect(deployer).updateMainMinter(deployer.address));
    await proveTx(token.connect(deployer).configureMinter(deployer.address, 20));
    await proveTx(token.connect(deployer).configureMaxPendingPremintsCount(MAX_PENDING_PREMINTS_COUNT));
    await proveTx(token.connect(user).approveFreezing());
    return { token };
  }

  async function checkComplexBalanceGetter(
    props: {
      token: Contract;
      amounts: {
        mint: number;
        premint: number;
        frozen: number;
        restricted: number;
      };
    }
  ) {
    const timestamp = (await time.latest()) + 100;
    const { token, amounts } = props;
    if (amounts.mint > 0) {
      await proveTx(token.connect(deployer).mint(user.address, amounts.mint));
    }
    if (amounts.premint > 0) {
      await proveTx(token.connect(deployer).premint(user.address, amounts.premint, timestamp, PremintRestriction.None));
    }
    if (amounts.frozen > 0) {
      await proveTx(token.connect(deployer).freeze(user.address, amounts.frozen));
    }
    if (amounts.restricted > 0) {
      await proveTx(token.connect(deployer).updateRestriction(user.address, PURPOSE, amounts.restricted));
    }

    const total = amounts.mint + amounts.premint;
    const detained = amounts.premint + amounts.frozen + amounts.restricted;
    const free = total > detained ? total - detained : 0;
    const complexBalance = await token.balanceOfComplex(user.address);

    expect(complexBalance.total).to.eq(total);
    expect(complexBalance.free).to.eq(free);
    expect(complexBalance.premint).to.eq(amounts.premint);
    expect(complexBalance.frozen).to.eq(amounts.frozen);
    expect(complexBalance.restricted).to.eq(amounts.restricted);
  }

  describe("Function 'transferFrom()'", async () => {
    it("Executes as expected for non-trusted and trusted accounts", async () => {
      const maxAmount = ethers.constants.MaxUint256;
      const userBalance = 123;

      const { token } = await setUpFixture(deployToken);
      await proveTx(token.updateMainMinter(deployer.address));
      await proveTx(token.configureMinter(deployer.address, maxAmount));
      await proveTx(token.mint(user.address, userBalance));

      await expect(
        token.connect(deployer).transferFrom(user.address, deployer.address, userBalance)
      ).to.be.revertedWith(REVERT_MESSAGE_INSUFFICIENT_ALLOWANCE);

      await proveTx(token.configureTrustedAccount(deployer.address, true));

      await expect(
        token.connect(deployer).transferFrom(user.address, deployer.address, userBalance)
      ).to.be.changeTokenBalances(token, [user, deployer], [-userBalance, +userBalance]);
    });
  });

  describe("Function 'balancesOfComplex()'", async () => {
    it("Returns correct values if detained balance is less than total balance", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await checkComplexBalanceGetter({ token, amounts: { mint: 15, premint: 5, frozen: 5, restricted: 5 } });
    });

    it("Returns correct values if detained balance is bigger than total balance", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await checkComplexBalanceGetter({ token, amounts: { mint: 15, premint: 5, frozen: 10, restricted: 5 } });
    });

    it("Returns correct values with no limited balances", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await checkComplexBalanceGetter({ token, amounts: { mint: 15, premint: 0, frozen: 0, restricted: 0 } });
    });

    it("Returns correct values with no free balance", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await checkComplexBalanceGetter({ token, amounts: { mint: 0, premint: 5, frozen: 5, restricted: 5 } });
    });

    it("Returns correct values with only premint balance", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await checkComplexBalanceGetter({ token, amounts: { mint: 0, premint: 5, frozen: 0, restricted: 0 } });
    });

    it("Returns correct values with only frozen balance", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await checkComplexBalanceGetter({ token, amounts: { mint: 0, premint: 0, frozen: 5, restricted: 0 } });
    });

    it("Returns correct values with only restricted balance", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await checkComplexBalanceGetter({ token, amounts: { mint: 0, premint: 0, frozen: 0, restricted: 5 } });
    });

    it("Returns correct values with no balances at all", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await checkComplexBalanceGetter({ token, amounts: { mint: 0, premint: 0, frozen: 0, restricted: 0 } });
    });
  });

  describe("Frozen and restricted balances", async () => {
    it("Transfer to purpose account - test 5", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.connect(deployer).mint(user.address, 20));
      await proveTx(token.connect(deployer).freeze(user.address, 10));
      await proveTx(token.connect(deployer).updateRestriction(user.address, PURPOSE, 10));
      await expect(
        token.connect(user).transfer(purposeAccount.address, 5)
      ).to.changeTokenBalances(
        token,
        [user, purposeAccount],
        [-5, 5]
      );
      expect(await token.balanceOfRestricted(user.address, PURPOSE)).to.eq(5);
    });

    it("Transfer to purpose account - test 10", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.connect(deployer).mint(user.address, 20));
      await proveTx(token.connect(deployer).freeze(user.address, 10));
      await proveTx(token.connect(deployer).updateRestriction(user.address, PURPOSE, 10));
      await expect(
        token.connect(user).transfer(purposeAccount.address, 10)
      ).to.changeTokenBalances(
        token,
        [user, purposeAccount],
        [-10, 10]
      );
      expect(await token.balanceOfRestricted(user.address, PURPOSE)).to.eq(0);
    });

    it("Transfer to purpose account - test 15", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.connect(deployer).mint(user.address, 20));
      await proveTx(token.connect(deployer).freeze(user.address, 10));
      await proveTx(token.connect(deployer).updateRestriction(user.address, PURPOSE, 10));
      await expect(
        token.connect(user).transfer(purposeAccount.address, 15)
      ).to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_FROZEN_AMOUNT);
    });

    it("Transfer to purpose account - test 20", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.connect(deployer).mint(user.address, 20));
      await proveTx(token.connect(deployer).freeze(user.address, 10));
      await proveTx(token.connect(deployer).updateRestriction(user.address, PURPOSE, 10));
      await expect(
        token.connect(user).transfer(purposeAccount.address, 20)
      ).to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_FROZEN_AMOUNT);
    });

    it("Transfer to purpose account - test 25", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.connect(deployer).mint(user.address, 20));
      await proveTx(token.connect(deployer).freeze(user.address, 10));
      await proveTx(token.connect(deployer).updateRestriction(user.address, PURPOSE, 10));
      await expect(
        token.connect(user).transfer(purposeAccount.address, 25)
      ).to.be.revertedWith(REVERT_MESSAGE_ERC20_TRANSFER_AMOUNT_EXCEEDS_BALANCE);
    });

    it("Transfer to non-purpose account - test 5", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.connect(deployer).mint(user.address, 20));
      await proveTx(token.connect(deployer).freeze(user.address, 10));
      await proveTx(token.connect(deployer).updateRestriction(user.address, PURPOSE, 10));
      await expect(
        token.connect(user).transfer(nonPurposeAccount.address, 5)
      ).to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_RESTRICTED_AMOUNT);
    });

    it("Transfer to non-purpose account - test 10", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.connect(deployer).mint(user.address, 20));
      await proveTx(token.connect(deployer).freeze(user.address, 10));
      await proveTx(token.connect(deployer).updateRestriction(user.address, PURPOSE, 10));
      await expect(
        token.connect(user).transfer(nonPurposeAccount.address, 10)
      ).to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_RESTRICTED_AMOUNT);
    });

    it("Transfer to non-purpose account - test 15", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.connect(deployer).mint(user.address, 20));
      await proveTx(token.connect(deployer).freeze(user.address, 10));
      await proveTx(token.connect(deployer).updateRestriction(user.address, PURPOSE, 10));
      await expect(
        token.connect(user).transfer(nonPurposeAccount.address, 15)
      ).to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_FROZEN_AMOUNT);
    });

    it("Transfer to non-purpose account - test 20", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.connect(deployer).mint(user.address, 20));
      await proveTx(token.connect(deployer).freeze(user.address, 10));
      await proveTx(token.connect(deployer).updateRestriction(user.address, PURPOSE, 10));
      await expect(
        token.connect(user).transfer(nonPurposeAccount.address, 20)
      ).to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_FROZEN_AMOUNT);
    });

    it("Transfer to non-purpose account - test 25", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.connect(deployer).mint(user.address, 20));
      await proveTx(token.connect(deployer).freeze(user.address, 10));
      await proveTx(token.connect(deployer).updateRestriction(user.address, PURPOSE, 10));
      await expect(
        token.connect(user).transfer(nonPurposeAccount.address, 25)
      ).to.be.revertedWith(REVERT_MESSAGE_ERC20_TRANSFER_AMOUNT_EXCEEDS_BALANCE);
    });
  });

  describe("Frozen and premint balances", async () => {
    let timestamp: number;
    before(async () => {
      timestamp = (await time.latest()) + 100;
    });
    it("Transfer to purpose account - test 5 with release awaiting", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.connect(deployer).mint(user.address, 10));
      await proveTx(token.connect(deployer).premint(user.address, 10, timestamp, PremintRestriction.None));
      await proveTx(token.connect(deployer).freeze(user.address, 10));
      await time.increaseTo(timestamp);
      await expect(
        token.connect(user).transfer(purposeAccount.address, 5)
      ).to.changeTokenBalances(
        token,
        [user, purposeAccount],
        [-5, 5]
      );
    });

    it("Transfer to purpose account - test 10 with release awaiting", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.connect(deployer).mint(user.address, 10));
      await proveTx(token.connect(deployer).premint(user.address, 10, timestamp, PremintRestriction.None));
      await proveTx(token.connect(deployer).freeze(user.address, 10));
      await time.increaseTo(timestamp);
      await expect(
        token.connect(user).transfer(purposeAccount.address, 10)
      ).to.changeTokenBalances(
        token,
        [user, purposeAccount],
        [-10, 10]
      );
    });

    it("Transfer to purpose account - test 15 with release awaiting", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.connect(deployer).mint(user.address, 10));
      await proveTx(token.connect(deployer).premint(user.address, 10, timestamp, PremintRestriction.None));
      await proveTx(token.connect(deployer).freeze(user.address, 10));
      await time.increaseTo(timestamp);
      await expect(
        token.connect(user).transfer(purposeAccount.address, 15)
      ).to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_FROZEN_AMOUNT);
    });

    it("Transfer to purpose account - test 20 with release awaiting", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.connect(deployer).mint(user.address, 10));
      await proveTx(token.connect(deployer).premint(user.address, 10, timestamp, PremintRestriction.None));
      await proveTx(token.connect(deployer).freeze(user.address, 10));
      await time.increaseTo(timestamp);
      await expect(
        token.connect(user).transfer(purposeAccount.address, 20)
      ).to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_FROZEN_AMOUNT);
    });

    it("Transfer to purpose account - test 25 with release awaiting", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.connect(deployer).mint(user.address, 10));
      await proveTx(token.connect(deployer).premint(user.address, 10, timestamp, PremintRestriction.None));
      await proveTx(token.connect(deployer).freeze(user.address, 10));
      await time.increaseTo(timestamp);
      await expect(
        token.connect(user).transfer(purposeAccount.address, 25)
      ).to.be.revertedWith(REVERT_MESSAGE_ERC20_TRANSFER_AMOUNT_EXCEEDS_BALANCE);
    });

    it("Transfer to non-purpose account - test 5 with release awaiting", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.connect(deployer).mint(user.address, 10));
      await proveTx(token.connect(deployer).premint(user.address, 10, timestamp, PremintRestriction.None));
      await proveTx(token.connect(deployer).freeze(user.address, 10));
      await time.increaseTo(timestamp);
      await expect(
        token.connect(user).transfer(nonPurposeAccount.address, 5)
      ).to.changeTokenBalances(
        token,
        [user, nonPurposeAccount],
        [-5, 5]
      );
    });

    it("Transfer to non-purpose account - test 10 with release awaiting", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.connect(deployer).mint(user.address, 10));
      await proveTx(token.connect(deployer).premint(user.address, 10, timestamp, PremintRestriction.None));
      await proveTx(token.connect(deployer).freeze(user.address, 10));
      await time.increaseTo(timestamp);
      await expect(
        token.connect(user).transfer(nonPurposeAccount.address, 10)
      ).to.changeTokenBalances(
        token,
        [user, nonPurposeAccount],
        [-10, 10]
      );
    });

    it("Transfer to non-purpose account - test 15 with release awaiting", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.connect(deployer).mint(user.address, 10));
      await proveTx(token.connect(deployer).premint(user.address, 10, timestamp, PremintRestriction.None));
      await proveTx(token.connect(deployer).freeze(user.address, 10));
      await time.increaseTo(timestamp);
      await expect(
        token.connect(user).transfer(nonPurposeAccount.address, 15)
      ).to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_FROZEN_AMOUNT);
    });

    it("Transfer to non-purpose account - test 20 with release awaiting", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.connect(deployer).mint(user.address, 10));
      await proveTx(token.connect(deployer).premint(user.address, 10, timestamp, PremintRestriction.None));
      await proveTx(token.connect(deployer).freeze(user.address, 10));
      await time.increaseTo(timestamp);
      await expect(
        token.connect(user).transfer(nonPurposeAccount.address, 20)
      ).to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_FROZEN_AMOUNT);
    });

    it("Transfer to non-purpose account - test 25 with release awaiting", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.connect(deployer).mint(user.address, 10));
      await proveTx(token.connect(deployer).premint(user.address, 10, timestamp, PremintRestriction.None));
      await proveTx(token.connect(deployer).freeze(user.address, 10));
      await time.increaseTo(timestamp);
      await expect(
        token.connect(user).transfer(nonPurposeAccount.address, 25)
      ).to.be.revertedWith(REVERT_MESSAGE_ERC20_TRANSFER_AMOUNT_EXCEEDS_BALANCE);
    });

    it("Transfer to purpose account - test 5 with no release awaiting", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.connect(deployer).mint(user.address, 10));
      await proveTx(token.connect(deployer).premint(user.address, 10, timestamp, PremintRestriction.None));
      await proveTx(token.connect(deployer).freeze(user.address, 10));
      await expect(
        token.connect(user).transfer(purposeAccount.address, 5)
      ).to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_FROZEN_AMOUNT);
    });

    it("Transfer to purpose account - test 10 with no release awaiting", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.connect(deployer).mint(user.address, 10));
      await proveTx(token.connect(deployer).premint(user.address, 10, timestamp, PremintRestriction.None));
      await proveTx(token.connect(deployer).freeze(user.address, 10));
      await expect(
        token.connect(user).transfer(purposeAccount.address, 10)
      ).to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_FROZEN_AMOUNT);
    });

    it("Transfer to purpose account - test 15 with no release awaiting", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.connect(deployer).mint(user.address, 10));
      await proveTx(token.connect(deployer).premint(user.address, 10, timestamp, PremintRestriction.None));
      await proveTx(token.connect(deployer).freeze(user.address, 10));
      await expect(
        token.connect(user).transfer(purposeAccount.address, 15)
      ).to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_PREMINT_AMOUNT);
    });

    it("Transfer to purpose account - test 20 with no release awaiting", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.connect(deployer).mint(user.address, 10));
      await proveTx(token.connect(deployer).premint(user.address, 10, timestamp, PremintRestriction.None));
      await proveTx(token.connect(deployer).freeze(user.address, 10));
      await expect(
        token.connect(user).transfer(purposeAccount.address, 20)
      ).to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_PREMINT_AMOUNT);
    });

    it("Transfer to purpose account - test 25 with no release awaiting", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.connect(deployer).mint(user.address, 10));
      await proveTx(token.connect(deployer).premint(user.address, 10, timestamp, PremintRestriction.None));
      await proveTx(token.connect(deployer).freeze(user.address, 10));
      await expect(
        token.connect(user).transfer(purposeAccount.address, 25)
      ).to.be.revertedWith(REVERT_MESSAGE_ERC20_TRANSFER_AMOUNT_EXCEEDS_BALANCE);
    });

    it("Transfer to non-purpose account - test 5 with no release awaiting", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.connect(deployer).mint(user.address, 10));
      await proveTx(token.connect(deployer).premint(user.address, 10, timestamp, PremintRestriction.None));
      await proveTx(token.connect(deployer).freeze(user.address, 10));
      await expect(
        token.connect(user).transfer(nonPurposeAccount.address, 5)
      ).to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_FROZEN_AMOUNT);
    });

    it("Transfer to non-purpose account - test 10 with no release awaiting", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.connect(deployer).mint(user.address, 10));
      await proveTx(token.connect(deployer).premint(user.address, 10, timestamp, PremintRestriction.None));
      await proveTx(token.connect(deployer).freeze(user.address, 10));
      await expect(
        token.connect(user).transfer(nonPurposeAccount.address, 10)
      ).to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_FROZEN_AMOUNT);
    });

    it("Transfer to non-purpose account - test 15 with no release awaiting", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.connect(deployer).mint(user.address, 10));
      await proveTx(token.connect(deployer).premint(user.address, 10, timestamp, PremintRestriction.None));
      await proveTx(token.connect(deployer).freeze(user.address, 10));
      await expect(
        token.connect(user).transfer(nonPurposeAccount.address, 15)
      ).to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_PREMINT_AMOUNT);
    });

    it("Transfer to non-purpose account - test 20 with no release awaiting", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.connect(deployer).mint(user.address, 10));
      await proveTx(token.connect(deployer).premint(user.address, 10, timestamp, PremintRestriction.None));
      await proveTx(token.connect(deployer).freeze(user.address, 10));
      await expect(
        token.connect(user).transfer(nonPurposeAccount.address, 20)
      ).to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_PREMINT_AMOUNT);
    });

    it("Transfer to non-purpose account - test 25 with no release awaiting", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.connect(deployer).mint(user.address, 10));
      await proveTx(token.connect(deployer).premint(user.address, 10, timestamp, PremintRestriction.None));
      await proveTx(token.connect(deployer).freeze(user.address, 10));
      await expect(
        token.connect(user).transfer(nonPurposeAccount.address, 25)
      ).to.be.revertedWith(REVERT_MESSAGE_ERC20_TRANSFER_AMOUNT_EXCEEDS_BALANCE);
    });
  });

  describe("Premint and restricted balances", async () => {
    let timestamp: number;
    before(async () => {
      timestamp = (await time.latest()) + 100;
    });
    it("Transfer to purpose account - test 5 with release awaiting", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.connect(deployer).mint(user.address, 10));
      await proveTx(token.connect(deployer).premint(user.address, 10, timestamp, PremintRestriction.None));
      await proveTx(token.connect(deployer).updateRestriction(user.address, PURPOSE, 10));
      await time.increaseTo(timestamp);
      await expect(
        token.connect(user).transfer(purposeAccount.address, 5)
      ).to.changeTokenBalances(
        token,
        [user, purposeAccount],
        [-5, 5]
      );
      expect(await token.balanceOfRestricted(user.address, PURPOSE)).to.eq(5);
    });

    it("Transfer to purpose account - test 10 with release awaiting", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.connect(deployer).mint(user.address, 10));
      await proveTx(token.connect(deployer).premint(user.address, 10, timestamp, PremintRestriction.None));
      await proveTx(token.connect(deployer).updateRestriction(user.address, PURPOSE, 10));
      await time.increaseTo(timestamp);
      await expect(
        token.connect(user).transfer(purposeAccount.address, 10)
      ).to.changeTokenBalances(
        token,
        [user, purposeAccount],
        [-10, 10]
      );
      expect(await token.balanceOfRestricted(user.address, PURPOSE)).to.eq(0);
    });

    it("Transfer to purpose account - test 15 with release awaiting", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.connect(deployer).mint(user.address, 10));
      await proveTx(token.connect(deployer).premint(user.address, 10, timestamp, PremintRestriction.None));
      await proveTx(token.connect(deployer).updateRestriction(user.address, PURPOSE, 10));
      await time.increaseTo(timestamp);
      await expect(
        token.connect(user).transfer(purposeAccount.address, 15)
      ).to.changeTokenBalances(
        token,
        [user, purposeAccount],
        [-15, 15]
      );
      expect(await token.balanceOfRestricted(user.address, PURPOSE)).to.eq(0);
    });

    it("Transfer to purpose account - test 20 with release awaiting", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.connect(deployer).mint(user.address, 10));
      await proveTx(token.connect(deployer).premint(user.address, 10, timestamp, PremintRestriction.None));
      await proveTx(token.connect(deployer).updateRestriction(user.address, PURPOSE, 10));
      await time.increaseTo(timestamp);
      await expect(
        token.connect(user).transfer(purposeAccount.address, 20)
      ).to.changeTokenBalances(
        token,
        [user, purposeAccount],
        [-20, 20]
      );
      expect(await token.balanceOfRestricted(user.address, PURPOSE)).to.eq(0);
    });

    it("Transfer to purpose account - test 25 with release awaiting", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.connect(deployer).mint(user.address, 10));
      await proveTx(token.connect(deployer).premint(user.address, 10, timestamp, PremintRestriction.None));
      await proveTx(token.connect(deployer).updateRestriction(user.address, PURPOSE, 10));
      await time.increaseTo(timestamp);
      await expect(
        token.connect(user).transfer(purposeAccount.address, 25)
      ).to.be.revertedWith(REVERT_MESSAGE_ERC20_TRANSFER_AMOUNT_EXCEEDS_BALANCE);
      expect(await token.balanceOfRestricted(user.address, PURPOSE)).to.eq(10);
    });

    it("Transfer to non-purpose account - test 5 with release awaiting", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.connect(deployer).mint(user.address, 10));
      await proveTx(token.connect(deployer).premint(user.address, 10, timestamp, PremintRestriction.None));
      await proveTx(token.connect(deployer).updateRestriction(user.address, PURPOSE, 10));
      await time.increaseTo(timestamp);
      await expect(
        token.connect(user).transfer(nonPurposeAccount.address, 5)
      ).to.changeTokenBalances(
        token,
        [user, nonPurposeAccount],
        [-5, 5]
      );
      expect(await token.balanceOfRestricted(user.address, PURPOSE)).to.eq(10);
    });

    it("Transfer to non-purpose account - test 10 with release awaiting", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.connect(deployer).mint(user.address, 10));
      await proveTx(token.connect(deployer).premint(user.address, 10, timestamp, PremintRestriction.None));
      await proveTx(token.connect(deployer).updateRestriction(user.address, PURPOSE, 10));
      await time.increaseTo(timestamp);
      await expect(
        token.connect(user).transfer(nonPurposeAccount.address, 10)
      ).to.changeTokenBalances(
        token,
        [user, nonPurposeAccount],
        [-10, 10]
      );
      expect(await token.balanceOfRestricted(user.address, PURPOSE)).to.eq(10);
    });

    it("Transfer to non-purpose account - test 15 with release awaiting", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.connect(deployer).mint(user.address, 10));
      await proveTx(token.connect(deployer).premint(user.address, 10, timestamp, PremintRestriction.None));
      await proveTx(token.connect(deployer).updateRestriction(user.address, PURPOSE, 10));
      await time.increaseTo(timestamp);
      await expect(
        token.connect(user).transfer(nonPurposeAccount.address, 15)
      ).to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_RESTRICTED_AMOUNT);
    });

    it("Transfer to non-purpose account - test 20 with release awaiting", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.connect(deployer).mint(user.address, 10));
      await proveTx(token.connect(deployer).premint(user.address, 10, timestamp, PremintRestriction.None));
      await proveTx(token.connect(deployer).updateRestriction(user.address, PURPOSE, 10));
      await time.increaseTo(timestamp);
      await expect(
        token.connect(user).transfer(nonPurposeAccount.address, 20)
      ).to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_RESTRICTED_AMOUNT);
    });

    it("Transfer to non-purpose account - test 25 with release awaiting", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.connect(deployer).mint(user.address, 10));
      await proveTx(token.connect(deployer).premint(user.address, 10, timestamp, PremintRestriction.None));
      await proveTx(token.connect(deployer).updateRestriction(user.address, PURPOSE, 10));
      await time.increaseTo(timestamp);
      await expect(
        token.connect(user).transfer(nonPurposeAccount.address, 25)
      ).to.be.revertedWith(REVERT_MESSAGE_ERC20_TRANSFER_AMOUNT_EXCEEDS_BALANCE);
    });

    it("Transfer to purpose account - test 5 with no release awaiting", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.connect(deployer).mint(user.address, 10));
      await proveTx(token.connect(deployer).premint(user.address, 10, timestamp, PremintRestriction.None));
      await proveTx(token.connect(deployer).updateRestriction(user.address, PURPOSE, 10));
      await expect(
        token.connect(user).transfer(purposeAccount.address, 5)
      ).to.changeTokenBalances(
        token,
        [user, purposeAccount],
        [-5, 5]
      );
      expect(await token.balanceOfRestricted(user.address, PURPOSE)).to.eq(5);
    });

    it("Transfer to purpose account - test 10 with no release awaiting", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.connect(deployer).mint(user.address, 10));
      await proveTx(token.connect(deployer).premint(user.address, 10, timestamp, PremintRestriction.None));
      await proveTx(token.connect(deployer).updateRestriction(user.address, PURPOSE, 10));
      await expect(
        token.connect(user).transfer(purposeAccount.address, 10)
      ).to.changeTokenBalances(
        token,
        [user, purposeAccount],
        [-10, 10]
      );
      expect(await token.balanceOfRestricted(user.address, PURPOSE)).to.eq(0);
    });

    it("Transfer to purpose account - test 15 with no release awaiting", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.connect(deployer).mint(user.address, 10));
      await proveTx(token.connect(deployer).premint(user.address, 10, timestamp, PremintRestriction.None));
      await proveTx(token.connect(deployer).updateRestriction(user.address, PURPOSE, 10));
      await expect(
        token.connect(user).transfer(purposeAccount.address, 15)
      ).to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_PREMINT_AMOUNT);
      expect(await token.balanceOfRestricted(user.address, PURPOSE)).to.eq(10);
    });

    it("Transfer to purpose account - test 20 with no release awaiting", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.connect(deployer).mint(user.address, 10));
      await proveTx(token.connect(deployer).premint(user.address, 10, timestamp, PremintRestriction.None));
      await proveTx(token.connect(deployer).updateRestriction(user.address, PURPOSE, 10));
      await expect(
        token.connect(user).transfer(purposeAccount.address, 20)
      ).to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_PREMINT_AMOUNT);
      expect(await token.balanceOfRestricted(user.address, PURPOSE)).to.eq(10);
    });

    it("Transfer to purpose account - test 25 with no release awaiting", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.connect(deployer).mint(user.address, 10));
      await proveTx(token.connect(deployer).premint(user.address, 10, timestamp, PremintRestriction.None));
      await proveTx(token.connect(deployer).updateRestriction(user.address, PURPOSE, 10));
      await expect(
        token.connect(user).transfer(purposeAccount.address, 25)
      ).to.be.revertedWith(REVERT_MESSAGE_ERC20_TRANSFER_AMOUNT_EXCEEDS_BALANCE);
      expect(await token.balanceOfRestricted(user.address, PURPOSE)).to.eq(10);
    });

    it("Transfer to non-purpose account - test 5 with no release awaiting", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.connect(deployer).mint(user.address, 10));
      await proveTx(token.connect(deployer).premint(user.address, 10, timestamp, PremintRestriction.None));
      await proveTx(token.connect(deployer).updateRestriction(user.address, PURPOSE, 10));
      await expect(
        token.connect(user).transfer(nonPurposeAccount.address, 5)
      ).to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_RESTRICTED_AMOUNT);
      expect(await token.balanceOfRestricted(user.address, PURPOSE)).to.eq(10);
    });

    it("Transfer to non-purpose account - test 10 with no release awaiting", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.connect(deployer).mint(user.address, 10));
      await proveTx(token.connect(deployer).premint(user.address, 10, timestamp, PremintRestriction.None));
      await proveTx(token.connect(deployer).updateRestriction(user.address, PURPOSE, 10));
      await expect(
        token.connect(user).transfer(nonPurposeAccount.address, 10)
      ).to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_RESTRICTED_AMOUNT);
      expect(await token.balanceOfRestricted(user.address, PURPOSE)).to.eq(10);
    });

    it("Transfer to non-purpose account - test 15 with no release awaiting", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.connect(deployer).mint(user.address, 10));
      await proveTx(token.connect(deployer).premint(user.address, 10, timestamp, PremintRestriction.None));
      await proveTx(token.connect(deployer).updateRestriction(user.address, PURPOSE, 10));
      await expect(
        token.connect(user).transfer(nonPurposeAccount.address, 15)
      ).to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_PREMINT_AMOUNT);
      expect(await token.balanceOfRestricted(user.address, PURPOSE)).to.eq(10);
    });

    it("Transfer to non-purpose account - test 20 with no release awaiting", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.connect(deployer).mint(user.address, 10));
      await proveTx(token.connect(deployer).premint(user.address, 10, timestamp, PremintRestriction.None));
      await proveTx(token.connect(deployer).updateRestriction(user.address, PURPOSE, 10));
      await expect(
        token.connect(user).transfer(nonPurposeAccount.address, 20)
      ).to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_PREMINT_AMOUNT);
      expect(await token.balanceOfRestricted(user.address, PURPOSE)).to.eq(10);
    });

    it("Transfer to non-purpose account - test 25 with no release awaiting", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.connect(deployer).mint(user.address, 10));
      await proveTx(token.connect(deployer).premint(user.address, 10, timestamp, PremintRestriction.None));
      await proveTx(token.connect(deployer).updateRestriction(user.address, PURPOSE, 10));
      await expect(
        token.connect(user).transfer(nonPurposeAccount.address, 25)
      ).to.be.revertedWith(REVERT_MESSAGE_ERC20_TRANSFER_AMOUNT_EXCEEDS_BALANCE);
    });
  });

  describe("Frozen, restricted and premint balances", async () => {
    let timestamp: number;
    before(async () => {
      timestamp = (await time.latest()) + 100;
    });
    it("Transfer to purpose account - test 5 with release awaiting", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.connect(deployer).mint(user.address, 15));
      await proveTx(token.connect(deployer).premint(user.address, 5, timestamp, PremintRestriction.None));
      await proveTx(token.connect(deployer).freeze(user.address, 5));
      await proveTx(token.connect(deployer).updateRestriction(user.address, PURPOSE, 5));
      await time.increaseTo(timestamp);
      await expect(
        token.connect(user).transfer(purposeAccount.address, 5)
      ).to.changeTokenBalances(
        token,
        [user, purposeAccount],
        [-5, 5]
      );
      expect(await token.balanceOfRestricted(user.address, PURPOSE)).to.eq(0);
    });

    it("Transfer to purpose account - test 10 with release awaiting", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.connect(deployer).mint(user.address, 15));
      await proveTx(token.connect(deployer).premint(user.address, 5, timestamp, PremintRestriction.None));
      await proveTx(token.connect(deployer).freeze(user.address, 5));
      await proveTx(token.connect(deployer).updateRestriction(user.address, PURPOSE, 5));
      await time.increaseTo(timestamp);
      await expect(
        token.connect(user).transfer(purposeAccount.address, 10)
      ).to.changeTokenBalances(
        token,
        [user, purposeAccount],
        [-10, 10]
      );
      expect(await token.balanceOfRestricted(user.address, PURPOSE)).to.eq(0);
    });

    it("Transfer to purpose account - test 15 with release awaiting", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.connect(deployer).mint(user.address, 15));
      await proveTx(token.connect(deployer).premint(user.address, 5, timestamp, PremintRestriction.None));
      await proveTx(token.connect(deployer).freeze(user.address, 5));
      await proveTx(token.connect(deployer).updateRestriction(user.address, PURPOSE, 5));
      await time.increaseTo(timestamp);
      await expect(
        token.connect(user).transfer(purposeAccount.address, 15)
      ).to.changeTokenBalances(
        token,
        [user, purposeAccount],
        [-15, 15]
      );
      expect(await token.balanceOfRestricted(user.address, PURPOSE)).to.eq(0);
    });

    it("Transfer to purpose account - test 20 with release awaiting", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.connect(deployer).mint(user.address, 15));
      await proveTx(token.connect(deployer).premint(user.address, 5, timestamp, PremintRestriction.None));
      await proveTx(token.connect(deployer).freeze(user.address, 5));
      await proveTx(token.connect(deployer).updateRestriction(user.address, PURPOSE, 5));
      await time.increaseTo(timestamp);
      await expect(
        token.connect(user).transfer(purposeAccount.address, 20)
      ).to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_FROZEN_AMOUNT);
    });

    it("Transfer to purpose account - test 25 with release awaiting", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.connect(deployer).mint(user.address, 15));
      await proveTx(token.connect(deployer).premint(user.address, 5, timestamp, PremintRestriction.None));
      await proveTx(token.connect(deployer).freeze(user.address, 5));
      await proveTx(token.connect(deployer).updateRestriction(user.address, PURPOSE, 5));
      await time.increaseTo(timestamp);
      await expect(
        token.connect(user).transfer(purposeAccount.address, 25)
      ).to.be.revertedWith(REVERT_MESSAGE_ERC20_TRANSFER_AMOUNT_EXCEEDS_BALANCE);
    });

    it("Transfer to non-purpose account - test 5 with release awaiting", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.connect(deployer).mint(user.address, 15));
      await proveTx(token.connect(deployer).premint(user.address, 5, timestamp, PremintRestriction.None));
      await proveTx(token.connect(deployer).freeze(user.address, 5));
      await proveTx(token.connect(deployer).updateRestriction(user.address, PURPOSE, 5));
      await time.increaseTo(timestamp);
      await expect(
        token.connect(user).transfer(nonPurposeAccount.address, 5)
      ).to.changeTokenBalances(
        token,
        [user, nonPurposeAccount],
        [-5, 5]
      );
      expect(await token.balanceOfRestricted(user.address, PURPOSE)).to.eq(5);
    });

    it("Transfer to non-purpose account - test 10 with release awaiting", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.connect(deployer).mint(user.address, 15));
      await proveTx(token.connect(deployer).premint(user.address, 5, timestamp, PremintRestriction.None));
      await proveTx(token.connect(deployer).freeze(user.address, 5));
      await proveTx(token.connect(deployer).updateRestriction(user.address, PURPOSE, 5));
      await time.increaseTo(timestamp);
      await expect(
        token.connect(user).transfer(nonPurposeAccount.address, 10)
      ).to.changeTokenBalances(
        token,
        [user, nonPurposeAccount],
        [-10, 10]
      );
      expect(await token.balanceOfRestricted(user.address, PURPOSE)).to.eq(5);
    });

    it("Transfer to non-purpose account - test 15 with release awaiting", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.connect(deployer).mint(user.address, 15));
      await proveTx(token.connect(deployer).premint(user.address, 5, timestamp, PremintRestriction.None));
      await proveTx(token.connect(deployer).freeze(user.address, 5));
      await proveTx(token.connect(deployer).updateRestriction(user.address, PURPOSE, 5));
      await time.increaseTo(timestamp);
      await expect(
        token.connect(user).transfer(nonPurposeAccount.address, 15)
      ).to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_RESTRICTED_AMOUNT);
    });

    it("Transfer to non-purpose account - test 20 with release awaiting", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.connect(deployer).mint(user.address, 15));
      await proveTx(token.connect(deployer).premint(user.address, 5, timestamp, PremintRestriction.None));
      await proveTx(token.connect(deployer).freeze(user.address, 5));
      await proveTx(token.connect(deployer).updateRestriction(user.address, PURPOSE, 5));
      await time.increaseTo(timestamp);
      await expect(
        token.connect(user).transfer(nonPurposeAccount.address, 20)
      ).to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_FROZEN_AMOUNT);
    });

    it("Transfer to non-purpose account - test 25 with release awaiting", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.connect(deployer).mint(user.address, 15));
      await proveTx(token.connect(deployer).premint(user.address, 5, timestamp, PremintRestriction.None));
      await proveTx(token.connect(deployer).freeze(user.address, 5));
      await proveTx(token.connect(deployer).updateRestriction(user.address, PURPOSE, 5));
      await time.increaseTo(timestamp);
      await expect(
        token.connect(user).transfer(nonPurposeAccount.address, 25)
      ).to.be.revertedWith(REVERT_MESSAGE_ERC20_TRANSFER_AMOUNT_EXCEEDS_BALANCE);
    });

    it("Transfer to purpose account - test 5 with no release awaiting", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.connect(deployer).mint(user.address, 15));
      await proveTx(token.connect(deployer).premint(user.address, 5, timestamp, PremintRestriction.None));
      await proveTx(token.connect(deployer).freeze(user.address, 5));
      await proveTx(token.connect(deployer).updateRestriction(user.address, PURPOSE, 5));
      await expect(
        token.connect(user).transfer(purposeAccount.address, 5)
      ).to.changeTokenBalances(
        token,
        [user, purposeAccount],
        [-5, 5]
      );
      expect(await token.balanceOfRestricted(user.address, PURPOSE)).to.eq(0);
    });

    it("Transfer to purpose account - test 10 with no release awaiting", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.connect(deployer).mint(user.address, 15));
      await proveTx(token.connect(deployer).premint(user.address, 5, timestamp, PremintRestriction.None));
      await proveTx(token.connect(deployer).freeze(user.address, 5));
      await proveTx(token.connect(deployer).updateRestriction(user.address, PURPOSE, 5));
      await expect(
        token.connect(user).transfer(purposeAccount.address, 10)
      ).to.changeTokenBalances(
        token,
        [user, purposeAccount],
        [-10, 10]
      );
      expect(await token.balanceOfRestricted(user.address, PURPOSE)).to.eq(0);
    });

    it("Transfer to purpose account - test 15 with no release awaiting", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.connect(deployer).mint(user.address, 15));
      await proveTx(token.connect(deployer).premint(user.address, 5, timestamp, PremintRestriction.None));
      await proveTx(token.connect(deployer).freeze(user.address, 5));
      await proveTx(token.connect(deployer).updateRestriction(user.address, PURPOSE, 5));
      await expect(
        token.connect(user).transfer(purposeAccount.address, 15)
      ).to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_FROZEN_AMOUNT);
    });

    it("Transfer to purpose account - test 20 with no release awaiting", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.connect(deployer).mint(user.address, 15));
      await proveTx(token.connect(deployer).premint(user.address, 5, timestamp, PremintRestriction.None));
      await proveTx(token.connect(deployer).freeze(user.address, 5));
      await proveTx(token.connect(deployer).updateRestriction(user.address, PURPOSE, 5));
      await expect(
        token.connect(user).transfer(purposeAccount.address, 20)
      ).to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_PREMINT_AMOUNT);
    });

    it("Transfer to purpose account - test 25 with no release awaiting", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.connect(deployer).mint(user.address, 15));
      await proveTx(token.connect(deployer).premint(user.address, 5, timestamp, PremintRestriction.None));
      await proveTx(token.connect(deployer).freeze(user.address, 5));
      await proveTx(token.connect(deployer).updateRestriction(user.address, PURPOSE, 5));
      await expect(
        token.connect(user).transfer(purposeAccount.address, 25)
      ).to.be.revertedWith(REVERT_MESSAGE_ERC20_TRANSFER_AMOUNT_EXCEEDS_BALANCE);
    });

    it("Transfer to non-purpose account - test 5 with no release awaiting", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.connect(deployer).mint(user.address, 15));
      await proveTx(token.connect(deployer).premint(user.address, 5, timestamp, PremintRestriction.None));
      await proveTx(token.connect(deployer).freeze(user.address, 5));
      await proveTx(token.connect(deployer).updateRestriction(user.address, PURPOSE, 5));
      await expect(
        token.connect(user).transfer(nonPurposeAccount.address, 5)
      ).to.changeTokenBalances(
        token,
        [user, nonPurposeAccount],
        [-5, 5]
      );
      expect(await token.balanceOfRestricted(user.address, PURPOSE)).to.eq(5);
    });

    it("Transfer to non-purpose account - test 10 with no release awaiting", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.connect(deployer).mint(user.address, 15));
      await proveTx(token.connect(deployer).premint(user.address, 5, timestamp, PremintRestriction.None));
      await proveTx(token.connect(deployer).freeze(user.address, 5));
      await proveTx(token.connect(deployer).updateRestriction(user.address, PURPOSE, 5));
      await expect(
        token.connect(user).transfer(nonPurposeAccount.address, 10)
      ).to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_RESTRICTED_AMOUNT);
    });

    it("Transfer to non-purpose account - test 15 with no release awaiting", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.connect(deployer).mint(user.address, 15));
      await proveTx(token.connect(deployer).premint(user.address, 5, timestamp, PremintRestriction.None));
      await proveTx(token.connect(deployer).freeze(user.address, 5));
      await proveTx(token.connect(deployer).updateRestriction(user.address, PURPOSE, 5));
      await expect(
        token.connect(user).transfer(nonPurposeAccount.address, 15)
      ).to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_FROZEN_AMOUNT);
    });

    it("Transfer to non-purpose account - test 20 with no release awaiting", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.connect(deployer).mint(user.address, 15));
      await proveTx(token.connect(deployer).premint(user.address, 5, timestamp, PremintRestriction.None));
      await proveTx(token.connect(deployer).freeze(user.address, 5));
      await proveTx(token.connect(deployer).updateRestriction(user.address, PURPOSE, 5));
      await expect(
        token.connect(user).transfer(nonPurposeAccount.address, 20)
      ).to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_PREMINT_AMOUNT);
    });

    it("Transfer to non-purpose account - test 25 with no release awaiting", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.connect(deployer).mint(user.address, 15));
      await proveTx(token.connect(deployer).premint(user.address, 5, timestamp, PremintRestriction.None));
      await proveTx(token.connect(deployer).freeze(user.address, 5));
      await proveTx(token.connect(deployer).updateRestriction(user.address, PURPOSE, 5));
      await expect(
        token.connect(user).transfer(nonPurposeAccount.address, 25)
      ).to.be.revertedWith(REVERT_MESSAGE_ERC20_TRANSFER_AMOUNT_EXCEEDS_BALANCE);
    });
  });

  describe("Frozen and restricted balances with no tokens", async () => {
    it("Transfer to purpose account - test 5", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.connect(deployer).freeze(user.address, 10));
      await proveTx(token.connect(deployer).updateRestriction(user.address, PURPOSE, 10));
      await expect(
        token.connect(user).transfer(purposeAccount.address, 5)
      ).to.be.revertedWith(REVERT_MESSAGE_ERC20_TRANSFER_AMOUNT_EXCEEDS_BALANCE);
    });

    it("Transfer to non-purpose account - test 5", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.connect(deployer).freeze(user.address, 10));
      await proveTx(token.connect(deployer).updateRestriction(user.address, PURPOSE, 10));
      await expect(
        token.connect(user).transfer(nonPurposeAccount.address, 5)
      ).to.be.revertedWith(REVERT_MESSAGE_ERC20_TRANSFER_AMOUNT_EXCEEDS_BALANCE);
    });
  });

  describe("Frozen balance only, no restricted balance or premint balance", async () => {
    it("Transfer to purpose account - test 5", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.connect(deployer).mint(user.address, 20));
      await proveTx(token.connect(deployer).freeze(user.address, 10));
      await expect(
        token.connect(user).transfer(purposeAccount.address, 5)
      ).to.changeTokenBalances(
        token,
        [user, purposeAccount],
        [-5, 5]
      );
      expect(await token.balanceOfRestricted(user.address, PURPOSE)).to.eq(0);
    });

    it("Transfer to purpose account - test 10", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.connect(deployer).mint(user.address, 20));
      await proveTx(token.connect(deployer).freeze(user.address, 10));
      await expect(
        token.connect(user).transfer(purposeAccount.address, 10)
      ).to.changeTokenBalances(
        token,
        [user, purposeAccount],
        [-10, 10]
      );
      expect(await token.balanceOfRestricted(user.address, PURPOSE)).to.eq(0);
    });

    it("Transfer to purpose account - test 15", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.connect(deployer).mint(user.address, 20));
      await proveTx(token.connect(deployer).freeze(user.address, 10));
      await expect(
        token.connect(user).transfer(purposeAccount.address, 15)
      ).to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_FROZEN_AMOUNT);
    });

    it("Transfer to purpose account - test 20", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.connect(deployer).mint(user.address, 20));
      await proveTx(token.connect(deployer).freeze(user.address, 10));
      await expect(
        token.connect(user).transfer(purposeAccount.address, 20)
      ).to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_FROZEN_AMOUNT);
    });

    it("Transfer to purpose account - test 25", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.connect(deployer).mint(user.address, 20));
      await proveTx(token.connect(deployer).freeze(user.address, 10));
      await expect(
        token.connect(user).transfer(purposeAccount.address, 25)
      ).to.be.revertedWith(REVERT_MESSAGE_ERC20_TRANSFER_AMOUNT_EXCEEDS_BALANCE);
    });

    it("Transfer to non-purpose account - test 5", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.connect(deployer).mint(user.address, 20));
      await proveTx(token.connect(deployer).freeze(user.address, 10));
      await expect(
        token.connect(user).transfer(nonPurposeAccount.address, 5)
      ).to.changeTokenBalances(
        token,
        [user, nonPurposeAccount],
        [-5, 5]
      );
      expect(await token.balanceOfRestricted(user.address, PURPOSE)).to.eq(0);
    });

    it("Transfer to non-purpose account - test 10", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.connect(deployer).mint(user.address, 20));
      await proveTx(token.connect(deployer).freeze(user.address, 10));
      await expect(
        token.connect(user).transfer(nonPurposeAccount.address, 10)
      ).to.changeTokenBalances(
        token,
        [user, nonPurposeAccount],
        [-10, 10]
      );
      expect(await token.balanceOfRestricted(user.address, PURPOSE)).to.eq(0);
    });

    it("Transfer to non-purpose account - test 15", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.connect(deployer).mint(user.address, 20));
      await proveTx(token.connect(deployer).freeze(user.address, 10));
      await expect(
        token.connect(user).transfer(nonPurposeAccount.address, 15)
      ).to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_FROZEN_AMOUNT);
    });

    it("Transfer to non-purpose account - test 20", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.connect(deployer).mint(user.address, 20));
      await proveTx(token.connect(deployer).freeze(user.address, 10));
      await expect(
        token.connect(user).transfer(nonPurposeAccount.address, 20)
      ).to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_FROZEN_AMOUNT);
    });

    it("Transfer to non-purpose account - test 25", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.connect(deployer).mint(user.address, 20));
      await proveTx(token.connect(deployer).freeze(user.address, 10));
      await expect(
        token.connect(user).transfer(nonPurposeAccount.address, 25)
      ).to.be.revertedWith(REVERT_MESSAGE_ERC20_TRANSFER_AMOUNT_EXCEEDS_BALANCE);
    });
  });

  describe("Restricted balance only, no frozen balance or premint balance", async () => {
    it("Transfer to purpose account - test 5", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.connect(deployer).mint(user.address, 20));
      await proveTx(token.connect(deployer).updateRestriction(user.address, PURPOSE, 10));
      await expect(
        token.connect(user).transfer(purposeAccount.address, 5)
      ).to.changeTokenBalances(
        token,
        [user, purposeAccount],
        [-5, 5]
      );
      expect(await token.balanceOfRestricted(user.address, PURPOSE)).to.eq(5);
    });

    it("Transfer to purpose account - test 10", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.connect(deployer).mint(user.address, 20));
      await proveTx(token.connect(deployer).updateRestriction(user.address, PURPOSE, 10));
      await expect(
        token.connect(user).transfer(purposeAccount.address, 10)
      ).to.changeTokenBalances(
        token,
        [user, purposeAccount],
        [-10, 10]
      );
      expect(await token.balanceOfRestricted(user.address, PURPOSE)).to.eq(0);
    });

    it("Transfer to purpose account - test 15", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.connect(deployer).mint(user.address, 20));
      await proveTx(token.connect(deployer).updateRestriction(user.address, PURPOSE, 10));
      await expect(
        token.connect(user).transfer(purposeAccount.address, 15)
      ).to.changeTokenBalances(
        token,
        [user, purposeAccount],
        [-15, 15]
      );
      expect(await token.balanceOfRestricted(user.address, PURPOSE)).to.eq(0);
    });

    it("Transfer to purpose account - test 20", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.connect(deployer).mint(user.address, 20));
      await proveTx(token.connect(deployer).updateRestriction(user.address, PURPOSE, 10));
      await expect(
        token.connect(user).transfer(purposeAccount.address, 20)
      ).to.changeTokenBalances(
        token,
        [user, purposeAccount],
        [-20, 20]
      );
      expect(await token.balanceOfRestricted(user.address, PURPOSE)).to.eq(0);
    });

    it("Transfer to purpose account - test 25", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.connect(deployer).mint(user.address, 20));
      await proveTx(token.connect(deployer).updateRestriction(user.address, PURPOSE, 10));
      await expect(
        token.connect(user).transfer(purposeAccount.address, 25)
      ).to.be.revertedWith(REVERT_MESSAGE_ERC20_TRANSFER_AMOUNT_EXCEEDS_BALANCE);
    });

    it("Transfer to non-purpose account - test 5", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.connect(deployer).mint(user.address, 20));
      await proveTx(token.connect(deployer).updateRestriction(user.address, PURPOSE, 10));
      await expect(
        token.connect(user).transfer(nonPurposeAccount.address, 5)
      ).to.changeTokenBalances(
        token,
        [user, nonPurposeAccount],
        [-5, 5]
      );
      expect(await token.balanceOfRestricted(user.address, PURPOSE)).to.eq(10);
    });

    it("Transfer to non-purpose account - test 10", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.connect(deployer).mint(user.address, 20));
      await proveTx(token.connect(deployer).updateRestriction(user.address, PURPOSE, 10));
      await expect(
        token.connect(user).transfer(nonPurposeAccount.address, 10)
      ).to.changeTokenBalances(
        token,
        [user, nonPurposeAccount],
        [-10, 10]
      );
      expect(await token.balanceOfRestricted(user.address, PURPOSE)).to.eq(10);
    });

    it("Transfer to non-purpose account - test 15", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.connect(deployer).mint(user.address, 20));
      await proveTx(token.connect(deployer).updateRestriction(user.address, PURPOSE, 10));
      await expect(
        token.connect(user).transfer(nonPurposeAccount.address, 15)
      ).to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_RESTRICTED_AMOUNT);
    });

    it("Transfer to non-purpose account - test 20", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.connect(deployer).mint(user.address, 20));
      await proveTx(token.connect(deployer).updateRestriction(user.address, PURPOSE, 10));
      await expect(
        token.connect(user).transfer(nonPurposeAccount.address, 20)
      ).to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_RESTRICTED_AMOUNT);
    });

    it("Transfer to non-purpose account - test 25", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.connect(deployer).mint(user.address, 20));
      await proveTx(token.connect(deployer).updateRestriction(user.address, PURPOSE, 10));
      await expect(
        token.connect(user).transfer(nonPurposeAccount.address, 25)
      ).to.be.revertedWith(REVERT_MESSAGE_ERC20_TRANSFER_AMOUNT_EXCEEDS_BALANCE);
    });
  });

  describe("Premint balance only, no frozen balance or restricted balance", async () => {
    let timestamp: number;
    before(async () => {
      timestamp = await time.latest() + 100;
    });
    it("Transfer to purpose account with release awaiting - test 5", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.connect(deployer).premint(user.address, 20, timestamp, PremintRestriction.None));
      await time.increaseTo(timestamp);
      await expect(
        token.connect(user).transfer(purposeAccount.address, 5)
      ).to.changeTokenBalances(
        token,
        [user, purposeAccount],
        [-5, 5]
      );
    });

    it("Transfer to purpose account with release awaiting - test 10", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.connect(deployer).premint(user.address, 20, timestamp, PremintRestriction.None));
      await time.increaseTo(timestamp);
      await expect(
        token.connect(user).transfer(purposeAccount.address, 10)
      ).to.changeTokenBalances(
        token,
        [user, purposeAccount],
        [-10, 10]
      );
    });

    it("Transfer to purpose account with release awaiting - test 15", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.connect(deployer).premint(user.address, 20, timestamp, PremintRestriction.None));
      await time.increaseTo(timestamp);
      await expect(
        token.connect(user).transfer(purposeAccount.address, 15)
      ).to.changeTokenBalances(
        token,
        [user, purposeAccount],
        [-15, 15]
      );
    });

    it("Transfer to purpose account with release awaiting - test 20", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.connect(deployer).premint(user.address, 20, timestamp, PremintRestriction.None));
      await time.increaseTo(timestamp);
      await expect(
        token.connect(user).transfer(purposeAccount.address, 20)
      ).to.changeTokenBalances(
        token,
        [user, purposeAccount],
        [-20, 20]
      );
    });

    it("Transfer to purpose account with release awaiting - test 25", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.connect(deployer).premint(user.address, 20, timestamp, PremintRestriction.None));
      await time.increaseTo(timestamp);
      await expect(
        token.connect(user).transfer(purposeAccount.address, 25)
      ).to.be.revertedWith(REVERT_MESSAGE_ERC20_TRANSFER_AMOUNT_EXCEEDS_BALANCE);
    });

    it("Transfer to non-purpose account with release awaiting - test 5", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.connect(deployer).premint(user.address, 20, timestamp, PremintRestriction.None));
      await time.increaseTo(timestamp);
      await expect(
        token.connect(user).transfer(nonPurposeAccount.address, 5)
      ).to.changeTokenBalances(
        token,
        [user, nonPurposeAccount],
        [-5, 5]
      );
    });

    it("Transfer to non-purpose account with release awaiting - test 10", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.connect(deployer).premint(user.address, 20, timestamp, PremintRestriction.None));
      await time.increaseTo(timestamp);
      await expect(
        token.connect(user).transfer(nonPurposeAccount.address, 10)
      ).to.changeTokenBalances(
        token,
        [user, nonPurposeAccount],
        [-10, 10]
      );
    });

    it("Transfer to non-purpose account with release awaiting - test 15", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.connect(deployer).premint(user.address, 20, timestamp, PremintRestriction.None));
      await time.increaseTo(timestamp);
      await expect(
        token.connect(user).transfer(nonPurposeAccount.address, 15)
      ).to.changeTokenBalances(
        token,
        [user, nonPurposeAccount],
        [-15, 15]
      );
    });

    it("Transfer to non-purpose account with release awaiting - test 20", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.connect(deployer).premint(user.address, 20, timestamp, PremintRestriction.None));
      await time.increaseTo(timestamp);
      await expect(
        token.connect(user).transfer(nonPurposeAccount.address, 20)
      ).to.changeTokenBalances(
        token,
        [user, nonPurposeAccount],
        [-20, 20]
      );
    });

    it("Transfer to non-purpose account with release awaiting - test 25", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.connect(deployer).premint(user.address, 20, timestamp, PremintRestriction.None));
      await time.increaseTo(timestamp);
      await expect(
        token.connect(user).transfer(nonPurposeAccount.address, 25)
      ).to.be.revertedWith(REVERT_MESSAGE_ERC20_TRANSFER_AMOUNT_EXCEEDS_BALANCE);
    });

    it("Transfer to purpose account with no release awaiting - test 5", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.connect(deployer).premint(user.address, 20, timestamp, PremintRestriction.None));
      await expect(
        token.connect(user).transfer(purposeAccount.address, 5)
      ).to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_PREMINT_AMOUNT);
    });

    it("Transfer to purpose account with no release awaiting - test 10", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.connect(deployer).premint(user.address, 20, timestamp, PremintRestriction.None));
      await expect(
        token.connect(user).transfer(purposeAccount.address, 10)
      ).to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_PREMINT_AMOUNT);
    });

    it("Transfer to purpose account with no release awaiting - test 15", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.connect(deployer).premint(user.address, 20, timestamp, PremintRestriction.None));
      await expect(
        token.connect(user).transfer(purposeAccount.address, 15)
      ).to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_PREMINT_AMOUNT);
    });

    it("Transfer to purpose account with no release awaiting - test 20", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.connect(deployer).premint(user.address, 20, timestamp, PremintRestriction.None));
      await expect(
        token.connect(user).transfer(purposeAccount.address, 20)
      ).to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_PREMINT_AMOUNT);
    });

    it("Transfer to purpose account with no release awaiting - test 25", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.connect(deployer).premint(user.address, 20, timestamp, PremintRestriction.None));
      await expect(
        token.connect(user).transfer(purposeAccount.address, 25)
      ).to.be.revertedWith(REVERT_MESSAGE_ERC20_TRANSFER_AMOUNT_EXCEEDS_BALANCE);
    });

    it("Transfer to non-purpose account with no release awaiting - test 5", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.connect(deployer).premint(user.address, 20, timestamp, PremintRestriction.None));
      await expect(
        token.connect(user).transfer(nonPurposeAccount.address, 5)
      ).to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_PREMINT_AMOUNT);
    });

    it("Transfer to non-purpose account with no release awaiting - test 10", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.connect(deployer).premint(user.address, 20, timestamp, PremintRestriction.None));
      await expect(
        token.connect(user).transfer(nonPurposeAccount.address, 10)
      ).to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_PREMINT_AMOUNT);
    });

    it("Transfer to non-purpose account with no release awaiting - test 15", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.connect(deployer).premint(user.address, 20, timestamp, PremintRestriction.None));
      await expect(
        token.connect(user).transfer(nonPurposeAccount.address, 15)
      ).to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_PREMINT_AMOUNT);
    });

    it("Transfer to non-purpose account with no release awaiting - test 20", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.connect(deployer).premint(user.address, 20, timestamp, PremintRestriction.None));
      await expect(
        token.connect(user).transfer(nonPurposeAccount.address, 20)
      ).to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_PREMINT_AMOUNT);
    });

    it("Transfer to non-purpose account with no release awaiting - test 25", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.connect(deployer).premint(user.address, 20, timestamp, PremintRestriction.None));
      await expect(
        token.connect(user).transfer(nonPurposeAccount.address, 25)
      ).to.be.revertedWith(REVERT_MESSAGE_ERC20_TRANSFER_AMOUNT_EXCEEDS_BALANCE);
    });
  });

  describe("No frozen or restricted or premint balances", async () => {
    it("Transfer to purpose account - test 5", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.connect(deployer).mint(user.address, 20));
      await expect(
        token.connect(user).transfer(purposeAccount.address, 5)
      ).to.changeTokenBalances(
        token,
        [user, purposeAccount],
        [-5, 5]
      );
    });

    it("Transfer to purpose account - test 10", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.connect(deployer).mint(user.address, 20));
      await expect(
        token.connect(user).transfer(purposeAccount.address, 10)
      ).to.changeTokenBalances(
        token,
        [user, purposeAccount],
        [-10, 10]
      );
    });

    it("Transfer to purpose account - test 15", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.connect(deployer).mint(user.address, 20));
      await expect(
        token.connect(user).transfer(purposeAccount.address, 15)
      ).to.changeTokenBalances(
        token,
        [user, purposeAccount],
        [-15, 15]
      );
    });

    it("Transfer to purpose account - test 20", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.connect(deployer).mint(user.address, 20));
      await expect(
        token.connect(user).transfer(purposeAccount.address, 20)
      ).to.changeTokenBalances(
        token,
        [user, purposeAccount],
        [-20, 20]
      );
    });

    it("Transfer to purpose account - test 25", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.connect(deployer).mint(user.address, 20));
      await expect(
        token.connect(user).transfer(purposeAccount.address, 25)
      ).to.be.revertedWith(REVERT_MESSAGE_ERC20_TRANSFER_AMOUNT_EXCEEDS_BALANCE);
    });

    it("Transfer to non-purpose account - test 5", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.connect(deployer).mint(user.address, 20));
      await expect(
        token.connect(user).transfer(nonPurposeAccount.address, 5)
      ).to.changeTokenBalances(
        token,
        [user, nonPurposeAccount],
        [-5, 5]
      );
    });

    it("Transfer to non-purpose account - test 10", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.connect(deployer).mint(user.address, 20));
      await expect(
        token.connect(user).transfer(nonPurposeAccount.address, 10)
      ).to.changeTokenBalances(
        token,
        [user, nonPurposeAccount],
        [-10, 10]
      );
    });

    it("Transfer to non-purpose account - test 15", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.connect(deployer).mint(user.address, 20));
      await expect(
        token.connect(user).transfer(nonPurposeAccount.address, 15)
      ).to.changeTokenBalances(
        token,
        [user, nonPurposeAccount],
        [-15, 15]
      );
    });

    it("Transfer to non-purpose account - test 20", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.connect(deployer).mint(user.address, 20));
      await expect(
        token.connect(user).transfer(nonPurposeAccount.address, 20)
      ).to.changeTokenBalances(
        token,
        [user, nonPurposeAccount],
        [-20, 20]
      );
    });

    it("Transfer to non-purpose account - test 25", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.connect(deployer).mint(user.address, 20));
      await expect(
        token.connect(user).transfer(nonPurposeAccount.address, 25)
      ).to.be.revertedWith(REVERT_MESSAGE_ERC20_TRANSFER_AMOUNT_EXCEEDS_BALANCE);
    });
  });
});
