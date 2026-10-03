import { describe, expect, it } from 'vitest'
import { markdownToPlainText, parseMarkdown } from '../markdown'
import { descriptionPlainText } from '../markdownLoader'
import { IMAGE_SCHEMES, LINK_SCHEMES, safeUrl } from '../safeUrl'

describe('parseMarkdown', () => {
  it('reads CommonMark and GFM tables, autolink literals and strikethrough', () => {
    const tree = parseMarkdown('# T\n\n| a | b |\n|---|--:|\n| 1 | 2 |\n\nSee https://example.org and ~~old~~.')
    expect(tree.children.map((n) => n.type)).toEqual(['heading', 'table', 'paragraph'])
    const p = tree.children[2]
    expect(p.type === 'paragraph' && p.children.map((c) => c.type)).toEqual(['text', 'link', 'text', 'delete', 'text'])
  })
})

describe('markdownToPlainText', () => {
  it('keeps the words, drops the markup', () => {
    expect(markdownToPlainText('A [USGS 3DEP](https://x.org/a) collection with **bold** and `code`.')).toBe(
      'A USGS 3DEP collection with bold and code.',
    )
  })

  it('joins blocks with spaces so words from adjacent blocks never run together', () => {
    expect(markdownToPlainText('## Notes\nFirst.\n\n* one\n* two\n\nLast.')).toBe('Notes First. one two Last.')
  })

  it('drops raw HTML tags but keeps their text, and keeps an image only by its alt text', () => {
    expect(markdownToPlainText('See <a href="https://x.org">the docs</a> ![A map](https://x.org/m.png) now.')).toBe(
      'See the docs A map now.',
    )
  })

  it('keeps table cell text and drops link definitions', () => {
    expect(markdownToPlainText('| a | b |\n|---|---|\n| 1 | 2 |\n\n[x]: https://x.org')).toBe('a b 1 2')
  })
})

describe('descriptionPlainText before the parser has loaded', () => {
  it('falls back to dropping link syntax and collapsing whitespace', () => {
    // This file imports markdown.ts directly, not through the loader, so
    // the loader still reports it as not loaded.
    expect(descriptionPlainText('A [link](https://x.org)\n\nand ![img](https://x.org/i.png).')).toBe('A link and img.')
  })
})

describe('safeUrl', () => {
  it('resolves relative URLs against the node and keeps only allowed schemes', () => {
    expect(safeUrl('../docs.html', 'https://cat.example/c/collection.json', LINK_SCHEMES)).toBe(
      'https://cat.example/docs.html',
    )
    expect(safeUrl('mailto:a@b.org', undefined, LINK_SCHEMES)).toBe('mailto:a@b.org')
    expect(safeUrl('javascript:alert(1)', 'https://cat.example/', LINK_SCHEMES)).toBeUndefined()
    expect(safeUrl('data:image/png;base64,AAAA', undefined, IMAGE_SCHEMES)).toBeUndefined()
    expect(safeUrl('mailto:a@b.org', undefined, IMAGE_SCHEMES)).toBeUndefined()
    expect(safeUrl('not a url', undefined, LINK_SCHEMES)).toBeUndefined()
  })
})

describe('descriptionPlainText once the parser has loaded', () => {
  it('reads only the opening of a long description, cut at a paragraph break, and caches it', async () => {
    const { loadMarkdown } = await import('../markdownLoader')
    await loadMarkdown()
    const long = `First **paragraph**.\n\n${'word '.repeat(300)}\n\n${'Late paragraph that is past the cut. '.repeat(100)}`
    const plain = descriptionPlainText(long)
    expect(plain.startsWith('First paragraph. word word')).toBe(true)
    expect(plain).not.toContain('Late paragraph')
    expect(descriptionPlainText(long)).toBe(plain)
  })
})
