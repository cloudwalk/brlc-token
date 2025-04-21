import { ethers, network, upgrades } from "hardhat";
import { expect } from "chai";
import { Contract, ContractFactory, TransactionResponse } from "ethers";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { connect, getLatestBlockTimestamp, increaseBlockTimestampTo, proveTx } from "../../test-utils/eth";

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
  const EVENT_NAME_PREMINT_RELEASE_RESCHEDULED = "PremintReleaseRescheduled";
  const EVENT_NAME_MINT_FROM_RESERVE = "MintFromReserve";
  const EVENT_NAME_BURN_TO_RESERVE = "BurnToReserve";

  // Errors of the lib contracts
  const REVERT_ERROR_CONTRACT_INITIALIZATION_IS_INVALID = "InvalidInitialization";
  const REVERT_ERROR_CONTRACT_IS_NOT_INITIALIZING = "NotInitializing";
  const REVERT_ERROR_CONTRACT_IS_PAUSED = "EnforcedPause";
  const REVERT_ERROR_UNAUTHORIZED_ACCOUNT = "AccessControlUnauthorizedAccount";
  const REVERT_MESSAGE_ERC20_MINT_TO_THE_ZERO_ACCOUNT = "ERC20: mint to the zero address";
  const REVERT_MESSAGE_ERC20_BURN_AMOUNT_EXCEEDS_BALANCE = "ERC20: burn amount exceeds balance";

  // Errors of the contracts under test
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
  const REVERT_ERROR_PREMINT_RESCHEDULING_ALREADY_CONFIGURED = "PremintReschedulingAlreadyConfigured";
  const REVERT_ERROR_PREMINT_RESCHEDULING_TIME_PASSED = "PremintReschedulingTimePassed";
  const REVERT_ERROR_PREMINT_RESCHEDULING_CHAIN = "PremintReschedulingChain";
  const REVERT_ERROR_MAX_PENDING_PREMINTS_LIMIT_REACHED = "MaxPendingPremintsLimitReached";
  const REVERT_ERROR_MAX_PENDING_PREMINTS_COUNT_ALREADY_CONFIGURED = "MaxPendingPremintsCountAlreadyConfigured";
  const REVERT_ERROR_INAPPROPRIATE_UINT64_VALUE = "InappropriateUint64Value";
  const REVERT_ERROR_INSUFFICIENT_RESERVE_SUPPLY = "InsufficientReserveSupply";

  const OWNER_ROLE: string = ethers.id("OWNER_ROLE");

  enum PremintFunction {
    Increase = 0,
    Decrease = 1
  }

  interface Premint {
    amount: number;
    release: number;
  }

  let tokenFactory: ContractFactory;
  let deployer: HardhatEthersSigner;
  let pauser: HardhatEthersSigner;
  let mainMinter: HardhatEthersSigner;
  let minter: HardhatEthersSigner;
  let user: HardhatEthersSigner;
  let recipient: HardhatEthersSigner;

  before(async () => {
    [deployer, pauser, mainMinter, minter, user, recipient] = await ethers.getSigners();
    tokenFactory = await ethers.getContractFactory("ERC20MintableMock");
    tokenFactory = tokenFactory.connect(deployer); // Explicitly specifying the deployer account
  });

  async function deployToken(): Promise<{ token: Contract }> {
    let token: Contract = await upgrades.deployProxy(
      tokenFactory,
      [TOKEN_NAME, TOKEN_SYMBOL],
      { unsafeSkipProxyAdminCheck: true } // This is necessary to run tests on other networks
    ) as Contract;
    await token.waitForDeployment();
    token = connect(token, deployer); // Explicitly specifying the initial account
    return { token };
  }

  async function deployAndConfigureToken(): Promise<{ token: Contract }> {
    const { token } = await deployToken();
    await proveTx(token.setPauser(pauser.address));
    await proveTx(token.updateMainMinter(mainMinter.address));
    await proveTx(token.configureMaxPendingPremintsCount(MAX_PENDING_PREMINTS_COUNT));
    await proveTx(connect(token, mainMinter).configureMinter(minter.address, MINT_ALLOWANCE));
    return { token };
  }

  describe("Function 'initialize()'", async () => {
    it("Configures the contract as expected", async () => {
      const { token } = await setUpFixture(deployToken);
      expect(await token.getRoleAdmin(OWNER_ROLE)).to.equal(OWNER_ROLE);
      expect(await token.hasRole(OWNER_ROLE, deployer.address)).to.equal(true);
      expect(await token.pauser()).to.eq(ethers.ZeroAddress);
      expect(await token.mainMinter()).to.eq(ethers.ZeroAddress);
      expect(await token.maxPendingPremintsCount()).to.eq(0);
    });

    it("Is reverted if called for the second time", async () => {
      const { token } = await setUpFixture(deployToken);
      await expect(
        token.initialize(TOKEN_NAME, TOKEN_SYMBOL)
      ).to.be.revertedWithCustomError(token, REVERT_ERROR_CONTRACT_INITIALIZATION_IS_INVALID);
    });

    it("Is reverted if the internal unchained initializer is called outside of the init process", async () => {
      const { token } = await setUpFixture(deployToken);
      await expect(
        token.call_parent_initialize_unchained()
      ).to.be.revertedWithCustomError(token, REVERT_ERROR_CONTRACT_IS_NOT_INITIALIZING);
    });
  });

  describe("Function 'updateMainMinter()'", async () => {
    it("Executes as expected and emits the correct event", async () => {
      const { token } = await setUpFixture(deployToken);
      await expect(token.updateMainMinter(mainMinter.address))
        .to.emit(token, EVENT_NAME_MAIN_MINTER_CHANGED)
        .withArgs(mainMinter.address);
      expect(await token.mainMinter()).to.eq(mainMinter.address);
      await expect(
        token.updateMainMinter(mainMinter.address)
      ).not.to.emit(token, EVENT_NAME_MAIN_MINTER_CHANGED);
    });

    it("Is reverted if the caller does not have the owner role", async () => {
      const { token } = await setUpFixture(deployToken);
      await expect(connect(token, user).updateMainMinter(mainMinter.address))
        .to.be.revertedWithCustomError(token, REVERT_ERROR_UNAUTHORIZED_ACCOUNT)
        .withArgs(user.address, OWNER_ROLE);
    });
  });

  describe("Function 'configureMinter()'", async () => {
    it("Executes as expected and emits the correct event", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(connect(token, mainMinter).removeMinter(minter.address));
      expect(await token.isMinter(minter.address)).to.eq(false);
      expect(await token.minterAllowance(minter.address)).to.eq(0);
      await expect(connect(token, mainMinter).configureMinter(minter.address, MINT_ALLOWANCE))
        .to.emit(token, EVENT_NAME_MINTER_CONFIGURED)
        .withArgs(minter.address, MINT_ALLOWANCE);
      expect(await token.isMinter(minter.address)).to.eq(true);
      expect(await token.minterAllowance(minter.address)).to.eq(MINT_ALLOWANCE);
    });

    it("Is reverted if the contract is paused", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(connect(token, mainMinter).removeMinter(minter.address));
      await proveTx(connect(token, pauser).pause());
      await expect(
        connect(token, mainMinter).configureMinter(minter.address, MINT_ALLOWANCE)
      ).to.be.revertedWithCustomError(token, REVERT_ERROR_CONTRACT_IS_PAUSED);
    });

    it("Is reverted if called not by the main minter", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(connect(token, mainMinter).removeMinter(minter.address));
      await expect(connect(token, user).configureMinter(minter.address, MINT_ALLOWANCE))
        .to.be.revertedWithCustomError(token, REVERT_ERROR_UNAUTHORIZED_MAIN_MINTER)
        .withArgs(user.address);
    });
  });

  describe("Function 'removeMinter()'", async () => {
    it("Executes as expected and emits the correct event", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      expect(await token.isMinter(minter.address)).to.eq(true);
      expect(await token.minterAllowance(minter.address)).to.eq(MINT_ALLOWANCE);
      await expect(connect(token, mainMinter).removeMinter(minter.address))
        .to.emit(token, EVENT_NAME_MINTER_REMOVED)
        .withArgs(minter.address);
      expect(await token.isMinter(minter.address)).to.eq(false);
      expect(await token.minterAllowance(minter.address)).to.eq(0);
      await expect(
        connect(token, mainMinter).removeMinter(minter.address)
      ).not.to.emit(token, EVENT_NAME_MINTER_REMOVED);
    });

    it("Is reverted if called not by the main minter", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await expect(connect(token, user).removeMinter(minter.address))
        .to.be.revertedWithCustomError(token, REVERT_ERROR_UNAUTHORIZED_MAIN_MINTER)
        .withArgs(user.address);
    });
  });

  describe("Function 'mint()'", async () => {
    describe("Executes as expected and emits the correct events if", async () => {
      it("All needed conditions are met", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const oldMintAllowance: bigint = await token.minterAllowance(minter.address);
        const newExpectedMintAllowance: bigint = oldMintAllowance - BigInt(TOKEN_AMOUNT);
        const tx: TransactionResponse = await connect(token, minter).mint(user.address, TOKEN_AMOUNT);
        await expect(tx).to.emit(token, EVENT_NAME_MINT).withArgs(minter.address, user.address, TOKEN_AMOUNT);
        await expect(tx)
          .to.emit(token, EVENT_NAME_TRANSFER)
          .withArgs(ethers.ZeroAddress, user.address, TOKEN_AMOUNT);
        await expect(tx).to.changeTokenBalances(token, [user], [TOKEN_AMOUNT]);
        expect(await token.minterAllowance(minter.address)).to.eq(newExpectedMintAllowance);
      });
    });

    describe("Is reverted if", async () => {
      it("The contract is paused", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        await proveTx(connect(token, pauser).pause());
        await expect(
          connect(token, minter).mint(user.address, TOKEN_AMOUNT)
        ).to.be.revertedWithCustomError(token, REVERT_ERROR_CONTRACT_IS_PAUSED);
      });

      it("The caller is not a minter", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        await expect(connect(token, user).mint(user.address, TOKEN_AMOUNT))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_UNAUTHORIZED_MINTER)
          .withArgs(user.address);
      });

      it("The destination address is zero", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        await expect(
          connect(token, minter).mint(ethers.ZeroAddress, TOKEN_AMOUNT)
        ).to.be.revertedWith(REVERT_MESSAGE_ERC20_MINT_TO_THE_ZERO_ACCOUNT);
      });

      it("The mint amount is zero", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        await expect(
          connect(token, minter).mint(user.address, 0)
        ).to.be.revertedWithCustomError(token, REVERT_ERROR_ZERO_MINT_AMOUNT);
      });

      it("The mint amount exceeds the mint allowance", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        await expect(
          connect(token, minter).mint(user.address, MINT_ALLOWANCE + 1)
        ).to.be.revertedWithCustomError(token, REVERT_ERROR_EXCEEDED_MINT_ALLOWANCE);
      });
    });
  });

  describe("Function 'burn()'", async () => {
    it("Executes as expected and emits the correct events", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(connect(token, minter).mint(minter.address, TOKEN_AMOUNT));
      const tx: TransactionResponse = await connect(token, minter).burn(TOKEN_AMOUNT);
      await expect(tx).to.emit(token, EVENT_NAME_BURN).withArgs(minter.address, TOKEN_AMOUNT);
      await expect(tx)
        .to.emit(token, EVENT_NAME_TRANSFER)
        .withArgs(minter.address, ethers.ZeroAddress, TOKEN_AMOUNT);
      await expect(tx).to.changeTokenBalances(
        token,
        [minter, mainMinter, deployer, token],
        [-TOKEN_AMOUNT, 0, 0, 0]
      );
    });

    it("Is reverted if the contract is paused", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(connect(token, minter).mint(minter.address, TOKEN_AMOUNT));
      await proveTx(connect(token, pauser).pause());
      await expect(connect(token, minter).burn(TOKEN_AMOUNT))
        .to.be.revertedWithCustomError(token, REVERT_ERROR_CONTRACT_IS_PAUSED);
    });

    it("Is reverted if the caller is not a minter", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(connect(token, minter).mint(user.address, TOKEN_AMOUNT));
      await expect(connect(token, user).burn(TOKEN_AMOUNT))
        .to.be.revertedWithCustomError(token, REVERT_ERROR_UNAUTHORIZED_MINTER)
        .withArgs(user.address);
    });

    it("Is reverted if the burn amount is zero", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await expect(connect(token, minter).burn(0))
        .to.be.revertedWithCustomError(token, REVERT_ERROR_ZERO_BURN_AMOUNT);
    });

    it("Is reverted if the burn amount exceeds the caller token balance", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(connect(token, minter).mint(minter.address, TOKEN_AMOUNT));
      await expect(
        connect(token, minter).burn(TOKEN_AMOUNT + 1)
      ).to.be.revertedWith(REVERT_MESSAGE_ERC20_BURN_AMOUNT_EXCEEDS_BALANCE);
    });
  });

  describe("Function 'mintFromReserve()'", async () => {
    it("Executes as expected and emits the correct events", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);

      const oldMintAllowance: bigint = await token.minterAllowance(minter.address);
      const newExpectedMintAllowance: bigint = oldMintAllowance - BigInt(TOKEN_AMOUNT);

      const tx: TransactionResponse = await connect(token, minter).mintFromReserve(user.address, TOKEN_AMOUNT);

      await expect(tx)
        .to.emit(token, EVENT_NAME_MINT)
        .withArgs(minter.address, user.address, TOKEN_AMOUNT);

      await expect(tx)
        .to.emit(token, EVENT_NAME_MINT_FROM_RESERVE)
        .withArgs(minter.address, user.address, TOKEN_AMOUNT, TOKEN_AMOUNT);

      await expect(tx)
        .to.emit(token, EVENT_NAME_TRANSFER)
        .withArgs(ethers.ZeroAddress, user.address, TOKEN_AMOUNT);

      await expect(tx).to.changeTokenBalances(token, [user], [TOKEN_AMOUNT]);

      expect(await token.minterAllowance(minter.address)).to.eq(newExpectedMintAllowance);
      expect(await token.totalReserveSupply()).to.eq(TOKEN_AMOUNT);

      // mint another amount to verify reserve accumulates correctly
      const tx2: TransactionResponse = await connect(token, minter).mintFromReserve(recipient.address, TOKEN_AMOUNT);
      await expect(tx2)
        .to.emit(token, EVENT_NAME_MINT_FROM_RESERVE)
        .withArgs(minter.address, recipient.address, TOKEN_AMOUNT, TOKEN_AMOUNT * 2);

      expect(await token.totalReserveSupply()).to.eq(TOKEN_AMOUNT * 2);
    });

    it("Is reverted if the contract is paused", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(connect(token, pauser).pause());
      await expect(
        connect(token, minter).mintFromReserve(user.address, TOKEN_AMOUNT)
      ).to.be.revertedWithCustomError(token, REVERT_ERROR_CONTRACT_IS_PAUSED);
    });

    it("Is reverted if the caller is not a minter", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await expect(connect(token, user).mintFromReserve(user.address, TOKEN_AMOUNT))
        .to.be.revertedWithCustomError(token, REVERT_ERROR_UNAUTHORIZED_MINTER)
        .withArgs(user.address);
    });

    it("Is reverted if the mint amount is zero", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await expect(
        connect(token, minter).mintFromReserve(user.address, 0)
      ).to.be.revertedWithCustomError(token, REVERT_ERROR_ZERO_MINT_AMOUNT);
    });

    it("Is reverted if the mint amount exceeds the mint allowance", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await expect(
        connect(token, minter).mintFromReserve(user.address, MINT_ALLOWANCE + 1)
      ).to.be.revertedWithCustomError(token, REVERT_ERROR_EXCEEDED_MINT_ALLOWANCE);
    });
  });

  describe("Function 'burnToReserve()'", async () => {
    it("Executes as expected and emits the correct events", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);

      // first mint to reserve to create reserve supply
      await proveTx(connect(token, minter).mintFromReserve(minter.address, TOKEN_AMOUNT));
      expect(await token.totalReserveSupply()).to.eq(TOKEN_AMOUNT);

      const tx: TransactionResponse = await connect(token, minter).burnToReserve(TOKEN_AMOUNT / 2);

      await expect(tx)
        .to.emit(token, EVENT_NAME_BURN)
        .withArgs(minter.address, TOKEN_AMOUNT / 2);

      await expect(tx)
        .to.emit(token, EVENT_NAME_BURN_TO_RESERVE)
        .withArgs(minter.address, TOKEN_AMOUNT / 2, TOKEN_AMOUNT / 2);

      await expect(tx)
        .to.emit(token, EVENT_NAME_TRANSFER)
        .withArgs(minter.address, ethers.ZeroAddress, TOKEN_AMOUNT / 2);

      await expect(tx).to.changeTokenBalances(
        token,
        [minter, mainMinter, deployer, token],
        [-TOKEN_AMOUNT / 2, 0, 0, 0]
      );

      expect(await token.totalReserveSupply()).to.eq(TOKEN_AMOUNT / 2);

      // burn remaining tokens to verify event with zero reserve supply
      const tx2: TransactionResponse = await connect(token, minter).burnToReserve(TOKEN_AMOUNT / 2);
      await expect(tx2)
        .to.emit(token, EVENT_NAME_BURN_TO_RESERVE)
        .withArgs(minter.address, TOKEN_AMOUNT / 2, 0);

      expect(await token.totalReserveSupply()).to.eq(0);
    });

    it("Is reverted if the contract is paused", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(connect(token, minter).mintFromReserve(minter.address, TOKEN_AMOUNT));
      await proveTx(connect(token, pauser).pause());
      await expect(
        connect(token, minter).burnToReserve(TOKEN_AMOUNT)
      ).to.be.revertedWithCustomError(token, REVERT_ERROR_CONTRACT_IS_PAUSED);
    });

    it("Is reverted if the caller is not a minter", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(connect(token, minter).mintFromReserve(user.address, TOKEN_AMOUNT));
      await expect(connect(token, user).burnToReserve(TOKEN_AMOUNT))
        .to.be.revertedWithCustomError(token, REVERT_ERROR_UNAUTHORIZED_MINTER)
        .withArgs(user.address);
    });

    it("Is reverted if the burn amount is zero", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await expect(connect(token, minter).burnToReserve(0))
        .to.be.revertedWithCustomError(token, REVERT_ERROR_ZERO_BURN_AMOUNT);
    });

    it("Is reverted if the burn amount exceeds the caller token balance", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(connect(token, minter).mintFromReserve(minter.address, TOKEN_AMOUNT));
      await expect(
        connect(token, minter).burnToReserve(TOKEN_AMOUNT + 1)
      ).to.be.revertedWith(REVERT_MESSAGE_ERC20_BURN_AMOUNT_EXCEEDS_BALANCE);
    });

    it("Is reverted if the burn amount exceeds the total reserve supply", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);

      // mint non-reserve tokens to the minter
      await proveTx(connect(token, minter).mint(minter.address, TOKEN_AMOUNT));

      // mint a small amount to reserve
      await proveTx(connect(token, minter).mintFromReserve(minter.address, 1));

      // try to burn more than the reserve supply
      await expect(
        connect(token, minter).burnToReserve(2)
      ).to.be.revertedWithCustomError(token, REVERT_ERROR_INSUFFICIENT_RESERVE_SUPPLY);
    });
  });

  describe("Function 'totalReserveSupply()'", async () => {
    it("Returns the correct total reserve supply", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);

      // initial reserve supply should be 0
      expect(await token.totalReserveSupply()).to.eq(0);

      // mint to reserve should increase the reserve supply
      await proveTx(connect(token, minter).mintFromReserve(user.address, TOKEN_AMOUNT));
      expect(await token.totalReserveSupply()).to.eq(TOKEN_AMOUNT);

      // regular mint should not affect the reserve supply
      await proveTx(connect(token, minter).mint(user.address, TOKEN_AMOUNT));
      expect(await token.totalReserveSupply()).to.eq(TOKEN_AMOUNT);

      // burn to reserve should decrease the reserve supply
      await proveTx(connect(token, minter).mintFromReserve(minter.address, TOKEN_AMOUNT));
      await proveTx(connect(token, minter).burnToReserve(TOKEN_AMOUNT));
      expect(await token.totalReserveSupply()).to.eq(TOKEN_AMOUNT);

      // regular burn should not affect the reserve supply
      await proveTx(connect(token, minter).mint(minter.address, TOKEN_AMOUNT));
      await proveTx(connect(token, minter).burn(TOKEN_AMOUNT));
      expect(await token.totalReserveSupply()).to.eq(TOKEN_AMOUNT);
    });
  });

  describe("Premint functions", async () => {
    let timestamp: number;
    beforeEach(async () => {
      timestamp = (await getLatestBlockTimestamp()) + 100;
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

        const oldMintAllowance: bigint = await token.minterAllowance(minter.address);
        let newMintAllowance: bigint = oldMintAllowance;
        if (newAmount >= oldAmount) {
          newMintAllowance = newMintAllowance - BigInt(newAmount - oldAmount);
        }

        let tx: TransactionResponse;
        if (premintFunction === PremintFunction.Decrease) {
          tx = await connect(token, minter).premintDecrease(
            user.address,
            amount,
            release
          );
        } else {
          tx = await connect(token, minter).premintIncrease(
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
            .withArgs(ethers.ZeroAddress, user.address, expectedAmount);
        }
        if (newAmount < oldAmount) {
          const expectedAmount = oldAmount - newAmount;
          await expect(tx)
            .to.emit(token, EVENT_NAME_BURN)
            .withArgs(minter.address, expectedAmount);
          await expect(tx)
            .to.emit(token, EVENT_NAME_TRANSFER)
            .withArgs(user.address, ethers.ZeroAddress, expectedAmount);
        }

        await expect(tx)
          .to.emit(token, EVENT_NAME_PREMINT)
          .withArgs(minter.address, user.address, newAmount, oldAmount, release);

        await expect(tx).to.changeTokenBalances(token, [user], [newAmount - oldAmount]);
        expect(await token.minterAllowance(minter.address)).to.eq(newMintAllowance);
        expect(await token.balanceOfPremint(user.address)).to.eq(balanceOfPremint);

        const premints = await token.getPremints(user.address);
        expect(premints.length).to.eq(premintCount);

        if (premintCount > 0) {
          expect(premints[premintIndex].release).to.eq(release);
          expect(premints[premintIndex].amount).to.eq(newAmount);
        }
      }

      it("A new premint is created", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        await executeAndCheckPremint(token);
      });

      it("The caller increases the amount of an existing premint", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        await proveTx(connect(token, minter).premintIncrease(user.address, TOKEN_AMOUNT, timestamp));
        await executeAndCheckPremint(token, {
          amount: 1,
          oldAmount: TOKEN_AMOUNT
        });
      });

      it("The caller decreases the amount of an existing premint", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        await proveTx(connect(token, minter).premintIncrease(user.address, TOKEN_AMOUNT, timestamp));
        await executeAndCheckPremint(token, {
          amount: 1,
          oldAmount: TOKEN_AMOUNT,
          premintFunction: PremintFunction.Decrease
        });
      });

      it("The caller removes an existing premint using the decreasing function", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        await proveTx(connect(token, minter).premintIncrease(user.address, TOKEN_AMOUNT, timestamp));
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
          await proveTx(connect(token, minter).premintIncrease(user.address, TOKEN_AMOUNT, timestamp + i * 10));
        }
        expect(await token.balanceOfPremint(user.address)).to.eq(TOKEN_AMOUNT * MAX_PENDING_PREMINTS_COUNT);
        await increaseBlockTimestampTo(timestamp + 1);
        expect(await token.balanceOfPremint(user.address)).to.eq(TOKEN_AMOUNT * (MAX_PENDING_PREMINTS_COUNT - 1));
        await executeAndCheckPremint(token, {
          amount: TOKEN_AMOUNT + 1,
          oldAmount: 0,
          release: timestamp * 2,
          premintCount: MAX_PENDING_PREMINTS_COUNT,
          premintIndex: MAX_PENDING_PREMINTS_COUNT - 1,
          balanceOfPremint: TOKEN_AMOUNT * MAX_PENDING_PREMINTS_COUNT + 1
        });
      });

      it("The caller adds a premint and all other premints are expired", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        let i = 0;
        for (; i < MAX_PENDING_PREMINTS_COUNT; i++) {
          await proveTx(connect(token, minter).premintIncrease(user.address, TOKEN_AMOUNT, timestamp + i * 10));
        }

        // set time to expire all premints
        const newTimestamp = timestamp + (i - 1) * 10 + 1;
        await increaseBlockTimestampTo(newTimestamp);

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
          await proveTx(connect(token, minter).premintIncrease(user.address, TOKEN_AMOUNT, timestamps[i]));
        }
        // set time to expire premints in the beginning of array
        await increaseBlockTimestampTo(timestamps[1] + 1);

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
          await proveTx(connect(token, minter).premintIncrease(user.address, TOKEN_AMOUNT, timestamps[i]));
        }

        // set time to expire premints in the middle of array
        await increaseBlockTimestampTo(timestamp + 3);

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
          await proveTx(connect(token, minter).premintIncrease(user.address, TOKEN_AMOUNT, timestamps[i]));
        }

        // set time to expire premints in the end of array
        await increaseBlockTimestampTo(timestamp + 3);

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
        await proveTx(connect(token, minter).premintIncrease(user.address, TOKEN_AMOUNT, timestamp));
        await proveTx(connect(token, pauser).pause());
        await expect(connect(token, minter).premintIncrease(user.address, 1, timestamp))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_CONTRACT_IS_PAUSED);
        await expect(connect(token, minter).premintDecrease(user.address, 1, timestamp))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_CONTRACT_IS_PAUSED);
      });

      it("The provided release time has passed", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const timestamp = (await getLatestBlockTimestamp()) - 1;
        await expect(connect(token, minter).premintIncrease(user.address, TOKEN_AMOUNT, timestamp))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_PREMINT_RELEASE_TIME_PASSED);
        await expect(connect(token, minter).premintDecrease(user.address, TOKEN_AMOUNT, timestamp))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_PREMINT_RELEASE_TIME_PASSED);
      });

      it("The amount of premint is greater than 64-bit unsigned integer", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const overflowAmount = BigInt("18446744073709551616"); // uint64 max + 1
        await expect(connect(token, minter).premintIncrease(user.address, overflowAmount, timestamp))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_INAPPROPRIATE_UINT64_VALUE)
          .withArgs(overflowAmount);
      });

      it("The caller is not a minter", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        await expect(connect(token, user).premintIncrease(user.address, TOKEN_AMOUNT, timestamp))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_UNAUTHORIZED_MINTER)
          .withArgs(user.address);
        await expect(connect(token, user).premintDecrease(user.address, TOKEN_AMOUNT, timestamp))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_UNAUTHORIZED_MINTER)
          .withArgs(user.address);
      });

      it("The recipient address is zero", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        await expect(
          connect(token, minter).premintIncrease(ethers.ZeroAddress, TOKEN_AMOUNT, timestamp)
        ).to.be.revertedWith(REVERT_MESSAGE_ERC20_MINT_TO_THE_ZERO_ACCOUNT);
      });

      it("The amount of a new premint is zero", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        await expect(connect(token, minter).premintIncrease(user.address, 0, timestamp))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_ZERO_PREMINT_AMOUNT);
      });

      it("The amount of a new premint exceeds the mint allowance", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        await expect(
          connect(token, minter).premintIncrease(user.address, MINT_ALLOWANCE + 1, timestamp)
        ).to.be.revertedWithCustomError(token, REVERT_ERROR_EXCEEDED_MINT_ALLOWANCE);
      });

      it("The max pending premints limit is reached during creation a new premint", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        let i = 0;
        for (; i < MAX_PENDING_PREMINTS_COUNT; i++) {
          await proveTx(connect(token, minter).premintIncrease(user.address, TOKEN_AMOUNT, timestamp + i * 10));
        }
        await expect(
          connect(token, minter).premintIncrease(user.address, TOKEN_AMOUNT, timestamp + i * 10)
        ).to.be.revertedWithCustomError(token, REVERT_ERROR_MAX_PENDING_PREMINTS_LIMIT_REACHED);
      });

      it("The caller changes an existing premint with the same amount", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        await proveTx(connect(token, minter).premintIncrease(user.address, TOKEN_AMOUNT, timestamp));
        await expect(connect(token, minter).premintIncrease(user.address, 0, timestamp))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_PREMINT_UNCHANGED);
        await expect(connect(token, minter).premintDecrease(user.address, 0, timestamp))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_PREMINT_UNCHANGED);
      });

      it("The caller tries to change a non-existing premint", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        await expect(connect(token, minter).premintDecrease(user.address, TOKEN_AMOUNT, timestamp))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_PREMINT_NON_EXISTENT);
      });

      it("The caller tries to decrease the amount of a premint below the existing amount", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        await proveTx(connect(token, minter).premintIncrease(user.address, TOKEN_AMOUNT, timestamp));
        await expect(
          connect(token, minter).premintDecrease(user.address, TOKEN_AMOUNT + 1, timestamp)
        ).to.be.revertedWithCustomError(token, REVERT_ERROR_PREMINT_INSUFFICIENT_AMOUNT);
      });
    });
  });

  describe("Function 'reschedulePremintRelease()'", async () => {
    let timestamp: number;
    beforeEach(async () => {
      timestamp = (await getLatestBlockTimestamp()) + 100;
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
      const contractTargetRelease = await token.resolvePremintRelease(originalRelease);
      expect(contractTargetRelease).to.eq(targetRelease);
    }

    async function checkPremintOriginalReleaseCounter(token: Contract, targetRelease: number, expectedCounter: number) {
      const actualCounter = await token.getPremintReschedulingCounter(targetRelease);
      expect(actualCounter).to.eq(expectedCounter);
    }

    async function reschedulePremintReleaseAndCheckEvents(
      token: Contract,
      originalRelease: number,
      targetRelease: number
    ) {
      const oldTargetRelease = await token.resolvePremintRelease(originalRelease);
      await expect(connect(token, minter).reschedulePremintRelease(
        originalRelease,
        targetRelease
      )).to.emit(
        token,
        EVENT_NAME_PREMINT_RELEASE_RESCHEDULED
      ).withArgs(
        minter.address,
        originalRelease,
        targetRelease,
        oldTargetRelease
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
          await proveTx(connect(token, minter).premintIncrease(user.address, premint.amount, premint.release));
        }
        await checkPremints(token, expectedPremints);
        await checkPremintReleaseResolving(token, originalReleaseTimestamps[0], originalReleaseTimestamps[0]);
        await checkPremintReleaseResolving(token, originalReleaseTimestamps[1], originalReleaseTimestamps[1]);
        await checkPremintOriginalReleaseCounter(token, targetReleaseTimestamp, 0);

        await reschedulePremintReleaseAndCheckEvents(token, originalReleaseTimestamps[0], targetReleaseTimestamp);
        expectedPremints[0].release = targetReleaseTimestamp;
        await checkPremints(token, expectedPremints);
        await checkPremintReleaseResolving(token, originalReleaseTimestamps[0], targetReleaseTimestamp);
        await checkPremintReleaseResolving(token, originalReleaseTimestamps[1], originalReleaseTimestamps[1]);
        await checkPremintOriginalReleaseCounter(token, targetReleaseTimestamp, 1);

        await reschedulePremintReleaseAndCheckEvents(token, originalReleaseTimestamps[1], targetReleaseTimestamp);
        expectedPremints[1].release = targetReleaseTimestamp;
        await checkPremints(token, expectedPremints);
        await checkPremintReleaseResolving(token, originalReleaseTimestamps[0], targetReleaseTimestamp);
        await checkPremintReleaseResolving(token, originalReleaseTimestamps[1], targetReleaseTimestamp);
        await checkPremintOriginalReleaseCounter(token, targetReleaseTimestamp, 2);

        const expectedPremintBalance = TOKEN_AMOUNT * expectedPremints.length;
        expect(await token.balanceOfPremint(user.address)).to.eq(expectedPremintBalance);
        const newPremint: Premint = ({ amount: TOKEN_AMOUNT, release: timestamp + 1000 });

        // Shift the block time to the first original release timestamp
        await increaseBlockTimestampTo(originalReleaseTimestamps[0]);

        // Check that the premints are still here after adding and removing a new one
        await proveTx(connect(token, minter).premintIncrease(user.address, newPremint.amount, newPremint.release));
        await proveTx(connect(token, minter).premintDecrease(user.address, newPremint.amount, newPremint.release));
        await checkPremints(token, expectedPremints);
        expect(await token.balanceOfPremint(user.address)).to.eq(expectedPremintBalance);

        // Shift the block time to the next original release timestamp
        await increaseBlockTimestampTo(originalReleaseTimestamps[1]);

        // Check that the premints are still here after adding and removing a new one
        await proveTx(connect(token, minter).premintIncrease(user.address, newPremint.amount, newPremint.release));
        await proveTx(connect(token, minter).premintDecrease(user.address, newPremint.amount, newPremint.release));
        await checkPremints(token, expectedPremints);
        expect(await token.balanceOfPremint(user.address)).to.eq(expectedPremintBalance);

        // Shift the block time to the target release timestamp
        await increaseBlockTimestampTo(targetReleaseTimestamp);

        // Check that the premints disappeared after adding a new one
        await proveTx(connect(token, minter).premintIncrease(user.address, newPremint.amount, newPremint.release));
        await checkPremints(token, [newPremint]);
        await proveTx(connect(token, minter).premintDecrease(user.address, newPremint.amount, newPremint.release));
        expect(await token.balanceOfPremint(user.address)).to.eq(0);
      });

      it("The configured target release timestamp is before the original timestamp", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const originalReleaseTimestamp = timestamp;
        const targetReleaseTimestamp = timestamp - 10;
        const expectedPremint: Premint = { amount: TOKEN_AMOUNT, release: timestamp };

        await proveTx(connect(token, minter).premintIncrease(
          user.address,
          expectedPremint.amount,
          expectedPremint.release
        ));
        await reschedulePremintReleaseAndCheckEvents(token, originalReleaseTimestamp, targetReleaseTimestamp);
        expectedPremint.release = targetReleaseTimestamp;
        await checkPremints(token, [expectedPremint]);
        await checkPremintReleaseResolving(token, originalReleaseTimestamp, targetReleaseTimestamp);
        await checkPremintOriginalReleaseCounter(token, targetReleaseTimestamp, 1);

        expect(await token.balanceOfPremint(user.address)).to.eq(TOKEN_AMOUNT);
        const newPremint: Premint = ({ amount: TOKEN_AMOUNT, release: timestamp + 1000 });

        // Shift the block time to the target release timestamp
        await increaseBlockTimestampTo(targetReleaseTimestamp);

        // Check that the premints disappeared after adding a new one
        await proveTx(connect(token, minter).premintIncrease(user.address, newPremint.amount, newPremint.release));
        await checkPremints(token, [newPremint]);
        await proveTx(connect(token, minter).premintDecrease(user.address, newPremint.amount, newPremint.release));
        expect(await token.balanceOfPremint(user.address)).to.eq(0);

        // Shift the block time to the original release timestamp
        await increaseBlockTimestampTo(originalReleaseTimestamp);
        expect(await token.balanceOfPremint(user.address)).to.eq(0);
      });

      it("The reschedulings are removed", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const originalReleaseTimestamps: number[] = [timestamp, timestamp + 10];
        const targetReleaseTimestamp = timestamp + 20;

        await reschedulePremintReleaseAndCheckEvents(token, originalReleaseTimestamps[0], targetReleaseTimestamp);
        await reschedulePremintReleaseAndCheckEvents(token, originalReleaseTimestamps[1], targetReleaseTimestamp);
        await checkPremintReleaseResolving(token, originalReleaseTimestamps[0], targetReleaseTimestamp);
        await checkPremintReleaseResolving(token, originalReleaseTimestamps[1], targetReleaseTimestamp);
        await checkPremintOriginalReleaseCounter(token, targetReleaseTimestamp, 2);
        await checkPremintOriginalReleaseCounter(token, originalReleaseTimestamps[0], 0);
        await checkPremintOriginalReleaseCounter(token, originalReleaseTimestamps[1], 0);

        await reschedulePremintReleaseAndCheckEvents(token, originalReleaseTimestamps[0], originalReleaseTimestamps[0]);
        await checkPremintReleaseResolving(token, originalReleaseTimestamps[0], originalReleaseTimestamps[0]);
        await checkPremintReleaseResolving(token, originalReleaseTimestamps[1], targetReleaseTimestamp);
        await checkPremintOriginalReleaseCounter(token, targetReleaseTimestamp, 1);

        await reschedulePremintReleaseAndCheckEvents(token, originalReleaseTimestamps[1], originalReleaseTimestamps[1]);
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
        await proveTx(connect(token, pauser).pause());
        await expect(
          connect(token, minter).reschedulePremintRelease(originalRelease, targetRelease)
        ).to.be.revertedWithCustomError(token, REVERT_ERROR_CONTRACT_IS_PAUSED);
      });

      it("The caller is not a minter", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const originalRelease = timestamp;
        const targetRelease = timestamp + 1;
        await expect(connect(token, user).reschedulePremintRelease(originalRelease, targetRelease))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_UNAUTHORIZED_MINTER)
          .withArgs(user.address);
      });

      it("The provided target release timestamp for the rescheduling is passed", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const originalRelease = timestamp;
        const targetRelease = await getLatestBlockTimestamp() - 1;
        await expect(
          connect(token, minter).reschedulePremintRelease(originalRelease, targetRelease)
        ).to.be.revertedWithCustomError(token, REVERT_ERROR_PREMINT_RESCHEDULING_TIME_PASSED);
      });

      it("The provided original release time has passed", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const originalRelease = await getLatestBlockTimestamp() - 1;
        const targetRelease = originalRelease + 1000;
        await expect(
          connect(token, minter).reschedulePremintRelease(originalRelease, targetRelease)
        ).to.be.revertedWithCustomError(token, REVERT_ERROR_PREMINT_RELEASE_TIME_PASSED);
      });

      it("The provided resolved original release time has passed", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const originalRelease = timestamp;
        const targetRelease1 = originalRelease + 1;
        const targetRelease2 = originalRelease + 1000;
        await proveTx(connect(token, minter).reschedulePremintRelease(originalRelease, targetRelease1));
        await increaseBlockTimestampTo(targetRelease1);
        await expect(
          connect(token, minter).reschedulePremintRelease(originalRelease, targetRelease2)
        ).to.be.revertedWithCustomError(token, REVERT_ERROR_PREMINT_RELEASE_TIME_PASSED);
      });

      it("The provided original release time equals the provided target release time", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        await expect(
          connect(token, minter).reschedulePremintRelease(timestamp, timestamp)
        ).to.be.revertedWithCustomError(token, REVERT_ERROR_PREMINT_RESCHEDULING_ALREADY_CONFIGURED);
      });

      it("The provided target release time is already configured", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const originalRelease = timestamp;
        const targetRelease = timestamp + 1;
        await proveTx(connect(token, minter).reschedulePremintRelease(originalRelease, targetRelease));
        await expect(
          connect(token, minter).reschedulePremintRelease(originalRelease, targetRelease)
        ).to.be.revertedWithCustomError(token, REVERT_ERROR_PREMINT_RESCHEDULING_ALREADY_CONFIGURED);
      });

      it("A rescheduling chain will be made in result", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const originalRelease = timestamp;
        const targetRelease1 = timestamp + 1;
        const targetRelease2 = timestamp + 2;
        await proveTx(connect(token, minter).reschedulePremintRelease(originalRelease, targetRelease1));
        await expect(
          connect(token, minter).reschedulePremintRelease(targetRelease1, targetRelease2)
        ).to.be.revertedWithCustomError(token, REVERT_ERROR_PREMINT_RESCHEDULING_CHAIN);
      });

      it("The provided original release time is greater than 64-bit unsigned integer", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const originalRelease = BigInt("18446744073709551616"); // uint64 max + 1
        const targetRelease = timestamp + 1;
        await expect(connect(token, minter).reschedulePremintRelease(originalRelease, targetRelease))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_INAPPROPRIATE_UINT64_VALUE)
          .withArgs(originalRelease);
      });

      it("The provided target release time is greater than 64-bit unsigned integer", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const originalRelease = timestamp;
        const targetRelease = BigInt("18446744073709551616"); // uint64 max + 1
        await expect(connect(token, minter).reschedulePremintRelease(originalRelease, targetRelease))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_INAPPROPRIATE_UINT64_VALUE)
          .withArgs(targetRelease);
      });
    });
  });

  describe("Function 'configureMaxPendingPremintsCount()'", async () => {
    it("Executes as expected and emits the correct event", async () => {
      const { token } = await setUpFixture(deployToken);
      expect(await token.maxPendingPremintsCount()).to.eq(0);
      expect(await token.configureMaxPendingPremintsCount(MAX_PENDING_PREMINTS_COUNT))
        .to.emit(token, EVENT_NAME_MAX_PENDING_PREMINTS_COUNT_CONFIGURED)
        .withArgs(MAX_PENDING_PREMINTS_COUNT);
      expect(await token.maxPendingPremintsCount()).to.eq(MAX_PENDING_PREMINTS_COUNT);
    });

    it("Is reverted if the limit is already configured with the same number", async () => {
      const { token } = await setUpFixture(deployToken);
      await proveTx(token.configureMaxPendingPremintsCount(MAX_PENDING_PREMINTS_COUNT));
      await expect(token.configureMaxPendingPremintsCount(MAX_PENDING_PREMINTS_COUNT))
        .to.be.revertedWithCustomError(token, REVERT_ERROR_MAX_PENDING_PREMINTS_COUNT_ALREADY_CONFIGURED);
    });

    it("Is reverted if the caller does not have the owner role", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await expect(connect(token, user).configureMaxPendingPremintsCount(0))
        .to.be.revertedWithCustomError(token, REVERT_ERROR_UNAUTHORIZED_ACCOUNT)
        .withArgs(user.address, OWNER_ROLE);
    });
  });

  describe("Function 'balanceOfPremint()'", async () => {
    it("Returns the correct balance of premint", async () => {
      const timestamp = (await getLatestBlockTimestamp()) + 100;
      const { token } = await setUpFixture(deployAndConfigureToken);

      await proveTx(connect(token, minter).premintIncrease(user.address, TOKEN_AMOUNT, timestamp));
      await proveTx(connect(token, minter).premintIncrease(user.address, TOKEN_AMOUNT + 1, timestamp + 50));
      expect(await token.balanceOfPremint(user.address)).to.eq(TOKEN_AMOUNT * 2 + 1);

      await increaseBlockTimestampTo(timestamp);
      expect(await token.balanceOfPremint(user.address)).to.eq(TOKEN_AMOUNT + 1);

      await increaseBlockTimestampTo(timestamp + 50);
      expect(await token.balanceOfPremint(user.address)).to.eq(0);
    });
  });

  describe("Function 'transfer()'", async () => {
    it("Executes as expected even for preminted tokens that has not been released yet", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      const timestamp = (await getLatestBlockTimestamp()) + 100;
      await proveTx(connect(token, minter).premintIncrease(user.address, TOKEN_AMOUNT, timestamp));
      const tx = connect(token, user).transfer(recipient.address, TOKEN_AMOUNT);
      await expect(tx).to.changeTokenBalances(
        token,
        [user, recipient],
        [-TOKEN_AMOUNT, TOKEN_AMOUNT]
      );
      await expect(tx)
        .to.emit(token, EVENT_NAME_TRANSFER)
        .withArgs(user.address, recipient.address, TOKEN_AMOUNT);
    });
  });
});
