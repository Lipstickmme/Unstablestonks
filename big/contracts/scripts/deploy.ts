import { ethers, upgrades } from "hardhat";
import * as fs from "fs";
import * as path from "path";

async function main() {
  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();
  
  console.log("Deploying contracts with account:", deployer.address);
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("Account balance:", ethers.formatEther(balance), "POL");
  console.log("Network:", network.name, "Chain ID:", network.chainId.toString());

  // Get current gas price
  const feeData = await ethers.provider.getFeeData();
  const gasPrice = feeData.gasPrice || 0n;
  console.log("Current gas price:", ethers.formatUnits(gasPrice, "gwei"), "gwei");

  const BigMarketV1 = await ethers.getContractFactory("BigMarketV1");
  
  // Estimate gas for deployment
  console.log("\nEstimating gas for deployment...");
  try {
    const deploymentData = BigMarketV1.interface.encodeDeploy([deployer.address]);
    const estimatedGas = await ethers.provider.estimateGas({
      data: deploymentData,
    });
    const estimatedCost = estimatedGas * gasPrice;
    console.log("Estimated gas:", estimatedGas.toString());
    console.log("Estimated cost:", ethers.formatEther(estimatedCost), "POL");
    console.log("Account has sufficient balance:", balance >= estimatedCost ? "✅ Yes" : "❌ No");
  } catch (error) {
    console.log("Gas estimation skipped (proxy deployment will estimate)");
  }
  
  console.log("\nDeploying BigMarket as UUPS proxy...");
  const bigMarket = await upgrades.deployProxy(
    BigMarketV1,
    [deployer.address],
    { 
      kind: "uups",
      initializer: "initialize",
      timeout: 600000, // 10 minutes timeout
      pollingInterval: 5000 // Poll every 5 seconds
    }
  );

  console.log("Waiting for deployment confirmation...");

  await bigMarket.waitForDeployment();
  
  const proxyAddress = await bigMarket.getAddress();
  const implementationAddress = await upgrades.erc1967.getImplementationAddress(proxyAddress);
  
  console.log("BigMarket Proxy deployed to:", proxyAddress);
  console.log("BigMarket Implementation deployed to:", implementationAddress);
  console.log("Owner address:", deployer.address);

  // Determine network name for file
  const networkName = network.chainId === 137n ? "polygon" : network.chainId === 80002n ? "amoy" : `chain-${network.chainId}`;

  // Save deployment info
  const deploymentInfo = {
    network: networkName,
    chainId: network.chainId.toString(),
    proxyAddress,
    implementationAddress,
    owner: deployer.address,
    deployer: deployer.address,
    timestamp: new Date().toISOString(),
  };

  const deploymentPath = path.join(__dirname, "../deployments");
  if (!fs.existsSync(deploymentPath)) {
    fs.mkdirSync(deploymentPath, { recursive: true });
  }

  fs.writeFileSync(
    path.join(deploymentPath, `${networkName}.json`),
    JSON.stringify(deploymentInfo, null, 2)
  );

  // Copy ABI to frontend
  const artifactPath = path.join(__dirname, "../artifacts/contracts/contracts/BigMarketV1.sol/BigMarketV1.json");
  if (fs.existsSync(artifactPath)) {
    const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
    const frontendAbiPath = path.join(__dirname, "../../frontend/lib/abi.json");
    const frontendAbiDir = path.dirname(frontendAbiPath);
    if (!fs.existsSync(frontendAbiDir)) {
      fs.mkdirSync(frontendAbiDir, { recursive: true });
    }
    fs.writeFileSync(frontendAbiPath, JSON.stringify(artifact.abi, null, 2));
    console.log("ABI copied to frontend/lib/abi.json");
  }

  console.log(`\nDeployment info saved to deployments/${networkName}.json`);
  console.log("\nNext steps:");
  console.log("1. Copy the proxy address to frontend/.env.local as NEXT_PUBLIC_CONTRACT_ADDRESS");
  console.log("2. Authorize creator addresses if needed");
  console.log("3. Verify the contract on Polygonscan if deploying to mainnet");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

