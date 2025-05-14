import { network } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";

export async function setUpFixture<T>(func: () => Promise<T>): Promise<T> {
  if (network.name === "hardhat") {
    return loadFixture(func);
  } else {
    return func();
  }
}
