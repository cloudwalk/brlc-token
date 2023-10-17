import { ethers, network, upgrades } from "hardhat";
import { expect } from "chai";
import { Contract, ContractFactory } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";

async function setUpFixture(func: any) {
    if (network.name === "hardhat") {
        return loadFixture(func);
    } else {
        return func();
    }
}

describe("Contract 'BRLCTokenBridgeable'", async () => {
    const TOKEN_NAME = "BRL Coin";
    const TOKEN_SYMBOL = "BRLC";
    const TOKEN_DECIMALS = 6;

    const REVERT_MESSAGE_INITIALIZABLE_CONTRACT_IS_ALREADY_INITIALIZED =
        "Initializable: contract is already initialized";

    let tokenFactory: ContractFactory;
    let deployer: SignerWithAddress;
    let bridge: SignerWithAddress;

    before(async () => {
        [deployer, bridge] = await ethers.getSigners();
        tokenFactory = await ethers.getContractFactory("BRLCTokenBridgeable");
    });

    async function deployToken(): Promise<{ token: Contract }> {
        const token: Contract = await upgrades.deployProxy(tokenFactory, [TOKEN_NAME, TOKEN_SYMBOL, bridge.address]);
        await token.deployed();
        return { token };
    }

    describe("Function 'initialize()'", async () => {
        it("Configures the contract as expected", async () => {
            const { token } = await setUpFixture(deployToken);
            expect(await token.name()).to.equal(TOKEN_NAME);
            expect(await token.symbol()).to.equal(TOKEN_SYMBOL);
            expect(await token.decimals()).to.equal(TOKEN_DECIMALS);
            expect(await token.owner()).to.equal(deployer.address);
            expect(await token.pauser()).to.equal(ethers.constants.AddressZero);
            expect(await token.rescuer()).to.equal(ethers.constants.AddressZero);
            expect(await token.mainBlocklister()).to.equal(ethers.constants.AddressZero);
            expect(await token.isBridgeSupported(bridge.address)).to.equal(true);
            expect(await token.isIERC20Bridgeable()).to.equal(true);
            expect(await token.bridge()).to.equal(bridge.address);
        });

        it("Is reverted if called for the second time", async () => {
            const { token } = await setUpFixture(deployToken);
            await expect(token.initialize(TOKEN_NAME, TOKEN_SYMBOL, bridge.address)).to.be.revertedWith(
                REVERT_MESSAGE_INITIALIZABLE_CONTRACT_IS_ALREADY_INITIALIZED
            );
        });

        it("Is reverted if the contract implementation is called even for the first time", async () => {
            const tokenImplementation: Contract = await tokenFactory.deploy();
            await tokenImplementation.deployed();
            await expect(tokenImplementation.initialize(TOKEN_NAME, TOKEN_SYMBOL, bridge.address)).to.be.revertedWith(
                REVERT_MESSAGE_INITIALIZABLE_CONTRACT_IS_ALREADY_INITIALIZED
            );
        });
    });

    describe("Function 'isBRLCoin'", async () => {
        it("Returns true", async () => {
            const { token } = await setUpFixture(deployToken);
            expect(await token.isBRLCoin()).to.eq(true);
        });
    });
});
