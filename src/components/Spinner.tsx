/** A single hand-drawn spinner used for every loading indicator in the
 *  app — this is itself an `<svg>`, so it drops directly into ordinary
 *  HTML flow *or* nests inside another `<svg>` (Structure Lens's tree,
 *  positioned via plain x/y attributes) without needing two different
 *  implementations. Rotates via the shared `stac-lens-spin` keyframe
 *  (design/tokens.css) rather than a per-instance animation. */
export function Spinner({
  size = 14,
  color = 'currentColor',
  strokeWidth = 2,
  x,
  y,
}: {
  size?: number
  color?: string
  strokeWidth?: number
  /** Only meaningful when nested inside another `<svg>` (a plain HTML
   *  parent ignores a nested `<svg>`'s own x/y) — positions this spinner
   *  within the parent's coordinate space the same way a sibling `<text
   *  dx dy>` there already is. */
  x?: number
  y?: number
}) {
  const r = (size - strokeWidth) / 2
  const c = size / 2
  const circumference = 2 * Math.PI * r
  return (
    <svg
      x={x}
      y={y}
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      style={{ animation: 'stac-lens-spin 0.8s linear infinite', flexShrink: 0 }}
      aria-hidden="true"
    >
      <circle
        cx={c}
        cy={c}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        // A fixed ~28%-of-circumference arc, not a full ring — a ring
        // spinning in place doesn't read as motion at all (rotational
        // symmetry hides it), an arc's leading/trailing ends make the spin
        // actually visible.
        strokeDasharray={`${circumference * 0.28} ${circumference}`}
      />
    </svg>
  )
}
