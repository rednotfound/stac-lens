import { useSyncExternalStore } from 'react'

/** React state for a CSS media query. The app styles everything inline, so
 *  layout decisions that a stylesheet would make with `@media` are made
 *  here instead — the one place the breakpoint is evaluated, kept in sync
 *  with the browser's own `matchMedia` through `useSyncExternalStore`
 *  (the media query list is the external store; no effect, no extra
 *  render). */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mq = window.matchMedia(query)
      mq.addEventListener('change', onChange)
      return () => mq.removeEventListener('change', onChange)
    },
    () => window.matchMedia(query).matches,
    () => false,
  )
}

/** The one breakpoint. Below it the app is on a phone (or a very narrow
 *  window): two columns cannot coexist, so the landing page hides its
 *  sidebar behind a Filters button and the explorer stacks the Inspector
 *  into a bottom sheet. Above it, the desktop layouts apply unchanged —
 *  a tablet in portrait (768–834 px) still has room for a 220 px sidebar
 *  beside 500 px of cards. */
export const NARROW_QUERY = '(max-width: 720px)'

export function useIsNarrow(): boolean {
  return useMediaQuery(NARROW_QUERY)
}

/** Non-hook check for code that runs outside React's render (default
 *  box sizes computed when a box first opens, the legend's stored-state
 *  fallback). Same query, so the two never disagree. */
export function isNarrowViewport(): boolean {
  return typeof window !== 'undefined' && 'matchMedia' in window && window.matchMedia(NARROW_QUERY).matches
}
