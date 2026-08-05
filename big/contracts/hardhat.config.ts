import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "@openzeppelin/hardhat-upgrades";
import * as dotenv from "dotenv";

dotenv.config();

const accounts = process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [];

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.22",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  networks: {
    amoy: {
      url: process.env.POLYGON_AMOY_RPC || "https://rpc-amoy.polygon.technology",
      accounts,
      chainId: 80002,
    },
    polygon: {
      url: process.env.POLYGON_MAINNET_RPC || "https://polygon-rpc.com",
      accounts,
      chainId: 137,
    },
    // Chiliz Chain — the fan-token network. Gas is CHZ; Azuro settles bets in WCHZ.
    chiliz: {
      url: process.env.CHILIZ_RPC || "https://rpc.ankr.com/chiliz",
      accounts,
      chainId: 88,
    },
    // Chiliz Spicy testnet.
    spicy: {
      url: process.env.CHILIZ_SPICY_RPC || "https://spicy-rpc.chiliz.com",
      accounts,
      chainId: 88882,
    },
    base: {
      url: process.env.BASE_RPC || "https://mainnet.base.org",
      accounts,
      chainId: 8453,
    },
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },
  etherscan: {
    apiKey: {
      polygon: process.env.POLYGONSCAN_API_KEY || "",
      polygonAmoy: process.env.POLYGONSCAN_API_KEY || "",
      base: process.env.BASESCAN_API_KEY || "",
      // ChilizScan runs Blockscout, which accepts any non-empty key.
      chiliz: process.env.CHILIZSCAN_API_KEY || "chiliz",
      spicy: process.env.CHILIZSCAN_API_KEY || "chiliz",
    },
    customChains: [
      {
        network: "chiliz",
        chainId: 88,
        urls: {
          apiURL: "https://scan.chiliz.com/api",
          browserURL: "https://scan.chiliz.com",
        },
      },
      {
        network: "spicy",
        chainId: 88882,
        urls: {
          apiURL: "https://testnet.chiliscan.com/api",
          browserURL: "https://testnet.chiliscan.com",
        },
      },
    ],
  },
};

export default config;
