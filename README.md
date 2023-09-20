# BRLC Token

<p align="center">
  <img src="./docs/media/brlc-cover.png">
</p>

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
![example branch parameter](https://github.com/cloudwalk/brlc-token/actions/workflows/build.yml/badge.svg?branch=main)
![example branch parameter](https://github.com/cloudwalk/brlc-token/actions/workflows/test.yml/badge.svg?branch=main)

This repository contains [BRLC](https://infinitepay.io/brlc) token smart contracts.</br>
[BRLC](https://infinitepay.io/brlc) is a stablecoin created and issued by [Infinitepay](https://infinitepay.io).

## Build and test

```sh
# Install all dependencies
npm install

# Compile all contracts
npx hardhat compile

# Run all tests
npx hardhat test
```

## Running helper scripts
1. Add the needed network and mnemonic (or private keys) in the `networks` section of the Hardhat configuration file: [hardhat.config.ts](hardhat.config.ts).

2. Configure the needed script by setting the values under the `Script input parameters` section inside it or by declaration an appropriate environment variables.

3. Run one of the needed script like:
   ```bash
   npx hardhat --network ganache scripts/<script_name>.ts
   ```
   Use your network instead of `ganache`.

## Networks and deployments
Information about deployments across all the networks can be found [here](./docs/deployed-contracts.md).

## Licensing
This project is released under the MIT License, see [LICENSE](./LICENSE).
