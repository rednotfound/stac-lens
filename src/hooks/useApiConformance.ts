import { useEffect, useState } from 'react'
import { loader } from '../stac/loaderInstance'
import { resolveApiConformance } from '../stac/conformance'
import type { StacNode } from '../stac/types'

/** Reactive wrapper over `resolveApiConformance` — pure UI-gating concern
 *  (should a conformance-dependent control render at all), never consulted
 *  from the actual data-fetching path. In the normal top-down browse flow
 *  the API root is already loaded/cached by the time any nested Collection's
 *  Item Set panel can open, so this resolves synchronously on first render;
 *  the async path only actually does work for a deep-linked node whose
 *  root hasn't been fetched yet. */
export function useApiConformance(node: StacNode | undefined): string[] | undefined {
  const nodeHref = node?.href
  const rootHref = node?.declaredRootHref

  const [resolved, setResolved] = useState<string[] | undefined>(() =>
    node ? (node.declaredConformsTo ?? (rootHref ? loader.get(rootHref)?.declaredConformsTo : undefined)) : undefined,
  )

  useEffect(() => {
    if (!node) {
      setResolved(undefined)
      return
    }
    if (node.declaredConformsTo) {
      setResolved(node.declaredConformsTo)
      return
    }
    if (!rootHref) {
      setResolved(undefined)
      return
    }
    const cached = loader.get(rootHref)
    if (cached) {
      setResolved(cached.declaredConformsTo)
      return
    }
    let cancelled = false
    resolveApiConformance(node).then((c) => {
      if (!cancelled) setResolved(c)
    })
    return () => {
      cancelled = true
    }
    // `node` itself is intentionally excluded — `nodeHref`/`rootHref` are
    // the only identity that should re-trigger resolution, same pattern as
    // useItemSet's nodeHref/kind deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeHref, rootHref])

  return resolved
}
