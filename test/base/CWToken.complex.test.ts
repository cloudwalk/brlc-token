import { ethers, network, upgrades } from "hardhat";
import { expect } from "chai";
import { Contract, ContractFactory } from "ethers";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { connect, getLatestBlockTimestamp, increaseBlockTimestampTo, proveTx } from "../../test-utils/eth";

interface ComplexBalanceOptions {
  totalBalance?: number;
  premintedBalance?: number;
  frozenBalance?: number;
  restrictedToIdBalance?: number;
  restrictedToAnyIdBalance?: number;
}

interface ComplexBalance {
  total: number;
  free: number;
  premint: number;
  frozen: number;
  restricted: number;

  [key: string]: number;
}

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

  const REVERT_ERROR_LACK_OF_FROZEN_BALANCE = "LackOfFrozenBalance";
  const REVERT_ERROR_TRANSFER_EXCEEDED_FROZEN_AMOUNT = "TransferExceededFrozenAmount";
  const REVERT_ERROR_TRANSFER_EXCEEDED_RESTRICTED_AMOUNT = "TransferExceededRestrictedAmount";
  const REVERT_ERROR_TRANSFER_EXCEEDED_PREMINT_AMOUNT = "TransferExceededPremintedAmount";
  const REVERT_MESSAGE_ERC20_TRANSFER_AMOUNT_EXCEEDS_BALANCE = "ERC20: transfer amount exceeds balance";
  const REVERT_MESSAGE_INSUFFICIENT_ALLOWANCE = "ERC20: insufficient allowance";

  const ID = "0x0000000000000000000000000000000000000000000000000000000000000001";
  const ANY_ID = "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";
  const RESTRICTION_INCREASE_V2 =
    "restrictionIncrease(address,address,uint256,bytes32)";

  let tokenFactory: ContractFactory;
  let deployer: HardhatEthersSigner;
  let user: HardhatEthersSigner;
  let restrictionAccount: HardhatEthersSigner;
  let nonRestrictionAccount: HardhatEthersSigner;

  before(async () => {
    [deployer, user, restrictionAccount, nonRestrictionAccount] = await ethers.getSigners();
    tokenFactory = await ethers.getContractFactory("CWToken");
    tokenFactory = tokenFactory.connect(deployer); // Explicitly specifying the deployer account
  });

  async function deployToken(): Promise<{ token: Contract }> {
    let token: Contract = await upgrades.deployProxy(tokenFactory, [TOKEN_NAME, TOKEN_SYMBOL]);
    await token.waitForDeployment();
    token = connect(token, deployer); // Explicitly specifying the initial account
    return { token };
  }

  async function deployAndConfigureToken(): Promise<{ token: Contract }> {
    const { token } = await deployToken();
    await proveTx(token.setMainBlocklister(deployer.address));
    await proveTx(token.configureBlocklister(deployer.address, true));
    await proveTx(token.updateMainMinter(deployer.address));
    await proveTx(token.configureMinter(deployer.address, 1000));
    await proveTx(token.configureMaxPendingPremintsCount(MAX_PENDING_PREMINTS_COUNT));
    await proveTx(connect(token, user).approveFreezing());
    await proveTx(token.configureTrustedAccount(deployer.address, true));
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
    const timestamp = (await getLatestBlockTimestamp()) + 100;
    const { token, amounts } = props;
    if (amounts.mint > 0) {
      await proveTx(token.mint(user.address, amounts.mint));
    }
    if (amounts.premint > 0) {
      await proveTx(token.premintIncrease(user.address, amounts.premint, timestamp));
    }
    if (amounts.frozen > 0) {
      await proveTx(token.freeze(user.address, amounts.frozen));
    }
    if (amounts.restricted > 0) {
      await proveTx(
        token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, amounts.restricted, ID)
      );
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

  function constructComplexBalanceState({
                                          totalBalance = 0,
                                          premintedBalance = 0,
                                          frozenBalance = 0,
                                          restrictedToIdBalance = 0,
                                          restrictedToAnyIdBalance = 0
  }: ComplexBalanceOptions = {}): ComplexBalance {
    const totalComplex: number = premintedBalance + frozenBalance + restrictedToIdBalance + restrictedToAnyIdBalance;
    return {
      total: totalBalance,
      free: totalComplex > totalBalance ? 0 : totalBalance - totalComplex,
      premint: premintedBalance,
      frozen: frozenBalance,
      restricted: restrictedToIdBalance + restrictedToAnyIdBalance
    };
  }


  function assertComplexBalancesEquality(expectedBalance: ComplexBalance, actualBalance: ComplexBalance) {
    Object.keys(expectedBalance).forEach(property => {
      expect(actualBalance[property]).to.eq(
        expectedBalance[property],
        `Mismatch in the "${property}" property of the complex balance`
      );
    });
  }

  describe("Function 'transferFrom()'", async () => {
    it("Executes as expected for non-trusted and trusted accounts", async () => {
      const maxAmount = ethers.MaxUint256;
      const userBalance = 123;

      const { token } = await setUpFixture(deployToken);
      await proveTx(token.updateMainMinter(deployer.address));
      await proveTx(token.configureMinter(deployer.address, maxAmount));
      await proveTx(token.mint(user.address, userBalance));

      await expect(
        token.transferFrom(user.address, deployer.address, userBalance)
      ).to.be.revertedWith(REVERT_MESSAGE_INSUFFICIENT_ALLOWANCE);

      await proveTx(token.configureTrustedAccount(deployer.address, true));

      await expect(
        token.transferFrom(user.address, deployer.address, userBalance)
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

  describe("Free balance only", async () => {
    describe("Function 'transfer()'", async () => {
      it("Transfer - test 20 - success", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100
        });
        await proveTx(token.mint(user.address, 100));
        await expect(connect(token, user).transfer(restrictionAccount.address, 20))
          .to.changeTokenBalances(
            token,
            [user, restrictionAccount],
            [-20, 20]
          );

        expectedBalance.total -= 20;
        expectedBalance.free -= 20;

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer - test 40 - success", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100
        });
        await proveTx(token.mint(user.address, 100));
        await expect(connect(token, user).transfer(restrictionAccount.address, 40))
          .to.changeTokenBalances(
            token,
            [user, restrictionAccount],
            [-40, 40]
          );

        expectedBalance.total -= 40;
        expectedBalance.free -= 40;

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer - test 60 - success", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100
        });
        await proveTx(token.mint(user.address, 100));
        await expect(connect(token, user).transfer(restrictionAccount.address, 60))
          .to.changeTokenBalances(
            token,
            [user, restrictionAccount],
            [-60, 60]
          );

        expectedBalance.total -= 60;
        expectedBalance.free -= 60;

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer - test 80 - success", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100
        });
        await proveTx(token.mint(user.address, 100));
        await expect(connect(token, user).transfer(restrictionAccount.address, 80))
          .to.changeTokenBalances(
            token,
            [user, restrictionAccount],
            [-80, 80]
        );

        expectedBalance.total -= 80;
        expectedBalance.free -= 80;

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer - test 100 - success", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100
        });
        await proveTx(token.mint(user.address, 100));
        await expect(connect(token, user).transfer(restrictionAccount.address, 100))
          .to.changeTokenBalances(
            token,
            [user, restrictionAccount],
            [-100, 100]
        );

        expectedBalance.total -= 100;
        expectedBalance.free -= 100;

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer - test 120 - fail - ERC20 balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100
        });
        await proveTx(token.mint(user.address, 100));
        await expect(connect(token, user).transfer(restrictionAccount.address, 120))
          .to.be.revertedWith(REVERT_MESSAGE_ERC20_TRANSFER_AMOUNT_EXCEEDS_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });
    });

    describe("Function 'transferFrozen()'", async () => {
      it("Transfer - test 20 - fail - Lack of frozen balance", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100
        });

        await proveTx(token.mint(user.address, 100));
        await expect(token.transferFrozen(user.address, restrictionAccount.address, 20))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_LACK_OF_FROZEN_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer - test 40 - fail - Lack of frozen balance", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100
        });

        await proveTx(token.mint(user.address, 100));
        await expect(token.transferFrozen(user.address, restrictionAccount.address, 40))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_LACK_OF_FROZEN_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer - test 60 - fail - Lack of frozen balance", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100
        });

        await proveTx(token.mint(user.address, 100));
        await expect(token.transferFrozen(user.address, restrictionAccount.address, 60))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_LACK_OF_FROZEN_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer - test 80 - fail - Lack of frozen balance", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100
        });

        await proveTx(token.mint(user.address, 100));
        await expect(token.transferFrozen(user.address, restrictionAccount.address, 80))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_LACK_OF_FROZEN_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer - test 100 - fail - Lack of frozen balance", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100
        });

        await proveTx(token.mint(user.address, 100));
        await expect(token.transferFrozen(user.address, restrictionAccount.address, 100))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_LACK_OF_FROZEN_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer - test 120 - fail - Lack of frozen balance", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100
        });

        await proveTx(token.mint(user.address, 100));
        await expect(token.transferFrozen(user.address, restrictionAccount.address, 120))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_LACK_OF_FROZEN_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });
    });

    describe("Function 'transferWithId'", async () => {
      it("Transfer - test 20 - success", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100
        });

        await proveTx(token.mint(user.address, 100));
        await expect(token.transferWithId(user.address, restrictionAccount.address, 20, ID))
          .to.changeTokenBalances(
            token,
            [user, restrictionAccount],
            [-20, 20]
          );

        expectedBalance.total -= 20;
        expectedBalance.free -= 20;

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer - test 40 - success", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100
        });

        await proveTx(token.mint(user.address, 100));
        await expect(token.transferWithId(user.address, restrictionAccount.address, 40, ID))
          .to.changeTokenBalances(
            token,
            [user, restrictionAccount],
            [-40, 40]
          );

        expectedBalance.total -= 40;
        expectedBalance.free -= 40;

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer - test 60 - success", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100
        });

        await proveTx(token.mint(user.address, 100));
        await expect(token.transferWithId(user.address, restrictionAccount.address, 60, ID))
          .to.changeTokenBalances(
            token,
            [user, restrictionAccount],
            [-60, 60]
        );

        expectedBalance.total -= 60;
        expectedBalance.free -= 60;

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer - test 80 - success", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100
        });

        await proveTx(token.mint(user.address, 100));
        await expect(token.transferWithId(user.address, restrictionAccount.address, 80, ID))
          .to.changeTokenBalances(
            token,
            [user, restrictionAccount],
            [-80, 80]
        );

        expectedBalance.total -= 80;
        expectedBalance.free -= 80;

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer - test 100 - success", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100
        });

        await proveTx(token.mint(user.address, 100));
        await expect(token.transferWithId(user.address, restrictionAccount.address, 100, ID))
          .to.changeTokenBalances(
            token,
            [user, restrictionAccount],
            [-100, 100]
          );

        expectedBalance.total -= 100;
        expectedBalance.free -= 100;

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer - test 120 - fail - ERC20 balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100
        });

        await proveTx(token.mint(user.address, 100));
        await expect(token.transferWithId(user.address, restrictionAccount.address, 120, ID))
          .to.be.revertedWith(REVERT_MESSAGE_ERC20_TRANSFER_AMOUNT_EXCEEDS_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });
    });
  });

  describe("Free and preminted balances", async () => {
    let timestamp: number;
    before(async () => {
      timestamp = (await getLatestBlockTimestamp()) + 100;
    });
    describe("Function 'transfer()'", async () => {
      it("Transfer without release awaiting - test 20 - success", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          premintedBalance: 50
        });

        await proveTx(token.mint(user.address, 50));
        await proveTx(token.premintIncrease(user.address, 50, timestamp));
        await expect(connect(token, user).transfer(restrictionAccount.address, 20))
          .to.changeTokenBalances(
            token,
            [user, restrictionAccount],
            [-20, 20]
          );

        expectedBalance.total -= 20;
        expectedBalance.free -= 20;

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer with release awaiting - test 20 - success", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          premintedBalance: 50
        });

        await proveTx(token.mint(user.address, 50));
        await proveTx(token.premintIncrease(user.address, 50, timestamp));
        await increaseBlockTimestampTo(timestamp);
        expectedBalance.premint -= 50;
        expectedBalance.free += 50;
        await expect(connect(token, user).transfer(restrictionAccount.address, 20))
          .to.changeTokenBalances(
            token,
            [user, restrictionAccount],
            [-20, 20]
          );

        expectedBalance.total -= 20;
        expectedBalance.free -= 20;

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer without release awaiting - test 40 - success", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          premintedBalance: 50
        });

        await proveTx(token.mint(user.address, 50));
        await proveTx(token.premintIncrease(user.address, 50, timestamp));
        await expect(connect(token, user).transfer(restrictionAccount.address, 40))
          .to.changeTokenBalances(
            token,
            [user, restrictionAccount],
            [-40, 40]
          );

        expectedBalance.total -= 40;
        expectedBalance.free -= 40;

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer with release awaiting - test 40 - success", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          premintedBalance: 50
        });

        await proveTx(token.mint(user.address, 50));
        await proveTx(token.premintIncrease(user.address, 50, timestamp));
        await increaseBlockTimestampTo(timestamp);
        expectedBalance.premint -= 50;
        expectedBalance.free += 50;
        await expect(connect(token, user).transfer(restrictionAccount.address, 40))
          .to.changeTokenBalances(
            token,
            [user, restrictionAccount],
            [-40, 40]
          );

        expectedBalance.total -= 40;
        expectedBalance.free -= 40;

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer without release awaiting - test 60 - fail - Preminted balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          premintedBalance: 50
        });

        await proveTx(token.mint(user.address, 50));
        await proveTx(token.premintIncrease(user.address, 50, timestamp));
        await expect(connect(token, user).transfer(restrictionAccount.address, 60))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_PREMINT_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer with release awaiting - test 60 - success", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          premintedBalance: 50
        });

        await proveTx(token.mint(user.address, 50));
        await proveTx(token.premintIncrease(user.address, 50, timestamp));
        await increaseBlockTimestampTo(timestamp);
        expectedBalance.premint -= 50;
        expectedBalance.free += 50;
        await expect(connect(token, user).transfer(restrictionAccount.address, 60))
          .to.changeTokenBalances(
            token,
            [user, restrictionAccount],
            [-60, 60]
          );

        expectedBalance.total -= 60;
        expectedBalance.free -= 60;

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer without release awaiting - test 80 - fail - Preminted balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          premintedBalance: 50
        });

        await proveTx(token.mint(user.address, 50));
        await proveTx(token.premintIncrease(user.address, 50, timestamp));
        await expect(connect(token, user).transfer(restrictionAccount.address, 80))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_PREMINT_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer with release awaiting - test 80 - success", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          premintedBalance: 50
        });

        await proveTx(token.mint(user.address, 50));
        await proveTx(token.premintIncrease(user.address, 50, timestamp));
        await increaseBlockTimestampTo(timestamp);
        expectedBalance.premint -= 50;
        expectedBalance.free += 50;
        await expect(connect(token, user).transfer(restrictionAccount.address, 80))
          .to.changeTokenBalances(
            token,
            [user, restrictionAccount],
            [-80, 80]
          );

        expectedBalance.total -= 80;
        expectedBalance.free -= 80;

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer without release awaiting - test 100 - fail - Preminted balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          premintedBalance: 50
        });

        await proveTx(token.mint(user.address, 50));
        await proveTx(token.premintIncrease(user.address, 50, timestamp));
        await expect(connect(token, user).transfer(restrictionAccount.address, 100))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_PREMINT_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer with release awaiting - test 100 - success", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          premintedBalance: 50
        });

        await proveTx(token.mint(user.address, 50));
        await proveTx(token.premintIncrease(user.address, 50, timestamp));
        await increaseBlockTimestampTo(timestamp);
        expectedBalance.premint -= 50;
        expectedBalance.free += 50;
        await expect(connect(token, user).transfer(restrictionAccount.address, 100))
          .to.changeTokenBalances(
            token,
            [user, restrictionAccount],
            [-100, 100]
          );

        expectedBalance.total -= 100;
        expectedBalance.free -= 100;

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer without release awaiting - test 120 - fail - ERC20 balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          premintedBalance: 50
        });

        await proveTx(token.mint(user.address, 50));
        await proveTx(token.premintIncrease(user.address, 50, timestamp));
        await expect(connect(token, user).transfer(restrictionAccount.address, 120))
          .to.be.revertedWith(REVERT_MESSAGE_ERC20_TRANSFER_AMOUNT_EXCEEDS_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer with release awaiting - test 120 - fail - ERC20 balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          premintedBalance: 50
        });

        await proveTx(token.mint(user.address, 50));
        await proveTx(token.premintIncrease(user.address, 50, timestamp));
        await increaseBlockTimestampTo(timestamp);
        expectedBalance.premint -= 50;
        expectedBalance.free += 50;
        await expect(connect(token, user).transfer(restrictionAccount.address, 120))
          .to.be.revertedWith(REVERT_MESSAGE_ERC20_TRANSFER_AMOUNT_EXCEEDS_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });
    });

    describe("Function 'transferFrozen()'", async () => {
      it("Transfer without release awaiting - test 20 - fail - Lack of frozen balance", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          premintedBalance: 50
        });

        await proveTx(token.mint(user.address, 50));
        await proveTx(token.premintIncrease(user.address, 50, timestamp));
        await expect(token.transferFrozen(user.address, restrictionAccount.address, 20))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_LACK_OF_FROZEN_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer with release awaiting - test 20 - fail - Lack of frozen balance", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          premintedBalance: 50
        });

        await proveTx(token.mint(user.address, 50));
        await proveTx(token.premintIncrease(user.address, 50, timestamp));
        await increaseBlockTimestampTo(timestamp);
        expectedBalance.premint -= 50;
        expectedBalance.free += 50;
        await expect(token.transferFrozen(user.address, restrictionAccount.address, 20))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_LACK_OF_FROZEN_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer without release awaiting - test 40 - fail - Lack of frozen balance", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          premintedBalance: 50
        });

        await proveTx(token.mint(user.address, 50));
        await proveTx(token.premintIncrease(user.address, 50, timestamp));
        await expect(token.transferFrozen(user.address, restrictionAccount.address, 40))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_LACK_OF_FROZEN_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer with release awaiting - test 40 - fail - Lack of frozen balance", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          premintedBalance: 50
        });

        await proveTx(token.mint(user.address, 50));
        await proveTx(token.premintIncrease(user.address, 50, timestamp));
        await increaseBlockTimestampTo(timestamp);
        expectedBalance.premint -= 50;
        expectedBalance.free += 50;
        await expect(token.transferFrozen(user.address, restrictionAccount.address, 40))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_LACK_OF_FROZEN_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer without release awaiting - test 60 - fail - Lack of frozen balance", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          premintedBalance: 50
        });

        await proveTx(token.mint(user.address, 50));
        await proveTx(token.premintIncrease(user.address, 50, timestamp));
        await expect(token.transferFrozen(user.address, restrictionAccount.address, 60))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_LACK_OF_FROZEN_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer with release awaiting - test 60 - fail - Lack of frozen balance", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          premintedBalance: 50
        });

        await proveTx(token.mint(user.address, 50));
        await proveTx(token.premintIncrease(user.address, 50, timestamp));
        await increaseBlockTimestampTo(timestamp);
        expectedBalance.premint -= 50;
        expectedBalance.free += 50;
        await expect(token.transferFrozen(user.address, restrictionAccount.address, 60))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_LACK_OF_FROZEN_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer without release awaiting - test 80 - fail - Lack of frozen balance", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          premintedBalance: 50
        });

        await proveTx(token.mint(user.address, 50));
        await proveTx(token.premintIncrease(user.address, 50, timestamp));
        await expect(token.transferFrozen(user.address, restrictionAccount.address, 80))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_LACK_OF_FROZEN_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer with release awaiting - test 80 - fail - Lack of frozen balance", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          premintedBalance: 50
        });

        await proveTx(token.mint(user.address, 50));
        await proveTx(token.premintIncrease(user.address, 50, timestamp));
        await increaseBlockTimestampTo(timestamp);
        expectedBalance.premint -= 50;
        expectedBalance.free += 50;
        await expect(token.transferFrozen(user.address, restrictionAccount.address, 80))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_LACK_OF_FROZEN_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer without release awaiting - test 100 - fail - Lack of frozen balance", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          premintedBalance: 50
        });

        await proveTx(token.mint(user.address, 50));
        await proveTx(token.premintIncrease(user.address, 50, timestamp));
        await expect(token.transferFrozen(user.address, restrictionAccount.address, 100))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_LACK_OF_FROZEN_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer with release awaiting - test 100 - fail - Lack of frozen balance", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          premintedBalance: 50
        });

        await proveTx(token.mint(user.address, 50));
        await proveTx(token.premintIncrease(user.address, 50, timestamp));
        await increaseBlockTimestampTo(timestamp);
        expectedBalance.premint -= 50;
        expectedBalance.free += 50;
        await expect(token.transferFrozen(user.address, restrictionAccount.address, 100))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_LACK_OF_FROZEN_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer without release awaiting - test 120 - fail - Lack of frozen balance", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          premintedBalance: 50
        });

        await proveTx(token.mint(user.address, 50));
        await proveTx(token.premintIncrease(user.address, 50, timestamp));
        await expect(token.transferFrozen(user.address, restrictionAccount.address, 120))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_LACK_OF_FROZEN_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer with release awaiting - test 120 - fail - Lack of frozen balance", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          premintedBalance: 50
        });

        await proveTx(token.mint(user.address, 50));
        await proveTx(token.premintIncrease(user.address, 50, timestamp));
        await increaseBlockTimestampTo(timestamp);
        expectedBalance.premint -= 50;
        expectedBalance.free += 50;
        await expect(token.transferFrozen(user.address, restrictionAccount.address, 120))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_LACK_OF_FROZEN_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });
    });

    describe("Function 'transferWithId()'", async () => {
      it("Transfer without release awaiting - test 20 - success", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          premintedBalance: 50
        });

        await proveTx(token.mint(user.address, 50));
        await proveTx(token.premintIncrease(user.address, 50, timestamp));
        await expect(token.transferWithId(user.address, restrictionAccount.address, 20, ID))
          .to.changeTokenBalances(
            token,
            [user, restrictionAccount],
            [-20, 20]
          );

        expectedBalance.total -= 20;
        expectedBalance.free -= 20;

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer with release awaiting - test 20 - success", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          premintedBalance: 50
        });

        await proveTx(token.mint(user.address, 50));
        await proveTx(token.premintIncrease(user.address, 50, timestamp));
        await increaseBlockTimestampTo(timestamp);
        expectedBalance.premint -= 50;
        expectedBalance.free += 50;
        await expect(token.transferWithId(user.address, restrictionAccount.address, 20, ID))
          .to.changeTokenBalances(
            token,
            [user, restrictionAccount],
            [-20, 20]
          );

        expectedBalance.total -= 20;
        expectedBalance.free -= 20;

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer without release awaiting - test 40 - success", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          premintedBalance: 50
        });

        await proveTx(token.mint(user.address, 50));
        await proveTx(token.premintIncrease(user.address, 50, timestamp));
        await expect(token.transferWithId(user.address, restrictionAccount.address, 40, ID))
          .to.changeTokenBalances(
            token,
            [user, restrictionAccount],
            [-40, 40]
          );

        expectedBalance.total -= 40;
        expectedBalance.free -= 40;

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer with release awaiting - test 40 - success", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          premintedBalance: 50
        });

        await proveTx(token.mint(user.address, 50));
        await proveTx(token.premintIncrease(user.address, 50, timestamp));
        await increaseBlockTimestampTo(timestamp);
        expectedBalance.premint -= 50;
        expectedBalance.free += 50;
        await expect(token.transferWithId(user.address, restrictionAccount.address, 40, ID))
          .to.changeTokenBalances(
            token,
            [user, restrictionAccount],
            [-40, 40]
          );

        expectedBalance.total -= 40;
        expectedBalance.free -= 40;

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer without release awaiting - test 60 - fail - Preminted balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          premintedBalance: 50
        });

        await proveTx(token.mint(user.address, 50));
        await proveTx(token.premintIncrease(user.address, 50, timestamp));
        await expect(token.transferWithId(user.address, restrictionAccount.address, 60, ID))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_PREMINT_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer with release awaiting - test 60 - success", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          premintedBalance: 50
        });

        await proveTx(token.mint(user.address, 50));
        await proveTx(token.premintIncrease(user.address, 50, timestamp));
        await increaseBlockTimestampTo(timestamp);
        expectedBalance.premint -= 50;
        expectedBalance.free += 50;
        await expect(token.transferWithId(user.address, restrictionAccount.address, 60, ID))
          .to.changeTokenBalances(
            token,
            [user, restrictionAccount],
            [-60, 60]
          );

        expectedBalance.total -= 60;
        expectedBalance.free -= 60;

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer without release awaiting - test 80 - fail - Preminted balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          premintedBalance: 50
        });

        await proveTx(token.mint(user.address, 50));
        await proveTx(token.premintIncrease(user.address, 50, timestamp));
        await expect(token.transferWithId(user.address, restrictionAccount.address, 80, ID))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_PREMINT_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer with release awaiting - test 80 - fail - Preminted balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          premintedBalance: 50
        });

        await proveTx(token.mint(user.address, 50));
        await proveTx(token.premintIncrease(user.address, 50, timestamp));
        await increaseBlockTimestampTo(timestamp);
        expectedBalance.premint -= 50;
        expectedBalance.free += 50;
        await expect(token.transferWithId(user.address, restrictionAccount.address, 80, ID))
          .to.changeTokenBalances(
            token,
            [user, restrictionAccount],
            [-80, 80]
          );

        expectedBalance.total -= 80;
        expectedBalance.free -= 80;

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer without release awaiting - test 100 - fail - Preminted balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          premintedBalance: 50
        });

        await proveTx(token.mint(user.address, 50));
        await proveTx(token.premintIncrease(user.address, 50, timestamp));
        await expect(token.transferWithId(user.address, restrictionAccount.address, 100, ID))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_PREMINT_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer with release awaiting - test 100 - fail - Preminted balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          premintedBalance: 50
        });

        await proveTx(token.mint(user.address, 50));
        await proveTx(token.premintIncrease(user.address, 50, timestamp));
        await increaseBlockTimestampTo(timestamp);
        expectedBalance.premint -= 50;
        expectedBalance.free += 50;
        await expect(token.transferWithId(user.address, restrictionAccount.address, 80, ID))
          .to.changeTokenBalances(
            token,
            [user, restrictionAccount],
            [-80, 80]
          );

        expectedBalance.total -= 80;
        expectedBalance.free -= 80;

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer without release awaiting - test 120 - fail - Preminted balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          premintedBalance: 50
        });

        await proveTx(token.mint(user.address, 50));
        await proveTx(token.premintIncrease(user.address, 50, timestamp));
        await expect(token.transferWithId(user.address, restrictionAccount.address, 120, ID))
          .to.be.revertedWith(REVERT_MESSAGE_ERC20_TRANSFER_AMOUNT_EXCEEDS_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer with release awaiting - test 120 - fail - Preminted balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          premintedBalance: 50
        });

        await proveTx(token.mint(user.address, 50));
        await proveTx(token.premintIncrease(user.address, 50, timestamp));
        await increaseBlockTimestampTo(timestamp);
        expectedBalance.premint -= 50;
        expectedBalance.free += 50;
        await expect(token.transferWithId(user.address, restrictionAccount.address, 120, ID))
          .to.be.revertedWith(REVERT_MESSAGE_ERC20_TRANSFER_AMOUNT_EXCEEDS_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });
    });
  });

  describe("Frozen balance", async () => {
    describe("Function 'transfer()'", async () => {
      it("Transfer - test 20 - fail - Frozen amount exceeded", async () => {
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 100
        });

        const { token } = await setUpFixture(deployAndConfigureToken);
        await proveTx(token.mint(user.address, 100));
        await proveTx(token.freeze(user.address, 100));
        await expect(connect(token, user).transfer(restrictionAccount.address, 20))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_FROZEN_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer - test 40 - fail - Frozen amount exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 100
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token.freeze(user.address, 100));
        await expect(connect(token, user).transfer(restrictionAccount.address, 40))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_FROZEN_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer - test 60 - fail - Frozen amount exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 100
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token.freeze(user.address, 100));
        await expect(connect(token, user).transfer(restrictionAccount.address, 60))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_FROZEN_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer - test 80 - fail - Frozen amount exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 100
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token.freeze(user.address, 100));
        await expect(connect(token, user).transfer(restrictionAccount.address, 80))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_FROZEN_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer - test 100 - fail - Frozen amount exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 100
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token.freeze(user.address, 100));
        await expect(connect(token, user).transfer(restrictionAccount.address, 100))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_FROZEN_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer - test 120 - fail - ERC20_Balance_Exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 100
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token.freeze(user.address, 100));
        await expect(connect(token, user).transfer(restrictionAccount.address, 120))
          .to.be.revertedWith(REVERT_MESSAGE_ERC20_TRANSFER_AMOUNT_EXCEEDS_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });
    });

    describe("Function 'transferFrozen()'", async () => {
      it("Transfer - test 20 - success", async () => {
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 100
        });

        const { token } = await setUpFixture(deployAndConfigureToken);
        await proveTx(token.mint(user.address, 100));
        await proveTx(token.freeze(user.address, 100));
        await expect(token.transferFrozen(user.address, restrictionAccount.address, 20))
          .to.changeTokenBalances(
            token,
            [user, restrictionAccount],
            [-20, 20]
          );

        expectedBalance.total -= 20;
        expectedBalance.frozen -= 20;

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer - test 40 - success", async () => {
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 100
        });

        const { token } = await setUpFixture(deployAndConfigureToken);
        await proveTx(token.mint(user.address, 100));
        await proveTx(token.freeze(user.address, 100));
        await expect(token.transferFrozen(user.address, restrictionAccount.address, 40))
          .to.changeTokenBalances(
            token,
            [user, restrictionAccount],
            [-40, 40]
          );

        expectedBalance.total -= 40;
        expectedBalance.frozen -= 40;

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer - test 60 - success", async () => {
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 100
        });

        const { token } = await setUpFixture(deployAndConfigureToken);
        await proveTx(token.mint(user.address, 100));
        await proveTx(token.freeze(user.address, 100));
        await expect(token.transferFrozen(user.address, restrictionAccount.address, 60))
          .to.changeTokenBalances(
            token,
            [user, restrictionAccount],
            [-60, 60]
          );

        expectedBalance.total -= 60;
        expectedBalance.frozen -= 60;

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer - test 80 - success", async () => {
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 100
        });

        const { token } = await setUpFixture(deployAndConfigureToken);
        await proveTx(token.mint(user.address, 100));
        await proveTx(token.freeze(user.address, 100));
        await expect(token.transferFrozen(user.address, restrictionAccount.address, 80))
          .to.changeTokenBalances(
            token,
            [user, restrictionAccount],
            [-80, 80]
          );

        expectedBalance.total -= 80;
        expectedBalance.frozen -= 80;

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer - test 100 - success", async () => {
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 100
        });

        const { token } = await setUpFixture(deployAndConfigureToken);
        await proveTx(token.mint(user.address, 100));
        await proveTx(token.freeze(user.address, 100));
        await expect(token.transferFrozen(user.address, restrictionAccount.address, 100))
          .to.changeTokenBalances(
            token,
            [user, restrictionAccount],
            [-100, 100]
          );

        expectedBalance.total -= 100;
        expectedBalance.frozen -= 100;

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer - test 120 - fail - Lack of frozen balance", async () => {
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 100
        });

        const { token } = await setUpFixture(deployAndConfigureToken);
        await proveTx(token.mint(user.address, 100));
        await proveTx(token.freeze(user.address, 100));
        await expect(token.transferFrozen(user.address, restrictionAccount.address, 120))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_LACK_OF_FROZEN_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });
    });

    describe("Function 'transferWithId()'", async () => {
      it("Transfer - test 20 - fail - Frozen amount exceeded", async () => {
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 100
        });

        const { token } = await setUpFixture(deployAndConfigureToken);
        await proveTx(token.mint(user.address, 100));
        await proveTx(token.freeze(user.address, 100));
        await expect(token.transferWithId(user.address, restrictionAccount.address, 20, ID))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_FROZEN_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer - test 40 - fail - Frozen amount exceeded", async () => {
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 100
        });

        const { token } = await setUpFixture(deployAndConfigureToken);
        await proveTx(token.mint(user.address, 100));
        await proveTx(token.freeze(user.address, 100));
        await expect(token.transferWithId(user.address, restrictionAccount.address, 40, ID))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_FROZEN_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer - test 60 - fail - Frozen amount exceeded", async () => {
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 100
        });

        const { token } = await setUpFixture(deployAndConfigureToken);
        await proveTx(token.mint(user.address, 100));
        await proveTx(token.freeze(user.address, 100));
        await expect(token.transferWithId(user.address, restrictionAccount.address, 60, ID))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_FROZEN_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer - test 80 - fail - Frozen amount exceeded", async () => {
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 100
        });

        const { token } = await setUpFixture(deployAndConfigureToken);
        await proveTx(token.mint(user.address, 100));
        await proveTx(token.freeze(user.address, 100));
        await expect(token.transferWithId(user.address, restrictionAccount.address, 80, ID))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_FROZEN_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer - test 100 - fail - Frozen amount exceeded", async () => {
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 100
        });

        const { token } = await setUpFixture(deployAndConfigureToken);
        await proveTx(token.mint(user.address, 100));
        await proveTx(token.freeze(user.address, 100));
        await expect(token.transferWithId(user.address, restrictionAccount.address, 100, ID))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_FROZEN_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer - test 120 - fail - ERC20_Balance_Exceeded", async () => {
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 100
        });

        const { token } = await setUpFixture(deployAndConfigureToken);
        await proveTx(token.mint(user.address, 100));
        await proveTx(token.freeze(user.address, 100));
        await expect(token.transferWithId(user.address, restrictionAccount.address, 120, ID))
          .to.be.revertedWith(REVERT_MESSAGE_ERC20_TRANSFER_AMOUNT_EXCEEDS_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });
    });
  });

  describe("Free and frozen balance", async () => {
    describe("Function 'transfer()'", async () => {
      it("Transfer - test 20 - success", async () => {
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 50
        });

        const { token } = await setUpFixture(deployAndConfigureToken);
        await proveTx(token.mint(user.address, 100));
        await proveTx(token.freeze(user.address, 50));
        await expect(connect(token, user).transfer(restrictionAccount.address, 20))
          .to.changeTokenBalances(
            token,
            [user, restrictionAccount],
            [-20, 20]
          );

        expectedBalance.total -= 20;
        expectedBalance.free -= 20;

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer - test 40 - success", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 50
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token.freeze(user.address, 50));
        await expect(connect(token, user).transfer(restrictionAccount.address, 40))
          .to.changeTokenBalances(
            token,
            [user, restrictionAccount],
            [-40, 40]
          );

        expectedBalance.total -= 40;
        expectedBalance.free -= 40;

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer - test 60 - fail - Frozen amount exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 50
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token.freeze(user.address, 50));
        await expect(connect(token, user).transfer(restrictionAccount.address, 60))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_FROZEN_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer - test 80 - fail - Frozen amount exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 50
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token.freeze(user.address, 50));
        await expect(connect(token, user).transfer(restrictionAccount.address, 80))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_FROZEN_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer - test 100 - fail - Frozen amount exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 50
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token.freeze(user.address, 50));
        await expect(connect(token, user).transfer(restrictionAccount.address, 100))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_FROZEN_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer - test 120 - fail - ERC20 balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 50
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token.freeze(user.address, 50));
        await expect(connect(token, user).transfer(restrictionAccount.address, 120))
          .to.be.revertedWith(REVERT_MESSAGE_ERC20_TRANSFER_AMOUNT_EXCEEDS_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });
    });

    describe("Function 'transferFrozen()'", async () => {
      it("Transfer - test 20 - success", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 50
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token.freeze(user.address, 50));
        await expect(token.transferFrozen(user.address, restrictionAccount.address, 20))
          .to.changeTokenBalances(
            token,
            [user, restrictionAccount],
            [-20, 20]
          );

        expectedBalance.total -= 20;
        expectedBalance.frozen -= 20;

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer - test 40 - success", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 50
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token.freeze(user.address, 50));
        await expect(token.transferFrozen(user.address, restrictionAccount.address, 40))
          .to.changeTokenBalances(
            token,
            [user, restrictionAccount],
            [-40, 40]
          );

        expectedBalance.total -= 40;
        expectedBalance.frozen -= 40;

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer - test 60 - fail - Lack of frozen balance", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 50
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token.freeze(user.address, 50));
        await expect(token.transferFrozen(user.address, restrictionAccount.address, 60))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_LACK_OF_FROZEN_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer - test 80 - fail - Lack of frozen balance", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 50
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token.freeze(user.address, 50));
        await expect(token.transferFrozen(user.address, restrictionAccount.address, 80))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_LACK_OF_FROZEN_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer - test 100 - fail - Lack of frozen balance", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 50
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token.freeze(user.address, 50));
        await expect(token.transferFrozen(user.address, restrictionAccount.address, 100))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_LACK_OF_FROZEN_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer - test 120 - fail - Lack of frozen balance", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 50
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token.freeze(user.address, 50));
        await expect(token.transferFrozen(user.address, restrictionAccount.address, 120))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_LACK_OF_FROZEN_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });
    });

    describe("Function 'transferWithId()'", async () => {
      it("Transfer - test 20 - success", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 50
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token.freeze(user.address, 50));
        await expect(token.transferWithId(user.address, restrictionAccount.address, 20, ID))
          .to.changeTokenBalances(
            token,
            [user, restrictionAccount],
            [-20, 20]
          );

        expectedBalance.total -= 20;
        expectedBalance.free -= 20;

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer - test 40 - success", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 50
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token.freeze(user.address, 50));
        await expect(token.transferWithId(user.address, restrictionAccount.address, 40, ID))
          .to.changeTokenBalances(
            token,
            [user, restrictionAccount],
            [-40, 40]
          );

        expectedBalance.total -= 40;
        expectedBalance.free -= 40;

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer - test 60 - fail - Frozen balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 50
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token.freeze(user.address, 50));
        await expect(token.transferWithId(user.address, restrictionAccount.address, 60, ID))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_FROZEN_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer - test 80 - fail - Frozen balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 50
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token.freeze(user.address, 50));
        await expect(token.transferWithId(user.address, restrictionAccount.address, 80, ID))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_FROZEN_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer - test 100 - fail - Frozen balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 50
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token.freeze(user.address, 50));
        await expect(token.transferWithId(user.address, restrictionAccount.address, 100, ID))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_FROZEN_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer - test 120 - fail - ERC20 balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 50
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token.freeze(user.address, 50));
        await expect(token.transferWithId(user.address, restrictionAccount.address, 120, ID))
          .to.be.revertedWith(REVERT_MESSAGE_ERC20_TRANSFER_AMOUNT_EXCEEDS_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });
    });
  });

  describe("Restricted to ID balance", async () => {
    describe("Function 'transfer()'", async () => {
      it("Transfer to restriction account - test 20 - fail - Restricted balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToIdBalance: 100
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 100, ID));
        await expect(connect(token, user).transfer(restrictionAccount.address, 20))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_RESTRICTED_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account - test 20 - fail - Restricted balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToIdBalance: 100
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 100, ID));
        await expect(connect(token, user).transfer(nonRestrictionAccount.address, 20))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_RESTRICTED_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to restriction account - test 40 - fail - Restricted balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToIdBalance: 100
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 100, ID));
        await expect(connect(token, user).transfer(restrictionAccount.address, 40))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_RESTRICTED_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account - test 40 - fail - Restricted balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToIdBalance: 100
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 100, ID));
        await expect(connect(token, user).transfer(nonRestrictionAccount.address, 40))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_RESTRICTED_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to restriction account - test 60 - fail - Restricted balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToIdBalance: 100
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 100, ID));
        await expect(connect(token, user).transfer(restrictionAccount.address, 60))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_RESTRICTED_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account - test 60 - fail - Restricted balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToIdBalance: 100
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 100, ID));
        await expect(connect(token, user).transfer(nonRestrictionAccount.address, 60))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_RESTRICTED_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to restriction account - test 80 - fail - Restricted balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToIdBalance: 100
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 100, ID));
        await expect(connect(token, user).transfer(restrictionAccount.address, 80))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_RESTRICTED_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account - test 80 - fail - Restricted balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToIdBalance: 100
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 100, ID));
        await expect(connect(token, user).transfer(nonRestrictionAccount.address, 80))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_RESTRICTED_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to restriction account - test 100 - fail - Restricted balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToIdBalance: 100
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 100, ID));
        await expect(connect(token, user).transfer(restrictionAccount.address, 100))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_RESTRICTED_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account - test 100 - fail - Restricted balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToIdBalance: 100
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 100, ID));
        await expect(connect(token, user).transfer(nonRestrictionAccount.address, 100))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_RESTRICTED_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to restriction account - test 120 - fail - ERC20 balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToIdBalance: 100
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 100, ID));
        await expect(connect(token, user).transfer(restrictionAccount.address, 120))
          .to.be.revertedWith(REVERT_MESSAGE_ERC20_TRANSFER_AMOUNT_EXCEEDS_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account - test 120 - fail - ERC20 balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToIdBalance: 100
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 100, ID));
        await expect(connect(token, user).transfer(nonRestrictionAccount.address, 120))
          .to.be.revertedWith(REVERT_MESSAGE_ERC20_TRANSFER_AMOUNT_EXCEEDS_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });
    });

    describe("Function transferFrozen()", async () => {
      it("Transfer to restriction account - test 20 - fail - Lack of frozen balance", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToIdBalance: 100
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 100, ID));
        await expect(token.transferFrozen(user.address, restrictionAccount.address, 20))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_LACK_OF_FROZEN_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account - test 20 - fail - Lack of frozen balance", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToIdBalance: 100
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 100, ID));
        await expect(token.transferFrozen(user.address, nonRestrictionAccount.address, 20))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_LACK_OF_FROZEN_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to restriction account - 40 - fail - Lack of frozen balance", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToIdBalance: 100
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 100, ID));
        await expect(token.transferFrozen(user.address, restrictionAccount.address, 40))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_LACK_OF_FROZEN_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account - test 40 - fail - Lack of frozen balance", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToIdBalance: 100
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 100, ID));
        await expect(token.transferFrozen(user.address, nonRestrictionAccount.address, 40))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_LACK_OF_FROZEN_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to restriction account - test 60 - fail - Lack of frozen balance", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToIdBalance: 100
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 100, ID));
        await expect(token.transferFrozen(user.address, restrictionAccount.address, 60))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_LACK_OF_FROZEN_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account - test 60 - fail - Lack of frozen balance", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToIdBalance: 100
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 100, ID));
        await expect(token.transferFrozen(user.address, nonRestrictionAccount.address, 60))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_LACK_OF_FROZEN_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to restriction account - test 80 - fail - Lack of frozen balance", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToIdBalance: 100
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 100, ID));
        await expect(token.transferFrozen(user.address, restrictionAccount.address, 80))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_LACK_OF_FROZEN_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account - test 80 - fail - Lack of frozen balance", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToIdBalance: 100
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 100, ID));
        await expect(token.transferFrozen(user.address, nonRestrictionAccount.address, 80))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_LACK_OF_FROZEN_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to restriction account - test 100 - fail - Lack of frozen balance", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToIdBalance: 100
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 100, ID));
        await expect(token.transferFrozen(user.address, restrictionAccount.address, 100))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_LACK_OF_FROZEN_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account - test 100 - fail - Lack of frozen balance", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToIdBalance: 100
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 100, ID));
        await expect(token.transferFrozen(user.address, nonRestrictionAccount.address, 100))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_LACK_OF_FROZEN_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to restriction account - test 120 - fail - Lack of frozen balance", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToIdBalance: 100
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 100, ID));
        await expect(token.transferFrozen(user.address, restrictionAccount.address, 120))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_LACK_OF_FROZEN_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account - test 120 - fail - Lack of frozen balance", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToIdBalance: 100
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 100, ID));
        await expect(token.transferFrozen(user.address, nonRestrictionAccount.address, 120))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_LACK_OF_FROZEN_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });
    });

    describe("Function 'transferWithId()'", async () => {
      it("Transfer to restriction account - test 20 - success", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToIdBalance: 100
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 100, ID));
        await expect(token.transferWithId(user.address, restrictionAccount.address, 20, ID))
          .to.changeTokenBalances(
            token,
            [user, restrictionAccount],
            [-20, 20]
          );

        expectedBalance.total -= 20;
        expectedBalance.restricted -= 20;

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account - test 20 - fail - Restricted balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToIdBalance: 100
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 100, ID));
        await expect(token.transferWithId(user.address, nonRestrictionAccount.address, 20, ID))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_RESTRICTED_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to restriction account - test 40 - success", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToIdBalance: 100
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 100, ID));
        await expect(token.transferWithId(user.address, restrictionAccount.address, 40, ID))
          .to.changeTokenBalances(
            token,
            [user, restrictionAccount],
            [-40, 40]
          );

        expectedBalance.total -= 40;
        expectedBalance.restricted -= 40;

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account - test 40 - fail - Restricted balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToIdBalance: 100
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 100, ID));
        await expect(token.transferWithId(user.address, nonRestrictionAccount.address, 40, ID))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_RESTRICTED_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to restriction account - test 60 - success", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToIdBalance: 100
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 100, ID));
        await expect(token.transferWithId(user.address, restrictionAccount.address, 60, ID))
          .to.changeTokenBalances(
            token,
            [user, restrictionAccount],
            [-60, 60]
          );

        expectedBalance.total -= 60;
        expectedBalance.restricted -= 60;

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account - test 60 - fail - Restricted balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToIdBalance: 100
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 100, ID));
        await expect(token.transferWithId(user.address, nonRestrictionAccount.address, 60, ID))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_RESTRICTED_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to restriction account - test 80 - success", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToIdBalance: 100
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 100, ID));
        await expect(token.transferWithId(user.address, restrictionAccount.address, 80, ID))
          .to.changeTokenBalances(
            token,
            [user, restrictionAccount],
            [-80, 80]
          );

        expectedBalance.total -= 80;
        expectedBalance.restricted -= 80;

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account - test 80 - fail - Restricted balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToIdBalance: 100
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 100, ID));
        await expect(token.transferWithId(user.address, nonRestrictionAccount.address, 80, ID))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_RESTRICTED_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to restriction account - test 100 - success", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToIdBalance: 100
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 100, ID));
        await expect(token.transferWithId(user.address, restrictionAccount.address, 100, ID))
          .to.changeTokenBalances(
            token,
            [user, restrictionAccount],
            [-100, 100]
          );

        expectedBalance.total -= 100;
        expectedBalance.restricted -= 100;

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account - test 100 - fail - Restricted balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToIdBalance: 100
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 100, ID));
        await expect(token.transferWithId(user.address, nonRestrictionAccount.address, 100, ID))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_RESTRICTED_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to restriction account - test 120 - fail - ERC20 balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToIdBalance: 100
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 100, ID));
        await expect(token.transferWithId(user.address, restrictionAccount.address, 120, ID))
          .to.be.revertedWith(REVERT_MESSAGE_ERC20_TRANSFER_AMOUNT_EXCEEDS_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account - test 120 - fail - ERC20 balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToIdBalance: 100
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 100, ID));
        await expect(token.transferWithId(user.address, nonRestrictionAccount.address, 120, ID))
          .to.be.revertedWith(REVERT_MESSAGE_ERC20_TRANSFER_AMOUNT_EXCEEDS_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });
    });
  });

  describe("Free and restricted to ID balances", async () => {
    describe("Function 'transfer()'", async () => {
      it("Transfer to restriction account - test 20 - success", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToIdBalance: 50
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 50, ID));
        await expect(connect(token, user).transfer(restrictionAccount.address, 20))
          .to.changeTokenBalances(
            token,
            [user, restrictionAccount],
            [-20, 20]
          );

        expectedBalance.total -= 20;
        expectedBalance.free -= 20;

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account - test 20 - success", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToIdBalance: 50
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 50, ID));
        await expect(connect(token, user).transfer(nonRestrictionAccount.address, 20))
          .to.changeTokenBalances(
            token,
            [user, nonRestrictionAccount],
            [-20, 20]
          );

        expectedBalance.total -= 20;
        expectedBalance.free -= 20;

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to restriction account - test 40 - success", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToIdBalance: 50
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 50, ID));
        await expect(connect(token, user).transfer(restrictionAccount.address, 40))
          .to.changeTokenBalances(
            token,
            [user, restrictionAccount],
            [-40, 40]
          );

        expectedBalance.total -= 40;
        expectedBalance.free -= 40;

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account - test 40 - success", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToIdBalance: 50
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 50, ID));
        await expect(connect(token, user).transfer(nonRestrictionAccount.address, 40))
          .to.changeTokenBalances(
            token,
            [user, nonRestrictionAccount],
            [-40, 40]
          );

        expectedBalance.total -= 40;
        expectedBalance.free -= 40;

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to restriction account - test 60 - fail - Restricted balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToIdBalance: 50
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 50, ID));
        await expect(connect(token, user).transfer(restrictionAccount.address, 60))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_RESTRICTED_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account - test 60 - fail - Restricted balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToIdBalance: 50
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 50, ID));
        await expect(connect(token, user).transfer(nonRestrictionAccount.address, 60))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_RESTRICTED_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to restriction account - test 80 - fail - Restricted balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToIdBalance: 50
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 50, ID));
        await expect(connect(token, user).transfer(restrictionAccount.address, 80))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_RESTRICTED_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account - test 80 - fail - Restricted balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToIdBalance: 50
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 50, ID));
        await expect(connect(token, user).transfer(nonRestrictionAccount.address, 80))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_RESTRICTED_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to restriction account - test 100 - fail - Restricted balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToIdBalance: 50
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 50, ID));
        await expect(connect(token, user).transfer(restrictionAccount.address, 100))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_RESTRICTED_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account - test 100 - fail - Restricted balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToIdBalance: 50
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 50, ID));
        await expect(connect(token, user).transfer(nonRestrictionAccount.address, 100))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_RESTRICTED_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to restriction account - test 120 - fail - ERC20 balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToIdBalance: 50
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 50, ID));
        await expect(connect(token, user).transfer(restrictionAccount.address, 120))
          .to.be.revertedWith(REVERT_MESSAGE_ERC20_TRANSFER_AMOUNT_EXCEEDS_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account - test 120 - fail - ERC20 balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToIdBalance: 50
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 50, ID));
        await expect(connect(token, user).transfer(nonRestrictionAccount.address, 120))
          .to.be.revertedWith(REVERT_MESSAGE_ERC20_TRANSFER_AMOUNT_EXCEEDS_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });
    });

    describe("Function 'transferFrozen()'", async () => {
      it("Transfer to restriction account - test 20 - fail - Lack of frozen balance", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToIdBalance: 50
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 50, ID));
        await expect(token.transferFrozen(user.address, restrictionAccount.address, 20))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_LACK_OF_FROZEN_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account - test 20 - fail - Lack of frozen balance", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToIdBalance: 50
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 50, ID));
        await expect(token.transferFrozen(user.address, nonRestrictionAccount.address, 20))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_LACK_OF_FROZEN_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to restriction account - test 40 - fail - Lack of frozen balance", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToIdBalance: 50
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 50, ID));
        await expect(token.transferFrozen(user.address, restrictionAccount.address, 40))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_LACK_OF_FROZEN_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account - test 40 - fail - Lack of frozen balance", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToIdBalance: 50
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 50, ID));
        await expect(token.transferFrozen(user.address, nonRestrictionAccount.address, 40))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_LACK_OF_FROZEN_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to restriction account - test 60 - fail - Lack of frozen balance", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToIdBalance: 50
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 50, ID));
        await expect(token.transferFrozen(user.address, restrictionAccount.address, 60))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_LACK_OF_FROZEN_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account - test 60 - fail - Lack of frozen balance", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToIdBalance: 50
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 50, ID));
        await expect(token.transferFrozen(user.address, nonRestrictionAccount.address, 60))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_LACK_OF_FROZEN_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to restriction account - test 80 - fail - Lack of frozen balance", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToIdBalance: 50
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 50, ID));
        await expect(token.transferFrozen(user.address, restrictionAccount.address, 80))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_LACK_OF_FROZEN_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account - test 80 - fail - Lack of frozen balance", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToIdBalance: 50
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 50, ID));
        await expect(token.transferFrozen(user.address, nonRestrictionAccount.address, 80))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_LACK_OF_FROZEN_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to restriction account - test 100 - fail - Lack of frozen balance", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToIdBalance: 50
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 50, ID));
        await expect(token.transferFrozen(user.address, restrictionAccount.address, 100))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_LACK_OF_FROZEN_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account - test 100 - fail - Lack of frozen balance", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToIdBalance: 50
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 50, ID));
        await expect(token.transferFrozen(user.address, nonRestrictionAccount.address, 100))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_LACK_OF_FROZEN_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to restriction account - test 120 - fail - Lack of frozen balance", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToIdBalance: 50
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 50, ID));
        await expect(token.transferFrozen(user.address, restrictionAccount.address, 120))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_LACK_OF_FROZEN_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account - test 120 - fail - Lack of frozen balance", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToIdBalance: 50
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 50, ID));
        await expect(token.transferFrozen(user.address, nonRestrictionAccount.address, 120))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_LACK_OF_FROZEN_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });
    });

    describe("Function 'transferWithId()'", async () => {
      it("Transfer to restriction account - test 20 - success", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToIdBalance: 50
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 50, ID));
        await expect(token.transferWithId(user.address, restrictionAccount.address, 20, ID))
          .to.changeTokenBalances(
            token,
            [user, restrictionAccount],
            [-20, 20]
          );

        expectedBalance.total -= 20;
        expectedBalance.restricted -= 20;

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account - test 20 - success", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToIdBalance: 50
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 50, ID));
        await expect(token.transferWithId(user.address, nonRestrictionAccount.address, 20, ID))
          .to.changeTokenBalances(
            token,
            [user, nonRestrictionAccount],
            [-20, 20]
          );

        expectedBalance.total -= 20;
        expectedBalance.free -= 20;

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to restriction account - test 40 - success", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToIdBalance: 50
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 50, ID));
        await expect(token.transferWithId(user.address, restrictionAccount.address, 40, ID))
          .to.changeTokenBalances(
            token,
            [user, restrictionAccount],
            [-40, 40]
          );

        expectedBalance.total -= 40;
        expectedBalance.restricted -= 40;

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account - test 40 - success", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToIdBalance: 50
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 50, ID));
        await expect(token.transferWithId(user.address, nonRestrictionAccount.address, 40, ID))
          .to.changeTokenBalances(
            token,
            [user, nonRestrictionAccount],
            [-40, 40]
          );

        expectedBalance.total -= 40;
        expectedBalance.free -= 40;

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to restriction account - test 60 - success", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToIdBalance: 50
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 50, ID));
        await expect(token.transferWithId(user.address, restrictionAccount.address, 60, ID))
          .to.changeTokenBalances(
            token,
            [user, restrictionAccount],
            [-60, 60]
          );

        expectedBalance.total -= 60;
        expectedBalance.restricted -= 50;
        expectedBalance.free -= 10;

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account - test 60 - fail - Restricted balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToIdBalance: 50
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 50, ID));
        await expect(token.transferWithId(user.address, nonRestrictionAccount.address, 60, ID))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_RESTRICTED_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to restriction account - test 80 - success", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToIdBalance: 50
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 50, ID));
        await expect(token.transferWithId(user.address, restrictionAccount.address, 80, ID))
          .to.changeTokenBalances(
            token,
            [user, restrictionAccount],
            [-80, 80]
          );

        expectedBalance.total -= 80;
        expectedBalance.restricted -= 50;
        expectedBalance.free -= 30;

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account - test 80 - fail - Restricted balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToIdBalance: 50
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 50, ID));
        await expect(token.transferWithId(user.address, nonRestrictionAccount.address, 80, ID))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_RESTRICTED_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to restriction account - test 100 - success", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToIdBalance: 50
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 50, ID));
        await expect(token.transferWithId(user.address, restrictionAccount.address, 100, ID))
          .to.changeTokenBalances(
            token,
            [user, restrictionAccount],
            [-100, 100]
          );

        expectedBalance.total -= 100;
        expectedBalance.free -= 50;
        expectedBalance.restricted -= 50;

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account - test 100 - fail - Restricted balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToIdBalance: 50
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 50, ID));
        await expect(token.transferWithId(user.address, nonRestrictionAccount.address, 100, ID))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_RESTRICTED_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to restriction account - test 120 - fail - ERC20 balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToIdBalance: 50
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 50, ID));
        await expect(token.transferWithId(user.address, restrictionAccount.address, 120, ID))
          .to.be.revertedWith(REVERT_MESSAGE_ERC20_TRANSFER_AMOUNT_EXCEEDS_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account - test 120 - fail - ERC20 balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToIdBalance: 50
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 50, ID));
        await expect(token.transferWithId(user.address, nonRestrictionAccount.address, 120, ID))
          .to.be.revertedWith(REVERT_MESSAGE_ERC20_TRANSFER_AMOUNT_EXCEEDS_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });
    });
  });

  describe("Restricted to ANY_ID balance", async () => {
    describe("Function 'transfer()'", async () => {
      it("Transfer to restriction account - test 20 - fail - Restricted balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToAnyIdBalance: 100
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 100, ANY_ID));
        await expect(connect(token, user).transfer(restrictionAccount.address, 20))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_RESTRICTED_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account - test 20 - fail - Restricted balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToAnyIdBalance: 100
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 100, ANY_ID));
        await expect(connect(token, user).transfer(nonRestrictionAccount.address, 20))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_RESTRICTED_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to restriction account - test 40 - fail - Restricted balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToAnyIdBalance: 100
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 100, ANY_ID));
        await expect(connect(token, user).transfer(restrictionAccount.address, 40))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_RESTRICTED_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account - test 40 - fail - Restricted balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToAnyIdBalance: 100
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 100, ANY_ID));
        await expect(connect(token, user).transfer(nonRestrictionAccount.address, 40))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_RESTRICTED_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to restriction account - test 60 - fail - Restricted balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToAnyIdBalance: 100
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 100, ANY_ID));
        await expect(connect(token, user).transfer(restrictionAccount.address, 60))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_RESTRICTED_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account - test 60 - fail - Restricted balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToAnyIdBalance: 100
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 100, ANY_ID));
        await expect(connect(token, user).transfer(nonRestrictionAccount.address, 60))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_RESTRICTED_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to restriction account - test 80 - fail - Restricted balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToAnyIdBalance: 100
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 100, ANY_ID));
        await expect(connect(token, user).transfer(restrictionAccount.address, 80))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_RESTRICTED_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account - test 80 - fail - Restricted balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToAnyIdBalance: 100
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 100, ANY_ID));
        await expect(connect(token, user).transfer(nonRestrictionAccount.address, 80))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_RESTRICTED_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to restriction account - test 100 - fail - Restricted balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToAnyIdBalance: 100
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 100, ANY_ID));
        await expect(connect(token, user).transfer(restrictionAccount.address, 100))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_RESTRICTED_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account - test 100 - fail - Restricted balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToAnyIdBalance: 100
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 100, ANY_ID));
        await expect(connect(token, user).transfer(nonRestrictionAccount.address, 100))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_RESTRICTED_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to restriction account - test 120 - fail - Restricted balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToAnyIdBalance: 100
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 100, ANY_ID));
        await expect(connect(token, user).transfer(restrictionAccount.address, 120))
          .to.be.revertedWith(REVERT_MESSAGE_ERC20_TRANSFER_AMOUNT_EXCEEDS_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account - test 120 - fail - Restricted balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToAnyIdBalance: 100
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 100, ANY_ID));
        await expect(connect(token, user).transfer(nonRestrictionAccount.address, 120))
          .to.be.revertedWith(REVERT_MESSAGE_ERC20_TRANSFER_AMOUNT_EXCEEDS_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });
    });

    describe("Function 'transferFrozen()'", async () => {
      it("Transfer to restriction account - test 20 - fail - Lack of frozen balance", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToAnyIdBalance: 100
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 100, ANY_ID));
        await expect(token.transferFrozen(user.address, restrictionAccount.address, 20))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_LACK_OF_FROZEN_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account - test 20 - fail - Lack of frozen balance", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToAnyIdBalance: 100
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 100, ANY_ID));
        await expect(token.transferFrozen(user.address, nonRestrictionAccount.address, 20))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_LACK_OF_FROZEN_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to restriction account - test 40 - fail - Lack of frozen balance", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToAnyIdBalance: 100
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 100, ANY_ID));
        await expect(token.transferFrozen(user.address, restrictionAccount.address, 40))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_LACK_OF_FROZEN_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account - test 40 - fail - Lack of frozen balance", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToAnyIdBalance: 100
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 100, ANY_ID));
        await expect(token.transferFrozen(user.address, nonRestrictionAccount.address, 40))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_LACK_OF_FROZEN_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to restriction account - test 60 - fail - Lack of frozen balance", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToAnyIdBalance: 100
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 100, ANY_ID));
        await expect(token.transferFrozen(user.address, restrictionAccount.address, 60))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_LACK_OF_FROZEN_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account - test 60 - fail - Lack of frozen balance", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToAnyIdBalance: 100
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 100, ANY_ID));
        await expect(token.transferFrozen(user.address, nonRestrictionAccount.address, 60))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_LACK_OF_FROZEN_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to restriction account - test 80 - fail - Lack of frozen balance", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToAnyIdBalance: 100
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 100, ANY_ID));
        await expect(token.transferFrozen(user.address, restrictionAccount.address, 80))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_LACK_OF_FROZEN_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account - test 80 - fail - Lack of frozen balance", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToAnyIdBalance: 100
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 100, ANY_ID));
        await expect(token.transferFrozen(user.address, nonRestrictionAccount.address, 80))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_LACK_OF_FROZEN_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to restriction account - test 100 - fail - Lack of frozen balance", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToAnyIdBalance: 100
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 100, ANY_ID));
        await expect(token.transferFrozen(user.address, restrictionAccount.address, 100))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_LACK_OF_FROZEN_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account - test 100 - fail - Lack of frozen balance", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToAnyIdBalance: 100
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 100, ANY_ID));
        await expect(token.transferFrozen(user.address, nonRestrictionAccount.address, 100))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_LACK_OF_FROZEN_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to restriction account - test 120 - fail - Lack of frozen balance", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToAnyIdBalance: 100
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 100, ANY_ID));
        await expect(token.transferFrozen(user.address, restrictionAccount.address, 120))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_LACK_OF_FROZEN_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account - test 120 - fail - Lack of frozen balance", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToAnyIdBalance: 100
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 100, ANY_ID));
        await expect(token.transferFrozen(user.address, nonRestrictionAccount.address, 120))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_LACK_OF_FROZEN_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });
    });

    describe("Function 'transferWithId()'", async () => {
      it("Transfer to restriction account - test 20 - success", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToAnyIdBalance: 100
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 100, ANY_ID));
        await expect(token.transferWithId(user.address, restrictionAccount.address, 20, ID))
          .to.changeTokenBalances(
            token,
            [user, restrictionAccount],
            [-20, 20]
          );

        expectedBalance.total -= 20;
        expectedBalance.restricted -= 20;

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account - test 20 - fail - Lack of frozen balance", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToAnyIdBalance: 100
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 100, ANY_ID));
        await expect(token.transferWithId(user.address, nonRestrictionAccount.address, 20, ID))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_RESTRICTED_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to restriction account - test 40 - success", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToAnyIdBalance: 100
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 100, ANY_ID));
        await expect(token.transferWithId(user.address, restrictionAccount.address, 40, ID))
          .to.changeTokenBalances(
            token,
            [user, restrictionAccount],
            [-40, 40]
          );

        expectedBalance.total -= 40;
        expectedBalance.restricted -= 40;

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account - test 40 - fail - Lack of frozen balance", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToAnyIdBalance: 100
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 100, ANY_ID));
        await expect(token.transferWithId(user.address, nonRestrictionAccount.address, 40, ID))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_RESTRICTED_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to restriction account - test 60 - success", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToAnyIdBalance: 100
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 100, ANY_ID));
        await expect(token.transferWithId(user.address, restrictionAccount.address, 60, ID))
          .to.changeTokenBalances(
            token,
            [user, restrictionAccount],
            [-60, 60]
          );

        expectedBalance.total -= 60;
        expectedBalance.restricted -= 60;

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account - test 60 - fail - Lack of frozen balance", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToAnyIdBalance: 100
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 100, ANY_ID));
        await expect(token.transferWithId(user.address, nonRestrictionAccount.address, 60, ID))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_RESTRICTED_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to restriction account - test 80 - success", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToAnyIdBalance: 100
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 100, ANY_ID));
        await expect(token.transferWithId(user.address, restrictionAccount.address, 80, ID))
          .to.changeTokenBalances(
            token,
            [user, restrictionAccount],
            [-80, 80]
          );

        expectedBalance.total -= 80;
        expectedBalance.restricted -= 80;

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account - test 80 - fail - Lack of frozen balance", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToAnyIdBalance: 100
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 100, ANY_ID));
        await expect(token.transferWithId(user.address, nonRestrictionAccount.address, 80, ID))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_RESTRICTED_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to restriction account - test 100 - success", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToAnyIdBalance: 100
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 100, ANY_ID));
        await expect(token.transferWithId(user.address, restrictionAccount.address, 100, ID))
          .to.changeTokenBalances(
            token,
            [user, restrictionAccount],
            [-100, 100]
          );

        expectedBalance.total -= 100;
        expectedBalance.restricted -= 100;

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account - test 100 - fail - Lack of frozen balance", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToAnyIdBalance: 100
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 100, ANY_ID));
        await expect(token.transferWithId(user.address, nonRestrictionAccount.address, 100, ID))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_RESTRICTED_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to restriction account - test 120 - fail - ERC20 balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToAnyIdBalance: 100
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 100, ANY_ID));
        await expect(token.transferWithId(user.address, restrictionAccount.address, 120, ID))
          .to.be.revertedWith(REVERT_MESSAGE_ERC20_TRANSFER_AMOUNT_EXCEEDS_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account - test 120 - fail - ERC20 balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToAnyIdBalance: 100
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 100, ANY_ID));
        await expect(token.transferWithId(user.address, nonRestrictionAccount.address, 120, ID))
          .to.be.revertedWith(REVERT_MESSAGE_ERC20_TRANSFER_AMOUNT_EXCEEDS_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });
    });
  });

  describe("Restricted to ID and restricted to ANY_ID balances", async () => {
    describe("Function 'transfer()'", async () => {
      it("Transfer to restriction account - test 20 - fail - Restricted balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToAnyIdBalance: 50,
          restrictedToIdBalance: 50
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 50, ID));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 50, ANY_ID));
        await expect(connect(token, user).transfer(restrictionAccount.address, 20))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_RESTRICTED_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account - test 20 - fail - Restricted balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToAnyIdBalance: 50,
          restrictedToIdBalance: 50
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 50, ID));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 50, ANY_ID));
        await expect(connect(token, user).transfer(nonRestrictionAccount.address, 20))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_RESTRICTED_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to restriction account - test 40 - fail - Restricted balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToAnyIdBalance: 50,
          restrictedToIdBalance: 50
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 50, ID));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 50, ANY_ID));
        await expect(connect(token, user).transfer(restrictionAccount.address, 40))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_RESTRICTED_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account - test 40 - fail - Restricted balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToAnyIdBalance: 50,
          restrictedToIdBalance: 50
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 50, ID));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 50, ANY_ID));
        await expect(connect(token, user).transfer(nonRestrictionAccount.address, 40))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_RESTRICTED_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to restriction account - test 60 - fail - Restricted balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToAnyIdBalance: 50,
          restrictedToIdBalance: 50
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 50, ID));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 50, ANY_ID));
        await expect(connect(token, user).transfer(restrictionAccount.address, 60))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_RESTRICTED_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account - test 60 - fail - Restricted balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToAnyIdBalance: 50,
          restrictedToIdBalance: 50
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 50, ID));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 50, ANY_ID));
        await expect(connect(token, user).transfer(nonRestrictionAccount.address, 60))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_RESTRICTED_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to restriction account - test 80 - fail - Restricted balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToAnyIdBalance: 50,
          restrictedToIdBalance: 50
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 50, ID));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 50, ANY_ID));
        await expect(connect(token, user).transfer(restrictionAccount.address, 80))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_RESTRICTED_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account - test 80 - fail - Restricted balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToAnyIdBalance: 50,
          restrictedToIdBalance: 50
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 50, ID));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 50, ANY_ID));
        await expect(connect(token, user).transfer(nonRestrictionAccount.address, 80))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_RESTRICTED_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to restriction account - test 100 - fail - Restricted balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToAnyIdBalance: 50,
          restrictedToIdBalance: 50
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 50, ID));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 50, ANY_ID));
        await expect(connect(token, user).transfer(restrictionAccount.address, 100))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_RESTRICTED_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account - test 100 - fail - Restricted balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToAnyIdBalance: 50,
          restrictedToIdBalance: 50
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 50, ID));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 50, ANY_ID));
        await expect(connect(token, user).transfer(nonRestrictionAccount.address, 100))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_RESTRICTED_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to restriction account - test 120 - fail - ERC20 balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToAnyIdBalance: 50,
          restrictedToIdBalance: 50
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 50, ID));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 50, ANY_ID));
        await expect(connect(token, user).transfer(restrictionAccount.address, 120))
          .to.be.revertedWith(REVERT_MESSAGE_ERC20_TRANSFER_AMOUNT_EXCEEDS_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account - test 120 - fail - ERC20 balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToAnyIdBalance: 50,
          restrictedToIdBalance: 50
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 50, ID));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 50, ANY_ID));
        await expect(connect(token, user).transfer(nonRestrictionAccount.address, 120))
          .to.be.revertedWith(REVERT_MESSAGE_ERC20_TRANSFER_AMOUNT_EXCEEDS_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });
    });

    describe("Function 'transferFrozen()'", async () => {
      it("Transfer to restriction account - test 20 - fail - Lack of frozen balance", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToAnyIdBalance: 50,
          restrictedToIdBalance: 50
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 50, ID));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 50, ANY_ID));
        await expect(token.transferFrozen(user.address, restrictionAccount.address, 20))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_LACK_OF_FROZEN_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account - test 20 - fail - Lack of frozen balance", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToAnyIdBalance: 50,
          restrictedToIdBalance: 50
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 50, ID));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 50, ANY_ID));
        await expect(token.transferFrozen(user.address, nonRestrictionAccount.address, 20))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_LACK_OF_FROZEN_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to restriction account - test 40 - fail - Lack of frozen balance", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToAnyIdBalance: 50,
          restrictedToIdBalance: 50
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 50, ID));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 50, ANY_ID));
        await expect(token.transferFrozen(user.address, restrictionAccount.address, 40))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_LACK_OF_FROZEN_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account - test 40 - fail - Lack of frozen balance", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToAnyIdBalance: 50,
          restrictedToIdBalance: 50
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 50, ID));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 50, ANY_ID));
        await expect(token.transferFrozen(user.address, nonRestrictionAccount.address, 40))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_LACK_OF_FROZEN_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to restriction account - test 60 - fail - Lack of frozen balance", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToAnyIdBalance: 50,
          restrictedToIdBalance: 50
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 50, ID));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 50, ANY_ID));
        await expect(token.transferFrozen(user.address, restrictionAccount.address, 60))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_LACK_OF_FROZEN_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account - test 60 - fail - Lack of frozen balance", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToAnyIdBalance: 50,
          restrictedToIdBalance: 50
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 50, ID));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 50, ANY_ID));
        await expect(token.transferFrozen(user.address, nonRestrictionAccount.address, 60))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_LACK_OF_FROZEN_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to restriction account - test 80 - fail - Lack of frozen balance", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToAnyIdBalance: 50,
          restrictedToIdBalance: 50
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 50, ID));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 50, ANY_ID));
        await expect(token.transferFrozen(user.address, restrictionAccount.address, 80))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_LACK_OF_FROZEN_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account - test 80 - fail - Lack of frozen balance", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToAnyIdBalance: 50,
          restrictedToIdBalance: 50
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 50, ID));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 50, ANY_ID));
        await expect(token.transferFrozen(user.address, nonRestrictionAccount.address, 80))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_LACK_OF_FROZEN_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to restriction account - test 100 - fail - Lack of frozen balance", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToAnyIdBalance: 50,
          restrictedToIdBalance: 50
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 50, ID));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 50, ANY_ID));
        await expect(token.transferFrozen(user.address, restrictionAccount.address, 100))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_LACK_OF_FROZEN_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account - test 100 - fail - Lack of frozen balance", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToAnyIdBalance: 50,
          restrictedToIdBalance: 50
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 50, ID));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 50, ANY_ID));
        await expect(token.transferFrozen(user.address, nonRestrictionAccount.address, 100))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_LACK_OF_FROZEN_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to restriction account - test 120 - fail - Lack of frozen balance", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToAnyIdBalance: 50,
          restrictedToIdBalance: 50
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 50, ID));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 50, ANY_ID));
        await expect(token.transferFrozen(user.address, restrictionAccount.address, 120))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_LACK_OF_FROZEN_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account - test 120 - fail - Lack of frozen balance", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToAnyIdBalance: 50,
          restrictedToIdBalance: 50
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 50, ID));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 50, ANY_ID));
        await expect(token.transferFrozen(user.address, nonRestrictionAccount.address, 120))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_LACK_OF_FROZEN_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });
    });

    describe("Function 'transferWithId()'", async () => {
      it("Transfer to restriction account - test 20 - success", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToAnyIdBalance: 50,
          restrictedToIdBalance: 50
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 50, ID));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 50, ANY_ID));
        await expect(token.transferWithId(user.address, restrictionAccount.address, 20, ID))
          .to.changeTokenBalances(
            token,
            [user, restrictionAccount],
            [-20, 20]
          );

        expectedBalance.total -= 20;
        expectedBalance.restricted -= 20;

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account - test 20 - fail - Restricted balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToAnyIdBalance: 50,
          restrictedToIdBalance: 50
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 50, ID));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 50, ANY_ID));
        await expect(token.transferWithId(user.address, nonRestrictionAccount.address, 20, ID))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_RESTRICTED_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to restriction account - test 40 - success", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToAnyIdBalance: 50,
          restrictedToIdBalance: 50
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 50, ID));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 50, ANY_ID));
        await expect(token.transferWithId(user.address, restrictionAccount.address, 40, ID))
          .to.changeTokenBalances(
            token,
            [user, restrictionAccount],
            [-40, 40]
          );

        expectedBalance.total -= 40;
        expectedBalance.restricted -= 40;

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account - test 40 - fail - Restricted balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToAnyIdBalance: 50,
          restrictedToIdBalance: 50
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 50, ID));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 50, ANY_ID));
        await expect(token.transferWithId(user.address, nonRestrictionAccount.address, 40, ID))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_RESTRICTED_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to restriction account - test 60 - success", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToAnyIdBalance: 50,
          restrictedToIdBalance: 50
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 50, ID));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 50, ANY_ID));
        await expect(token.transferWithId(user.address, restrictionAccount.address, 60, ID))
          .to.changeTokenBalances(
            token,
            [user, restrictionAccount],
            [-60, 60]
          );

        expectedBalance.total -= 60;
        expectedBalance.restricted -= 60;

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account - test 60 - fail - Restricted balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToAnyIdBalance: 50,
          restrictedToIdBalance: 50
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 50, ID));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 50, ANY_ID));
        await expect(token.transferWithId(user.address, nonRestrictionAccount.address, 60, ID))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_RESTRICTED_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to restriction account - test 80 - success", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToAnyIdBalance: 50,
          restrictedToIdBalance: 50
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 50, ID));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 50, ANY_ID));
        await expect(token.transferWithId(user.address, restrictionAccount.address, 80, ID))
          .to.changeTokenBalances(
            token,
            [user, restrictionAccount],
            [-80, 80]
          );

        expectedBalance.total -= 80;
        expectedBalance.restricted -= 80;

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account - test 80 - fail - Restricted balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToAnyIdBalance: 50,
          restrictedToIdBalance: 50
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 50, ID));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 50, ANY_ID));
        await expect(token.transferWithId(user.address, nonRestrictionAccount.address, 80, ID))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_RESTRICTED_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to restriction account - test 100 - success", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToAnyIdBalance: 50,
          restrictedToIdBalance: 50
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 50, ID));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 50, ANY_ID));
        await expect(token.transferWithId(user.address, restrictionAccount.address, 100, ID))
          .to.changeTokenBalances(
            token,
            [user, restrictionAccount],
            [-100, 100]
          );

        expectedBalance.total -= 100;
        expectedBalance.restricted -= 100;

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account - test 100 - fail - Restricted balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToAnyIdBalance: 50,
          restrictedToIdBalance: 50
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 50, ID));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 50, ANY_ID));
        await expect(token.transferWithId(user.address, nonRestrictionAccount.address, 100, ID))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_RESTRICTED_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to restriction account - test 120 - fail - ERC20 balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToAnyIdBalance: 50,
          restrictedToIdBalance: 50
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 50, ID));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 50, ANY_ID));
        await expect(token.transferWithId(user.address, restrictionAccount.address, 120, ID))
          .to.be.revertedWith(REVERT_MESSAGE_ERC20_TRANSFER_AMOUNT_EXCEEDS_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account - test 120 - fail - ERC20 balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToAnyIdBalance: 50,
          restrictedToIdBalance: 50
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 50, ID));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 50, ANY_ID));
        await expect(token.transferWithId(user.address, nonRestrictionAccount.address, 120, ID))
          .to.be.revertedWith(REVERT_MESSAGE_ERC20_TRANSFER_AMOUNT_EXCEEDS_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });
    });
  });

  describe("Frozen and restricted to ANY_ID balances", async () => {
    describe("Function 'transfer()'", async () => {
      it("Transfer to restriction account - test 20 - fail - Restricted balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToAnyIdBalance: 50,
          frozenBalance: 50
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token.freeze(user.address, 50));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 50, ANY_ID));
        await expect(connect(token, user).transfer(restrictionAccount.address, 20))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_RESTRICTED_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account - test 20 - fail - Restricted balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToAnyIdBalance: 50,
          frozenBalance: 50
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token.freeze(user.address, 50));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 50, ANY_ID));
        await expect(connect(token, user).transfer(nonRestrictionAccount.address, 20))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_RESTRICTED_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to restriction account - test 40 - fail - Restricted balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToAnyIdBalance: 50,
          frozenBalance: 50
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token.freeze(user.address, 50));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 50, ANY_ID));
        await expect(connect(token, user).transfer(restrictionAccount.address, 40))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_RESTRICTED_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account - test 40 - fail - Restricted balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToAnyIdBalance: 50,
          frozenBalance: 50
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token.freeze(user.address, 50));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 50, ANY_ID));
        await expect(connect(token, user).transfer(nonRestrictionAccount.address, 40))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_RESTRICTED_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to restriction account - test 60 - fail - Restricted balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToAnyIdBalance: 50,
          frozenBalance: 50
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token.freeze(user.address, 50));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 50, ANY_ID));
        await expect(connect(token, user).transfer(restrictionAccount.address, 60))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_FROZEN_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account - test 60 - fail - Frozen balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToAnyIdBalance: 50,
          frozenBalance: 50
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token.freeze(user.address, 50));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 50, ANY_ID));
        await expect(connect(token, user).transfer(nonRestrictionAccount.address, 60))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_FROZEN_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to restriction account - test 80 - fail - Restricted balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToAnyIdBalance: 50,
          frozenBalance: 50
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token.freeze(user.address, 50));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 50, ANY_ID));
        await expect(connect(token, user).transfer(restrictionAccount.address, 80))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_FROZEN_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account - test 80 - fail - Frozen balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToAnyIdBalance: 50,
          frozenBalance: 50
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token.freeze(user.address, 50));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 50, ANY_ID));
        await expect(connect(token, user).transfer(nonRestrictionAccount.address, 80))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_FROZEN_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to restriction account - test 100 - fail - Restricted balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToAnyIdBalance: 50,
          frozenBalance: 50
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token.freeze(user.address, 50));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 50, ANY_ID));
        await expect(connect(token, user).transfer(restrictionAccount.address, 100))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_FROZEN_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account - test 100 - fail - Frozen balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToAnyIdBalance: 50,
          frozenBalance: 50
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token.freeze(user.address, 50));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 50, ANY_ID));
        await expect(connect(token, user).transfer(nonRestrictionAccount.address, 100))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_FROZEN_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to restriction account - test 120 - fail - ERC20 balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToAnyIdBalance: 50,
          frozenBalance: 50
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token.freeze(user.address, 50));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 50, ANY_ID));
        await expect(connect(token, user).transfer(restrictionAccount.address, 120))
          .to.be.revertedWith(REVERT_MESSAGE_ERC20_TRANSFER_AMOUNT_EXCEEDS_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account - test 120 - fail - ERC20 balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToAnyIdBalance: 50,
          frozenBalance: 50
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token.freeze(user.address, 50));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 50, ANY_ID));
        await expect(connect(token, user).transfer(nonRestrictionAccount.address, 120))
          .to.be.revertedWith(REVERT_MESSAGE_ERC20_TRANSFER_AMOUNT_EXCEEDS_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });
    });

    describe("Function 'transferFrozen()'", async () => {
      it("Transfer to restriction account - test 20 - success", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToAnyIdBalance: 50,
          frozenBalance: 50
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token.freeze(user.address, 50));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 50, ANY_ID));
        await expect(token.transferFrozen(user.address, restrictionAccount.address, 20))
          .to.changeTokenBalances(
            token,
            [user, restrictionAccount],
            [-20, 20]
          );

        expectedBalance.total -= 20;
        expectedBalance.frozen -= 20;

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account - test 20 - success", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToAnyIdBalance: 50,
          frozenBalance: 50
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token.freeze(user.address, 50));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 50, ANY_ID));
        await expect(token.transferFrozen(user.address, nonRestrictionAccount.address, 20))
          .to.changeTokenBalances(
            token,
            [user, nonRestrictionAccount],
            [-20, 20]
          );

        expectedBalance.total -= 20;
        expectedBalance.frozen -= 20;

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to restriction account - test 40 - success", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToAnyIdBalance: 50,
          frozenBalance: 50
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token.freeze(user.address, 50));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 50, ANY_ID));
        await expect(token.transferFrozen(user.address, restrictionAccount.address, 40))
          .to.changeTokenBalances(
            token,
            [user, restrictionAccount],
            [-40, 40]
          );

        expectedBalance.total -= 40;
        expectedBalance.frozen -= 40;

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account - test 40 - success", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToAnyIdBalance: 50,
          frozenBalance: 50
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token.freeze(user.address, 50));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 50, ANY_ID));
        await expect(token.transferFrozen(user.address, nonRestrictionAccount.address, 40))
          .to.changeTokenBalances(
            token,
            [user, nonRestrictionAccount],
            [-40, 40]
          );

        expectedBalance.total -= 40;
        expectedBalance.frozen -= 40;

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to restriction account - test 60 - fail - Lack of frozen balance", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToAnyIdBalance: 50,
          frozenBalance: 50
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token.freeze(user.address, 50));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 50, ANY_ID));
        await expect(token.transferFrozen(user.address, restrictionAccount.address, 60))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_LACK_OF_FROZEN_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account - test 60 - fail - Lack of frozen balance", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToAnyIdBalance: 50,
          frozenBalance: 50
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token.freeze(user.address, 50));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 50, ANY_ID));
        await expect(token.transferFrozen(user.address, nonRestrictionAccount.address, 60))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_LACK_OF_FROZEN_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to restriction account - test 80 - fail - Lack of frozen balance", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToAnyIdBalance: 50,
          frozenBalance: 50
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token.freeze(user.address, 50));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 50, ANY_ID));
        await expect(token.transferFrozen(user.address, restrictionAccount.address, 80))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_LACK_OF_FROZEN_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account - test 80 - fail - Lack of frozen balance", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToAnyIdBalance: 50,
          frozenBalance: 50
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token.freeze(user.address, 50));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 50, ANY_ID));
        await expect(token.transferFrozen(user.address, nonRestrictionAccount.address, 80))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_LACK_OF_FROZEN_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to restriction account - test 100 - fail - Lack of frozen balance", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToAnyIdBalance: 50,
          frozenBalance: 50
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token.freeze(user.address, 50));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 50, ANY_ID));
        await expect(token.transferFrozen(user.address, restrictionAccount.address, 100))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_LACK_OF_FROZEN_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account - test 100 - fail - Lack of frozen balance", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToAnyIdBalance: 50,
          frozenBalance: 50
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token.freeze(user.address, 50));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 50, ANY_ID));
        await expect(token.transferFrozen(user.address, nonRestrictionAccount.address, 100))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_LACK_OF_FROZEN_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to restriction account - test 120 - fail - Lack of frozen balance", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToAnyIdBalance: 50,
          frozenBalance: 50
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token.freeze(user.address, 50));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 50, ANY_ID));
        await expect(token.transferFrozen(user.address, restrictionAccount.address, 120))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_LACK_OF_FROZEN_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account - test 120 - fail - Lack of frozen balance", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToAnyIdBalance: 50,
          frozenBalance: 50
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token.freeze(user.address, 50));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 50, ANY_ID));
        await expect(token.transferFrozen(user.address, nonRestrictionAccount.address, 120))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_LACK_OF_FROZEN_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });
    });

    describe("Function 'transferWithId()'", async () => {
      it("Transfer to restriction account - test 20 - success", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToAnyIdBalance: 50,
          frozenBalance: 50
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token.freeze(user.address, 50));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 50, ANY_ID));
        await expect(token.transferWithId(user.address, restrictionAccount.address, 20, ID))
          .to.changeTokenBalances(
            token,
            [user, restrictionAccount],
            [-20, 20]
          );

        expectedBalance.total -= 20;
        expectedBalance.restricted -= 20;

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account - test 20 - fail - Restricted balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToAnyIdBalance: 50,
          frozenBalance: 50
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token.freeze(user.address, 50));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 50, ANY_ID));
        await expect(token.transferWithId(user.address, nonRestrictionAccount.address, 20, ID))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_RESTRICTED_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to restriction account - test 40 - success", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToAnyIdBalance: 50,
          frozenBalance: 50
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token.freeze(user.address, 50));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 50, ANY_ID));
        await expect(token.transferWithId(user.address, restrictionAccount.address, 40, ID))
          .to.changeTokenBalances(
            token,
            [user, restrictionAccount],
            [-40, 40]
          );

        expectedBalance.total -= 40;
        expectedBalance.restricted -= 40;

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account - test 40 - fail - Restricted balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToAnyIdBalance: 50,
          frozenBalance: 50
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token.freeze(user.address, 50));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 50, ANY_ID));
        await expect(token.transferWithId(user.address, nonRestrictionAccount.address, 40, ID))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_RESTRICTED_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to restriction account - test 40 - fail - Frozen balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToAnyIdBalance: 50,
          frozenBalance: 50
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token.freeze(user.address, 50));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 50, ANY_ID));
        await expect(token.transferWithId(user.address, restrictionAccount.address, 60, ID))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_FROZEN_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account - test 60 - fail - Frozen balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToAnyIdBalance: 50,
          frozenBalance: 50
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token.freeze(user.address, 50));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 50, ANY_ID));
        await expect(token.transferWithId(user.address, nonRestrictionAccount.address, 60, ID))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_FROZEN_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to restriction account - test 80 - fail - Frozen balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToAnyIdBalance: 50,
          frozenBalance: 50
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token.freeze(user.address, 50));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 50, ANY_ID));
        await expect(token.transferWithId(user.address, restrictionAccount.address, 80, ID))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_FROZEN_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account - test 80 - fail - Frozen balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToAnyIdBalance: 50,
          frozenBalance: 50
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token.freeze(user.address, 50));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 50, ANY_ID));
        await expect(token.transferWithId(user.address, nonRestrictionAccount.address, 80, ID))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_FROZEN_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to restriction account - test 100 - fail - Frozen balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToAnyIdBalance: 50,
          frozenBalance: 50
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token.freeze(user.address, 50));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 50, ANY_ID));
        await expect(token.transferWithId(user.address, restrictionAccount.address, 100, ID))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_FROZEN_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account - test 100 - fail - Frozen balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToAnyIdBalance: 50,
          frozenBalance: 50
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token.freeze(user.address, 50));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 50, ANY_ID));
        await expect(token.transferWithId(user.address, nonRestrictionAccount.address, 100, ID))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_FROZEN_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to restriction account - test 120 - fail - ERC20 balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToAnyIdBalance: 50,
          frozenBalance: 50
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token.freeze(user.address, 50));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 50, ANY_ID));
        await expect(token.transferWithId(user.address, restrictionAccount.address, 120, ID))
          .to.be.revertedWith(REVERT_MESSAGE_ERC20_TRANSFER_AMOUNT_EXCEEDS_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account - test 120 - fail - ERC20 balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToAnyIdBalance: 50,
          frozenBalance: 50
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token.freeze(user.address, 50));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 50, ANY_ID));
        await expect(token.transferWithId(user.address, nonRestrictionAccount.address, 120, ID))
          .to.be.revertedWith(REVERT_MESSAGE_ERC20_TRANSFER_AMOUNT_EXCEEDS_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });
    });
  });

  describe("Frozen and preminted balances", async () => {
    let timestamp: number;
    before(async () => {
      timestamp = (await getLatestBlockTimestamp()) + 100;
    });
    describe("Function 'transfer()'", async () => {
      it("Transfer without release awaiting - test 20 - fail - Frozen balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          premintedBalance: 50,
          frozenBalance: 50
        });
        await proveTx(token.mint(user.address, 50));
        await proveTx(token.premintIncrease(user.address, 50, timestamp));
        await proveTx(token.freeze(user.address, 50));
        await expect(connect(token, user).transfer(restrictionAccount.address, 20))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_FROZEN_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer with release awaiting - test 20 - success", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          premintedBalance: 50,
          frozenBalance: 50
        });

        await proveTx(token.mint(user.address, 50));
        await proveTx(token.premintIncrease(user.address, 50, timestamp));
        await proveTx(token.freeze(user.address, 50));
        await increaseBlockTimestampTo(timestamp);
        expectedBalance.premint -= 50;
        expectedBalance.free += 50;
        await expect(connect(token, user).transfer(restrictionAccount.address, 20))
          .to.changeTokenBalances(
            token,
            [user, restrictionAccount],
            [-20, 20]
          );

        expectedBalance.total -= 20;
        expectedBalance.free -= 20;

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer without release awaiting - test 40 - fail - Frozen balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          premintedBalance: 50,
          frozenBalance: 50
        });

        await proveTx(token.mint(user.address, 50));
        await proveTx(token.premintIncrease(user.address, 50, timestamp));
        await proveTx(token.freeze(user.address, 50));
        await expect(connect(token, user).transfer(restrictionAccount.address, 40))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_FROZEN_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer with release awaiting - test 40 - success", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          premintedBalance: 50,
          frozenBalance: 50
        });

        await proveTx(token.mint(user.address, 50));
        await proveTx(token.premintIncrease(user.address, 50, timestamp));
        await proveTx(token.freeze(user.address, 50));
        await increaseBlockTimestampTo(timestamp);
        expectedBalance.premint -= 50;
        expectedBalance.free += 50;
        await expect(connect(token, user).transfer(restrictionAccount.address, 40))
          .to.changeTokenBalances(
            token,
            [user, restrictionAccount],
            [-40, 40]
          );

        expectedBalance.total -= 40;
        expectedBalance.free -= 40;

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer without release awaiting - test 60 - fail - Preminted balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          premintedBalance: 50,
          frozenBalance: 50
        });

        await proveTx(token.mint(user.address, 50));
        await proveTx(token.premintIncrease(user.address, 50, timestamp));
        await proveTx(token.freeze(user.address, 50));
        await expect(connect(token, user).transfer(restrictionAccount.address, 60))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_PREMINT_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer with release awaiting - test 60 - fail - Frozen balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          premintedBalance: 50,
          frozenBalance: 50
        });

        await proveTx(token.mint(user.address, 50));
        await proveTx(token.premintIncrease(user.address, 50, timestamp));
        await proveTx(token.freeze(user.address, 50));
        await increaseBlockTimestampTo(timestamp);
        expectedBalance.premint -= 50;
        expectedBalance.free += 50;
        await expect(connect(token, user).transfer(restrictionAccount.address, 60))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_FROZEN_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer without release awaiting - test 80 - fail - Preminted balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          premintedBalance: 50,
          frozenBalance: 50
        });

        await proveTx(token.mint(user.address, 50));
        await proveTx(token.premintIncrease(user.address, 50, timestamp));
        await proveTx(token.freeze(user.address, 50));
        await expect(connect(token, user).transfer(restrictionAccount.address, 80))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_PREMINT_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer with release awaiting - test 80 - fail - Frozen balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          premintedBalance: 50,
          frozenBalance: 50
        });

        await proveTx(token.mint(user.address, 50));
        await proveTx(token.premintIncrease(user.address, 50, timestamp));
        await proveTx(token.freeze(user.address, 50));
        await increaseBlockTimestampTo(timestamp);
        expectedBalance.premint -= 50;
        expectedBalance.free += 50;
        await expect(connect(token, user).transfer(restrictionAccount.address, 80))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_FROZEN_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer without release awaiting - test 100 - fail - Preminted balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          premintedBalance: 50,
          frozenBalance: 50
        });

        await proveTx(token.mint(user.address, 50));
        await proveTx(token.premintIncrease(user.address, 50, timestamp));
        await proveTx(token.freeze(user.address, 50));
        await expect(connect(token, user).transfer(restrictionAccount.address, 100))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_PREMINT_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer with release awaiting - test 100 - fail - Frozen balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          premintedBalance: 50,
          frozenBalance: 50
        });

        await proveTx(token.mint(user.address, 50));
        await proveTx(token.premintIncrease(user.address, 50, timestamp));
        await proveTx(token.freeze(user.address, 50));
        await increaseBlockTimestampTo(timestamp);
        expectedBalance.premint -= 50;
        expectedBalance.free += 50;
        await expect(connect(token, user).transfer(restrictionAccount.address, 100))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_FROZEN_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer without release awaiting - test 120 - fail - ERC20 balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          premintedBalance: 50,
          frozenBalance: 50
        });

        await proveTx(token.mint(user.address, 50));
        await proveTx(token.premintIncrease(user.address, 50, timestamp));
        await proveTx(token.freeze(user.address, 50));
        await expect(connect(token, user).transfer(restrictionAccount.address, 120))
          .to.be.revertedWith(REVERT_MESSAGE_ERC20_TRANSFER_AMOUNT_EXCEEDS_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer with release awaiting - test 120 - fail - ERC20 balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          premintedBalance: 50,
          frozenBalance: 50
        });

        await proveTx(token.mint(user.address, 50));
        await proveTx(token.premintIncrease(user.address, 50, timestamp));
        await proveTx(token.freeze(user.address, 50));
        await increaseBlockTimestampTo(timestamp);
        expectedBalance.premint -= 50;
        expectedBalance.free += 50;
        await expect(connect(token, user).transfer(restrictionAccount.address, 120))
          .to.be.revertedWith(REVERT_MESSAGE_ERC20_TRANSFER_AMOUNT_EXCEEDS_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });
    });

    describe("Function 'transferFrozen()'", async () => {
      it("Transfer without release awaiting - test 20 - success", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          premintedBalance: 50,
          frozenBalance: 50
        });

        await proveTx(token.mint(user.address, 50));
        await proveTx(token.premintIncrease(user.address, 50, timestamp));
        await proveTx(token.freeze(user.address, 50));
        await expect(token.transferFrozen(user.address, restrictionAccount.address, 20))
          .to.changeTokenBalances(
            token,
            [user, restrictionAccount],
            [-20, 20]
          );

        expectedBalance.total -= 20;
        expectedBalance.frozen -= 20;

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer with release awaiting - test 20 - success", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          premintedBalance: 50,
          frozenBalance: 50
        });

        await proveTx(token.mint(user.address, 50));
        await proveTx(token.premintIncrease(user.address, 50, timestamp));
        await proveTx(token.freeze(user.address, 50));
        await increaseBlockTimestampTo(timestamp);
        expectedBalance.premint -= 50;
        expectedBalance.free += 50;
        await expect(token.transferFrozen(user.address, restrictionAccount.address, 20))
          .to.changeTokenBalances(
            token,
            [user, restrictionAccount],
            [-20, 20]
          );

        expectedBalance.total -= 20;
        expectedBalance.frozen -= 20;

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer without release awaiting - test 40 - success", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          premintedBalance: 50,
          frozenBalance: 50
        });

        await proveTx(token.mint(user.address, 50));
        await proveTx(token.premintIncrease(user.address, 50, timestamp));
        await proveTx(token.freeze(user.address, 50));
        await expect(token.transferFrozen(user.address, restrictionAccount.address, 40))
          .to.changeTokenBalances(
            token,
            [user, restrictionAccount],
            [-40, 40]
          );

        expectedBalance.total -= 40;
        expectedBalance.frozen -= 40;

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer with release awaiting - test 40 - success", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          premintedBalance: 50,
          frozenBalance: 50
        });

        await proveTx(token.mint(user.address, 50));
        await proveTx(token.premintIncrease(user.address, 50, timestamp));
        await proveTx(token.freeze(user.address, 50));
        await increaseBlockTimestampTo(timestamp);
        expectedBalance.premint -= 50;
        expectedBalance.free += 50;
        await expect(token.transferFrozen(user.address, restrictionAccount.address, 40))
          .to.changeTokenBalances(
            token,
            [user, restrictionAccount],
            [-40, 40]
          );

        expectedBalance.total -= 40;
        expectedBalance.frozen -= 40;

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer without release awaiting - test 60 - fail - Lack of frozen balance", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          premintedBalance: 50,
          frozenBalance: 50
        });

        await proveTx(token.mint(user.address, 50));
        await proveTx(token.premintIncrease(user.address, 50, timestamp));
        await proveTx(token.freeze(user.address, 50));
        await expect(token.transferFrozen(user.address, restrictionAccount.address, 60))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_LACK_OF_FROZEN_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer with release awaiting - test 60 - fail - Lack of frozen balance", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          premintedBalance: 50,
          frozenBalance: 50
        });

        await proveTx(token.mint(user.address, 50));
        await proveTx(token.premintIncrease(user.address, 50, timestamp));
        await proveTx(token.freeze(user.address, 50));
        await increaseBlockTimestampTo(timestamp);
        expectedBalance.premint -= 50;
        expectedBalance.free += 50;
        await expect(token.transferFrozen(user.address, restrictionAccount.address, 60))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_LACK_OF_FROZEN_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer without release awaiting - test 80 - fail - Lack of frozen balance", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          premintedBalance: 50,
          frozenBalance: 50
        });

        await proveTx(token.mint(user.address, 50));
        await proveTx(token.premintIncrease(user.address, 50, timestamp));
        await proveTx(token.freeze(user.address, 50));
        await expect(token.transferFrozen(user.address, restrictionAccount.address, 80))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_LACK_OF_FROZEN_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer with release awaiting - test 80 - fail - Lack of frozen balance", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          premintedBalance: 50,
          frozenBalance: 50
        });

        await proveTx(token.mint(user.address, 50));
        await proveTx(token.premintIncrease(user.address, 50, timestamp));
        await proveTx(token.freeze(user.address, 50));
        await increaseBlockTimestampTo(timestamp);
        expectedBalance.premint -= 50;
        expectedBalance.free += 50;
        await expect(token.transferFrozen(user.address, restrictionAccount.address, 80))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_LACK_OF_FROZEN_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer without release awaiting - test 100 - fail - Lack of frozen balance", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          premintedBalance: 50,
          frozenBalance: 50
        });

        await proveTx(token.mint(user.address, 50));
        await proveTx(token.premintIncrease(user.address, 50, timestamp));
        await proveTx(token.freeze(user.address, 50));
        await expect(token.transferFrozen(user.address, restrictionAccount.address, 100))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_LACK_OF_FROZEN_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer with release awaiting - test 100 - fail - Lack of frozen balance", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          premintedBalance: 50,
          frozenBalance: 50
        });

        await proveTx(token.mint(user.address, 50));
        await proveTx(token.premintIncrease(user.address, 50, timestamp));
        await proveTx(token.freeze(user.address, 50));
        await increaseBlockTimestampTo(timestamp);
        expectedBalance.premint -= 50;
        expectedBalance.free += 50;
        await expect(token.transferFrozen(user.address, restrictionAccount.address, 100))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_LACK_OF_FROZEN_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer without release awaiting - test 120 - fail - Lack of frozen balance", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          premintedBalance: 50,
          frozenBalance: 50
        });

        await proveTx(token.mint(user.address, 50));
        await proveTx(token.premintIncrease(user.address, 50, timestamp));
        await proveTx(token.freeze(user.address, 50));
        await expect(token.transferFrozen(user.address, restrictionAccount.address, 120))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_LACK_OF_FROZEN_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer with release awaiting - test 120 - fail - Lack of frozen balance", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          premintedBalance: 50,
          frozenBalance: 50
        });

        await proveTx(token.mint(user.address, 50));
        await proveTx(token.premintIncrease(user.address, 50, timestamp));
        await proveTx(token.freeze(user.address, 50));
        await increaseBlockTimestampTo(timestamp);
        expectedBalance.premint -= 50;
        expectedBalance.free += 50;
        await expect(token.transferFrozen(user.address, restrictionAccount.address, 120))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_LACK_OF_FROZEN_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });
    });

    describe("Function 'transferWithId()'", async () => {
      it("Transfer without release awaiting - test 20 - fail - Frozen balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          premintedBalance: 50,
          frozenBalance: 50
        });

        await proveTx(token.mint(user.address, 50));
        await proveTx(token.premintIncrease(user.address, 50, timestamp));
        await proveTx(token.freeze(user.address, 50));
        await expect(token.transferWithId(user.address, restrictionAccount.address, 20, ID))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_FROZEN_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer with release awaiting - test 20 - success", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          premintedBalance: 50,
          frozenBalance: 50
        });

        await proveTx(token.mint(user.address, 50));
        await proveTx(token.premintIncrease(user.address, 50, timestamp));
        await proveTx(token.freeze(user.address, 50));
        await increaseBlockTimestampTo(timestamp);
        expectedBalance.premint -= 50;
        expectedBalance.free += 50;
        await expect(token.transferWithId(user.address, restrictionAccount.address, 20, ID))
          .to.changeTokenBalances(
            token,
            [user, restrictionAccount],
            [-20, 20]
          );

        expectedBalance.total -= 20;
        expectedBalance.free -= 20;

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer without release awaiting - test 40 - fail - Frozen balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          premintedBalance: 50,
          frozenBalance: 50
        });

        await proveTx(token.mint(user.address, 50));
        await proveTx(token.premintIncrease(user.address, 50, timestamp));
        await proveTx(token.freeze(user.address, 50));
        await expect(token.transferWithId(user.address, restrictionAccount.address, 40, ID))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_FROZEN_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer with release awaiting - test 40 - success", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          premintedBalance: 50,
          frozenBalance: 50
        });

        await proveTx(token.mint(user.address, 50));
        await proveTx(token.premintIncrease(user.address, 50, timestamp));
        await proveTx(token.freeze(user.address, 50));
        await increaseBlockTimestampTo(timestamp);
        expectedBalance.premint -= 50;
        expectedBalance.free += 50;
        await expect(token.transferWithId(user.address, restrictionAccount.address, 40, ID))
          .to.changeTokenBalances(
            token,
            [user, restrictionAccount],
            [-40, 40]
          );

        expectedBalance.total -= 40;
        expectedBalance.free -= 40;

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer without release awaiting - test 60 - fail - Preminted balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          premintedBalance: 50,
          frozenBalance: 50
        });

        await proveTx(token.mint(user.address, 50));
        await proveTx(token.premintIncrease(user.address, 50, timestamp));
        await proveTx(token.freeze(user.address, 50));
        await expect(token.transferWithId(user.address, restrictionAccount.address, 60, ID))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_PREMINT_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer with release awaiting - test 60 - fail - Frozen balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          premintedBalance: 50,
          frozenBalance: 50
        });

        await proveTx(token.mint(user.address, 50));
        await proveTx(token.premintIncrease(user.address, 50, timestamp));
        await proveTx(token.freeze(user.address, 50));
        await increaseBlockTimestampTo(timestamp);
        expectedBalance.premint -= 50;
        expectedBalance.free += 50;
        await expect(token.transferWithId(user.address, restrictionAccount.address, 60, ID))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_FROZEN_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer without release awaiting - test 80 - fail - Preminted balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          premintedBalance: 50,
          frozenBalance: 50
        });

        await proveTx(token.mint(user.address, 50));
        await proveTx(token.premintIncrease(user.address, 50, timestamp));
        await proveTx(token.freeze(user.address, 50));
        await expect(token.transferWithId(user.address, restrictionAccount.address, 80, ID))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_PREMINT_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer with release awaiting - test 80 - fail - Frozen balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          premintedBalance: 50,
          frozenBalance: 50
        });

        await proveTx(token.mint(user.address, 50));
        await proveTx(token.premintIncrease(user.address, 50, timestamp));
        await proveTx(token.freeze(user.address, 50));
        await increaseBlockTimestampTo(timestamp);
        expectedBalance.premint -= 50;
        expectedBalance.free += 50;
        await expect(token.transferWithId(user.address, restrictionAccount.address, 80, ID))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_FROZEN_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer without release awaiting - test 100 - fail - Preminted balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          premintedBalance: 50,
          frozenBalance: 50
        });

        await proveTx(token.mint(user.address, 50));
        await proveTx(token.premintIncrease(user.address, 50, timestamp));
        await proveTx(token.freeze(user.address, 50));
        await expect(token.transferWithId(user.address, restrictionAccount.address, 100, ID))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_PREMINT_AMOUNT)

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer with release awaiting - test 100 - fail - Frozen balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          premintedBalance: 50,
          frozenBalance: 50
        });

        await proveTx(token.mint(user.address, 50));
        await proveTx(token.premintIncrease(user.address, 50, timestamp));
        await proveTx(token.freeze(user.address, 50));
        await increaseBlockTimestampTo(timestamp);
        expectedBalance.premint -= 50;
        expectedBalance.free += 50;
        await expect(token.transferWithId(user.address, restrictionAccount.address, 100, ID))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_FROZEN_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer without release awaiting - test 120 - fail - ERC20 balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          premintedBalance: 50,
          frozenBalance: 50
        });

        await proveTx(token.mint(user.address, 50));
        await proveTx(token.premintIncrease(user.address, 50, timestamp));
        await proveTx(token.freeze(user.address, 50));
        await expect(token.transferWithId(user.address, restrictionAccount.address, 120, ID))
          .to.be.revertedWith(REVERT_MESSAGE_ERC20_TRANSFER_AMOUNT_EXCEEDS_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer with release awaiting - test 120 - fail - ERC20 balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          premintedBalance: 50,
          frozenBalance: 50
        });

        await proveTx(token.mint(user.address, 50));
        await proveTx(token.premintIncrease(user.address, 50, timestamp));
        await proveTx(token.freeze(user.address, 50));
        await increaseBlockTimestampTo(timestamp);
        expectedBalance.premint -= 50;
        expectedBalance.free += 50;
        await expect(token.transferWithId(user.address, restrictionAccount.address, 120, ID))
          .to.be.revertedWith(REVERT_MESSAGE_ERC20_TRANSFER_AMOUNT_EXCEEDS_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });
    });
  });

  describe("Over frozen balance", async () => {
    describe("Function 'transfer()'", async () => {
      it("Transfer - test 20 - fail - Frozen balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 200
        });
        await proveTx(token.mint(user.address, 100));
        await proveTx(token.freeze(user.address, 200));
        await expect(connect(token, user).transfer(restrictionAccount.address, 20))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_FROZEN_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer - test 40 - fail - Frozen balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 200
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token.freeze(user.address, 200));
        await expect(connect(token, user).transfer(restrictionAccount.address, 40))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_FROZEN_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer - test 60 - fail - Frozen balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 200
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token.freeze(user.address, 200));
        await expect(connect(token, user).transfer(restrictionAccount.address, 60))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_FROZEN_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer - test 80 - fail - Frozen balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 200
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token.freeze(user.address, 200));
        await expect(connect(token, user).transfer(restrictionAccount.address, 80))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_FROZEN_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer - test 100 - fail - Frozen balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 200
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token.freeze(user.address, 200));
        await expect(connect(token, user).transfer(restrictionAccount.address, 100))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_FROZEN_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer - test 120 - fail - ERC20 balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 200
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token.freeze(user.address, 200));
        await expect(connect(token, user).transfer(restrictionAccount.address, 120))
          .to.be.revertedWith(REVERT_MESSAGE_ERC20_TRANSFER_AMOUNT_EXCEEDS_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });
    });

    describe("Function 'transferFrozen'", async () => {
      it("Transfer - test 20 - success", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 200
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token.freeze(user.address, 200));
        await expect(token.transferFrozen(user.address, restrictionAccount.address, 20))
          .to.changeTokenBalances(
            token,
            [user, restrictionAccount],
            [-20, 20]
          );

        expectedBalance.total -= 20;
        expectedBalance.frozen -= 20;

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer - test 40 - success", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 200
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token.freeze(user.address, 200));
        await expect(token.transferFrozen(user.address, restrictionAccount.address, 40))
          .to.changeTokenBalances(
            token,
            [user, restrictionAccount],
            [-40, 40]
          );

        expectedBalance.total -= 40;
        expectedBalance.frozen -= 40;

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer - test 60 - success", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 200
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token.freeze(user.address, 200));
        await expect(token.transferFrozen(user.address, restrictionAccount.address, 60))
          .to.changeTokenBalances(
            token,
            [user, restrictionAccount],
            [-60, 60]
          );

        expectedBalance.total -= 60;
        expectedBalance.frozen -= 60;

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer - test 80 - success", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 200
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token.freeze(user.address, 200));
        await expect(token.transferFrozen(user.address, restrictionAccount.address, 80))
          .to.changeTokenBalances(
            token,
            [user, restrictionAccount],
            [-80, 80]
          );

        expectedBalance.total -= 80;
        expectedBalance.frozen -= 80;

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer - test 100 - success", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 200
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token.freeze(user.address, 200));
        await expect(token.transferFrozen(user.address, restrictionAccount.address, 100))
          .to.changeTokenBalances(
            token,
            [user, restrictionAccount],
            [-100, 100]
          );

        expectedBalance.total -= 100;
        expectedBalance.frozen -= 100;

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer - test 120 - fail - ERC20 balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 200
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token.freeze(user.address, 200));
        await expect(token.transferFrozen(user.address, restrictionAccount.address, 120))
          .to.be.revertedWith(REVERT_MESSAGE_ERC20_TRANSFER_AMOUNT_EXCEEDS_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });
    });

    describe("Function 'transferWithId'", async () => {
      it("Transfer - test 20 - fail - Frozen balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 200
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token.freeze(user.address, 200));
        await expect(token.transferWithId(user.address, restrictionAccount.address, 20, ID))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_FROZEN_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer - test 40 - fail - Frozen balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 200
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token.freeze(user.address, 200));
        await expect(token.transferWithId(user.address, restrictionAccount.address, 40, ID))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_FROZEN_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer - test 60 - fail - Frozen balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 200
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token.freeze(user.address, 200));
        await expect(token.transferWithId(user.address, restrictionAccount.address, 60, ID))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_FROZEN_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer - test 80 - fail - Frozen balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 200
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token.freeze(user.address, 200));
        await expect(token.transferWithId(user.address, restrictionAccount.address, 80, ID))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_FROZEN_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer - test 100 - fail - Frozen balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 200
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token.freeze(user.address, 200));
        await expect(token.transferWithId(user.address, restrictionAccount.address, 100, ID))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_FROZEN_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer - test 120 - fail - ERC20 balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 200
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token.freeze(user.address, 200));
        await expect(token.transferWithId(user.address, restrictionAccount.address, 120, ID))
          .to.be.revertedWith(REVERT_MESSAGE_ERC20_TRANSFER_AMOUNT_EXCEEDS_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });
    });
  });

  describe("Over restricted balance", async () => {
    describe("Function 'transfer()'", async () => {
      it("Transfer to restriction account - test 20 - fail - Restricted balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToAnyIdBalance: 200
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 200, ANY_ID));
        await expect(connect(token, user).transfer(restrictionAccount.address, 20))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_RESTRICTED_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account - test 20 - fail - Restricted balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToAnyIdBalance: 200
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 200, ANY_ID));
        await expect(connect(token, user).transfer(nonRestrictionAccount.address, 20))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_RESTRICTED_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to restriction account - test 40 - fail - Restricted balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToAnyIdBalance: 200
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 200, ANY_ID));
        await expect(connect(token, user).transfer(restrictionAccount.address, 40))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_RESTRICTED_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account - test 40 - fail - Restricted balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToAnyIdBalance: 200
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 200, ANY_ID));
        await expect(connect(token, user).transfer(nonRestrictionAccount.address, 40))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_RESTRICTED_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to restriction account - test 60 - fail - Restricted balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToAnyIdBalance: 200
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 200, ANY_ID));
        await expect(connect(token, user).transfer(restrictionAccount.address, 60))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_RESTRICTED_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account - test 60 - fail - Restricted balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToAnyIdBalance: 200
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 200, ANY_ID));
        await expect(connect(token, user).transfer(nonRestrictionAccount.address, 60))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_RESTRICTED_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to restriction account - test 80 - fail - Restricted balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToAnyIdBalance: 200
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 200, ANY_ID));
        await expect(connect(token, user).transfer(restrictionAccount.address, 80))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_RESTRICTED_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account - test 80 - fail - Restricted balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToAnyIdBalance: 200
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 200, ANY_ID));
        await expect(connect(token, user).transfer(nonRestrictionAccount.address, 80))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_RESTRICTED_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to restriction account - test 100 - fail - Restricted balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToAnyIdBalance: 200
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 200, ANY_ID));
        await expect(connect(token, user).transfer(restrictionAccount.address, 100))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_RESTRICTED_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account - test 100 - fail - Restricted balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToAnyIdBalance: 200
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 200, ANY_ID));
        await expect(connect(token, user).transfer(nonRestrictionAccount.address, 100))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_RESTRICTED_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to restriction account - test 120 - fail - ERC20 balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToAnyIdBalance: 200
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 200, ANY_ID));
        await expect(connect(token, user).transfer(restrictionAccount.address, 120))
          .to.be.revertedWith(REVERT_MESSAGE_ERC20_TRANSFER_AMOUNT_EXCEEDS_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account - test 120 - fail - ERC20 balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToAnyIdBalance: 200
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 200, ANY_ID));
        await expect(connect(token, user).transfer(nonRestrictionAccount.address, 120))
          .to.be.revertedWith(REVERT_MESSAGE_ERC20_TRANSFER_AMOUNT_EXCEEDS_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });
    });

    describe("Function 'transferFrozen()'", async () => {
      it("Transfer to restriction account - test 20 - fail - Lack of frozen balance", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToAnyIdBalance: 200
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 200, ANY_ID));
        await expect(token.transferFrozen(user.address, restrictionAccount.address, 20))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_LACK_OF_FROZEN_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account - test 20 - fail - Lack of frozen balance", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToAnyIdBalance: 200
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 200, ANY_ID));
        await expect(token.transferFrozen(user.address, nonRestrictionAccount.address, 20))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_LACK_OF_FROZEN_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to restriction account - test 40 - fail - Lack of frozen balance", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToAnyIdBalance: 200
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 200, ANY_ID));
        await expect(token.transferFrozen(user.address, restrictionAccount.address, 40))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_LACK_OF_FROZEN_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account - test 40 - fail - Lack of frozen balance", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToAnyIdBalance: 200
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 200, ANY_ID));
        await expect(token.transferFrozen(user.address, nonRestrictionAccount.address, 40))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_LACK_OF_FROZEN_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to restriction account - test 60 - fail - Lack of frozen balance", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToAnyIdBalance: 200
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 200, ANY_ID));
        await expect(token.transferFrozen(user.address, restrictionAccount.address, 60))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_LACK_OF_FROZEN_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account - test 60 - fail - Lack of frozen balance", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToAnyIdBalance: 200
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 200, ANY_ID));
        await expect(token.transferFrozen(user.address, nonRestrictionAccount.address, 60))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_LACK_OF_FROZEN_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to restriction account - test 80 - fail - Lack of frozen balance", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToAnyIdBalance: 200
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 200, ANY_ID));
        await expect(token.transferFrozen(user.address, restrictionAccount.address, 80))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_LACK_OF_FROZEN_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account - test 80 - fail - Lack of frozen balance", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToAnyIdBalance: 200
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 200, ANY_ID));
        await expect(token.transferFrozen(user.address, nonRestrictionAccount.address, 80))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_LACK_OF_FROZEN_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to restriction account - test 100 - fail - Lack of frozen balance", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToAnyIdBalance: 200
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 200, ANY_ID));
        await expect(token.transferFrozen(user.address, restrictionAccount.address, 100))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_LACK_OF_FROZEN_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account - test 100 - fail - Lack of frozen balance", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToAnyIdBalance: 200
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 200, ANY_ID));
        await expect(token.transferFrozen(user.address, nonRestrictionAccount.address, 100))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_LACK_OF_FROZEN_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to restriction account - test 120 - fail - Lack of frozen balance", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToAnyIdBalance: 200
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 200, ANY_ID));
        await expect(token.transferFrozen(user.address, restrictionAccount.address, 120))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_LACK_OF_FROZEN_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account - test 120 - fail - Lack of frozen balance", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToAnyIdBalance: 200
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 200, ANY_ID));
        await expect(token.transferFrozen(user.address, nonRestrictionAccount.address, 120))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_LACK_OF_FROZEN_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });
    });

    describe("Function 'transferWithId()'", async () => {
      it("Transfer to restriction account - test 20 - success", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToAnyIdBalance: 200
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 200, ID));
        await expect(token.transferWithId(user.address, restrictionAccount.address, 20, ID))
          .to.changeTokenBalances(
            token,
            [user, restrictionAccount],
            [-20, 20]
          );

        expectedBalance.total -= 20;
        expectedBalance.restricted -= 20;

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account - test 20 - fail - Restricted balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToAnyIdBalance: 200
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 200, ANY_ID));
        await expect(token.transferWithId(user.address, nonRestrictionAccount.address, 20, ID))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_RESTRICTED_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to restriction account - test 40 - success", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToAnyIdBalance: 200
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 200, ID));
        await expect(token.transferWithId(user.address, restrictionAccount.address, 40, ID))
          .to.changeTokenBalances(
            token,
            [user, restrictionAccount],
            [-40, 40]
          );

        expectedBalance.total -= 40;
        expectedBalance.restricted -= 40;

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account - test 40 - fail - Restricted balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToAnyIdBalance: 200
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 200, ANY_ID));
        await expect(token.transferWithId(user.address, nonRestrictionAccount.address, 40, ID))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_RESTRICTED_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to restriction account - test 60 - success", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToAnyIdBalance: 200
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 200, ID));
        await expect(token.transferWithId(user.address, restrictionAccount.address, 60, ID))
          .to.changeTokenBalances(
            token,
            [user, restrictionAccount],
            [-60, 60]
          );

        expectedBalance.total -= 60;
        expectedBalance.restricted -= 60;

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account - test 60 - fail - Restricted balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToAnyIdBalance: 200
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 200, ANY_ID));
        await expect(token.transferWithId(user.address, nonRestrictionAccount.address, 60, ID))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_RESTRICTED_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to restriction account - test 80 - success", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToAnyIdBalance: 200
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 200, ID));
        await expect(token.transferWithId(user.address, restrictionAccount.address, 80, ID))
          .to.changeTokenBalances(
            token,
            [user, restrictionAccount],
            [-80, 80]
          );

        expectedBalance.total -= 80;
        expectedBalance.restricted -= 80;

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account - test 80 - fail - Restricted balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToAnyIdBalance: 200
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 200, ANY_ID));
        await expect(token.transferWithId(user.address, nonRestrictionAccount.address, 80, ID))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_RESTRICTED_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to restriction account - test 100 - success", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToAnyIdBalance: 200
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 200, ID));
        await expect(token.transferWithId(user.address, restrictionAccount.address, 100, ID))
          .to.changeTokenBalances(
            token,
            [user, restrictionAccount],
            [-100, 100]
          );

        expectedBalance.total -= 100;
        expectedBalance.restricted -= 100;

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account - test 100 - fail - Restricted balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToAnyIdBalance: 200
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 200, ANY_ID));
        await expect(token.transferWithId(user.address, nonRestrictionAccount.address, 100, ID))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_RESTRICTED_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to restriction account - test 120 - fail - ERC20 balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToAnyIdBalance: 200
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 200, ID));
        await expect(token.transferWithId(user.address, restrictionAccount.address, 120, ID))
          .to.be.revertedWith(REVERT_MESSAGE_ERC20_TRANSFER_AMOUNT_EXCEEDS_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account - test 120 - fail - ERC20 balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          restrictedToAnyIdBalance: 200
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 200, ANY_ID));
        await expect(token.transferWithId(user.address, nonRestrictionAccount.address, 120, ID))
          .to.be.revertedWith(REVERT_MESSAGE_ERC20_TRANSFER_AMOUNT_EXCEEDS_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });
    });
  });

  describe("Over frozen and over restricted balances", async () => {
    describe("Function 'transfer()'", async () => {
      it("Transfer to restriction account - test 20 - fail - Frozen balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 200,
          restrictedToIdBalance: 200
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token.freeze(user.address, 200));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 200, ID));
        await expect(connect(token, user).transfer(restrictionAccount.address, 20))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_FROZEN_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account - test 20 - fail - Frozen balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 200,
          restrictedToIdBalance: 200
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token.freeze(user.address, 200));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 200, ID));
        await expect(connect(token, user).transfer(nonRestrictionAccount.address, 20))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_FROZEN_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to restriction account - test 40 - fail - Frozen balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 200,
          restrictedToIdBalance: 200
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token.freeze(user.address, 200));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 200, ID));
        await expect(connect(token, user).transfer(restrictionAccount.address, 40))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_FROZEN_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account - test 40 - fail - Frozen balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 200,
          restrictedToIdBalance: 200
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token.freeze(user.address, 200));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 200, ID));
        await expect(connect(token, user).transfer(nonRestrictionAccount.address, 40))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_FROZEN_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to restriction account - test 60 - fail - Frozen balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 200,
          restrictedToIdBalance: 200
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token.freeze(user.address, 200));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 200, ID));
        await expect(connect(token, user).transfer(restrictionAccount.address, 60))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_FROZEN_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account - test 60 - fail - Frozen balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 200,
          restrictedToIdBalance: 200
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token.freeze(user.address, 200));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 200, ID));
        await expect(connect(token, user).transfer(nonRestrictionAccount.address, 60))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_FROZEN_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to restriction account - test 80 - fail - Frozen balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 200,
          restrictedToIdBalance: 200
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token.freeze(user.address, 200));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 200, ID));
        await expect(connect(token, user).transfer(restrictionAccount.address, 80))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_FROZEN_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account - test 80 - fail - Frozen balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 200,
          restrictedToIdBalance: 200
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token.freeze(user.address, 200));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 200, ID));
        await expect(connect(token, user).transfer(nonRestrictionAccount.address, 80))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_FROZEN_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to restriction account - test 100 - fail - Frozen balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 200,
          restrictedToIdBalance: 200
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token.freeze(user.address, 200));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 200, ID));
        await expect(connect(token, user).transfer(restrictionAccount.address, 100))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_FROZEN_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account - test 100 - fail - Frozen balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 200,
          restrictedToIdBalance: 200
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token.freeze(user.address, 200));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 200, ID));
        await expect(connect(token, user).transfer(nonRestrictionAccount.address, 100))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_FROZEN_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to restriction account - test 120 - fail - ERC20 balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 200,
          restrictedToIdBalance: 200
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token.freeze(user.address, 200));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 200, ID));
        await expect(connect(token, user).transfer(restrictionAccount.address, 120))
          .to.be.revertedWith(REVERT_MESSAGE_ERC20_TRANSFER_AMOUNT_EXCEEDS_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account - test 120 - fail - ERC20 balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 200,
          restrictedToIdBalance: 200
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token.freeze(user.address, 200));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 200, ID));
        await expect(connect(token, user).transfer(nonRestrictionAccount.address, 120))
          .to.be.revertedWith(REVERT_MESSAGE_ERC20_TRANSFER_AMOUNT_EXCEEDS_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });
    });

    describe("Function 'transferFrozen'", async () => {
      it("Transfer to restriction account - test 20 - success", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 200,
          restrictedToIdBalance: 200
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token.freeze(user.address, 200));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 200, ID));
        await expect(token.transferFrozen(user.address, restrictionAccount.address, 20))
          .to.changeTokenBalances(
            token,
            [user, restrictionAccount],
            [-20, 20]
          );

        expectedBalance.total -= 20;
        expectedBalance.frozen -= 20;

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account - test 20 - success", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 200,
          restrictedToIdBalance: 200
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token.freeze(user.address, 200));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 200, ID));
        await expect(token.transferFrozen(user.address, nonRestrictionAccount.address, 20))
          .to.changeTokenBalances(
            token,
            [user, nonRestrictionAccount],
            [-20, 20]
          );

        expectedBalance.total -= 20;
        expectedBalance.frozen -= 20;

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to restriction account - test 40 - success", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 200,
          restrictedToIdBalance: 200
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token.freeze(user.address, 200));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 200, ID));
        await expect(token.transferFrozen(user.address, restrictionAccount.address, 40))
          .to.changeTokenBalances(
            token,
            [user, restrictionAccount],
            [-40, 40]
          );

        expectedBalance.total -= 40;
        expectedBalance.frozen -= 40;

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account - test 40 - success", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 200,
          restrictedToIdBalance: 200
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token.freeze(user.address, 200));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 200, ID));
        await expect(token.transferFrozen(user.address, nonRestrictionAccount.address, 40))
          .to.changeTokenBalances(
            token,
            [user, nonRestrictionAccount],
            [-40, 40]
          );

        expectedBalance.total -= 40;
        expectedBalance.frozen -= 40;

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to restriction account - test 60 - success", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 200,
          restrictedToIdBalance: 200
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token.freeze(user.address, 200));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 200, ID));
        await expect(token.transferFrozen(user.address, restrictionAccount.address, 60))
          .to.changeTokenBalances(
            token,
            [user, restrictionAccount],
            [-60, 60]
          );

        expectedBalance.total -= 60;
        expectedBalance.frozen -= 60;

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account - test 60 - success", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 200,
          restrictedToIdBalance: 200
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token.freeze(user.address, 200));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 200, ID));
        await expect(token.transferFrozen(user.address, nonRestrictionAccount.address, 60))
          .to.changeTokenBalances(
            token,
            [user, nonRestrictionAccount],
            [-60, 60]
          );

        expectedBalance.total -= 60;
        expectedBalance.frozen -= 60;

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to restriction account - test 80 - success", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 200,
          restrictedToIdBalance: 200
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token.freeze(user.address, 200));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 200, ID));
        await expect(token.transferFrozen(user.address, restrictionAccount.address, 80))
          .to.changeTokenBalances(
            token,
            [user, restrictionAccount],
            [-80, 80]
          );

        expectedBalance.total -= 80;
        expectedBalance.frozen -= 80;

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account - test 80 - success", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 200,
          restrictedToIdBalance: 200
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token.freeze(user.address, 200));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 200, ID));
        await expect(token.transferFrozen(user.address, nonRestrictionAccount.address, 80))
          .to.changeTokenBalances(
            token,
            [user, nonRestrictionAccount],
            [-80, 80]
          );

        expectedBalance.total -= 80;
        expectedBalance.frozen -= 80;

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to restriction account - test 100 - success", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 200,
          restrictedToIdBalance: 200
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token.freeze(user.address, 200));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 200, ID));
        await expect(token.transferFrozen(user.address, restrictionAccount.address, 100))
          .to.changeTokenBalances(
            token,
            [user, restrictionAccount],
            [-100, 100]
          );

        expectedBalance.total -= 100;
        expectedBalance.frozen -= 100;

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account - test 100 - success", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 200,
          restrictedToIdBalance: 200
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token.freeze(user.address, 200));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 200, ID));
        await expect(token.transferFrozen(user.address, nonRestrictionAccount.address, 100))
          .to.changeTokenBalances(
            token,
            [user, nonRestrictionAccount],
            [-100, 100]
          );

        expectedBalance.total -= 100;
        expectedBalance.frozen -= 100;

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to restriction account - test 120 - fail - ERC20 balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 200,
          restrictedToIdBalance: 200
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token.freeze(user.address, 200));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 200, ID));
        await expect(token.transferFrozen(user.address, restrictionAccount.address, 120))
          .to.be.revertedWith(REVERT_MESSAGE_ERC20_TRANSFER_AMOUNT_EXCEEDS_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account - test 120 - fail - ERC20 balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 200,
          restrictedToIdBalance: 200
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token.freeze(user.address, 200));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 200, ID));
        await expect(token.transferFrozen(user.address, nonRestrictionAccount.address, 120))
          .to.be.revertedWith(REVERT_MESSAGE_ERC20_TRANSFER_AMOUNT_EXCEEDS_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });
    });

    describe("Function 'transferWithId'", async () => {
      it("Transfer to restriction account - test 20 - fail - Frozen balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 200,
          restrictedToIdBalance: 200
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token.freeze(user.address, 200));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 200, ID));
        await expect(token.transferWithId(user.address, restrictionAccount.address, 20, ID))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_FROZEN_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account - test 20 - fail - Frozen balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 200,
          restrictedToIdBalance: 200
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token.freeze(user.address, 200));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 200, ID));
        await expect(token.transferWithId(user.address, nonRestrictionAccount.address, 20, ID))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_FROZEN_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to restriction account - test 40 - fail - Frozen balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 200,
          restrictedToIdBalance: 200
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token.freeze(user.address, 200));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 200, ID));
        await expect(token.transferWithId(user.address, restrictionAccount.address, 40, ID))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_FROZEN_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account - test 40 - fail - Frozen balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 200,
          restrictedToIdBalance: 200
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token.freeze(user.address, 200));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 200, ID));
        await expect(token.transferWithId(user.address, nonRestrictionAccount.address, 40, ID))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_FROZEN_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to restriction account - test 60 - fail - Frozen balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 200,
          restrictedToIdBalance: 200
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token.freeze(user.address, 200));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 200, ID));
        await expect(token.transferWithId(user.address, restrictionAccount.address, 60, ID))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_FROZEN_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account - test 60 - fail - Frozen balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 200,
          restrictedToIdBalance: 200
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token.freeze(user.address, 200));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 200, ID));
        await expect(token.transferWithId(user.address, nonRestrictionAccount.address, 60, ID))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_FROZEN_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to restriction account - test 80 - fail - Frozen balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 200,
          restrictedToIdBalance: 200
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token.freeze(user.address, 200));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 200, ID));
        await expect(token.transferWithId(user.address, restrictionAccount.address, 80, ID))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_FROZEN_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account - test 80 - fail - Frozen balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 200,
          restrictedToIdBalance: 200
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token.freeze(user.address, 200));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 200, ID));
        await expect(token.transferWithId(user.address, nonRestrictionAccount.address, 80, ID))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_FROZEN_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to restriction account - test 100 - fail - Frozen balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 200,
          restrictedToIdBalance: 200
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token.freeze(user.address, 200));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 200, ID));
        await expect(token.transferWithId(user.address, restrictionAccount.address, 100, ID))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_FROZEN_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account - test 100 - fail - Frozen balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 200,
          restrictedToIdBalance: 200
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token.freeze(user.address, 200));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 200, ID));
        await expect(token.transferWithId(user.address, nonRestrictionAccount.address, 100, ID))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_FROZEN_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to restriction account - test 120 - fail - ERC20 balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 200,
          restrictedToIdBalance: 200
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token.freeze(user.address, 200));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 200, ID));
        await expect(token.transferWithId(user.address, restrictionAccount.address, 120, ID))
          .to.be.revertedWith(REVERT_MESSAGE_ERC20_TRANSFER_AMOUNT_EXCEEDS_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account - test 120 - fail - ERC20 balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 200,
          restrictedToIdBalance: 200
        });

        await proveTx(token.mint(user.address, 100));
        await proveTx(token.freeze(user.address, 200));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 200, ID));
        await expect(token.transferWithId(user.address, nonRestrictionAccount.address, 120, ID))
          .to.be.revertedWith(REVERT_MESSAGE_ERC20_TRANSFER_AMOUNT_EXCEEDS_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });
    });
  });

  describe("Over frozen, over restricted and preminted balances", async () => {
    let timestamp: number;
    before(async () => {
      timestamp = (await getLatestBlockTimestamp()) + 100;
    });
    describe("Function 'transfer'", async () => {
      it("Transfer to restriction account without release awaiting - test 20 - fail - Frozen balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 200,
          restrictedToIdBalance: 200,
          premintedBalance: 50
        });

        await proveTx(token.mint(user.address, 50));
        await proveTx(token.premintIncrease(user.address, 50, timestamp));
        await proveTx(token.freeze(user.address, 200));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 200, ID));
        await expect(connect(token, user).transfer(restrictionAccount.address, 20))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_FROZEN_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to restriction account with release awaiting - test 20 - fail - Frozen balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 200,
          restrictedToIdBalance: 200,
          premintedBalance: 50
        });

        await proveTx(token.mint(user.address, 50));
        await proveTx(token.premintIncrease(user.address, 50, timestamp));
        await proveTx(token.freeze(user.address, 200));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 200, ID));
        await increaseBlockTimestampTo(timestamp);
        expectedBalance.premint -= 50;
        await expect(connect(token, user).transfer(restrictionAccount.address, 20))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_FROZEN_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account without release awaiting - test 20 - fail - Frozen balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 200,
          restrictedToIdBalance: 200,
          premintedBalance: 50
        });

        await proveTx(token.mint(user.address, 50));
        await proveTx(token.premintIncrease(user.address, 50, timestamp));
        await proveTx(token.freeze(user.address, 200));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 200, ID));
        await expect(connect(token, user).transfer(nonRestrictionAccount.address, 20))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_FROZEN_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account with release awaiting - test 20 - fail - Frozen balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 200,
          restrictedToIdBalance: 200,
          premintedBalance: 50
        });

        await proveTx(token.mint(user.address, 50));
        await proveTx(token.premintIncrease(user.address, 50, timestamp));
        await proveTx(token.freeze(user.address, 200));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 200, ID));
        await increaseBlockTimestampTo(timestamp);
        expectedBalance.premint -= 50;
        await expect(connect(token, user).transfer(nonRestrictionAccount.address, 20))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_FROZEN_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to restriction account without release awaiting - test 40 - fail - Frozen balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 200,
          restrictedToIdBalance: 200,
          premintedBalance: 50
        });

        await proveTx(token.mint(user.address, 50));
        await proveTx(token.premintIncrease(user.address, 50, timestamp));
        await proveTx(token.freeze(user.address, 200));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 200, ID));
        await expect(connect(token, user).transfer(restrictionAccount.address, 40))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_FROZEN_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to restriction account with release awaiting - test 40 - fail - Frozen balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 200,
          restrictedToIdBalance: 200,
          premintedBalance: 50
        });

        await proveTx(token.mint(user.address, 50));
        await proveTx(token.premintIncrease(user.address, 50, timestamp));
        await proveTx(token.freeze(user.address, 200));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 200, ID));
        await increaseBlockTimestampTo(timestamp);
        expectedBalance.premint -= 50;
        await expect(connect(token, user).transfer(restrictionAccount.address, 40))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_FROZEN_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account without release awaiting - test 40 - fail - Frozen balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 200,
          restrictedToIdBalance: 200,
          premintedBalance: 50
        });

        await proveTx(token.mint(user.address, 50));
        await proveTx(token.premintIncrease(user.address, 50, timestamp));
        await proveTx(token.freeze(user.address, 200));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 200, ID));
        await expect(connect(token, user).transfer(nonRestrictionAccount.address, 40))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_FROZEN_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account with release awaiting - test 40 - fail - Frozen balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 200,
          restrictedToIdBalance: 200,
          premintedBalance: 50
        });

        await proveTx(token.mint(user.address, 50));
        await proveTx(token.premintIncrease(user.address, 50, timestamp));
        await proveTx(token.freeze(user.address, 200));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 200, ID));
        await increaseBlockTimestampTo(timestamp);
        expectedBalance.premint -= 50;
        await expect(connect(token, user).transfer(nonRestrictionAccount.address, 40))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_FROZEN_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to restriction account without release awaiting - test 60 - fail - Preminted balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 200,
          restrictedToIdBalance: 200,
          premintedBalance: 50
        });

        await proveTx(token.mint(user.address, 50));
        await proveTx(token.premintIncrease(user.address, 50, timestamp));
        await proveTx(token.freeze(user.address, 200));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 200, ID));
        await expect(connect(token, user).transfer(restrictionAccount.address, 60))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_PREMINT_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to restriction account with release awaiting - test 60 - fail - Frozen balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 200,
          restrictedToIdBalance: 200,
          premintedBalance: 50
        });

        await proveTx(token.mint(user.address, 50));
        await proveTx(token.premintIncrease(user.address, 50, timestamp));
        await proveTx(token.freeze(user.address, 200));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 200, ID));
        await increaseBlockTimestampTo(timestamp);
        expectedBalance.premint -= 50;
        await expect(connect(token, user).transfer(restrictionAccount.address, 60))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_FROZEN_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account without release awaiting - test 60 - fail - Preminted balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 200,
          restrictedToIdBalance: 200,
          premintedBalance: 50
        });

        await proveTx(token.mint(user.address, 50));
        await proveTx(token.premintIncrease(user.address, 50, timestamp));
        await proveTx(token.freeze(user.address, 200));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 200, ID));
        await expect(connect(token, user).transfer(nonRestrictionAccount.address, 60))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_PREMINT_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account with release awaiting - test 60 - fail - Frozen balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 200,
          restrictedToIdBalance: 200,
          premintedBalance: 50
        });

        await proveTx(token.mint(user.address, 50));
        await proveTx(token.premintIncrease(user.address, 50, timestamp));
        await proveTx(token.freeze(user.address, 200));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 200, ID));
        await increaseBlockTimestampTo(timestamp);
        expectedBalance.premint -= 50;
        await expect(connect(token, user).transfer(nonRestrictionAccount.address, 60))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_FROZEN_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to restriction account without release awaiting - test 80 - fail - Preminted balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 200,
          restrictedToIdBalance: 200,
          premintedBalance: 50
        });

        await proveTx(token.mint(user.address, 50));
        await proveTx(token.premintIncrease(user.address, 50, timestamp));
        await proveTx(token.freeze(user.address, 200));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 200, ID));
        await expect(connect(token, user).transfer(restrictionAccount.address, 80))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_PREMINT_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to restriction account with release awaiting - test 80 - fail - Frozen balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 200,
          restrictedToIdBalance: 200,
          premintedBalance: 50
        });

        await proveTx(token.mint(user.address, 50));
        await proveTx(token.premintIncrease(user.address, 50, timestamp));
        await proveTx(token.freeze(user.address, 200));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 200, ID));
        await increaseBlockTimestampTo(timestamp);
        expectedBalance.premint -= 50;
        await expect(connect(token, user).transfer(restrictionAccount.address, 80))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_FROZEN_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account without release awaiting - test 80 - fail - Preminted balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 200,
          restrictedToIdBalance: 200,
          premintedBalance: 50
        });

        await proveTx(token.mint(user.address, 50));
        await proveTx(token.premintIncrease(user.address, 50, timestamp));
        await proveTx(token.freeze(user.address, 200));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 200, ID));
        await expect(connect(token, user).transfer(nonRestrictionAccount.address, 80))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_PREMINT_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account with release awaiting - test 80 - fail - Frozen balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 200,
          restrictedToIdBalance: 200,
          premintedBalance: 50
        });

        await proveTx(token.mint(user.address, 50));
        await proveTx(token.premintIncrease(user.address, 50, timestamp));
        await proveTx(token.freeze(user.address, 200));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 200, ID));
        await increaseBlockTimestampTo(timestamp);
        expectedBalance.premint -= 50;
        await expect(connect(token, user).transfer(nonRestrictionAccount.address, 80))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_FROZEN_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to restriction account without release awaiting - test 100 - fail - Preminted balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 200,
          restrictedToIdBalance: 200,
          premintedBalance: 50
        });

        await proveTx(token.mint(user.address, 50));
        await proveTx(token.premintIncrease(user.address, 50, timestamp));
        await proveTx(token.freeze(user.address, 200));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 200, ID));
        await expect(connect(token, user).transfer(restrictionAccount.address, 100))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_PREMINT_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to restriction account with release awaiting - test 100 - fail - Frozen balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 200,
          restrictedToIdBalance: 200,
          premintedBalance: 50
        });

        await proveTx(token.mint(user.address, 50));
        await proveTx(token.premintIncrease(user.address, 50, timestamp));
        await proveTx(token.freeze(user.address, 200));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 200, ID));
        await increaseBlockTimestampTo(timestamp);
        expectedBalance.premint -= 50;
        await expect(connect(token, user).transfer(restrictionAccount.address, 100))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_FROZEN_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account without release awaiting - test 100 - fail - Preminted balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 200,
          restrictedToIdBalance: 200,
          premintedBalance: 50
        });

        await proveTx(token.mint(user.address, 50));
        await proveTx(token.premintIncrease(user.address, 50, timestamp));
        await proveTx(token.freeze(user.address, 200));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 200, ID));
        await expect(connect(token, user).transfer(nonRestrictionAccount.address, 100))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_PREMINT_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account with release awaiting - test 100 - fail - Frozen balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 200,
          restrictedToIdBalance: 200,
          premintedBalance: 50
        });

        await proveTx(token.mint(user.address, 50));
        await proveTx(token.premintIncrease(user.address, 50, timestamp));
        await proveTx(token.freeze(user.address, 200));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 200, ID));
        await increaseBlockTimestampTo(timestamp);
        expectedBalance.premint -= 50;
        await expect(connect(token, user).transfer(nonRestrictionAccount.address, 100))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_FROZEN_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to restriction account without release awaiting - test 120 - fail - ERC20 balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 200,
          restrictedToIdBalance: 200,
          premintedBalance: 50
        });

        await proveTx(token.mint(user.address, 50));
        await proveTx(token.premintIncrease(user.address, 50, timestamp));
        await proveTx(token.freeze(user.address, 200));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 200, ID));
        await expect(connect(token, user).transfer(restrictionAccount.address, 120))
          .to.be.revertedWith(REVERT_MESSAGE_ERC20_TRANSFER_AMOUNT_EXCEEDS_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to restriction account with release awaiting - test 120 - fail - ERC20 balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 200,
          restrictedToIdBalance: 200,
          premintedBalance: 50
        });

        await proveTx(token.mint(user.address, 50));
        await proveTx(token.premintIncrease(user.address, 50, timestamp));
        await proveTx(token.freeze(user.address, 200));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 200, ID));
        await increaseBlockTimestampTo(timestamp);
        expectedBalance.premint -= 50;
        await expect(connect(token, user).transfer(restrictionAccount.address, 120))
          .to.be.revertedWith(REVERT_MESSAGE_ERC20_TRANSFER_AMOUNT_EXCEEDS_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account without release awaiting - test 120 - fail - ERC20 balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 200,
          restrictedToIdBalance: 200,
          premintedBalance: 50
        });

        await proveTx(token.mint(user.address, 50));
        await proveTx(token.premintIncrease(user.address, 50, timestamp));
        await proveTx(token.freeze(user.address, 200));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 200, ID));
        await expect(connect(token, user).transfer(nonRestrictionAccount.address, 120))
          .to.be.revertedWith(REVERT_MESSAGE_ERC20_TRANSFER_AMOUNT_EXCEEDS_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account with release awaiting - test 120 - fail - ERC20 balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 200,
          restrictedToIdBalance: 200,
          premintedBalance: 50
        });

        await proveTx(token.mint(user.address, 50));
        await proveTx(token.premintIncrease(user.address, 50, timestamp));
        await proveTx(token.freeze(user.address, 200));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 200, ID));
        await increaseBlockTimestampTo(timestamp);
        expectedBalance.premint -= 50;
        await expect(connect(token, user).transfer(nonRestrictionAccount.address, 120))
          .to.be.revertedWith(REVERT_MESSAGE_ERC20_TRANSFER_AMOUNT_EXCEEDS_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });
    });

    describe("Function 'transferFrozen()'", async () => {
      it("Transfer to restriction account without release awaiting - test 20 - success", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 200,
          restrictedToIdBalance: 200,
          premintedBalance: 50
        });

        await proveTx(token.mint(user.address, 50));
        await proveTx(token.premintIncrease(user.address, 50, timestamp));
        await proveTx(token.freeze(user.address, 200));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 200, ID));
        await expect(token.transferFrozen(user.address, restrictionAccount.address, 20))
          .to.changeTokenBalances(
            token,
            [user, restrictionAccount],
            [-20, 20]
          );

        expectedBalance.total -= 20;
        expectedBalance.frozen -= 20;

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to restriction account with release awaiting - test 20 - success", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 200,
          restrictedToIdBalance: 200,
          premintedBalance: 50
        });

        await proveTx(token.mint(user.address, 50));
        await proveTx(token.premintIncrease(user.address, 50, timestamp));
        await proveTx(token.freeze(user.address, 200));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 200, ID));
        await increaseBlockTimestampTo(timestamp);
        expectedBalance.premint -= 50;
        await expect(token.transferFrozen(user.address, restrictionAccount.address, 20))
          .to.changeTokenBalances(
            token,
            [user, restrictionAccount],
            [-20, 20]
          );

        expectedBalance.total -= 20;
        expectedBalance.frozen -= 20;

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account without release awaiting - test 20 - success", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 200,
          restrictedToIdBalance: 200,
          premintedBalance: 50
        });

        await proveTx(token.mint(user.address, 50));
        await proveTx(token.premintIncrease(user.address, 50, timestamp));
        await proveTx(token.freeze(user.address, 200));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 200, ID));
        await expect(token.transferFrozen(user.address, nonRestrictionAccount.address, 20))
          .to.changeTokenBalances(
            token,
            [user, nonRestrictionAccount],
            [-20, 20]
          );

        expectedBalance.total -= 20;
        expectedBalance.frozen -= 20;

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account with release awaiting - test 20 - success", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 200,
          restrictedToIdBalance: 200,
          premintedBalance: 50
        });

        await proveTx(token.mint(user.address, 50));
        await proveTx(token.premintIncrease(user.address, 50, timestamp));
        await proveTx(token.freeze(user.address, 200));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 200, ID));
        await increaseBlockTimestampTo(timestamp);
        expectedBalance.premint -= 50;
        await expect(token.transferFrozen(user.address, nonRestrictionAccount.address, 20))
          .to.changeTokenBalances(
            token,
            [user, nonRestrictionAccount],
            [-20, 20]
          );

        expectedBalance.total -= 20;
        expectedBalance.frozen -= 20;

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to restriction account without release awaiting - test 40 - success", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 200,
          restrictedToIdBalance: 200,
          premintedBalance: 50
        });

        await proveTx(token.mint(user.address, 50));
        await proveTx(token.premintIncrease(user.address, 50, timestamp));
        await proveTx(token.freeze(user.address, 200));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 200, ID));
        await expect(token.transferFrozen(user.address, restrictionAccount.address, 40))
          .to.changeTokenBalances(
            token,
            [user, restrictionAccount],
            [-40, 40]
          );

        expectedBalance.total -= 40;
        expectedBalance.frozen -= 40;

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to restriction account with release awaiting - test 40 - success", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 200,
          restrictedToIdBalance: 200,
          premintedBalance: 50
        });

        await proveTx(token.mint(user.address, 50));
        await proveTx(token.premintIncrease(user.address, 50, timestamp));
        await proveTx(token.freeze(user.address, 200));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 200, ID));
        await increaseBlockTimestampTo(timestamp);
        expectedBalance.premint -= 50;
        await expect(token.transferFrozen(user.address, restrictionAccount.address, 40))
          .to.changeTokenBalances(
            token,
            [user, restrictionAccount],
            [-40, 40]
          );

        expectedBalance.total -= 40;
        expectedBalance.frozen -= 40;

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account without release awaiting - test 40 - success", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 200,
          restrictedToIdBalance: 200,
          premintedBalance: 50
        });

        await proveTx(token.mint(user.address, 50));
        await proveTx(token.premintIncrease(user.address, 50, timestamp));
        await proveTx(token.freeze(user.address, 200));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 200, ID));
        await expect(token.transferFrozen(user.address, nonRestrictionAccount.address, 40))
          .to.changeTokenBalances(
            token,
            [user, nonRestrictionAccount],
            [-40, 40]
          );

        expectedBalance.total -= 40;
        expectedBalance.frozen -= 40;

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account with release awaiting - test 40 - success", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 200,
          restrictedToIdBalance: 200,
          premintedBalance: 50
        });

        await proveTx(token.mint(user.address, 50));
        await proveTx(token.premintIncrease(user.address, 50, timestamp));
        await proveTx(token.freeze(user.address, 200));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 200, ID));
        await increaseBlockTimestampTo(timestamp);
        expectedBalance.premint -= 50;
        await expect(token.transferFrozen(user.address, nonRestrictionAccount.address, 40))
          .to.changeTokenBalances(
            token,
            [user, nonRestrictionAccount],
            [-40, 40]
          );

        expectedBalance.total -= 40;
        expectedBalance.frozen -= 40;

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to restriction account without release awaiting - test 60 - fail - Preminted balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 200,
          restrictedToIdBalance: 200,
          premintedBalance: 50
        });

        await proveTx(token.mint(user.address, 50));
        await proveTx(token.premintIncrease(user.address, 50, timestamp));
        await proveTx(token.freeze(user.address, 200));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 200, ID));
        await expect(token.transferFrozen(user.address, restrictionAccount.address, 60))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_PREMINT_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to restriction account with release awaiting - test 60 - success", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 200,
          restrictedToIdBalance: 200,
          premintedBalance: 50
        });

        await proveTx(token.mint(user.address, 50));
        await proveTx(token.premintIncrease(user.address, 50, timestamp));
        await proveTx(token.freeze(user.address, 200));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 200, ID));
        await increaseBlockTimestampTo(timestamp);
        expectedBalance.premint -= 50;
        await expect(token.transferFrozen(user.address, restrictionAccount.address, 60))
          .to.changeTokenBalances(
            token,
            [user, restrictionAccount],
            [-60, 60]
          );

        expectedBalance.total -= 60;
        expectedBalance.frozen -= 60;

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account without release awaiting - test 60 - fail - Preminted balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 200,
          restrictedToIdBalance: 200,
          premintedBalance: 50
        });

        await proveTx(token.mint(user.address, 50));
        await proveTx(token.premintIncrease(user.address, 50, timestamp));
        await proveTx(token.freeze(user.address, 200));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 200, ID));
        await expect(token.transferFrozen(user.address, nonRestrictionAccount.address, 60))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_PREMINT_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account with release awaiting - test 60 - success", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 200,
          restrictedToIdBalance: 200,
          premintedBalance: 50
        });

        await proveTx(token.mint(user.address, 50));
        await proveTx(token.premintIncrease(user.address, 50, timestamp));
        await proveTx(token.freeze(user.address, 200));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 200, ID));
        await increaseBlockTimestampTo(timestamp);
        expectedBalance.premint -= 50;
        await expect(token.transferFrozen(user.address, nonRestrictionAccount.address, 60))
          .to.changeTokenBalances(
            token,
            [user, nonRestrictionAccount],
            [-60, 60]
          );

        expectedBalance.total -= 60;
        expectedBalance.frozen -= 60;

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to restriction account without release awaiting - test 80 - fail - Preminted balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 200,
          restrictedToIdBalance: 200,
          premintedBalance: 50
        });

        await proveTx(token.mint(user.address, 50));
        await proveTx(token.premintIncrease(user.address, 50, timestamp));
        await proveTx(token.freeze(user.address, 200));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 200, ID));
        await expect(token.transferFrozen(user.address, restrictionAccount.address, 80))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_PREMINT_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to restriction account with release awaiting - test 80 - success", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 200,
          restrictedToIdBalance: 200,
          premintedBalance: 50
        });

        await proveTx(token.mint(user.address, 50));
        await proveTx(token.premintIncrease(user.address, 50, timestamp));
        await proveTx(token.freeze(user.address, 200));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 200, ID));
        await increaseBlockTimestampTo(timestamp);
        expectedBalance.premint -= 50;
        await expect(token.transferFrozen(user.address, restrictionAccount.address, 80))
          .to.changeTokenBalances(
            token,
            [user, restrictionAccount],
            [-80, 80]
          );

        expectedBalance.total -= 80;
        expectedBalance.frozen -= 80;

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account without release awaiting - test 80 - fail - Preminted balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 200,
          restrictedToIdBalance: 200,
          premintedBalance: 50
        });

        await proveTx(token.mint(user.address, 50));
        await proveTx(token.premintIncrease(user.address, 50, timestamp));
        await proveTx(token.freeze(user.address, 200));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 200, ID));
        await expect(token.transferFrozen(user.address, nonRestrictionAccount.address, 80))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_PREMINT_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account with release awaiting - test 80 - success", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 200,
          restrictedToIdBalance: 200,
          premintedBalance: 50
        });

        await proveTx(token.mint(user.address, 50));
        await proveTx(token.premintIncrease(user.address, 50, timestamp));
        await proveTx(token.freeze(user.address, 200));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 200, ID));
        await increaseBlockTimestampTo(timestamp);
        expectedBalance.premint -= 50;
        await expect(token.transferFrozen(user.address, nonRestrictionAccount.address, 80))
          .to.changeTokenBalances(
            token,
            [user, nonRestrictionAccount],
            [-80, 80]
          );

        expectedBalance.total -= 80;
        expectedBalance.frozen -= 80;

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to restriction account without release awaiting - test 100 - fail - Preminted balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 200,
          restrictedToIdBalance: 200,
          premintedBalance: 50
        });

        await proveTx(token.mint(user.address, 50));
        await proveTx(token.premintIncrease(user.address, 50, timestamp));
        await proveTx(token.freeze(user.address, 200));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 200, ID));
        await expect(token.transferFrozen(user.address, restrictionAccount.address, 100))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_PREMINT_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to restriction account with release awaiting - test 100 - success", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 200,
          restrictedToIdBalance: 200,
          premintedBalance: 50
        });

        await proveTx(token.mint(user.address, 50));
        await proveTx(token.premintIncrease(user.address, 50, timestamp));
        await proveTx(token.freeze(user.address, 200));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 200, ID));
        await increaseBlockTimestampTo(timestamp);
        expectedBalance.premint -= 50;
        await expect(token.transferFrozen(user.address, restrictionAccount.address, 100))
          .to.changeTokenBalances(
            token,
            [user, restrictionAccount],
            [-100, 100]
          );

        expectedBalance.total -= 100;
        expectedBalance.frozen -= 100;

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account without release awaiting - test 100 - fail - Preminted balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 200,
          restrictedToIdBalance: 200,
          premintedBalance: 50
        });

        await proveTx(token.mint(user.address, 50));
        await proveTx(token.premintIncrease(user.address, 50, timestamp));
        await proveTx(token.freeze(user.address, 200));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 200, ID));
        await expect(token.transferFrozen(user.address, nonRestrictionAccount.address, 100))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_PREMINT_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account with release awaiting - test 100 - success", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 200,
          restrictedToIdBalance: 200,
          premintedBalance: 50
        });

        await proveTx(token.mint(user.address, 50));
        await proveTx(token.premintIncrease(user.address, 50, timestamp));
        await proveTx(token.freeze(user.address, 200));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 200, ID));
        await increaseBlockTimestampTo(timestamp);
        expectedBalance.premint -= 50;
        await expect(token.transferFrozen(user.address, nonRestrictionAccount.address, 100))
          .to.changeTokenBalances(
            token,
            [user, nonRestrictionAccount],
            [-100, 100]
          );

        expectedBalance.total -= 100;
        expectedBalance.frozen -= 100;

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to restriction account without release awaiting - test 120 - fail - ERC20 balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 200,
          restrictedToIdBalance: 200,
          premintedBalance: 50
        });

        await proveTx(token.mint(user.address, 50));
        await proveTx(token.premintIncrease(user.address, 50, timestamp));
        await proveTx(token.freeze(user.address, 200));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 200, ID));
        await expect(token.transferFrozen(user.address, restrictionAccount.address, 120))
          .to.be.revertedWith(REVERT_MESSAGE_ERC20_TRANSFER_AMOUNT_EXCEEDS_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to restriction account with release awaiting - test 120 - fail - ERC20 balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 200,
          restrictedToIdBalance: 200,
          premintedBalance: 50
        });

        await proveTx(token.mint(user.address, 50));
        await proveTx(token.premintIncrease(user.address, 50, timestamp));
        await proveTx(token.freeze(user.address, 200));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 200, ID));
        await increaseBlockTimestampTo(timestamp);
        expectedBalance.premint -= 50;
        await expect(token.transferFrozen(user.address, restrictionAccount.address, 120))
          .to.be.revertedWith(REVERT_MESSAGE_ERC20_TRANSFER_AMOUNT_EXCEEDS_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account without release awaiting - test 120 - fail - ERC20 balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 200,
          restrictedToIdBalance: 200,
          premintedBalance: 50
        });

        await proveTx(token.mint(user.address, 50));
        await proveTx(token.premintIncrease(user.address, 50, timestamp));
        await proveTx(token.freeze(user.address, 200));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 200, ID));
        await expect(token.transferFrozen(user.address, nonRestrictionAccount.address, 120))
          .to.be.revertedWith(REVERT_MESSAGE_ERC20_TRANSFER_AMOUNT_EXCEEDS_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account with release awaiting - test 120 - fail - ERC20 balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 200,
          restrictedToIdBalance: 200,
          premintedBalance: 50
        });

        await proveTx(token.mint(user.address, 50));
        await proveTx(token.premintIncrease(user.address, 50, timestamp));
        await proveTx(token.freeze(user.address, 200));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 200, ID));
        await increaseBlockTimestampTo(timestamp);
        expectedBalance.premint -= 50;
        await expect(token.transferFrozen(user.address, nonRestrictionAccount.address, 120))
          .to.be.revertedWith(REVERT_MESSAGE_ERC20_TRANSFER_AMOUNT_EXCEEDS_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });
    });

    describe("Function 'transferWithId()'", async () => {
      it("Transfer to restriction account without release awaiting - test 20 - fail - Frozen balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 200,
          restrictedToIdBalance: 200,
          premintedBalance: 50
        });

        await proveTx(token.mint(user.address, 50));
        await proveTx(token.premintIncrease(user.address, 50, timestamp));
        await proveTx(token.freeze(user.address, 200));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 200, ID));
        await expect(token.transferWithId(user.address, restrictionAccount.address, 20, ID))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_FROZEN_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to restriction account with release awaiting - test 20 - fail - Frozen balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 200,
          restrictedToIdBalance: 200,
          premintedBalance: 50
        });

        await proveTx(token.mint(user.address, 50));
        await proveTx(token.premintIncrease(user.address, 50, timestamp));
        await proveTx(token.freeze(user.address, 200));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 200, ID));
        await increaseBlockTimestampTo(timestamp);
        expectedBalance.premint -= 50;
        await expect(token.transferWithId(user.address, restrictionAccount.address, 20, ID))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_FROZEN_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account without release awaiting - test 20 - fail - Frozen balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 200,
          restrictedToIdBalance: 200,
          premintedBalance: 50
        });

        await proveTx(token.mint(user.address, 50));
        await proveTx(token.premintIncrease(user.address, 50, timestamp));
        await proveTx(token.freeze(user.address, 200));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 200, ID));
        await expect(token.transferWithId(user.address, nonRestrictionAccount.address, 20, ID))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_FROZEN_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account with release awaiting - test 20 - fail - Frozen balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 200,
          restrictedToIdBalance: 200,
          premintedBalance: 50
        });

        await proveTx(token.mint(user.address, 50));
        await proveTx(token.premintIncrease(user.address, 50, timestamp));
        await proveTx(token.freeze(user.address, 200));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 200, ID));
        await increaseBlockTimestampTo(timestamp);
        expectedBalance.premint -= 50;
        await expect(token.transferWithId(user.address, nonRestrictionAccount.address, 20, ID))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_FROZEN_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to restriction account without release awaiting - test 40 - fail - Frozen balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 200,
          restrictedToIdBalance: 200,
          premintedBalance: 50
        });

        await proveTx(token.mint(user.address, 50));
        await proveTx(token.premintIncrease(user.address, 50, timestamp));
        await proveTx(token.freeze(user.address, 200));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 200, ID));
        await expect(token.transferWithId(user.address, restrictionAccount.address, 40, ID))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_FROZEN_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to restriction account with release awaiting - test 40 - fail - Frozen balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 200,
          restrictedToIdBalance: 200,
          premintedBalance: 50
        });

        await proveTx(token.mint(user.address, 50));
        await proveTx(token.premintIncrease(user.address, 50, timestamp));
        await proveTx(token.freeze(user.address, 200));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 200, ID));
        await increaseBlockTimestampTo(timestamp);
        expectedBalance.premint -= 50;
        await expect(token.transferWithId(user.address, restrictionAccount.address, 40, ID))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_FROZEN_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account without release awaiting - test 40 - fail - Frozen balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 200,
          restrictedToIdBalance: 200,
          premintedBalance: 50
        });

        await proveTx(token.mint(user.address, 50));
        await proveTx(token.premintIncrease(user.address, 50, timestamp));
        await proveTx(token.freeze(user.address, 200));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 200, ID));
        await expect(token.transferWithId(user.address, nonRestrictionAccount.address, 40, ID))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_FROZEN_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account with release awaiting - test 40 - fail - Frozen balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 200,
          restrictedToIdBalance: 200,
          premintedBalance: 50
        });

        await proveTx(token.mint(user.address, 50));
        await proveTx(token.premintIncrease(user.address, 50, timestamp));
        await proveTx(token.freeze(user.address, 200));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 200, ID));
        await increaseBlockTimestampTo(timestamp);
        expectedBalance.premint -= 50;
        await expect(token.transferWithId(user.address, nonRestrictionAccount.address, 40, ID))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_FROZEN_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to restriction account without release awaiting - test 60 - fail - Preminted balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 200,
          restrictedToIdBalance: 200,
          premintedBalance: 50
        });

        await proveTx(token.mint(user.address, 50));
        await proveTx(token.premintIncrease(user.address, 50, timestamp));
        await proveTx(token.freeze(user.address, 200));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 200, ID));
        await expect(token.transferWithId(user.address, restrictionAccount.address, 60, ID))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_PREMINT_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to restriction account with release awaiting - test 60 - fail - Frozen balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 200,
          restrictedToIdBalance: 200,
          premintedBalance: 50
        });

        await proveTx(token.mint(user.address, 50));
        await proveTx(token.premintIncrease(user.address, 50, timestamp));
        await proveTx(token.freeze(user.address, 200));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 200, ID));
        await increaseBlockTimestampTo(timestamp);
        expectedBalance.premint -= 50;
        await expect(token.transferWithId(user.address, restrictionAccount.address, 60, ID))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_FROZEN_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account without release awaiting - test 60 - fail - Preminted balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 200,
          restrictedToIdBalance: 200,
          premintedBalance: 50
        });

        await proveTx(token.mint(user.address, 50));
        await proveTx(token.premintIncrease(user.address, 50, timestamp));
        await proveTx(token.freeze(user.address, 200));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 200, ID));
        await expect(token.transferWithId(user.address, nonRestrictionAccount.address, 60, ID))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_PREMINT_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account with release awaiting - test 60 - fail - Frozen balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 200,
          restrictedToIdBalance: 200,
          premintedBalance: 50
        });

        await proveTx(token.mint(user.address, 50));
        await proveTx(token.premintIncrease(user.address, 50, timestamp));
        await proveTx(token.freeze(user.address, 200));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 200, ID));
        await increaseBlockTimestampTo(timestamp);
        expectedBalance.premint -= 50;
        await expect(token.transferWithId(user.address, nonRestrictionAccount.address, 60, ID))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_FROZEN_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to restriction account without release awaiting - test 80 - fail - Preminted balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 200,
          restrictedToIdBalance: 200,
          premintedBalance: 50
        });

        await proveTx(token.mint(user.address, 50));
        await proveTx(token.premintIncrease(user.address, 50, timestamp));
        await proveTx(token.freeze(user.address, 200));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 200, ID));
        await expect(token.transferWithId(user.address, restrictionAccount.address, 80, ID))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_PREMINT_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to restriction account with release awaiting - test 80 - fail - Frozen balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 200,
          restrictedToIdBalance: 200,
          premintedBalance: 50
        });

        await proveTx(token.mint(user.address, 50));
        await proveTx(token.premintIncrease(user.address, 50, timestamp));
        await proveTx(token.freeze(user.address, 200));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 200, ID));
        await increaseBlockTimestampTo(timestamp);
        expectedBalance.premint -= 50;
        await expect(token.transferWithId(user.address, restrictionAccount.address, 80, ID))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_FROZEN_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account without release awaiting - test 80 - fail - Preminted balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 200,
          restrictedToIdBalance: 200,
          premintedBalance: 50
        });

        await proveTx(token.mint(user.address, 50));
        await proveTx(token.premintIncrease(user.address, 50, timestamp));
        await proveTx(token.freeze(user.address, 200));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 200, ID));
        await expect(token.transferWithId(user.address, nonRestrictionAccount.address, 80, ID))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_PREMINT_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account with release awaiting - test 80 - fail - Frozen balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 200,
          restrictedToIdBalance: 200,
          premintedBalance: 50
        });

        await proveTx(token.mint(user.address, 50));
        await proveTx(token.premintIncrease(user.address, 50, timestamp));
        await proveTx(token.freeze(user.address, 200));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 200, ID));
        await increaseBlockTimestampTo(timestamp);
        expectedBalance.premint -= 50;
        await expect(token.transferWithId(user.address, nonRestrictionAccount.address, 80, ID))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_FROZEN_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to restriction account without release awaiting - test 100 - fail - Preminted balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 200,
          restrictedToIdBalance: 200,
          premintedBalance: 50
        });

        await proveTx(token.mint(user.address, 50));
        await proveTx(token.premintIncrease(user.address, 50, timestamp));
        await proveTx(token.freeze(user.address, 200));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 200, ID));
        await expect(token.transferWithId(user.address, restrictionAccount.address, 100, ID))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_PREMINT_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to restriction account with release awaiting - test 100 - fail - Frozen balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 200,
          restrictedToIdBalance: 200,
          premintedBalance: 50
        });

        await proveTx(token.mint(user.address, 50));
        await proveTx(token.premintIncrease(user.address, 50, timestamp));
        await proveTx(token.freeze(user.address, 200));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 200, ID));
        await increaseBlockTimestampTo(timestamp);
        expectedBalance.premint -= 50;
        await expect(token.transferWithId(user.address, restrictionAccount.address, 100, ID))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_FROZEN_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account without release awaiting - test 100 - fail - Preminted balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 200,
          restrictedToIdBalance: 200,
          premintedBalance: 50
        });

        await proveTx(token.mint(user.address, 50));
        await proveTx(token.premintIncrease(user.address, 50, timestamp));
        await proveTx(token.freeze(user.address, 200));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 200, ID));
        await expect(token.transferWithId(user.address, nonRestrictionAccount.address, 100, ID))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_PREMINT_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account with release awaiting - test 100 - fail - Frozen balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 200,
          restrictedToIdBalance: 200,
          premintedBalance: 50
        });

        await proveTx(token.mint(user.address, 50));
        await proveTx(token.premintIncrease(user.address, 50, timestamp));
        await proveTx(token.freeze(user.address, 200));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 200, ID));
        await increaseBlockTimestampTo(timestamp);
        expectedBalance.premint -= 50;
        await expect(token.transferWithId(user.address, nonRestrictionAccount.address, 100, ID))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_FROZEN_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to restriction account without release awaiting - test 120 - fail - ERC20 balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 200,
          restrictedToIdBalance: 200,
          premintedBalance: 50
        });

        await proveTx(token.mint(user.address, 50));
        await proveTx(token.premintIncrease(user.address, 50, timestamp));
        await proveTx(token.freeze(user.address, 200));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 200, ID));
        await expect(token.transferWithId(user.address, restrictionAccount.address, 120, ID))
          .to.be.revertedWith(REVERT_MESSAGE_ERC20_TRANSFER_AMOUNT_EXCEEDS_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to restriction account with release awaiting - test 120 - fail - ERC20 balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 200,
          restrictedToIdBalance: 200,
          premintedBalance: 50
        });

        await proveTx(token.mint(user.address, 50));
        await proveTx(token.premintIncrease(user.address, 50, timestamp));
        await proveTx(token.freeze(user.address, 200));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 200, ID));
        await increaseBlockTimestampTo(timestamp);
        expectedBalance.premint -= 50;
        await expect(token.transferWithId(user.address, restrictionAccount.address, 120, ID))
          .to.be.revertedWith(REVERT_MESSAGE_ERC20_TRANSFER_AMOUNT_EXCEEDS_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account without release awaiting - test 120 - fail - ERC20 balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 200,
          restrictedToIdBalance: 200,
          premintedBalance: 50
        });

        await proveTx(token.mint(user.address, 50));
        await proveTx(token.premintIncrease(user.address, 50, timestamp));
        await proveTx(token.freeze(user.address, 200));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 200, ID));
        await expect(token.transferWithId(user.address, nonRestrictionAccount.address, 120, ID))
          .to.be.revertedWith(REVERT_MESSAGE_ERC20_TRANSFER_AMOUNT_EXCEEDS_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account with release awaiting - test 120 - fail - ERC20 balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 200,
          restrictedToIdBalance: 200,
          premintedBalance: 50
        });

        await proveTx(token.mint(user.address, 50));
        await proveTx(token.premintIncrease(user.address, 50, timestamp));
        await proveTx(token.freeze(user.address, 200));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 200, ID));
        await increaseBlockTimestampTo(timestamp);
        expectedBalance.premint -= 50;
        await expect(token.transferWithId(user.address, nonRestrictionAccount.address, 120, ID))
          .to.be.revertedWith(REVERT_MESSAGE_ERC20_TRANSFER_AMOUNT_EXCEEDS_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });
    });
  });

  describe("Frozen, restricted and preminted balances", async () => {
    let timestamp: number;
    before(async () => {
      timestamp = (await getLatestBlockTimestamp()) + 100;
    });
    describe("Function 'transfer()'", async () => {
      it("Transfer to restriction account without release awaiting - test 20 - success", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 30,
          restrictedToIdBalance: 10,
          restrictedToAnyIdBalance: 10,
          premintedBalance: 30
        });

        await proveTx(token.mint(user.address, 70));
        await proveTx(token.premintIncrease(user.address, 30, timestamp));
        await proveTx(token.freeze(user.address, 30));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 10, ID));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 10, ANY_ID));
        await expect(connect(token, user).transfer(restrictionAccount.address, 20))
          .to.changeTokenBalances(
            token,
            [user, restrictionAccount],
            [-20, 20]
          );

        expectedBalance.total -= 20;
        expectedBalance.free -= 20;

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to restriction account with release awaiting - test 20 - success", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 30,
          restrictedToIdBalance: 10,
          restrictedToAnyIdBalance: 10,
          premintedBalance: 30
        });

        await proveTx(token.mint(user.address, 70));
        await proveTx(token.premintIncrease(user.address, 30, timestamp));
        await proveTx(token.freeze(user.address, 30));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 10, ID));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 10, ANY_ID));
        await increaseBlockTimestampTo(timestamp);
        expectedBalance.premint -= 30;
        expectedBalance.free += 30;
        await expect(connect(token, user).transfer(restrictionAccount.address, 20))
          .to.changeTokenBalances(
            token,
            [user, restrictionAccount],
            [-20, 20]
          );

        expectedBalance.total -= 20;
        expectedBalance.free -= 20;

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account without release awaiting - test 20 - success", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 30,
          restrictedToIdBalance: 10,
          restrictedToAnyIdBalance: 10,
          premintedBalance: 30
        });

        await proveTx(token.mint(user.address, 70));
        await proveTx(token.premintIncrease(user.address, 30, timestamp));
        await proveTx(token.freeze(user.address, 30));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 10, ID));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 10, ANY_ID));
        await expect(connect(token, user).transfer(nonRestrictionAccount.address, 20))
          .to.changeTokenBalances(
            token,
            [user, nonRestrictionAccount],
            [-20, 20]
          );

        expectedBalance.total -= 20;
        expectedBalance.free -= 20;

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account with release awaiting - test 20 - success", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 30,
          restrictedToIdBalance: 10,
          restrictedToAnyIdBalance: 10,
          premintedBalance: 30
        });

        await proveTx(token.mint(user.address, 70));
        await proveTx(token.premintIncrease(user.address, 30, timestamp));
        await proveTx(token.freeze(user.address, 30));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 10, ID));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 10, ANY_ID));
        await increaseBlockTimestampTo(timestamp);
        expectedBalance.premint -= 30;
        expectedBalance.free += 30;
        await expect(connect(token, user).transfer(nonRestrictionAccount.address, 20))
          .to.changeTokenBalances(
            token,
            [user, nonRestrictionAccount],
            [-20, 20]
          );

        expectedBalance.total -= 20;
        expectedBalance.free -= 20;

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to restriction account without release awaiting - test 40 - fail - Restricted balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 30,
          restrictedToIdBalance: 10,
          restrictedToAnyIdBalance: 10,
          premintedBalance: 30
        });

        await proveTx(token.mint(user.address, 70));
        await proveTx(token.premintIncrease(user.address, 30, timestamp));
        await proveTx(token.freeze(user.address, 30));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 10, ID));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 10, ANY_ID));
        await expect(connect(token, user).transfer(restrictionAccount.address, 40))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_RESTRICTED_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to restriction account with release awaiting - test 40 - success", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 30,
          restrictedToIdBalance: 10,
          restrictedToAnyIdBalance: 10,
          premintedBalance: 30
        });

        await proveTx(token.mint(user.address, 70));
        await proveTx(token.premintIncrease(user.address, 30, timestamp));
        await proveTx(token.freeze(user.address, 30));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 10, ID));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 10, ANY_ID));
        await increaseBlockTimestampTo(timestamp);
        expectedBalance.premint -= 30;
        expectedBalance.free += 30;
        await expect(connect(token, user).transfer(restrictionAccount.address, 40))
          .to.changeTokenBalances(
            token,
            [user, restrictionAccount],
            [-40, 40]
          );

        expectedBalance.total -= 40;
        expectedBalance.free -= 40;

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account without release awaiting - test 40 - fail - Restricted balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 30,
          restrictedToIdBalance: 10,
          restrictedToAnyIdBalance: 10,
          premintedBalance: 30
        });

        await proveTx(token.mint(user.address, 70));
        await proveTx(token.premintIncrease(user.address, 30, timestamp));
        await proveTx(token.freeze(user.address, 30));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 10, ID));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 10, ANY_ID));
        await expect(connect(token, user).transfer(nonRestrictionAccount.address, 40))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_RESTRICTED_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account with release awaiting - test 40 - success", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 30,
          restrictedToIdBalance: 10,
          restrictedToAnyIdBalance: 10,
          premintedBalance: 30
        });

        await proveTx(token.mint(user.address, 70));
        await proveTx(token.premintIncrease(user.address, 30, timestamp));
        await proveTx(token.freeze(user.address, 30));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 10, ID));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 10, ANY_ID));
        await increaseBlockTimestampTo(timestamp);
        expectedBalance.premint -= 30;
        expectedBalance.free += 30;
        await expect(connect(token, user).transfer(nonRestrictionAccount.address, 40))
          .to.changeTokenBalances(
            token,
            [user, nonRestrictionAccount],
            [-40, 40]
          );

        expectedBalance.total -= 40;
        expectedBalance.free -= 40;

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to restriction account without release awaiting - test 60 - fail - Frozen balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 30,
          restrictedToIdBalance: 10,
          restrictedToAnyIdBalance: 10,
          premintedBalance: 30
        });

        await proveTx(token.mint(user.address, 70));
        await proveTx(token.premintIncrease(user.address, 30, timestamp));
        await proveTx(token.freeze(user.address, 30));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 10, ID));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 10, ANY_ID));
        await expect(connect(token, user).transfer(restrictionAccount.address, 60))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_FROZEN_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to restriction account with release awaiting - test 60 - fail - Restricted balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 30,
          restrictedToIdBalance: 10,
          restrictedToAnyIdBalance: 10,
          premintedBalance: 30
        });

        await proveTx(token.mint(user.address, 70));
        await proveTx(token.premintIncrease(user.address, 30, timestamp));
        await proveTx(token.freeze(user.address, 30));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 10, ID));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 10, ANY_ID));
        await increaseBlockTimestampTo(timestamp);
        expectedBalance.premint -= 30;
        expectedBalance.free += 30;
        await expect(connect(token, user).transfer(restrictionAccount.address, 60))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_RESTRICTED_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account without release awaiting - test 60 - fail - Frozen balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 30,
          restrictedToIdBalance: 10,
          restrictedToAnyIdBalance: 10,
          premintedBalance: 30
        });

        await proveTx(token.mint(user.address, 70));
        await proveTx(token.premintIncrease(user.address, 30, timestamp));
        await proveTx(token.freeze(user.address, 30));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 10, ID));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 10, ANY_ID));
        await expect(connect(token, user).transfer(nonRestrictionAccount.address, 60))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_FROZEN_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account with release awaiting - test 60 - fail - Restricted balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 30,
          restrictedToIdBalance: 10,
          restrictedToAnyIdBalance: 10,
          premintedBalance: 30
        });

        await proveTx(token.mint(user.address, 70));
        await proveTx(token.premintIncrease(user.address, 30, timestamp));
        await proveTx(token.freeze(user.address, 30));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 10, ID));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 10, ANY_ID));
        await increaseBlockTimestampTo(timestamp);
        expectedBalance.premint -= 30;
        expectedBalance.free += 30;
        await expect(connect(token, user).transfer(nonRestrictionAccount.address, 60))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_RESTRICTED_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to restriction account without release awaiting - test 80 - fail - Preminted balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 30,
          restrictedToIdBalance: 10,
          restrictedToAnyIdBalance: 10,
          premintedBalance: 30
        });

        await proveTx(token.mint(user.address, 70));
        await proveTx(token.premintIncrease(user.address, 30, timestamp));
        await proveTx(token.freeze(user.address, 30));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 10, ID));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 10, ANY_ID));
        await expect(connect(token, user).transfer(restrictionAccount.address, 80))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_PREMINT_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to restriction account with release awaiting - test 80 - fail - Frozen balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 30,
          restrictedToIdBalance: 10,
          restrictedToAnyIdBalance: 10,
          premintedBalance: 30
        });

        await proveTx(token.mint(user.address, 70));
        await proveTx(token.premintIncrease(user.address, 30, timestamp));
        await proveTx(token.freeze(user.address, 30));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 10, ID));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 10, ANY_ID));
        await increaseBlockTimestampTo(timestamp);
        expectedBalance.premint -= 30;
        expectedBalance.free += 30;
        await expect(connect(token, user).transfer(restrictionAccount.address, 80))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_FROZEN_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account without release awaiting - test 80 - fail - Preminted balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 30,
          restrictedToIdBalance: 10,
          restrictedToAnyIdBalance: 10,
          premintedBalance: 30
        });

        await proveTx(token.mint(user.address, 70));
        await proveTx(token.premintIncrease(user.address, 30, timestamp));
        await proveTx(token.freeze(user.address, 30));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 10, ID));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 10, ANY_ID));
        await expect(connect(token, user).transfer(nonRestrictionAccount.address, 80))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_PREMINT_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account with release awaiting - test 80 - fail - Frozen balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 30,
          restrictedToIdBalance: 10,
          restrictedToAnyIdBalance: 10,
          premintedBalance: 30
        });

        await proveTx(token.mint(user.address, 70));
        await proveTx(token.premintIncrease(user.address, 30, timestamp));
        await proveTx(token.freeze(user.address, 30));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 10, ID));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 10, ANY_ID));
        await increaseBlockTimestampTo(timestamp);
        expectedBalance.premint -= 30;
        expectedBalance.free += 30;
        await expect(connect(token, user).transfer(nonRestrictionAccount.address, 80))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_FROZEN_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to restriction account without release awaiting - test 100 - fail - Preminted balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 30,
          restrictedToIdBalance: 10,
          restrictedToAnyIdBalance: 10,
          premintedBalance: 30
        });

        await proveTx(token.mint(user.address, 70));
        await proveTx(token.premintIncrease(user.address, 30, timestamp));
        await proveTx(token.freeze(user.address, 30));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 10, ID));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 10, ANY_ID));
        await expect(connect(token, user).transfer(restrictionAccount.address, 100))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_PREMINT_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to restriction account with release awaiting - test 100 - fail - Frozen balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 30,
          restrictedToIdBalance: 10,
          restrictedToAnyIdBalance: 10,
          premintedBalance: 30
        });

        await proveTx(token.mint(user.address, 70));
        await proveTx(token.premintIncrease(user.address, 30, timestamp));
        await proveTx(token.freeze(user.address, 30));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 10, ID));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 10, ANY_ID));
        await increaseBlockTimestampTo(timestamp);
        expectedBalance.premint -= 30;
        expectedBalance.free += 30;
        await expect(connect(token, user).transfer(restrictionAccount.address, 100))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_FROZEN_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account without release awaiting - test 100 - fail - Preminted balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 30,
          restrictedToIdBalance: 10,
          restrictedToAnyIdBalance: 10,
          premintedBalance: 30
        });

        await proveTx(token.mint(user.address, 70));
        await proveTx(token.premintIncrease(user.address, 30, timestamp));
        await proveTx(token.freeze(user.address, 30));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 10, ID));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 10, ANY_ID));
        await expect(connect(token, user).transfer(nonRestrictionAccount.address, 100))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_PREMINT_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account with release awaiting - test 100 - fail - Frozen balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 30,
          restrictedToIdBalance: 10,
          restrictedToAnyIdBalance: 10,
          premintedBalance: 30
        });

        await proveTx(token.mint(user.address, 70));
        await proveTx(token.premintIncrease(user.address, 30, timestamp));
        await proveTx(token.freeze(user.address, 30));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 10, ID));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 10, ANY_ID));
        await increaseBlockTimestampTo(timestamp);
        expectedBalance.premint -= 30;
        expectedBalance.free += 30;
        await expect(connect(token, user).transfer(nonRestrictionAccount.address, 100))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_FROZEN_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to restriction account without release awaiting - test 120 - fail - ERC20 balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 30,
          restrictedToIdBalance: 10,
          restrictedToAnyIdBalance: 10,
          premintedBalance: 30
        });

        await proveTx(token.mint(user.address, 70));
        await proveTx(token.premintIncrease(user.address, 30, timestamp));
        await proveTx(token.freeze(user.address, 30));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 10, ID));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 10, ANY_ID));
        await expect(connect(token, user).transfer(restrictionAccount.address, 120))
          .to.be.revertedWith(REVERT_MESSAGE_ERC20_TRANSFER_AMOUNT_EXCEEDS_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to restriction account with release awaiting - test 120 - fail - ERC20 balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 30,
          restrictedToIdBalance: 10,
          restrictedToAnyIdBalance: 10,
          premintedBalance: 30
        });

        await proveTx(token.mint(user.address, 70));
        await proveTx(token.premintIncrease(user.address, 30, timestamp));
        await proveTx(token.freeze(user.address, 30));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 10, ID));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 10, ANY_ID));
        await increaseBlockTimestampTo(timestamp);
        expectedBalance.premint -= 30;
        expectedBalance.free += 30;
        await expect(connect(token, user).transfer(restrictionAccount.address, 120))
          .to.be.revertedWith(REVERT_MESSAGE_ERC20_TRANSFER_AMOUNT_EXCEEDS_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account without release awaiting - test 120 - fail - ERC20 balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 30,
          restrictedToIdBalance: 10,
          restrictedToAnyIdBalance: 10,
          premintedBalance: 30
        });

        await proveTx(token.mint(user.address, 70));
        await proveTx(token.premintIncrease(user.address, 30, timestamp));
        await proveTx(token.freeze(user.address, 30));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 10, ID));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 10, ANY_ID));
        await expect(connect(token, user).transfer(nonRestrictionAccount.address, 120))
          .to.be.revertedWith(REVERT_MESSAGE_ERC20_TRANSFER_AMOUNT_EXCEEDS_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account with release awaiting - test 120 - fail - ERC20 balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 30,
          restrictedToIdBalance: 10,
          restrictedToAnyIdBalance: 10,
          premintedBalance: 30
        });

        await proveTx(token.mint(user.address, 70));
        await proveTx(token.premintIncrease(user.address, 30, timestamp));
        await proveTx(token.freeze(user.address, 30));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 10, ID));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 10, ANY_ID));
        await increaseBlockTimestampTo(timestamp);
        expectedBalance.premint -= 30;
        expectedBalance.free += 30;
        await expect(connect(token, user).transfer(nonRestrictionAccount.address, 120))
          .to.be.revertedWith(REVERT_MESSAGE_ERC20_TRANSFER_AMOUNT_EXCEEDS_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });
    });

    describe("Function 'transferFrozen'", async () => {
      it("Transfer to restriction account without release awaiting - test 20 - success", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 30,
          restrictedToIdBalance: 10,
          restrictedToAnyIdBalance: 10,
          premintedBalance: 30
        });

        await proveTx(token.mint(user.address, 70));
        await proveTx(token.premintIncrease(user.address, 30, timestamp));
        await proveTx(token.freeze(user.address, 30));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 10, ID));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 10, ANY_ID));
        await expect(token.transferFrozen(user.address, restrictionAccount.address, 20))
          .to.changeTokenBalances(
            token,
            [user, restrictionAccount],
            [-20, 20]
          );

        expectedBalance.total -= 20;
        expectedBalance.frozen -= 20;

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to restriction account with release awaiting - test 20 - success", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 30,
          restrictedToIdBalance: 10,
          restrictedToAnyIdBalance: 10,
          premintedBalance: 30
        });

        await proveTx(token.mint(user.address, 70));
        await proveTx(token.premintIncrease(user.address, 30, timestamp));
        await proveTx(token.freeze(user.address, 30));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 10, ID));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 10, ANY_ID));
        await increaseBlockTimestampTo(timestamp);
        expectedBalance.premint -= 30;
        expectedBalance.free += 30;
        await expect(token.transferFrozen(user.address, restrictionAccount.address, 20))
          .to.changeTokenBalances(
            token,
            [user, restrictionAccount],
            [-20, 20]
          );

        expectedBalance.total -= 20;
        expectedBalance.frozen -= 20;

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account without release awaiting - test 20 - success", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 30,
          restrictedToIdBalance: 10,
          restrictedToAnyIdBalance: 10,
          premintedBalance: 30
        });

        await proveTx(token.mint(user.address, 70));
        await proveTx(token.premintIncrease(user.address, 30, timestamp));
        await proveTx(token.freeze(user.address, 30));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 10, ID));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 10, ANY_ID));
        await expect(token.transferFrozen(user.address, nonRestrictionAccount.address, 20))
          .to.changeTokenBalances(
            token,
            [user, nonRestrictionAccount],
            [-20, 20]
          );

        expectedBalance.total -= 20;
        expectedBalance.frozen -= 20;

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account with release awaiting - test 20 - success", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 30,
          restrictedToIdBalance: 10,
          restrictedToAnyIdBalance: 10,
          premintedBalance: 30
        });

        await proveTx(token.mint(user.address, 70));
        await proveTx(token.premintIncrease(user.address, 30, timestamp));
        await proveTx(token.freeze(user.address, 30));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 10, ID));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 10, ANY_ID));
        await increaseBlockTimestampTo(timestamp);
        expectedBalance.premint -= 30;
        expectedBalance.free += 30;
        await expect(token.transferFrozen(user.address, nonRestrictionAccount.address, 20))
          .to.changeTokenBalances(
            token,
            [user, nonRestrictionAccount],
            [-20, 20]
          );

        expectedBalance.total -= 20;
        expectedBalance.frozen -= 20;

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to restriction account without release awaiting - test 40 - fail - Lack of frozen balance", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 30,
          restrictedToIdBalance: 10,
          restrictedToAnyIdBalance: 10,
          premintedBalance: 30
        });

        await proveTx(token.mint(user.address, 70));
        await proveTx(token.premintIncrease(user.address, 30, timestamp));
        await proveTx(token.freeze(user.address, 30));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 10, ID));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 10, ANY_ID));
        await expect(token.transferFrozen(user.address, restrictionAccount.address, 40))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_LACK_OF_FROZEN_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to restriction account with release awaiting - test 40 - fail - Lack of frozen balance", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 30,
          restrictedToIdBalance: 10,
          restrictedToAnyIdBalance: 10,
          premintedBalance: 30
        });

        await proveTx(token.mint(user.address, 70));
        await proveTx(token.premintIncrease(user.address, 30, timestamp));
        await proveTx(token.freeze(user.address, 30));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 10, ID));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 10, ANY_ID));
        await increaseBlockTimestampTo(timestamp);
        expectedBalance.premint -= 30;
        expectedBalance.free += 30;
        await expect(token.transferFrozen(user.address, restrictionAccount.address, 40))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_LACK_OF_FROZEN_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account without release awaiting - test 40 - fail - Lack of frozen balance", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 30,
          restrictedToIdBalance: 10,
          restrictedToAnyIdBalance: 10,
          premintedBalance: 30
        });

        await proveTx(token.mint(user.address, 70));
        await proveTx(token.premintIncrease(user.address, 30, timestamp));
        await proveTx(token.freeze(user.address, 30));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 10, ID));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 10, ANY_ID));
        await expect(token.transferFrozen(user.address, nonRestrictionAccount.address, 40))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_LACK_OF_FROZEN_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account with release awaiting - test 40 - fail - Lack of frozen balance", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 30,
          restrictedToIdBalance: 10,
          restrictedToAnyIdBalance: 10,
          premintedBalance: 30
        });

        await proveTx(token.mint(user.address, 70));
        await proveTx(token.premintIncrease(user.address, 30, timestamp));
        await proveTx(token.freeze(user.address, 30));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 10, ID));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 10, ANY_ID));
        await increaseBlockTimestampTo(timestamp);
        expectedBalance.premint -= 30;
        expectedBalance.free += 30;
        await expect(token.transferFrozen(user.address, nonRestrictionAccount.address, 40))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_LACK_OF_FROZEN_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to restriction account without release awaiting - test 60 - fail - Lack of frozen balance", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 30,
          restrictedToIdBalance: 10,
          restrictedToAnyIdBalance: 10,
          premintedBalance: 30
        });

        await proveTx(token.mint(user.address, 70));
        await proveTx(token.premintIncrease(user.address, 30, timestamp));
        await proveTx(token.freeze(user.address, 30));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 10, ID));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 10, ANY_ID));
        await expect(token.transferFrozen(user.address, restrictionAccount.address, 60))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_LACK_OF_FROZEN_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to restriction account with release awaiting - test 60 - fail - Lack of frozen balance", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 30,
          restrictedToIdBalance: 10,
          restrictedToAnyIdBalance: 10,
          premintedBalance: 30
        });

        await proveTx(token.mint(user.address, 70));
        await proveTx(token.premintIncrease(user.address, 30, timestamp));
        await proveTx(token.freeze(user.address, 30));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 10, ID));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 10, ANY_ID));
        await increaseBlockTimestampTo(timestamp);
        expectedBalance.premint -= 30;
        expectedBalance.free += 30;
        await expect(token.transferFrozen(user.address, restrictionAccount.address, 60))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_LACK_OF_FROZEN_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account without release awaiting - test 60 - fail - Lack of frozen balance", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 30,
          restrictedToIdBalance: 10,
          restrictedToAnyIdBalance: 10,
          premintedBalance: 30
        });

        await proveTx(token.mint(user.address, 70));
        await proveTx(token.premintIncrease(user.address, 30, timestamp));
        await proveTx(token.freeze(user.address, 30));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 10, ID));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 10, ANY_ID));
        await expect(token.transferFrozen(user.address, nonRestrictionAccount.address, 60))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_LACK_OF_FROZEN_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account with release awaiting - test 60 - fail - Lack of frozen balance", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 30,
          restrictedToIdBalance: 10,
          restrictedToAnyIdBalance: 10,
          premintedBalance: 30
        });

        await proveTx(token.mint(user.address, 70));
        await proveTx(token.premintIncrease(user.address, 30, timestamp));
        await proveTx(token.freeze(user.address, 30));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 10, ID));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 10, ANY_ID));
        await increaseBlockTimestampTo(timestamp);
        expectedBalance.premint -= 30;
        expectedBalance.free += 30;
        await expect(token.transferFrozen(user.address, nonRestrictionAccount.address, 60))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_LACK_OF_FROZEN_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to restriction account without release awaiting - test 80 - fail - Lack of frozen balance", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 30,
          restrictedToIdBalance: 10,
          restrictedToAnyIdBalance: 10,
          premintedBalance: 30
        });

        await proveTx(token.mint(user.address, 70));
        await proveTx(token.premintIncrease(user.address, 30, timestamp));
        await proveTx(token.freeze(user.address, 30));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 10, ID));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 10, ANY_ID));
        await expect(token.transferFrozen(user.address, restrictionAccount.address, 80))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_LACK_OF_FROZEN_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to restriction account with release awaiting - test 80 - fail - Lack of frozen balance", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 30,
          restrictedToIdBalance: 10,
          restrictedToAnyIdBalance: 10,
          premintedBalance: 30
        });

        await proveTx(token.mint(user.address, 70));
        await proveTx(token.premintIncrease(user.address, 30, timestamp));
        await proveTx(token.freeze(user.address, 30));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 10, ID));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 10, ANY_ID));
        await increaseBlockTimestampTo(timestamp);
        expectedBalance.premint -= 30;
        expectedBalance.free += 30;
        await expect(token.transferFrozen(user.address, restrictionAccount.address, 80))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_LACK_OF_FROZEN_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account without release awaiting - test 80 - fail - Lack of frozen balance", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 30,
          restrictedToIdBalance: 10,
          restrictedToAnyIdBalance: 10,
          premintedBalance: 30
        });

        await proveTx(token.mint(user.address, 70));
        await proveTx(token.premintIncrease(user.address, 30, timestamp));
        await proveTx(token.freeze(user.address, 30));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 10, ID));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 10, ANY_ID));
        await expect(token.transferFrozen(user.address, nonRestrictionAccount.address, 80))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_LACK_OF_FROZEN_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account with release awaiting - test 80 - fail - Lack of frozen balance", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 30,
          restrictedToIdBalance: 10,
          restrictedToAnyIdBalance: 10,
          premintedBalance: 30
        });

        await proveTx(token.mint(user.address, 70));
        await proveTx(token.premintIncrease(user.address, 30, timestamp));
        await proveTx(token.freeze(user.address, 30));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 10, ID));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 10, ANY_ID));
        await increaseBlockTimestampTo(timestamp);
        expectedBalance.premint -= 30;
        expectedBalance.free += 30;
        await expect(token.transferFrozen(user.address, nonRestrictionAccount.address, 80))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_LACK_OF_FROZEN_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to restriction account without release awaiting - test 100 - fail - Lack of frozen balance", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 30,
          restrictedToIdBalance: 10,
          restrictedToAnyIdBalance: 10,
          premintedBalance: 30
        });

        await proveTx(token.mint(user.address, 70));
        await proveTx(token.premintIncrease(user.address, 30, timestamp));
        await proveTx(token.freeze(user.address, 30));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 10, ID));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 10, ANY_ID));
        await expect(token.transferFrozen(user.address, restrictionAccount.address, 100))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_LACK_OF_FROZEN_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to restriction account with release awaiting - test 100 - fail - Lack of frozen balance", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 30,
          restrictedToIdBalance: 10,
          restrictedToAnyIdBalance: 10,
          premintedBalance: 30
        });

        await proveTx(token.mint(user.address, 70));
        await proveTx(token.premintIncrease(user.address, 30, timestamp));
        await proveTx(token.freeze(user.address, 30));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 10, ID));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 10, ANY_ID));
        await increaseBlockTimestampTo(timestamp);
        expectedBalance.premint -= 30;
        expectedBalance.free += 30;
        await expect(token.transferFrozen(user.address, restrictionAccount.address, 100))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_LACK_OF_FROZEN_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account without release awaiting - test 100 - fail - Lack of frozen balance", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 30,
          restrictedToIdBalance: 10,
          restrictedToAnyIdBalance: 10,
          premintedBalance: 30
        });

        await proveTx(token.mint(user.address, 70));
        await proveTx(token.premintIncrease(user.address, 30, timestamp));
        await proveTx(token.freeze(user.address, 30));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 10, ID));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 10, ANY_ID));
        await expect(token.transferFrozen(user.address, nonRestrictionAccount.address, 100))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_LACK_OF_FROZEN_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account with release awaiting - test 100 - fail - Lack of frozen balance", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 30,
          restrictedToIdBalance: 10,
          restrictedToAnyIdBalance: 10,
          premintedBalance: 30
        });

        await proveTx(token.mint(user.address, 70));
        await proveTx(token.premintIncrease(user.address, 30, timestamp));
        await proveTx(token.freeze(user.address, 30));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 10, ID));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 10, ANY_ID));
        await increaseBlockTimestampTo(timestamp);
        expectedBalance.premint -= 30;
        expectedBalance.free += 30;
        await expect(token.transferFrozen(user.address, nonRestrictionAccount.address, 100))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_LACK_OF_FROZEN_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to restriction account without release awaiting - test 120 - fail - Lack of frozen balance", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 30,
          restrictedToIdBalance: 10,
          restrictedToAnyIdBalance: 10,
          premintedBalance: 30
        });

        await proveTx(token.mint(user.address, 70));
        await proveTx(token.premintIncrease(user.address, 30, timestamp));
        await proveTx(token.freeze(user.address, 30));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 10, ID));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 10, ANY_ID));
        await expect(token.transferFrozen(user.address, restrictionAccount.address, 120))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_LACK_OF_FROZEN_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to restriction account with release awaiting - test 120 - fail - Lack of frozen balance", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 30,
          restrictedToIdBalance: 10,
          restrictedToAnyIdBalance: 10,
          premintedBalance: 30
        });

        await proveTx(token.mint(user.address, 70));
        await proveTx(token.premintIncrease(user.address, 30, timestamp));
        await proveTx(token.freeze(user.address, 30));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 10, ID));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 10, ANY_ID));
        await increaseBlockTimestampTo(timestamp);
        expectedBalance.premint -= 30;
        expectedBalance.free += 30;
        await expect(token.transferFrozen(user.address, restrictionAccount.address, 120))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_LACK_OF_FROZEN_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account without release awaiting - test 120 - fail - Lack of frozen balance", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 30,
          restrictedToIdBalance: 10,
          restrictedToAnyIdBalance: 10,
          premintedBalance: 30
        });

        await proveTx(token.mint(user.address, 70));
        await proveTx(token.premintIncrease(user.address, 30, timestamp));
        await proveTx(token.freeze(user.address, 30));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 10, ID));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 10, ANY_ID));
        await expect(token.transferFrozen(user.address, nonRestrictionAccount.address, 120))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_LACK_OF_FROZEN_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account with release awaiting - test 120 - fail - Lack of frozen balance", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 30,
          restrictedToIdBalance: 10,
          restrictedToAnyIdBalance: 10,
          premintedBalance: 30
        });

        await proveTx(token.mint(user.address, 70));
        await proveTx(token.premintIncrease(user.address, 30, timestamp));
        await proveTx(token.freeze(user.address, 30));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 10, ID));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 10, ANY_ID));
        await increaseBlockTimestampTo(timestamp);
        expectedBalance.premint -= 30;
        expectedBalance.free += 30;
        await expect(token.transferFrozen(user.address, nonRestrictionAccount.address, 120))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_LACK_OF_FROZEN_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });
    });

    describe("Function 'transferWithId()'", async () => {
      it("Transfer to restriction account without release awaiting - test 20 - success", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 30,
          restrictedToIdBalance: 10,
          restrictedToAnyIdBalance: 10,
          premintedBalance: 30
        });

        await proveTx(token.mint(user.address, 70));
        await proveTx(token.premintIncrease(user.address, 30, timestamp));
        await proveTx(token.freeze(user.address, 30));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 10, ID));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 10, ANY_ID));
        await expect(token.transferWithId(user.address, restrictionAccount.address, 20, ID))
          .to.changeTokenBalances(
            token,
            [user, restrictionAccount],
            [-20, 20]
          );

        expectedBalance.total -= 20;
        expectedBalance.restricted -= 20;

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to restriction account with release awaiting - test 20 - success", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 30,
          restrictedToIdBalance: 10,
          restrictedToAnyIdBalance: 10,
          premintedBalance: 30
        });

        await proveTx(token.mint(user.address, 70));
        await proveTx(token.premintIncrease(user.address, 30, timestamp));
        await proveTx(token.freeze(user.address, 30));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 10, ID));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 10, ANY_ID));
        await increaseBlockTimestampTo(timestamp);
        expectedBalance.premint -= 30;
        expectedBalance.free += 30;
        await expect(token.transferWithId(user.address, restrictionAccount.address, 20, ID))
          .to.changeTokenBalances(
            token,
            [user, restrictionAccount],
            [-20, 20]
          );

        expectedBalance.total -= 20;
        expectedBalance.restricted -= 20;

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account without release awaiting - test 20 - success", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 30,
          restrictedToIdBalance: 10,
          restrictedToAnyIdBalance: 10,
          premintedBalance: 30
        });

        await proveTx(token.mint(user.address, 70));
        await proveTx(token.premintIncrease(user.address, 30, timestamp));
        await proveTx(token.freeze(user.address, 30));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 10, ID));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 10, ANY_ID));
        await expect(token.transferWithId(user.address, nonRestrictionAccount.address, 20, ID))
          .to.changeTokenBalances(
            token,
            [user, nonRestrictionAccount],
            [-20, 20]
          );

        expectedBalance.total -= 20;
        expectedBalance.free -= 20;

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account with release awaiting - test 20 - success", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 30,
          restrictedToIdBalance: 10,
          restrictedToAnyIdBalance: 10,
          premintedBalance: 30
        });

        await proveTx(token.mint(user.address, 70));
        await proveTx(token.premintIncrease(user.address, 30, timestamp));
        await proveTx(token.freeze(user.address, 30));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 10, ID));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 10, ANY_ID));
        await increaseBlockTimestampTo(timestamp);
        expectedBalance.premint -= 30;
        expectedBalance.free += 30;
        await expect(token.transferWithId(user.address, nonRestrictionAccount.address, 20, ID))
          .to.changeTokenBalances(
            token,
            [user, nonRestrictionAccount],
            [-20, 20]
          );

        expectedBalance.total -= 20;
        expectedBalance.free -= 20;

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to restriction account without release awaiting - test 40 - success", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 30,
          restrictedToIdBalance: 10,
          restrictedToAnyIdBalance: 10,
          premintedBalance: 30
        });

        await proveTx(token.mint(user.address, 70));
        await proveTx(token.premintIncrease(user.address, 30, timestamp));
        await proveTx(token.freeze(user.address, 30));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 10, ID));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 10, ANY_ID));
        await expect(token.transferWithId(user.address, restrictionAccount.address, 40, ID))
          .to.changeTokenBalances(
            token,
            [user, restrictionAccount],
            [-40, 40]
          );

        expectedBalance.total -= 40;
        expectedBalance.restricted -= 20;
        expectedBalance.free -= 20;

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to restriction account with release awaiting - test 40 - success", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 30,
          restrictedToIdBalance: 10,
          restrictedToAnyIdBalance: 10,
          premintedBalance: 30
        });

        await proveTx(token.mint(user.address, 70));
        await proveTx(token.premintIncrease(user.address, 30, timestamp));
        await proveTx(token.freeze(user.address, 30));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 10, ID));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 10, ANY_ID));
        await increaseBlockTimestampTo(timestamp);
        expectedBalance.premint -= 30;
        expectedBalance.free += 30;
        await expect(token.transferWithId(user.address, restrictionAccount.address, 40, ID))
          .to.changeTokenBalances(
            token,
            [user, restrictionAccount],
            [-40, 40]
          );

        expectedBalance.total -= 40;
        expectedBalance.restricted -= 20;
        expectedBalance.free -= 20;

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account without release awaiting - test 40 - fail - Restricted balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 30,
          restrictedToIdBalance: 10,
          restrictedToAnyIdBalance: 10,
          premintedBalance: 30
        });

        await proveTx(token.mint(user.address, 70));
        await proveTx(token.premintIncrease(user.address, 30, timestamp));
        await proveTx(token.freeze(user.address, 30));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 10, ID));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 10, ANY_ID));
        await expect(token.transferWithId(user.address, nonRestrictionAccount.address, 40, ID))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_RESTRICTED_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account with release awaiting - test 40 - success", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 30,
          restrictedToIdBalance: 10,
          restrictedToAnyIdBalance: 10,
          premintedBalance: 30
        });

        await proveTx(token.mint(user.address, 70));
        await proveTx(token.premintIncrease(user.address, 30, timestamp));
        await proveTx(token.freeze(user.address, 30));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 10, ID));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 10, ANY_ID));
        await increaseBlockTimestampTo(timestamp);
        expectedBalance.premint -= 30;
        expectedBalance.free += 30;
        await expect(token.transferWithId(user.address, nonRestrictionAccount.address, 40, ID))
          .to.changeTokenBalances(
            token,
            [user, nonRestrictionAccount],
            [-40, 40]
          );

        expectedBalance.total -= 40;
        expectedBalance.free -= 40;

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to restriction account without release awaiting - test 60 - fail - Frozen balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 30,
          restrictedToIdBalance: 10,
          restrictedToAnyIdBalance: 10,
          premintedBalance: 30
        });

        await proveTx(token.mint(user.address, 70));
        await proveTx(token.premintIncrease(user.address, 30, timestamp));
        await proveTx(token.freeze(user.address, 30));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 10, ID));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 10, ANY_ID));
        await expect(token.transferWithId(user.address, restrictionAccount.address, 60, ID))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_FROZEN_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to restriction account with release awaiting - test 60 - success", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 30,
          restrictedToIdBalance: 10,
          restrictedToAnyIdBalance: 10,
          premintedBalance: 30
        });

        await proveTx(token.mint(user.address, 70));
        await proveTx(token.premintIncrease(user.address, 30, timestamp));
        await proveTx(token.freeze(user.address, 30));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 10, ID));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 10, ANY_ID));
        await increaseBlockTimestampTo(timestamp);
        expectedBalance.premint -= 30;
        expectedBalance.free += 30;
        await expect(token.transferWithId(user.address, restrictionAccount.address, 60, ID))
          .to.changeTokenBalances(
            token,
            [user, restrictionAccount],
            [-60, 60]
          );

        expectedBalance.total -= 60;
        expectedBalance.restricted -= 20;
        expectedBalance.free -= 40;

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account without release awaiting - test 60 - fail - Frozen balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 30,
          restrictedToIdBalance: 10,
          restrictedToAnyIdBalance: 10,
          premintedBalance: 30
        });

        await proveTx(token.mint(user.address, 70));
        await proveTx(token.premintIncrease(user.address, 30, timestamp));
        await proveTx(token.freeze(user.address, 30));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 10, ID));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 10, ANY_ID));
        await expect(token.transferWithId(user.address, nonRestrictionAccount.address, 60, ID))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_FROZEN_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account with release awaiting - test 60 - fail - Restricted balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 30,
          restrictedToIdBalance: 10,
          restrictedToAnyIdBalance: 10,
          premintedBalance: 30
        });

        await proveTx(token.mint(user.address, 70));
        await proveTx(token.premintIncrease(user.address, 30, timestamp));
        await proveTx(token.freeze(user.address, 30));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 10, ID));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 10, ANY_ID));
        await increaseBlockTimestampTo(timestamp);
        expectedBalance.premint -= 30;
        expectedBalance.free += 30;
        await expect(token.transferWithId(user.address, nonRestrictionAccount.address, 60, ID))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_RESTRICTED_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to restriction account without release awaiting - test 80 - fail - Preminted balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 30,
          restrictedToIdBalance: 10,
          restrictedToAnyIdBalance: 10,
          premintedBalance: 30
        });

        await proveTx(token.mint(user.address, 70));
        await proveTx(token.premintIncrease(user.address, 30, timestamp));
        await proveTx(token.freeze(user.address, 30));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 10, ID));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 10, ANY_ID));
        await expect(token.transferWithId(user.address, restrictionAccount.address, 80, ID))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_PREMINT_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to restriction account with release awaiting - test 80 - fail - Frozen balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 30,
          restrictedToIdBalance: 10,
          restrictedToAnyIdBalance: 10,
          premintedBalance: 30
        });

        await proveTx(token.mint(user.address, 70));
        await proveTx(token.premintIncrease(user.address, 30, timestamp));
        await proveTx(token.freeze(user.address, 30));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 10, ID));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 10, ANY_ID));
        await increaseBlockTimestampTo(timestamp);
        expectedBalance.premint -= 30;
        expectedBalance.free += 30;
        await expect(token.transferWithId(user.address, restrictionAccount.address, 80, ID))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_FROZEN_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account without release awaiting - test 80 - fail - Preminted balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 30,
          restrictedToIdBalance: 10,
          restrictedToAnyIdBalance: 10,
          premintedBalance: 30
        });

        await proveTx(token.mint(user.address, 70));
        await proveTx(token.premintIncrease(user.address, 30, timestamp));
        await proveTx(token.freeze(user.address, 30));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 10, ID));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 10, ANY_ID));
        await expect(token.transferWithId(user.address, nonRestrictionAccount.address, 80, ID))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_PREMINT_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account with release awaiting - test 80 - fail - Frozen balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 30,
          restrictedToIdBalance: 10,
          restrictedToAnyIdBalance: 10,
          premintedBalance: 30
        });

        await proveTx(token.mint(user.address, 70));
        await proveTx(token.premintIncrease(user.address, 30, timestamp));
        await proveTx(token.freeze(user.address, 30));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 10, ID));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 10, ANY_ID));
        await increaseBlockTimestampTo(timestamp);
        expectedBalance.premint -= 30;
        expectedBalance.free += 30;
        await expect(token.transferWithId(user.address, nonRestrictionAccount.address, 80, ID))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_FROZEN_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to restriction account without release awaiting - test 100 - fail - Preminted balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 30,
          restrictedToIdBalance: 10,
          restrictedToAnyIdBalance: 10,
          premintedBalance: 30
        });

        await proveTx(token.mint(user.address, 70));
        await proveTx(token.premintIncrease(user.address, 30, timestamp));
        await proveTx(token.freeze(user.address, 30));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 10, ID));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 10, ANY_ID));
        await expect(token.transferWithId(user.address, restrictionAccount.address, 100, ID))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_PREMINT_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to restriction account with release awaiting - test 100 - fail - Frozen balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 30,
          restrictedToIdBalance: 10,
          restrictedToAnyIdBalance: 10,
          premintedBalance: 30
        });

        await proveTx(token.mint(user.address, 70));
        await proveTx(token.premintIncrease(user.address, 30, timestamp));
        await proveTx(token.freeze(user.address, 30));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 10, ID));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 10, ANY_ID));
        await increaseBlockTimestampTo(timestamp);
        expectedBalance.premint -= 30;
        expectedBalance.free += 30;
        await expect(token.transferWithId(user.address, restrictionAccount.address, 100, ID))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_FROZEN_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account without release awaiting - test 100 - fail - Preminted balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 30,
          restrictedToIdBalance: 10,
          restrictedToAnyIdBalance: 10,
          premintedBalance: 30
        });

        await proveTx(token.mint(user.address, 70));
        await proveTx(token.premintIncrease(user.address, 30, timestamp));
        await proveTx(token.freeze(user.address, 30));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 10, ID));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 10, ANY_ID));
        await expect(token.transferWithId(user.address, nonRestrictionAccount.address, 100, ID))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_PREMINT_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account with release awaiting - test 100 - fail - Frozen balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 30,
          restrictedToIdBalance: 10,
          restrictedToAnyIdBalance: 10,
          premintedBalance: 30
        });

        await proveTx(token.mint(user.address, 70));
        await proveTx(token.premintIncrease(user.address, 30, timestamp));
        await proveTx(token.freeze(user.address, 30));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 10, ID));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 10, ANY_ID));
        await increaseBlockTimestampTo(timestamp);
        expectedBalance.premint -= 30;
        expectedBalance.free += 30;
        await expect(token.transferWithId(user.address, nonRestrictionAccount.address, 100, ID))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_FROZEN_AMOUNT);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to restriction account without release awaiting - test 120 - fail - ERC20 balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 30,
          restrictedToIdBalance: 10,
          restrictedToAnyIdBalance: 10,
          premintedBalance: 30
        });

        await proveTx(token.mint(user.address, 70));
        await proveTx(token.premintIncrease(user.address, 30, timestamp));
        await proveTx(token.freeze(user.address, 30));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 10, ID));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 10, ANY_ID));
        await expect(token.transferWithId(user.address, restrictionAccount.address, 120, ID))
          .to.be.revertedWith(REVERT_MESSAGE_ERC20_TRANSFER_AMOUNT_EXCEEDS_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to restriction account with release awaiting - test 120 - fail - ERC20 balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 30,
          restrictedToIdBalance: 10,
          restrictedToAnyIdBalance: 10,
          premintedBalance: 30
        });

        await proveTx(token.mint(user.address, 70));
        await proveTx(token.premintIncrease(user.address, 30, timestamp));
        await proveTx(token.freeze(user.address, 30));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 10, ID));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 10, ANY_ID));
        await increaseBlockTimestampTo(timestamp);
        expectedBalance.premint -= 30;
        expectedBalance.free += 30;
        await expect(token.transferWithId(user.address, restrictionAccount.address, 120, ID))
          .to.be.revertedWith(REVERT_MESSAGE_ERC20_TRANSFER_AMOUNT_EXCEEDS_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account without release awaiting - test 120 - fail - ERC20 balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 30,
          restrictedToIdBalance: 10,
          restrictedToAnyIdBalance: 10,
          premintedBalance: 30
        });

        await proveTx(token.mint(user.address, 70));
        await proveTx(token.premintIncrease(user.address, 30, timestamp));
        await proveTx(token.freeze(user.address, 30));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 10, ID));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 10, ANY_ID));
        await expect(token.transferWithId(user.address, nonRestrictionAccount.address, 120, ID))
          .to.be.revertedWith(REVERT_MESSAGE_ERC20_TRANSFER_AMOUNT_EXCEEDS_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });

      it("Transfer to non-restriction account with release awaiting - test 120 - fail - ERC20 balance exceeded", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const expectedBalance: ComplexBalance = constructComplexBalanceState({
          totalBalance: 100,
          frozenBalance: 30,
          restrictedToIdBalance: 10,
          restrictedToAnyIdBalance: 10,
          premintedBalance: 30
        });

        await proveTx(token.mint(user.address, 70));
        await proveTx(token.premintIncrease(user.address, 30, timestamp));
        await proveTx(token.freeze(user.address, 30));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 10, ID));
        await proveTx(token[RESTRICTION_INCREASE_V2](user.address, restrictionAccount.address, 10, ANY_ID));
        await increaseBlockTimestampTo(timestamp);
        expectedBalance.premint -= 30;
        expectedBalance.free += 30;
        await expect(token.transferWithId(user.address, nonRestrictionAccount.address, 120, ID))
          .to.be.revertedWith(REVERT_MESSAGE_ERC20_TRANSFER_AMOUNT_EXCEEDS_BALANCE);

        const actualBalance: ComplexBalance = await token.balanceOfComplex(user.address);
        assertComplexBalancesEquality(expectedBalance, actualBalance);
      });
    });
  });
});
