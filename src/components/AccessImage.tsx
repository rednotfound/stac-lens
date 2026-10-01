import { useEffect, useState, type CSSProperties } from 'react'
import { accessAsset, accessMethodFor, type AccessSource } from '../stac/assetAccess'
import { Spinner } from './Spinner'

/** An `<img>` of an asset or preview link, fetched through asset access.
 *  For a direct href (every catalog without an access method) the declared
 *  href is used at once; when an access method applies, the access href is
 *  awaited first.
 *
 *  It never shows the previous picture while the next one loads: a reused
 *  `<img>` whose `src` changes keeps painting the old image until the new
 *  one decodes, so selecting another Item left the last Item's thumbnail
 *  on screen for a while (reported). Each src gets its own element, and
 *  until it has loaded a placeholder of the same footprint says so. */
export function AccessImage({
  href,
  source,
  alt,
  style,
  placeholderHeight,
  errorText,
}: {
  href: string
  source: AccessSource
  alt: string
  style?: CSSProperties
  /** Height of the loading placeholder — roughly the picture's own. */
  placeholderHeight: number
  /** Shown when the picture cannot be had; nothing is shown without it. */
  errorText?: string
}) {
  const { nodeHref, rootHref } = source
  const needsAccess = accessMethodFor(href, source) !== undefined
  const [resolved, setResolved] = useState<{ for: string; href?: string }>()

  useEffect(() => {
    if (!needsAccess) return
    let live = true
    void accessAsset(href, { nodeHref, rootHref }).then((a) => {
      if (live) setResolved({ for: href, href: a.failure ? undefined : a.href })
    })
    return () => {
      live = false
    }
  }, [href, needsAccess, nodeHref, rootHref])

  if (!needsAccess) {
    return (
      <LoadingImage
        key={href}
        src={href}
        alt={alt}
        style={style}
        placeholderHeight={placeholderHeight}
        errorText={errorText}
      />
    )
  }
  if (resolved?.for !== href) return <ImagePlaceholder height={placeholderHeight} />
  if (!resolved.href) return errorText ? <ImageNote>{errorText}</ImageNote> : null
  return (
    <LoadingImage
      key={resolved.href}
      src={resolved.href}
      alt={alt}
      style={style}
      placeholderHeight={placeholderHeight}
      errorText={errorText}
    />
  )
}

/** One src, one element: mounted fresh per src (by `key`), hidden until it
 *  has loaded, a placeholder in its place meanwhile. */
function LoadingImage({
  src,
  alt,
  style,
  placeholderHeight,
  errorText,
}: {
  src: string
  alt: string
  style?: CSSProperties
  placeholderHeight: number
  errorText?: string
}) {
  const [status, setStatus] = useState<'loading' | 'loaded' | 'error'>('loading')
  if (status === 'error') return errorText ? <ImageNote>{errorText}</ImageNote> : null
  return (
    <>
      {status === 'loading' && <ImagePlaceholder height={placeholderHeight} />}
      <img
        src={src}
        alt={alt}
        onLoad={() => setStatus('loaded')}
        onError={() => setStatus('error')}
        style={{ ...style, ...(status === 'loading' ? { display: 'none' } : {}) }}
      />
    </>
  )
}

function ImagePlaceholder({ height }: { height: number }) {
  return (
    <div
      data-image-loading
      style={{
        height,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        marginTop: 6,
        borderRadius: 'var(--radius-sm)',
        background: 'rgba(127, 127, 127, 0.14)',
        fontSize: 11,
        color: 'inherit',
        opacity: 0.75,
      }}
    >
      <Spinner size={12} />
      Loading preview…
    </div>
  )
}

function ImageNote({ children }: { children: string }) {
  return <div style={{ marginTop: 4, fontSize: 11, opacity: 0.7 }}>{children}</div>
}
