const allowedExternalProtocols = new Set(['https:', 'http:'])

export function classifyLink(rawUrl: string): 'anchor' | 'external' | 'local' | 'blocked' {
  const value = rawUrl.trim()
  if (!value) return 'blocked'
  if (value.startsWith('#')) return 'anchor'
  if (value.startsWith('//')) return 'blocked'

  try {
    const parsed = new URL(value, 'https://local.invalid/')
    if (allowedExternalProtocols.has(parsed.protocol) && parsed.hostname !== 'local.invalid') {
      return 'external'
    }
    if (parsed.origin === 'https://local.invalid' && !value.startsWith('//')) return 'local'
    return 'blocked'
  } catch {
    return 'blocked'
  }
}

export function safeHref(rawUrl?: string): string | undefined {
  if (!rawUrl) return undefined
  return classifyLink(rawUrl) === 'blocked' ? undefined : rawUrl
}

export function slugifyHeading(text: string): string {
  const slug = text
    .trim()
    .toLocaleLowerCase()
    .replace(/[\s]+/g, '-')
    .replace(/[^\p{Letter}\p{Number}_\-\u4e00-\u9fff]/gu, '')
  return slug || 'section'
}

export function createUniqueSlugger(): (text: string) => string {
  const occurrences = new Map<string, number>()
  return (text: string) => {
    const base = slugifyHeading(text)
    const occurrence = (occurrences.get(base) ?? 0) + 1
    occurrences.set(base, occurrence)
    return occurrence === 1 ? base : `${base}-${occurrence}`
  }
}
