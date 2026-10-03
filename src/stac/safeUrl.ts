/** A URL from untrusted catalog text (a description's link or image),
 *  resolved against `base`, kept only if its scheme is one of `schemes`;
 *  `javascript:`, `data:` and anything unparsable come back undefined. */
export function safeUrl(url: string, base: string | undefined, schemes: readonly string[]): string | undefined {
  try {
    const u = new URL(url, base)
    return schemes.includes(u.protocol) ? u.href : undefined
  } catch {
    return undefined
  }
}

export const LINK_SCHEMES = ['http:', 'https:', 'mailto:'] as const
export const IMAGE_SCHEMES = ['http:', 'https:'] as const
