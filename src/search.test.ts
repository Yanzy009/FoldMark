import { describe, expect, it } from 'vitest'
import { highlightSearchTree, type HastNode } from './search'

describe('highlightSearchTree', () => {
  it('highlights literal matches without treating the query as a regular expression', () => {
    const tree: HastNode = { type: 'root', children: [{ type: 'text', value: 'A+B and a+b' }] }
    highlightSearchTree(tree, 'a+b')
    const marks = tree.children!.filter((node) => node.tagName === 'mark')
    expect(marks).toHaveLength(2)
  })

  it('does not alter code blocks', () => {
    const tree: HastNode = {
      type: 'root',
      children: [{ type: 'element', tagName: 'code', children: [{ type: 'text', value: 'fault fault' }] }],
    }
    highlightSearchTree(tree, 'fault')
    expect(tree.children![0].children).toEqual([{ type: 'text', value: 'fault fault' }])
  })
})
