import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

async function main() {
  const network = await ethers.provider.getNetwork();
  const networkName = network.chainId === 137n ? "polygon" : network.chainId === 80002n ? "amoy" : `chain-${network.chainId}`;
  
  const deploymentPath = path.join(__dirname, "../deployments", `${networkName}.json`);
  if (!fs.existsSync(deploymentPath)) {
    console.error(`Deployment file not found: ${deploymentPath}`);
    console.error("Please deploy the contract first using: npm run deploy");
    process.exit(1);
  }
  
  const deploymentInfo = JSON.parse(
    fs.readFileSync(deploymentPath, "utf8")
  );

  const [signer] = await ethers.getSigners();
  const BigMarket = await ethers.getContractAt("BigMarketV1", deploymentInfo.proxyAddress);

  const addressToAuthorize = process.env.AUTHORIZE_ADDRESS;
  if (!addressToAuthorize) {
    console.error("Please set AUTHORIZE_ADDRESS environment variable");
    process.exit(1);
  }

  console.log("Authorizing address:", addressToAuthorize);
  const tx = await BigMarket.authorizeCreator(addressToAuthorize);
  await tx.wait();
  console.log("Authorization successful! Tx:", tx.hash);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

