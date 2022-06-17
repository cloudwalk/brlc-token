import { ethers, upgrades } from "hardhat";
import { expect } from "chai";
import { BigNumber, Contract, ContractFactory } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import { proveTx } from "../../test-utils/eth";

interface TestTokenRelocation {
  chainId: number,
  account: SignerWithAddress,
  amount: number,
  nonce: number,
  registered?: boolean,
  processed?: boolean,
  canceled?: boolean,
}

function createRelocationCheckErrorMessage(relocationPropertyName: string, relocationIndex?: number): string {
  if (relocationIndex !== undefined) {
    return `Relocation[${relocationIndex}].${relocationPropertyName} is incorrect`;
  } else {
    return `Relocation.${relocationPropertyName} is incorrect`
  }
}

function checkEquality(
  actualOnChainRelocation: any,
  expectedRelocation: TestTokenRelocation,
  relocationIndex?: number
) {
  expect(actualOnChainRelocation.chainId).to.equal(
    BigNumber.from(expectedRelocation.chainId),
    createRelocationCheckErrorMessage('chainId', relocationIndex)
  );
  expect(actualOnChainRelocation.account).to.equal(
    expectedRelocation.account.address,
    createRelocationCheckErrorMessage('account', relocationIndex)
  );
  expect(actualOnChainRelocation.amount).to.equal(
    expectedRelocation.amount,
    createRelocationCheckErrorMessage('amount', relocationIndex)
  );
  expect(actualOnChainRelocation.canceled).to.equal(
    !!expectedRelocation.canceled,
    createRelocationCheckErrorMessage('canceled', relocationIndex)
  );
}

describe("Contract 'TokenBridgeUpgradeable'", async () => {
  // Revert messages
  const REVERT_MESSAGE_IF_CONTRACT_IS_ALREADY_INITIALIZED = 'Initializable: contract is already initialized';
  const REVERT_MESSAGE_IF_CALLER_IS_NOT_OWNER = "Ownable: caller is not the owner";
  const REVERT_MESSAGE_IF_CONTRACT_IS_PAUSED = "Pausable: paused";
  const REVERT_MESSAGE_IF_RELOCATION_CHAIN_IF_NOT_SUPPORTED = "TokenBridge: relocation chain is not supported";
  const REVERT_MESSAGE_IF_RELOCATION_AMOUNT_IS_ZERO = "TokenBridge: relocation amount must be greater than 0";
  const REVERT_MESSAGE_IF_ACCOUNT_IS_NOT_WHITELISTED = "Whitelistable: account is not whitelisted";
  const REVERT_MESSAGE_IF_RELOCATION_COUNT_EXCEEDS_NUMBER_OF_PENDING_RELOCATIONS =
    "TokenBridge: the count exceeds the number of pending relocations";
  const REVERT_MESSAGE_IF_TOKEN_TRANSFER_AMOUNT_EXCEEDS_BALANCE = "ERC20: transfer amount exceeds balance";
  const REVERT_MESSAGE_IF_TRANSACTION_SENDER_IS_NOT_AUTHORIZED = "TokenBridge: transaction sender is not authorized";
  const REVERT_MESSAGE_IF_RELOCATION_NONCES_ARRAY_IS_EMPTY = "TokenBridge: relocation nonces array is empty"
  const REVERT_MESSAGE_IF_RELOCATION_WITH_THE_NONCE_ALREADY_PROCESSED =
    "TokenBridge: relocation with the nonce already processed";
  const REVERT_MESSAGE_IF_RELOCATION_WITH_THE_NONCE_DOES_NOT_EXIST =
    "TokenBridge: relocation with the nonce doesn't exist";
  const REVERT_MESSAGE_IF_RELOCATION_WAS_ALREADY_CANCELED = "TokenBridge: relocation was already canceled";
  const REVERT_MESSAGE_IF_ARRIVAL_CHAIN_IS_NOT_SUPPORTED = "TokenBridge: arrival chain is not supported";
  const REVERT_MESSAGE_IF_INPUT_ARRAY_ERROR = "TokenBridge: input arrays error";
  const REVERT_MESSAGE_IF_RELOCATION_NONCE_MISMATCH = "TokenBridge: relocation nonce mismatch";
  const REVERT_MESSAGE_IF_ACCOUNT_IS_ZERO_ADDRESS = "TokenBridge: account is the zero address";
  const REVERT_MESSAGE_IF_AMOUNT_MUST_BE_GREATER_THAN_ZERO = "TokenBridge: amount must be greater than 0";

  let tokenBridge: Contract;
  let brlcMock: Contract;
  let deployer: SignerWithAddress;
  let user1: SignerWithAddress;
  let user2: SignerWithAddress;

  async function setUpContractsForRelocations(relocations: TestTokenRelocation[]) {
    for (let relocation of relocations) {
      await proveTx(tokenBridge.setRelocationChain(relocation.chainId, true));
      await proveTx(brlcMock.mint(relocation.account.address, relocation.amount));
      const allowance: BigNumber =
        await brlcMock.allowance(relocation.account.address, tokenBridge.address);
      if (allowance.lt(BigNumber.from(relocation.amount))) {
        await proveTx(
          brlcMock.connect(relocation.account).approve(tokenBridge.address, ethers.constants.MaxInt256)
        );
      }
    }
  }

  async function registerRelocations(relocations: TestTokenRelocation[]) {
    for (let relocation of relocations) {
      await proveTx(
        tokenBridge.connect(relocation.account).registerRelocation(relocation.chainId, relocation.amount)
      );
      relocation.registered = true;
    }
  }

  async function addAccountToBridgeWhitelist(account: SignerWithAddress) {
    await proveTx(tokenBridge.setWhitelistEnabled(true));
    await proveTx(tokenBridge.setWhitelistAdmin(deployer.address));
    await proveTx(tokenBridge.updateWhitelister(deployer.address, true));
    await proveTx(tokenBridge.whitelist(account.address));
  }

  async function checkBridgeState(relocations: TestTokenRelocation[]): Promise<void> {
    const expectedRegisteredRelocationCount: number = relocations
      .map(function (relocation: TestTokenRelocation): number {
        return !relocation.registered ? 0 : 1
      }).reduce((sum: number, current: number) => sum + current);

    const expectedProcessedRelocationCount: number = relocations
      .map(function (relocation: TestTokenRelocation): number {
        return !relocation.processed ? 0 : 1
      }).reduce((sum: number, current: number) => sum + current);

    const expectedPendingRelocationCount = expectedRegisteredRelocationCount - expectedProcessedRelocationCount;

    const expectedBridgeBalance: number = relocations
      .map(function (relocation: TestTokenRelocation): number {
        return (!!relocation.registered && !relocation.processed && !relocation.canceled) ? relocation.amount : 0
      }).reduce((sum: number, current: number) => sum + current);

    expect(await tokenBridge.pendingRelocations()).to.equal(expectedPendingRelocationCount);
    expect(await tokenBridge.lastConfirmedRelocationNonce()).to.equal(expectedProcessedRelocationCount);
    for (let i = 0; i < relocations.length; ++i) {
      const relocation = relocations[i];
      if (relocation.registered) {
        const actualRelocation = await tokenBridge.relocations(relocation.nonce);
        checkEquality(actualRelocation, relocation, i);
      }
    }
    expect(await brlcMock.balanceOf(tokenBridge.address)).to.equal(expectedBridgeBalance);
  }

  beforeEach(async () => {
    // Deploy BRLC
    const BRLCMock: ContractFactory = await ethers.getContractFactory("ERC20UpgradeableMock");
    brlcMock = await upgrades.deployProxy(BRLCMock, ["BRL Coin", "BRLC", 6]);
    await brlcMock.deployed();

    // Deploy TokenBridge
    const TokenBridge: ContractFactory = await ethers.getContractFactory("TokenBridgeUpgradeable");
    tokenBridge = await upgrades.deployProxy(TokenBridge, [brlcMock.address]);
    await tokenBridge.deployed();

    // Get user accounts
    [deployer, user1, user2] = await ethers.getSigners();
  });

  it("The initialize function can't be called more than once", async () => {
    await expect(
      tokenBridge.initialize(brlcMock.address)
    ).to.be.revertedWith(REVERT_MESSAGE_IF_CONTRACT_IS_ALREADY_INITIALIZED);
  });

  describe("Configuration", async () => {
    describe("Function 'setRelocationChain()'", async () => {
      const chainId: number = 123;

      it("Is reverted if is called not by the owner", async () => {
        await expect(
          tokenBridge.connect(user1).setRelocationChain(chainId, true)
        ).to.be.revertedWith(REVERT_MESSAGE_IF_CALLER_IS_NOT_OWNER);
      });

      it("Updates the availability of relocation to the chain correctly if called by the owner", async () => {
        const chainAvailabilityOld = await tokenBridge.relocationChains(chainId);
        expect(chainAvailabilityOld).to.equal(false);
        await proveTx(tokenBridge.setRelocationChain(chainId, true));
        const chainAvailabilityNew = await tokenBridge.relocationChains(chainId);
        expect(chainAvailabilityNew).to.equal(true);

        await proveTx(tokenBridge.setRelocationChain(chainId, false));
        const chainAvailabilityNew2 = await tokenBridge.relocationChains(chainId);
        expect(chainAvailabilityNew2).to.equal(false);
      });
    });

    describe("Function 'setArrivalChain()'", async () => {
      const chainId: number = 123;

      it("Is reverted if is called not by the owner", async () => {
        await expect(
          tokenBridge.connect(user1).setArrivalChain(chainId, true)
        ).to.be.revertedWith(REVERT_MESSAGE_IF_CALLER_IS_NOT_OWNER);
      });

      it("Updates the availability of relocation from the chain correctly if called by the owner", async () => {
        const chainAvailabilityOld = await tokenBridge.arrivalChains(chainId);
        expect(chainAvailabilityOld).to.equal(false);
        await proveTx(tokenBridge.setArrivalChain(chainId, true));
        const chainAvailabilityNew = await tokenBridge.arrivalChains(chainId);
        expect(chainAvailabilityNew).to.equal(true);

        await proveTx(tokenBridge.setArrivalChain(chainId, false));
        const chainAvailabilityNew2 = await tokenBridge.arrivalChains(chainId);
        expect(chainAvailabilityNew2).to.equal(false);
      });
    });
  });

  describe("Interactions related to relocations", async () => {
    describe("Function 'registerRelocation()'", async () => {
      let relocation: TestTokenRelocation;
      const relocationCount = 1;

      beforeEach(async () => {
        relocation = {
          chainId: 123,
          account: user1,
          amount: 456,
          nonce: 1,
        };
        await setUpContractsForRelocations([relocation]);
      });

      it("Is reverted if the contract is paused", async () => {
        await proveTx(tokenBridge.setPauser(deployer.address));
        await proveTx(tokenBridge.pause());
        await expect(
          tokenBridge.connect(relocation.account).registerRelocation(relocation.chainId, relocation.amount)
        ).to.be.revertedWith(REVERT_MESSAGE_IF_CONTRACT_IS_PAUSED);
      });

      it("Is reverted if the target chain is unsupported for relocations", async () => {
        await expect(
          tokenBridge.connect(relocation.account).registerRelocation(relocation.chainId + 1, relocation.amount)
        ).to.be.revertedWith(REVERT_MESSAGE_IF_RELOCATION_CHAIN_IF_NOT_SUPPORTED);
      });

      it("Is reverted if the token amount to relocation is zero", async () => {
        await expect(
          tokenBridge.connect(relocation.account).registerRelocation(relocation.chainId, 0)
        ).to.be.revertedWith(REVERT_MESSAGE_IF_RELOCATION_AMOUNT_IS_ZERO);
      });

      it("Is reverted if the user has not enough token balance", async () => {
        const excessTokenAmount: number = relocation.amount + 1;
        await expect(
          tokenBridge.connect(relocation.account).registerRelocation(relocation.chainId, excessTokenAmount)
        ).to.be.revertedWith(REVERT_MESSAGE_IF_TOKEN_TRANSFER_AMOUNT_EXCEEDS_BALANCE);
      });

      it("Transfers the tokens as expected, emits the correct events, changes the state properly", async () => {
        await expect(
          tokenBridge.connect(relocation.account).registerRelocation(relocation.chainId, relocation.amount)
        ).to.changeTokenBalances(
          brlcMock,
          [relocation.amount, tokenBridge],
          [-relocation.amount, relocation.amount]
        ).and.to.emit(
          tokenBridge,
          "RegisterRelocation"
        ).withArgs(
          relocationCount,
          relocation.chainId,
          relocation.account.address,
          relocation.amount
        );
        relocation.registered = true;
        await checkBridgeState([relocation]);
      });
    });

    describe("Function 'cancelRelocation()'", async () => {
      let relocation: TestTokenRelocation;

      beforeEach(async () => {
        relocation = {
          chainId: 234,
          account: user1,
          amount: 567,
          nonce: 1,
        };
        await setUpContractsForRelocations([relocation]);
        await registerRelocations([relocation]);
      });

      it("Is reverted if the contract is paused", async () => {
        await proveTx(tokenBridge.setPauser(deployer.address));
        await proveTx(tokenBridge.pause());
        await expect(
          tokenBridge.connect(relocation.account).cancelRelocation(relocation.nonce)
        ).to.be.revertedWith(REVERT_MESSAGE_IF_CONTRACT_IS_PAUSED);
      });

      it("Is reverted if the caller did not request the relocation", async () => {
        await expect(
          tokenBridge.connect(user2).cancelRelocation(relocation.nonce)
        ).to.be.revertedWith(REVERT_MESSAGE_IF_TRANSACTION_SENDER_IS_NOT_AUTHORIZED);
      });

      it("Is reverted if a relocation with the nonce has already processed", async () => {
        await expect(
          tokenBridge.connect(relocation.account).cancelRelocation(relocation.nonce - 1)
        ).to.be.revertedWith(REVERT_MESSAGE_IF_TRANSACTION_SENDER_IS_NOT_AUTHORIZED);
      });

      it("Is reverted if a relocation with the nonce does not exists", async () => {
        await expect(
          tokenBridge.connect(relocation.account).cancelRelocation(relocation.nonce + 1)
        ).to.be.revertedWith(REVERT_MESSAGE_IF_TRANSACTION_SENDER_IS_NOT_AUTHORIZED);
      });

      it("Transfers the tokens as expected, emits the correct events, changes the state properly", async () => {
        await checkBridgeState([relocation]);
        await expect(
          tokenBridge.connect(relocation.account).cancelRelocation(relocation.nonce)
        ).to.changeTokenBalances(
          brlcMock,
          [relocation.account, tokenBridge],
          [+relocation.amount, -relocation.amount]
        ).and.to.emit(
          tokenBridge,
          "CancelRelocation"
        ).withArgs(
          relocation.nonce,
          relocation.chainId,
          relocation.account.address,
          relocation.amount
        );
        relocation.canceled = true;
        await checkBridgeState([relocation]);
      });
    });

    describe("Function 'cancelRelocations()'", async () => {
      let relocations: TestTokenRelocation[];
      let relocator: SignerWithAddress;
      let relocationNonces: number[];

      beforeEach(async () => {
        relocations = [
          {
            chainId: 12,
            account: user1,
            amount: 34,
            nonce: 1,
          },
          {
            chainId: 56,
            account: user2,
            amount: 78,
            nonce: 2,
          },
        ];
        relocationNonces = relocations.map(relocation => relocation.nonce);
        relocator = user2;
        await setUpContractsForRelocations(relocations);
        await registerRelocations(relocations);
        await addAccountToBridgeWhitelist(relocator);
      });

      it("Is reverted if the contract is paused", async () => {
        await proveTx(tokenBridge.setPauser(deployer.address));
        await proveTx(tokenBridge.pause());
        await expect(
          tokenBridge.connect(relocator).cancelRelocations(relocationNonces)
        ).to.be.revertedWith(REVERT_MESSAGE_IF_CONTRACT_IS_PAUSED);
      });

      it("Is reverted if the caller is not whitelisted", async () => {
        await expect(
          tokenBridge.connect(deployer).cancelRelocations(relocationNonces)
        ).to.be.revertedWith(REVERT_MESSAGE_IF_ACCOUNT_IS_NOT_WHITELISTED);
      });

      it("Is reverted if the input array of nonces is empty", async () => {
        await expect(
          tokenBridge.connect(relocator).cancelRelocations([])
        ).to.be.revertedWith(REVERT_MESSAGE_IF_RELOCATION_NONCES_ARRAY_IS_EMPTY);
      });

      it("Is reverted if some input nonce is less than the lowest nonce of pending relocations", async () => {
        await expect(
          tokenBridge.connect(relocator)
            .cancelRelocations([
              Math.min(...relocationNonces),
              Math.min(...relocationNonces) - 1
            ])
        ).to.be.revertedWith(REVERT_MESSAGE_IF_RELOCATION_WITH_THE_NONCE_ALREADY_PROCESSED);
      });

      it("Is reverted if some input nonce is greater than the highest nonce of pending relocations", async () => {
        await expect(
          tokenBridge.connect(relocator)
            .cancelRelocations([
              Math.max(...relocationNonces),
              Math.max(...relocationNonces) + 1
            ])
        ).to.be.revertedWith(REVERT_MESSAGE_IF_RELOCATION_WITH_THE_NONCE_DOES_NOT_EXIST);
      });

      it("Is reverted if a relocation with some nonce was already canceled", async () => {
        await proveTx(tokenBridge.connect(relocations[1].account).cancelRelocation(relocations[1].nonce));
        await expect(
          tokenBridge.connect(relocator).cancelRelocations(relocationNonces)
        ).to.be.revertedWith(REVERT_MESSAGE_IF_RELOCATION_WAS_ALREADY_CANCELED);
      });

      it("Transfers the tokens as expected, emits the correct events, changes the state properly", async () => {
        await checkBridgeState(relocations);

        const relocationAmounts: number[] = relocations.map(relocation => relocation.amount);
        const relocationAccountAddresses: string[] = relocations.map(relocation => relocation.account.address);
        const relocationAmountTotal: number = relocationAmounts.reduce((sum: number, current: number) => sum + current);

        await expect(tokenBridge.connect(relocator).cancelRelocations(relocationNonces))
          .to.changeTokenBalances(
            brlcMock,
            [tokenBridge, ...relocationAccountAddresses],
            [-(relocationAmountTotal), ...relocationAmounts]
          ).and.to.emit(
            tokenBridge,
            "CancelRelocation"
          ).withArgs(
            relocations[0].nonce,
            relocations[0].chainId,
            relocations[0].account.address,
            relocations[0].amount,
          ).and.to.emit(
            tokenBridge,
            "CancelRelocation"
          ).withArgs(
            relocations[1].nonce,
            relocations[1].chainId,
            relocations[1].account.address,
            relocations[1].amount
          );
        relocations.forEach(relocation => relocation.canceled = true);
        await checkBridgeState(relocations);
      });
    });

    describe("Function 'relocate()'", async () => {
      let relocation: TestTokenRelocation;
      const relocationCount: number = 1;
      let relocator: SignerWithAddress;

      beforeEach(async () => {
        relocation = {
          chainId: 345,
          account: user1,
          amount: 678,
          nonce: 1,
        };
        relocator = user2;

        await setUpContractsForRelocations([relocation]);
        await registerRelocations([relocation])
        await addAccountToBridgeWhitelist(relocator);
      });

      it("Is reverted if the contract is paused", async () => {
        await proveTx(tokenBridge.setPauser(deployer.address));
        await proveTx(tokenBridge.pause());
        await expect(
          tokenBridge.connect(relocator).relocate(relocationCount)
        ).to.be.revertedWith(REVERT_MESSAGE_IF_CONTRACT_IS_PAUSED);
      });

      it("Is reverted if the caller is not whitelisted", async () => {
        await expect(
          tokenBridge.connect(deployer).relocate(relocationCount)
        ).to.be.revertedWith(REVERT_MESSAGE_IF_ACCOUNT_IS_NOT_WHITELISTED);
      });

      it("Is reverted if the relocation count exceeds the number of pending relocations", async () => {
        await expect(
          tokenBridge.connect(relocator).relocate(relocationCount + 1)
        ).to.be.revertedWith(REVERT_MESSAGE_IF_RELOCATION_COUNT_EXCEEDS_NUMBER_OF_PENDING_RELOCATIONS);
      });

      it("Burns no tokens, emits no events if the relocation was canceled", async () => {
        await proveTx(tokenBridge.connect(relocation.account).cancelRelocation(relocation.nonce));
        relocation.canceled = true;
        await expect(
          tokenBridge.connect(relocator).relocate(relocationCount)
        ).to.changeTokenBalances(
          brlcMock,
          [tokenBridge],
          [0]
        ).and.not.to.emit(
          tokenBridge,
          "ConfirmRelocation"
        );
        relocation.processed = true;
        await checkBridgeState([relocation]);
      });

      it("Burns the tokens as expected, emits the correct event, changes the state properly", async () => {
        await expect(
          tokenBridge.connect(relocator).relocate(relocationCount)
        ).to.changeTokenBalances(
          brlcMock,
          [user1, user2, tokenBridge],
          [0, 0, -relocation.amount]
        ).and.to.emit(
          tokenBridge,
          "ConfirmRelocation"
        ).withArgs(
          relocation.nonce,
          relocation.chainId,
          relocation.account.address,
          relocation.amount
        );
        relocation.processed = true;
        await checkBridgeState([relocation]);
      });
    });

    describe("Complex scenario with mixing the functions and several relocations", async () => {
      let relocations: TestTokenRelocation[];
      let relocator: SignerWithAddress;

      beforeEach(async () => {
        relocations = [
          {
            chainId: 12,
            account: user1,
            amount: 34,
            nonce: 1,
          },
          {
            chainId: 34,
            account: user1,
            amount: 56,
            nonce: 2,
          },
          {
            chainId: 78,
            account: user2,
            amount: 90,
            nonce: 3,
          },
          {
            chainId: 12,
            account: deployer,
            amount: 34,
            nonce: 4,
          },
        ];
        relocator = user2;
        await setUpContractsForRelocations(relocations);
        await addAccountToBridgeWhitelist(relocator);
      });

      it("Executes as expected", async () => {
        // Register first 3 relocations
        await registerRelocations([relocations[0], relocations[1], relocations[2]]);
        await checkBridgeState(relocations);

        // Process the first relocation
        await proveTx(tokenBridge.connect(relocator).relocate(1));
        relocations[0].processed = true;
        await checkBridgeState(relocations);

        // Try to cancel already processed relocation
        let relocation: TestTokenRelocation = relocations[0];
        await expect(
          tokenBridge.connect(relocation.account).cancelRelocation(relocation.nonce)
        ).to.be.revertedWith(REVERT_MESSAGE_IF_RELOCATION_WITH_THE_NONCE_ALREADY_PROCESSED);

        // Try to cancel a relocation of another user
        await expect(
          tokenBridge.connect(relocations[1].account).cancelRelocation(relocations[2].nonce)
        ).to.be.revertedWith(REVERT_MESSAGE_IF_TRANSACTION_SENDER_IS_NOT_AUTHORIZED);

        // Try to cancel several relocations including the processed one
        await expect(
          tokenBridge.connect(relocator).cancelRelocations([
            relocations[2].nonce,
            relocations[1].nonce,
            relocations[0].nonce,
          ])
        ).to.be.revertedWith(REVERT_MESSAGE_IF_RELOCATION_WITH_THE_NONCE_ALREADY_PROCESSED);

        // Try to cancel several relocations including one that is out of the pending range
        await expect(
          tokenBridge.connect(relocator).cancelRelocations([
            relocations[3].nonce,
            relocations[2].nonce,
            relocations[1].nonce,
          ])
        ).to.be.revertedWith(REVERT_MESSAGE_IF_RELOCATION_WITH_THE_NONCE_DOES_NOT_EXIST);

        //Check that state of the bridge has not changed
        await checkBridgeState(relocations);

        // Register the las relocation
        await registerRelocations([relocations[3]]);
        await checkBridgeState(relocations);

        // Cancel two last relocations
        await proveTx(tokenBridge.connect(relocator).cancelRelocations([relocations[3].nonce, relocations[2].nonce,]));
        [relocations[3], relocations[2]].forEach(relocation => relocation.canceled = true);
        await checkBridgeState(relocations);

        // Process all the pending relocations
        await proveTx(tokenBridge.connect(relocator).relocate(3));
        relocations.forEach(relocation => relocation.processed = true);
        await checkBridgeState(relocations);
      })
    })
  });

  describe("Interactions related to accommodations", async () => {
    describe("Function 'accommodate()'", async () => {
      const chainId: number = 123;
      let relocations: TestTokenRelocation[];
      let accommodator: SignerWithAddress;
      let relocationNonces: number[];
      let relocationAccounts: string[];
      let relocationAmounts: number[];
      let relocationCancelStates: boolean[];
      let expectedMintingAmounts: number[];
      let expectedMintingAmountTotal: number;

      beforeEach(async () => {
        relocations = [
          {
            chainId: chainId,
            account: user1,
            amount: 456,
            nonce: 1,
          },
          {
            chainId: chainId,
            account: user2,
            amount: 789,
            nonce: 2,
            canceled: true,
          },
        ]
        accommodator = user2;
        relocationNonces = relocations.map(relocation => relocation.nonce);
        relocationAccounts = relocations.map(relocation => relocation.account.address);
        relocationAmounts = relocations.map(relocation => relocation.amount);
        relocationCancelStates = relocations.map(relocation => !!relocation.canceled);
        expectedMintingAmounts = relocations.map(relocation => (!relocation.canceled) ? relocation.amount : 0);
        expectedMintingAmountTotal = expectedMintingAmounts.reduce((sum: number, current: number) => sum + current);

        await proveTx(tokenBridge.setArrivalChain(chainId, true));
        await addAccountToBridgeWhitelist(accommodator);
      });

      it("Is reverted if the contract is paused", async () => {
        await proveTx(tokenBridge.setPauser(deployer.address));
        await proveTx(tokenBridge.pause());
        await expect(
          tokenBridge.connect(accommodator).accommodate(
            chainId,
            relocationNonces,
            relocationAccounts,
            relocationAmounts,
            relocationCancelStates
          )
        ).to.be.revertedWith(REVERT_MESSAGE_IF_CONTRACT_IS_PAUSED);
      });

      it("Is reverted if the caller is not whitelisted", async () => {
        await expect(
          tokenBridge.connect(deployer).accommodate(
            chainId,
            relocationNonces,
            relocationAccounts,
            relocationAmounts,
            relocationCancelStates
          )
        ).to.be.revertedWith(REVERT_MESSAGE_IF_ACCOUNT_IS_NOT_WHITELISTED);
      });

      it("Is reverted if the chain id is not supported for arrivals", async () => {
        await expect(
          tokenBridge.connect(accommodator).accommodate(
            chainId + 1,
            relocationNonces,
            relocationAccounts,
            relocationAmounts,
            relocationCancelStates
          )
        ).to.be.revertedWith(REVERT_MESSAGE_IF_ARRIVAL_CHAIN_IS_NOT_SUPPORTED);
      });

      it("Is reverted if the nonces array is empty", async () => {
        await expect(
          tokenBridge.connect(accommodator).accommodate(
            chainId,
            [],
            relocationAccounts,
            relocationAmounts,
            relocationCancelStates
          )
        ).to.be.revertedWith(REVERT_MESSAGE_IF_INPUT_ARRAY_ERROR);
      });

      it("Is reverted if the nonces array has a different length than other input arrays", async () => {
        relocationNonces.pop();
        await expect(
          tokenBridge.connect(accommodator).accommodate(
            chainId,
            relocationNonces,
            relocationAccounts,
            relocationAmounts,
            relocationCancelStates
          )
        ).to.be.revertedWith(REVERT_MESSAGE_IF_INPUT_ARRAY_ERROR);
      });

      it("Is reverted if the accounts array has a different length than other input arrays", async () => {
        relocationAccounts.pop();
        await expect(
          tokenBridge.connect(accommodator).accommodate(
            chainId,
            relocationNonces,
            relocationAccounts,
            relocationAmounts,
            relocationCancelStates
          )
        ).to.be.revertedWith(REVERT_MESSAGE_IF_INPUT_ARRAY_ERROR);
      });

      it("Is reverted if the amounts array has a different length than other input arrays", async () => {
        relocationAmounts.pop();
        await expect(
          tokenBridge.connect(accommodator).accommodate(
            chainId,
            relocationNonces,
            relocationAccounts,
            relocationAmounts,
            relocationCancelStates
          )
        ).to.be.revertedWith(REVERT_MESSAGE_IF_INPUT_ARRAY_ERROR);
      });

      it("Is reverted if the canceled states array has a different length than other input arrays", async () => {
        relocationCancelStates.pop();
        await expect(
          tokenBridge.connect(accommodator).accommodate(
            chainId,
            relocationNonces,
            relocationAccounts,
            relocationAmounts,
            relocationCancelStates,
          )
        ).to.be.revertedWith(REVERT_MESSAGE_IF_INPUT_ARRAY_ERROR);
      });

      it("Is reverted if one of the input nonces is greater than it is expected", async () => {
        relocationNonces[1] += 1;
        await expect(
          tokenBridge.connect(accommodator).accommodate(
            chainId,
            relocationNonces,
            relocationAccounts,
            relocationAmounts,
            relocationCancelStates
          )
        ).to.be.revertedWith(REVERT_MESSAGE_IF_RELOCATION_NONCE_MISMATCH);
      });

      it("Is reverted if one of the input nonces is less than it is expected", async () => {
        relocationNonces[1] -= 1;
        await expect(
          tokenBridge.connect(accommodator).accommodate(
            chainId,
            relocationNonces,
            relocationAccounts,
            relocationAmounts,
            relocationCancelStates
          )
        ).to.be.revertedWith(REVERT_MESSAGE_IF_RELOCATION_NONCE_MISMATCH);
      });

      it("Is reverted if one of the input accounts has zero address", async () => {
        relocationAccounts[1] = ethers.constants.AddressZero;
        await expect(
          tokenBridge.connect(accommodator).accommodate(
            chainId,
            relocationNonces,
            relocationAccounts,
            relocationAmounts,
            relocationCancelStates
          )
        ).to.be.revertedWith(REVERT_MESSAGE_IF_ACCOUNT_IS_ZERO_ADDRESS);
      });

      it("Is reverted if one of the input amounts is zero", async () => {
        relocationAmounts[1] = 0;
        await expect(
          tokenBridge.connect(accommodator).accommodate(
            chainId,
            relocationNonces,
            relocationAccounts,
            relocationAmounts,
            relocationCancelStates
          )
        ).to.be.revertedWith(REVERT_MESSAGE_IF_AMOUNT_MUST_BE_GREATER_THAN_ZERO);
      });

      it("Transfers the tokens as expected, emits the correct events, changes the state properly", async () => {
        await expect(
          tokenBridge.connect(accommodator).accommodate(
            chainId,
            relocationNonces,
            relocationAccounts,
            relocationAmounts,
            relocationCancelStates
          )
        ).to.changeTokenBalances(
          brlcMock,
          [tokenBridge, ...relocationAccounts],
          [0, ...expectedMintingAmounts]
        ).and.to.emit(
          tokenBridge,
          "ConfirmArrival"
        ).withArgs(
          relocationNonces[0],
          chainId,
          relocationAccounts[0],
          expectedMintingAmounts[0],
        );
        expect(await tokenBridge.arrivalNonces(chainId)).to.equal(relocationNonces.pop());
      });
    });
  });
});
