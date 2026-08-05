import { getAddress, isAddress } from "viem";

const contractAddress = process.env.NEXT_PUBLIC_CONTRACT_ADDRESS || "";

if (contractAddress && !isAddress(contractAddress)) {
  console.warn("Invalid contract address in environment variables");
}

export const CONTRACT_ADDRESS = (contractAddress && isAddress(contractAddress) ? contractAddress : "0x0000000000000000000000000000000000000000") as `0x${string}`;

export function isValidContractAddress(): boolean {
  return contractAddress !== "" && isAddress(contractAddress);
}

export const CATEGORIES = [
  "All",
  "Politics",
  "Economy",
  "Sports",
  "Tech",
  "AI",
  "Energy",
  "Global Affairs",
  "Health",
  "Science",
  "Climate",
  "Gaming",
  "Business",
  "Startups",
  "Commodities",
  "Forex",
  "Real Estate",
  "Entertainment",
  "Crypto",
  "Tiktok trend",
  "WEB3",
  "X influencers",
  "Other",
] as const;

export type Category = typeof CATEGORIES[number];

export interface EventData {
  title: string;
  category: string;
  imageData: `0x${string}`;
  context: string;
  endTime: bigint;
  outcomes: readonly string[];
  pools: readonly bigint[];
  totalPool: bigint;
  resolved: boolean;
  winningOutcome: bigint;
  creator: `0x${string}`;
}

export function formatAddress(address: string): string {
  if (!address) return "";
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

/**
 * Sanitizes error messages to show user-friendly messages instead of technical RPC errors
 */
export function sanitizeErrorMessage(error: Error | unknown): string {
  const errorMessage = error instanceof Error ? error.message : String(error);
  const lowerMessage = errorMessage.toLowerCase();
  
  // Rate limiting errors
  if (lowerMessage.includes("rate limit") || 
      lowerMessage.includes("too many requests") || 
      lowerMessage.includes("429") ||
      lowerMessage.includes("call rate limit exhausted")) {
    return "Rate limited. Please try again in a moment.";
  }
  
  // Network/RPC errors
  if (lowerMessage.includes("rpc request failed") || 
      lowerMessage.includes("network error") ||
      lowerMessage.includes("fetch failed")) {
    return "Network error. Please check your connection and try again.";
  }
  
  // Block range errors
  if (lowerMessage.includes("query returned more than") || 
      lowerMessage.includes("block range")) {
    return "Block range too large. Please try again later.";
  }
  
  // Transaction errors
  if (lowerMessage.includes("user rejected") || 
      lowerMessage.includes("user denied")) {
    return "Transaction was cancelled.";
  }
  
  if (lowerMessage.includes("insufficient funds") || 
      lowerMessage.includes("insufficient balance")) {
    return "Insufficient balance. Please add more funds to your wallet.";
  }
  
  // Generic fallback
  return "An error occurred. Please try again.";
}

export function formatEther(value: bigint | string): string {
  const num = typeof value === "string" ? BigInt(value) : value;
  return (Number(num) / 1e18).toFixed(4);
}

export function parseEther(value: string): bigint {
  return BigInt(Math.floor(parseFloat(value) * 1e18));
}

