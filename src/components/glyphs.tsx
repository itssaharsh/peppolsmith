// The three custom glyphs: audit tick, red-pencil ring, and the network-off mark.

export function Tick({ size = 16, className = "", draw = false }: { size?: number; className?: string; draw?: boolean }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      aria-hidden="true"
      className={`inline-block shrink-0 text-success ${draw ? "draw" : ""} ${className}`}
    >
      <path d="M3 10.5 L8 15.5 L17.5 3.5" pathLength={1} fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const RING = "M8 34 C8 14 40 6 66 7 C96 8 114 18 112 32 C110 48 80 55 54 54 C28 53 8 46 10 30 C11 22 18 16 26 13";

/** Absolutely positioned over its parent (parent must be relative). */
export function Ring({
  scale = 1.35,
  width = 3,
  delay = 0,
  minAspect = 1.6,
}: {
  scale?: number;
  width?: number;
  delay?: number;
  /** the ring is never narrower than minAspect x its height, so a single digit still gets an ellipse */
  minAspect?: number;
}) {
  const pad = ((scale - 1) / 2) * 100;
  return (
    <svg
      viewBox="0 0 120 60"
      preserveAspectRatio="none"
      aria-hidden="true"
      className="ring-reveal pointer-events-none absolute text-hold"
      style={{
        left: "50%",
        top: `-${pad}%`,
        width: `max(${scale * 100}%, calc(${scale * minAspect} * var(--ring-h, 1em)))`,
        height: `${scale * 100}%`,
        transform: "translateX(-50%) rotate(-4deg)",
        overflow: "visible",
        animationDelay: `${delay}ms`,
      }}
    >
      <path
        d={RING}
        fill="none"
        stroke="currentColor"
        strokeWidth={width}
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

/** Small inline ring, used as a legend mark and in the residue line. */
export function MiniRing({ className = "" }: { className?: string }) {
  return (
    <svg width={22} height={12} viewBox="0 0 120 60" aria-hidden="true" className={`inline-block shrink-0 text-hold ${className}`}>
      <path d={RING} fill="none" stroke="currentColor" strokeWidth={9} strokeLinecap="round" />
    </svg>
  );
}
