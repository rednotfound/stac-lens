import logoUrl from '../assets/stac-lens-logo.svg'

/** The STAC Lens mark — the STAC logo's three nested squares (its own
 *  three brand colors, one per level: Catalog, Collection, Item) with a
 *  lens over them. One SVG, drawn by the user, used at every size: header
 *  and landing title here, `public/favicon.svg` and the PNG icons for
 *  browsers/home screens (rendered from the same file). */
export function Logo({ size }: { size: number }) {
  return (
    <img
      src={logoUrl}
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
      style={{ display: 'block', flexShrink: 0 }}
    />
  )
}
