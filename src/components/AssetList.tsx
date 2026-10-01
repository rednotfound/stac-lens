import { useEffect, useState, type CSSProperties, type MouseEvent, type ReactNode } from 'react'
import { describeAssetType } from '../stac/assets'
import {
  accessAsset,
  accessMethodFor,
  type AccessMethod,
  type AccessSource,
  type AssetAccess,
} from '../stac/assetAccess'
import type { StacAsset } from '../stac/types'
import { TypeIcon } from './TypeIcon'

// The Inspector's asset list: one list, every asset, one line each — the
// file-list shape (GitHub release assets, a file browser) rather than a
// stack of cards. Copy and Open sit at the end of every row, always
// visible (no hover-only actions: a touch screen has no hover). Clicking
// the row itself opens it in place (STAC Browser's asset accordion) to
// show the declared STAC href and, when the asset needs one, its access
// link side by side — the AWS S3 console's "Object URL" vs. "presigned
// URL" distinction. "Copy" always copies the declared href; an access
// link is a separate thing with its own copy button and expiry.
// See docs/DESIGN.md §114.

/** The largest delay `setTimeout` honors (2^31 − 1 ms). */
const MAX_TIMEOUT_MS = 2_147_483_647

export function AssetList({ assets, source }: { assets: StacAsset[]; source: AccessSource }) {
  if (assets.length === 0) return <em style={{ color: 'var(--color-text-faint)' }}>none</em>

  // Said once for the list, not on every row: how many assets need which
  // access method. Synchronous, network-free.
  const needs = new Map<string, number>()
  for (const a of assets) {
    const m = accessMethodFor(a.href, source)
    if (m) needs.set(m.label, (needs.get(m.label) ?? 0) + 1)
  }

  return (
    <div>
      {[...needs].map(([label, n]) => (
        <div
          key={label}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            margin: '2px 0 5px',
            fontSize: 11,
            color: 'var(--color-text-muted)',
          }}
        >
          <KeyIcon />
          {n === assets.length ? 'All' : `${n} of ${assets.length}`} need {label} to open
        </div>
      ))}
      <div
        role="list"
        style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', overflow: 'hidden' }}
      >
        {assets.map((asset, i) => (
          <AssetRow key={asset.key} asset={asset} source={source} first={i === 0} />
        ))}
      </div>
    </div>
  )
}

function AssetRow({ asset, source, first }: { asset: StacAsset; source: AccessSource; first: boolean }) {
  const method = accessMethodFor(asset.href, source)
  const [expanded, setExpanded] = useState(false)
  const [access, setAccess] = useState<AssetAccess | 'pending'>()
  const [copied, setCopied] = useState<{ what: 'declared' | 'access'; ok: boolean; text: string }>()
  const [expiredHref, setExpiredHref] = useState<string>()

  const ready = typeof access === 'object' && !access.failure ? access : undefined
  const expired = !!ready && expiredHref === ready.href
  // A temporary link says it has expired at the moment it does.
  useEffect(() => {
    if (!ready?.expiresAt) return
    const ms = ready.expiresAt.getTime() - Date.now()
    // setTimeout overflows past ~24.8 days and fires at once; a link that
    // far from expiring is, for this session, not going to expire.
    if (ms > MAX_TIMEOUT_MS) return
    const t = setTimeout(() => setExpiredHref(ready.href), Math.max(0, ms))
    return () => clearTimeout(t)
  }, [ready])

  async function copy(what: 'declared' | 'access', text: string) {
    const ok = await copyToClipboard(text)
    setCopied({ what, ok, text })
    // A failed copy opens the row, where a selected field to copy from waits.
    if (!ok) setExpanded(true)
    else setTimeout(() => setCopied((c) => (c?.text === text ? undefined : c)), 1500)
  }

  async function obtainAccess(): Promise<AssetAccess> {
    setAccess('pending')
    const a = await accessAsset(asset.href, source)
    setAccess(a)
    return a
  }

  async function open() {
    // The tab opens synchronously inside the click, so no popup blocker
    // objects, and is pointed at the access href once there is one.
    const win = window.open('about:blank', '_blank')
    const a = await obtainAccess()
    if (!win) return
    if (a.failure) {
      win.close()
      setExpanded(true)
      return
    }
    win.opener = null
    win.location.href = a.href
  }

  // The toggle is the button over chevron, icon and title; the rest of the
  // row toggles too for a mouse, except where the click landed on one of
  // its own controls — DOM containment, not stopPropagation (house rule).
  function onRowClick(e: MouseEvent<HTMLDivElement>) {
    const control = (e.target as HTMLElement).closest('button, a, input')
    if (control && e.currentTarget.contains(control)) return
    setExpanded((v) => !v)
  }
  const state = !method
    ? undefined
    : access === undefined
      ? 'needed'
      : access === 'pending'
        ? 'pending'
        : access.failure
          ? 'failed'
          : expired
            ? 'expired'
            : 'ready'
  const name = asset.title ?? asset.key
  const facts = [asset.gsd != null ? `${asset.gsd}m` : null, asset.dataType].filter(Boolean).join(' · ')
  const until = ready?.expiresAt?.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  // The key's state in words, not only in color.
  const keyLabel = !method
    ? ''
    : state === 'ready'
      ? `Access link ready (${method.label})${until ? ` · valid until ${until}` : ''}`
      : state === 'failed'
        ? `${method.label} failed — open the row for details`
        : state === 'expired'
          ? `The access link from ${method.label} has expired`
          : `Needs ${method.label} to open`

  return (
    <div
      role="listitem"
      data-asset-access={state}
      style={{ borderTop: first ? 'none' : '1px solid var(--color-border)' }}
    >
      <div
        onClick={onRowClick}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: 4,
          fontSize: 12,
          cursor: 'pointer',
          background: expanded ? 'var(--color-bg)' : undefined,
        }}
      >
        <button
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
          title={asset.title ?? asset.key}
          style={{
            flex: 1,
            minWidth: 0,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: 0,
            border: 'none',
            background: 'none',
            font: 'inherit',
            color: 'inherit',
            textAlign: 'left',
            cursor: 'pointer',
          }}
        >
          <Chevron open={expanded} />
          <TypeIcon type="Asset" size={13} color="var(--color-node-asset)" />
          <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {asset.title ?? asset.key}
          </span>
          <span style={{ flexShrink: 0, fontSize: 10, color: 'var(--color-text-faint)' }}>
            {[describeAssetType(asset.type), facts].filter(Boolean).join(' · ')}
          </span>
        </button>
        {method && (
          <span
            role="img"
            aria-label={keyLabel}
            title={keyLabel}
            style={{
              display: 'inline-flex',
              flexShrink: 0,
              color:
                state === 'ready'
                  ? 'var(--color-brand)'
                  : state === 'failed'
                    ? 'var(--color-node-warning)'
                    : 'var(--color-text-faint)',
            }}
          >
            <KeyIcon />
          </span>
        )}
        <IconButton
          label={copied?.what === 'declared' ? (copied.ok ? 'Copied' : 'Copy failed') : `Copy STAC href of ${name}`}
          title={`Copy the STAC href — ${asset.href}`}
          onClick={() => void copy('declared', asset.href)}
        >
          {copied?.what === 'declared' && copied.ok ? <CheckIcon /> : <CopyIcon />}
        </IconButton>
        {method ? (
          <IconButton label={`Open ${name}`} title={`Open through ${method.label}`} onClick={() => void open()}>
            <OpenIcon />
          </IconButton>
        ) : (
          <a
            href={asset.href}
            target="_blank"
            rel="noreferrer"
            aria-label={`Open ${name}`}
            title={`Open ${asset.href}`}
            style={iconButtonStyle}
          >
            <OpenIcon />
          </a>
        )}
      </div>
      {expanded && (
        <AssetDetails
          asset={asset}
          method={method}
          state={state}
          access={typeof access === 'object' ? access : undefined}
          until={until}
          copied={copied}
          onCopy={(what, text) => void copy(what, text)}
          onGet={() => void obtainAccess()}
        />
      )}
    </div>
  )
}

function AssetDetails({
  asset,
  method,
  state,
  access,
  until,
  copied,
  onCopy,
  onGet,
}: {
  asset: StacAsset
  method: AccessMethod | undefined
  state: string | undefined
  access: AssetAccess | undefined
  until: string | undefined
  copied: { what: 'declared' | 'access'; ok: boolean; text: string } | undefined
  onCopy: (what: 'declared' | 'access', text: string) => void
  onGet: () => void
}) {
  const textButton: CSSProperties = {
    border: 'none',
    background: 'none',
    padding: 0,
    fontSize: 11,
    color: 'var(--color-selection)',
    cursor: 'pointer',
  }
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'auto minmax(0, 1fr)',
        columnGap: 10,
        rowGap: 4,
        padding: '4px 8px 8px 29px',
        fontSize: 11,
        background: 'var(--color-bg)',
      }}
    >
      <DetailLabel>STAC href</DetailLabel>
      <LinkValue
        href={asset.href}
        copyLabel="Copy STAC href"
        copied={copied?.what === 'declared' ? copied : undefined}
        onCopy={() => onCopy('declared', asset.href)}
      />

      {method && (
        <>
          <DetailLabel>Access</DetailLabel>
          <div data-access-state={state} style={{ minWidth: 0 }}>
            {state === 'needed' && (
              <span style={{ color: 'var(--color-text-muted)' }}>
                Needs {method.label} ·{' '}
                <button onClick={onGet} style={textButton}>
                  Get access link
                </button>
              </span>
            )}
            {state === 'pending' && (
              <span style={{ color: 'var(--color-text-muted)' }}>Getting an access link from {method.label}…</span>
            )}
            {state === 'failed' && access && (
              <span style={{ color: 'var(--color-node-warning)' }}>
                ⚠ {access.failure}. The STAC href may be refused. ·{' '}
                <button onClick={onGet} style={textButton}>
                  Retry
                </button>
              </span>
            )}
            {state === 'expired' && (
              <span style={{ color: 'var(--color-text-muted)' }}>
                The access link expired at {until} ·{' '}
                <button onClick={onGet} style={textButton}>
                  Get a new one
                </button>
              </span>
            )}
            {state === 'ready' && access && (
              <>
                <div style={{ color: 'var(--color-text-muted)', marginBottom: 2 }}>
                  {method.label}
                  {until ? ` · valid until ${until}` : ''}
                </div>
                <LinkValue
                  href={access.href}
                  copyLabel="Copy access link"
                  copied={copied?.what === 'access' ? copied : undefined}
                  onCopy={() => onCopy('access', access.href)}
                  dataAttr
                  clamp
                />
              </>
            )}
          </div>
        </>
      )}

      {asset.roles && asset.roles.length > 0 && (
        <>
          <DetailLabel>Roles</DetailLabel>
          <span>{asset.roles.join(', ')}</span>
        </>
      )}
      {asset.type && (
        <>
          <DetailLabel>Media type</DetailLabel>
          <span style={{ overflowWrap: 'anywhere' }}>{asset.type}</span>
        </>
      )}
      {asset.title && asset.title !== asset.key && (
        <>
          <DetailLabel>Key</DetailLabel>
          <span style={{ fontFamily: 'var(--font-mono)' }}>{asset.key}</span>
        </>
      )}
      {asset.description && (
        <>
          <DetailLabel>Description</DetailLabel>
          <span>{asset.description}</span>
        </>
      )}
    </div>
  )
}

function DetailLabel({ children }: { children: ReactNode }) {
  return <span style={{ color: 'var(--color-text-faint)', whiteSpace: 'nowrap' }}>{children}</span>
}

/** A full URL, wrapped (never scrolled or cut), with its own copy button;
 *  when copying failed, a selected read-only field to copy from by hand
 *  (Clipboard API and execCommand both unavailable — e.g. plain http on a
 *  LAN address, a reported case). */
function LinkValue({
  href,
  copyLabel,
  copied,
  onCopy,
  dataAttr,
  clamp,
}: {
  href: string
  copyLabel: string
  copied: { ok: boolean } | undefined
  onCopy: () => void
  dataAttr?: boolean
  clamp?: boolean
}) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
        <span
          {...(dataAttr ? { 'data-access-href': '' } : {})}
          title={clamp ? href : undefined}
          style={{
            flex: 1,
            minWidth: 0,
            fontFamily: 'var(--font-mono)',
            overflowWrap: 'anywhere',
            color: 'var(--color-text)',
            // An access link carries a long token; three lines show where it
            // points and that it is signed, the copy button takes it whole.
            ...(clamp
              ? { display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical' as const, overflow: 'hidden' }
              : {}),
          }}
        >
          {href}
        </span>
        <IconButton
          label={copied ? (copied.ok ? 'Copied' : 'Copy failed') : copyLabel}
          title={copyLabel}
          onClick={onCopy}
        >
          {copied?.ok ? <CheckIcon /> : <CopyIcon />}
        </IconButton>
      </div>
      {copied && !copied.ok && (
        <input
          readOnly
          autoFocus
          value={href}
          onFocus={(e) => e.currentTarget.select()}
          style={{
            width: '100%',
            boxSizing: 'border-box',
            marginTop: 3,
            padding: '3px 6px',
            fontSize: 11,
            fontFamily: 'var(--font-mono)',
            borderRadius: 'var(--radius-sm)',
            border: '1px solid var(--color-node-warning)',
            background: 'var(--color-surface)',
            color: 'var(--color-text)',
          }}
        />
      )}
    </div>
  )
}

const iconButtonStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
  width: 22,
  height: 22,
  padding: 0,
  border: 'none',
  borderRadius: 'var(--radius-sm)',
  background: 'none',
  color: 'var(--color-text-muted)',
  cursor: 'pointer',
}

function IconButton({
  label,
  title,
  onClick,
  children,
}: {
  label: string
  title: string
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button aria-label={label} title={title} onClick={onClick} style={iconButtonStyle}>
      {children}
    </button>
  )
}

// Small hand-drawn glyphs (no icon library), 14px, stroked in currentColor.
const glyph = {
  width: 14,
  height: 14,
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.4,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
}
function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      {...glyph}
      width={10}
      height={10}
      style={{ flexShrink: 0, color: 'var(--color-text-faint)', transform: open ? 'rotate(90deg)' : undefined }}
    >
      <path d="M6 3l5 5-5 5" />
    </svg>
  )
}
function CopyIcon() {
  return (
    <svg {...glyph}>
      <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
      <path d="M10.5 5.5V3.5A1.5 1.5 0 0 0 9 2H3.5A1.5 1.5 0 0 0 2 3.5V9a1.5 1.5 0 0 0 1.5 1.5h2" />
    </svg>
  )
}
function CheckIcon() {
  return (
    <svg {...glyph} style={{ color: 'var(--color-brand)' }}>
      <path d="M3 8.5l3 3 7-7" />
    </svg>
  )
}
function OpenIcon() {
  return (
    <svg {...glyph}>
      <path d="M9 2.5h4.5V7M13.5 2.5L7 9" />
      <path d="M11.5 9.5v3a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1h3" />
    </svg>
  )
}
function KeyIcon() {
  return (
    <svg {...glyph} width={13} height={13}>
      <circle cx="5" cy="11" r="2.75" />
      <path d="M7 9l6.5-6.5M11 5l1.75 1.75M9.5 6.5l1.25 1.25" />
    </svg>
  )
}

/** Tries the modern Clipboard API first (works in any secure context —
 *  `https://` or `localhost`), then falls back to the legacy
 *  `execCommand('copy')` technique, which still works over a plain `http://`
 *  origin (e.g. testing over a LAN IP like `http://192.168.x.x:5173`,
 *  a real, reported scenario this session — `navigator.clipboard` is
 *  often unavailable entirely in that kind of insecure context, and the
 *  previous version's empty `catch {}` swallowed that failure silently).
 *  Returns whether it actually succeeded, so the caller can show real
 *  feedback instead of assuming. */
async function copyToClipboard(text: string): Promise<boolean> {
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // fall through to the legacy fallback below
    }
  }
  try {
    const textarea = document.createElement('textarea')
    textarea.value = text
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    document.body.appendChild(textarea)
    textarea.focus()
    textarea.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(textarea)
    return ok
  } catch {
    return false
  }
}
