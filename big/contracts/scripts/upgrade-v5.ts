import { ethers, upgrades } from "hardhat";
import * as fs from "fs";
import * as path from "path";

import { deploymentFile, networkName } from "./networks";

async function main() {
  const network = await ethers.provider.getNetwork();
  const name = networkName(network.chainId);
  const deploymentPath = deploymentFile(name);

  if (!fs.existsSync(deploymentPath)) {
    throw new Error(`Deployment file not found: ${deploymentPath}. Deploy first with scripts/deploy.ts`);
  }

  const deploymentInfo = JSON.parse(fs.readFileSync(deploymentPath, "utf8"));
  const proxyAddress = deploymentInfo.proxyAddress;

  if (!proxyAddress) {
    throw new Error("Proxy address not found");
  }

  console.log("Upgrading to BigMarketV5...");
  console.log("Network:", name, "Proxy:", proxyAddress);

  const BigMarketV5 = await ethers.getContractFactory("BigMarketV5");
  const upgraded = await upgrades.upgradeProxy(proxyAddress, BigMarketV5, {
    timeout: 600000,
    pollingInterval: 5000,
  });
  await upgraded.waitForDeployment();

  // V5 adds parameters that default to zero on an upgraded proxy, so they have to be set
  // explicitly. `initializeV5` is idempotent-guarded and safe to retry.
  const disputeWindow = await upgraded.disputeWindow();

  if (disputeWindow === 0n) {
    console.log("Initialising V5 parameters...");
    const tx = await upgraded.initializeV5();
    await tx.wait();
  } else {
    console.log("V5 parameters already set; skipping initializeV5.");
  }

  const newImpl = await upgrades.erc1967.getImplementationAddress(proxyAddress);

  fs.writeFileSync(
    deploymentPath,
    JSON.stringify(
      {
        ...deploymentInfo,
        implementationAddress: newImpl,
        previousImplementationAddress: deploymentInfo.implementationAddress,
        upgradedAt: new Date().toISOString(),
        version: "V5",
      },
      null,
      2,
    ),
  );

  const artifactPath = path.join(
    __dirname,
    "../artifacts/contracts/BigMarketV5.sol/BigMarketV5.json",
  );

  if (fs.existsSync(artifactPath)) {
    const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
    fs.writeFileSync(
      path.join(__dirname, "../../frontend/lib/abi.json"),
      JSON.stringify(artifact.abi, null, 2),
    );
    console.log("ABI copied to frontend/lib/abi.json");
  }

  console.log("V5 implementation:", newImpl);
  console.log(
    "V5 adds: cancellation + refunds, proposed/disputed resolution, early exit, creator fees, batch claims.",
  );
  console.log("Next: grant resolvers with setResolver(address, true).");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
