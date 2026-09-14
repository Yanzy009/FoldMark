import { describe, expect, it } from 'vitest'
import { makeToc } from './toc'

describe('table of contents', () => {
  it('includes H1 through H6 and assigns unique duplicate anchors', () => {
    const toc = makeToc('# 标题\n##### 深层\n###### 最深\n## 标题\n## 标题')
    expect(toc.map(({ level, id }) => [level, id])).toEqual([
      [1, '标题'], [5, '深层'], [6, '最深'], [2, '标题-2'], [2, '标题-3'],
    ])
  })

  it('ignores headings inside fenced code', () => {
    expect(makeToc('```md\n# 代码标题\n```\n# 正文')).toHaveLength(1)
  })
})
