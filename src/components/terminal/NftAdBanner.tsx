import { useEffect, useRef, useState } from "react";
import { WhitelistModal } from "./WhitelistModal";

/**
 * The 1190 mint-day banner: swipes up into the analytics header, holds for a
 * few seconds, then swipes back out and gives the space up.
 *
 * It SWIPES rather than fades because the slot sits beside a wall of live
 * numbers that are already changing on their own — a fade there reads as
 * another value ticking over. Upward motion is the one thing on that screen
 * that isn't a number changing, so it registers as an announcement.
 *
 * And it LEAVES. A permanent banner over live financial data is the thing every
 * trader learns to look past within a minute; one that appears, says its piece
 * and vacates keeps working on the tenth showing. The layout collapses smoothly
 * behind it rather than jumping, so the header doesn't lurch every cycle.
 *
 * Clicking opens the whitelist modal, where the mint details and the claimed
 * count live.
 */

/** On screen long enough to read the headline and the date, and no longer. */
const SHOW_MS = 6_000;
/** Quiet gap before it comes back. */
const HIDE_MS = 34_000;
/** Matches the collapse transition below, so unmount waits for the animation. */
const EXIT_MS = 420;

type Phase = "in" | "out" | "gone";

export function NftAdBanner({ className = "" }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>("in");
  const [cycle, setCycle] = useState(0);
  const [onScreen, setOnScreen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  // Only run the cycle while the header is actually in view. A banner that
  // shows and hides behind the fold has spent its appearance on nobody, and
  // would be "gone" by the time anyone scrolled up to it.
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setOnScreen(true);
      return;
    }
    const io = new IntersectionObserver((e) => setOnScreen(e[0]?.isIntersecting ?? false), {
      threshold: 0.2,
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // in → (SHOW_MS) → out → (EXIT_MS) → gone → (HIDE_MS) → in …
  // Paused whenever the modal is open, so it can't vanish out from under
  // someone who is reading it.
  useEffect(() => {
    if (!onScreen || open) return;
    const delay = phase === "in" ? SHOW_MS : phase === "out" ? EXIT_MS : HIDE_MS;
    const id = setTimeout(() => {
      setPhase((p) => (p === "in" ? "out" : p === "out" ? "gone" : "in"));
      if (phase === "gone") setCycle((c) => c + 1);
    }, delay);
    return () => clearTimeout(id);
  }, [phase, onScreen, open]);

  const showing = phase !== "gone";

  return (
    <>
      {/* The wrapper always exists so the IntersectionObserver has something to
          watch, and it animates its own height so the header settles rather
          than snapping shut when the banner leaves. */}
      <div
        ref={ref}
        aria-hidden={!showing}
        className={`overflow-hidden transition-[max-height,opacity,margin] duration-[420ms] ease-[cubic-bezier(0.22,1,0.36,1)] ${
          showing ? "max-h-[240px] opacity-100" : "pointer-events-none max-h-0 opacity-0"
        } ${className}`}
      >
        <button
          onClick={() => setOpen(true)}
          aria-label="1190 NFT mint day — whitelist mint details"
          // overflow-hidden is what makes it a swipe rather than a slide: the
          // art travels up from below the frame and is clipped until it lands.
          className="group relative block w-full overflow-hidden rounded-xl border border-border bg-surface transition-shadow hover:shadow-[0_0_0_1px_var(--primary)]"
        >
          {/* The upload is 1344x752 and 1.2 MB — hero-sized for a 340px slot on
              the page every visitor lands on. These are the same art at 800px:
              40 KB WebP, 208 KB PNG fallback. nftad.png stays as the source. */}
          <picture>
            <source srcSet="/nftad.webp" type="image/webp" />
            <img
              // Re-keying restarts the CSS animation. Cheaper and steadier than
              // toggling a class, which drops a frame at the reset.
              key={cycle}
              src="/nftad-800.png"
              alt="1190 NFT mint day — whitelist mint"
              width={1344}
              height={752}
              className={`${phase === "out" ? "swipe-out" : "swipe-up"} block h-auto w-full`}
              loading="lazy"
              decoding="async"
            />
          </picture>
          {/* A hairline sheen travelling with the art, so the motion reads as
              one object arriving rather than an image being revealed. */}
          {phase === "in" && (
            <span
              key={`sheen-${cycle}`}
              aria-hidden="true"
              className="swipe-sheen pointer-events-none absolute inset-0"
            />
          )}
        </button>
      </div>

      {open && <WhitelistModal onClose={() => setOpen(false)} />}
    </>
  );
}
