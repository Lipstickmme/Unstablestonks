// Chain registry for the Azuro book.
//
// Azuro keys everything off an "environment" (chain + bet token), so a chain entry has to
// carry the deployment addresses, the bet token, and the four service endpoints together.
// Addresses are the protocol's own v3 deployments.
//
// Chiliz is included deliberately. Azuro's own toolkit marks it deprecated, but the
// contracts are deployed and the feed still answers for `ChilizWCHZ`, and a fan-token chain
// is the natural home for a sportsbook — so we keep it as a first-class network here and
// gate it behind a flag rather than dropping it.

import { base, baseSepolia, chiliz, polygon, polygonAmoy, spicy } from "viem/chains";
import type { Address, Chain } from "viem";

import { Environment } from "./types";

export const ODDS_DECIMALS = 12;

/** Azuro shaves a fee off every combo leg beyond the first. */
export const ODDS_COMBO_FEE_MODIFIER = 0.99;

export type AzuroContracts = {
  lp: Address;
  core: Address;
  relayer: Address;
  azuroBet: Address;
  vault: Address;
  paymaster: Address;
  cashout: Address;
};

export type BetToken = {
  address: Address;
  symbol: string;
  decimals: number;
};

export type ChainData = {
  chain: Chain;
  environment: Environment;
  contracts: AzuroContracts;
  betToken: BetToken;
  api: string;
  socket: string;
  graphql: { bets: string };
  /** Testnets get the dev feed and are hidden from the default network picker. */
  isTestnet: boolean;
};

const PROD_API = "https://api.onchainfeed.org/api/v1/public";
const DEV_API = "https://dev-api.onchainfeed.org/api/v1/public";
const PROD_SOCKET = "wss://streams.onchainfeed.org/v1/streams";
const DEV_SOCKET = "wss://dev-streams.onchainfeed.org/v1/streams";

const SUBGRAPH_SLUG: Record<number, string> = {
  [polygon.id]: "polygon",
  [polygonAmoy.id]: "polygon-amoy-dev",
  [base.id]: "base",
  [baseSepolia.id]: "base-sepolia-dev",
  [chiliz.id]: "chiliz",
  [spicy.id]: "chiliz-spicy-dev",
};

const betsSubgraph = (chainId: number) =>
  `https://thegraph.onchainfeed.org/subgraphs/name/azuro-protocol/azuro-api-${SUBGRAPH_SLUG[chainId]}-v3`;

export const polygonData: ChainData = {
  chain: polygon,
  environment: Environment.PolygonUSDT,
  contracts: {
    lp: "0x0FA7FB5407eA971694652E6E16C12A52625DE1b8",
    core: "0xF9548Be470A4e130c90ceA8b179FCD66D2972AC7",
    relayer: "0x8dA05c0021e6b35865FDC959c54dCeF3A4AbBa9d",
    azuroBet: "0x7A1c3FEf712753374C4DCe34254B96faF2B7265B",
    vault: "0x1a0612FE7D0Def35559a1f71Ff155e344Ae69d2C",
    paymaster: "0xeD5760fC2d2f6d363d73e576173e5e8Ca6A877e1",
    cashout: "0x4a2BB4211cCF9b9eA6eF01D0a61448154ED19095",
  },
  betToken: { address: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F", symbol: "USDT", decimals: 6 },
  api: PROD_API,
  socket: PROD_SOCKET,
  graphql: { bets: betsSubgraph(polygon.id) },
  isTestnet: false,
};

export const polygonAmoyData: ChainData = {
  chain: polygonAmoy,
  environment: Environment.PolygonAmoyUSDT,
  contracts: {
    lp: "0x0a75395Ff15d9557424b632cEBCac448D66F9779",
    core: "0xCD0Db5ef28C3Bd3a69283372dE923Eb4DA0585F6",
    relayer: "0x48c9bE88706F22838070eE7C4bC74Ad7A8eeF114",
    azuroBet: "0x4B75c071dFA5d537979E8b0615Bb97B6337dbFef",
    vault: "0x1Ed6CEEDf7033461a189FD7c3381C34846D7b25a",
    paymaster: "0x2d155962b708c931Fc695F674B415065E78D9F04",
    cashout: "0x7dF132Ad2334a667A004049a75a4a8a530dc24F2",
  },
  betToken: { address: "0xCf1b86ceD971b88C042C64A9c099377e2738073C", symbol: "USDT", decimals: 6 },
  api: DEV_API,
  socket: DEV_SOCKET,
  graphql: { bets: betsSubgraph(polygonAmoy.id) },
  isTestnet: true,
};

export const baseData: ChainData = {
  chain: base,
  environment: Environment.BaseWETH,
  contracts: {
    lp: "0x1eD7368bc515E928A4007cEa61FB8a6F8863Af87",
    core: "0xF40cF1dD7d16C098cff5F8B5650A8FaEf1F4640d",
    relayer: "0xD2D508d66dB4fCE4B384e4C3EA2fa53BA43e73b5",
    azuroBet: "0xF328404Dbc8c997d12dC55a1A179AF7F8cb7df90",
    vault: "0xbA390F464395fC0940c0B9591847ad4E836C7A0c",
    paymaster: "0x4a2BB4211cCF9b9eA6eF01D0a61448154ED19095",
    cashout: "0x6EDff24761F4473611B45BDAe4a779ff31af14Be",
  },
  betToken: { address: "0x4200000000000000000000000000000000000006", symbol: "WETH", decimals: 18 },
  api: PROD_API,
  socket: PROD_SOCKET,
  graphql: { bets: betsSubgraph(base.id) },
  isTestnet: false,
};

export const baseSepoliaData: ChainData = {
  chain: baseSepolia,
  environment: Environment.BaseSepoliaWETH,
  contracts: {
    lp: "0x4fE86EddCC22dc992b7994878169201Ec7ea50AB",
    core: "0x679CC42F69F98631668348d088086359D4217Ffa",
    relayer: "0x2De54cABa6A8198D9Dc51931485Bfdc8017aB0c5",
    azuroBet: "0xD031C4BDd4b7c30e3725132109786B8E158A4c07",
    vault: "0x6910dE58f350CE0A8b42D27004313346A31b3540",
    paymaster: "0xC2577cdcF684C9756f2C81efdA001CbEFEf3Dd92",
    cashout: "0xf52Eb6ec19d81Ea623A7d7Ad397287C0C40f2F37",
  },
  betToken: { address: "0x9e09f213Ff75e53D52e9e777A6567A68683E935f", symbol: "WETH", decimals: 18 },
  api: DEV_API,
  socket: DEV_SOCKET,
  graphql: { bets: betsSubgraph(baseSepolia.id) },
  isTestnet: true,
};

/** Chiliz Chain mainnet — bets settle in WCHZ. */
export const chilizData: ChainData = {
  chain: chiliz,
  environment: Environment.ChilizWCHZ,
  contracts: {
    lp: "0xEf6b12580301b04CD2551182C88623524B6e47b8",
    core: "0xa5061617Ee6565CF48d7f0FEF06910b9fb9dE2b0",
    relayer: "0x81F72B93ABaf061535aaF5D831F05e0CC4084b32",
    azuroBet: "0x3777B4F27F4B36f14454dbB1f79278bcba694B52",
    vault: "0x32696E01c979E3F542EC49D95729f011eF8F3c28",
    paymaster: "0xB3AE923721e8f3345654eFffC09f6F52afC21F4c",
    cashout: "0x3995eebB51793Ee353162E7400DB455B17dE3692",
  },
  betToken: { address: "0x677F7e16C7Dd57be1D4C8aD1244883214953DC47", symbol: "WCHZ", decimals: 18 },
  api: PROD_API,
  socket: PROD_SOCKET,
  graphql: { bets: betsSubgraph(chiliz.id) },
  isTestnet: false,
};

/** Chiliz Spicy testnet. */
export const spicyData: ChainData = {
  chain: spicy,
  environment: Environment.ChilizSpicyWCHZ,
  contracts: {
    lp: "0x431A0993d29eEb0fF7e3FE351A303eF72195431a",
    core: "0x524994dcA5EA2bc979ac5506E7195F28B4c16932",
    relayer: "0x725ec0A9eC9dC993A86d0eFD7fD78929d226AbE7",
    azuroBet: "0xF7815889e5d0635A31eca34390b25d8D2cEeD902",
    vault: "0x2d76265b15081581F7ccD116828F35dA654f0a79",
    paymaster: "0x3df16FB8Dc28F63565AF2815E04a3368360FFd23",
    cashout: "0x7c771a200EcD61A01af992360303f7b1465Cd8e3",
  },
  betToken: { address: "0x721EF6871f1c4Efe730Dce047D40D1743B886946", symbol: "WCHZ", decimals: 18 },
  api: DEV_API,
  socket: DEV_SOCKET,
  graphql: { bets: betsSubgraph(spicy.id) },
  isTestnet: true,
};

export const CHAINS_DATA = {
  [polygon.id]: polygonData,
  [polygonAmoy.id]: polygonAmoyData,
  [base.id]: baseData,
  [baseSepolia.id]: baseSepoliaData,
  [chiliz.id]: chilizData,
  [spicy.id]: spicyData,
} as const;

export type AzuroChainId = keyof typeof CHAINS_DATA;

export const AZURO_CHAIN_IDS = Object.keys(CHAINS_DATA).map(Number) as AzuroChainId[];

export const isAzuroChainId = (chainId: number | undefined): chainId is AzuroChainId =>
  chainId !== undefined && chainId in CHAINS_DATA;

export const getChainData = (chainId: number): ChainData => {
  const data = CHAINS_DATA[chainId as AzuroChainId];

  if (!data) {
    throw new Error(
      `Azuro is not deployed on chain ${chainId}. Supported: ${AZURO_CHAIN_IDS.join(", ")}.`,
    );
  }

  return data;
};

/**
 * Default network. Chiliz first when the operator opts in — the fan-token chain is the
 * differentiator for a sports product — otherwise Polygon, which has the deepest liquidity.
 */
export const DEFAULT_CHAIN_ID: AzuroChainId =
  process.env.NEXT_PUBLIC_DEFAULT_CHAIN === "chiliz"
    ? chiliz.id
    : process.env.NEXT_PUBLIC_DEFAULT_CHAIN === "base"
      ? base.id
      : polygon.id;

export const SHOW_TESTNETS = process.env.NEXT_PUBLIC_SHOW_TESTNETS === "true";

export const VISIBLE_CHAINS = AZURO_CHAIN_IDS.filter(
  (id) => SHOW_TESTNETS || !CHAINS_DATA[id].isTestnet,
);

/**
 * Address credited with GGR on every bet this front end places. Azuro pays affiliate
 * rewards to whoever is named here, so an operator must set it to their own wallet.
 */
export const AFFILIATE_ADDRESS = (process.env.NEXT_PUBLIC_AFFILIATE_ADDRESS ??
  "0x0000000000000000000000000000000000000000") as Address;

/** Free-text field signed alongside a bet; shown by wallets so the user sees what they sign. */
export const BET_ATTENTION =
  "By signing this transaction, I confirm I am not a resident of a restricted jurisdiction and I accept the terms of service.";

export const TYPED_DATA_DOMAIN_NAME = "Live Betting";
export const TYPED_DATA_DOMAIN_VERSION = "1.0.0";
export const CASHOUT_TYPED_DATA_DOMAIN_NAME = "Cash Out";
export const CASHOUT_TYPED_DATA_DOMAIN_VERSION = "1.0.0";

export const CLIENT_DATA_TYPES = [
  { name: "attention", type: "string" },
  { name: "affiliate", type: "address" },
  { name: "core", type: "address" },
  { name: "expiresAt", type: "uint256" },
  { name: "chainId", type: "uint256" },
  { name: "relayerFeeAmount", type: "uint256" },
  { name: "isFeeSponsored", type: "bool" },
  { name: "isBetSponsored", type: "bool" },
  { name: "isSponsoredBetReturnable", type: "bool" },
] as const;

export const BET_DATA_TYPES = {
  ClientBetData: [
    { name: "clientData", type: "ClientData" },
    { name: "bets", type: "SubBet[]" },
  ],
  ClientData: CLIENT_DATA_TYPES,
  SubBet: [
    { name: "conditionId", type: "uint256" },
    { name: "outcomeId", type: "uint128" },
    { name: "minOdds", type: "uint64" },
    { name: "amount", type: "uint128" },
    { name: "nonce", type: "uint256" },
  ],
} as const;

export const COMBO_BET_DATA_TYPES = {
  ClientComboBetData: [
    { name: "clientData", type: "ClientData" },
    { name: "minOdds", type: "uint64" },
    { name: "amount", type: "uint128" },
    { name: "nonce", type: "uint256" },
    { name: "bets", type: "ComboPart[]" },
  ],
  ClientData: CLIENT_DATA_TYPES,
  ComboPart: [
    { name: "conditionId", type: "uint256" },
    { name: "outcomeId", type: "uint128" },
  ],
} as const;

export const CASHOUT_DATA_TYPES = {
  CashOutItem: [
    { name: "betId", type: "uint256" },
    { name: "bettingContract", type: "address" },
    { name: "minOdds", type: "uint64" },
  ],
  CashOutOrder: [
    { name: "attention", type: "string" },
    { name: "chainId", type: "uint256" },
    { name: "items", type: "CashOutItem[]" },
    { name: "expiresAt", type: "uint64" },
  ],
} as const;
