import { createUniqueSlugger } from './security'

export type TocItem = {
  level: number
  text: string
  id: string
}

export function makeToc(markdown: string): TocItem[] {
  const items: TocItem[] = []
  const uniqueSlug = createUniqueSlugger()
  let inFence = false
  for (const line of markdown.split('\n')) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence
      continue
    }
    if (inFence) continue
    const match = /^(#{1,6})\s+(.+?)\s*#*$/.exec(line)
    if (!match) continue
    const text = match[2].replace(/[*_`~]/g, '').trim()
    items.push({ level: match[1].length, text, id: uniqueSlug(text) })
  }
  return items
}
