interface BrandLockupProps {
  /** Show the full wordmark alongside the monogram (default true). */
  showWordmark?: boolean;
  /** Size in pixels for the monogram square. */
  size?: number;
}

/**
 * Brand lockup — violet "gt" monogram + "gitteam" wordmark in mono.
 * The monogram is a rounded square; wordmark sits inline when showWordmark is true.
 */
export function BrandLockup({ showWordmark = true, size = 24 }: BrandLockupProps) {
  const fontSize = Math.round(size * 0.5);
  return (
    <span className="flex items-center gap-2">
      <span
        className="flex items-center justify-center shrink-0"
        style={{
          width: size,
          height: size,
          borderRadius: Math.round(size * 0.3),
          background: "var(--accent)",
          color: "#ffffff",
          fontFamily: "var(--font-mono)",
          fontWeight: 700,
          fontSize,
          lineHeight: 1,
        }}
        aria-hidden="true"
      >
        gt
      </span>
      {showWordmark ? (
        <span
          className="font-mono font-semibold"
          style={{
            color: "var(--fg)",
            fontSize: size * 0.6,
            letterSpacing: "-0.025em",
            lineHeight: 1,
          }}
        >
          gitteam
        </span>
      ) : null}
    </span>
  );
}