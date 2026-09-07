import { buildNode, resolveHref, type RawStacObject } from './graph'
import type { StacNode } from './types'

/** Fetches and normalizes STAC JSON, with href-keyed caching and in-flight
 *  request dedup (so two nodes that both link to the same child href don't
 *  trigger two fetches). Never eagerly follows anything — callers decide
 *  what to load and when, which is what makes it safe against a 51M-item
 *  collection or a 2.4MB inlined collection.json. */
export class StacLoader {
  private cache = new Map<string, StacNode>()
  private inFlight = new Map<string, Promise<StacNode>>()

  get(href: string): StacNode | undefined {
    return this.cache.get(href)
  }

  async load(href: string): Promise<StacNode> {
    const cached = this.cache.get(href)
    if (cached) return cached

    const pending = this.inFlight.get(href)
    if (pending) return pending

    const promise = this.fetchAndBuild(href)
    this.inFlight.set(href, promise)
    try {
      const node = await promise
      this.cache.set(href, node)
      return node
    } finally {
      this.inFlight.delete(href)
    }
  }

  private async fetchAndBuild(href: string): Promise<StacNode> {
    const res = await fetch(href)
    if (!res.ok) {
      throw new Error(`Failed to fetch ${href}: ${res.status} ${res.statusText}`)
    }
    const raw = (await res.json()) as RawStacObject
    return buildNode(href, raw)
  }

  /** Loads a bounded slice of a node's children (rel:child), skipping any
   *  already cached. A catalog can be shallow-but-wide instead of deep —
   *  NZ Imagery's root has 800+ direct children — so this needs the same
   *  page-size bound loadItems already has, not just an unbounded fetch of
   *  "however many links happen to be there". Tolerant of partial failure —
   *  one dead link among many good ones (a real possibility once arbitrary,
   *  unverified STAC catalogs are in play, not just our two hand-checked
   *  fixtures) shouldn't take down its whole parent's expand. */
  async loadChildren(node: StacNode, limit = 100): Promise<StacNode[]> {
    return this.loadSettled(node.childHrefs.slice(0, limit))
  }

  /** Loads a bounded slice of a node's direct items (rel:item). Static-links
   *  item enumerations can be arbitrarily long (Earth-Search-scale collections
   *  would use the cursor variant instead) — `limit` keeps this safe by default.
   *  Same partial-failure tolerance as loadChildren. */
  async loadItems(node: StacNode, limit = 20): Promise<StacNode[]> {
    if (node.items.kind !== 'links') return []
    return this.loadSettled(node.items.hrefs.slice(0, limit))
  }

  private async loadSettled(hrefs: string[]): Promise<StacNode[]> {
    const results = await Promise.allSettled(hrefs.map((href) => this.load(href)))
    return results
      .filter((r): r is PromiseFulfilledResult<StacNode> => r.status === 'fulfilled')
      .map((r) => r.value)
  }
}

export { resolveHref }
