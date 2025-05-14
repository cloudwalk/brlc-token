import { network } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";

export async function setUpFixture<T>(func: () => Promise<T>): Promise<T> {
  if (network.name === "hardhat") {
    return loadFixture(func);
  } else {
    return func();
  }
}

export function maxUintForBits(numberOfBits: number): bigint {
  return 2n ** BigInt(numberOfBits) - 1n;
}
