import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import type { Nodes, Root, RootContent, Table } from 'mdast'
import { loadMarkdown, markdownModule, subscribeMarkdown } from '../stac/markdownLoader'
import { IMAGE_SCHEMES, LINK_SCHEMES, safeUrl } from '../stac/safeUrl'

// A STAC description as the publisher wrote it — CommonMark (the spec's
// "MAY") plus the GFM tables some use — rendered from the syntax tree into
// React elements, never as an injected HTML string:
// - raw HTML is dropped (its text survives as sibling text);
// - a link opens in a new tab and only if it is http(s) or mailto; an
//   image only if http(s); relative URLs resolve against the node's href;
// - a heading is demoted to a small bold line, so a description's "# Title"
//   never outranks the Inspector's own field labels;
// - a table scrolls sideways inside itself if it must (one axis, not a
//   scroll inside the page's scroll); code blocks wrap.
// `mode="inline"` flattens blocks into one run of text for short places
// (an asset's or a provider's description). `clamp` shows the first
// ~14 lines with a "Show full description" disclosure. See DESIGN §117.

const CLAMP_PX = 260

export function Description({
  text,
  baseHref,
  mode = 'block',
  clamp = false,
}: {
  text: string
  /** The node's own href, for relative links. */
  baseHref?: string
  mode?: 'block' | 'inline'
  clamp?: boolean
}) {
  const md = useSyncExternalStore(subscribeMarkdown, markdownModule)
  useEffect(() => {
    if (!md) void loadMarkdown()
  }, [md])
  const tree = useMemo(() => md?.parseMarkdown(text), [md, text])

  // Until the parser arrives: the text as it was shown before, line
  // breaks kept.
  if (!tree) {
    return mode === 'inline' ? <span>{text}</span> : <div style={{ whiteSpace: 'pre-line' }}>{text}</div>
  }
  const ctx = makeContext(tree, baseHref)
  if (mode === 'inline') return <span className="stac-lens-md-inline">{inlineOf(tree.children, ctx)}</span>
  const body = <div className="stac-lens-md">{tree.children.map((n, i) => renderNode(n, ctx, i))}</div>
  return clamp ? <Clamped total={text.length}>{body}</Clamped> : body
}

interface Context {
  base?: string
  /** Link reference definitions (`[label]: url`), by normalized label. */
  defs: Map<string, string>
}

function makeContext(tree: Root, base?: string): Context {
  const defs = new Map<string, string>()
  const visit = (n: Nodes) => {
    if (n.type === 'definition') defs.set(n.identifier.toLowerCase(), n.url)
    if ('children' in n) for (const c of n.children) visit(c as Nodes)
  }
  visit(tree)
  return { base, defs }
}

function renderChildren(n: { children: RootContent[] }, ctx: Context): ReactNode[] {
  return n.children.map((c, i) => renderNode(c, ctx, i))
}

function renderNode(n: RootContent, ctx: Context, key: number): ReactNode {
  switch (n.type) {
    case 'paragraph':
      return <p key={key}>{renderChildren(n, ctx)}</p>
    case 'heading': {
      const Tag = n.depth <= 2 ? 'h4' : n.depth === 3 ? 'h5' : 'h6'
      return <Tag key={key}>{renderChildren(n, ctx)}</Tag>
    }
    case 'text':
      return n.value
    case 'emphasis':
      return <em key={key}>{renderChildren(n, ctx)}</em>
    case 'strong':
      return <strong key={key}>{renderChildren(n, ctx)}</strong>
    case 'delete':
      return <del key={key}>{renderChildren(n, ctx)}</del>
    case 'inlineCode':
      return <code key={key}>{n.value}</code>
    case 'code':
      return (
        <pre key={key}>
          <code>{n.value}</code>
        </pre>
      )
    case 'break':
      return <br key={key} />
    case 'thematicBreak':
      return <hr key={key} />
    case 'blockquote':
      return <blockquote key={key}>{renderChildren(n, ctx)}</blockquote>
    case 'list': {
      const items = renderChildren(n, ctx)
      return n.ordered ? (
        <ol key={key} start={n.start ?? undefined}>
          {items}
        </ol>
      ) : (
        <ul key={key}>{items}</ul>
      )
    }
    case 'listItem':
      return (
        <li key={key}>
          {n.checked != null && <input type="checkbox" checked={n.checked} disabled readOnly />}
          {/* A "tight" list item's paragraphs render without their margins. */}
          {n.children.map((c, i) =>
            c.type === 'paragraph' && n.spread === false ? (
              <span key={i}>{renderChildren(c, ctx)}</span>
            ) : (
              renderNode(c, ctx, i)
            ),
          )}
        </li>
      )
    case 'link':
    case 'linkReference': {
      const raw = n.type === 'link' ? n.url : ctx.defs.get(n.identifier.toLowerCase())
      const href = raw ? safeUrl(raw, ctx.base, LINK_SCHEMES) : undefined
      const children = renderChildren(n, ctx)
      return href ? (
        <a key={key} href={href} target="_blank" rel="noopener noreferrer">
          {children}
        </a>
      ) : (
        <span key={key}>{children}</span>
      )
    }
    case 'image':
    case 'imageReference': {
      const raw = n.type === 'image' ? n.url : ctx.defs.get(n.identifier.toLowerCase())
      const src = raw ? safeUrl(raw, ctx.base, IMAGE_SCHEMES) : undefined
      return <MdImage key={key} src={src} alt={n.alt ?? ''} />
    }
    case 'table':
      return <MdTable key={key} table={n} ctx={ctx} />
    case 'footnoteReference':
      return <sup key={key}>[{n.label ?? n.identifier}]</sup>
    case 'footnoteDefinition':
      return (
        <div key={key} className="stac-lens-md-footnote">
          <sup>[{n.label ?? n.identifier}]</sup> {renderChildren(n, ctx)}
        </div>
      )
    // Raw HTML (dropped — its text is in sibling text nodes), link
    // definitions (used through `ctx.defs`), and anything unknown.
    default:
      return null
  }
}

function MdTable({ table, ctx }: { table: Table; ctx: Context }) {
  const [head, ...rows] = table.children
  const align = (i: number) => table.align?.[i] ?? undefined
  return (
    <div className="stac-lens-md-table">
      <table>
        {head && (
          <thead>
            <tr>
              {head.children.map((cell, i) => (
                <th key={i} style={{ textAlign: align(i) }}>
                  {renderChildren(cell, ctx)}
                </th>
              ))}
            </tr>
          </thead>
        )}
        <tbody>
          {rows.map((row, r) => (
            <tr key={r}>
              {row.children.map((cell, i) => (
                <td key={i} style={{ textAlign: align(i) }}>
                  {renderChildren(cell, ctx)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** A described image, as wide as the column at most, loaded lazily; its
 *  alt text in its place if it has no usable URL or fails to load. */
function MdImage({ src, alt }: { src: string | undefined; alt: string }) {
  const [failed, setFailed] = useState(false)
  if (!src || failed) return alt ? <span className="stac-lens-md-alt">[{alt}]</span> : null
  return <img src={src} alt={alt} loading="lazy" onError={() => setFailed(true)} />
}

/** Blocks flattened into one run of text: paragraphs and list items
 *  joined by spaces, headings and code kept as text, images by their alt
 *  text, tables and raw HTML left out. */
function inlineOf(nodes: RootContent[], ctx: Context): ReactNode[] {
  const out: ReactNode[] = []
  nodes.forEach((n, i) => {
    switch (n.type) {
      case 'paragraph':
      case 'heading':
      case 'blockquote':
      case 'list':
      case 'listItem':
        if (out.length > 0) out.push(' ')
        out.push(<span key={i}>{inlineOf(n.children as RootContent[], ctx)}</span>)
        return
      case 'code':
        if (out.length > 0) out.push(' ')
        out.push(<code key={i}>{n.value}</code>)
        return
      case 'table':
      case 'html':
      case 'definition':
      case 'footnoteDefinition':
      case 'thematicBreak':
        return
      default:
        out.push(renderNode(n, ctx, i))
    }
  })
  return out
}

/** The first ~14 lines, faded, and a disclosure for the rest — the page
 *  grows when it opens; nothing scrolls inside it. Shorter descriptions
 *  are shown whole. */
function Clamped({ total, children }: { total: number; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const [overflows, setOverflows] = useState(false)
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    // Fires once on observe, then on every size change (fonts, images,
    // the Inspector's width).
    const ro = new ResizeObserver(() => setOverflows(el.scrollHeight > CLAMP_PX + 40))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const clamped = overflows && !open
  return (
    <div>
      <div
        ref={ref}
        data-description-clamped={clamped ? '' : undefined}
        style={{
          position: 'relative',
          maxHeight: clamped ? CLAMP_PX : undefined,
          overflow: clamped ? 'hidden' : undefined,
        }}
      >
        {children}
        {clamped && <div aria-hidden="true" className="stac-lens-md-fade" />}
      </div>
      {overflows && (
        <button type="button" className="stac-lens-md-more" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          {open ? 'Show less' : `Show full description (${total.toLocaleString()} characters)`}
        </button>
      )}
    </div>
  )
}
