import { Clock } from "lucide-react";

export function Soon({ label = "coming soon" }: { label?: string }) {
  return (
    <span
      title="Requires PONS factory / off-chain intelligence — wiring in progress"
      className="inline-flex items-center gap-1 rounded-full border border-dashed border-border bg-surface px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider text-muted-foreground"
    >
      <Clock className="h-2.5 w-2.5" />
      {label}
    </span>
  );
}

export function TokenIcon({
  iconUrl,
  symbol,
  size = 36,
}: {
  iconUrl?: string | null;
  symbol: string;
  size?: number;
}) {
  const dim = { width: size, height: size };
  if (iconUrl) {
    return (
      <img
        src={iconUrl}
        alt=""
        style={dim}
        loading="lazy"
        onError={(e) => {
          (e.currentTarget as HTMLImageElement).style.display = "none";
        }}
        className="flex-shrink-0 rounded-full bg-secondary object-cover"
      />
    );
  }
  return (
    <div
      style={dim}
      className="grid flex-shrink-0 place-items-center rounded-full bg-secondary font-mono text-xs font-medium text-foreground/80"
    >
      {symbol.slice(0, 3).toUpperCase()}
    </div>
  );
}
