import * as path from "path";

/** Human name for a chain id, used for deployment filenames. */
export const networkName = (chainId: bigint | number): string => {
  switch (BigInt(chainId)) {
    case 137n:
      return "polygon";
    case 80002n:
      return "amoy";
    case 88n:
      return "chiliz";
    case 88882n:
      return "spicy";
    case 8453n:
      return "base";
    default:
      return `chain-${chainId}`;
  }
};

/** Native gas token symbol, for readable log output. */
export const nativeSymbol = (chainId: bigint | number): string => {
  switch (BigInt(chainId)) {
    case 137n:
    case 80002n:
      return "POL";
    case 88n:
    case 88882n:
      return "CHZ";
    default:
      return "ETH";
  }
};

export const deploymentDir = (): string => path.join(__dirname, "../deployments");

export const deploymentFile = (name: string): string =>
  path.join(deploymentDir(), `${name}.json`);
