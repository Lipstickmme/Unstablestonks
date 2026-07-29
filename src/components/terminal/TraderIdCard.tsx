import { BRAND_IMAGE_URL } from "@/config/brand";
import { shortAddr } from "@/lib/format";
import { cardNumber } from "@/lib/whitelist";

/**
 * Institutional Trader ID — silvery black.
 *
 * Built in DOM rather than rendered to an image so the metallic gradients stay
 * crisp at any density and it costs no canvas work; sharing is a screenshot or
 * the intent links beside it.
 */
export function TraderIdCard({
  wallet,
  spot,
  issuedAt,
  chainName,
}: {
  wallet: string;
  spot: number;
  issuedAt: number;
  chainName: string;
}) {
  const issued = new Date(issuedAt).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
  });

  return (
    <div
      className="relative overflow-hidden rounded-2xl p-[1px]"
      style={{
        background:
          "linear-gradient(135deg, #d9dde3 0%, #6b7280 18%, #1c1d21 40%, #9aa2ad 62%, #2a2c31 82%, #e5e7eb 100%)",
      }}
    >
      <div
        className="relative rounded-2xl px-4 py-4"
        style={{ background: "linear-gradient(150deg, #121316 0%, #0a0a0c 55%, #17181c 100%)" }}
      >
        {/* Brushed-metal sheen */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.07]"
          style={{
            background:
              "repeating-linear-gradient(115deg, #fff 0px, #fff 1px, transparent 1px, transparent 4px)",
          }}
        />

        <div className="relative flex items-start justify-between gap-3">
          <div>
            <div
              className="text-[9px] font-semibold uppercase tracking-[0.22em]"
              style={{
                background: "linear-gradient(90deg,#f3f4f6,#9ca3af,#f3f4f6)",
                WebkitBackgroundClip: "text",
                backgroundClip: "text",
                color: "transparent",
              }}
            >
              Institutional Trader
            </div>
            <div className="mt-0.5 text-[10px] uppercase tracking-[0.18em] text-zinc-500">
              UnstableStonks
            </div>
          </div>
          <img
            src={BRAND_IMAGE_URL}
            alt=""
            width={34}
            height={34}
            className="h-[34px] w-[34px] rounded-md object-cover ring-1 ring-zinc-700"
          />
        </div>

        <div className="relative mt-5 flex items-end justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[9px] uppercase tracking-[0.18em] text-zinc-500">Holder</div>
            <div className="num truncate text-sm font-medium text-zinc-100">
              {shortAddr(wallet)}
            </div>
          </div>
          <div className="text-right">
            <div className="text-[9px] uppercase tracking-[0.18em] text-zinc-500">Member</div>
            <div
              className="num text-2xl font-light leading-none"
              style={{
                background: "linear-gradient(180deg,#ffffff,#8b93a1)",
                WebkitBackgroundClip: "text",
                backgroundClip: "text",
                color: "transparent",
              }}
            >
              #{cardNumber(spot)}
            </div>
          </div>
        </div>

        <div className="relative mt-4 flex items-center justify-between border-t border-zinc-800 pt-2 text-[9px] uppercase tracking-[0.14em] text-zinc-500">
          <span>{chainName}</span>
          <span className="num">Issued {issued}</span>
        </div>
      </div>
    </div>
  );
}
