import { useEffect, type RefObject } from 'react'

/** A sidebar that stays in view while the page scrolls, without becoming a
 *  second scroll region and without per-frame JavaScript positioning.
 *
 *  Plain `position: sticky` fails once the sidebar is taller than the
 *  viewport: its bottom is unreachable (a known limit of the CSS spec).
 *  The usual fix — cap its height and give it `overflow-y: auto` — is the
 *  "inline scroll area" Baymard's testing warns against: nested scrolling
 *  the user has to reason about, wheel hijacking, hidden scrollbars. This
 *  hook does what long-sidebar sites do instead: one scroll context, the
 *  page's. A sidebar shorter than the viewport pins at `top`. A taller one
 *  moves with the page until its bottom edge meets the viewport's bottom
 *  while scrolling down (then that edge pins), and until its top edge
 *  meets `top` while scrolling up (then that edge pins); on a direction
 *  change it stays put until an edge is reached.
 *
 *  How, without jitter: the sidebar keeps native `position: sticky`, so the
 *  browser does the pinning in the compositor. JavaScript acts only when
 *  the scroll *direction* changes: it freezes the sidebar where it is,
 *  then switches between sticky's `top` offset (pins the bottom edge while
 *  scrolling down) and its `bottom` offset (pins the top edge while
 *  scrolling up) — see `apply`. Between direction changes no style is
 *  written at all. A first version translated the sidebar on every scroll
 *  frame; scroll events fire after paint, so it trailed the page by a
 *  frame and visibly shook (reported).
 *
 *  Freezing uses a spacer, not `margin-top`. Sticky positioning keeps the
 *  element's *margin box* inside its containing block, so a frozen margin
 *  would forbid the browser from ever pushing the sidebar back up — the
 *  top-pin silently stopped working. A spacer element before the sidebar
 *  moves its natural position without shrinking the room it may move in.
 *
 *  Markup: `wrapper` is a flex item stretched to the full height of the
 *  row it shares with the content (the containing block); inside it,
 *  `spacer` (an empty block) precedes `sidebar` (the sticky element). */
export function useStickySidebar(
  wrapperRef: RefObject<HTMLElement | null>,
  spacerRef: RefObject<HTMLElement | null>,
  sidebarRef: RefObject<HTMLElement | null>,
  { top = 16, bottom = 16, enabled = true }: { top?: number; bottom?: number; enabled?: boolean } = {},
) {
  useEffect(() => {
    if (!enabled) return
    const wrapper = wrapperRef.current
    const spacer = spacerRef.current
    const sidebar = sidebarRef.current
    if (!wrapper || !spacer || !sidebar) return

    type Mode = 'fit' | 'top' | 'bottom'
    let mode: Mode | null = null
    let spacerHeight = 0
    let lastScrollY = window.scrollY
    let frame = 0

    sidebar.style.position = 'sticky'

    function setSpacer(px: number) {
      spacerHeight = Math.max(0, Math.min(px, wrapper!.offsetHeight - sidebar!.offsetHeight))
      spacer!.style.height = spacerHeight === 0 ? '0px' : `${Math.round(spacerHeight)}px`
    }

    /** Freeze the sidebar at its current place inside the wrapper, so the
     *  offset switch that follows does not move it. */
    function freeze() {
      const wrapperTop = wrapper!.getBoundingClientRect().top
      const sidebarTop = sidebar!.getBoundingClientRect().top
      setSpacer(sidebarTop - wrapperTop)
    }

    /** Which edge the browser pins is expressed with sticky's own two
     *  offsets. `top: T` means "the top edge may not rise above T", which
     *  is what pinning the *bottom* edge while scrolling down needs
     *  (T = viewport − bottom − height, negative for a tall sidebar).
     *  `bottom: B` means "the bottom edge may not sink below viewport − B",
     *  which pins the *top* edge at `top` while scrolling up
     *  (B = viewport − top − height). At the moment of a switch the sidebar
     *  already satisfies the new constraint, so nothing jumps; the page
     *  carries it to the edge, then the edge holds. */
    function apply(next: Mode) {
      const height = sidebar!.offsetHeight
      const viewport = window.innerHeight
      if (next === 'fit') {
        sidebar!.style.top = `${top}px`
        sidebar!.style.bottom = 'auto'
        if (spacerHeight !== 0) setSpacer(0)
      } else if (next === 'top') {
        if (mode !== null) freeze()
        sidebar!.style.top = 'auto'
        sidebar!.style.bottom = `${viewport - top - height}px`
      } else {
        if (mode !== null) freeze()
        sidebar!.style.bottom = 'auto'
        sidebar!.style.top = `${viewport - bottom - height}px`
      }
      mode = next
    }

    function place() {
      frame = 0
      if (!sidebar) return
      const scrollY = window.scrollY
      const fits = sidebar.offsetHeight + top + bottom <= window.innerHeight
      if (fits) {
        if (mode !== 'fit') apply('fit')
      } else if (scrollY > lastScrollY) {
        if (mode !== 'bottom') apply('bottom')
      } else if (scrollY < lastScrollY) {
        if (mode !== 'top') apply('top')
      } else if (mode === null || mode === 'fit') {
        apply('top')
      }
      lastScrollY = scrollY
    }

    function schedule() {
      if (frame === 0) frame = requestAnimationFrame(place)
    }

    /** A size change (a facet group expanding, the card grid reflowing)
     *  invalidates the pin offsets and the spacer clamp; recompute in
     *  place. */
    function resized() {
      const height = sidebar!.offsetHeight
      if (mode === 'bottom') sidebar!.style.top = `${window.innerHeight - bottom - height}px`
      if (mode === 'top') sidebar!.style.bottom = `${window.innerHeight - top - height}px`
      if (spacerHeight > 0) setSpacer(spacerHeight)
      schedule()
    }

    place()
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', resized)
    const observer = new ResizeObserver(resized)
    observer.observe(sidebar)
    observer.observe(wrapper)
    return () => {
      window.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', resized)
      observer.disconnect()
      if (frame !== 0) cancelAnimationFrame(frame)
      sidebar.style.position = ''
      sidebar.style.top = ''
      sidebar.style.bottom = ''
      spacer.style.height = '0px'
    }
  }, [wrapperRef, spacerRef, sidebarRef, top, bottom, enabled])
}
