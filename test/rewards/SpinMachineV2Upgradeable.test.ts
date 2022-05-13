import { ethers, upgrades } from "hardhat";
import { expect } from "chai";
import { Contract, ContractFactory } from "ethers";
import { proveTx } from "../../test-utils/eth";

describe("Contract 'SpinMachineV2Upgradeable'", async () => {
  const REVERT_MESSAGE_IF_CONTRACT_IS_ALREADY_INITIALIZED = 'Initializable: contract is already initialized';

  let spinMachine: Contract;
  let brlcMock: Contract;

  beforeEach(async () => {
    // Deploy BRLC
    const BRLCMock: ContractFactory = await ethers.getContractFactory("ERC20UpgradeableMock");
    brlcMock = await upgrades.deployProxy(BRLCMock, ["BRL Coin", "BRLC", 6]);
    await brlcMock.deployed();

    // Deploy RandomProvider
    const OnchainRandomProvider: ContractFactory = await ethers.getContractFactory(
      "OnchainRandomProvider"
    );
    const onchainRandomProvider: Contract = await OnchainRandomProvider.deploy();
    await onchainRandomProvider.deployed();

    // Deploy SpinMachine
    const SpinMachine: ContractFactory = await ethers.getContractFactory("SpinMachineV2Upgradeable");
    spinMachine = await upgrades.deployProxy(SpinMachine, [brlcMock.address]);
    await spinMachine.deployed();
    await proveTx(spinMachine.setRandomProvider(onchainRandomProvider.address));
  });

  it("The initialize function can't be called more than once", async () => {
    await expect(spinMachine.initialize(brlcMock.address))
      .to.be.revertedWith(REVERT_MESSAGE_IF_CONTRACT_IS_ALREADY_INITIALIZED);
  });

  //All other checks are in the test files for the ancestor contracts
});
