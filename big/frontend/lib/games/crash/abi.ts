// ABI for the RugRush contract. Hand-written rather than generated so the frontend can
// build without a compiled artifact present.

export const RUG_RUSH_ABI = [
  {
    type: "function",
    name: "roundCount",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "bankroll",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "minStake",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "maxStake",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "maxPayout",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "getRound",
    stateMutability: "view",
    inputs: [{ name: "roundId", type: "uint256" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "serverSeedHash", type: "bytes32" },
          { name: "serverSeed", type: "bytes32" },
          { name: "clientSeed", type: "string" },
          { name: "startedAt", type: "uint64" },
          { name: "revealDeadline", type: "uint64" },
          { name: "rugX18", type: "uint256" },
          { name: "totalStaked", type: "uint128" },
          { name: "totalPaid", type: "uint128" },
          { name: "state", type: "uint8" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "getPosition",
    stateMutability: "view",
    inputs: [
      { name: "roundId", type: "uint256" },
      { name: "player", type: "address" },
    ],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "stake", type: "uint128" },
          { name: "autoSellX18", type: "uint256" },
          { name: "soldAtX18", type: "uint256" },
          { name: "settled", type: "bool" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "getPlayers",
    stateMutability: "view",
    inputs: [{ name: "roundId", type: "uint256" }],
    outputs: [{ type: "address[]" }],
  },
  {
    type: "function",
    name: "currentMultiplier",
    stateMutability: "view",
    inputs: [{ name: "roundId", type: "uint256" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "multiplierAt",
    stateMutability: "pure",
    inputs: [{ name: "elapsedMs", type: "uint256" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "rugMultiplier",
    stateMutability: "pure",
    inputs: [
      { name: "serverSeed", type: "bytes32" },
      { name: "clientSeed", type: "string" },
      { name: "nonce", type: "uint256" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "buyIn",
    stateMutability: "payable",
    inputs: [
      { name: "roundId", type: "uint256" },
      { name: "autoSellX18", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "sell",
    stateMutability: "nonpayable",
    inputs: [{ name: "roundId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "settle",
    stateMutability: "nonpayable",
    inputs: [{ name: "roundId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "voidRound",
    stateMutability: "nonpayable",
    inputs: [{ name: "roundId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "fundBankroll",
    stateMutability: "payable",
    inputs: [],
    outputs: [],
  },
  {
    type: "event",
    name: "RoundCommitted",
    inputs: [
      { name: "roundId", type: "uint256", indexed: true },
      { name: "serverSeedHash", type: "bytes32", indexed: false },
      { name: "clientSeed", type: "string", indexed: false },
    ],
  },
  {
    type: "event",
    name: "RoundStarted",
    inputs: [
      { name: "roundId", type: "uint256", indexed: true },
      { name: "startedAt", type: "uint64", indexed: false },
      { name: "revealDeadline", type: "uint64", indexed: false },
    ],
  },
  {
    type: "event",
    name: "RoundRevealed",
    inputs: [
      { name: "roundId", type: "uint256", indexed: true },
      { name: "serverSeed", type: "bytes32", indexed: false },
      { name: "rugX18", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "SoldOut",
    inputs: [
      { name: "roundId", type: "uint256", indexed: true },
      { name: "player", type: "address", indexed: true },
      { name: "multiplierX18", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "Settled",
    inputs: [
      { name: "roundId", type: "uint256", indexed: true },
      { name: "player", type: "address", indexed: true },
      { name: "payout", type: "uint256", indexed: false },
      { name: "won", type: "bool", indexed: false },
    ],
  },
] as const;

export const RUG_RUSH_ADDRESS = (process.env.NEXT_PUBLIC_RUGRUSH_ADDRESS ??
  "0x0000000000000000000000000000000000000000") as `0x${string}`;

export const isRugRushConfigured = (): boolean =>
  /^0x[0-9a-fA-F]{40}$/.test(RUG_RUSH_ADDRESS) &&
  RUG_RUSH_ADDRESS !== "0x0000000000000000000000000000000000000000";
