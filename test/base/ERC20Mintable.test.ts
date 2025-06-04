import { ethers, upgrades } from "hardhat";
import { expect } from "chai";
import { Contract, ContractFactory, TransactionResponse } from "ethers";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { connect, getLatestBlockTimestamp, increaseBlockTimestampTo, proveTx } from "../../test-utils/eth";
import { maxUintForBits, setUpFixture } from "../../test-utils/common";

describe("Contract 'ERC20Mintable'", async () => {
  const TOKEN_NAME = "BRL Coin";
  const TOKEN_SYMBOL = "BRLC";

  const TOKEN_AMOUNT = 100;
  const MAX_PENDING_PREMINTS_COUNT = 5;

  const EVENT_NAME_BURN = "Burn";
  const EVENT_NAME_BURN_TO_RESERVE = "BurnToReserve";
  const EVENT_NAME_MAX_PENDING_PREMINTS_COUNT_CONFIGURED = "MaxPendingPremintsCountConfigured";
  const EVENT_NAME_MINT = "Mint";
  const EVENT_NAME_MINT_FROM_RESERVE = "MintFromReserve";
  const EVENT_NAME_PREMINT = "Premint";
  const EVENT_NAME_PREMINT_RELEASE_RESCHEDULED = "PremintReleaseRescheduled";
  const EVENT_NAME_TRANSFER = "Transfer";

  // Error messages of the lib contracts
  const ERROR_MESSAGE_ERC20_BURN_AMOUNT_EXCEEDS_BALANCE = "ERC20: burn amount exceeds balance";
  const ERROR_MESSAGE_ERC20_MINT_TO_THE_ZERO_ACCOUNT = "ERC20: mint to the zero address";

  // Errors of the lib contracts
  const ERROR_NAME_CONTRACT_INITIALIZATION_IS_INVALID = "InvalidInitialization";
  const ERROR_NAME_CONTRACT_IS_NOT_INITIALIZING = "NotInitializing";
  const ERROR_NAME_CONTRACT_IS_PAUSED = "EnforcedPause";
  const ERROR_NAME_UNAUTHORIZED_ACCOUNT = "AccessControlUnauthorizedAccount";

  // Errors of the contracts under test
  const ERROR_NAME_INAPPROPRIATE_UINT64_VALUE = "InappropriateUint64Value";
  const ERROR_NAME_INSUFFICIENT_RESERVE_SUPPLY = "InsufficientReserveSupply";
  const ERROR_NAME_PREMINT_INSUFFICIENT_AMOUNT = "PremintInsufficientAmount";
  const ERROR_NAME_PREMINT_NON_EXISTENT = "PremintNonExistent";
  const ERROR_NAME_PREMINT_RELEASE_TIME_PASSED = "PremintReleaseTimePassed";
  const ERROR_NAME_PREMINT_RESCHEDULING_ALREADY_CONFIGURED = "PremintReschedulingAlreadyConfigured";
  const ERROR_NAME_PREMINT_RESCHEDULING_CHAIN = "PremintReschedulingChain";
  const ERROR_NAME_PREMINT_RESCHEDULING_TIME_PASSED = "PremintReschedulingTimePassed";
  const ERROR_NAME_PREMINT_UNCHANGED = "PremintUnchanged";
  const ERROR_NAME_MAX_PENDING_PREMINTS_COUNT_ALREADY_CONFIGURED = "MaxPendingPremintsCountAlreadyConfigured";
  const ERROR_NAME_MAX_PENDING_PREMINTS_LIMIT_REACHED = "MaxPendingPremintsLimitReached";
  const ERROR_NAME_ZERO_BURN_AMOUNT = "ZeroBurnAmount";
  const ERROR_NAME_ZERO_MINT_AMOUNT = "ZeroMintAmount";
  const ERROR_NAME_ZERO_PREMINT_AMOUNT = "ZeroPremintAmount";

  const OWNER_ROLE: string = ethers.id("OWNER_ROLE");
  const GRANTOR_ROLE: string = ethers.id("GRANTOR_ROLE");
  const PAUSER_ROLE: string = ethers.id("PAUSER_ROLE");
  const RESCUER_ROLE: string = ethers.id("RESCUER_ROLE");
  const MINTER_ROLE: string = ethers.id("MINTER_ROLE");
  const BURNER_ROLE: string = ethers.id("BURNER_ROLE");
  const RESERVE_MINTER_ROLE: string = ethers.id("RESERVE_MINTER_ROLE");
  const RESERVE_BURNER_ROLE: string = ethers.id("RESERVE_BURNER_ROLE");
  const PREMINT_MANAGER_ROLE: string = ethers.id("PREMINT_MANAGER_ROLE");
  const PREMINT_SCHEDULER_ROLE: string = ethers.id("PREMINT_SCHEDULER_ROLE");

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
  let minterOrdinary: HardhatEthersSigner;
  let burnerOrdinary: HardhatEthersSigner;
  let minterReserve: HardhatEthersSigner;
  let burnerReserve: HardhatEthersSigner;
  let preminterAgent: HardhatEthersSigner;
  let preminterRescheduler: HardhatEthersSigner;
  let user: HardhatEthersSigner;
  let recipient: HardhatEthersSigner;

  before(async () => {
    [
      deployer,
      pauser,
      minterOrdinary,
      burnerOrdinary,
      minterReserve,
      burnerReserve,
      preminterAgent,
      preminterRescheduler,
      user,
      recipient
    ] = await ethers.getSigners();
    tokenFactory = await ethers.getContractFactory("ERC20MintableMock");
    tokenFactory = tokenFactory.connect(deployer); // Explicitly specifying the deployer account
  });

  async function deployToken(): Promise<{ token: Contract }> {
    let token = await upgrades.deployProxy(
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
    await proveTx(token.grantRole(GRANTOR_ROLE, deployer.address));
    await proveTx(token.grantRole(PAUSER_ROLE, pauser.address));
    await proveTx(token.grantRole(MINTER_ROLE, minterOrdinary.address));
    await proveTx(token.grantRole(BURNER_ROLE, burnerOrdinary.address));
    await proveTx(token.grantRole(RESERVE_MINTER_ROLE, minterReserve.address));
    await proveTx(token.grantRole(RESERVE_BURNER_ROLE, burnerReserve.address));
    await proveTx(token.grantRole(PREMINT_MANAGER_ROLE, preminterAgent.address));
    await proveTx(token.grantRole(PREMINT_SCHEDULER_ROLE, preminterRescheduler.address));
    await proveTx(token.configureMaxPendingPremintsCount(MAX_PENDING_PREMINTS_COUNT));
    return { token };
  }

  describe("Function 'initialize()'", async () => {
    it("Configures the contract as expected", async () => {
      const { token } = await setUpFixture(deployToken);

      // The role hashes
      expect(await token.OWNER_ROLE()).to.equal(OWNER_ROLE);
      expect(await token.GRANTOR_ROLE()).to.equal(GRANTOR_ROLE);
      expect(await token.PAUSER_ROLE()).to.equal(PAUSER_ROLE);
      expect(await token.RESCUER_ROLE()).to.equal(RESCUER_ROLE);
      expect(await token.MINTER_ROLE()).to.equal(MINTER_ROLE);
      expect(await token.BURNER_ROLE()).to.equal(BURNER_ROLE);
      expect(await token.RESERVE_MINTER_ROLE()).to.equal(RESERVE_MINTER_ROLE);
      expect(await token.RESERVE_BURNER_ROLE()).to.equal(RESERVE_BURNER_ROLE);
      expect(await token.PREMINT_MANAGER_ROLE()).to.equal(PREMINT_MANAGER_ROLE);
      expect(await token.PREMINT_SCHEDULER_ROLE()).to.equal(PREMINT_SCHEDULER_ROLE);

      // The role admins
      expect(await token.getRoleAdmin(OWNER_ROLE)).to.equal(OWNER_ROLE);
      expect(await token.getRoleAdmin(GRANTOR_ROLE)).to.equal(OWNER_ROLE);
      expect(await token.getRoleAdmin(PAUSER_ROLE)).to.equal(GRANTOR_ROLE);
      expect(await token.getRoleAdmin(RESCUER_ROLE)).to.equal(GRANTOR_ROLE);
      expect(await token.getRoleAdmin(MINTER_ROLE)).to.equal(GRANTOR_ROLE);
      expect(await token.getRoleAdmin(BURNER_ROLE)).to.equal(GRANTOR_ROLE);
      expect(await token.getRoleAdmin(RESERVE_MINTER_ROLE)).to.equal(GRANTOR_ROLE);
      expect(await token.getRoleAdmin(RESERVE_BURNER_ROLE)).to.equal(GRANTOR_ROLE);
      expect(await token.getRoleAdmin(PREMINT_MANAGER_ROLE)).to.equal(GRANTOR_ROLE);
      expect(await token.getRoleAdmin(PREMINT_SCHEDULER_ROLE)).to.equal(GRANTOR_ROLE);

      // The deployer should have the owner role, but not the other roles
      expect(await token.hasRole(OWNER_ROLE, deployer.address)).to.equal(true);
      expect(await token.hasRole(GRANTOR_ROLE, deployer.address)).to.equal(false);
      expect(await token.hasRole(PAUSER_ROLE, deployer.address)).to.equal(false);
      expect(await token.hasRole(RESCUER_ROLE, deployer.address)).to.equal(false);
      expect(await token.hasRole(MINTER_ROLE, deployer.address)).to.equal(false);
      expect(await token.hasRole(BURNER_ROLE, deployer.address)).to.equal(false);
      expect(await token.hasRole(RESERVE_MINTER_ROLE, deployer.address)).to.equal(false);
      expect(await token.hasRole(RESERVE_BURNER_ROLE, deployer.address)).to.equal(false);
      expect(await token.hasRole(PREMINT_MANAGER_ROLE, deployer.address)).to.equal(false);
      expect(await token.hasRole(PREMINT_SCHEDULER_ROLE, deployer.address)).to.equal(false);

      expect(await token.maxPendingPremintsCount()).to.eq(0);
    });

    it("Is reverted if called for the second time", async () => {
      const { token } = await setUpFixture(deployToken);
      await expect(token.initialize(TOKEN_NAME, TOKEN_SYMBOL))
        .to.be.revertedWithCustomError(token, ERROR_NAME_CONTRACT_INITIALIZATION_IS_INVALID);
    });

    it("Is reverted if the internal unchained initializer is called outside of the init process", async () => {
      const { token } = await setUpFixture(deployToken);
      await expect(token.callParentInitializerUnchained())
        .to.be.revertedWithCustomError(token, ERROR_NAME_CONTRACT_IS_NOT_INITIALIZING);
    });
  });

  describe("Function 'mint()'", async () => {
    describe("Executes as expected and emits the correct events if", async () => {
      it("All needed conditions are met", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const tx: TransactionResponse = await connect(token, minterOrdinary).mint(user.address, TOKEN_AMOUNT);
        await expect(tx).to.emit(token, EVENT_NAME_MINT).withArgs(minterOrdinary.address, user.address, TOKEN_AMOUNT);
        await expect(tx)
          .to.emit(token, EVENT_NAME_TRANSFER)
          .withArgs(ethers.ZeroAddress, user.address, TOKEN_AMOUNT);
        await expect(tx).to.changeTokenBalances(token, [user], [TOKEN_AMOUNT]);
      });
    });

    describe("Is reverted if", async () => {
      it("The contract is paused", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        await proveTx(connect(token, pauser).pause());
        await expect(connect(token, minterOrdinary).mint(user.address, TOKEN_AMOUNT))
          .to.be.revertedWithCustomError(token, ERROR_NAME_CONTRACT_IS_PAUSED);
      });

      it("The caller does not have the ordinary minter role", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        await expect(connect(token, user).mint(user.address, TOKEN_AMOUNT))
          .to.be.revertedWithCustomError(token, ERROR_NAME_UNAUTHORIZED_ACCOUNT)
          .withArgs(user.address, MINTER_ROLE);
        await expect(connect(token, deployer).mint(user.address, TOKEN_AMOUNT))
          .to.be.revertedWithCustomError(token, ERROR_NAME_UNAUTHORIZED_ACCOUNT)
          .withArgs(deployer.address, MINTER_ROLE);
      });

      it("The destination address is zero", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        await expect(connect(token, minterOrdinary).mint(ethers.ZeroAddress, TOKEN_AMOUNT))
          .to.be.revertedWith(ERROR_MESSAGE_ERC20_MINT_TO_THE_ZERO_ACCOUNT);
      });

      it("The mint amount is zero", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        await expect(connect(token, minterOrdinary).mint(user.address, 0))
          .to.be.revertedWithCustomError(token, ERROR_NAME_ZERO_MINT_AMOUNT);
      });
    });
  });

  describe("Function 'burn()'", async () => {
    it("Executes as expected and emits the correct events", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(connect(token, minterOrdinary).mint(burnerOrdinary.address, TOKEN_AMOUNT));
      const tx: TransactionResponse = await connect(token, burnerOrdinary).burn(TOKEN_AMOUNT);
      await expect(tx).to.emit(token, EVENT_NAME_BURN).withArgs(burnerOrdinary.address, TOKEN_AMOUNT);
      await expect(tx)
        .to.emit(token, EVENT_NAME_TRANSFER)
        .withArgs(burnerOrdinary.address, ethers.ZeroAddress, TOKEN_AMOUNT);
      await expect(tx).to.changeTokenBalances(
        token,
        [burnerOrdinary, deployer, token],
        [-TOKEN_AMOUNT, 0, 0]
      );
    });

    it("Is reverted if the contract is paused", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(connect(token, minterOrdinary).mint(burnerOrdinary.address, TOKEN_AMOUNT));
      await proveTx(connect(token, pauser).pause());
      await expect(connect(token, burnerOrdinary).burn(TOKEN_AMOUNT))
        .to.be.revertedWithCustomError(token, ERROR_NAME_CONTRACT_IS_PAUSED);
    });

    it("Is reverted if the caller does not have the ordinary burner role", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(connect(token, minterOrdinary).mint(user.address, TOKEN_AMOUNT));
      await expect(connect(token, user).burn(TOKEN_AMOUNT))
        .to.be.revertedWithCustomError(token, ERROR_NAME_UNAUTHORIZED_ACCOUNT)
        .withArgs(user.address, BURNER_ROLE);

      await proveTx(connect(token, minterOrdinary).mint(deployer.address, TOKEN_AMOUNT));
      await expect(connect(token, deployer).burn(TOKEN_AMOUNT))
        .to.be.revertedWithCustomError(token, ERROR_NAME_UNAUTHORIZED_ACCOUNT)
        .withArgs(deployer.address, BURNER_ROLE);
    });

    it("Is reverted if the burn amount is zero", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await expect(connect(token, burnerOrdinary).burn(0))
        .to.be.revertedWithCustomError(token, ERROR_NAME_ZERO_BURN_AMOUNT);
    });

    it("Is reverted if the burn amount exceeds the caller token balance", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(connect(token, minterOrdinary).mint(burnerOrdinary.address, TOKEN_AMOUNT));
      await expect(connect(token, burnerOrdinary).burn(TOKEN_AMOUNT + 1))
        .to.be.revertedWith(ERROR_MESSAGE_ERC20_BURN_AMOUNT_EXCEEDS_BALANCE);
    });
  });

  describe("Function 'mintFromReserve()'", async () => {
    it("Executes as expected and emits the correct events", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);

      const tx: TransactionResponse = await connect(token, minterReserve).mintFromReserve(user.address, TOKEN_AMOUNT);

      await expect(tx)
        .to.emit(token, EVENT_NAME_MINT)
        .withArgs(minterReserve.address, user.address, TOKEN_AMOUNT);

      await expect(tx)
        .to.emit(token, EVENT_NAME_MINT_FROM_RESERVE)
        .withArgs(minterReserve.address, user.address, TOKEN_AMOUNT, TOKEN_AMOUNT);

      await expect(tx)
        .to.emit(token, EVENT_NAME_TRANSFER)
        .withArgs(ethers.ZeroAddress, user.address, TOKEN_AMOUNT);

      await expect(tx).to.changeTokenBalances(token, [user], [TOKEN_AMOUNT]);

      expect(await token.totalReserveSupply()).to.eq(TOKEN_AMOUNT);

      // mint another amount to verify reserve accumulates correctly
      const tx2: TransactionResponse =
        await connect(token, minterReserve).mintFromReserve(recipient.address, TOKEN_AMOUNT);
      await expect(tx2)
        .to.emit(token, EVENT_NAME_MINT_FROM_RESERVE)
        .withArgs(minterReserve.address, recipient.address, TOKEN_AMOUNT, TOKEN_AMOUNT * 2);

      expect(await token.totalReserveSupply()).to.eq(TOKEN_AMOUNT * 2);
    });

    it("Is reverted if the contract is paused", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(connect(token, pauser).pause());
      await expect(connect(token, minterOrdinary).mintFromReserve(user.address, TOKEN_AMOUNT))
        .to.be.revertedWithCustomError(token, ERROR_NAME_CONTRACT_IS_PAUSED);
    });

    it("Is reverted if the caller does not have the reserve minter role", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await expect(connect(token, user).mintFromReserve(user.address, TOKEN_AMOUNT))
        .to.be.revertedWithCustomError(token, ERROR_NAME_UNAUTHORIZED_ACCOUNT)
        .withArgs(user.address, RESERVE_MINTER_ROLE);
      await expect(connect(token, deployer).mintFromReserve(user.address, TOKEN_AMOUNT))
        .to.be.revertedWithCustomError(token, ERROR_NAME_UNAUTHORIZED_ACCOUNT)
        .withArgs(deployer.address, RESERVE_MINTER_ROLE);
    });

    it("Is reverted if the mint amount is zero", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await expect(connect(token, minterReserve).mintFromReserve(user.address, 0))
        .to.be.revertedWithCustomError(token, ERROR_NAME_ZERO_MINT_AMOUNT);
    });
  });

  describe("Function 'burnToReserve()'", async () => {
    it("Executes as expected and emits the correct events", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);

      // first mint to reserve to create reserve supply
      await proveTx(connect(token, minterReserve).mintFromReserve(burnerReserve.address, TOKEN_AMOUNT));
      expect(await token.totalReserveSupply()).to.eq(TOKEN_AMOUNT);

      const tx: TransactionResponse = await connect(token, burnerReserve).burnToReserve(TOKEN_AMOUNT / 2);

      await expect(tx)
        .to.emit(token, EVENT_NAME_BURN)
        .withArgs(burnerReserve.address, TOKEN_AMOUNT / 2);

      await expect(tx)
        .to.emit(token, EVENT_NAME_BURN_TO_RESERVE)
        .withArgs(burnerReserve.address, TOKEN_AMOUNT / 2, TOKEN_AMOUNT / 2);

      await expect(tx)
        .to.emit(token, EVENT_NAME_TRANSFER)
        .withArgs(burnerReserve.address, ethers.ZeroAddress, TOKEN_AMOUNT / 2);

      await expect(tx).to.changeTokenBalances(
        token,
        [burnerReserve, deployer, token],
        [-TOKEN_AMOUNT / 2, 0, 0]
      );

      expect(await token.totalReserveSupply()).to.eq(TOKEN_AMOUNT / 2);

      // burn remaining tokens to verify event with zero reserve supply
      const tx2: TransactionResponse = await connect(token, burnerReserve).burnToReserve(TOKEN_AMOUNT / 2);
      await expect(tx2)
        .to.emit(token, EVENT_NAME_BURN_TO_RESERVE)
        .withArgs(burnerReserve.address, TOKEN_AMOUNT / 2, 0);

      expect(await token.totalReserveSupply()).to.eq(0);
    });

    it("Is reverted if the contract is paused", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(connect(token, minterReserve).mintFromReserve(burnerReserve.address, TOKEN_AMOUNT));
      await proveTx(connect(token, pauser).pause());
      await expect(connect(token, burnerReserve).burnToReserve(TOKEN_AMOUNT))
        .to.be.revertedWithCustomError(token, ERROR_NAME_CONTRACT_IS_PAUSED);
    });

    it("Is reverted if the caller does not have the reserve burner role", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(connect(token, minterReserve).mintFromReserve(user.address, TOKEN_AMOUNT));
      await expect(connect(token, user).burnToReserve(TOKEN_AMOUNT))
        .to.be.revertedWithCustomError(token, ERROR_NAME_UNAUTHORIZED_ACCOUNT)
        .withArgs(user.address, RESERVE_BURNER_ROLE);

      await proveTx(connect(token, minterReserve).mintFromReserve(deployer.address, TOKEN_AMOUNT));
      await expect(connect(token, deployer).burnToReserve(TOKEN_AMOUNT))
        .to.be.revertedWithCustomError(token, ERROR_NAME_UNAUTHORIZED_ACCOUNT)
        .withArgs(deployer.address, RESERVE_BURNER_ROLE);
    });

    it("Is reverted if the burn amount is zero", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await expect(connect(token, burnerReserve).burnToReserve(0))
        .to.be.revertedWithCustomError(token, ERROR_NAME_ZERO_BURN_AMOUNT);
    });

    it("Is reverted if the burn amount exceeds the caller token balance", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await proveTx(connect(token, minterReserve).mintFromReserve(burnerReserve.address, TOKEN_AMOUNT));
      await expect(connect(token, burnerReserve).burnToReserve(TOKEN_AMOUNT + 1))
        .to.be.revertedWith(ERROR_MESSAGE_ERC20_BURN_AMOUNT_EXCEEDS_BALANCE);
    });

    it("Is reverted if the burn amount exceeds the total reserve supply", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);

      // mint non-reserve tokens to the minter
      await proveTx(connect(token, minterOrdinary).mint(burnerReserve.address, TOKEN_AMOUNT));

      // mint a small amount to reserve
      await proveTx(connect(token, minterReserve).mintFromReserve(burnerReserve.address, 1));

      // try to burn more than the reserve supply
      await expect(connect(token, burnerReserve).burnToReserve(2))
        .to.be.revertedWithCustomError(token, ERROR_NAME_INSUFFICIENT_RESERVE_SUPPLY);
    });
  });

  describe("Function 'totalReserveSupply()'", async () => {
    it("Returns the correct total reserve supply", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);

      // initial reserve supply should be 0
      expect(await token.totalReserveSupply()).to.eq(0);

      // mint to reserve should increase the reserve supply
      await proveTx(connect(token, minterReserve).mintFromReserve(user.address, TOKEN_AMOUNT));
      expect(await token.totalReserveSupply()).to.eq(TOKEN_AMOUNT);

      // regular mint should not affect the reserve supply
      await proveTx(connect(token, minterOrdinary).mint(user.address, TOKEN_AMOUNT));
      expect(await token.totalReserveSupply()).to.eq(TOKEN_AMOUNT);

      // regular burn should not affect the reserve supply
      await proveTx(connect(token, user).transfer(burnerOrdinary.address, TOKEN_AMOUNT / 2));
      await proveTx(connect(token, burnerOrdinary).burn(TOKEN_AMOUNT / 2));
      expect(await token.totalReserveSupply()).to.eq(TOKEN_AMOUNT);

      // burn to reserve should decrease the reserve supply
      await proveTx(connect(token, user).transfer(burnerReserve.address, TOKEN_AMOUNT / 2));
      await proveTx(connect(token, burnerReserve).burnToReserve(TOKEN_AMOUNT / 2));
      expect(await token.totalReserveSupply()).to.eq(TOKEN_AMOUNT / 2);
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

        let tx: TransactionResponse;
        if (premintFunction === PremintFunction.Decrease) {
          tx = await connect(token, preminterAgent).premintDecrease(
            user.address,
            amount,
            release
          );
        } else {
          tx = await connect(token, preminterAgent).premintIncrease(
            user.address,
            amount,
            release
          );
        }

        if (newAmount > oldAmount) {
          const expectedAmount = newAmount - oldAmount;
          await expect(tx)
            .to.emit(token, EVENT_NAME_MINT)
            .withArgs(preminterAgent.address, user.address, expectedAmount);
          await expect(tx)
            .to.emit(token, EVENT_NAME_TRANSFER)
            .withArgs(ethers.ZeroAddress, user.address, expectedAmount);
        }
        if (newAmount < oldAmount) {
          const expectedAmount = oldAmount - newAmount;
          await expect(tx)
            .to.emit(token, EVENT_NAME_BURN)
            .withArgs(preminterAgent.address, expectedAmount);
          await expect(tx)
            .to.emit(token, EVENT_NAME_TRANSFER)
            .withArgs(user.address, ethers.ZeroAddress, expectedAmount);
        }

        await expect(tx)
          .to.emit(token, EVENT_NAME_PREMINT)
          .withArgs(preminterAgent.address, user.address, newAmount, oldAmount, release);

        await expect(tx).to.changeTokenBalances(token, [user, preminterAgent], [newAmount - oldAmount, 0]);
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
        await proveTx(connect(token, preminterAgent).premintIncrease(user.address, TOKEN_AMOUNT, timestamp));
        await executeAndCheckPremint(token, {
          amount: 1,
          oldAmount: TOKEN_AMOUNT
        });
      });

      it("The caller decreases the amount of an existing premint", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        await proveTx(connect(token, preminterAgent).premintIncrease(user.address, TOKEN_AMOUNT, timestamp));
        await executeAndCheckPremint(token, {
          amount: 1,
          oldAmount: TOKEN_AMOUNT,
          premintFunction: PremintFunction.Decrease
        });
      });

      it("The caller removes an existing premint using the decreasing function", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        await proveTx(connect(token, preminterAgent).premintIncrease(user.address, TOKEN_AMOUNT, timestamp));
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
          await proveTx(connect(token, preminterAgent).premintIncrease(user.address, TOKEN_AMOUNT, timestamp + i * 10));
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
          await proveTx(connect(token, preminterAgent).premintIncrease(user.address, TOKEN_AMOUNT, timestamp + i * 10));
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
          await proveTx(connect(token, preminterAgent).premintIncrease(user.address, TOKEN_AMOUNT, timestamps[i]));
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
          await proveTx(connect(token, preminterAgent).premintIncrease(user.address, TOKEN_AMOUNT, timestamps[i]));
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
          await proveTx(connect(token, preminterAgent).premintIncrease(user.address, TOKEN_AMOUNT, timestamps[i]));
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
        await proveTx(connect(token, preminterAgent).premintIncrease(user.address, TOKEN_AMOUNT, timestamp));
        await proveTx(connect(token, pauser).pause());
        await expect(connect(token, preminterAgent).premintIncrease(user.address, 1, timestamp))
          .to.be.revertedWithCustomError(token, ERROR_NAME_CONTRACT_IS_PAUSED);
        await expect(connect(token, preminterAgent).premintDecrease(user.address, 1, timestamp))
          .to.be.revertedWithCustomError(token, ERROR_NAME_CONTRACT_IS_PAUSED);
      });

      it("The provided release time has passed", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const timestamp = (await getLatestBlockTimestamp()) - 1;
        await expect(connect(token, preminterAgent).premintIncrease(user.address, TOKEN_AMOUNT, timestamp))
          .to.be.revertedWithCustomError(token, ERROR_NAME_PREMINT_RELEASE_TIME_PASSED);
        await expect(connect(token, preminterAgent).premintDecrease(user.address, TOKEN_AMOUNT, timestamp))
          .to.be.revertedWithCustomError(token, ERROR_NAME_PREMINT_RELEASE_TIME_PASSED);
      });

      it("The amount of premint is greater than 64-bit unsigned integer", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const overflowAmount = maxUintForBits(64) + 1n;
        await expect(connect(token, preminterAgent).premintIncrease(user.address, overflowAmount, timestamp))
          .to.be.revertedWithCustomError(token, ERROR_NAME_INAPPROPRIATE_UINT64_VALUE)
          .withArgs(overflowAmount);
      });

      it("The caller does not have the preminter-agent role", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        await expect(connect(token, user).premintIncrease(user.address, TOKEN_AMOUNT, timestamp))
          .to.be.revertedWithCustomError(token, ERROR_NAME_UNAUTHORIZED_ACCOUNT)
          .withArgs(user.address, PREMINT_MANAGER_ROLE);
        await expect(connect(token, user).premintDecrease(user.address, TOKEN_AMOUNT, timestamp))
          .to.be.revertedWithCustomError(token, ERROR_NAME_UNAUTHORIZED_ACCOUNT)
          .withArgs(user.address, PREMINT_MANAGER_ROLE);

        await expect(connect(token, deployer).premintIncrease(deployer.address, TOKEN_AMOUNT, timestamp))
          .to.be.revertedWithCustomError(token, ERROR_NAME_UNAUTHORIZED_ACCOUNT)
          .withArgs(deployer.address, PREMINT_MANAGER_ROLE);
        await expect(connect(token, deployer).premintIncrease(deployer.address, TOKEN_AMOUNT, timestamp))
          .to.be.revertedWithCustomError(token, ERROR_NAME_UNAUTHORIZED_ACCOUNT)
          .withArgs(deployer.address, PREMINT_MANAGER_ROLE);
      });

      it("The recipient address is zero", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        await expect(connect(token, preminterAgent).premintIncrease(ethers.ZeroAddress, TOKEN_AMOUNT, timestamp))
          .to.be.revertedWith(ERROR_MESSAGE_ERC20_MINT_TO_THE_ZERO_ACCOUNT);
      });

      it("The amount of a new premint is zero", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        await expect(connect(token, preminterAgent).premintIncrease(user.address, 0, timestamp))
          .to.be.revertedWithCustomError(token, ERROR_NAME_ZERO_PREMINT_AMOUNT);
      });

      it("The max pending premints limit is reached during creation a new premint", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        let i = 0;
        for (; i < MAX_PENDING_PREMINTS_COUNT; i++) {
          await proveTx(connect(token, preminterAgent).premintIncrease(user.address, TOKEN_AMOUNT, timestamp + i * 10));
        }
        await expect(connect(token, preminterAgent).premintIncrease(user.address, TOKEN_AMOUNT, timestamp + i * 10))
          .to.be.revertedWithCustomError(token, ERROR_NAME_MAX_PENDING_PREMINTS_LIMIT_REACHED);
      });

      it("The caller changes an existing premint with the same amount", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        await proveTx(connect(token, preminterAgent).premintIncrease(user.address, TOKEN_AMOUNT, timestamp));
        await expect(connect(token, preminterAgent).premintIncrease(user.address, 0, timestamp))
          .to.be.revertedWithCustomError(token, ERROR_NAME_PREMINT_UNCHANGED);
        await expect(connect(token, preminterAgent).premintDecrease(user.address, 0, timestamp))
          .to.be.revertedWithCustomError(token, ERROR_NAME_PREMINT_UNCHANGED);
      });

      it("The caller tries to change a non-existing premint", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        await expect(connect(token, preminterAgent).premintDecrease(user.address, TOKEN_AMOUNT, timestamp))
          .to.be.revertedWithCustomError(token, ERROR_NAME_PREMINT_NON_EXISTENT);
      });

      it("The caller tries to decrease the amount of a premint below the existing amount", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        await proveTx(connect(token, preminterAgent).premintIncrease(user.address, TOKEN_AMOUNT, timestamp));
        await expect(connect(token, preminterAgent).premintDecrease(user.address, TOKEN_AMOUNT + 1, timestamp))
          .to.be.revertedWithCustomError(token, ERROR_NAME_PREMINT_INSUFFICIENT_AMOUNT);
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
      await expect(connect(token, preminterRescheduler).reschedulePremintRelease(
        originalRelease,
        targetRelease
      )).to.emit(
        token,
        EVENT_NAME_PREMINT_RELEASE_RESCHEDULED
      ).withArgs(
        preminterRescheduler.address,
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
          await proveTx(connect(token, preminterAgent).premintIncrease(user.address, premint.amount, premint.release));
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
        await proveTx(
          connect(token, preminterAgent).premintIncrease(user.address, newPremint.amount, newPremint.release)
        );
        await proveTx(
          connect(token, preminterAgent).premintDecrease(user.address, newPremint.amount, newPremint.release)
        );
        await checkPremints(token, expectedPremints);
        expect(await token.balanceOfPremint(user.address)).to.eq(expectedPremintBalance);

        // Shift the block time to the next original release timestamp
        await increaseBlockTimestampTo(originalReleaseTimestamps[1]);

        // Check that the premints are still here after adding and removing a new one
        await proveTx(
          connect(token, preminterAgent).premintIncrease(user.address, newPremint.amount, newPremint.release)
        );
        await proveTx(
          connect(token, preminterAgent).premintDecrease(user.address, newPremint.amount, newPremint.release)
        );
        await checkPremints(token, expectedPremints);
        expect(await token.balanceOfPremint(user.address)).to.eq(expectedPremintBalance);

        // Shift the block time to the target release timestamp
        await increaseBlockTimestampTo(targetReleaseTimestamp);

        // Check that the premints disappeared after adding a new one
        await proveTx(
          connect(token, preminterAgent).premintIncrease(user.address, newPremint.amount, newPremint.release)
        );
        await checkPremints(token, [newPremint]);
        await proveTx(
          connect(token, preminterAgent).premintDecrease(user.address, newPremint.amount, newPremint.release)
        );
        expect(await token.balanceOfPremint(user.address)).to.eq(0);
      });

      it("The configured target release timestamp is before the original timestamp", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const originalReleaseTimestamp = timestamp;
        const targetReleaseTimestamp = timestamp - 10;
        const expectedPremint: Premint = { amount: TOKEN_AMOUNT, release: timestamp };

        await proveTx(connect(token, preminterAgent).premintIncrease(
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
        await proveTx(
          connect(token, preminterAgent).premintIncrease(user.address, newPremint.amount, newPremint.release)
        );
        await checkPremints(token, [newPremint]);
        await proveTx(
          connect(token, preminterAgent).premintDecrease(user.address, newPremint.amount, newPremint.release)
        );
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
        await expect(connect(token, preminterRescheduler).reschedulePremintRelease(originalRelease, targetRelease))
          .to.be.revertedWithCustomError(token, ERROR_NAME_CONTRACT_IS_PAUSED);
      });

      it("The caller does not have the preminter-rescheduler role", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const originalRelease = timestamp;
        const targetRelease = timestamp + 1;
        await expect(connect(token, user).reschedulePremintRelease(originalRelease, targetRelease))
          .to.be.revertedWithCustomError(token, ERROR_NAME_UNAUTHORIZED_ACCOUNT)
          .withArgs(user.address, PREMINT_SCHEDULER_ROLE);
        await expect(connect(token, deployer).reschedulePremintRelease(originalRelease, targetRelease))
          .to.be.revertedWithCustomError(token, ERROR_NAME_UNAUTHORIZED_ACCOUNT)
          .withArgs(deployer.address, PREMINT_SCHEDULER_ROLE);
      });

      it("The provided target release timestamp for the rescheduling is passed", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const originalRelease = timestamp;
        const targetRelease = await getLatestBlockTimestamp() - 1;
        await expect(connect(token, preminterRescheduler).reschedulePremintRelease(originalRelease, targetRelease))
          .to.be.revertedWithCustomError(token, ERROR_NAME_PREMINT_RESCHEDULING_TIME_PASSED);
      });

      it("The provided original release time has passed", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const originalRelease = await getLatestBlockTimestamp() - 1;
        const targetRelease = originalRelease + 1000;
        await expect(connect(token, preminterRescheduler).reschedulePremintRelease(originalRelease, targetRelease))
          .to.be.revertedWithCustomError(token, ERROR_NAME_PREMINT_RELEASE_TIME_PASSED);
      });

      it("The provided resolved original release time has passed", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const originalRelease = timestamp;
        const targetRelease1 = originalRelease + 1;
        const targetRelease2 = originalRelease + 1000;
        await proveTx(connect(token, preminterRescheduler).reschedulePremintRelease(originalRelease, targetRelease1));
        await increaseBlockTimestampTo(targetRelease1);
        await expect(connect(token, preminterRescheduler).reschedulePremintRelease(originalRelease, targetRelease2))
          .to.be.revertedWithCustomError(token, ERROR_NAME_PREMINT_RELEASE_TIME_PASSED);
      });

      it("The provided original release time equals the provided target release time", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        await expect(connect(token, preminterRescheduler).reschedulePremintRelease(timestamp, timestamp))
          .to.be.revertedWithCustomError(token, ERROR_NAME_PREMINT_RESCHEDULING_ALREADY_CONFIGURED);
      });

      it("The provided target release time is already configured", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const originalRelease = timestamp;
        const targetRelease = timestamp + 1;
        await proveTx(connect(token, preminterRescheduler).reschedulePremintRelease(originalRelease, targetRelease));
        await expect(connect(token, preminterRescheduler).reschedulePremintRelease(originalRelease, targetRelease))
          .to.be.revertedWithCustomError(token, ERROR_NAME_PREMINT_RESCHEDULING_ALREADY_CONFIGURED);
      });

      it("A rescheduling chain will be made in result", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const originalRelease = timestamp;
        const targetRelease1 = timestamp + 1;
        const targetRelease2 = timestamp + 2;
        await proveTx(connect(token, preminterRescheduler).reschedulePremintRelease(originalRelease, targetRelease1));
        await expect(connect(token, preminterRescheduler).reschedulePremintRelease(targetRelease1, targetRelease2))
          .to.be.revertedWithCustomError(token, ERROR_NAME_PREMINT_RESCHEDULING_CHAIN);
      });

      it("The provided original release time is greater than 64-bit unsigned integer", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const originalRelease = maxUintForBits(64) + 1n;
        const targetRelease = timestamp + 1;
        await expect(connect(token, preminterRescheduler).reschedulePremintRelease(originalRelease, targetRelease))
          .to.be.revertedWithCustomError(token, ERROR_NAME_INAPPROPRIATE_UINT64_VALUE)
          .withArgs(originalRelease);
      });

      it("The provided target release time is greater than 64-bit unsigned integer", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const originalRelease = timestamp;
        const targetRelease = maxUintForBits(64) + 1n;
        await expect(connect(token, preminterRescheduler).reschedulePremintRelease(originalRelease, targetRelease))
          .to.be.revertedWithCustomError(token, ERROR_NAME_INAPPROPRIATE_UINT64_VALUE)
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
        .to.be.revertedWithCustomError(token, ERROR_NAME_MAX_PENDING_PREMINTS_COUNT_ALREADY_CONFIGURED);
    });

    it("Is reverted if the caller does not have the owner role", async () => {
      const { token } = await setUpFixture(deployAndConfigureToken);
      await expect(connect(token, user).configureMaxPendingPremintsCount(0))
        .to.be.revertedWithCustomError(token, ERROR_NAME_UNAUTHORIZED_ACCOUNT)
        .withArgs(user.address, OWNER_ROLE);
    });
  });

  describe("Function 'balanceOfPremint()'", async () => {
    it("Returns the correct balance of premint", async () => {
      const timestamp = (await getLatestBlockTimestamp()) + 100;
      const { token } = await setUpFixture(deployAndConfigureToken);

      await proveTx(connect(token, preminterAgent).premintIncrease(user.address, TOKEN_AMOUNT, timestamp));
      await proveTx(connect(token, preminterAgent).premintIncrease(user.address, TOKEN_AMOUNT + 1, timestamp + 50));
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
      await proveTx(connect(token, preminterAgent).premintIncrease(user.address, TOKEN_AMOUNT, timestamp));
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
