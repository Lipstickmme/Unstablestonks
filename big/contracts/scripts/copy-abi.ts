import * as fs from "fs";
import * as path from "path";

async function main() {
  const artifactPath = path.join(__dirname, "../artifacts/contracts/BigMarketV4.sol/BigMarketV4.json");
  const frontendAbiPath = path.join(__dirname, "../../frontend/lib/abi.json");
  const frontendAbiDir = path.dirname(frontendAbiPath);

  if (!fs.existsSync(artifactPath)) {
    console.error("Artifact not found. Please compile contracts first.");
    process.exit(1);
  }

  if (!fs.existsSync(frontendAbiDir)) {
    fs.mkdirSync(frontendAbiDir, { recursive: true });
  }

  const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
  fs.writeFileSync(frontendAbiPath, JSON.stringify(artifact.abi, null, 2));
  
  console.log("✅ ABI copied to frontend/lib/abi.json");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

