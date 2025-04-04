import { ethers, network, upgrades } from "hardhat";
import { expect } from "chai";
import { Contract, ContractFactory } from "ethers";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { connect, getLatestBlockTimestamp, increaseBlockTimestampTo, proveTx } from "../../test-utils/eth";

interface TokenAmounts {
  minted: number;
  preminted: number;
  frozen: number;
}

async function setUpFixture<T>(func: () => Promise<T>): Promise<T> {
  if (network.name === "hardhat") {
    return loadFixture(func);
  } else {
    return func();
  }
}

function processPremintingRelease(amounts: TokenAmounts) {
  amounts.minted += amounts.preminted;
  amounts.preminted = 0;
}

async function awaitPremintingRelease(props: { timestamp: number; amounts?: TokenAmounts }) {
  await increaseBlockTimestampTo(props.timestamp);
  if (props.amounts) {
    processPremintingRelease(props.amounts);
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

  async function checkComplexBalance(props: {
    token: Contract;
    amounts: TokenAmounts;
  }) {
    const total = props.amounts.minted + props.amounts.preminted;
    const detained = props.amounts.preminted + props.amounts.frozen;
    const free = total > detained ? total - detained : 0;
    const actualComplexBalance = await props.token.balanceOfComplex(sender.address);

    expect(actualComplexBalance.total).to.eq(total);
    expect(actualComplexBalance.free).to.eq(free);
    expect(actualComplexBalance.premint).to.eq(props.amounts.preminted);
    expect(actualComplexBalance.frozen).to.eq(props.amounts.frozen);
    expect(actualComplexBalance.restricted).to.eq(0);
  }

  async function setUpComplexBalances(props: {
    token: Contract;
    amounts: TokenAmounts;
    timestamp?: number;
  }): Promise<TokenAmounts> {
    const { token, amounts, timestamp } = props;
    if (amounts.minted > 0) {
      await proveTx(token.mint(sender.address, amounts.minted));
    }
    if (amounts.preminted > 0) {
      if (timestamp) {
        await proveTx(token.premintIncrease(sender.address, amounts.preminted, timestamp));
      } else {
        throw Error("The timestamp for preminting release is not provided");
      }
    }
    if (amounts.frozen > 0) {
      await proveTx(token.freeze(sender.address, amounts.frozen));
    }

    return amounts;
  }

  async function checkComplexBalanceGetter(
    props: {
      token: Contract;
      amounts: TokenAmounts;
    }
  ) {
    const timestamp = (await getLatestBlockTimestamp()) + 100;
    const { token, amounts } = props;
    await setUpComplexBalances({ token, amounts, timestamp });
    await checkComplexBalance(props);
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
      await checkComplexBalanceGetter({ token, amounts: { minted: 15, preminted: 5, frozen: 5 } });
    });

    it("Returns correct values if detained balance is bigger than total balance", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await checkComplexBalanceGetter({ token, amounts: { minted: 15, preminted: 5, frozen: 15 } });
    });

    it("Returns correct values with no limited balances", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await checkComplexBalanceGetter({ token, amounts: { minted: 15, preminted: 0, frozen: 0 } });
    });

    it("Returns correct values with no free balance", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await checkComplexBalanceGetter({ token, amounts: { minted: 0, preminted: 5, frozen: 5 } });
    });

    it("Returns correct values with only premint balance", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await checkComplexBalanceGetter({ token, amounts: { minted: 0, preminted: 5, frozen: 0 } });
    });

    it("Returns correct values with only frozen balance", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await checkComplexBalanceGetter({ token, amounts: { minted: 0, preminted: 0, frozen: 5 } });
    });

    it("Returns correct values with no balances at all", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await checkComplexBalanceGetter({ token, amounts: { minted: 0, preminted: 0, frozen: 0 } });
    });
  });

  describe("Function 'transfer()' when the total balance is 20", async () => {
    async function executeTransferAndCheck(props: {
      initialAmounts: TokenAmounts;
      transferAmount: number;
      timestamp?: number;
      awaitPreminting?: boolean;
    }) {
      const { token } = await setUpFixture(deployAndConfigureToken);
      const { initialAmounts, transferAmount, timestamp, awaitPreminting } = props;
      const amounts = await setUpComplexBalances({ token, amounts: { ...initialAmounts }, timestamp });
      if (timestamp && awaitPreminting) {
        await awaitPremintingRelease({ timestamp, amounts });
      }
      await expect(
        connect(token, sender).transfer(receiver.address, transferAmount)
      ).to.changeTokenBalances(
        token,
        [sender, receiver],
        [-transferAmount, transferAmount]
      );
      amounts.minted -= transferAmount;
      await checkComplexBalance({ token, amounts });
    }

    async function failTransferWithCustomErrorAndCheck(props: {
      errorName: string;
      initialAmounts: TokenAmounts;
      transferAmount: number;
      timestamp?: number;
      awaitPreminting?: boolean;
    }) {
      const { token } = await setUpFixture(deployAndConfigureToken);
      const { initialAmounts, transferAmount, timestamp, awaitPreminting, errorName } = props;
      await setUpComplexBalances({ token, amounts: { ...initialAmounts }, timestamp });
      if (timestamp && awaitPreminting) {
        await awaitPremintingRelease({ timestamp });
      }
      await expect(
        connect(token, sender).transfer(receiver.address, transferAmount)
      ).to.be.revertedWithCustomError(token, errorName);
    }

    async function failTransferDueToLackOfBalanceAndCheck(props: {
      initialAmounts: TokenAmounts;
      transferAmount: number;
      timestamp?: number;
      awaitPreminting?: boolean;
    }) {
      const { token } = await setUpFixture(deployAndConfigureToken);
      const { initialAmounts, transferAmount, timestamp, awaitPreminting } = props;
      await setUpComplexBalances({ token, amounts: { ...initialAmounts }, timestamp });
      if (timestamp && awaitPreminting) {
        await awaitPremintingRelease({ timestamp });
      }
      await expect(
        connect(token, sender).transfer(receiver.address, transferAmount)
      ).to.be.revertedWith(REVERT_MESSAGE_ERC20_TRANSFER_AMOUNT_EXCEEDS_BALANCE);
    }

    describe("Executes as expected if there are the free, frozen, premint balances and", async () => {
      const initialAmounts: TokenAmounts = { minted: 15, preminted: 5, frozen: 5 };
      let timestamp: number;
      beforeEach(async () => {
        timestamp = (await getLatestBlockTimestamp()) + 100;
      });

      describe("Tokens are transferred before the preminting release and", async () => {
        it("5 tokens are transferred", async () => {
          await executeTransferAndCheck({
            initialAmounts,
            transferAmount: 5,
            timestamp,
            awaitPreminting: false
          });
        });

        it("10 tokens are transferred", async () => {
          await executeTransferAndCheck({
            initialAmounts,
            transferAmount: 10,
            timestamp,
            awaitPreminting: false
          });
        });

        it("15 tokens are transferred", async () => {
          await failTransferWithCustomErrorAndCheck({
            errorName: REVERT_ERROR_TRANSFER_EXCEEDED_FROZEN_AMOUNT,
            initialAmounts,
            transferAmount: 15,
            timestamp,
            awaitPreminting: false
          });
        });

        it("20 tokens are transferred", async () => {
          await failTransferWithCustomErrorAndCheck({
            errorName: REVERT_ERROR_TRANSFER_EXCEEDED_PREMINT_AMOUNT,
            initialAmounts,
            transferAmount: 20,
            timestamp,
            awaitPreminting: false
          });
        });

        it("25 tokens are transferred", async () => {
          await failTransferDueToLackOfBalanceAndCheck({
            initialAmounts,
            transferAmount: 25,
            timestamp,
            awaitPreminting: false
          });
        });
      });

      describe("Tokens are transferred after the preminting release and", async () => {
        // Skipping because it is similar to the next one
        it.skip("5 tokens are transferred", async () => {
          await executeTransferAndCheck({
            initialAmounts,
            transferAmount: 5,
            timestamp,
            awaitPreminting: true
          });
        });

        // Skipping because it is similar to the next one
        it.skip("10 tokens are transferred", async () => {
          await executeTransferAndCheck({
            initialAmounts,
            transferAmount: 10,
            timestamp,
            awaitPreminting: true
          });
        });

        it("15 tokens are transferred", async () => {
          await executeTransferAndCheck({
            initialAmounts,
            transferAmount: 15,
            timestamp,
            awaitPreminting: true
          });
        });

        it("20 tokens are transferred", async () => {
          await failTransferWithCustomErrorAndCheck({
            errorName: REVERT_ERROR_TRANSFER_EXCEEDED_FROZEN_AMOUNT,
            initialAmounts,
            transferAmount: 20,
            timestamp,
            awaitPreminting: true
          });
        });

        it("25 tokens are transferred", async () => {
          await failTransferDueToLackOfBalanceAndCheck({
            initialAmounts,
            transferAmount: 25,
            timestamp,
            awaitPreminting: true
          });
        });
      });
    });

    describe("Executes as expected if there are the free and frozen balance, no premint balance, and", async () => {
      const initialAmounts: TokenAmounts = { minted: 20, preminted: 0, frozen: 10 };

      // Skipping because it is similar to the next one
      it.skip("5 tokens are transferred", async () => {
        await executeTransferAndCheck({ initialAmounts, transferAmount: 5 });
      });

      it("10 tokens are transferred", async () => {
        await executeTransferAndCheck({ initialAmounts, transferAmount: 10 });
      });

      it("15 tokens are transferred", async () => {
        await failTransferWithCustomErrorAndCheck({
          errorName: REVERT_ERROR_TRANSFER_EXCEEDED_FROZEN_AMOUNT,
          initialAmounts,
          transferAmount: 15
        });
      });

      // Skipping because it is similar to the previous one
      it.skip("20 tokens are transferred", async () => {
        await failTransferWithCustomErrorAndCheck({
          errorName: REVERT_ERROR_TRANSFER_EXCEEDED_FROZEN_AMOUNT,
          initialAmounts,
          transferAmount: 20
        });
      });

      it("25 tokens are transferred", async () => {
        await failTransferDueToLackOfBalanceAndCheck({ initialAmounts, transferAmount: 25 });
      });
    });

    describe("Executes as expected if there are the free and premint balances, no frozen balance, and", async () => {
      const initialAmounts: TokenAmounts = { minted: 10, preminted: 10, frozen: 0 };
      let timestamp: number;
      beforeEach(async () => {
        timestamp = (await getLatestBlockTimestamp()) + 100;
      });

      describe("Tokens are transferred before the preminting release and", async () => {
        // Skipping because it is similar to the next one
        it.skip("5 tokens are transferred", async () => {
          await executeTransferAndCheck({
            initialAmounts,
            transferAmount: 5,
            timestamp,
            awaitPreminting: false
          });
        });

        it("10 tokens are transferred", async () => {
          await executeTransferAndCheck({
            initialAmounts,
            transferAmount: 10,
            timestamp,
            awaitPreminting: false
          });
        });

        it("15 tokens are transferred", async () => {
          await failTransferWithCustomErrorAndCheck({
            errorName: REVERT_ERROR_TRANSFER_EXCEEDED_PREMINT_AMOUNT,
            initialAmounts,
            transferAmount: 15,
            timestamp,
            awaitPreminting: false
          });
        });

        // Skipping because it is similar to the previous one
        it.skip("20 tokens are transferred", async () => {
          await failTransferWithCustomErrorAndCheck({
            errorName: REVERT_ERROR_TRANSFER_EXCEEDED_PREMINT_AMOUNT,
            initialAmounts,
            transferAmount: 20,
            timestamp,
            awaitPreminting: false
          });
        });

        it("25 tokens are transferred", async () => {
          await failTransferDueToLackOfBalanceAndCheck({
            initialAmounts,
            transferAmount: 25,
            timestamp,
            awaitPreminting: false
          });
        });
      });

      describe("Tokens are transferred after the preminting release and", async () => {
        // Skipping because it is similar to the next one
        it.skip("5 tokens are transferred", async () => {
          await executeTransferAndCheck({
            initialAmounts,
            transferAmount: 5,
            timestamp,
            awaitPreminting: true
          });
        });

        // Skipping because it is similar to the next one
        it("10 tokens are transferred", async () => {
          await executeTransferAndCheck({
            initialAmounts,
            transferAmount: 10,
            timestamp,
            awaitPreminting: true
          });
        });

        // Skipping because it is similar to the next one
        it("15 tokens are transferred", async () => {
          await executeTransferAndCheck({
            initialAmounts,
            transferAmount: 15,
            timestamp,
            awaitPreminting: true
          });
        });

        it("20 tokens are transferred", async () => {
          await executeTransferAndCheck({
            initialAmounts,
            transferAmount: 20,
            timestamp,
            awaitPreminting: true
          });
        });

        it("25 tokens are transferred", async () => {
          await failTransferDueToLackOfBalanceAndCheck({
            initialAmounts,
            transferAmount: 25,
            timestamp,
            awaitPreminting: true
          });
        });
      });
    });

    describe("Executes as expected if there are the frozen and premint balances, no free balance, and", async () => {
      const initialAmounts: TokenAmounts = { minted: 10, preminted: 10, frozen: 10 };
      let timestamp: number;
      beforeEach(async () => {
        timestamp = (await getLatestBlockTimestamp()) + 100;
      });

      describe("Tokens are transferred before the preminting release and", async () => {
        it("5 tokens are transferred", async () => {
          await failTransferWithCustomErrorAndCheck({
            errorName: REVERT_ERROR_TRANSFER_EXCEEDED_FROZEN_AMOUNT,
            initialAmounts,
            transferAmount: 5,
            timestamp,
            awaitPreminting: false
          });
        });

        // Skipping because it is similar to the previous one
        it.skip("10 tokens are transferred", async () => {
          await failTransferWithCustomErrorAndCheck({
            errorName: REVERT_ERROR_TRANSFER_EXCEEDED_FROZEN_AMOUNT,
            initialAmounts,
            transferAmount: 10,
            timestamp,
            awaitPreminting: false
          });
        });

        it("15 tokens are transferred", async () => {
          await failTransferWithCustomErrorAndCheck({
            errorName: REVERT_ERROR_TRANSFER_EXCEEDED_PREMINT_AMOUNT,
            initialAmounts,
            transferAmount: 15,
            timestamp,
            awaitPreminting: false
          });
        });

        // Skipping because it is similar to the previous one
        it.skip("20 tokens are transferred", async () => {
          await failTransferWithCustomErrorAndCheck({
            errorName: REVERT_ERROR_TRANSFER_EXCEEDED_PREMINT_AMOUNT,
            initialAmounts,
            transferAmount: 20,
            timestamp,
            awaitPreminting: false
          });
        });

        it("25 tokens are transferred", async () => {
          await failTransferDueToLackOfBalanceAndCheck({
            initialAmounts,
            transferAmount: 25,
            timestamp,
            awaitPreminting: false
          });
        });
      });

      describe("Tokens are transferred after the preminting release and", async () => {
        // Skipping because it is similar to the next one
        it.skip("5 tokens are transferred", async () => {
          await executeTransferAndCheck({
            initialAmounts,
            transferAmount: 5,
            timestamp,
            awaitPreminting: true
          });
        });

        // Skipping because it is similar to the next one
        it.skip("10 tokens are transferred", async () => {
          await executeTransferAndCheck({
            initialAmounts,
            transferAmount: 10,
            timestamp,
            awaitPreminting: true
          });
        });

        // Skipping because it is similar to the next one
        it.skip("15 tokens are transferred", async () => {
          await failTransferWithCustomErrorAndCheck({
            errorName: REVERT_ERROR_TRANSFER_EXCEEDED_FROZEN_AMOUNT,
            initialAmounts,
            transferAmount: 15,
            timestamp,
            awaitPreminting: true
          });
        });

        it("20 tokens are transferred", async () => {
          await failTransferWithCustomErrorAndCheck({
            errorName: REVERT_ERROR_TRANSFER_EXCEEDED_FROZEN_AMOUNT,
            initialAmounts,
            transferAmount: 20,
            timestamp,
            awaitPreminting: true
          });
        });

        it("25 tokens are transferred", async () => {
          await failTransferDueToLackOfBalanceAndCheck({
            initialAmounts,
            transferAmount: 25,
            timestamp,
            awaitPreminting: true
          });
        });
      });
    });

    describe("Executes as expected if there is the frozen balance only, no free or premint balances, and", async () => {
      const initialAmounts: TokenAmounts = { minted: 20, preminted: 0, frozen: 20 };

      it("5 tokens are transferred", async () => {
        await failTransferWithCustomErrorAndCheck({
          errorName: REVERT_ERROR_TRANSFER_EXCEEDED_FROZEN_AMOUNT,
          initialAmounts,
          transferAmount: 5
        });
      });

      // Skipping because it is similar to the previous one
      it.skip("10 tokens are transferred", async () => {
        await failTransferWithCustomErrorAndCheck({
          errorName: REVERT_ERROR_TRANSFER_EXCEEDED_FROZEN_AMOUNT,
          initialAmounts,
          transferAmount: 10
        });
      });

      // Skipping because it is similar to the previous one
      it.skip("15 tokens are transferred", async () => {
        await failTransferWithCustomErrorAndCheck({
          errorName: REVERT_ERROR_TRANSFER_EXCEEDED_FROZEN_AMOUNT,
          initialAmounts,
          transferAmount: 15
        });
      });

      // Skipping because it is similar to the previous one
      it.skip("20 tokens are transferred", async () => {
        await failTransferWithCustomErrorAndCheck({
          errorName: REVERT_ERROR_TRANSFER_EXCEEDED_FROZEN_AMOUNT,
          initialAmounts,
          transferAmount: 20
        });
      });

      it("25 tokens are transferred", async () => {
        await failTransferDueToLackOfBalanceAndCheck({
          initialAmounts,
          transferAmount: 25
        });
      });
    });

    describe("Executes as expected if there is the premint balance only, no free or frozen balances, and", async () => {
      const initialAmounts: TokenAmounts = { minted: 0, preminted: 20, frozen: 0 };
      let timestamp: number;
      beforeEach(async () => {
        timestamp = (await getLatestBlockTimestamp()) + 100;
      });

      describe("Tokens are transferred before the preminting release and", async () => {
        it("5 tokens are transferred", async () => {
          await failTransferWithCustomErrorAndCheck({
            errorName: REVERT_ERROR_TRANSFER_EXCEEDED_PREMINT_AMOUNT,
            initialAmounts,
            transferAmount: 5,
            timestamp,
            awaitPreminting: false
          });
        });

        // Skipping because it is similar to the previous one
        it.skip("10 tokens are transferred", async () => {
          await failTransferWithCustomErrorAndCheck({
            errorName: REVERT_ERROR_TRANSFER_EXCEEDED_PREMINT_AMOUNT,
            initialAmounts,
            transferAmount: 10,
            timestamp,
            awaitPreminting: false
          });
        });

        // Skipping because it is similar to the previous one
        it.skip("15 tokens are transferred", async () => {
          await failTransferWithCustomErrorAndCheck({
            errorName: REVERT_ERROR_TRANSFER_EXCEEDED_PREMINT_AMOUNT,
            initialAmounts,
            transferAmount: 15,
            timestamp,
            awaitPreminting: false
          });
        });

        // Skipping because it is similar to the previous one
        it.skip("20 tokens are transferred", async () => {
          await failTransferWithCustomErrorAndCheck({
            errorName: REVERT_ERROR_TRANSFER_EXCEEDED_PREMINT_AMOUNT,
            initialAmounts,
            transferAmount: 20,
            timestamp,
            awaitPreminting: false
          });
        });

        it("25 tokens are transferred", async () => {
          await failTransferDueToLackOfBalanceAndCheck({
            initialAmounts,
            transferAmount: 25,
            timestamp,
            awaitPreminting: false
          });
        });
      });

      describe("Tokens are transferred after the preminting release and", async () => {
        // Skipping because it is similar to the next one
        it.skip("5 tokens are transferred", async () => {
          await executeTransferAndCheck({
            initialAmounts,
            transferAmount: 5,
            timestamp,
            awaitPreminting: true
          });
        });

        // Skipping because it is similar to the next one
        it.skip("10 tokens are transferred", async () => {
          await executeTransferAndCheck({
            initialAmounts,
            transferAmount: 10,
            timestamp,
            awaitPreminting: true
          });
        });

        // Skipping because it is similar to the next one
        it.skip("15 tokens are transferred", async () => {
          await executeTransferAndCheck({
            initialAmounts,
            transferAmount: 15,
            timestamp,
            awaitPreminting: true
          });
        });

        it("20 tokens are transferred", async () => {
          await executeTransferAndCheck({
            initialAmounts,
            transferAmount: 20,
            timestamp,
            awaitPreminting: true
          });
        });

        it("25 tokens are transferred", async () => {
          await failTransferDueToLackOfBalanceAndCheck({
            initialAmounts,
            transferAmount: 25,
            timestamp,
            awaitPreminting: true
          });
        });
      });
    });

    describe("Executes as expected if there is the free balance only, no frozen or premint balances and", async () => {
      const initialAmounts: TokenAmounts = { minted: 20, preminted: 0, frozen: 0 };

      // Skipping because it is similar to the next one
      it.skip("5 tokens are transferred", async () => {
        await executeTransferAndCheck({ initialAmounts, transferAmount: 5 });
      });

      // Skipping because it is similar to the next one
      it.skip("10 tokens are transferred", async () => {
        await executeTransferAndCheck({ initialAmounts, transferAmount: 10 });
      });

      // Skipping because it is similar to the next one
      it.skip("15 tokens are transferred", async () => {
        await executeTransferAndCheck({ initialAmounts, transferAmount: 15 });
      });

      it("20 tokens are transferred", async () => {
        await executeTransferAndCheck({ initialAmounts, transferAmount: 20 });
      });

      it("25 tokens are transferred", async () => {
        await failTransferDueToLackOfBalanceAndCheck({ initialAmounts, transferAmount: 25 });
      });
    });
  });

  describe("Function 'transferFrozen()' when the total balance is 20", async () => {
    async function executeTransferFrozenAndCheck(props: {
      initialAmounts: TokenAmounts;
      transferAmount: number;
    }) {
      const { token } = await setUpFixture(deployAndConfigureToken);
      const { initialAmounts, transferAmount } = props;
      const amounts = await setUpComplexBalances({ token, amounts: { ...initialAmounts } });
      await expect(
        connect(token, freezer).transferFrozen(sender.address, receiver.address, transferAmount)
      ).to.changeTokenBalances(
        token,
        [sender, receiver],
        [-transferAmount, transferAmount]
      );
      amounts.frozen -= transferAmount;
      amounts.minted -= transferAmount;
      await checkComplexBalance({ token, amounts });
    }

    async function failTransferFrozenWithCustomErrorAndCheck(props: {
      errorName: string;
      initialAmounts: TokenAmounts;
      transferAmount: number;
    }) {
      const { token } = await setUpFixture(deployAndConfigureToken);
      const { initialAmounts, transferAmount, errorName } = props;
      await setUpComplexBalances({ token, amounts: { ...initialAmounts } });
      await expect(
        connect(token, freezer).transferFrozen(sender.address, receiver.address, transferAmount)
      ).to.be.revertedWithCustomError(token, errorName);
    }

    describe("Executes as expected if there is the frozen balance only and", async () => {

      describe("The frozen balance is less than the total one and", async () => {
        const initialAmounts: TokenAmounts = { minted: 20, preminted: 0, frozen: 5 };
        it("5 tokens are transferred", async () => {
          await executeTransferFrozenAndCheck({ initialAmounts, transferAmount: 5 });
        });

        it("10 tokens are transferred", async () => {
          await failTransferFrozenWithCustomErrorAndCheck({
            errorName: REVERT_ERROR_LACK_OF_FROZEN_BALANCE,
            initialAmounts,
            transferAmount: 10
          });
        });
      });

      describe("The frozen balance is greater than the total one", async () => {
        const initialAmounts: TokenAmounts = { minted: 20, preminted: 0, frozen: 25 };

        it("5 tokens are transferred", async () => {
          await executeTransferFrozenAndCheck({ initialAmounts, transferAmount: 5 });
        });

        it("20 tokens are transferred", async () => {
          await executeTransferFrozenAndCheck({ initialAmounts, transferAmount: 20 });
        });

        it("25 tokens are transferred", async () => {
          const { token } = await setUpFixture(deployAndConfigureToken);
          await setUpComplexBalances({ token, amounts: { ...initialAmounts } });
          await expect(
            connect(token, freezer).transferFrozen(sender, receiver.address, 25)
          ).to.be.revertedWith(REVERT_MESSAGE_ERC20_TRANSFER_AMOUNT_EXCEEDS_BALANCE);
        });
      });
    });
  });
});
