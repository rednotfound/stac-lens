import { linkHorizontal } from 'd3-shape'
import { classifyNodeShape, type StacNode } from '../../stac/types'
import type { StacObjectKind } from '../TypeIcon'

/** A node has Items to browse in an Item Set box: a non-empty static
 *  `rel:item` list, or a cursor (API) source, which is assumed non-empty
 *  until queried — the same convention `classifyNodeShape` uses. */
export function hasDirectItems(node: StacNode): boolean {
  const shape = classifyNodeShape(node)
  return shape === 'leaf-items' || shape === 'mixed'
}

/** Vertical spacing between sibling rows. Measured, not eyeballed: a label
 *  plus its badge line spans about 31px, so the earlier 26px overlapped
 *  adjacent badged siblings by 5px (checked with `getBoundingClientRect`
 *  on Earth Search's ten API-tagged root children). 38 leaves real air. */
export const ROW_HEIGHT = 38
/** Horizontal distance between tree levels. */
export const LEVEL_WIDTH = 320
export const LABEL_MAX_CHARS = 40

export function truncateLabel(label: string, maxChars: number = LABEL_MAX_CHARS): string {
  return label.length > maxChars ? `${label.slice(0, maxChars - 1)}…` : label
}

/** `[text](url)` → `text`. STAC descriptions are Markdown, and a raw URL is
 *  dead weight in a one-line hover snippet (Planetary Computer's Sentinel-2
 *  description opens with a link whose URL alone ate most of the snippet).
 *  Only link syntax is stripped — other Markdown reads fine as plain
 *  characters — and the Inspector still shows the untouched source. */
export function stripMarkdownLinks(text: string): string {
  return text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
}

export const LABEL_FONT_SIZE = 12
// Rough average glyph width for a proportional sans-serif at this size —
// not pixel-exact, but enough to place the Item Set box past the *end* of a
// long Collection title instead of on top of it. A fixed gap from the
// label's start could not: a 40-character title runs about 280px.
const AVG_CHAR_WIDTH_RATIO = 0.6
export function estimateTextWidth(text: string, fontSize: number): number {
  return text.length * fontSize * AVG_CHAR_WIDTH_RATIO
}

/** Tree links and box connectors share one generator. d3-hierarchy lays a
 *  tree out with x vertical and y horizontal; this swaps them back for a
 *  left-to-right tree. Every consumer passes points in that same swapped
 *  `{ x: vertical, y: horizontal }` convention. */
export const linkGenerator = linkHorizontal<unknown, { x: number; y: number }>()
  .x((d) => d.y)
  .y((d) => d.x)

/** The one rule for "may d3-zoom start a pan/zoom gesture here?". Any
 *  element carrying this attribute — a node's click target, a box and
 *  everything inside it — is excluded in `zoom.filter()`, at the moment a
 *  gesture would start and for every event type d3-zoom listens to. This
 *  replaced per-element `stopPropagation()` calls, which covered the wrong
 *  event types and let the canvas pan while a node was being dragged. */
export const BLOCK_PAN_ATTR = 'data-block-pan'

/** What a hovered node's tooltip shows. `type` is always Catalog or
 *  Collection here (the only kinds the tree renders as nodes) and reuses
 *  `TypeIcon`'s type so the tooltip's glyph matches the Inspector's and the
 *  Legend's. */
export interface HoverInfo {
  type: StacObjectKind
  title: string
  /** A short prefix of the node's own `description`, so hovering says
   *  what is inside before the user commits to clicking in. Markdown link
   *  syntax is stripped first (`stripMarkdownLinks`). */
  description?: string
  note?: string
  /** The node's browser-renderable thumbnail asset, if any — decided by the
   *  same `isInlinePreviewAsset` check the Inspector's preview uses, so
   *  both places agree on what counts. Planetary Computer's Collections
   *  carry exactly this. */
  thumbnailHref?: string
}

export interface TooltipState extends HoverInfo {
  x: number
  y: number
}

/** Long enough for a real snippet — STAC descriptions run to whole
 *  paragraphs (Planetary Computer's Sentinel-2 L2A: 475 characters) —
 *  without turning the tooltip into the Inspector field it is not trying
 *  to replace. */
export const TOOLTIP_DESCRIPTION_MAX_CHARS = 160
