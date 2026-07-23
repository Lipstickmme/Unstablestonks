// Client-side simulated on-chain feed. In production this is derived from
// factory TokenLaunched events + pool Swap events on Robinhood Chain (4663).
// The shape mirrors what would come off `slot0`, swap logs, graduationStatus,
// and the token's socials() view so components can be swapped to real RPC
// without changing their interface.

export type TokenStatus = "new" | "trending" | "graduating" | "graduated" | "cto";

export interface Social {
  twitter?: string;
  telegram?: string;
  website?: string;
  farcaster?: string;
}

export interface TokenRow {
  address: string;
  name: string;
  symbol: string;
  logo: string; // emoji placeholder
  ageMinutes: number;
  price: number; // USD
  priceChange1h: number;
  priceChange24h: number;
  mcap: number;
  fdv: number;
  vol5m: number;
  vol1h: number;
  vol6h: number;
  vol24h: number;
  buys24h: number;
  sells24h: number;
  liquidityEth: number;
  graduationPct: number; // 0..100
  holders: number;
  topHolderPct: number;
  deployer: string;
  status: TokenStatus[];
  socialHeat: number; // 0..100
  ctoAt?: number; // ms since epoch
  lockedLiquidity: boolean;
  feeSplit: "70/30" | "90/10";
  restrictionsEndBlock?: number;
  socials: Social;
  lastTradeMs: number;
}

const SYMBOLS = [
  ["PEPO", "Pepo Coin", "🐸"], ["MOON", "Moonshot", "🌕"], ["ROBIN", "Robin", "🐦"],
  ["FUD", "FUD Killer", "💀"], ["CHAD", "Chad", "🗿"], ["WOJK", "Wojak", "😔"],
  ["GIGA", "Gigachad", "💪"], ["APE", "Apecoin", "🦍"], ["DGN", "Degen", "🎲"],
  ["FRENS", "Frens", "🤝"], ["BONK", "Bonk", "🔨"], ["MEME", "Meme Lord", "👑"],
  ["ANON", "Anonymous", "🎭"], ["SHIB", "Shiblet", "🐕"], ["FLOKI", "Floki Jr", "⚔️"],
  ["TURBO", "Turbo", "⚡"], ["ROCK", "Rocket", "🚀"], ["BRETT", "Brett", "🧢"],
  ["MOG", "Mog", "😼"], ["TOAD", "Toady", "🐸"], ["NORM", "Normie", "👔"],
  ["BASED", "Based", "🔵"], ["CULT", "Cult", "👁️"], ["VIBE", "Vibes", "🎵"],
];

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

function addr(r: () => number) {
  const hex = "0123456789abcdef";
  let out = "0x";
  for (let i = 0; i < 40; i++) out += hex[Math.floor(r() * 16)];
  return out;
}

export function shortAddr(a: string) {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

export function formatUSD(n: number) {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(2)}K`;
  if (n >= 1) return `$${n.toFixed(2)}`;
  if (n >= 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(6)}`;
}

export function formatNum(n: number) {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(2)}K`;
  return n.toFixed(0);
}

export function formatAge(min: number) {
  if (min < 1) return "just now";
  if (min < 60) return `${Math.floor(min)}m`;
  if (min < 60 * 24) return `${Math.floor(min / 60)}h ${Math.floor(min % 60)}m`;
  return `${Math.floor(min / (60 * 24))}d`;
}

export function generateTokens(count = 42): TokenRow[] {
  const r = rng(0xC0FFEE);
  const now = Date.now();
  return Array.from({ length: count }, (_, i) => {
    const [sym, name, logo] = SYMBOLS[i % SYMBOLS.length];
    const age = Math.floor(r() * 60 * 72); // up to 72h
    const price = Math.pow(10, -6 + r() * 5) * (r() + 0.1);
    const mcap = price * (1e6 + r() * 5e8);
    const vol24h = mcap * (0.05 + r() * 4);
    const status: TokenStatus[] = [];
    const gradPct = Math.min(100, r() * 130);
    if (age < 30) status.push("new");
    if (r() > 0.75) status.push("trending");
    if (gradPct > 65 && gradPct < 100) status.push("graduating");
    if (gradPct >= 100) status.push("graduated");
    const ctoAt = r() > 0.85 ? now - Math.floor(r() * 1000 * 60 * 60 * 20) : undefined;
    if (ctoAt) status.push("cto");
    return {
      address: addr(r),
      name: `${name} ${i > SYMBOLS.length ? Math.floor(i / SYMBOLS.length) : ""}`.trim(),
      symbol: sym + (i > SYMBOLS.length - 1 ? String(i - SYMBOLS.length + 2) : ""),
      logo,
      ageMinutes: age,
      price,
      priceChange1h: (r() - 0.45) * 60,
      priceChange24h: (r() - 0.4) * 300,
      mcap,
      fdv: mcap * (1 + r() * 0.4),
      vol5m: vol24h * (0.005 + r() * 0.05),
      vol1h: vol24h * (0.03 + r() * 0.15),
      vol6h: vol24h * (0.2 + r() * 0.4),
      vol24h,
      buys24h: Math.floor(200 + r() * 4000),
      sells24h: Math.floor(150 + r() * 3800),
      liquidityEth: 0.5 + r() * 30,
      graduationPct: gradPct >= 100 ? 100 : gradPct,
      holders: Math.floor(50 + r() * 12000),
      topHolderPct: 3 + r() * 35,
      deployer: addr(r),
      status: status.length ? status : ["trending"],
      socialHeat: Math.floor(r() * 100),
      ctoAt,
      lockedLiquidity: r() > 0.15,
      feeSplit: r() > 0.3 ? "70/30" : "90/10",
      restrictionsEndBlock: age < 20 ? 8991118 + Math.floor(r() * 500) : undefined,
      socials: {
        twitter: r() > 0.2 ? `https://x.com/${sym.toLowerCase()}` : undefined,
        telegram: r() > 0.4 ? `https://t.me/${sym.toLowerCase()}` : undefined,
        website: r() > 0.5 ? `https://${sym.toLowerCase()}.xyz` : undefined,
      },
      lastTradeMs: now - Math.floor(r() * 60000),
    };
  });
}

export interface TradeEvent {
  id: string;
  tokenAddress: string;
  symbol: string;
  side: "buy" | "sell";
  amountUsd: number;
  priceImpact: number;
  wallet: string;
  ms: number;
}

export function generateTrades(tokens: TokenRow[], count = 30): TradeEvent[] {
  const r = rng(0xBADF00D);
  const now = Date.now();
  return Array.from({ length: count }, (_, i) => {
    const t = tokens[Math.floor(r() * tokens.length)];
    return {
      id: `${i}-${now}`,
      tokenAddress: t.address,
      symbol: t.symbol,
      side: r() > 0.48 ? "buy" : "sell",
      amountUsd: 20 + r() * 25000,
      priceImpact: r() * 4,
      wallet: `0x${Math.floor(r() * 16 ** 8).toString(16).padStart(8, "0")}…`,
      ms: now - i * (500 + r() * 1500),
    };
  });
}
