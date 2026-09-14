export type HastNode = {
  type?: string
  value?: string
  tagName?: string
  properties?: Record<string, unknown>
  children?: HastNode[]
}

const SEARCH_EXCLUDED_TAGS = new Set(['code', 'pre', 'script', 'style'])

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function highlightedText(value: string, query: string): HastNode[] {
  const expression = new RegExp(escapeRegExp(query), 'giu')
  const result: HastNode[] = []
  let cursor = 0

  for (const match of value.matchAll(expression)) {
    const index = match.index
    if (index > cursor) result.push({ type: 'text', value: value.slice(cursor, index) })
    result.push({
      type: 'element',
      tagName: 'mark',
      properties: { className: ['search-hit'] },
      children: [{ type: 'text', value: match[0] }],
    })
    cursor = index + match[0].length
  }

  if (cursor === 0) return [{ type: 'text', value }]
  if (cursor < value.length) result.push({ type: 'text', value: value.slice(cursor) })
  return result
}

export function highlightSearchTree(tree: HastNode, rawQuery: string): void {
  const query = rawQuery.trim()
  if (!query) return

  function visit(node: HastNode, excluded = false) {
    const nextExcluded = excluded || (node.tagName ? SEARCH_EXCLUDED_TAGS.has(node.tagName) : false)
    if (!node.children) return
    node.children = node.children.flatMap((child) => {
      if (!nextExcluded && child.type === 'text' && child.value) {
        return highlightedText(child.value, query)
      }
      visit(child, nextExcluded)
      return [child]
    })
  }

  visit(tree)
}

export function createSearchHighlightPlugin(query: string) {
  return () => (tree: HastNode) => highlightSearchTree(tree, query)
}
