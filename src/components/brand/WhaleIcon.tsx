/**
 * A whale.
 *
 * lucide has fish and waves but no whale, and an emoji was ruled out — it
 * renders differently on every platform and can't inherit currentColor, so it
 * would fight the table's colour scheme. Drawn to lucide's conventions (24x24
 * box, stroke-only, currentColor, round caps) so it sits correctly beside the
 * other icons.
 *
 * Deliberately simple: body, fluke, spout. Anything finer turns to mush at the
 * 12–14px this renders at in a table cell.
 */
export function WhaleIcon({
  className = "",
  size = 24,
  strokeWidth = 1.75,
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
      {/* Body */}
      <path d="M2.5 14.5a6.5 4.5 0 0 1 13 0 6.5 4.5 0 0 1-13 0Z" />
      {/* Tail fluke */}
      <path d="M15.5 14.5c1.7-.9 3.2-2.2 4.3-3.9v7.8c-1.1-1.7-2.6-3-4.3-3.9Z" />
      {/* Spout */}
      <path d="M6.5 10V8.5" />
      <path d="M5 7.6 5.7 6.4" />
      <path d="M8 7.6 7.3 6.4" />
    </svg>
  );
}
