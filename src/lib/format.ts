export function shortAddr(a: string) {
  if (!a) return "—";
  if (a.length <= 12) return a;
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

export function formatUSD(n: number) {
  if (!isFinite(n)) return "$0.00";
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(2)}K`;
  if (n >= 1) return `$${n.toFixed(2)}`;
  if (n >= 0.01) return `$${n.toFixed(4)}`;
  if (n > 0) return `$${n.toFixed(8).replace(/0+$/, "").padEnd(4, "0")}`;
  return "$0.00";
}

export function formatNum(n: number) {
  if (!isFinite(n)) return "0";
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(2)}K`;
  return n.toFixed(0);
}

export function formatAge(min: number) {
  if (!isFinite(min) || min < 0) return "—";
  if (min < 1) return "just now";
  if (min < 60) return `${Math.floor(min)}m`;
  if (min < 60 * 24) return `${Math.floor(min / 60)}h ${Math.floor(min % 60)}m`;
  return `${Math.floor(min / (60 * 24))}d`;
}

export function formatCompactToken(n: number) {
  if (!isFinite(n)) return "0";
  return n.toLocaleString(undefined, { maximumFractionDigits: n < 1 ? 6 : 4 });
}
