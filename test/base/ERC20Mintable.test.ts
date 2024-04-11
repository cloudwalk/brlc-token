import { ethers, network, upgrades } from "hardhat";
import { expect } from "chai";
import { BigNumber, Contract, ContractFactory } from "ethers";
import { TransactionResponse } from "@ethersproject/abstract-provider";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import { proveTx } from "../../test-utils/eth";

async function setUpFixture<T>(func: () => Promise<T>): Promise<T> {
  if (network.name === "hardhat") {
    return loadFixture(func);
  } else {
    return func();
  }
}

describe("Contract 'ERC20Mintable'", async () => {
  const TOKEN_NAME = "BRL Coin";
  const TOKEN_SYMBOL = "BRLC";

  const MINT_ALLOWANCE = 1000;
  const TOKEN_AMOUNT = 100;
  const MAX_PENDING_PREMINTS_COUNT = 5;

  const EVENT_NAME_MAIN_MINTER_CHANGED = "MainMinterChanged";
  const EVENT_NAME_MINTER_CONFIGURED = "MinterConfigured";
  const EVENT_NAME_MINTER_REMOVED = "MinterRemoved";
  const EVENT_NAME_MINT = "Mint";
  const EVENT_NAME_BURN = "Burn";
  const EVENT_NAME_TRANSFER = "Transfer";
  const EVENT_NAME_PREMINT = "Premint";
  const EVENT_NAME_MAX_PENDING_PREMINTS_COUNT_CONFIGURED = "MaxPendingPremintsCountConfigured";
  const EVENT_NAME_PREMINTS_RESCHEDULED = "PremintsRescheduled";

  const REVERT_MESSAGE_INITIALIZABLE_CONTRACT_IS_ALREADY_INITIALIZED = "Initializable: contract is already initialized";
  const REVERT_MESSAGE_INITIALIZABLE_CONTRACT_IS_NOT_INITIALIZING = "Initializable: contract is not initializing";
  const REVERT_MESSAGE_OWNABLE_CALLER_IS_NOT_THE_OWNER = "Ownable: caller is not the owner";
  const REVERT_MESSAGE_PAUSABLE_PAUSED = "Pausable: paused";
  const REVERT_MESSAGE_ERC20_MINT_TO_THE_ZERO_ACCOUNT = "ERC20: mint to the zero address";
  const REVERT_MESSAGE_ERC20_BURN_AMOUNT_EXCEEDS_BALANCE = "ERC20: burn amount exceeds balance";

  const REVERT_ERROR_BLOCKLISTED_ACCOUNT = "BlocklistedAccount";
  const REVERT_ERROR_UNAUTHORIZED_MAIN_MINTER = "UnauthorizedMainMinter";
  const REVERT_ERROR_UNAUTHORIZED_MINTER = "UnauthorizedMinter";
  const REVERT_ERROR_ZERO_BURN_AMOUNT = "ZeroBurnAmount";
  const REVERT_ERROR_ZERO_MINT_AMOUNT = "ZeroMintAmount";
  const REVERT_ERROR_ZERO_PREMINT_AMOUNT = "ZeroPremintAmount";
  const REVERT_ERROR_PREMINT_INSUFFICIENT_AMOUNT = "PremintInsufficientAmount";
  const REVERT_ERROR_PREMINT_NON_EXISTENT = "PremintNonExistent";
  const REVERT_ERROR_PREMINT_UNCHANGED = "PremintUnchanged";
  const REVERT_ERROR_EXCEEDED_MINT_ALLOWANCE = "ExceededMintAllowance";
  const REVERT_ERROR_PREMINT_RELEASE_TIME_PASSED = "PremintReleaseTimePassed";
  const REVERT_ERROR_PREMINTS_RESCHEDULING_ALREADY_CONFIGURED = "PremintsReschedulingAlreadyConfigured";
  const REVERT_ERROR_PREMINTS_RESCHEDULING_CHAIN = "PremintsReschedulingChain";
  const REVERT_ERROR_PREMINTS_RESCHEDULING_TIME_PASSED = "PremintsReschedulingTimePassed";
  const REVERT_ERROR_MAX_PENDING_PREMINTS_LIMIT_REACHED = "MaxPendingPremintsLimitReached";
  const REVERT_ERROR_MAX_PENDING_PREMINTS_COUNT_ALREADY_CONFIGURED = "MaxPendingPremintsCountAlreadyConfigured";
  const REVERT_ERROR_INAPPROPRIATE_UINT64_VALUE = "InappropriateUint64Value";

  enum PremintFunction {
    Increase = 0,
    Decrease = 1
  }

  interface Premint {
    amount: number;
    release: number;
  }

  let tokenFactory: ContractFactory;
  let deployer: SignerWithAddress;
  let pauser: SignerWithAddress;
  let mainBlocklister: SignerWithAddress;
  let mainMinter: SignerWithAddress;
  let minter: SignerWithAddress;
  let user: SignerWithAddress;

  before(async () => {
    [deployer, pauser, mainBlocklister, mainMinter, minter, user] = await ethers.getSigners();
    tokenFactory = await ethers.getContractFactory("ERC20MintableMock");
  });

  async function deployToken(): Promise<{ token: Contract }> {
    const token: Contract = await upgrades.deployProxy(tokenFactory, [TOKEN_NAME, TOKEN_SYMBOL]);
    await token.deployed();
    await proveTx(token.enableBlocklist(true));
    return { token };
  }

  async function deployAndConfigureToken(): Promise<{ token: Contract }> {
    const { token } = await deployToken();
    await proveTx(token.connect(deployer).setPauser(pauser.address));
    await proveTx(token.connect(deployer).setMainBlocklister(mainBlocklister.address));
    await proveTx(token.connect(deployer).updateMainMinter(mainMinter.address));
    await proveTx(token.connect(mainMinter).configureMinter(minter.address, MINT_ALLOWANCE));
    await proveTx(token.connect(deployer).configureMaxPendingPremintsCount(MAX_PENDING_PREMINTS_COUNT));
    return { token };
  }

  describe("Function 'initialize()'", async () => {
    it("Configures the contract as expected", async () => {
      const { token } = await setUpFixture(deployToken);
      expect(await token.owner()).to.equal(deployer.address);
      expect(await token.pauser()).to.equal(ethers.constants.AddressZero);
      expect(await token.mainBlocklister()).to.equal(ethers.constants.AddressZero);
      expect(await token.mainMinter()).to.equal(ethers.constants.AddressZero);
      expect(await token.maxPendingPremintsCount()).to.equal(0);
    });

    it("Is reverted if called for the second time", async () => {
      const { token } = await setUpFixture(deployToken);
      await expect(
        token.initialize(TOKEN_NAME, TOKEN_SYMBOL)
      ).to.be.revertedWith(REVERT_MESSAGE_INITIALIZABLE_CONTRACT_IS_ALREADY_INITIALIZED);
    });

    it("Is reverted if the contract implementation is called even for the first time", async () => {
      const tokenImplementation: Contract = await tokenFactory.deploy();
      await tokenImplementation.deployed();
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

  describe("Function 'updateMainMinter()'", async () => {
    it("Executes as expected and emits the correct event", async () => {
      const { token } = await setUpFixture(deployToken);
      await expect(token.connect(deployer).updateMainMinter(mainMinter.address))
        .to.emit(token, EVENT_NAME_MAIN_MINTER_CHANGED)
        .withArgs(mainMinter.address);
      expect(await token.mainMinter()).to.equal(mainMinter.address);
      await expect(
        token.connect(deployer).updateMainMinter(mainMinter.address)
      ).not.to.emit(token, EVENT_NAME_MAIN_MINTER_CHANGED);
    });

    it("Is reverted if called not by the owner", async () => {
      const { token } = await setUpFixture(deployToken);
      await expect(
        token.connect(user).updateMainMinter(mainMinter.address)
      ).to.be.revertedWith(REVERT_MESSAGE_OWNABLE_CALLER_IS_NOT_THE_OWNER);
    });
  });

  describe("Function 'configureMinter()'", async () => {
    it("Executes as expected and emits the correct event", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.connect(mainMinter).removeMinter(minter.address));
      expect(await token.isMinter(minter.address)).to.equal(false);
      expect(await token.minterAllowance(minter.address)).to.equal(0);
      await expect(token.connect(mainMinter).configureMinter(minter.address, MINT_ALLOWANCE))
        .to.emit(token, EVENT_NAME_MINTER_CONFIGURED)
        .withArgs(minter.address, MINT_ALLOWANCE);
      expect(await token.isMinter(minter.address)).to.equal(true);
      expect(await token.minterAllowance(minter.address)).to.equal(MINT_ALLOWANCE);
    });

    it("Is reverted if the contract is paused", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.connect(mainMinter).removeMinter(minter.address));
      await proveTx(token.connect(pauser).pause());
      await expect(
        token.connect(mainMinter).configureMinter(minter.address, MINT_ALLOWANCE)
      ).to.be.revertedWith(REVERT_MESSAGE_PAUSABLE_PAUSED);
    });

    it("Is reverted if called not by the main minter", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.connect(mainMinter).removeMinter(minter.address));
      await expect(token.connect(user).configureMinter(minter.address, MINT_ALLOWANCE))
        .to.be.revertedWithCustomError(token, REVERT_ERROR_UNAUTHORIZED_MAIN_MINTER)
        .withArgs(user.address);
    });
  });

  describe("Function 'removeMinter()'", async () => {
    it("Executes as expected and emits the correct event", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      expect(await token.isMinter(minter.address)).to.equal(true);
      expect(await token.minterAllowance(minter.address)).to.equal(MINT_ALLOWANCE);
      await expect(token.connect(mainMinter).removeMinter(minter.address))
        .to.emit(token, EVENT_NAME_MINTER_REMOVED)
        .withArgs(minter.address);
      expect(await token.isMinter(minter.address)).to.equal(false);
      expect(await token.minterAllowance(minter.address)).to.equal(0);
      await expect(
        token.connect(mainMinter).removeMinter(minter.address)
      ).not.to.emit(token, EVENT_NAME_MINTER_REMOVED);
    });

    it("Is reverted if called not by the main minter", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await expect(token.connect(user).removeMinter(minter.address))
        .to.be.revertedWithCustomError(token, REVERT_ERROR_UNAUTHORIZED_MAIN_MINTER)
        .withArgs(user.address);
    });
  });

  describe("Function 'mint()'", async () => {
    describe("Executes as expected and emits the correct events if", async () => {
      async function checkMinting(token: Contract) {
        const oldMintAllowance: BigNumber = await token.minterAllowance(minter.address);
        const newExpectedMintAllowance: BigNumber = oldMintAllowance.sub(BigNumber.from(TOKEN_AMOUNT));
        const tx: TransactionResponse = await token.connect(minter).mint(user.address, TOKEN_AMOUNT);
        await expect(tx).to.emit(token, EVENT_NAME_MINT).withArgs(minter.address, user.address, TOKEN_AMOUNT);
        await expect(tx)
          .to.emit(token, EVENT_NAME_TRANSFER)
          .withArgs(ethers.constants.AddressZero, user.address, TOKEN_AMOUNT);
        await expect(tx).to.changeTokenBalances(token, [user], [TOKEN_AMOUNT]);
        expect(await token.minterAllowance(minter.address)).to.equal(newExpectedMintAllowance);
      }

      it("The caller and destination address are not blocklisted", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        await checkMinting(token);
      });

      it("The destination address is blocklisted but the caller is a blocklister", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        await proveTx(token.connect(mainBlocklister).configureBlocklister(minter.address, true));
        await proveTx(token.connect(user).selfBlocklist());
        await checkMinting(token);
      });
    });

    describe("Is reverted if", async () => {
      it("The contract is paused", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        await proveTx(token.connect(pauser).pause());
        await expect(
          token.connect(minter).mint(user.address, TOKEN_AMOUNT)
        ).to.be.revertedWith(REVERT_MESSAGE_PAUSABLE_PAUSED);
      });

      it("The caller is not a minter", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        await expect(token.connect(user).mint(user.address, TOKEN_AMOUNT))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_UNAUTHORIZED_MINTER)
          .withArgs(user.address);
      });

      it("The caller is blocklisted even if the caller is a blocklister", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        await proveTx(token.connect(mainBlocklister).configureBlocklister(minter.address, true));
        await proveTx(token.connect(minter).selfBlocklist());
        await expect(token.connect(minter).mint(user.address, TOKEN_AMOUNT))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_BLOCKLISTED_ACCOUNT)
          .withArgs(minter.address);
      });

      it("The destination address is blocklisted and the caller is not a blocklister", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        await proveTx(token.connect(user).selfBlocklist());
        await expect(token.connect(minter).mint(user.address, TOKEN_AMOUNT))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_BLOCKLISTED_ACCOUNT)
          .withArgs(user.address);
      });

      it("The destination address is zero", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        await expect(
          token.connect(minter).mint(ethers.constants.AddressZero, TOKEN_AMOUNT)
        ).to.be.revertedWith(REVERT_MESSAGE_ERC20_MINT_TO_THE_ZERO_ACCOUNT);
      });

      it("The mint amount is zero", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        await expect(
          token.connect(minter).mint(user.address, 0)
        ).to.be.revertedWithCustomError(token, REVERT_ERROR_ZERO_MINT_AMOUNT);
      });

      it("The mint amount exceeds the mint allowance", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        await expect(
          token.connect(minter).mint(user.address, MINT_ALLOWANCE + 1)
        ).to.be.revertedWithCustomError(token, REVERT_ERROR_EXCEEDED_MINT_ALLOWANCE);
      });
    });
  });

  describe("Function 'burn()'", async () => {
    it("Executes as expected and emits the correct events", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.connect(minter).mint(minter.address, TOKEN_AMOUNT));
      const tx: TransactionResponse = await token.connect(minter).burn(TOKEN_AMOUNT);
      await expect(tx).to.emit(token, EVENT_NAME_BURN).withArgs(minter.address, TOKEN_AMOUNT);
      await expect(tx)
        .to.emit(token, EVENT_NAME_TRANSFER)
        .withArgs(minter.address, ethers.constants.AddressZero, TOKEN_AMOUNT);
      await expect(tx).to.changeTokenBalances(
        token,
        [minter, mainMinter, deployer, token],
        [-TOKEN_AMOUNT, 0, 0, 0]
      );
    });

    it("Is reverted if the contract is paused", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.connect(minter).mint(minter.address, TOKEN_AMOUNT));
      await proveTx(token.connect(pauser).pause());
      await expect(token.connect(minter).burn(TOKEN_AMOUNT))
        .to.be.revertedWith(REVERT_MESSAGE_PAUSABLE_PAUSED);
    });

    it("Is reverted if the caller is not a minter", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.connect(minter).mint(user.address, TOKEN_AMOUNT));
      await expect(token.connect(user).burn(TOKEN_AMOUNT))
        .to.be.revertedWithCustomError(token, REVERT_ERROR_UNAUTHORIZED_MINTER)
        .withArgs(user.address);
    });

    it("Is reverted if the caller is blocklisted", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.connect(minter).mint(minter.address, TOKEN_AMOUNT));
      await proveTx(token.connect(minter).selfBlocklist());
      await expect(token.connect(minter).burn(TOKEN_AMOUNT))
        .to.be.revertedWithCustomError(token, REVERT_ERROR_BLOCKLISTED_ACCOUNT)
        .withArgs(minter.address);
    });

    it("Is reverted if the burn amount is zero", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await expect(token.connect(minter).burn(0))
        .to.be.revertedWithCustomError(token, REVERT_ERROR_ZERO_BURN_AMOUNT);
    });

    it("Is reverted if the burn amount exceeds the caller token balance", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(token.connect(minter).mint(minter.address, TOKEN_AMOUNT));
      await expect(
        token.connect(minter).burn(TOKEN_AMOUNT + 1)
      ).to.be.revertedWith(REVERT_MESSAGE_ERC20_BURN_AMOUNT_EXCEEDS_BALANCE);
    });
  });

  describe("Premint functions", async () => {
    let timestamp: number;
    before(async () => {
      timestamp = (await time.latest()) + 100;
    });

    describe("Execute as expected and emits the correct events if", async () => {
      async function executeAndCheckPremint(token: Contract, props: {
        amount?: number;
        oldAmount?: number;
        release?: number;
        premintCount?: number;
        premintIndex?: number;
        balanceOfPremint?: number;
        premintFunction?: PremintFunction;
      } = {}) {
        const amount = props.amount ?? TOKEN_AMOUNT;
        const release = props.release ?? timestamp;
        const premintCount = props.premintCount ?? 1;
        const premintIndex = props.premintIndex ?? 0;
        const oldAmount = props.oldAmount ?? 0;
        const newAmount = (props.premintFunction === PremintFunction.Decrease)
          ? oldAmount - amount
          : oldAmount + amount;
        const balanceOfPremint = props.balanceOfPremint ?? newAmount;
        const premintFunction = props.premintFunction ?? PremintFunction.Increase;

        const oldMintAllowance: BigNumber = await token.minterAllowance(minter.address);
        let newMintAllowance: BigNumber = oldMintAllowance;
        if (newAmount >= oldAmount) {
          newMintAllowance = newMintAllowance.sub(
            BigNumber.from(newAmount - oldAmount)
          );
        }

        let tx: TransactionResponse;
        if (premintFunction === PremintFunction.Decrease) {
          tx = await token.connect(minter).premintDecrease(
            user.address,
            amount,
            release
          );
        } else {
          tx = await token.connect(minter).premintIncrease(
            user.address,
            amount,
            release
          );
        }

        if (newAmount > oldAmount) {
          const expectedAmount = newAmount - oldAmount;
          await expect(tx)
            .to.emit(token, EVENT_NAME_MINT)
            .withArgs(minter.address, user.address, expectedAmount);
          await expect(tx)
            .to.emit(token, EVENT_NAME_TRANSFER)
            .withArgs(ethers.constants.AddressZero, user.address, expectedAmount);
        }
        if (newAmount < oldAmount) {
          const expectedAmount = oldAmount - newAmount;
          await expect(tx)
            .to.emit(token, EVENT_NAME_BURN)
            .withArgs(minter.address, expectedAmount);
          await expect(tx)
            .to.emit(token, EVENT_NAME_TRANSFER)
            .withArgs(user.address, ethers.constants.AddressZero, expectedAmount);
        }

        await expect(tx)
          .to.emit(token, EVENT_NAME_PREMINT)
          .withArgs(minter.address, user.address, newAmount, oldAmount, release);

        await expect(tx).to.changeTokenBalances(token, [user], [newAmount - oldAmount]);
        expect(await token.minterAllowance(minter.address)).to.equal(newMintAllowance);
        expect(await token.balanceOfPremint(user.address)).to.eq(balanceOfPremint);

        const premints = await token.getPremints(user.address);
        expect(premints.length).to.eq(premintCount);

        if (premintCount > 0) {
          expect(premints[premintIndex].release).to.eq(release);
          expect(premints[premintIndex].amount).to.eq(newAmount);
        }
      }

      it("A new premint is created and the caller and recipient are not blocklisted", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        await executeAndCheckPremint(token);
      });

      it("A new premint is created and the recipient is blocklisted but the caller is a blocklister", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        await proveTx(token.connect(mainBlocklister).configureBlocklister(minter.address, true));
        await proveTx(token.connect(user).selfBlocklist());
        await executeAndCheckPremint(token);
      });

      it("The caller increases the amount of an existing premint", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        await proveTx(token.connect(minter).premintIncrease(user.address, TOKEN_AMOUNT, timestamp));
        await executeAndCheckPremint(token, {
          amount: 1,
          oldAmount: TOKEN_AMOUNT
        });
      });

      it("The caller decreases the amount of an existing premint", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        await proveTx(token.connect(minter).premintIncrease(user.address, TOKEN_AMOUNT, timestamp));
        await executeAndCheckPremint(token, {
          amount: 1,
          oldAmount: TOKEN_AMOUNT,
          premintFunction: PremintFunction.Decrease
        });
      });

      it("The caller removes an existing premint using the decreasing function", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        await proveTx(token.connect(minter).premintIncrease(user.address, TOKEN_AMOUNT, timestamp));
        await executeAndCheckPremint(token, {
          amount: TOKEN_AMOUNT,
          oldAmount: TOKEN_AMOUNT,
          premintCount: 0,
          premintFunction: PremintFunction.Decrease
        });
      });

      it("The limit of premint number is reached, but some of them are expired", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        for (let i = 0; i < MAX_PENDING_PREMINTS_COUNT; i++) {
          await proveTx(
            token.connect(minter).premintIncrease(user.address, TOKEN_AMOUNT, timestamp + i * 10)
          );
        }
        expect(await token.balanceOfPremint(user.address)).to.eq(TOKEN_AMOUNT * MAX_PENDING_PREMINTS_COUNT);
        await time.increaseTo(timestamp + 1);
        expect(await token.balanceOfPremint(user.address)).to.eq(TOKEN_AMOUNT * (MAX_PENDING_PREMINTS_COUNT - 1));
        await executeAndCheckPremint(token, {
          amount: TOKEN_AMOUNT + 1,
          oldAmount: 0,
          release: timestamp * 2,
          premintCount: MAX_PENDING_PREMINTS_COUNT,
          premintIndex: MAX_PENDING_PREMINTS_COUNT - 1,
          balanceOfPremint: TOKEN_AMOUNT * MAX_PENDING_PREMINTS_COUNT + 1,
        });
      });

      it("The caller adds a premint and all other premints are expired", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        let i = 0;
        for (; i < MAX_PENDING_PREMINTS_COUNT; i++) {
          await proveTx(
            token.connect(minter).premintIncrease(user.address, TOKEN_AMOUNT, timestamp + i * 10)
          );
        }

        // set time to expire all premints
        const newTimestamp = timestamp + (i - 1) * 10 + 1;
        await time.increaseTo(newTimestamp);

        await executeAndCheckPremint(token, {
          release: newTimestamp + 10,
          premintCount: 1,
          premintIndex: 0
        });
      });

      it("The caller changes a premint and some expired premints are in the beginning of the array", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const timestamps: number[] = Array.from(
          { length: MAX_PENDING_PREMINTS_COUNT },
          (_v, i) => timestamp + (i + 1) * 10
        );
        for (let i = 0; i < timestamps.length; i++) {
          await proveTx(
            token.connect(minter).premintIncrease(user.address, TOKEN_AMOUNT, timestamps[i])
          );
        }
        // set time to expire premints in the beginning of array
        await time.increaseTo(timestamps[1] + 1);

        await executeAndCheckPremint(token, {
          amount: 1,
          oldAmount: TOKEN_AMOUNT,
          release: timestamps[2],
          premintCount: MAX_PENDING_PREMINTS_COUNT - 2,
          premintIndex: 2,
          balanceOfPremint: TOKEN_AMOUNT * (MAX_PENDING_PREMINTS_COUNT - 2) + 1,
          premintFunction: PremintFunction.Increase
        });
      });

      it("The caller changes a premint and some expired premints are in the middle of the array", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const timestamps: number[] = Array.from(
          { length: MAX_PENDING_PREMINTS_COUNT },
          (_v, i) => timestamp + (i + 1) * 10
        );
        timestamps[2] = timestamp + 1;
        timestamps[3] = timestamp + 2;
        for (let i = 0; i < MAX_PENDING_PREMINTS_COUNT; i++) {
          await proveTx(
            token.connect(minter).premintIncrease(user.address, TOKEN_AMOUNT, timestamps[i])
          );
        }

        // set time to expire premints in the middle of array
        await time.increaseTo(timestamp + 3);

        // update premint in the beginning of array before expired premints
        await executeAndCheckPremint(token, {
          amount: 1,
          oldAmount: TOKEN_AMOUNT,
          release: timestamps[1],
          premintCount: MAX_PENDING_PREMINTS_COUNT - 2,
          premintIndex: 1,
          balanceOfPremint: TOKEN_AMOUNT * (MAX_PENDING_PREMINTS_COUNT - 2) - 1,
          premintFunction: PremintFunction.Decrease
        });
      });

      it("The caller changes a premint and some expired premints are in the end of the array", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const timestamps: number[] = Array.from(
          { length: MAX_PENDING_PREMINTS_COUNT },
          (_v, i) => timestamp + (i + 1) * 10
        );
        timestamps[MAX_PENDING_PREMINTS_COUNT - 1] = timestamp + 2;
        timestamps[MAX_PENDING_PREMINTS_COUNT - 2] = timestamp + 1;

        for (let i = 0; i < MAX_PENDING_PREMINTS_COUNT; i++) {
          await proveTx(
            token.connect(minter).premintIncrease(user.address, TOKEN_AMOUNT, timestamps[i])
          );
        }

        // set time to expire premints in the end of array
        await time.increaseTo(timestamp + 3);

        // update premint in array before expired premints
        await executeAndCheckPremint(token, {
          amount: 1,
          oldAmount: TOKEN_AMOUNT,
          release: timestamps[1],
          premintCount: MAX_PENDING_PREMINTS_COUNT - 2,
          premintIndex: 1,
          balanceOfPremint: TOKEN_AMOUNT * (MAX_PENDING_PREMINTS_COUNT - 2) - 1,
          premintFunction: PremintFunction.Decrease
        });
      });
    });

    describe("Are reverted if", async () => {
      it("The contract is paused", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        await proveTx(token.connect(minter).premintIncrease(user.address, TOKEN_AMOUNT, timestamp));
        await proveTx(token.connect(pauser).pause());
        await expect(token.connect(minter).premintIncrease(user.address, 1, timestamp))
          .to.be.revertedWith(REVERT_MESSAGE_PAUSABLE_PAUSED);
        await expect(token.connect(minter).premintDecrease(user.address, 1, timestamp))
          .to.be.revertedWith(REVERT_MESSAGE_PAUSABLE_PAUSED);
      });

      it("The provided release time has passed", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const timestamp = (await time.latest()) - 1;
        await expect(token.connect(minter).premintIncrease(user.address, TOKEN_AMOUNT, timestamp))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_PREMINT_RELEASE_TIME_PASSED);
        await expect(token.connect(minter).premintDecrease(user.address, TOKEN_AMOUNT, timestamp))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_PREMINT_RELEASE_TIME_PASSED);
      });

      it("The amount of premint is greater than 64-bit unsigned integer", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const overflowAmount = BigNumber.from("18446744073709551616"); // uint64 max + 1
        await expect(token.connect(minter).premintIncrease(user.address, overflowAmount, timestamp))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_INAPPROPRIATE_UINT64_VALUE)
          .withArgs(overflowAmount);
      });

      it("The caller is not a minter", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        await expect(token.connect(user).premintIncrease(user.address, TOKEN_AMOUNT, timestamp))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_UNAUTHORIZED_MINTER)
          .withArgs(user.address);
        await expect(token.connect(user).premintDecrease(user.address, TOKEN_AMOUNT, timestamp))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_UNAUTHORIZED_MINTER)
          .withArgs(user.address);
      });

      it("The caller is blocklisted even if the caller is a blocklister", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        await proveTx(token.connect(mainBlocklister).configureBlocklister(minter.address, true));
        await proveTx(token.connect(minter).selfBlocklist());
        await expect(token.connect(minter).premintIncrease(user.address, TOKEN_AMOUNT, timestamp))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_BLOCKLISTED_ACCOUNT)
          .withArgs(minter.address);
        await expect(token.connect(minter).premintDecrease(user.address, TOKEN_AMOUNT, timestamp))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_BLOCKLISTED_ACCOUNT)
          .withArgs(minter.address);
      });

      it("The recipient is blocklisted and the caller is not a blocklister", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        await proveTx(token.connect(minter).premintIncrease(user.address, TOKEN_AMOUNT, timestamp));
        await proveTx(token.connect(user).selfBlocklist());
        await expect(token.connect(minter).premintIncrease(user.address, 1, timestamp))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_BLOCKLISTED_ACCOUNT)
          .withArgs(user.address);
        await expect(token.connect(minter).premintDecrease(user.address, 1, timestamp))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_BLOCKLISTED_ACCOUNT)
          .withArgs(user.address);
      });

      it("The recipient address is zero", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        await expect(
          token.connect(minter).premintIncrease(ethers.constants.AddressZero, TOKEN_AMOUNT, timestamp)
        ).to.be.revertedWith(REVERT_MESSAGE_ERC20_MINT_TO_THE_ZERO_ACCOUNT);
      });

      it("The amount of a new premint is zero", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        await expect(token.connect(minter).premintIncrease(user.address, 0, timestamp))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_ZERO_PREMINT_AMOUNT);
      });

      it("The amount of a new premint exceeds the mint allowance", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        await expect(
          token.connect(minter).premintIncrease(user.address, MINT_ALLOWANCE + 1, timestamp)
        ).to.be.revertedWithCustomError(token, REVERT_ERROR_EXCEEDED_MINT_ALLOWANCE);
      });

      it("The max pending premints limit is reached during creation a new premint", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        let i = 0;
        for (; i < MAX_PENDING_PREMINTS_COUNT; i++) {
          await proveTx(
            token.connect(minter).premintIncrease(user.address, TOKEN_AMOUNT, timestamp + i * 10)
          );
        }
        await expect(
          token.connect(minter).premintIncrease(user.address, TOKEN_AMOUNT, timestamp + i * 10)
        ).to.be.revertedWithCustomError(token, REVERT_ERROR_MAX_PENDING_PREMINTS_LIMIT_REACHED);
      });

      it("The caller changes an existing premint with the same amount", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        await proveTx(token.connect(minter).premintIncrease(user.address, TOKEN_AMOUNT, timestamp));
        await expect(token.connect(minter).premintIncrease(user.address, 0, timestamp))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_PREMINT_UNCHANGED);
        await expect(token.connect(minter).premintDecrease(user.address, 0, timestamp))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_PREMINT_UNCHANGED);
      });

      it("The caller tries to change a non-existing premint", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        await expect(token.connect(minter).premintDecrease(user.address, TOKEN_AMOUNT, timestamp))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_PREMINT_NON_EXISTENT);
      });

      it("The caller tries to decrease the amount of a premint below the existing amount", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        await proveTx(token.connect(minter).premintIncrease(user.address, TOKEN_AMOUNT, timestamp));
        await expect(
          token.connect(minter).premintDecrease(user.address, TOKEN_AMOUNT + 1, timestamp)
        ).to.be.revertedWithCustomError(token, REVERT_ERROR_PREMINT_INSUFFICIENT_AMOUNT);
      });
    });
  });

  describe("Function 'reschedulePremints()'", async () => {
    let timestamp: number;
    before(async () => {
      timestamp = (await time.latest()) + 100;
    });

    async function checkPremints(token: Contract, expectedPremints: Premint[]) {
      const premints = await token.getPremints(user.address);
      expect(premints.length).to.eq(expectedPremints.length);
      for (let i = 0; i < expectedPremints.length; ++i) {
        expect(premints[i].amount).to.eq(expectedPremints[i].amount);
        expect(premints[i].release).to.eq(expectedPremints[i].release);
      }
    }

    async function checkPremintReleaseResolving(token: Contract, originalRelease: number, targetRelease: number) {
      const contractTargetRelease = await token.connect(minter).resolvePremintRelease(originalRelease);
      expect(contractTargetRelease).to.be.eq(targetRelease);
    }

    async function checkPremintOriginalReleaseCounter(token: Contract, targetRelease: number, expectedCounter: number) {
      const actualCounter = await token.connect(minter).getPremintOriginalReleaseCounter(targetRelease);
      expect(actualCounter).to.be.eq(expectedCounter);
    }

    async function reschedulePremintsAndCheckEvents(
      token: Contract,
      originalRelease: number,
      targetRelease: number
    ) {
      await expect(
        token.connect(minter).reschedulePremints(
          originalRelease,
          targetRelease
        )
      ).to.emit(
        token,
        EVENT_NAME_PREMINTS_RESCHEDULED
      ).withArgs(
        minter.address,
        originalRelease,
        targetRelease
      );
    }

    describe("Executes as expected if ", async () => {
      it("The configured target release timestamp is after the original timestamps", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const originalReleaseTimestamps: number[] = [timestamp, timestamp + 10];
        const targetReleaseTimestamp = timestamp + 20;
        const expectedPremints: Premint[] = originalReleaseTimestamps.map(
          timestamp => ({ amount: TOKEN_AMOUNT, release: timestamp })
        );

        for (const premint of expectedPremints) {
          await proveTx(token.connect(minter).premintIncrease(user.address, premint.amount, premint.release));
        }
        await checkPremints(token, expectedPremints);
        await checkPremintReleaseResolving(token, originalReleaseTimestamps[0], originalReleaseTimestamps[0]);
        await checkPremintReleaseResolving(token, originalReleaseTimestamps[1], originalReleaseTimestamps[1]);
        await checkPremintOriginalReleaseCounter(token, targetReleaseTimestamp, 0);

        await reschedulePremintsAndCheckEvents(token, originalReleaseTimestamps[0], targetReleaseTimestamp);
        expectedPremints[0].release = targetReleaseTimestamp;
        await checkPremints(token, expectedPremints);
        await checkPremintReleaseResolving(token, originalReleaseTimestamps[0], targetReleaseTimestamp);
        await checkPremintReleaseResolving(token, originalReleaseTimestamps[1], originalReleaseTimestamps[1]);
        await checkPremintOriginalReleaseCounter(token, targetReleaseTimestamp, 1);

        await reschedulePremintsAndCheckEvents(token, originalReleaseTimestamps[1], targetReleaseTimestamp);
        expectedPremints[1].release = targetReleaseTimestamp;
        await checkPremints(token, expectedPremints);
        await checkPremintReleaseResolving(token, originalReleaseTimestamps[0], targetReleaseTimestamp);
        await checkPremintReleaseResolving(token, originalReleaseTimestamps[1], targetReleaseTimestamp);
        await checkPremintOriginalReleaseCounter(token, targetReleaseTimestamp, 2);

        const premintBalances: BigNumber[] = [];
        premintBalances.push(await token.balanceOfPremint(user.address));
        const newPremint: Premint = ({ amount: TOKEN_AMOUNT, release: timestamp + 1000 });

        // Shift the block time to the first original release timestamp
        await time.increaseTo(originalReleaseTimestamps[0]);

        // Check that the premints are still here after adding and removing a new one
        await proveTx(token.connect(minter).premintIncrease(user.address, newPremint.amount, newPremint.release));
        await proveTx(token.connect(minter).premintDecrease(user.address, newPremint.amount, newPremint.release));
        await checkPremints(token, expectedPremints);
        premintBalances.push(await token.balanceOfPremint(user.address));

        // Shift the block time to the next original release timestamp
        await time.increaseTo(originalReleaseTimestamps[1]);

        // Check that the premints are still here after adding and removing a new one
        await proveTx(token.connect(minter).premintIncrease(user.address, newPremint.amount, newPremint.release));
        await proveTx(token.connect(minter).premintDecrease(user.address, newPremint.amount, newPremint.release));
        await checkPremints(token, expectedPremints);
        premintBalances.push(await token.balanceOfPremint(user.address));

        // Shift the block time to the target release timestamp
        await time.increaseTo(targetReleaseTimestamp);

        // Check that the premints disappeared after adding a new one
        await proveTx(token.connect(minter).premintIncrease(user.address, newPremint.amount, newPremint.release));
        await checkPremints(token, [newPremint]);
        await proveTx(token.connect(minter).premintDecrease(user.address, newPremint.amount, newPremint.release));
        premintBalances.push(await token.balanceOfPremint(user.address));

        // Check premint balances at each timestamp
        expect(premintBalances[0]).to.be.eq(TOKEN_AMOUNT * expectedPremints.length);
        expect(premintBalances[1]).to.be.eq(premintBalances[0]);
        expect(premintBalances[2]).to.be.eq(premintBalances[0]);
        expect(premintBalances[3]).to.be.eq(0);
      });

      it("The configured target release timestamp is before the original timestamp", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const originalReleaseTimestamp = timestamp;
        const targetReleaseTimestamp = timestamp - 10;
        const expectedPremint: Premint = { amount: TOKEN_AMOUNT, release: timestamp };

        await proveTx(
          token.connect(minter).premintIncrease(user.address, expectedPremint.amount, expectedPremint.release)
        );
        await reschedulePremintsAndCheckEvents(token, originalReleaseTimestamp, targetReleaseTimestamp);
        expectedPremint.release = targetReleaseTimestamp;
        await checkPremints(token, [expectedPremint]);
        await checkPremintReleaseResolving(token, originalReleaseTimestamp, targetReleaseTimestamp);
        await checkPremintOriginalReleaseCounter(token, targetReleaseTimestamp, 1);

        const premintBalances: BigNumber[] = [];
        premintBalances.push(await token.balanceOfPremint(user.address));
        const newPremint: Premint = ({ amount: TOKEN_AMOUNT, release: timestamp + 1000 });

        // Shift the block time to the target release timestamp
        await time.increaseTo(targetReleaseTimestamp);

        // Check that the premints disappeared after adding a new one
        await proveTx(token.connect(minter).premintIncrease(user.address, newPremint.amount, newPremint.release));
        await checkPremints(token, [newPremint]);
        await proveTx(token.connect(minter).premintDecrease(user.address, newPremint.amount, newPremint.release));
        premintBalances.push(await token.balanceOfPremint(user.address));

        // Shift the block time to the original release timestamp
        await time.increaseTo(originalReleaseTimestamp);
        premintBalances.push(await token.balanceOfPremint(user.address));

        // Check premint balances at each timestamp
        expect(premintBalances[0]).to.be.eq(TOKEN_AMOUNT);
        expect(premintBalances[1]).to.be.eq(0);
        expect(premintBalances[2]).to.be.eq(0);
      });

      it("The reschedulings are removed", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const originalReleaseTimestamps: number[] = [timestamp, timestamp + 10];
        const targetReleaseTimestamp = timestamp + 20;

        await reschedulePremintsAndCheckEvents(token, originalReleaseTimestamps[0], targetReleaseTimestamp);
        await reschedulePremintsAndCheckEvents(token, originalReleaseTimestamps[1], targetReleaseTimestamp);
        await checkPremintReleaseResolving(token, originalReleaseTimestamps[0], targetReleaseTimestamp);
        await checkPremintReleaseResolving(token, originalReleaseTimestamps[1], targetReleaseTimestamp);
        await checkPremintOriginalReleaseCounter(token, targetReleaseTimestamp, 2);
        await checkPremintOriginalReleaseCounter(token, originalReleaseTimestamps[0], 0);
        await checkPremintOriginalReleaseCounter(token, originalReleaseTimestamps[1], 0);

        await reschedulePremintsAndCheckEvents(token, originalReleaseTimestamps[0], originalReleaseTimestamps[0]);
        await checkPremintReleaseResolving(token, originalReleaseTimestamps[0], originalReleaseTimestamps[0]);
        await checkPremintReleaseResolving(token, originalReleaseTimestamps[1], targetReleaseTimestamp);
        await checkPremintOriginalReleaseCounter(token, targetReleaseTimestamp, 1);

        await reschedulePremintsAndCheckEvents(token, originalReleaseTimestamps[1], originalReleaseTimestamps[1]);
        await checkPremintReleaseResolving(token, originalReleaseTimestamps[0], originalReleaseTimestamps[0]);
        await checkPremintReleaseResolving(token, originalReleaseTimestamps[1], originalReleaseTimestamps[1]);
        await checkPremintOriginalReleaseCounter(token, targetReleaseTimestamp, 0);

        await checkPremintOriginalReleaseCounter(token, originalReleaseTimestamps[0], 0);
        await checkPremintOriginalReleaseCounter(token, originalReleaseTimestamps[1], 0);
        await checkPremintOriginalReleaseCounter(token, 0, 0);
      });
    });

    describe("Is reverted if", async () => {
      it("The contract is paused", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const originalRelease = timestamp;
        const targetRelease = timestamp + 1;
        await proveTx(token.connect(pauser).pause());
        await expect(
          token.connect(minter).reschedulePremints(originalRelease, targetRelease)
        ).to.be.revertedWith(REVERT_MESSAGE_PAUSABLE_PAUSED);
      });

      it("The caller is not a minter", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const originalRelease = timestamp;
        const targetRelease = timestamp + 1;
        await expect(token.connect(user).reschedulePremints(originalRelease, targetRelease))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_UNAUTHORIZED_MINTER)
          .withArgs(user.address);
      });

      it("The caller is blocklisted even if the caller is a blocklister", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const originalRelease = timestamp;
        const targetRelease = timestamp + 1;
        await proveTx(token.connect(mainBlocklister).configureBlocklister(minter.address, true));
        await proveTx(token.connect(minter).selfBlocklist());
        await expect(token.connect(minter).reschedulePremints(originalRelease, targetRelease))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_BLOCKLISTED_ACCOUNT)
          .withArgs(minter.address);
      });

      it("The provided target release timestamp for the rescheduling is passed", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const originalRelease = timestamp;
        const targetRelease = await time.latest() - 1;
        await expect(
          token.connect(minter).reschedulePremints(originalRelease, targetRelease)
        ).to.be.revertedWithCustomError(token, REVERT_ERROR_PREMINTS_RESCHEDULING_TIME_PASSED);
      });

      it("The provided original release time has passed", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const originalRelease = await time.latest() - 1;
        const targetRelease = originalRelease + 1000;
        await expect(
          token.connect(minter).reschedulePremints(originalRelease, targetRelease)
        ).to.be.revertedWithCustomError(token, REVERT_ERROR_PREMINT_RELEASE_TIME_PASSED);
      });

      it("The provided resolved original release time has passed", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const originalRelease = timestamp;
        const targetRelease1 = originalRelease + 1;
        const targetRelease2 = originalRelease + 1000;
        await proveTx(token.connect(minter).reschedulePremints(originalRelease, targetRelease1));
        await time.increaseTo(targetRelease1);
        await expect(
          token.connect(minter).reschedulePremints(originalRelease, targetRelease2)
        ).to.be.revertedWithCustomError(token, REVERT_ERROR_PREMINT_RELEASE_TIME_PASSED);
      });

      it("The provided target release time is already configured", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const originalRelease = timestamp;
        const targetRelease = timestamp + 1;
        await proveTx(token.connect(minter).reschedulePremints(originalRelease, targetRelease));
        await expect(
          token.connect(minter).reschedulePremints(originalRelease, targetRelease)
        ).to.be.revertedWithCustomError(token, REVERT_ERROR_PREMINTS_RESCHEDULING_ALREADY_CONFIGURED);
      });

      it("The provided original release time equals the provided target release time", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        await expect(
          token.connect(minter).reschedulePremints(timestamp, timestamp)
        ).to.be.revertedWithCustomError(token, REVERT_ERROR_PREMINTS_RESCHEDULING_ALREADY_CONFIGURED);
      });

      it("A rescheduling chain will be made in result", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const originalRelease = timestamp;
        const targetRelease1 = timestamp + 1;
        const targetRelease2 = timestamp + 2;
        await proveTx(token.connect(minter).reschedulePremints(originalRelease, targetRelease1));
        await expect(
          token.connect(minter).reschedulePremints(targetRelease1, targetRelease2)
        ).to.be.revertedWithCustomError(token, REVERT_ERROR_PREMINTS_RESCHEDULING_CHAIN);
      });

      it("The provided target release time is greater than 64-bit unsigned integer", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const originalRelease = timestamp;
        const targetRelease = BigNumber.from("18446744073709551616"); // uint64 max + 1
        await expect(token.connect(minter).reschedulePremints(originalRelease, targetRelease))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_INAPPROPRIATE_UINT64_VALUE)
          .withArgs(targetRelease);
      });
    });
  });

  describe("Function 'configureMaxPendingPremintsCount()'", async () => {
    it("Executes as expected and emits the correct event", async () => {
      const { token } = await setUpFixture(deployToken);
      expect(await token.maxPendingPremintsCount()).to.eq(0);
      expect(await token.connect(deployer).configureMaxPendingPremintsCount(MAX_PENDING_PREMINTS_COUNT))
        .to.emit(token, EVENT_NAME_MAX_PENDING_PREMINTS_COUNT_CONFIGURED)
        .withArgs(MAX_PENDING_PREMINTS_COUNT);
      expect(await token.maxPendingPremintsCount()).to.eq(MAX_PENDING_PREMINTS_COUNT);
    });

    it("Is reverted if the limit is already configured with the same number", async () => {
      const { token } = await setUpFixture(deployToken);
      await proveTx(token.connect(deployer).configureMaxPendingPremintsCount(MAX_PENDING_PREMINTS_COUNT));
      expect(token.connect(deployer).configureMaxPendingPremintsCount(MAX_PENDING_PREMINTS_COUNT))
        .to.be.revertedWithCustomError(token, REVERT_ERROR_MAX_PENDING_PREMINTS_COUNT_ALREADY_CONFIGURED);
    });

    it("Is reverted if caller is not an owner", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      expect(token.connect(user).configureMaxPendingPremintsCount(0))
        .to.be.revertedWith(REVERT_MESSAGE_OWNABLE_CALLER_IS_NOT_THE_OWNER);
    });
  });

  describe("Function 'balanceOfPremint()'", async () => {
    it("Returns the correct balance of premint", async () => {
      const timestamp = (await time.latest()) + 100;
      const { token } = await setUpFixture(deployAndConfigureToken);

      await proveTx(token.connect(minter).premintIncrease(user.address, TOKEN_AMOUNT, timestamp));
      await proveTx(
        token.connect(minter).premintIncrease(user.address, TOKEN_AMOUNT + 1, timestamp + 50)
      );
      expect(await token.balanceOfPremint(user.address)).to.eq(TOKEN_AMOUNT * 2 + 1);

      await time.increaseTo(timestamp);
      expect(await token.balanceOfPremint(user.address)).to.eq(TOKEN_AMOUNT + 1);

      await time.increaseTo(timestamp + 50);
      expect(await token.balanceOfPremint(user.address)).to.eq(0);
    });
  });
});
