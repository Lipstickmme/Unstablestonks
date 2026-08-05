import { ethers, upgrades } from "hardhat";
import * as fs from "fs";
import * as path from "path";

async function main() {
  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();
  const networkName = network.chainId === 137n ? "polygon" : network.chainId === 80002n ? "amoy" : `chain-${network.chainId}`;
  const deploymentPath = path.join(__dirname, "../deployments", `${networkName}.json`);

  if (!fs.existsSync(deploymentPath)) {
    throw new Error(`Deployment file not found: ${deploymentPath}. Deploy first with scripts/deploy.ts`);
  }

  const deploymentInfo = JSON.parse(fs.readFileSync(deploymentPath, "utf8"));
  const proxyAddress = deploymentInfo.proxyAddress;
  if (!proxyAddress) throw new Error("Proxy address not found");

  console.log("Upgrading to BigMarketV3...");
  console.log("Proxy:", proxyAddress);

  const BigMarketV3 = await ethers.getContractFactory("BigMarketV3");
  const upgraded = await upgrades.upgradeProxy(proxyAddress, BigMarketV3, {
    timeout: 600000,
    pollingInterval: 5000,
  });
  await upgraded.waitForDeployment();
  const newImpl = await upgrades.erc1967.getImplementationAddress(proxyAddress);

  const updated = {
    ...deploymentInfo,
    implementationAddress: newImpl,
    previousImplementationAddress: deploymentInfo.implementationAddress,
    upgradedAt: new Date().toISOString(),
    version: "V3",
  };
  fs.writeFileSync(deploymentPath, JSON.stringify(updated, null, 2));

  const artifactPath = path.join(__dirname, "../artifacts/contracts/BigMarketV3.sol/BigMarketV3.json");
  if (fs.existsSync(artifactPath)) {
    const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
    const frontendAbiPath = path.join(__dirname, "../../frontend/lib/abi.json");
    fs.writeFileSync(frontendAbiPath, JSON.stringify(artifact.abi, null, 2));
    console.log("ABI copied to frontend/lib/abi.json");
  }

  console.log("V3 implementation:", newImpl);
  console.log("V3 adds: paused, setPaused(bool), emergencyWithdrawAll()");
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
