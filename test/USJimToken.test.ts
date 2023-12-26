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

describe("Contract 'USJimToken'", async () => {
    const TOKEN_NAME = "USJim Coin";
    const TOKEN_SYMBOL = "USJIM";
    const TOKEN_DECIMALS = 6;

    const REVERT_MESSAGE_INITIALIZABLE_CONTRACT_IS_ALREADY_INITIALIZED =
        "Initializable: contract is already initialized";

    let tokenFactory: ContractFactory;
    let deployer: SignerWithAddress;

    before(async () => {
        [deployer] = await ethers.getSigners();
        tokenFactory = await ethers.getContractFactory("USJimToken");
    });

    async function deployToken(): Promise<{ token: Contract }> {
        const token: Contract = await upgrades.deployProxy(tokenFactory, [TOKEN_NAME, TOKEN_SYMBOL]);
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
            expect(await token.mainBlacklister()).to.equal(ethers.constants.AddressZero);
        });

        it("Is reverted if called for the second time", async () => {
            const { token } = await setUpFixture(deployToken);
            await expect(token.callStatic.initialize(TOKEN_NAME, TOKEN_SYMBOL)).to.be.revertedWith(
                REVERT_MESSAGE_INITIALIZABLE_CONTRACT_IS_ALREADY_INITIALIZED
            );
        });

        it("Is reverted if the contract implementation is called even for the first time", async () => {
            const tokenImplementation: Contract = await tokenFactory.deploy();
            await tokenImplementation.deployed();
            await expect(tokenImplementation.callStatic.initialize(TOKEN_NAME, TOKEN_SYMBOL)).to.be.revertedWith(
                REVERT_MESSAGE_INITIALIZABLE_CONTRACT_IS_ALREADY_INITIALIZED
            );
        });
    });

    describe("Function 'isUSJim()'", async () => {
        it("Returns true", async () => {
            const { token } = await setUpFixture(deployToken);
            expect(await token.isUSJim()).to.eq(true);
        });
    });
});
