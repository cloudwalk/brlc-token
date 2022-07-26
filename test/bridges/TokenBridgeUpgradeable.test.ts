import { ethers, upgrades } from "hardhat";
import { expect } from "chai";
import { BigNumber, Contract, ContractFactory } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import { proveTx } from "../../test-utils/eth";
import { countNumberArrayTotal } from "../../test-utils/misc";

interface TestTokenRelocation {
  chainId: number;
  account: SignerWithAddress;
  amount: number;
  nonce: number;
  registered?: boolean;
  processed?: boolean;
  canceled?: boolean;
}

interface BridgeStateForChainId {
  registeredRelocationCount: number;
  processedRelocationCount: number;
  pendingRelocationCount: number;
  firstNonce: number;
  nonceCount: number;
  accounts: string[];
  amounts: BigNumber[];
  cancellationFlags: boolean[];
}

function checkEquality(
  actualOnChainRelocation: any,
  expectedRelocation: TestTokenRelocation,
  relocationIndex: number
) {
  expect(actualOnChainRelocation.account).to.equal(
    expectedRelocation.account.address,
    `relocation[${relocationIndex}].account is incorrect, chainId=${expectedRelocation.chainId}`
  );
  expect(actualOnChainRelocation.amount).to.equal(
    expectedRelocation.amount,
    `relocation[${relocationIndex}].amount is incorrect, chainId=${expectedRelocation.chainId}`
  );
  expect(actualOnChainRelocation.canceled).to.equal(
    !!expectedRelocation.canceled,
    `relocation[${relocationIndex}].canceled is incorrect, chainId=${expectedRelocation.chainId}`
  );
}

function countRelocationsForChainId(relocations: TestTokenRelocation[], targetChainId: number) {
  return countNumberArrayTotal(
    relocations.map(
      function (relocation: TestTokenRelocation): number {
        return (relocation.chainId == targetChainId) ? 1 : 0;
      }
    )
  );
}

function markRelocationsAsProcessed(relocations: TestTokenRelocation[]) {
  relocations.forEach((relocation: TestTokenRelocation) => relocation.processed = true);
}

describe("Contract 'TokenBridgeUpgradeable'", async () => {
  // Revert messages
  const REVERT_MESSAGE_IF_CONTRACT_IS_ALREADY_INITIALIZED = "Initializable: contract is already initialized";
  const REVERT_MESSAGE_IF_TOKEN_DOES_NOT_SUPPORT_BRIDGE_OPERATIONS =
    "TokenBridge: token contract does not support bridge operations";
  const REVERT_MESSAGE_IF_CALLER_IS_NOT_OWNER = "Ownable: caller is not the owner";
  const REVERT_MESSAGE_IF_CONTRACT_IS_PAUSED = "Pausable: paused";
  const REVERT_MESSAGE_IF_RELOCATION_CHAIN_IF_NOT_SUPPORTED = "TokenBridge: chain is not supported for relocation";
  const REVERT_MESSAGE_IF_RELOCATION_AMOUNT_IS_ZERO = "TokenBridge: relocation amount must be greater than 0";
  const REVERT_MESSAGE_IF_BRIDGE_IS_UNSUPPORTED =
    "TokenBridge: bridge is not supported by the token contract";
  const REVERT_MESSAGE_IF_ACCOUNT_IS_NOT_WHITELISTED = "Whitelistable: account is not whitelisted";
  const REVERT_MESSAGE_IF_RELOCATION_COUNT_IS_ZERO = "TokenBridge: count should be greater than zero";
  const REVERT_MESSAGE_IF_RELOCATION_COUNT_EXCEEDS_NUMBER_OF_PENDING_RELOCATIONS =
    "TokenBridge: count exceeds the number of pending relocations";
  const REVERT_MESSAGE_IF_BURNING_OF_TOKENS_FAILED = "TokenBridge: burning of tokens failed";
  const REVERT_MESSAGE_IF_TOKEN_TRANSFER_AMOUNT_EXCEEDS_BALANCE = "ERC20: transfer amount exceeds balance";
  const REVERT_MESSAGE_IF_TRANSACTION_SENDER_IS_NOT_AUTHORIZED = "TokenBridge: transaction sender is not authorized";
  const REVERT_MESSAGE_IF_RELOCATION_NONCES_ARRAY_IS_EMPTY = "TokenBridge: relocation nonces array is empty";
  const REVERT_MESSAGE_IF_RELOCATION_WITH_THE_NONCE_ALREADY_PROCESSED =
    "TokenBridge: relocation with the nonce already processed";
  const REVERT_MESSAGE_IF_RELOCATION_WITH_THE_NONCE_DOES_NOT_EXIST =
    "TokenBridge: relocation with the nonce does not exist";
  const REVERT_MESSAGE_IF_RELOCATION_WAS_ALREADY_CANCELED = "TokenBridge: relocation was already canceled";
  const REVERT_MESSAGE_IF_ARRIVAL_CHAIN_IS_NOT_SUPPORTED = "TokenBridge: chain is not supported for arrival";
  const REVERT_MESSAGE_IF_ARRIVAL_FIRST_NONCE_IS_ZERO = "TokenBridge: must be greater than 0";
  const REVERT_MESSAGE_IF_INPUT_ARRAY_ERROR = "TokenBridge: input arrays have different length";
  const REVERT_MESSAGE_IF_RELOCATION_NONCE_MISMATCH = "TokenBridge: relocation nonce mismatch";
  const REVERT_MESSAGE_IF_ACCOUNT_IS_ZERO_ADDRESS = "TokenBridge: account is the zero address";
  const REVERT_MESSAGE_IF_AMOUNT_MUST_BE_GREATER_THAN_ZERO = "TokenBridge: amount must be greater than 0";
  const REVERT_MESSAGE_IF_MINTING_OF_TOKENS_FAILED = "TokenBridge: minting of tokens failed";

  let tokenBridge: Contract;
  let tokenMock: Contract;
  let deployer: SignerWithAddress;
  let user1: SignerWithAddress;
  let user2: SignerWithAddress;

  async function setUpContractsForRelocations(relocations: TestTokenRelocation[]) {
    for (const relocation of relocations) {
      await proveTx(tokenBridge.setSupportedRelocation(relocation.chainId, true));
      await proveTx(tokenMock.mint(relocation.account.address, relocation.amount));
      const allowance: BigNumber =
        await tokenMock.allowance(relocation.account.address, tokenBridge.address);
      if (allowance.lt(BigNumber.from(ethers.constants.MaxUint256))) {
        await proveTx(tokenMock.connect(relocation.account).approve(
          tokenBridge.address,
          ethers.constants.MaxUint256
        ));
      }
    }
  }

  async function registerRelocations(relocations: TestTokenRelocation[]) {
    for (const relocation of relocations) {
      await proveTx(
        tokenBridge.connect(relocation.account).registerRelocation(relocation.chainId, relocation.amount)
      );
      relocation.registered = true;
    }
  }

  async function pauseTokenBridge() {
    await proveTx(tokenBridge.setPauser(deployer.address));
    await proveTx(tokenBridge.pause());
  }

  async function addAccountToBridgeWhitelist(account: SignerWithAddress) {
    await proveTx(tokenBridge.setWhitelistEnabled(true));
    await proveTx(tokenBridge.setWhitelistAdmin(deployer.address));
    await proveTx(tokenBridge.updateWhitelister(deployer.address, true));
    await proveTx(tokenBridge.whitelist(account.address));
  }

  async function cancelRelocations(relocations: TestTokenRelocation[]) {
    for (const relocation of relocations) {
      await proveTx(
        tokenBridge.connect(relocation.account).cancelRelocation(relocation.chainId, relocation.nonce)
      );
      relocation.canceled = true;
    }
  }

  function defineExpectedChainIds(relocations: TestTokenRelocation[]): Set<number> {
    const expectedChainIds: Set<number> = new Set<number>();

    relocations.forEach((relocation: TestTokenRelocation) => {
      expectedChainIds.add(relocation.chainId);
    });

    return expectedChainIds;
  }

  function defineExpectedBridgeStateForSingleChainId(
    chainId: number,
    relocations: TestTokenRelocation[]
  ): BridgeStateForChainId {
    const expectedBridgeState: BridgeStateForChainId = {
      registeredRelocationCount: 0,
      processedRelocationCount: 0,
      pendingRelocationCount: 0,
      firstNonce: 0,
      nonceCount: 1,
      accounts: [ethers.constants.AddressZero],
      amounts: [BigNumber.from(0)],
      cancellationFlags: [false],
    };
    expectedBridgeState.registeredRelocationCount = countNumberArrayTotal(
      relocations.map(
        function (relocation: TestTokenRelocation): number {
          return !!relocation.registered && relocation.chainId == chainId ? 1 : 0;
        }
      )
    );

    expectedBridgeState.processedRelocationCount = countNumberArrayTotal(
      relocations.map(
        function (relocation: TestTokenRelocation): number {
          return !!relocation.processed && relocation.chainId == chainId ? 1 : 0;
        }
      )
    );

    relocations.forEach((relocation: TestTokenRelocation) => {
      if (!!relocation.registered && relocation.chainId == chainId) {
        expectedBridgeState.accounts[relocation.nonce] = relocation.account.address;
        expectedBridgeState.amounts[relocation.nonce] = BigNumber.from(relocation.amount);
        expectedBridgeState.cancellationFlags[relocation.nonce] = !!relocation.canceled;
      }
    });
    expectedBridgeState.accounts[expectedBridgeState.accounts.length] = ethers.constants.AddressZero;
    expectedBridgeState.amounts[expectedBridgeState.amounts.length] = BigNumber.from(0);
    expectedBridgeState.cancellationFlags[expectedBridgeState.cancellationFlags.length] = false;
    expectedBridgeState.nonceCount = expectedBridgeState.accounts.length;

    expectedBridgeState.pendingRelocationCount =
      expectedBridgeState.registeredRelocationCount - expectedBridgeState.processedRelocationCount;

    return expectedBridgeState;
  }

  function defineExpectedBridgeStatesPerChainId(
    relocations: TestTokenRelocation[]
  ): Map<number, BridgeStateForChainId> {
    const expectedChainIds: Set<number> = defineExpectedChainIds(relocations);
    const expectedStatesPerChainId: Map<number, BridgeStateForChainId> = new Map<number, BridgeStateForChainId>();

    expectedChainIds.forEach((chainId: number) => {
      const expectedBridgeState: BridgeStateForChainId =
        defineExpectedBridgeStateForSingleChainId(chainId, relocations);
      expectedStatesPerChainId.set(chainId, expectedBridgeState);
    });

    return expectedStatesPerChainId;
  }

  function defineExpectedBridgeBalance(relocations: TestTokenRelocation[]): number {
    return countNumberArrayTotal(
      relocations.map(function (relocation: TestTokenRelocation): number {
          return (!!relocation.registered && !relocation.processed && !relocation.canceled) ? relocation.amount : 0;
        }
      )
    );
  }

  async function checkBridgeStatesPerChainId(expectedBridgeStatesPerChainId: Map<number, BridgeStateForChainId>) {
    for (const expectedChainId of expectedBridgeStatesPerChainId.keys()) {
      const expectedBridgeState: BridgeStateForChainId | undefined =
        expectedBridgeStatesPerChainId.get(expectedChainId);
      if (!expectedBridgeState) {
        continue;
      }
      expect(await tokenBridge.pendingRelocationCounters(expectedChainId)).to.equal(
        expectedBridgeState.pendingRelocationCount,
        `Wrong pending relocation count, chainId=${expectedChainId}`
      );
      expect(await tokenBridge.lastConfirmedRelocationNonces(expectedChainId)).to.equal(
        expectedBridgeState.processedRelocationCount,
        `Wrong registered relocation count, chainId=${expectedChainId}`
      );
      const actualRelocationData = await tokenBridge.getRelocationsData(
        expectedChainId,
        expectedBridgeState.firstNonce,
        expectedBridgeState.nonceCount
      );
      expect(actualRelocationData.accounts).to.deep.equal(
        expectedBridgeState.accounts,
        `Wrong the accounts array returned by the 'getRelocationsData()' function, chainId=${expectedChainId}`
      );
      expect(actualRelocationData.amounts).to.deep.equal(
        expectedBridgeState.amounts,
        `Wrong the amounts array returned by the 'getRelocationsData()' function, chainId=${expectedChainId}`
      );
      expect(actualRelocationData.cancellationFlags).to.deep.equal(
        expectedBridgeState.cancellationFlags,
        `Wrong the cancellationFlags array returned by `
        + `the 'getRelocationsData()' function, chainId=${expectedChainId}`
      );
    }
  }

  async function checkRelocationStructures(relocations: TestTokenRelocation[]) {
    for (let i = 0; i < relocations.length; ++i) {
      const relocation = relocations[i];
      if (relocation.registered) {
        const actualRelocation = await tokenBridge.relocations(relocation.chainId, relocation.nonce);
        checkEquality(actualRelocation, relocation, i);
      }
    }
  }

  async function checkBridgeState(relocations: TestTokenRelocation[]): Promise<void> {
    const expectedBridgeStatesPerChainId: Map<number, BridgeStateForChainId> =
      defineExpectedBridgeStatesPerChainId(relocations);
    const expectedBridgeBalance: number = defineExpectedBridgeBalance(relocations);

    await checkBridgeStatesPerChainId(expectedBridgeStatesPerChainId);
    await checkRelocationStructures(relocations);
    expect(await tokenMock.balanceOf(tokenBridge.address)).to.equal(expectedBridgeBalance);
  }

  beforeEach(async () => {
    // Deploy BRLC
    const TokenMock: ContractFactory = await ethers.getContractFactory("ERC20UpgradeableMock");
    tokenMock = await upgrades.deployProxy(TokenMock, ["BRL Coin", "BRLC", 6]);
    await tokenMock.deployed();

    // Deploy TokenBridge
    const TokenBridge: ContractFactory = await ethers.getContractFactory("TokenBridgeUpgradeable");
    tokenBridge = await upgrades.deployProxy(TokenBridge, [tokenMock.address]);
    await tokenBridge.deployed();

    // Set the bridge in the token
    await proveTx(tokenMock.setBridge(tokenBridge.address));

    // Get user accounts
    [deployer, user1, user2] = await ethers.getSigners();
  });

  it("The initialize function can't be called more than once", async () => {
    await expect(
      tokenBridge.initialize(tokenMock.address)
    ).to.be.revertedWith(REVERT_MESSAGE_IF_CONTRACT_IS_ALREADY_INITIALIZED);
  });

  it("The initialize function is reverted if token does not support bridge operations", async () => {
    const TokenBridge: ContractFactory = await ethers.getContractFactory("TokenBridgeUpgradeable");
    const otherTokenBridge: Contract = await TokenBridge.deploy();
    await otherTokenBridge.deployed();
    const fakeTokenAddress: string = deployer.address;
    await expect(
      otherTokenBridge.initialize(fakeTokenAddress)
    ).to.be.revertedWith(REVERT_MESSAGE_IF_TOKEN_DOES_NOT_SUPPORT_BRIDGE_OPERATIONS);
  });

  describe("Configuration", async () => {
    describe("Function 'setSupportedRelocation()'", async () => {
      const chainId = 123;

      it("Is reverted if is called not by the owner", async () => {
        await expect(
          tokenBridge.connect(user1).setSupportedRelocation(chainId, true)
        ).to.be.revertedWith(REVERT_MESSAGE_IF_CALLER_IS_NOT_OWNER);
      });

      it("Emits the correct events and updates the configuration correctly", async () => {
        const relocationSupportingFlagOld = await tokenBridge.relocationSupportingFlags(chainId);
        expect(relocationSupportingFlagOld).to.equal(false);
        await expect(
          tokenBridge.setSupportedRelocation(chainId, true)
        ).to.emit(
          tokenBridge,
          "SetSupportedRelocation"
        ).withArgs(chainId, true);
        const relocationSupportingFlagNew = await tokenBridge.relocationSupportingFlags(chainId);
        expect(relocationSupportingFlagNew).to.equal(true);

        await expect(
          tokenBridge.setSupportedRelocation(chainId, false)
        ).to.emit(
          tokenBridge,
          "SetSupportedRelocation"
        ).withArgs(chainId, false);
        const relocationSupportingFlagNew2 = await tokenBridge.relocationSupportingFlags(chainId);
        expect(relocationSupportingFlagNew2).to.equal(false);
      });
    });

    describe("Function 'setSupportedArrival()'", async () => {
      const chainId = 123;

      it("Is reverted if is called not by the owner", async () => {
        await expect(
          tokenBridge.connect(user1).setSupportedArrival(chainId, true)
        ).to.be.revertedWith(REVERT_MESSAGE_IF_CALLER_IS_NOT_OWNER);
      });

      it("Emits the correct events and updates the configuration correctly", async () => {
        const arrivalSupportingFlagOld = await tokenBridge.arrivalSupportingFlags(chainId);
        expect(arrivalSupportingFlagOld).to.equal(false);
        await expect(
          tokenBridge.setSupportedArrival(chainId, true)
        ).to.emit(
          tokenBridge,
          "SetSupportedArrival"
        ).withArgs(chainId, true);
        const arrivalSupportingFlagNew = await tokenBridge.arrivalSupportingFlags(chainId);
        expect(arrivalSupportingFlagNew).to.equal(true);

        await expect(
          tokenBridge.setSupportedArrival(chainId, false)
        ).to.emit(
          tokenBridge,
          "SetSupportedArrival"
        ).withArgs(chainId, false);
        const arrivalSupportingFlagNew2 = await tokenBridge.arrivalSupportingFlags(chainId);
        expect(arrivalSupportingFlagNew2).to.equal(false);
      });
    });
  });

  describe("Interactions related to relocations", async () => {
    describe("Function 'registerRelocation()'", async () => {
      let relocation: TestTokenRelocation;

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
        await pauseTokenBridge();
        await expect(
          tokenBridge.connect(relocation.account).registerRelocation(relocation.chainId, relocation.amount)
        ).to.be.revertedWith(REVERT_MESSAGE_IF_CONTRACT_IS_PAUSED);
      });

      it("Is reverted if the token amount of the relocation is zero", async () => {
        await expect(
          tokenBridge.connect(relocation.account).registerRelocation(relocation.chainId, 0)
        ).to.be.revertedWith(REVERT_MESSAGE_IF_RELOCATION_AMOUNT_IS_ZERO);
      });

      it("Is reverted if the target chain is unsupported for relocations", async () => {
        await expect(
          tokenBridge.connect(relocation.account).registerRelocation(relocation.chainId + 1, relocation.amount)
        ).to.be.revertedWith(REVERT_MESSAGE_IF_RELOCATION_CHAIN_IF_NOT_SUPPORTED);
      });

      it("Is reverted if the token does not support the bridge", async () => {
        await proveTx(tokenMock.setBridge(deployer.address));
        await expect(
          tokenBridge.connect(relocation.account).registerRelocation(relocation.chainId, relocation.amount)
        ).to.be.revertedWith(REVERT_MESSAGE_IF_BRIDGE_IS_UNSUPPORTED);
      });

      it("Is reverted if the user has not enough token balance", async () => {
        const excessTokenAmount: number = relocation.amount + 1;
        await expect(
          tokenBridge.connect(relocation.account).registerRelocation(relocation.chainId, excessTokenAmount)
        ).to.be.revertedWith(REVERT_MESSAGE_IF_TOKEN_TRANSFER_AMOUNT_EXCEEDS_BALANCE);
      });

      it("Transfers tokens as expected, emits the correct event, changes the state properly", async () => {
        await checkBridgeState([relocation]);
        await expect(
          tokenBridge.connect(relocation.account).registerRelocation(relocation.chainId, relocation.amount)
        ).to.changeTokenBalances(
          tokenMock,
          [tokenBridge, relocation.amount],
          [+relocation.amount, -relocation.amount]
        ).and.to.emit(
          tokenBridge,
          "RegisterRelocation"
        ).withArgs(
          relocation.chainId,
          relocation.account.address,
          relocation.amount,
          relocation.nonce
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
        await pauseTokenBridge();
        await expect(
          tokenBridge.connect(relocation.account).cancelRelocation(relocation.chainId, relocation.nonce)
        ).to.be.revertedWith(REVERT_MESSAGE_IF_CONTRACT_IS_PAUSED);
      });

      it("Is reverted if the caller did not request the relocation", async () => {
        await expect(
          tokenBridge.connect(user2).cancelRelocation(relocation.chainId, relocation.nonce)
        ).to.be.revertedWith(REVERT_MESSAGE_IF_TRANSACTION_SENDER_IS_NOT_AUTHORIZED);
      });

      it("Is reverted if a relocation with the nonce has already processed", async () => {
        await expect(
          tokenBridge.connect(relocation.account).cancelRelocation(relocation.chainId, relocation.nonce - 1)
        ).to.be.revertedWith(REVERT_MESSAGE_IF_TRANSACTION_SENDER_IS_NOT_AUTHORIZED);
      });

      it("Is reverted if a relocation with the nonce does not exists", async () => {
        await expect(
          tokenBridge.connect(relocation.account).cancelRelocation(relocation.chainId, relocation.nonce + 1)
        ).to.be.revertedWith(REVERT_MESSAGE_IF_TRANSACTION_SENDER_IS_NOT_AUTHORIZED);
      });

      it("Transfers the tokens as expected, emits the correct event, changes the state properly", async () => {
        await checkBridgeState([relocation]);
        await expect(
          tokenBridge.connect(relocation.account).cancelRelocation(relocation.chainId, relocation.nonce)
        ).to.changeTokenBalances(
          tokenMock,
          [tokenBridge, relocation.account],
          [-relocation.amount, +relocation.amount]
        ).and.to.emit(
          tokenBridge,
          "CancelRelocation"
        ).withArgs(
          relocation.chainId,
          relocation.account.address,
          relocation.amount,
          relocation.nonce
        );
        relocation.canceled = true;
        await checkBridgeState([relocation]);
      });
    });

    describe("Function 'cancelRelocations()'", async () => {
      const chainId = 12;

      let relocations: TestTokenRelocation[];
      let relocator: SignerWithAddress;
      let relocationNonces: number[];

      beforeEach(async () => {
        relocations = [
          {
            chainId: chainId,
            account: user1,
            amount: 34,
            nonce: 1,
          },
          {
            chainId: chainId,
            account: user2,
            amount: 56,
            nonce: 2,
          },
        ];
        relocationNonces = relocations.map((relocation: TestTokenRelocation) => relocation.nonce);
        relocator = user2;
        await setUpContractsForRelocations(relocations);
        await registerRelocations(relocations);
        await addAccountToBridgeWhitelist(relocator);
      });

      it("Is reverted if the contract is paused", async () => {
        await pauseTokenBridge();
        await expect(
          tokenBridge.connect(relocator).cancelRelocations(chainId, relocationNonces)
        ).to.be.revertedWith(REVERT_MESSAGE_IF_CONTRACT_IS_PAUSED);
      });

      it("Is reverted if the caller is not whitelisted", async () => {
        await expect(
          tokenBridge.connect(deployer).cancelRelocations(chainId, relocationNonces)
        ).to.be.revertedWith(REVERT_MESSAGE_IF_ACCOUNT_IS_NOT_WHITELISTED);
      });

      it("Is reverted if the input array of nonces is empty", async () => {
        await expect(
          tokenBridge.connect(relocator).cancelRelocations(chainId, [])
        ).to.be.revertedWith(REVERT_MESSAGE_IF_RELOCATION_NONCES_ARRAY_IS_EMPTY);
      });

      it("Is reverted if some input nonce is less than the lowest nonce of pending relocations", async () => {
        await expect(tokenBridge.connect(relocator).cancelRelocations(
          chainId,
          [
            Math.min(...relocationNonces),
            Math.min(...relocationNonces) - 1,
          ]
        )).to.be.revertedWith(REVERT_MESSAGE_IF_RELOCATION_WITH_THE_NONCE_ALREADY_PROCESSED);
      });

      it("Is reverted if some input nonce is greater than the highest nonce of pending relocations", async () => {
        await expect(tokenBridge.connect(relocator).cancelRelocations(
          chainId,
          [
            Math.max(...relocationNonces),
            Math.max(...relocationNonces) + 1
          ]
        )).to.be.revertedWith(REVERT_MESSAGE_IF_RELOCATION_WITH_THE_NONCE_DOES_NOT_EXIST);
      });

      it("Is reverted if a relocation with some nonce was already canceled", async () => {
        await cancelRelocations([relocations[1]]);
        await expect(
          tokenBridge.connect(relocator).cancelRelocations(chainId, relocationNonces)
        ).to.be.revertedWith(REVERT_MESSAGE_IF_RELOCATION_WAS_ALREADY_CANCELED);
      });

      it("Transfers the tokens as expected, emits the correct events, changes the state properly", async () => {
        await checkBridgeState(relocations);

        const relocationAmounts: number[] = relocations.map((relocation: TestTokenRelocation) => relocation.amount);
        const relocationAccounts: SignerWithAddress[] =
          relocations.map((relocation: TestTokenRelocation) => relocation.account);
        const relocationAmountTotal: number = countNumberArrayTotal(relocationAmounts);

        await expect(tokenBridge.connect(relocator).cancelRelocations(chainId, relocationNonces))
          .to.changeTokenBalances(
            tokenMock,
            [tokenBridge, ...relocationAccounts],
            [-(relocationAmountTotal), ...relocationAmounts]
          ).and.to.emit(
            tokenBridge,
            "CancelRelocation"
          ).withArgs(
            chainId,
            relocations[0].account.address,
            relocations[0].amount,
            relocations[0].nonce
          ).and.to.emit(
            tokenBridge,
            "CancelRelocation"
          ).withArgs(
            chainId,
            relocations[1].account.address,
            relocations[1].amount,
            relocations[1].nonce
          );
        relocations.forEach((relocation: TestTokenRelocation) => relocation.canceled = true);
        await checkBridgeState(relocations);
      });
    });

    describe("Function 'relocate()'", async () => {
      const relocationCount = 1;

      let relocation: TestTokenRelocation;
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
        await registerRelocations([relocation]);
        await addAccountToBridgeWhitelist(relocator);
      });

      it("Is reverted if the contract is paused", async () => {
        await pauseTokenBridge();
        await expect(
          tokenBridge.connect(relocator).relocate(relocation.chainId, relocationCount)
        ).to.be.revertedWith(REVERT_MESSAGE_IF_CONTRACT_IS_PAUSED);
      });

      it("Is reverted if the caller is not whitelisted", async () => {
        await expect(
          tokenBridge.connect(deployer).relocate(relocation.chainId, relocationCount)
        ).to.be.revertedWith(REVERT_MESSAGE_IF_ACCOUNT_IS_NOT_WHITELISTED);
      });

      it("Is reverted if the relocation count is zero", async () => {
        await expect(
          tokenBridge.connect(relocator).relocate(relocation.chainId, 0)
        ).to.be.revertedWith(REVERT_MESSAGE_IF_RELOCATION_COUNT_IS_ZERO);
      });

      it("Is reverted if the relocation count exceeds the number of pending relocations", async () => {
        await expect(
          tokenBridge.connect(relocator).relocate(relocation.chainId, relocationCount + 1)
        ).to.be.revertedWith(REVERT_MESSAGE_IF_RELOCATION_COUNT_EXCEEDS_NUMBER_OF_PENDING_RELOCATIONS);
      });

      it("Is reverted if the token does not support the bridge", async () => {
        await proveTx(tokenMock.setBridge(deployer.address));
        await expect(
          tokenBridge.connect(relocator).relocate(relocation.chainId, relocationCount)
        ).to.be.revertedWith(REVERT_MESSAGE_IF_BRIDGE_IS_UNSUPPORTED);
      });

      it("Is reverted if burning of tokens had failed", async () => {
        await proveTx(tokenMock.disableBurningForBridging());
        await expect(
          tokenBridge.connect(relocator).relocate(relocation.chainId, relocationCount)
        ).to.be.revertedWith(REVERT_MESSAGE_IF_BURNING_OF_TOKENS_FAILED);
      });

      it("Burns no tokens, emits no events if the relocation was canceled", async () => {
        await cancelRelocations([relocation]);
        await checkBridgeState([relocation]);
        await expect(
          tokenBridge.connect(relocator).relocate(relocation.chainId, relocationCount)
        ).to.changeTokenBalances(
          tokenMock,
          [tokenBridge],
          [0]
        ).and.not.to.emit(
          tokenBridge,
          "ConfirmRelocation"
        );
        markRelocationsAsProcessed([relocation]);
        await checkBridgeState([relocation]);
      });

      it("Burns tokens as expected, emits the correct event, changes the state properly", async () => {
        await expect(
          tokenBridge.connect(relocator).relocate(relocation.chainId, relocationCount)
        ).to.changeTokenBalances(
          tokenMock,
          [tokenBridge, user1, user2],
          [-relocation.amount, 0, 0]
        ).and.to.emit(
          tokenBridge,
          "ConfirmRelocation"
        ).withArgs(
          relocation.chainId,
          relocation.account.address,
          relocation.amount,
          relocation.nonce
        );
        markRelocationsAsProcessed([relocation]);
        await checkBridgeState([relocation]);
      });
    });

    describe("Complex scenario for a single chain", async () => {
      const chainId = 123;

      let relocations: TestTokenRelocation[];
      let relocator: SignerWithAddress;

      beforeEach(async () => {
        relocations = [
          {
            chainId: chainId,
            account: user1,
            amount: 234,
            nonce: 1,
          },
          {
            chainId: chainId,
            account: user1,
            amount: 345,
            nonce: 2,
          },
          {
            chainId: chainId,
            account: user2,
            amount: 456,
            nonce: 3,
          },
          {
            chainId: chainId,
            account: deployer,
            amount: 567,
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
        await proveTx(tokenBridge.connect(relocator).relocate(chainId, 1));
        markRelocationsAsProcessed([relocations[0]]);
        await checkBridgeState(relocations);

        // Try to cancel already processed relocation
        await expect(
          tokenBridge.connect(relocations[0].account).cancelRelocation(chainId, relocations[0].nonce)
        ).to.be.revertedWith(REVERT_MESSAGE_IF_RELOCATION_WITH_THE_NONCE_ALREADY_PROCESSED);

        // Try to cancel a relocation of another user
        await expect(
          tokenBridge.connect(relocations[1].account).cancelRelocation(chainId, relocations[2].nonce)
        ).to.be.revertedWith(REVERT_MESSAGE_IF_TRANSACTION_SENDER_IS_NOT_AUTHORIZED);

        // Try to cancel several relocations including the processed one
        await expect(
          tokenBridge.connect(relocator).cancelRelocations(chainId, [
            relocations[2].nonce,
            relocations[1].nonce,
            relocations[0].nonce,
          ])
        ).to.be.revertedWith(REVERT_MESSAGE_IF_RELOCATION_WITH_THE_NONCE_ALREADY_PROCESSED);

        // Try to cancel several relocations including one that is out of the pending range
        await expect(
          tokenBridge.connect(relocator).cancelRelocations(chainId, [
            relocations[3].nonce,
            relocations[2].nonce,
            relocations[1].nonce,
          ])
        ).to.be.revertedWith(REVERT_MESSAGE_IF_RELOCATION_WITH_THE_NONCE_DOES_NOT_EXIST);

        //Check that state of the bridge has not changed
        await checkBridgeState(relocations);

        // Register another relocation
        await registerRelocations([relocations[3]]);
        await checkBridgeState(relocations);

        // Cancel two last relocations
        await proveTx(tokenBridge.connect(relocator).cancelRelocations(
          chainId,
          [relocations[3].nonce, relocations[2].nonce]
        ));
        [relocations[3], relocations[2]].forEach((relocation: TestTokenRelocation) => relocation.canceled = true);
        await checkBridgeState(relocations);

        // Process all the pending relocations
        await proveTx(tokenBridge.connect(relocator).relocate(chainId, 3));
        markRelocationsAsProcessed(relocations);
        await checkBridgeState(relocations);
      });
    });

    describe("Complex scenario for several chains", async () => {
      const chainId1 = 123;
      const chainId2 = 234;

      let relocations: TestTokenRelocation[];
      let relocator: SignerWithAddress;
      let relocationCountForChain1: number;
      let relocationCountForChain2: number;

      beforeEach(async () => {
        relocations = [
          {
            chainId: chainId1,
            account: user1,
            amount: 345,
            nonce: 1,
          },
          {
            chainId: chainId1,
            account: user1,
            amount: 456,
            nonce: 2,
          },
          {
            chainId: chainId2,
            account: user2,
            amount: 567,
            nonce: 1,
          },
          {
            chainId: chainId2,
            account: deployer,
            amount: 678,
            nonce: 2,
          },
        ];
        relocator = user2;
        relocationCountForChain1 = countRelocationsForChainId(relocations, chainId1);
        relocationCountForChain2 = countRelocationsForChainId(relocations, chainId2);
        await setUpContractsForRelocations(relocations);
        await addAccountToBridgeWhitelist(relocator);
      });

      it("Executes as expected", async () => {
        // Register all relocations
        await registerRelocations(relocations);
        await checkBridgeState(relocations);

        // Cancel some relocations
        await cancelRelocations([relocations[1], relocations[2]]);
        await checkBridgeState(relocations);

        // Process all the pending relocations in all the chains
        await proveTx(tokenBridge.connect(relocator).relocate(chainId1, relocationCountForChain1));
        await proveTx(tokenBridge.connect(relocator).relocate(chainId2, relocationCountForChain2));
        markRelocationsAsProcessed(relocations);
        await checkBridgeState(relocations);
      });
    });
  });

  describe("Interactions related to accommodations", async () => {
    describe("Function 'accommodate()'", async () => {
      const chainId = 123;
      const firstRelocationNonce = 1;

      let relocations: TestTokenRelocation[];
      let accommodator: SignerWithAddress;
      let relocationAccountAddresses: string[];
      let relocationAmounts: number[];
      let relocationCancellationFlags: boolean[];
      let expectedMintingAmounts: number[];

      beforeEach(async () => {
        relocations = [
          {
            chainId: chainId,
            account: user1,
            amount: 456,
            nonce: firstRelocationNonce,
            canceled: true,
          },
          {
            chainId: chainId,
            account: user2,
            amount: 789,
            nonce: firstRelocationNonce + 1,
          },
        ];
        accommodator = user2;
        relocationAccountAddresses = relocations.map((relocation: TestTokenRelocation) => relocation.account.address);
        relocationAmounts = relocations.map((relocation: TestTokenRelocation) => relocation.amount);
        relocationCancellationFlags = relocations.map((relocation: TestTokenRelocation) => !!relocation.canceled);
        expectedMintingAmounts = relocations.map(
          (relocation: TestTokenRelocation) => !relocation.canceled ? relocation.amount : 0
        );

        await proveTx(tokenBridge.setSupportedArrival(chainId, true));
        await addAccountToBridgeWhitelist(accommodator);
      });

      it("Is reverted if the contract is paused", async () => {
        await pauseTokenBridge();
        await expect(
          tokenBridge.connect(accommodator).accommodate(
            chainId,
            firstRelocationNonce,
            relocationAccountAddresses,
            relocationAmounts,
            relocationCancellationFlags
          )
        ).to.be.revertedWith(REVERT_MESSAGE_IF_CONTRACT_IS_PAUSED);
      });

      it("Is reverted if the caller is not whitelisted", async () => {
        await expect(
          tokenBridge.connect(deployer).accommodate(
            chainId,
            firstRelocationNonce,
            relocationAccountAddresses,
            relocationAmounts,
            relocationCancellationFlags
          )
        ).to.be.revertedWith(REVERT_MESSAGE_IF_ACCOUNT_IS_NOT_WHITELISTED);
      });

      it("Is reverted if the chain is not supported for arrivals", async () => {
        await expect(
          tokenBridge.connect(accommodator).accommodate(
            chainId + 1,
            firstRelocationNonce,
            relocationAccountAddresses,
            relocationAmounts,
            relocationCancellationFlags
          )
        ).to.be.revertedWith(REVERT_MESSAGE_IF_ARRIVAL_CHAIN_IS_NOT_SUPPORTED);
      });

      it("Is reverted if the first relocation nonce is zero", async () => {
        await expect(
          tokenBridge.connect(accommodator).accommodate(
            chainId,
            0,
            relocationAccountAddresses,
            relocationAmounts,
            relocationCancellationFlags
          )
        ).to.be.revertedWith(REVERT_MESSAGE_IF_ARRIVAL_FIRST_NONCE_IS_ZERO);
      });

      it("Is reverted if the first relocation nonce does not equal the last arrival nonce +1", async () => {
        await expect(
          tokenBridge.connect(accommodator).accommodate(
            chainId,
            firstRelocationNonce + 1,
            relocationAccountAddresses,
            relocationAmounts,
            relocationCancellationFlags
          )
        ).to.be.revertedWith(REVERT_MESSAGE_IF_RELOCATION_NONCE_MISMATCH);
      });

      it("Is reverted if the accounts array has a different length than other input arrays", async () => {
        relocationAccountAddresses.pop();
        await expect(
          tokenBridge.connect(accommodator).accommodate(
            chainId,
            firstRelocationNonce,
            relocationAccountAddresses,
            relocationAmounts,
            relocationCancellationFlags
          )
        ).to.be.revertedWith(REVERT_MESSAGE_IF_INPUT_ARRAY_ERROR);
      });

      it("Is reverted if the amounts array has a different length than other input arrays", async () => {
        relocationAmounts.pop();
        await expect(
          tokenBridge.connect(accommodator).accommodate(
            chainId,
            firstRelocationNonce,
            relocationAccountAddresses,
            relocationAmounts,
            relocationCancellationFlags
          )
        ).to.be.revertedWith(REVERT_MESSAGE_IF_INPUT_ARRAY_ERROR);
      });

      it("Is reverted if the cancellation flags array has a different length than other input arrays", async () => {
        relocationCancellationFlags.pop();
        await expect(
          tokenBridge.connect(accommodator).accommodate(
            chainId,
            firstRelocationNonce,
            relocationAccountAddresses,
            relocationAmounts,
            relocationCancellationFlags
          )
        ).to.be.revertedWith(REVERT_MESSAGE_IF_INPUT_ARRAY_ERROR);
      });

      it("Is reverted if the token does not support the bridge", async () => {
        await proveTx(tokenMock.setBridge(deployer.address));
        await expect(
          tokenBridge.connect(accommodator).accommodate(
            chainId,
            firstRelocationNonce,
            relocationAccountAddresses,
            relocationAmounts,
            relocationCancellationFlags
          )
        ).to.be.revertedWith(REVERT_MESSAGE_IF_BRIDGE_IS_UNSUPPORTED);
      });

      it("Is reverted if one of the input accounts has zero address", async () => {
        relocationAccountAddresses[1] = ethers.constants.AddressZero;
        await expect(
          tokenBridge.connect(accommodator).accommodate(
            chainId,
            firstRelocationNonce,
            relocationAccountAddresses,
            relocationAmounts,
            relocationCancellationFlags
          )
        ).to.be.revertedWith(REVERT_MESSAGE_IF_ACCOUNT_IS_ZERO_ADDRESS);
      });

      it("Is reverted if one of the input amounts is zero", async () => {
        relocationAmounts[1] = 0;
        await expect(
          tokenBridge.connect(accommodator).accommodate(
            chainId,
            firstRelocationNonce,
            relocationAccountAddresses,
            relocationAmounts,
            relocationCancellationFlags
          )
        ).to.be.revertedWith(REVERT_MESSAGE_IF_AMOUNT_MUST_BE_GREATER_THAN_ZERO);
      });

      it("Is reverted if minting of tokens had failed", async () => {
        await proveTx(tokenMock.disableMintingForBridging());
        await expect(
          tokenBridge.connect(accommodator).accommodate(
            chainId,
            firstRelocationNonce,
            relocationAccountAddresses,
            relocationAmounts,
            relocationCancellationFlags
          )
        ).to.be.revertedWith(REVERT_MESSAGE_IF_MINTING_OF_TOKENS_FAILED);
      });

      it("Mints tokens as expected, emits the correct events, changes the state properly", async () => {
        await expect(
          tokenBridge.connect(accommodator).accommodate(
            chainId,
            firstRelocationNonce,
            relocationAccountAddresses,
            relocationAmounts,
            relocationCancellationFlags
          )
        ).to.changeTokenBalances(
          tokenMock,
          [tokenBridge, ...relocationAccountAddresses],
          [0, ...expectedMintingAmounts]
        ).and.to.emit(
          tokenBridge,
          "ConfirmArrival"
        ).withArgs(
          chainId,
          relocations[1].account.address,
          relocations[1].amount,
          relocations[1].nonce,
        );
        expect(await tokenBridge.arrivalNonces(chainId)).to.equal(relocations[relocations.length - 1].nonce);
      });
    });
  });
});
