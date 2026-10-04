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

  /** Inserts an already-fetched node directly into the cache, no network
   *  request. Used for Items returned whole by a STAC API search response
   *  — unlike a static catalog's `rel:item` links (which only name an href
   *  each Item must be separately fetched from), a `/search` or `rel:items`
   *  response already embeds full Item JSON for every result in the page,
   *  so re-fetching each one individually via `load()` would be pure waste. */
  cachePreFetched(node: StacNode): void {
    if (!this.cache.has(node.href)) this.cache.set(node.href, node)
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
    return results.filter((r): r is PromiseFulfilledResult<StacNode> => r.status === 'fulfilled').map((r) => r.value)
  }

  /** Finds the catalog root a node belongs to, for opening a deep-linked
   *  node (fetched directly, in isolation, with nothing else loaded yet) —
   *  the same "session root" Structure Lens needs to build a tree from.
   *  Prefers the node's own `rel:root` link (one hop, per commons/links.md's
   *  "usually just one root entity") — but only once it has actually
   *  loaded; falls back to walking `parentHref` up, and stops at the last
   *  node that loads. So a node whose links all point nowhere (CoCliCo's
   *  Items carry `/Users/…` paths from the publisher's laptop) opens on
   *  its own instead of failing the whole page; `unreachable` says which
   *  link failed first, for the user, and whether the parent walk still
   *  reached a node with no parent (only the `root` link was broken).
   *  Bounded against a cyclic chain. */
  async resolveRoot(node: StacNode, maxHops = 50): Promise<ResolvedRoot> {
    let unreachable: ResolvedRoot['unreachable']
    if (node.declaredRootHref === node.href) return { rootHref: node.href }
    if (node.declaredRootHref) {
      try {
        await this.load(node.declaredRootHref)
        return { rootHref: node.declaredRootHref }
      } catch (err) {
        unreachable = {
          rel: 'root',
          href: node.declaredRootHref,
          error: errorMessage(err),
          localPath: node.localPathLinks.some((l) => l.rel === 'root'),
          walkComplete: true,
        }
      }
    }
    let current = node
    for (let i = 0; i < maxHops && current.parentHref; i++) {
      const parentHref = current.parentHref
      if (parentHref === current.href) break // self-referencing link, bail out
      try {
        current = this.get(parentHref) ?? (await this.load(parentHref))
      } catch (err) {
        unreachable = unreachable
          ? { ...unreachable, walkComplete: false }
          : {
              rel: 'parent',
              href: parentHref,
              error: errorMessage(err),
              localPath: current.localPathLinks.some((l) => l.rel === 'parent'),
              walkComplete: false,
            }
        break
      }
    }
    return { rootHref: current.href, unreachable }
  }
}

/** Where `resolveRoot` landed, and the first structural link that did not
 *  load on the way, if any. */
export interface ResolvedRoot {
  rootHref: string
  unreachable?: {
    rel: 'root' | 'parent'
    /** Resolved, as fetched. */
    href: string
    error: string
    /** The link was written as a local file path (health rule L-07). */
    localPath: boolean
    /** The parent walk ended at a node with no parent, not at a failure. */
    walkComplete: boolean
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export { resolveHref }
