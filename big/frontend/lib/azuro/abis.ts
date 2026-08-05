// Minimal ABIs for the contracts the book touches directly.
//
// Bets themselves go through the relayer, so the front end only needs the bet token
// (balance / allowance / approve), the wrapped-native contract for chains where the bet
// token is a wrapper — WCHZ on Chiliz, WETH on Base — and AzuroBet for position ownership.

export const ERC20_ABI = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
  {
    type: "function",
    name: "symbol",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
  },
] as const;

/**
 * Canonical wrapped-native interface. On Chiliz the bet token is WCHZ, so a bettor
 * holding native CHZ has to wrap before they can stake — the wallet page does this in one
 * click rather than sending them to an external DEX.
 */
export const WRAPPED_NATIVE_ABI = [
  {
    type: "function",
    name: "deposit",
    stateMutability: "payable",
    inputs: [],
    outputs: [],
  },
  {
    type: "function",
    name: "withdraw",
    stateMutability: "nonpayable",
    inputs: [{ name: "amount", type: "uint256" }],
    outputs: [],
  },
  ...ERC20_ABI,
] as const;

export const AZURO_BET_ABI = [
  {
    type: "function",
    name: "ownerOf",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

export const LP_ABI = [
  {
    type: "function",
    name: "withdrawPayout",
    stateMutability: "nonpayable",
    inputs: [
      { name: "core", type: "address" },
      { name: "tokenId", type: "uint256" },
    ],
    outputs: [{ name: "amount", type: "uint128" }],
  },
  {
    type: "function",
    name: "viewPayout",
    stateMutability: "view",
    inputs: [
      { name: "core", type: "address" },
      { name: "tokenId", type: "uint256" },
    ],
    outputs: [{ name: "", type: "uint128" }],
  },
] as const;
