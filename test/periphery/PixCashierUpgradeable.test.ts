import { ethers, upgrades } from "hardhat";
import { expect } from "chai";
import { Contract, ContractFactory } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import { proveTx } from "../../test-utils/eth";

describe("Contract 'PixCashierUpgradeable'", async () => {
  const REVERT_MESSAGE_IF_CONTRACT_IS_ALREADY_INITIALIZED = 'Initializable: contract is already initialized';
  const REVERT_MESSAGE_IF_CONTRACT_IS_PAUSED = "Pausable: paused";
  const REVERT_MESSAGE_IF_ACCOUNT_IS_NOT_WHITELISTED = "Whitelistable: account is not whitelisted";
  const REVERT_MESSAGE_IF_TOKEN_TRANSFER_AMOUNT_EXCEEDS_BALANCE = "ERC20: transfer amount exceeds balance";
  const REVERT_MESSAGE_IF_ADDRESS_IS_ZERO = "ERC20: mint to the zero address"
  const REVERT_MESSAGE_IF_CASH_OUT_BALANCE_IS_NOT_ENOUGH_TO_CONFIRM =
    "PixCashier: cash-out confirm amount exceeds balance";
  const REVERT_MESSAGE_IF_CASH_OUT_BALANCE_IS_NOT_ENOUGH_TO_REVERSE =
    "PixCashier: cash-out reverse amount exceeds balance";
  const REVERT_MESSAGE_IF_TRANSACTION_ID_IS_NOT_PROVIDED =
    "PixCashier: transaction id must be provided";
  const TRANSACTION_ID = ethers.utils.formatBytes32String("MOCK_TRANSACTION_ID");

  let pixCashier: Contract;
  let brlcMock: Contract;
  let deployer: SignerWithAddress;
  let user: SignerWithAddress;

  beforeEach(async () => {
    // Deploy the BRLC mock contract
    const BRLCMock: ContractFactory = await ethers.getContractFactory("ERC20UpgradeableMock");
    brlcMock = await upgrades.deployProxy(BRLCMock, ["BRL Coin", "BRLC", 6]);
    await brlcMock.deployed();

    // Deploy the being tested contract
    const PixCashier: ContractFactory = await ethers.getContractFactory("PixCashierUpgradeable");
    pixCashier = await upgrades.deployProxy(PixCashier, [brlcMock.address]);
    await pixCashier.deployed();

    // Get user accounts
    [deployer, user] = await ethers.getSigners();
  });

  it("The initialize function can only be called once", async () => {
    await expect(pixCashier.initialize(brlcMock.address))
      .to.be.revertedWith(REVERT_MESSAGE_IF_CONTRACT_IS_ALREADY_INITIALIZED);
  });

  describe("Function 'cashIn()'", async () => {
    const tokenAmount: number = 100;
    let cashierClient: SignerWithAddress;

    beforeEach(async () => {
      cashierClient = deployer;
    });

    it("Is reverted if caller is not whitelisted", async () => {
      await proveTx(pixCashier.setWhitelistEnabled(true));
      await expect(pixCashier.cashIn(user.address, tokenAmount, TRANSACTION_ID))
        .to.be.revertedWith(REVERT_MESSAGE_IF_ACCOUNT_IS_NOT_WHITELISTED);
    });

    it("Is reverted if the contract is paused", async () => {
      await proveTx(pixCashier.setPauser(deployer.address));
      await proveTx(pixCashier.pause());
      await expect(pixCashier.connect(user).cashIn(cashierClient.address, tokenAmount, TRANSACTION_ID))
        .to.be.revertedWith(REVERT_MESSAGE_IF_CONTRACT_IS_PAUSED);
    });

    it("Is reverted if the account address is zero", async () => {
      await expect(pixCashier.connect(user).cashIn(ethers.constants.AddressZero, tokenAmount, TRANSACTION_ID))
        .to.be.revertedWith(REVERT_MESSAGE_IF_ADDRESS_IS_ZERO);
    });

    it("Is reverted if the transaction id is not provided", async () => {
      await expect(pixCashier.connect(user).cashIn(ethers.constants.AddressZero, tokenAmount, ethers.constants.HashZero))
        .to.be.revertedWith(REVERT_MESSAGE_IF_TRANSACTION_ID_IS_NOT_PROVIDED);
    });

    it("Mints correct amount of tokens", async () => {
      await expect(async () => {
        await proveTx(pixCashier.connect(user).cashIn(cashierClient.address, tokenAmount, TRANSACTION_ID));
      }).to.changeTokenBalances(
        brlcMock,
        [cashierClient],
        [tokenAmount]
      );
    });

    it("Emits the correct event", async () => {
      await expect(pixCashier.connect(user).cashIn(cashierClient.address, tokenAmount, TRANSACTION_ID))
        .to.emit(pixCashier, "CashIn")
        .withArgs(cashierClient.address, tokenAmount, TRANSACTION_ID);
    });
  });

  describe("Function 'cashOut()'", async () => {
    const tokenAmount: number = 100;
    let cashierClient: SignerWithAddress;

    beforeEach(async () => {
      cashierClient = deployer;
      await proveTx(brlcMock.connect(cashierClient).approve(pixCashier.address, ethers.constants.MaxUint256));
    });

    it("Is reverted if the contract is paused", async () => {
      await proveTx(pixCashier.setPauser(deployer.address));
      await proveTx(pixCashier.pause());
      await expect(pixCashier.connect(cashierClient).cashOut(tokenAmount, TRANSACTION_ID))
        .to.be.revertedWith(REVERT_MESSAGE_IF_CONTRACT_IS_PAUSED);
    });

    it("Is reverted if the user has not enough tokens", async () => {
      await proveTx(brlcMock.mint(cashierClient.address, tokenAmount - 1));
      await expect(pixCashier.connect(cashierClient).cashOut(tokenAmount, TRANSACTION_ID))
        .to.be.revertedWith(REVERT_MESSAGE_IF_TOKEN_TRANSFER_AMOUNT_EXCEEDS_BALANCE);
    });

    it("Is reverted if the transaction id is not provided", async () => {
      await proveTx(brlcMock.mint(cashierClient.address, tokenAmount));
      await expect(pixCashier.connect(cashierClient).cashOut(tokenAmount, ethers.constants.HashZero))
        .to.be.revertedWith(REVERT_MESSAGE_IF_TRANSACTION_ID_IS_NOT_PROVIDED);
    });

    it("Transfers correct amount of tokens and changes cash-out balances accordingly", async () => {
      await proveTx(brlcMock.mint(cashierClient.address, tokenAmount));
      const oldCashOutBalance: number = await pixCashier.cashOutBalanceOf(cashierClient.address);
      await expect(async () => {
        await proveTx(pixCashier.connect(cashierClient).cashOut(tokenAmount, TRANSACTION_ID));
      }).to.changeTokenBalances(
        brlcMock,
        [cashierClient, pixCashier],
        [-tokenAmount, +tokenAmount]
      );
      const newCashOutBalance: number = await pixCashier.cashOutBalanceOf(cashierClient.address);
      expect(newCashOutBalance - oldCashOutBalance).to.equal(tokenAmount);
    });

    it("Emits the correct event", async () => {
      await proveTx(brlcMock.mint(cashierClient.address, tokenAmount));
      await expect(pixCashier.connect(cashierClient).cashOut(tokenAmount, TRANSACTION_ID))
        .to.emit(pixCashier, "CashOut")
        .withArgs(cashierClient.address, tokenAmount, tokenAmount, TRANSACTION_ID);
    });
  });

  describe("Function 'cashOutConfirm()'", async () => {
    const tokenAmount: number = 100;
    let cashierClient: SignerWithAddress;

    beforeEach(async () => {
      cashierClient = deployer;
      await proveTx(brlcMock.connect(cashierClient).approve(pixCashier.address, ethers.constants.MaxUint256));
      await proveTx(brlcMock.mint(cashierClient.address, tokenAmount));
    })

    it("Is reverted if the contract is paused", async () => {
      await proveTx(pixCashier.setPauser(deployer.address));
      await proveTx(pixCashier.setPauser(deployer.address));
      await proveTx(pixCashier.pause());
      await expect(pixCashier.connect(cashierClient).cashOutConfirm(tokenAmount, TRANSACTION_ID))
        .to.be.revertedWith(REVERT_MESSAGE_IF_CONTRACT_IS_PAUSED);
    })

    it("Is reverted if the user's cash-out balance has not enough tokens", async () => {
      await proveTx(pixCashier.connect(cashierClient).cashOut(tokenAmount - 1, TRANSACTION_ID));
      await expect(pixCashier.connect(cashierClient).cashOutConfirm(tokenAmount, TRANSACTION_ID))
        .to.be.revertedWith(REVERT_MESSAGE_IF_CASH_OUT_BALANCE_IS_NOT_ENOUGH_TO_CONFIRM);
    });

    it("Is reverted if the transaction id is not provided", async () => {
      await proveTx(pixCashier.connect(cashierClient).cashOut(tokenAmount, TRANSACTION_ID));
      await expect(pixCashier.connect(cashierClient).cashOutConfirm(tokenAmount, ethers.constants.HashZero))
        .to.be.revertedWith(REVERT_MESSAGE_IF_TRANSACTION_ID_IS_NOT_PROVIDED);
    });

    it("Burns correct amount of tokens and changes cash-out balances accordingly", async () => {
      await proveTx(pixCashier.connect(cashierClient).cashOut(tokenAmount, TRANSACTION_ID));
      const oldCashOutBalance: number = await pixCashier.cashOutBalanceOf(cashierClient.address);
      await expect(async () => {
        await proveTx(pixCashier.connect(cashierClient).cashOutConfirm(tokenAmount, TRANSACTION_ID));
      }).to.changeTokenBalances(
        brlcMock,
        [pixCashier],
        [-tokenAmount]
      );
      const newCashOutBalance: number = await pixCashier.cashOutBalanceOf(cashierClient.address);
      expect(newCashOutBalance - oldCashOutBalance).to.equal(-tokenAmount);
    });

    it("Emits the correct event", async () => {
      await proveTx(pixCashier.connect(cashierClient).cashOut(tokenAmount, TRANSACTION_ID));
      await expect(pixCashier.connect(cashierClient).cashOutConfirm(tokenAmount, TRANSACTION_ID))
        .to.emit(pixCashier, "CashOutConfirm")
        .withArgs(cashierClient.address, tokenAmount, 0, TRANSACTION_ID);
    });
  });

  describe("Function 'cashOutReverse()'", async () => {
    const tokenAmount: number = 100;
    let cashierClient: SignerWithAddress;

    beforeEach(async () => {
      cashierClient = deployer;
      await proveTx(brlcMock.connect(cashierClient).approve(pixCashier.address, ethers.constants.MaxUint256));
      await proveTx(brlcMock.mint(cashierClient.address, tokenAmount));
    })

    it("Is reverted if the contract is paused", async () => {
      await proveTx(pixCashier.setPauser(deployer.address));
      await proveTx(pixCashier.pause());
      await expect(pixCashier.connect(cashierClient).cashOutReverse(tokenAmount, TRANSACTION_ID))
        .to.be.revertedWith(REVERT_MESSAGE_IF_CONTRACT_IS_PAUSED);
    })

    it("Is reverted if the user's cash-out balance has not enough tokens", async () => {
      await proveTx(pixCashier.connect(cashierClient).cashOut(tokenAmount - 1, TRANSACTION_ID));
      await expect(pixCashier.connect(cashierClient).cashOutReverse(tokenAmount, TRANSACTION_ID))
        .to.be.revertedWith(REVERT_MESSAGE_IF_CASH_OUT_BALANCE_IS_NOT_ENOUGH_TO_REVERSE);
    });

    it("Is reverted if the transaction id is not provided", async () => {
      await proveTx(pixCashier.connect(cashierClient).cashOut(tokenAmount, TRANSACTION_ID));
      await expect(pixCashier.connect(cashierClient).cashOutReverse(tokenAmount, ethers.constants.HashZero))
        .to.be.revertedWith(REVERT_MESSAGE_IF_TRANSACTION_ID_IS_NOT_PROVIDED);
    });

    it("Transfers correct amount of tokens and changes cash-out balances accordingly", async () => {
      await proveTx(pixCashier.connect(cashierClient).cashOut(tokenAmount, TRANSACTION_ID));
      const oldCashOutBalance: number = await pixCashier.cashOutBalanceOf(cashierClient.address);
      await expect(async () => {
        await proveTx(pixCashier.connect(cashierClient).cashOutReverse(tokenAmount, TRANSACTION_ID));
      }).to.changeTokenBalances(
        brlcMock,
        [cashierClient, pixCashier],
        [+tokenAmount, -tokenAmount]
      );
      const newCashOutBalance: number = await pixCashier.cashOutBalanceOf(cashierClient.address);
      expect(newCashOutBalance - oldCashOutBalance).to.equal(-tokenAmount);
    });

    it("Emits the correct event", async () => {
      await proveTx(pixCashier.connect(cashierClient).cashOut(tokenAmount, TRANSACTION_ID));
      await expect(pixCashier.connect(cashierClient).cashOutReverse(tokenAmount, TRANSACTION_ID))
        .to.emit(pixCashier, "CashOutReverse")
        .withArgs(cashierClient.address, tokenAmount, 0, TRANSACTION_ID);
    });
  });

  describe("Complex scenario", async () => {
    const cashInTokenAmount: number = 100;
    const cashOutTokenAmount: number = 80;
    const cashOutReverseTokenAmount: number = 20;
    const cashOutConfirmTokenAmount: number = 50;
    const cashierClientFinalTokenBalance: number = cashInTokenAmount - cashOutTokenAmount + cashOutReverseTokenAmount;
    const cashierClientFinalCashOutBalance: number =
      cashOutTokenAmount - cashOutReverseTokenAmount - cashOutConfirmTokenAmount;

    let cashierClient: SignerWithAddress;

    beforeEach(async () => {
      cashierClient = deployer;
      await proveTx(brlcMock.connect(cashierClient).approve(pixCashier.address, ethers.constants.MaxUint256));
    })

    it("Leads to correct balances when using several functions", async () => {
      await proveTx(pixCashier.connect(user).cashIn(cashierClient.address, cashInTokenAmount, TRANSACTION_ID));
      await proveTx(pixCashier.connect(cashierClient).cashOut(cashOutTokenAmount, TRANSACTION_ID));
      await proveTx(pixCashier.connect(cashierClient).cashOutReverse(cashOutReverseTokenAmount, TRANSACTION_ID));
      await proveTx(pixCashier.connect(cashierClient).cashOutConfirm(cashOutConfirmTokenAmount, TRANSACTION_ID));
      expect(await brlcMock.balanceOf(cashierClient.address)).to.equal(cashierClientFinalTokenBalance);
      expect(await pixCashier.cashOutBalanceOf(cashierClient.address)).to.equal(cashierClientFinalCashOutBalance);
      expect(await brlcMock.balanceOf(pixCashier.address)).to.equal(cashierClientFinalCashOutBalance);
    });
  });
});
