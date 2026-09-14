import { describe, expect, it } from 'vitest'
import { classifyLink, createUniqueSlugger, safeHref, slugifyHeading } from './security'

describe('link policy', () => {
  it('allows anchors, local paths and web links', () => {
    expect(classifyLink('#章节')).toBe('anchor')
    expect(classifyLink('./images/chart.png')).toBe('local')
    expect(classifyLink('https://example.com')).toBe('external')
  })

  it('blocks executable and protocol-relative URLs', () => {
    expect(safeHref('javascript:alert(1)')).toBeUndefined()
    expect(safeHref('data:text/html,<script>alert(1)</script>')).toBeUndefined()
    expect(safeHref('//attacker.example/file')).toBeUndefined()
  })
})

describe('heading slug', () => {
  it('keeps readable Chinese anchors', () => {
    expect(slugifyHeading('阶段一：变量 映射')).toBe('阶段一变量-映射')
  })

  it('creates stable unique anchors for repeated headings', () => {
    const slug = createUniqueSlugger()
    expect([slug('结论'), slug('结论'), slug('结论')]).toEqual(['结论', '结论-2', '结论-3'])
  })
})
