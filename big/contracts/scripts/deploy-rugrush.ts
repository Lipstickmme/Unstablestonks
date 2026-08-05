import { ethers, upgrades } from "hardhat";
import * as fs from "fs";
import * as path from "path";

import { deploymentDir, nativeSymbol, networkName } from "./networks";

/** Bankroll to seed the table with, in native units. Override with RUGRUSH_BANKROLL. */
const DEFAULT_BANKROLL = "1.0";

async function main() {
  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();
  const name = networkName(network.chainId);
  const symbol = nativeSymbol(network.chainId);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("Deployer:", deployer.address);
  console.log("Balance:", ethers.formatEther(balance), symbol);
  console.log("Network:", name, "Chain ID:", network.chainId.toString());

  const RugRush = await ethers.getContractFactory("RugRush");

  console.log("\nDeploying RugRush as a UUPS proxy...");
  const rugRush = await upgrades.deployProxy(RugRush, [deployer.address], {
    kind: "uups",
    initializer: "initialize",
    timeout: 600000,
    pollingInterval: 5000,
  });
  await rugRush.waitForDeployment();

  const proxyAddress = await rugRush.getAddress();
  const implementationAddress = await upgrades.erc1967.getImplementationAddress(proxyAddress);

  console.log("RugRush proxy:", proxyAddress);
  console.log("RugRush implementation:", implementationAddress);

  // A table with no bankroll rejects every stake, because the exposure check has nothing
  // to measure against. Seed it so the game is playable on deploy.
  const bankroll = ethers.parseEther(process.env.RUGRUSH_BANKROLL ?? DEFAULT_BANKROLL);

  if (balance > bankroll * 2n) {
    console.log(`\nFunding bankroll with ${ethers.formatEther(bankroll)} ${symbol}...`);
    const tx = await rugRush.fundBankroll({ value: bankroll });
    await tx.wait();
    console.log("Bankroll funded.");
  } else {
    console.log("\nSkipping bankroll funding — deployer balance is too low.");
    console.log("Fund it later with fundBankroll(), or no stake will be accepted.");
  }

  const dir = deploymentDir();

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const file = path.join(dir, `rugrush.${name}.json`);
  fs.writeFileSync(
    file,
    JSON.stringify(
      {
        contract: "RugRush",
        network: name,
        chainId: network.chainId.toString(),
        proxyAddress,
        implementationAddress,
        owner: deployer.address,
        timestamp: new Date().toISOString(),
      },
      null,
      2,
    ),
  );

  console.log(`\nSaved to deployments/rugrush.${name}.json`);
  console.log("\nNext steps:");
  console.log(`1. Set NEXT_PUBLIC_RUGRUSH_ADDRESS=${proxyAddress} in frontend/.env.local`);
  console.log("2. Run the round operator: npm run rugrush:operate");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
