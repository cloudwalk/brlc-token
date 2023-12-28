import { ethers, network, upgrades } from "hardhat";
import { expect } from "chai";
import { Contract, ContractFactory } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { proveTx } from "../test-utils/eth";

async function setUpFixture(func: any) {
    if (network.name === "hardhat") {
        return loadFixture(func);
    } else {
        return func();
    }
}

describe("Contract 'BRLCToken' - Freezable & Restrictable scenarios", async () => {
    const TOKEN_NAME = "BRL Coin";
    const TOKEN_SYMBOL = "BRLC";

    const REVERT_ERROR_TRANSFER_EXCEEDED_FROZEN_AMOUNT = "TransferExceededFrozenAmount";
    const REVERT_ERROR_TRANSFER_EXCEEDED_RESTRICTED_AMOUNT = "TransferExceededRestrictedAmount";
    const REVERT_MESSAGE_ERC20_TRANSFER_AMOUNT_EXCEEDS_BALANCE = "ERC20: transfer amount exceeds balance";

    const PURPOSE = "0x0000000000000000000000000000000000000000000000000000000000000001";

    let tokenFactory: ContractFactory;
    let deployer: SignerWithAddress;
    let user: SignerWithAddress;
    let purposeAccount: SignerWithAddress;
    let nonPurposeAccount: SignerWithAddress;

    before(async () => {
        [deployer, user, purposeAccount, nonPurposeAccount] = await ethers.getSigners();
        tokenFactory = await ethers.getContractFactory("BRLCToken");
    });

    async function deployToken(): Promise<{ token: Contract }> {
        const token: Contract = await upgrades.deployProxy(tokenFactory, [TOKEN_NAME, TOKEN_SYMBOL]);
        await token.deployed();
        return { token };
    }

    async function deployAndConfigureToken(): Promise<{ token: Contract }> {
        const { token } = await deployToken();
        await proveTx(token.connect(deployer).setMainBlocklister(deployer.address));
        await proveTx(token.connect(deployer).configureBlocklister(deployer.address, true));
        await proveTx(token.connect(deployer).assignPurposes(purposeAccount.address, [PURPOSE]));
        await proveTx(token.connect(deployer).updateMainMinter(deployer.address));
        await proveTx(token.connect(deployer).configureMinter(deployer.address, 20));
        await proveTx(token.connect(user).approveFreezing());
        return { token };
    }

    describe("Frozen and restricted balances", async () => {
        it("Transfer to purpose account - test 5", async () => {
            const { token } = await setUpFixture(deployAndConfigureToken);
            await proveTx(token.connect(deployer).mint(user.address, 20));
            await proveTx(token.connect(deployer).freeze(user.address, 10));
            await proveTx(token.connect(deployer).updateRestriction(user.address, PURPOSE, 10));
            await expect(token.connect(user).transfer(purposeAccount.address, 5)).to.changeTokenBalances(
                token,
                [user, purposeAccount],
                [-5, 5]
            );
            expect(await token.balanceOfRestricted(user.address, PURPOSE)).to.eq(5);
        });

        it("Transfer to purpose account - test 10", async () => {
            const { token } = await setUpFixture(deployAndConfigureToken);
            await proveTx(token.connect(deployer).mint(user.address, 20));
            await proveTx(token.connect(deployer).freeze(user.address, 10));
            await proveTx(token.connect(deployer).updateRestriction(user.address, PURPOSE, 10));
            await expect(token.connect(user).transfer(purposeAccount.address, 10)).to.changeTokenBalances(
                token,
                [user, purposeAccount],
                [-10, 10]
            );
            expect(await token.balanceOfRestricted(user.address, PURPOSE)).to.eq(0);
        });

        it("Transfer to purpose account - test 15", async () => {
            const { token } = await setUpFixture(deployAndConfigureToken);
            await proveTx(token.connect(deployer).mint(user.address, 20));
            await proveTx(token.connect(deployer).freeze(user.address, 10));
            await proveTx(token.connect(deployer).updateRestriction(user.address, PURPOSE, 10));
            await expect(token.connect(user).transfer(purposeAccount.address, 15)).to.be.revertedWithCustomError(
                token,
                REVERT_ERROR_TRANSFER_EXCEEDED_FROZEN_AMOUNT
            );
        });

        it("Transfer to purpose account - test 20", async () => {
            const { token } = await setUpFixture(deployAndConfigureToken);
            await proveTx(token.connect(deployer).mint(user.address, 20));
            await proveTx(token.connect(deployer).freeze(user.address, 10));
            await proveTx(token.connect(deployer).updateRestriction(user.address, PURPOSE, 10));
            await expect(token.connect(user).transfer(purposeAccount.address, 20)).to.be.revertedWithCustomError(
                token,
                REVERT_ERROR_TRANSFER_EXCEEDED_FROZEN_AMOUNT
            );
        });

        it("Transfer to purpose account - test 25", async () => {
            const { token } = await setUpFixture(deployAndConfigureToken);
            await proveTx(token.connect(deployer).mint(user.address, 20));
            await proveTx(token.connect(deployer).freeze(user.address, 10));
            await proveTx(token.connect(deployer).updateRestriction(user.address, PURPOSE, 10));
            await expect(token.connect(user).transfer(purposeAccount.address, 25)).to.be.revertedWith(
                REVERT_MESSAGE_ERC20_TRANSFER_AMOUNT_EXCEEDS_BALANCE
            );
        });

        it("Transfer to non-purpose account - test 5", async () => {
            const { token } = await setUpFixture(deployAndConfigureToken);
            await proveTx(token.connect(deployer).mint(user.address, 20));
            await proveTx(token.connect(deployer).freeze(user.address, 10));
            await proveTx(token.connect(deployer).updateRestriction(user.address, PURPOSE, 10));
            await expect(token.connect(user).transfer(nonPurposeAccount.address, 5)).to.be.revertedWithCustomError(
                token,
                REVERT_ERROR_TRANSFER_EXCEEDED_RESTRICTED_AMOUNT
            );
        });

        it("Transfer to non-purpose account - test 10", async () => {
            const { token } = await setUpFixture(deployAndConfigureToken);
            await proveTx(token.connect(deployer).mint(user.address, 20));
            await proveTx(token.connect(deployer).freeze(user.address, 10));
            await proveTx(token.connect(deployer).updateRestriction(user.address, PURPOSE, 10));
            await expect(token.connect(user).transfer(nonPurposeAccount.address, 10)).to.be.revertedWithCustomError(
                token,
                REVERT_ERROR_TRANSFER_EXCEEDED_RESTRICTED_AMOUNT
            );
        });

        it("Transfer to non-purpose account - test 15", async () => {
            const { token } = await setUpFixture(deployAndConfigureToken);
            await proveTx(token.connect(deployer).mint(user.address, 20));
            await proveTx(token.connect(deployer).freeze(user.address, 10));
            await proveTx(token.connect(deployer).updateRestriction(user.address, PURPOSE, 10));
            await expect(token.connect(user).transfer(nonPurposeAccount.address, 15)).to.be.revertedWithCustomError(
                token,
                REVERT_ERROR_TRANSFER_EXCEEDED_FROZEN_AMOUNT
            );
        });

        it("Transfer to non-purpose account - test 20", async () => {
            const { token } = await setUpFixture(deployAndConfigureToken);
            await proveTx(token.connect(deployer).mint(user.address, 20));
            await proveTx(token.connect(deployer).freeze(user.address, 10));
            await proveTx(token.connect(deployer).updateRestriction(user.address, PURPOSE, 10));
            await expect(token.connect(user).transfer(nonPurposeAccount.address, 20)).to.be.revertedWithCustomError(
                token,
                REVERT_ERROR_TRANSFER_EXCEEDED_FROZEN_AMOUNT
            );
        });

        it("Transfer to non-purpose account - test 25", async () => {
            const { token } = await setUpFixture(deployAndConfigureToken);
            await proveTx(token.connect(deployer).mint(user.address, 20));
            await proveTx(token.connect(deployer).freeze(user.address, 10));
            await proveTx(token.connect(deployer).updateRestriction(user.address, PURPOSE, 10));
            await expect(token.connect(user).transfer(nonPurposeAccount.address, 25)).to.be.revertedWith(
                REVERT_MESSAGE_ERC20_TRANSFER_AMOUNT_EXCEEDS_BALANCE
            );
        });
    });

    describe("Frozen and restricted balances (no tokens)", async () => {
        it("Transfer to purpose account - test 5", async () => {
            const { token } = await setUpFixture(deployAndConfigureToken);
            await proveTx(token.connect(deployer).freeze(user.address, 10));
            await proveTx(token.connect(deployer).updateRestriction(user.address, PURPOSE, 10));
            await expect(token.connect(user).transfer(purposeAccount.address, 5)).to.be.revertedWith(
                REVERT_MESSAGE_ERC20_TRANSFER_AMOUNT_EXCEEDS_BALANCE
            );
        });

        it("Transfer to purpose account - test 10", async () => {
            const { token } = await setUpFixture(deployAndConfigureToken);
            await proveTx(token.connect(deployer).freeze(user.address, 10));
            await proveTx(token.connect(deployer).updateRestriction(user.address, PURPOSE, 10));
            await expect(token.connect(user).transfer(purposeAccount.address, 10)).to.be.revertedWith(
                REVERT_MESSAGE_ERC20_TRANSFER_AMOUNT_EXCEEDS_BALANCE
            );
        });

        it("Transfer to purpose account - test 15", async () => {
            const { token } = await setUpFixture(deployAndConfigureToken);
            await proveTx(token.connect(deployer).freeze(user.address, 10));
            await proveTx(token.connect(deployer).updateRestriction(user.address, PURPOSE, 10));
            await expect(token.connect(user).transfer(purposeAccount.address, 15)).to.be.revertedWith(
                REVERT_MESSAGE_ERC20_TRANSFER_AMOUNT_EXCEEDS_BALANCE
            );
        });

        it("Transfer to purpose account - test 20", async () => {
            const { token } = await setUpFixture(deployAndConfigureToken);
            await proveTx(token.connect(deployer).freeze(user.address, 10));
            await proveTx(token.connect(deployer).updateRestriction(user.address, PURPOSE, 10));
            await expect(token.connect(user).transfer(purposeAccount.address, 20)).to.be.revertedWith(
                REVERT_MESSAGE_ERC20_TRANSFER_AMOUNT_EXCEEDS_BALANCE
            );
        });

        it("Transfer to purpose account - test 25", async () => {
            const { token } = await setUpFixture(deployAndConfigureToken);
            await proveTx(token.connect(deployer).freeze(user.address, 10));
            await proveTx(token.connect(deployer).updateRestriction(user.address, PURPOSE, 10));
            await expect(token.connect(user).transfer(purposeAccount.address, 25)).to.be.revertedWith(
                REVERT_MESSAGE_ERC20_TRANSFER_AMOUNT_EXCEEDS_BALANCE
            );
        });

        it("Transfer to non-purpose account - test 5", async () => {
            const { token } = await setUpFixture(deployAndConfigureToken);
            await proveTx(token.connect(deployer).freeze(user.address, 10));
            await proveTx(token.connect(deployer).updateRestriction(user.address, PURPOSE, 10));
            await expect(token.connect(user).transfer(nonPurposeAccount.address, 5)).to.be.revertedWith(
                REVERT_MESSAGE_ERC20_TRANSFER_AMOUNT_EXCEEDS_BALANCE
            );
        });

        it("Transfer to non-purpose account - test 10", async () => {
            const { token } = await setUpFixture(deployAndConfigureToken);
            await proveTx(token.connect(deployer).freeze(user.address, 10));
            await proveTx(token.connect(deployer).updateRestriction(user.address, PURPOSE, 10));
            await expect(token.connect(user).transfer(nonPurposeAccount.address, 10)).to.be.revertedWith(
                REVERT_MESSAGE_ERC20_TRANSFER_AMOUNT_EXCEEDS_BALANCE
            );
        });

        it("Transfer to non-purpose account - test 15", async () => {
            const { token } = await setUpFixture(deployAndConfigureToken);
            await proveTx(token.connect(deployer).freeze(user.address, 10));
            await proveTx(token.connect(deployer).updateRestriction(user.address, PURPOSE, 10));
            await expect(token.connect(user).transfer(nonPurposeAccount.address, 15)).to.be.revertedWith(
                REVERT_MESSAGE_ERC20_TRANSFER_AMOUNT_EXCEEDS_BALANCE
            );
        });

        it("Transfer to non-purpose account - test 20", async () => {
            const { token } = await setUpFixture(deployAndConfigureToken);
            await proveTx(token.connect(deployer).freeze(user.address, 10));
            await proveTx(token.connect(deployer).updateRestriction(user.address, PURPOSE, 10));
            await expect(token.connect(user).transfer(nonPurposeAccount.address, 20)).to.be.revertedWith(
                REVERT_MESSAGE_ERC20_TRANSFER_AMOUNT_EXCEEDS_BALANCE
            );
        });

        it("Transfer to non-purpose account - test 25", async () => {
            const { token } = await setUpFixture(deployAndConfigureToken);
            await proveTx(token.connect(deployer).freeze(user.address, 10));
            await proveTx(token.connect(deployer).updateRestriction(user.address, PURPOSE, 10));
            await expect(token.connect(user).transfer(nonPurposeAccount.address, 25)).to.be.revertedWith(
                REVERT_MESSAGE_ERC20_TRANSFER_AMOUNT_EXCEEDS_BALANCE
            );
        });
    });

    describe("Frozen balance only, no restricted balance", async () => {
        it("Transfer to purpose account - test 5", async () => {
            const { token } = await setUpFixture(deployAndConfigureToken);
            await proveTx(token.connect(deployer).mint(user.address, 20));
            await proveTx(token.connect(deployer).freeze(user.address, 10));
            await expect(token.connect(user).transfer(purposeAccount.address, 5)).to.changeTokenBalances(
                token,
                [user, purposeAccount],
                [-5, 5]
            );
            expect(await token.balanceOfRestricted(user.address, PURPOSE)).to.eq(0);
        });

        it("Transfer to purpose account - test 10", async () => {
            const { token } = await setUpFixture(deployAndConfigureToken);
            await proveTx(token.connect(deployer).mint(user.address, 20));
            await proveTx(token.connect(deployer).freeze(user.address, 10));
            await expect(token.connect(user).transfer(purposeAccount.address, 10)).to.changeTokenBalances(
                token,
                [user, purposeAccount],
                [-10, 10]
            );
            expect(await token.balanceOfRestricted(user.address, PURPOSE)).to.eq(0);
        });

        it("Transfer to purpose account - test 15", async () => {
            const { token } = await setUpFixture(deployAndConfigureToken);
            await proveTx(token.connect(deployer).mint(user.address, 20));
            await proveTx(token.connect(deployer).freeze(user.address, 10));
            await expect(token.connect(user).transfer(purposeAccount.address, 15)).to.be.revertedWithCustomError(
                token,
                REVERT_ERROR_TRANSFER_EXCEEDED_FROZEN_AMOUNT
            );
        });

        it("Transfer to purpose account - test 20", async () => {
            const { token } = await setUpFixture(deployAndConfigureToken);
            await proveTx(token.connect(deployer).mint(user.address, 20));
            await proveTx(token.connect(deployer).freeze(user.address, 10));
            await expect(token.connect(user).transfer(purposeAccount.address, 20)).to.be.revertedWithCustomError(
                token,
                REVERT_ERROR_TRANSFER_EXCEEDED_FROZEN_AMOUNT
            );
        });

        it("Transfer to purpose account - test 25", async () => {
            const { token } = await setUpFixture(deployAndConfigureToken);
            await proveTx(token.connect(deployer).mint(user.address, 20));
            await proveTx(token.connect(deployer).freeze(user.address, 10));
            await expect(token.connect(user).transfer(purposeAccount.address, 25)).to.be.revertedWith(
                REVERT_MESSAGE_ERC20_TRANSFER_AMOUNT_EXCEEDS_BALANCE
            );
        });

        it("Transfer to non-purpose account - test 5", async () => {
            const { token } = await setUpFixture(deployAndConfigureToken);
            await proveTx(token.connect(deployer).mint(user.address, 20));
            await proveTx(token.connect(deployer).freeze(user.address, 10));
            await expect(token.connect(user).transfer(nonPurposeAccount.address, 5)).to.changeTokenBalances(
                token,
                [user, nonPurposeAccount],
                [-5, 5]
            );
            expect(await token.balanceOfRestricted(user.address, PURPOSE)).to.eq(0);
        });

        it("Transfer to non-purpose account - test 10", async () => {
            const { token } = await setUpFixture(deployAndConfigureToken);
            await proveTx(token.connect(deployer).mint(user.address, 20));
            await proveTx(token.connect(deployer).freeze(user.address, 10));
            await expect(token.connect(user).transfer(nonPurposeAccount.address, 10)).to.changeTokenBalances(
                token,
                [user, nonPurposeAccount],
                [-10, 10]
            );
            expect(await token.balanceOfRestricted(user.address, PURPOSE)).to.eq(0);
        });

        it("Transfer to non-purpose account - test 15", async () => {
            const { token } = await setUpFixture(deployAndConfigureToken);
            await proveTx(token.connect(deployer).mint(user.address, 20));
            await proveTx(token.connect(deployer).freeze(user.address, 10));
            await expect(token.connect(user).transfer(nonPurposeAccount.address, 15)).to.be.revertedWithCustomError(
                token,
                REVERT_ERROR_TRANSFER_EXCEEDED_FROZEN_AMOUNT
            );
        });

        it("Transfer to non-purpose account - test 20", async () => {
            const { token } = await setUpFixture(deployAndConfigureToken);
            await proveTx(token.connect(deployer).mint(user.address, 20));
            await proveTx(token.connect(deployer).freeze(user.address, 10));
            await expect(token.connect(user).transfer(nonPurposeAccount.address, 20)).to.be.revertedWithCustomError(
                token,
                REVERT_ERROR_TRANSFER_EXCEEDED_FROZEN_AMOUNT
            );
        });

        it("Transfer to non-purpose account - test 25", async () => {
            const { token } = await setUpFixture(deployAndConfigureToken);
            await proveTx(token.connect(deployer).mint(user.address, 20));
            await proveTx(token.connect(deployer).freeze(user.address, 10));
            await expect(token.connect(user).transfer(nonPurposeAccount.address, 25)).to.be.revertedWith(
                REVERT_MESSAGE_ERC20_TRANSFER_AMOUNT_EXCEEDS_BALANCE
            );
        });
    });

    describe("Restricted balance only, no frozen balance", async () => {
        it("Transfer to purpose account - test 5", async () => {
            const { token } = await setUpFixture(deployAndConfigureToken);
            await proveTx(token.connect(deployer).mint(user.address, 20));
            await proveTx(token.connect(deployer).updateRestriction(user.address, PURPOSE, 10));
            await expect(token.connect(user).transfer(purposeAccount.address, 5)).to.changeTokenBalances(
                token,
                [user, purposeAccount],
                [-5, 5]
            );
            expect(await token.balanceOfRestricted(user.address, PURPOSE)).to.eq(5);
        });

        it("Transfer to purpose account - test 10", async () => {
            const { token } = await setUpFixture(deployAndConfigureToken);
            await proveTx(token.connect(deployer).mint(user.address, 20));
            await proveTx(token.connect(deployer).updateRestriction(user.address, PURPOSE, 10));
            await expect(token.connect(user).transfer(purposeAccount.address, 10)).to.changeTokenBalances(
                token,
                [user, purposeAccount],
                [-10, 10]
            );
            expect(await token.balanceOfRestricted(user.address, PURPOSE)).to.eq(0);
        });

        it("Transfer to purpose account - test 15", async () => {
            const { token } = await setUpFixture(deployAndConfigureToken);
            await proveTx(token.connect(deployer).mint(user.address, 20));
            await proveTx(token.connect(deployer).updateRestriction(user.address, PURPOSE, 10));
            await expect(token.connect(user).transfer(purposeAccount.address, 15)).to.changeTokenBalances(
                token,
                [user, purposeAccount],
                [-15, 15]
            );
            expect(await token.balanceOfRestricted(user.address, PURPOSE)).to.eq(0);
        });

        it("Transfer to purpose account - test 20", async () => {
            const { token } = await setUpFixture(deployAndConfigureToken);
            await proveTx(token.connect(deployer).mint(user.address, 20));
            await proveTx(token.connect(deployer).updateRestriction(user.address, PURPOSE, 10));
            await expect(token.connect(user).transfer(purposeAccount.address, 20)).to.changeTokenBalances(
                token,
                [user, purposeAccount],
                [-20, 20]
            );
            expect(await token.balanceOfRestricted(user.address, PURPOSE)).to.eq(0);
        });

        it("Transfer to purpose account - test 25", async () => {
            const { token } = await setUpFixture(deployAndConfigureToken);
            await proveTx(token.connect(deployer).mint(user.address, 20));
            await proveTx(token.connect(deployer).updateRestriction(user.address, PURPOSE, 10));
            await expect(token.connect(user).transfer(purposeAccount.address, 25)).to.be.revertedWith(
                REVERT_MESSAGE_ERC20_TRANSFER_AMOUNT_EXCEEDS_BALANCE
            );
        });

        it("Transfer to non-purpose account - test 5", async () => {
            const { token } = await setUpFixture(deployAndConfigureToken);
            await proveTx(token.connect(deployer).mint(user.address, 20));
            await proveTx(token.connect(deployer).updateRestriction(user.address, PURPOSE, 10));
            await expect(token.connect(user).transfer(nonPurposeAccount.address, 5)).to.changeTokenBalances(
                token,
                [user, nonPurposeAccount],
                [-5, 5]
            );
            expect(await token.balanceOfRestricted(user.address, PURPOSE)).to.eq(10);
        });

        it("Transfer to non-purpose account - test 10", async () => {
            const { token } = await setUpFixture(deployAndConfigureToken);
            await proveTx(token.connect(deployer).mint(user.address, 20));
            await proveTx(token.connect(deployer).updateRestriction(user.address, PURPOSE, 10));
            await expect(token.connect(user).transfer(nonPurposeAccount.address, 10)).to.changeTokenBalances(
                token,
                [user, nonPurposeAccount],
                [-10, 10]
            );
            expect(await token.balanceOfRestricted(user.address, PURPOSE)).to.eq(10);
        });

        it("Transfer to non-purpose account - test 15", async () => {
            const { token } = await setUpFixture(deployAndConfigureToken);
            await proveTx(token.connect(deployer).mint(user.address, 20));
            await proveTx(token.connect(deployer).updateRestriction(user.address, PURPOSE, 10));
            await expect(token.connect(user).transfer(nonPurposeAccount.address, 15)).to.be.revertedWithCustomError(
                token,
                REVERT_ERROR_TRANSFER_EXCEEDED_RESTRICTED_AMOUNT
            );
        });

        it("Transfer to non-purpose account - test 20", async () => {
            const { token } = await setUpFixture(deployAndConfigureToken);
            await proveTx(token.connect(deployer).mint(user.address, 20));
            await proveTx(token.connect(deployer).updateRestriction(user.address, PURPOSE, 10));
            await expect(token.connect(user).transfer(nonPurposeAccount.address, 20)).to.be.revertedWithCustomError(
                token,
                REVERT_ERROR_TRANSFER_EXCEEDED_RESTRICTED_AMOUNT
            );
        });

        it("Transfer to non-purpose account - test 25", async () => {
            const { token } = await setUpFixture(deployAndConfigureToken);
            await proveTx(token.connect(deployer).mint(user.address, 20));
            await proveTx(token.connect(deployer).updateRestriction(user.address, PURPOSE, 10));
            await expect(token.connect(user).transfer(nonPurposeAccount.address, 25)).to.be.revertedWith(
                REVERT_MESSAGE_ERC20_TRANSFER_AMOUNT_EXCEEDS_BALANCE
            );
        });
    });

    describe("No frozen or restricted balances", async () => {
        it("Transfer to purpose account - test 5", async () => {
            const { token } = await setUpFixture(deployAndConfigureToken);
            await proveTx(token.connect(deployer).mint(user.address, 20));
            await expect(token.connect(user).transfer(purposeAccount.address, 5)).to.changeTokenBalances(
                token,
                [user, purposeAccount],
                [-5, 5]
            );
        });

        it("Transfer to purpose account - test 10", async () => {
            const { token } = await setUpFixture(deployAndConfigureToken);
            await proveTx(token.connect(deployer).mint(user.address, 20));
            await expect(token.connect(user).transfer(purposeAccount.address, 10)).to.changeTokenBalances(
                token,
                [user, purposeAccount],
                [-10, 10]
            );
        });

        it("Transfer to purpose account - test 15", async () => {
            const { token } = await setUpFixture(deployAndConfigureToken);
            await proveTx(token.connect(deployer).mint(user.address, 20));
            await expect(token.connect(user).transfer(purposeAccount.address, 15)).to.changeTokenBalances(
                token,
                [user, purposeAccount],
                [-15, 15]
            );
        });

        it("Transfer to purpose account - test 20", async () => {
            const { token } = await setUpFixture(deployAndConfigureToken);
            await proveTx(token.connect(deployer).mint(user.address, 20));
            await expect(token.connect(user).transfer(purposeAccount.address, 20)).to.changeTokenBalances(
                token,
                [user, purposeAccount],
                [-20, 20]
            );
        });

        it("Transfer to purpose account - test 25", async () => {
            const { token } = await setUpFixture(deployAndConfigureToken);
            await proveTx(token.connect(deployer).mint(user.address, 20));
            await expect(token.connect(user).transfer(purposeAccount.address, 25)).to.be.revertedWith(
                REVERT_MESSAGE_ERC20_TRANSFER_AMOUNT_EXCEEDS_BALANCE
            );
        });

        it("Transfer to non-purpose account - test 5", async () => {
            const { token } = await setUpFixture(deployAndConfigureToken);
            await proveTx(token.connect(deployer).mint(user.address, 20));
            await expect(token.connect(user).transfer(nonPurposeAccount.address, 5)).to.changeTokenBalances(
                token,
                [user, nonPurposeAccount],
                [-5, 5]
            );
        });

        it("Transfer to non-purpose account - test 10", async () => {
            const { token } = await setUpFixture(deployAndConfigureToken);
            await proveTx(token.connect(deployer).mint(user.address, 20));
            await expect(token.connect(user).transfer(nonPurposeAccount.address, 10)).to.changeTokenBalances(
                token,
                [user, nonPurposeAccount],
                [-10, 10]
            );
        });

        it("Transfer to non-purpose account - test 15", async () => {
            const { token } = await setUpFixture(deployAndConfigureToken);
            await proveTx(token.connect(deployer).mint(user.address, 20));
            await expect(token.connect(user).transfer(nonPurposeAccount.address, 15)).to.changeTokenBalances(
                token,
                [user, nonPurposeAccount],
                [-15, 15]
            );
        });

        it("Transfer to non-purpose account - test 20", async () => {
            const { token } = await setUpFixture(deployAndConfigureToken);
            await proveTx(token.connect(deployer).mint(user.address, 20));
            await expect(token.connect(user).transfer(nonPurposeAccount.address, 20)).to.changeTokenBalances(
                token,
                [user, nonPurposeAccount],
                [-20, 20]
            );
        });

        it("Transfer to non-purpose account - test 25", async () => {
            const { token } = await setUpFixture(deployAndConfigureToken);
            await proveTx(token.connect(deployer).mint(user.address, 20));
            await expect(token.connect(user).transfer(nonPurposeAccount.address, 25)).to.be.revertedWith(
                REVERT_MESSAGE_ERC20_TRANSFER_AMOUNT_EXCEEDS_BALANCE
            );
        });
    });
});
