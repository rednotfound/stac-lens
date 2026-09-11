export type StacObjectKind = 'Catalog' | 'Collection' | 'Item' | 'Asset'

/** Hand-drawn, minimal glyphs for the four kinds of object this app ever
 *  shows — not an icon-library import (this project deliberately has no
 *  UI component library, see `tokens.css`'s own header comment), so each
 *  is a small, deliberately simple SVG matching the rest of the app's
 *  thin-stroke, no-fill visual language. Asked for directly: "把这个三个
 *  层级...Collection,Catalog,Item,和Asset,都用一些...简单的icon去代替...用
 *  一个icon去,非常明显地就告诉大家这也是一个什么东西" (give these levels —
 *  Collection, Catalog, Item, Asset — simple icons, so an icon alone makes
 *  obvious what kind of thing you're looking at) — for a project explicitly
 *  aimed at helping people unfamiliar with STAC's own vocabulary, not just
 *  STAC experts.
 *
 *  Deliberately distinct metaphors, not just four colored circles: a
 *  folder (Catalog — an organizing container of sub-Catalogs/Collections),
 *  a stack (Collection — a themed set of many Items sharing one extent/
 *  schema), a single photo frame (Item — one concrete spatiotemporal
 *  scene), a file with a folded corner (Asset — one concrete downloadable
 *  file). Color still carries the same meaning as everywhere else in the
 *  app (Structure Lens's own tree-node colors, reused verbatim for
 *  Catalog/Collection/Item) — the icon is an *additional*, shape-based
 *  signal on top of color, not a replacement for it, since color alone
 *  doesn't help someone who can't first learn "teal means Collection." */
export function TypeIcon({
  type,
  size = 16,
  color = 'currentColor',
}: {
  type: StacObjectKind
  size?: number
  color?: string
}) {
  const common = {
    width: size,
    height: size,
    viewBox: '0 0 20 20',
    fill: 'none' as const,
    stroke: color,
    strokeWidth: 1.4,
    strokeLinejoin: 'round' as const,
    strokeLinecap: 'round' as const,
  }

  if (type === 'Catalog') {
    return (
      <svg {...common} aria-hidden="true">
        <path d="M3 6.5C3 5.67 3.67 5 4.5 5H8.3l1.5 1.5h5.7c.83 0 1.5.67 1.5 1.5v6.5c0 .83-.67 1.5-1.5 1.5h-11C3.67 16 3 15.33 3 14.5V6.5Z" />
      </svg>
    )
  }

  if (type === 'Collection') {
    return (
      <svg {...common} aria-hidden="true">
        <rect x="7" y="2.5" width="10" height="9" rx="1.4" opacity={0.5} />
        <rect x="4.5" y="5" width="10" height="9" rx="1.4" opacity={0.75} />
        <rect x="2" y="7.5" width="10" height="9" rx="1.4" />
      </svg>
    )
  }

  if (type === 'Item') {
    return (
      <svg {...common} aria-hidden="true">
        <rect x="3" y="4" width="14" height="12" rx="1.5" />
        <circle cx="7.4" cy="8" r="1.2" />
        <path d="M4 14.2 8.4 10 11.5 12.5 14 10.2 16.3 13" />
      </svg>
    )
  }

  // Asset
  return (
    <svg {...common} aria-hidden="true">
      <path d="M5.5 3H11.5l3.5 3.5V17h-9.5V3Z" />
      <path d="M11.5 3v3.5H15" />
    </svg>
  )
}
