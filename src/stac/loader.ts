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

  /** Loads all of a node's children (rel:child), skipping any already cached. */
  async loadChildren(node: StacNode): Promise<StacNode[]> {
    return Promise.all(node.childHrefs.map((href) => this.load(href)))
  }

  /** Loads a bounded slice of a node's direct items (rel:item). Static-links
   *  item enumerations can be arbitrarily long (Earth-Search-scale collections
   *  would use the cursor variant instead) — `limit` keeps this safe by default. */
  async loadItems(node: StacNode, limit = 20): Promise<StacNode[]> {
    if (node.items.kind !== 'links') return []
    const slice = node.items.hrefs.slice(0, limit)
    return Promise.all(slice.map((href) => this.load(href)))
  }
}

export { resolveHref }
