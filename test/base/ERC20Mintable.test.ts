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

  const REVERT_MESSAGE_INITIALIZABLE_CONTRACT_IS_ALREADY_INITIALIZED = "Initializable: contract is already initialized";
  const REVERT_MESSAGE_INITIALIZABLE_CONTRACT_IS_NOT_INITIALIZING = "Initializable: contract is not initializing";
  const REVERT_MESSAGE_OWNABLE_CALLER_IS_NOT_THE_OWNER = "Ownable: caller is not the owner";
  const REVERT_MESSAGE_PAUSABLE_PAUSED = "Pausable: paused";
  const REVERT_MESSAGE_ERC20_MINT_TO_THE_ZERO_ACCOUNT = "ERC20: mint to the zero address";
  const REVERT_MESSAGE_ERC20_BURN_AMOUNT_EXCEEDS_BALANCE = "ERC20: burn amount exceeds balance";
  const REVERT_MESSAGE_ERC20MINTABLE_UINT64_OVERFLOW = "ERC20Mintable: uint64 overflow";

  const REVERT_ERROR_BLOCKLISTED_ACCOUNT = "BlocklistedAccount";
  const REVERT_ERROR_UNAUTHORIZED_MAIN_MINTER = "UnauthorizedMainMinter";
  const REVERT_ERROR_UNAUTHORIZED_MINTER = "UnauthorizedMinter";
  const REVERT_ERROR_ZERO_BURN_AMOUNT = "ZeroBurnAmount";
  const REVERT_ERROR_ZERO_MINT_AMOUNT = "ZeroMintAmount";
  const REVERT_ERROR_ZERO_PREMINT_AMOUNT = "ZeroPremintAmount";
  const REVERT_ERROR_SAME_PREMINT_UNCHANGED = "PremintUnchanged";
  const REVERT_ERROR_SAME_PREMINT_RESTRICTION_FAILURE = "PremintRestrictionFailure";
  const REVERT_ERROR_EXCEEDED_MINT_ALLOWANCE = "ExceededMintAllowance";
  const REVERT_ERROR_PREMINT_RELEASE_TIME_PASSED = "PremintReleaseTimePassed";
  const REVERT_ERROR_MAX_PENDING_PREMINTS_LIMIT_REACHED = "MaxPendingPremintsLimitReached";
  const REVERT_ERROR_MAX_PENDING_PREMINTS_COUNT_ALREADY_CONFIGURED = "MaxPendingPremintsCountAlreadyConfigured";

  enum PremintRestriction {
    None = 0,
    Create = 1,
    Update = 2
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

  describe("Function 'premint()'", async () => {
    let timestamp: number;
    before(async () => {
      timestamp = (await time.latest()) + 100;
    });

    describe("Executes as expected and emits the correct events if", async () => {
      async function executeAndCheckPremint(token: Contract, props: {
        newAmount?: number;
        oldAmount?: number;
        release?: number;
        premintCount?: number;
        premintIndex?: number;
        balanceOfPremint?: number;
        premintRestriction?: PremintRestriction;
      } = {}) {
        const newAmount = props.newAmount ?? TOKEN_AMOUNT;
        const release = props.release ?? timestamp;
        const premintCount = props.premintCount ?? 1;
        const premintIndex = props.premintIndex ?? 0;
        const oldAmount = props.oldAmount ?? 0;
        const balanceOfPremint = props.balanceOfPremint ?? newAmount;
        const premintRestriction = props.premintRestriction ?? PremintRestriction.None;

        const oldMintAllowance: BigNumber = await token.minterAllowance(minter.address);
        let newMintAllowance: BigNumber = oldMintAllowance;
        if (newAmount >= oldAmount) {
          newMintAllowance = newMintAllowance.sub(
            BigNumber.from(newAmount - oldAmount)
          );
        }

        const tx: TransactionResponse = await token.connect(minter).premint(
          user.address,
          newAmount,
          release,
          premintRestriction
        );

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

      it("The caller and destination address are not blocklisted", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        await executeAndCheckPremint(token);
      });

      it("The destination address is blocklisted but the caller is a blocklister", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        await proveTx(token.connect(mainBlocklister).configureBlocklister(minter.address, true));
        await proveTx(token.connect(user).selfBlocklist());
        await executeAndCheckPremint(token);
      });

      it("The caller increases amount of an existing premint", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        await token.connect(minter).premint(user.address, TOKEN_AMOUNT, timestamp, PremintRestriction.None);
        await executeAndCheckPremint(token, {
          newAmount: TOKEN_AMOUNT + 1,
          oldAmount: TOKEN_AMOUNT,
          premintRestriction: PremintRestriction.Create
        });
      });

      it("The caller decreases amount of an existing premint", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        await token.connect(minter).premint(user.address, TOKEN_AMOUNT, timestamp, PremintRestriction.None);
        await executeAndCheckPremint(token, {
          newAmount: TOKEN_AMOUNT - 1,
          oldAmount: TOKEN_AMOUNT,
          premintRestriction: PremintRestriction.Create
        });
      });

      it("The caller deletes an existing premint", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        await token.connect(minter).premint(user.address, TOKEN_AMOUNT, timestamp, PremintRestriction.None);
        await executeAndCheckPremint(token, {
          premintCount: 0,
          newAmount: 0,
          oldAmount: TOKEN_AMOUNT,
          premintRestriction: PremintRestriction.Create
        });
      });

      it("The limit of premints is reached, but some of them are expired", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        for (let i = 0; i < MAX_PENDING_PREMINTS_COUNT; i++) {
          await proveTx(
            token.connect(minter).premint(user.address, TOKEN_AMOUNT, timestamp + i * 10, PremintRestriction.None)
          );
        }
        expect(await token.balanceOfPremint(user.address)).to.eq(TOKEN_AMOUNT * MAX_PENDING_PREMINTS_COUNT);
        await time.increaseTo(timestamp + 1);
        expect(await token.balanceOfPremint(user.address)).to.eq(TOKEN_AMOUNT * (MAX_PENDING_PREMINTS_COUNT - 1));
        await executeAndCheckPremint(token, {
          newAmount: TOKEN_AMOUNT + 1,
          release: timestamp * 2,
          premintCount: MAX_PENDING_PREMINTS_COUNT,
          premintIndex: MAX_PENDING_PREMINTS_COUNT - 1,
          oldAmount: 0,
          balanceOfPremint: TOKEN_AMOUNT * MAX_PENDING_PREMINTS_COUNT + 1,
          premintRestriction: PremintRestriction.Update
        });
      });

      it("The caller adds a premint and all other premints are expired", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        let i = 0;
        for (; i < MAX_PENDING_PREMINTS_COUNT; i++) {
          await proveTx(
            token.connect(minter).premint(user.address, TOKEN_AMOUNT, timestamp + i * 10, PremintRestriction.None)
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

      it("The caller updates a premint and some expired premints are in the beginning of the array", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const timestamps: number[] = Array.from(
          { length: MAX_PENDING_PREMINTS_COUNT },
          (_v, i) => timestamp + (i + 1) * 10
        );
        for (let i = 0; i < timestamps.length; i++) {
          await proveTx(
            token.connect(minter).premint(user.address, TOKEN_AMOUNT, timestamps[i], PremintRestriction.None)
          );
        }
        // set time to expire premints in the beginning of array
        await time.increaseTo(timestamps[1] + 1);

        await executeAndCheckPremint(token, {
          newAmount: TOKEN_AMOUNT + 1,
          oldAmount: TOKEN_AMOUNT,
          release: timestamps[2],
          premintCount: MAX_PENDING_PREMINTS_COUNT - 2,
          premintIndex: 2,
          balanceOfPremint: TOKEN_AMOUNT * (MAX_PENDING_PREMINTS_COUNT - 2) + 1,
          premintRestriction: PremintRestriction.Create
        });
      });

      it("The caller updates a premint and some expired premints are in the middle of the array", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const timestamps: number[] = Array.from(
          { length: MAX_PENDING_PREMINTS_COUNT },
          (_v, i) => timestamp + (i + 1) * 10
        );
        timestamps[2] = timestamp + 1;
        timestamps[3] = timestamp + 2;
        for (let i = 0; i < MAX_PENDING_PREMINTS_COUNT; i++) {
          await proveTx(
            token.connect(minter).premint(user.address, TOKEN_AMOUNT, timestamps[i], PremintRestriction.None)
          );
        }

        // set time to expire premints in the middle of array
        await time.increaseTo(timestamp + 3);

        // update premint in the beginning of array before expired premints
        await executeAndCheckPremint(token, {
          newAmount: TOKEN_AMOUNT - 1,
          oldAmount: TOKEN_AMOUNT,
          release: timestamps[1],
          premintCount: MAX_PENDING_PREMINTS_COUNT - 2,
          premintIndex: 1,
          balanceOfPremint: TOKEN_AMOUNT * (MAX_PENDING_PREMINTS_COUNT - 2) - 1,
          premintRestriction: PremintRestriction.Create
        });
      });

      it("The caller updates a premint and some expired premints are in the end of the array", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const timestamps: number[] = Array.from(
          { length: MAX_PENDING_PREMINTS_COUNT },
          (_v, i) => timestamp + (i + 1) * 10
        );
        timestamps[MAX_PENDING_PREMINTS_COUNT - 1] = timestamp + 2;
        timestamps[MAX_PENDING_PREMINTS_COUNT - 2] = timestamp + 1;

        for (let i = 0; i < MAX_PENDING_PREMINTS_COUNT; i++) {
          await proveTx(
            token.connect(minter).premint(user.address, TOKEN_AMOUNT, timestamps[i], PremintRestriction.None)
          );
        }

        // set time to expire premints in the end of array
        await time.increaseTo(timestamp + 3);

        // update premint in array before expired premints
        await executeAndCheckPremint(token, {
          newAmount: TOKEN_AMOUNT + 1,
          oldAmount: TOKEN_AMOUNT,
          release: timestamps[1],
          premintCount: MAX_PENDING_PREMINTS_COUNT - 2,
          premintIndex: 1,
          balanceOfPremint: TOKEN_AMOUNT * (MAX_PENDING_PREMINTS_COUNT - 2) + 1,
          premintRestriction: PremintRestriction.Create
        });
      });
    });

    describe("Is reverted if", async () => {
      it("The contract is paused", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        await proveTx(token.connect(pauser).pause());
        await expect(token.connect(minter).premint(user.address, TOKEN_AMOUNT, timestamp, PremintRestriction.None))
          .to.be.revertedWith(REVERT_MESSAGE_PAUSABLE_PAUSED);
      });

      it("The premint's release time is passed", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const timestamp = (await time.latest()) - 1;
        await expect(token.connect(minter).premint(user.address, TOKEN_AMOUNT, timestamp, PremintRestriction.None))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_PREMINT_RELEASE_TIME_PASSED);
      });

      it("The amount of premint is greater than 64-bit unsigned integer", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        const overflowAmount = BigNumber.from("18446744073709551616"); // uint64 max + 1
        await expect(token.connect(minter).premint(user.address, overflowAmount, timestamp, PremintRestriction.None))
          .to.be.revertedWith(REVERT_MESSAGE_ERC20MINTABLE_UINT64_OVERFLOW);
      });

      it("The caller is not a minter", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        await expect(token.connect(user).premint(user.address, TOKEN_AMOUNT, timestamp, PremintRestriction.None))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_UNAUTHORIZED_MINTER)
          .withArgs(user.address);
      });

      it("The caller is blocklisted even if the caller is a blocklister", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        await proveTx(token.connect(mainBlocklister).configureBlocklister(minter.address, true));
        await proveTx(token.connect(minter).selfBlocklist());
        await expect(token.connect(minter).premint(user.address, TOKEN_AMOUNT, timestamp, PremintRestriction.None))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_BLOCKLISTED_ACCOUNT)
          .withArgs(minter.address);
      });

      it("The destination address is blocklisted and the caller is not a blocklister", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        await proveTx(token.connect(user).selfBlocklist());
        await expect(token.connect(minter).premint(user.address, TOKEN_AMOUNT, timestamp, PremintRestriction.None))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_BLOCKLISTED_ACCOUNT)
          .withArgs(user.address);
      });

      it("The destination address is zero", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        await expect(
          token.connect(minter).premint(ethers.constants.AddressZero, TOKEN_AMOUNT, timestamp, PremintRestriction.None)
        ).to.be.revertedWith(REVERT_MESSAGE_ERC20_MINT_TO_THE_ZERO_ACCOUNT);
      });

      it("The premint amount is zero", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        await expect(token.connect(minter).premint(user.address, 0, timestamp, PremintRestriction.None))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_ZERO_PREMINT_AMOUNT);
      });

      it("The premint amount exceeds the mint allowance", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        await expect(
          token.connect(minter).premint(user.address, MINT_ALLOWANCE + 1, timestamp, PremintRestriction.None)
        ).to.be.revertedWithCustomError(token, REVERT_ERROR_EXCEEDED_MINT_ALLOWANCE);
      });

      it("The max pending premints limit is reached", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        let i = 0;
        for (; i < MAX_PENDING_PREMINTS_COUNT; i++) {
          await proveTx(
            token.connect(minter).premint(user.address, TOKEN_AMOUNT, timestamp + i * 10, PremintRestriction.None)
          );
        }
        await expect(
          token.connect(minter).premint(user.address, TOKEN_AMOUNT, timestamp + (i + 1) * 10, PremintRestriction.None)
        ).to.be.revertedWithCustomError(token, REVERT_ERROR_MAX_PENDING_PREMINTS_LIMIT_REACHED);
      });

      it("The caller updates an existing premint with the same amount", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        await token.connect(minter).premint(user.address, TOKEN_AMOUNT, timestamp, PremintRestriction.None);
        await expect(token.connect(minter).premint(user.address, TOKEN_AMOUNT, timestamp, PremintRestriction.Create))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_SAME_PREMINT_UNCHANGED);
      });

      it("The caller tries to create premint with `Create` restriction", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        await expect(token.connect(minter).premint(user.address, TOKEN_AMOUNT, timestamp, PremintRestriction.Create))
          .to.be.revertedWithCustomError(token, REVERT_ERROR_SAME_PREMINT_RESTRICTION_FAILURE);
      });
      it("The caller tries to update premint with `Update` restriction", async () => {
        const { token } = await setUpFixture(deployAndConfigureToken);
        await token.connect(minter).premint(user.address, TOKEN_AMOUNT, timestamp, PremintRestriction.None);
        await expect(
          token.connect(minter).premint(user.address, TOKEN_AMOUNT + 1, timestamp, PremintRestriction.Update)
        ).to.be.revertedWithCustomError(token, REVERT_ERROR_SAME_PREMINT_RESTRICTION_FAILURE);
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

      await proveTx(token.connect(minter).premint(user.address, TOKEN_AMOUNT, timestamp, PremintRestriction.None));
      await proveTx(
        token.connect(minter).premint(user.address, TOKEN_AMOUNT + 1, timestamp + 50, PremintRestriction.Update)
      );
      expect(await token.balanceOfPremint(user.address)).to.eq(TOKEN_AMOUNT * 2 + 1);

      await time.increaseTo(timestamp);
      expect(await token.balanceOfPremint(user.address)).to.eq(TOKEN_AMOUNT + 1);

      await time.increaseTo(timestamp + 50);
      expect(await token.balanceOfPremint(user.address)).to.eq(0);
    });
  });
});
