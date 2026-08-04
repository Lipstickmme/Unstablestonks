import { useEffect, useRef, useState } from "react";
import { WhitelistModal } from "./WhitelistModal";

/**
 * The 1190 mint-day banner, in the empty band at the top-right of the analytics
 * header.
 *
 * It SWIPES UP rather than fading: the slot is beside a wall of live numbers
 * that are already changing on their own, and a fade there reads as another
 * value ticking over. Upward motion is the one thing on this screen that isn't
 * a number changing, so it registers as an announcement.
 *
 * The swipe repeats on a slow cycle. A single entrance animation is missed by
 * anyone who arrives mid-scroll or switches back to the tab, and this banner
 * has to keep working for a visitor who has been staring at the terminal for
 * ten minutes. It is deliberately slow and infrequent — a banner that moves
 * often is an irritation, and an irritation gets ignored.
 *
 * Clicking opens the whitelist modal, which is where the mint details and the
 * claimed count live.
 */

/** How long between swipes. Long enough that it never feels like a carousel. */
const REPEAT_MS = 22_000;

export function NftAdBanner({ className = "" }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const [cycle, setCycle] = useState(0);
  const [visible, setVisible] = useState(false);
  const ref = useRef<HTMLButtonElement | null>(null);

  // Only animate while it's actually on screen. Swiping a banner nobody can see
  // burns frames and, worse, means the one swipe a visitor WOULD have seen has
  // already happened by the time they scroll to it.
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => setVisible(entries[0]?.isIntersecting ?? false),
      {
        threshold: 0.4,
      },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!visible) return;
    const id = setInterval(() => setCycle((c) => c + 1), REPEAT_MS);
    return () => clearInterval(id);
  }, [visible]);

  return (
    <>
      <button
        ref={ref}
        onClick={() => setOpen(true)}
        aria-label="1190 NFT mint day — whitelist mint details"
        // overflow-hidden is what makes it a swipe rather than a slide: the art
        // travels up from below the frame and is clipped until it arrives.
        className={`group relative block overflow-hidden rounded-xl border border-border bg-surface transition-shadow hover:shadow-[0_0_0_1px_var(--primary)] ${className}`}
      >
        {/* The uploaded original is 1344x752 and 1.2 MB — a hero-sized file for
            a slot 340px wide, on the page every visitor lands on. These are the
            same art resized to 800px: 40 KB as WebP, 208 KB as a PNG for the
            handful of clients that still need one. nftad.png stays in the repo
            as the source to regenerate from. */}
        <picture>
          <source srcSet="/nftad.webp" type="image/webp" />
          <img
            // Re-keying on the cycle restarts the CSS animation. Cheaper and
            // steadier than toggling a class, which drops a frame at the reset.
            key={cycle}
            src="/nftad-800.png"
            alt="1190 NFT mint day — whitelist mint"
            width={1344}
            height={752}
            className="swipe-up block h-auto w-full"
            loading="lazy"
            decoding="async"
          />
        </picture>
        {/* A hairline sheen that follows the art up, so the motion reads as one
            object arriving rather than an image being revealed. */}
        <span
          key={`sheen-${cycle}`}
          aria-hidden="true"
          className="swipe-sheen pointer-events-none absolute inset-0"
        />
      </button>

      {open && <WhitelistModal onClose={() => setOpen(false)} />}
    </>
  );
}
