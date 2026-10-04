import { useEffect, useId, useRef, useState } from 'react'
import { copyToClipboard } from './clipboard'
import { useDismiss } from './useDismiss'

const PANEL_WIDTH = 360

/** One line of "This link opens": a label and what it names. */
export interface ShareFact {
  label: string
  value: string
  /** A caveat under the line, muted. */
  note?: string
}

/** The explorer's Share control (DESIGN §127): a command in the header
 *  that opens a small panel saying, in words, what the link will open —
 *  catalog, selection, view, search, Items page — and what it does not
 *  keep, above the link itself and a Copy button. The address bar always
 *  holds the same link (`useShareableUrlSync`); the panel makes it
 *  findable and says what is in it before it is sent.
 *
 *  A disclosure, not a modal: Escape or a press outside closes it and focus
 *  returns to the button. Outside presses are told apart by DOM
 *  containment, never `stopPropagation`. Positioned `fixed` under the
 *  button so it stays on screen at phone width. */
export function SharePanel({ url, facts, iconOnly }: { url: string; facts: ShareFact[]; iconOnly: boolean }) {
  const [open, setOpen] = useState(false)
  const [copy, setCopy] = useState<'idle' | 'copied' | 'failed'>('idle')
  const [anchor, setAnchor] = useState<{ top: number; right: number }>({ top: 0, right: 16 })
  const buttonRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const panelId = useId()
  const openRef = useRef(open)
  useEffect(() => {
    openRef.current = open
  }, [open])

  function place() {
    const r = buttonRef.current?.getBoundingClientRect()
    if (!r) return
    // Right-aligned with the button, but kept 16 px inside both window
    // edges: at phone width the panel is wider than the room left of the
    // button.
    const width = Math.min(PANEL_WIDTH, window.innerWidth - 32)
    const right = Math.min(Math.max(16, window.innerWidth - r.right), window.innerWidth - 16 - width)
    setAnchor({ top: r.bottom + 6, right })
  }
  function close(returnFocus: boolean) {
    setOpen(false)
    setCopy('idle')
    if (returnFocus) buttonRef.current?.focus()
  }

  useDismiss(open, { button: buttonRef, panel: panelRef }, close)
  useEffect(() => {
    if (!open) return
    inputRef.current?.focus()
    inputRef.current?.select()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [open])

  // "Copied" is a moment, not a state: it fades back after two seconds.
  useEffect(() => {
    if (copy !== 'copied') return
    const t = setTimeout(() => setCopy('idle'), 2000)
    return () => clearTimeout(t)
  }, [copy])

  async function handleCopy() {
    const ok = await copyToClipboard(url)
    // Closed while the clipboard answered: the next open must not show a
    // "Copied" from before.
    if (!openRef.current) return
    setCopy(ok ? 'copied' : 'failed')
    // Focus, not only a selection, so the Ctrl+C the message asks for
    // copies the link.
    if (!ok) {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="stac-lens-view-command"
        data-share-button
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={iconOnly ? 'Share' : undefined}
        title="Share a link to what is open here"
        onClick={() => {
          if (open) return close(false)
          place()
          setOpen(true)
        }}
        style={{ flexShrink: 0 }}
      >
        <ShareIcon />
        {!iconOnly && 'Share'}
      </button>
      {open && (
        <div
          ref={panelRef}
          id={panelId}
          role="dialog"
          aria-label="Share"
          data-share-panel
          style={{
            position: 'fixed',
            top: anchor.top,
            right: anchor.right,
            zIndex: 60,
            width: `min(${PANEL_WIDTH}px, calc(100vw - 32px))`,
            boxSizing: 'border-box',
            padding: 12,
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--color-border)',
            background: 'var(--color-surface)',
            boxShadow: '0 8px 24px rgba(0, 0, 0, 0.16)',
            fontSize: 12.5,
            color: 'var(--color-text)',
          }}
        >
          <div style={{ fontWeight: 600 }}>This link opens</div>
          <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'auto 1fr', columnGap: 10, rowGap: 4 }}>
            {facts.map((f) => (
              <div key={f.label} style={{ display: 'contents' }}>
                <dt style={{ color: 'var(--color-text-muted)' }}>{f.label}</dt>
                <dd style={{ margin: 0, minWidth: 0, overflowWrap: 'anywhere' }}>
                  {f.value}
                  {f.note && (
                    <div style={{ color: 'var(--color-text-faint)', fontSize: 11.5, marginTop: 1 }}>{f.note}</div>
                  )}
                </dd>
              </div>
            ))}
          </dl>
          <div style={{ color: 'var(--color-text-faint)', fontSize: 11.5 }}>
            Not kept: which branches are open, and the pan and zoom.
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <input
              ref={inputRef}
              readOnly
              value={url}
              aria-label="Link"
              onFocus={(e) => e.currentTarget.select()}
              style={{
                flex: 1,
                minWidth: 0,
                height: 30,
                padding: '0 8px',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-sm)',
                background: 'var(--color-bg)',
                color: 'var(--color-text)',
                fontFamily: 'var(--font-mono)',
                fontSize: 11.5,
              }}
            />
            <button
              type="button"
              onClick={handleCopy}
              data-share-copy
              style={{
                flexShrink: 0,
                height: 30,
                padding: '0 12px',
                border: 'none',
                borderRadius: 'var(--radius-sm)',
                background: 'var(--color-selection)',
                color: '#fff',
                font: 'inherit',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              {copy === 'copied' ? 'Copied' : 'Copy link'}
            </button>
          </div>
          {copy === 'failed' && (
            <div role="alert" style={{ color: 'var(--color-node-warning)', fontSize: 11.5 }}>
              This browser would not copy it — the link is selected; press Ctrl+C (⌘C on a Mac).
            </div>
          )}
          <span aria-live="polite" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden' }}>
            {copy === 'copied' ? 'Link copied' : ''}
          </span>
        </div>
      )}
    </>
  )
}

/** The arrow leaving a box — the share glyph iOS, macOS and most web apps
 *  use. */
function ShareIcon() {
  return (
    <svg
      width={14}
      height={14}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 3v12M7.5 7.5 12 3l4.5 4.5" />
      <path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" />
    </svg>
  )
}
