/** Tries the modern Clipboard API first (works in any secure context —
 *  `https://` or `localhost`), then falls back to the legacy
 *  `execCommand('copy')` technique, which still works over a plain `http://`
 *  origin (e.g. testing over a LAN IP like `http://192.168.x.x:5173`,
 *  a real, reported scenario this session — `navigator.clipboard` is
 *  often unavailable entirely in that kind of insecure context, and the
 *  previous version's empty `catch {}` swallowed that failure silently).
 *  Returns whether it actually succeeded, so the caller can show real
 *  feedback instead of assuming. */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // fall through to the legacy fallback below
    }
  }
  // The fallback has to focus a textarea of its own; give focus back
  // afterwards, so a keyboard user stays where they were.
  const previouslyFocused = document.activeElement as HTMLElement | null
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
    previouslyFocused?.focus()
    return ok
  } catch {
    return false
  }
}
