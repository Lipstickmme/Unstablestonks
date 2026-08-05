import { ethers, upgrades } from "hardhat";
import * as fs from "fs";
import * as path from "path";

async function main() {
  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();
  
  console.log("Upgrading BigMarket contract with account:", deployer.address);
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("Account balance:", ethers.formatEther(balance), "POL");
  console.log("Network:", network.name, "Chain ID:", network.chainId.toString());

  // Determine network name for deployment file
  const networkName = network.chainId === 137n ? "polygon" : network.chainId === 80002n ? "amoy" : `chain-${network.chainId}`;
  const deploymentPath = path.join(__dirname, "../deployments", `${networkName}.json`);
  
  if (!fs.existsSync(deploymentPath)) {
    throw new Error(`Deployment file not found: ${deploymentPath}\nPlease deploy the contract first using scripts/deploy.ts`);
  }

  const deploymentInfo = JSON.parse(fs.readFileSync(deploymentPath, "utf8"));
  const proxyAddress = deploymentInfo.proxyAddress;

  if (!proxyAddress) {
    throw new Error("Proxy address not found in deployment file");
  }

  console.log("\nProxy address:", proxyAddress);
  console.log("Current implementation:", deploymentInfo.implementationAddress);

  // Get current gas price
  const feeData = await ethers.provider.getFeeData();
  const gasPrice = feeData.gasPrice || 0n;
  console.log("Current gas price:", ethers.formatUnits(gasPrice, "gwei"), "gwei");

  // Verify the proxy exists and is owned by deployer
  const BigMarketV1 = await ethers.getContractFactory("BigMarketV1");
  const currentProxy = BigMarketV1.attach(proxyAddress);
  
  try {
    const owner = await currentProxy.owner();
    console.log("Contract owner:", owner);
    if (owner.toLowerCase() !== deployer.address.toLowerCase()) {
      throw new Error(`Contract owner (${owner}) does not match deployer (${deployer.address})`);
    }
  } catch (error) {
    console.error("Error verifying contract ownership:", error);
    throw error;
  }

  console.log("\nDeploying BigMarketV2 implementation...");
  const BigMarketV2 = await ethers.getContractFactory("BigMarketV2");
  
  console.log("Upgrading proxy to BigMarketV2...");
  const upgraded = await upgrades.upgradeProxy(
    proxyAddress,
    BigMarketV2,
    {
      timeout: 600000, // 10 minutes timeout
      pollingInterval: 5000 // Poll every 5 seconds
    }
  );

  console.log("Waiting for upgrade confirmation...");
  await upgraded.waitForDeployment();
  
  const newImplementationAddress = await upgrades.erc1967.getImplementationAddress(proxyAddress);
  
  console.log("\n✅ Upgrade successful!");
  console.log("Proxy address (unchanged):", proxyAddress);
  console.log("New implementation address:", newImplementationAddress);
  console.log("Old implementation address:", deploymentInfo.implementationAddress);

  // Update deployment info
  const updatedDeploymentInfo = {
    ...deploymentInfo,
    implementationAddress: newImplementationAddress,
    previousImplementationAddress: deploymentInfo.implementationAddress,
    upgradedAt: new Date().toISOString(),
    version: "V2"
  };

  fs.writeFileSync(
    deploymentPath,
    JSON.stringify(updatedDeploymentInfo, null, 2)
  );

  // Copy updated ABI to frontend
  const artifactPath = path.join(__dirname, "../artifacts/contracts/contracts/BigMarketV2.sol/BigMarketV2.json");
  if (fs.existsSync(artifactPath)) {
    const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
    const frontendAbiPath = path.join(__dirname, "../../frontend/lib/abi.json");
    const frontendAbiDir = path.dirname(frontendAbiPath);
    if (!fs.existsSync(frontendAbiDir)) {
      fs.mkdirSync(frontendAbiDir, { recursive: true });
    }
    fs.writeFileSync(frontendAbiPath, JSON.stringify(artifact.abi, null, 2));
    console.log("Updated ABI copied to frontend/lib/abi.json");
  }

  console.log(`\nDeployment info updated in deployments/${networkName}.json`);
  console.log("\n✨ Contract upgraded successfully!");
  console.log("\nNew features:");
  console.log("- Enhanced BetPlacedEnhanced event with timestamp, totalPool, and outcomePool");
  console.log("- Original BetPlaced event maintained for backward compatibility");
  console.log("- All existing game data and state preserved");
  console.log("\nNext steps:");
  console.log("1. Update frontend to use BetPlacedEnhanced event for better data tracking");
  console.log("2. Test the upgrade on a testnet first if not already done");
  console.log("3. Verify the new implementation contract on Polygonscan");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
