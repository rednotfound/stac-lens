// The Markdown parser (`markdown.ts`, ~23 kB gzipped) is a chunk of its own,
// loaded when a catalog is opened rather than with the landing page. Until
// it arrives, descriptions show as plain text and the hover card falls
// back to a regex that drops link syntax — what the app did before.

type MarkdownModule = typeof import('./markdown')

let loaded: MarkdownModule | undefined
let pending: Promise<MarkdownModule> | undefined
const listeners = new Set<() => void>()

export function loadMarkdown(): Promise<MarkdownModule> {
  pending ??= import('./markdown').then((m) => {
    loaded = m
    for (const l of listeners) l()
    return m
  })
  return pending
}

/** The parser if it has arrived (for `useSyncExternalStore`). */
export function markdownModule(): MarkdownModule | undefined {
  return loaded
}

export function subscribeMarkdown(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** How much of a description the plain text is read from. The hover card
 *  shows 160 characters; a few paragraphs' worth is plenty, and parsing
 *  Planetary Computer's 43,034-character description whole takes ~22 ms. */
const PLAIN_TEXT_SOURCE_CHARS = 2000
const PLAIN_TEXT_CACHE_MAX = 2000
const plainCache = new Map<string, string>()

/** Plain text of a description's opening, for short, unstyled places (the
 *  hover card). Read from the first ~2,000 characters, cut at a paragraph
 *  break so no construct is split, and cached per description: hover
 *  handlers call this on every mouse move. */
export function descriptionPlainText(text: string): string {
  if (!loaded)
    return text
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\s+/g, ' ')
      .trim()
  const cached = plainCache.get(text)
  if (cached !== undefined) return cached
  let source = text
  if (text.length > PLAIN_TEXT_SOURCE_CHARS) {
    const cut = text.lastIndexOf('\n\n', PLAIN_TEXT_SOURCE_CHARS)
    source = text.slice(0, cut > 0 ? cut : PLAIN_TEXT_SOURCE_CHARS)
  }
  const plain = loaded.markdownToPlainText(source)
  if (plainCache.size >= PLAIN_TEXT_CACHE_MAX) plainCache.delete(plainCache.keys().next().value!)
  plainCache.set(text, plain)
  return plain
}
