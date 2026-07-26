/**
 * A suspension bridge.
 *
 * lucide has no bridge glyph, and every near-miss it does have reads as
 * something else: Repeat and ArrowLeftRight are the universal swap symbols,
 * Route and Waypoints mean navigation, Cable means a connector. Drawing the
 * actual object removes the ambiguity.
 *
 * Built to lucide's conventions — 24x24 box, stroke-only, currentColor,
 * round caps — so it sits correctly beside the other icons in the header.
 */
export function BridgeIcon({
  className = "",
  size = 24,
  strokeWidth = 2,
}: {
  className?: string;
  size?: number | string;
  strokeWidth?: number;
}) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {/* Deck */}
      <path d="M2 16h20" />
      {/* Towers */}
      <path d="M7 16V7" />
      <path d="M17 16V7" />
      {/* Main cable: anchored at both banks, sagging between the towers */}
      <path d="M2 11l5-4" />
      <path d="M7 7q5 7 10 0" />
      <path d="M17 7l5 4" />
    </svg>
  );
}
