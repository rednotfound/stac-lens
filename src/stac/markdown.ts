import type { Nodes, Root } from 'mdast'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { gfmFromMarkdown } from 'mdast-util-gfm'
import { gfm } from 'micromark-extension-gfm'

// STAC descriptions (Catalog, Collection, Item, Provider, Asset) "MAY" use
// CommonMark 0.29 for rich text — and real catalogs do: of 461 Collection
// and root descriptions sampled on 2026-10-03, 137 carried links,
// paragraphs, lists, inline code, headings, emphasis; Planetary Computer
// also uses GFM tables, bare URLs and a little raw HTML. They are parsed
// to a syntax tree (mdast) here and rendered by `components/Description`,
// never injected as an HTML string: raw HTML nodes are dropped (their text
// survives as sibling text nodes), link and image URLs are checked there.
//
// This module is loaded on demand (`markdownLoader.ts`), so the landing
// page does not carry the parser.

/** CommonMark plus GitHub-flavoured tables, autolink literals,
 *  strikethrough, task lists and footnotes. */
export function parseMarkdown(text: string): Root {
  return fromMarkdown(text, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] })
}

/** The description as plain text — for the hover card, which has room for
 *  a sentence, not for markup: every block becomes a run of words, blocks
 *  are joined by spaces, raw HTML and images' URLs disappear (an image
 *  keeps its alt text), whitespace collapses. */
export function markdownToPlainText(text: string): string {
  const parts: string[] = []
  const walk = (node: Nodes) => {
    switch (node.type) {
      case 'text':
      case 'inlineCode':
        parts.push(node.value)
        return
      case 'code':
        parts.push(' ', node.value, ' ')
        return
      case 'image':
        if (node.alt) parts.push(node.alt)
        return
      case 'html':
      case 'definition':
      case 'footnoteDefinition':
        return
      case 'break':
        parts.push(' ')
        return
    }
    if ('children' in node) {
      for (const child of node.children) walk(child as Nodes)
      // Block boundaries become spaces so words from adjacent blocks
      // never run together.
      if (node.type !== 'emphasis' && node.type !== 'strong' && node.type !== 'delete' && node.type !== 'link') {
        parts.push(' ')
      }
    }
  }
  walk(parseMarkdown(text))
  return parts.join('').replace(/\s+/g, ' ').trim()
}
