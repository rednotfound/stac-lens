import { useState } from 'react'
import { PHONE_ITEM_LIMIT } from '../hooks/usePhoneItems'

const DISMISSED_KEY = 'stac-lens.compact-banner-dismissed'

function readDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISSED_KEY) === 'true'
  } catch {
    return false
  }
}

/** The one line that tells a phone visitor what they are looking at and
 *  where the rest is. Shaped by Google's mobile rule and by what people
 *  tolerate: a small banner that takes little space and closes in one tap
 *  is fine; an interstitial that covers the content is not. "Copy link"
 *  is the practical half — the way to open the same catalog, selection
 *  and search on a desktop is to carry this URL there. Dismissal is
 *  remembered per browser; the text never blocks anything. */
export function CompactBanner() {
  const [dismissed, setDismissed] = useState(readDismissed)
  const [copied, setCopied] = useState(false)
  if (dismissed) return null

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      // Clipboard unavailable (insecure context, denied permission): select
      // the URL in a prompt so it can still be copied by hand.
      window.prompt('Copy this link to open it on a desktop browser:', window.location.href)
    }
  }
  function dismiss() {
    setDismissed(true)
    try {
      localStorage.setItem(DISMISSED_KEY, 'true')
    } catch {
      // Not persisted; the banner simply returns next time.
    }
  }

  return (
    <div
      role="note"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '8px 8px 8px 14px',
        fontSize: 12,
        lineHeight: 1.4,
        color: 'var(--color-text-muted)',
        background: 'var(--color-selection-bg)',
        borderBottom: '1px solid var(--color-border)',
      }}
    >
      <span style={{ flex: 1, minWidth: 0 }}>
        <strong style={{ color: 'var(--color-text)' }}>Compact view</strong> — the structure and each Collection's
        Items, {PHONE_ITEM_LIMIT} at a time. Search, filters and the full data are in the desktop browser.
      </span>
      <button type="button" onClick={copyLink} style={linkButton}>
        {copied ? 'Copied' : 'Copy link'}
      </button>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss"
        title="Dismiss"
        style={{ ...linkButton, fontSize: 18 }}
      >
        ×
      </button>
    </div>
  )
}

const linkButton: React.CSSProperties = {
  flexShrink: 0,
  border: 'none',
  background: 'none',
  padding: '4px 6px',
  font: 'inherit',
  fontWeight: 600,
  color: 'var(--color-selection)',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
}
