import { ethers, network, upgrades } from "hardhat";
import { expect } from "chai";
import { Contract, ContractFactory } from "ethers";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { connect, getLatestBlockTimestamp, increaseBlockTimestampTo, proveTx } from "../../test-utils/eth";

async function setUpFixture<T>(func: () => Promise<T>): Promise<T> {
  if (network.name === "hardhat") {
    return loadFixture(func);
  } else {
    return func();
  }
}

describe("Contract 'CWToken' - Premintable and Freezable scenarios", async () => {
  const TOKEN_NAME = "CW Token";
  const TOKEN_SYMBOL = "CWT";
  const MAX_PENDING_PREMINTS_COUNT = 5;

  const REVERT_ERROR_TRANSFER_EXCEEDED_FROZEN_AMOUNT = "TransferExceededFrozenAmount";
  const REVERT_ERROR_TRANSFER_EXCEEDED_PREMINT_AMOUNT = "TransferExceededPremintedAmount";
  const REVERT_MESSAGE_ERC20_TRANSFER_AMOUNT_EXCEEDS_BALANCE = "ERC20: transfer amount exceeds balance";
  const REVERT_MESSAGE_INSUFFICIENT_ALLOWANCE = "ERC20: insufficient allowance";
  const REVERT_ERROR_LACK_OF_FROZEN_BALANCE = "LackOfFrozenBalance";

  let tokenFactory: ContractFactory;
  let deployer: HardhatEthersSigner;
  let sender: HardhatEthersSigner;
  let receiver: HardhatEthersSigner;
  let freezer: HardhatEthersSigner;

  before(async () => {
    [deployer, sender, receiver, freezer] = await ethers.getSigners();
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
    await proveTx(token.configureFreezerBatch([deployer.address, freezer.address], true));
    await proveTx(token.updateMainMinter(deployer.address));
    await proveTx(token.configureMinter(deployer.address, 20));
    await proveTx(token.configureMaxPendingPremintsCount(MAX_PENDING_PREMINTS_COUNT));
    return { token };
  }

  async function checkComplexBalanceGetter(
    props: {
      token: Contract;
      amounts: {
        mint: number;
        premint: number;
        frozen: number;
      };
    }
  ) {
    const timestamp = (await getLatestBlockTimestamp()) + 100;
    const { token, amounts } = props;
    if (amounts.mint > 0) {
      await proveTx(token.mint(sender.address, amounts.mint));
    }
    if (amounts.premint > 0) {
      await proveTx(token.premintIncrease(sender.address, amounts.premint, timestamp));
    }
    if (amounts.frozen > 0) {
      await proveTx(token.freeze(sender.address, amounts.frozen));
    }

    const total = amounts.mint + amounts.premint;
    const detained = amounts.premint + amounts.frozen;
    const free = total > detained ? total - detained : 0;
    const complexBalance = await token.balanceOfComplex(sender.address);

    expect(complexBalance.total).to.eq(total);
    expect(complexBalance.free).to.eq(free);
    expect(complexBalance.premint).to.eq(amounts.premint);
    expect(complexBalance.frozen).to.eq(amounts.frozen);
    expect(complexBalance.restricted).to.eq(0);
  }

  describe("Function 'transferFrom()'", async () => {
    it("Executes as expected for non-trusted and trusted accounts", async () => {
      const maxAmount = ethers.MaxUint256;
      const userBalance = 123;

      const { token } = await setUpFixture(deployToken);
      await proveTx(token.updateMainMinter(deployer.address));
      await proveTx(token.configureMinter(deployer.address, maxAmount));
      await proveTx(token.mint(sender.address, userBalance));

      await expect(
        token.transferFrom(sender.address, deployer.address, userBalance)
      ).to.be.revertedWith(REVERT_MESSAGE_INSUFFICIENT_ALLOWANCE);

      await proveTx(token.configureTrustedAccount(deployer.address, true));

      await expect(
        token.transferFrom(sender.address, deployer.address, userBalance)
      ).to.be.changeTokenBalances(token, [sender, deployer], [-userBalance, +userBalance]);
    });
  });

  describe("Function 'balancesOfComplex()'", async () => {
    it("Returns correct values if detained balance is less than total balance", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await checkComplexBalanceGetter({ token, amounts: { mint: 15, premint: 5, frozen: 5 } });
    });

    it("Returns correct values if detained balance is bigger than total balance", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await checkComplexBalanceGetter({ token, amounts: { mint: 15, premint: 5, frozen: 15 } });
    });

    it("Returns correct values with no limited balances", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await checkComplexBalanceGetter({ token, amounts: { mint: 15, premint: 0, frozen: 0 } });
    });

    it("Returns correct values with no free balance", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await checkComplexBalanceGetter({ token, amounts: { mint: 0, premint: 5, frozen: 5 } });
    });

    it("Returns correct values with only premint balance", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await checkComplexBalanceGetter({ token, amounts: { mint: 0, premint: 5, frozen: 0 } });
    });

    it("Returns correct values with only frozen balance", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await checkComplexBalanceGetter({ token, amounts: { mint: 0, premint: 0, frozen: 5 } });
    });

    it("Returns correct values with no balances at all", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await checkComplexBalanceGetter({ token, amounts: { mint: 0, premint: 0, frozen: 0 } });
    });
  });

  describe("Function 'transfer()' when the total balance is 20", async () => {
    describe("Executes as expected if there are the frozen and premint balances and", async () => {
      let timestamp: number;
      beforeEach(async () => {
        timestamp = (await getLatestBlockTimestamp()) + 100;
      });
      it("5 tokens are transferred with release awaiting", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        await proveTx(token.mint(sender.address, 10));
        await proveTx(token.premintIncrease(sender.address, 10, timestamp));
        await proveTx(token.freeze(sender.address, 10));
        await increaseBlockTimestampTo(timestamp);
        await expect(
          connect(token, sender).transfer(receiver.address, 5)
        ).to.changeTokenBalances(
          token,
          [sender, receiver],
          [-5, 5]
        );
      });

      it("10 tokens are transferred with release awaiting", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        await proveTx(token.mint(sender.address, 10));
        await proveTx(token.premintIncrease(sender.address, 10, timestamp));
        await proveTx(token.freeze(sender.address, 10));
        await increaseBlockTimestampTo(timestamp);
        await expect(
          connect(token, sender).transfer(receiver.address, 10)
        ).to.changeTokenBalances(
          token,
          [sender, receiver],
          [-10, 10]
        );
      });

      it("15 tokens are transferred with release awaiting", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        await proveTx(token.mint(sender.address, 10));
        await proveTx(token.premintIncrease(sender.address, 10, timestamp));
        await proveTx(token.freeze(sender.address, 10));
        await increaseBlockTimestampTo(timestamp);
        await expect(
          connect(token, sender).transfer(receiver.address, 15)
        ).to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_FROZEN_AMOUNT);
      });

      it("20 tokens are transferred with release awaiting", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        await proveTx(token.mint(sender.address, 10));
        await proveTx(token.premintIncrease(sender.address, 10, timestamp));
        await proveTx(token.freeze(sender.address, 10));
        await increaseBlockTimestampTo(timestamp);
        await expect(
          connect(token, sender).transfer(receiver.address, 20)
        ).to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_FROZEN_AMOUNT);
      });

      it("25 tokens are transferred with release awaiting", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        await proveTx(token.mint(sender.address, 10));
        await proveTx(token.premintIncrease(sender.address, 10, timestamp));
        await proveTx(token.freeze(sender.address, 10));
        await increaseBlockTimestampTo(timestamp);
        await expect(
          connect(token, sender).transfer(receiver.address, 25)
        ).to.be.revertedWith(REVERT_MESSAGE_ERC20_TRANSFER_AMOUNT_EXCEEDS_BALANCE);
      });

      it("5 tokens are transferred with NO release awaiting", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        await proveTx(token.mint(sender.address, 10));
        await proveTx(token.premintIncrease(sender.address, 10, timestamp));
        await proveTx(token.freeze(sender.address, 10));
        await expect(
          connect(token, sender).transfer(receiver.address, 5)
        ).to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_FROZEN_AMOUNT);
      });

      it("10 tokens are transferred with NO release awaiting", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        await proveTx(token.mint(sender.address, 10));
        await proveTx(token.premintIncrease(sender.address, 10, timestamp));
        await proveTx(token.freeze(sender.address, 10));
        await expect(
          connect(token, sender).transfer(receiver.address, 10)
        ).to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_FROZEN_AMOUNT);
      });

      it("15 tokens are transferred with NO release awaiting", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        await proveTx(token.mint(sender.address, 10));
        await proveTx(token.premintIncrease(sender.address, 10, timestamp));
        await proveTx(token.freeze(sender.address, 10));
        await expect(
          connect(token, sender).transfer(receiver.address, 15)
        ).to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_PREMINT_AMOUNT);
      });

      it("20 tokens are transferred with NO release awaiting", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        await proveTx(token.mint(sender.address, 10));
        await proveTx(token.premintIncrease(sender.address, 10, timestamp));
        await proveTx(token.freeze(sender.address, 10));
        await expect(
          connect(token, sender).transfer(receiver.address, 20)
        ).to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_PREMINT_AMOUNT);
      });

      it("25 tokens are transferred with NO release awaiting", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        await proveTx(token.mint(sender.address, 10));
        await proveTx(token.premintIncrease(sender.address, 10, timestamp));
        await proveTx(token.freeze(sender.address, 10));
        await expect(
          connect(token, sender).transfer(receiver.address, 25)
        ).to.be.revertedWith(REVERT_MESSAGE_ERC20_TRANSFER_AMOUNT_EXCEEDS_BALANCE);
      });
    });

    describe("Executes as expected if there is the frozen balance only, no premint balance, and", async () => {
      it("5 tokens are transferred", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        await proveTx(token.mint(sender.address, 20));
        await proveTx(token.freeze(sender.address, 10));
        await expect(
          connect(token, sender).transfer(receiver.address, 5)
        ).to.changeTokenBalances(
          token,
          [sender, receiver],
          [-5, 5]
        );
      });

      it("10 tokens are transferred", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        await proveTx(token.mint(sender.address, 20));
        await proveTx(token.freeze(sender.address, 10));
        await expect(
          connect(token, sender).transfer(receiver.address, 10)
        ).to.changeTokenBalances(
          token,
          [sender, receiver],
          [-10, 10]
        );
      });

      it("15 tokens are transferred", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        await proveTx(token.mint(sender.address, 20));
        await proveTx(token.freeze(sender.address, 10));
        await expect(
          connect(token, sender).transfer(receiver.address, 15)
        ).to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_FROZEN_AMOUNT);
      });

      it("20 tokens are transferred", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        await proveTx(token.mint(sender.address, 20));
        await proveTx(token.freeze(sender.address, 10));
        await expect(
          connect(token, sender).transfer(receiver.address, 20)
        ).to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_FROZEN_AMOUNT);
      });

      it("25 tokens are transferred", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        await proveTx(token.mint(sender.address, 20));
        await proveTx(token.freeze(sender.address, 10));
        await expect(
          connect(token, sender).transfer(receiver.address, 25)
        ).to.be.revertedWith(REVERT_MESSAGE_ERC20_TRANSFER_AMOUNT_EXCEEDS_BALANCE);
      });
    });

    describe("Executes as expected if there is the premint balance only, no frozen balance, and", async () => {
      let timestamp: number;
      beforeEach(async () => {
        timestamp = await getLatestBlockTimestamp() + 100;
      });

      it("5 tokens are transferred with release awaiting", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        await proveTx(token.premintIncrease(sender.address, 20, timestamp));
        await increaseBlockTimestampTo(timestamp);
        await expect(
          connect(token, sender).transfer(receiver.address, 5)
        ).to.changeTokenBalances(
          token,
          [sender, receiver],
          [-5, 5]
        );
      });

      it("10 tokens are transferred with release awaiting", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        await proveTx(token.premintIncrease(sender.address, 20, timestamp));
        await increaseBlockTimestampTo(timestamp);
        await expect(
          connect(token, sender).transfer(receiver.address, 10)
        ).to.changeTokenBalances(
          token,
          [sender, receiver],
          [-10, 10]
        );
      });

      it("15 tokens are transferred with release awaiting", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        await proveTx(token.premintIncrease(sender.address, 20, timestamp));
        await increaseBlockTimestampTo(timestamp);
        await expect(
          connect(token, sender).transfer(receiver.address, 15)
        ).to.changeTokenBalances(
          token,
          [sender, receiver],
          [-15, 15]
        );
      });

      it("20 tokens are transferred with release awaiting", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        await proveTx(token.premintIncrease(sender.address, 20, timestamp));
        await increaseBlockTimestampTo(timestamp);
        await expect(
          connect(token, sender).transfer(receiver.address, 20)
        ).to.changeTokenBalances(
          token,
          [sender, receiver],
          [-20, 20]
        );
      });

      it("25 tokens are transferred with release awaiting", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        await proveTx(token.premintIncrease(sender.address, 20, timestamp));
        await increaseBlockTimestampTo(timestamp);
        await expect(
          connect(token, sender).transfer(receiver.address, 25)
        ).to.be.revertedWith(REVERT_MESSAGE_ERC20_TRANSFER_AMOUNT_EXCEEDS_BALANCE);
      });

      it("5 tokens are transferred with NO release awaiting with", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        await proveTx(token.premintIncrease(sender.address, 20, timestamp));
        await expect(
          connect(token, sender).transfer(receiver.address, 5)
        ).to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_PREMINT_AMOUNT);
      });

      it("10 tokens are transferred with NO release awaiting", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        await proveTx(token.premintIncrease(sender.address, 20, timestamp));
        await expect(
          connect(token, sender).transfer(receiver.address, 10)
        ).to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_PREMINT_AMOUNT);
      });

      it("15 tokens are transferred with NO release awaiting", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        await proveTx(token.premintIncrease(sender.address, 20, timestamp));
        await expect(
          connect(token, sender).transfer(receiver.address, 15)
        ).to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_PREMINT_AMOUNT);
      });

      it("20 tokens are transferred with NO release awaiting", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        await proveTx(token.premintIncrease(sender.address, 20, timestamp));
        await expect(
          connect(token, sender).transfer(receiver.address, 20)
        ).to.be.revertedWithCustomError(token, REVERT_ERROR_TRANSFER_EXCEEDED_PREMINT_AMOUNT);
      });

      it("25 tokens are transferred with NO release awaiting", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        await proveTx(token.premintIncrease(sender.address, 20, timestamp));
        await expect(
          connect(token, sender).transfer(receiver.address, 25)
        ).to.be.revertedWith(REVERT_MESSAGE_ERC20_TRANSFER_AMOUNT_EXCEEDS_BALANCE);
      });
    });

    describe("Executes as expected if there are no frozen or premint balances", async () => {
      it("5 tokens are transferred", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        await proveTx(token.mint(sender.address, 20));
        await expect(
          connect(token, sender).transfer(receiver.address, 5)
        ).to.changeTokenBalances(
          token,
          [sender, receiver],
          [-5, 5]
        );
      });

      it("10 tokens are transferred", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        await proveTx(token.mint(sender.address, 20));
        await expect(
          connect(token, sender).transfer(receiver.address, 10)
        ).to.changeTokenBalances(
          token,
          [sender, receiver],
          [-10, 10]
        );
      });

      it("15 tokens are transferred", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        await proveTx(token.mint(sender.address, 20));
        await expect(
          connect(token, sender).transfer(receiver.address, 15)
        ).to.changeTokenBalances(
          token,
          [sender, receiver],
          [-15, 15]
        );
      });

      it("20 tokens are transferred", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        await proveTx(token.mint(sender.address, 20));
        await expect(
          connect(token, sender).transfer(receiver.address, 20)
        ).to.changeTokenBalances(
          token,
          [sender, receiver],
          [-20, 20]
        );
      });

      it("25 tokens are transferred", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        await proveTx(token.mint(sender.address, 20));
        await expect(
          connect(token, sender).transfer(receiver.address, 25)
        ).to.be.revertedWith(REVERT_MESSAGE_ERC20_TRANSFER_AMOUNT_EXCEEDS_BALANCE);
      });
    });
  });

  describe("Function 'transferFrozen()' when the total balance is 20", async () => {
    describe("Executes as expected if there is the frozen balance only, it equals 5, and", async () => {
      it("5 tokens are transferred", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        await proveTx(token.mint(sender.address, 20));
        await proveTx(token.freeze(sender.address, 5));
        await expect(
          connect(token, freezer).transferFrozen(sender, receiver, 5)
        ).to.changeTokenBalances(
          token,
          [sender, receiver],
          [-5, 5]
        );
        expect(await token.balanceOfFrozen(sender.address)).to.eq(0);
      });

      it("10 tokens are transferred", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        await proveTx(token.mint(sender.address, 20));
        await proveTx(token.freeze(sender.address, 5));
        await expect(
          connect(token, freezer).transferFrozen(sender, receiver, 10)
        ).to.be.revertedWithCustomError(token, REVERT_ERROR_LACK_OF_FROZEN_BALANCE);
      });
    });

    describe("Executes as expected if there is the frozen balance is greater than total balance", async () => {
      it("5 tokens are transferred", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        await proveTx(token.mint(sender.address, 20));
        await proveTx(token.freeze(sender.address, 25));
        await expect(
          connect(token, freezer).transferFrozen(sender, receiver.address, 5)
        ).to.changeTokenBalances(
          token,
          [sender, receiver],
          [-5, 5]
        );
        expect(await token.balanceOfFrozen(sender.address)).to.eq(20);
      });

      it("20 tokens are transferred", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        await proveTx(token.mint(sender.address, 20));
        await proveTx(token.freeze(sender.address, 25));
        await expect(
          connect(token, freezer).transferFrozen(sender, receiver.address, 20)
        ).to.changeTokenBalances(
          token,
          [sender, receiver],
          [-20, 20]
        );
        expect(await token.balanceOfFrozen(sender.address)).to.eq(5);
      });

      it("25 tokens are transferred", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        await proveTx(token.mint(sender.address, 20));
        await proveTx(token.freeze(sender.address, 25));
        await expect(
          connect(token, freezer).transferFrozen(sender, receiver.address, 25)
        ).to.be.revertedWith(REVERT_MESSAGE_ERC20_TRANSFER_AMOUNT_EXCEEDS_BALANCE);
      });
    });
  });
});
