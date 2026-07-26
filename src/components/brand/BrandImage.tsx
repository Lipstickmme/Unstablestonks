import { useState, type ReactNode } from "react";

/**
 * A brand asset that degrades instead of leaving a hole.
 *
 * Every logo here is a static file, and a missing or mis-cased path fails
 * silently in the browser — `stonkslogo.PNG` is served case-sensitively in
 * production even though it resolves on a case-insensitive dev machine. So each
 * one renders a real fallback (the letter badge, the vector mark) rather than a
 * broken-image glyph.
 */
export function BrandImage({
  src,
  alt,
  fallback,
  className = "",
}: {
  src?: string;
  alt: string;
  /** Rendered instead when `src` is absent or fails to load. */
  fallback: ReactNode;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) return <>{fallback}</>;
  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
      className={className}
    />
  );
}
