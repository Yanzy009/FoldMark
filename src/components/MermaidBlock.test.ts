import { describe, expect, it } from 'vitest'
import { clampMermaidZoom, mermaidDisplayWidth, svgViewBoxSize } from './MermaidBlock'

describe('svgViewBoxSize', () => {
  it('preserves the full aspect ratio of a tall flowchart', () => {
    expect(svgViewBoxSize('<svg viewBox="0 0 480 2160"></svg>')).toEqual({
      width: 480,
      height: 2160,
    })
  })

  it('supports comma-separated values and rejects invalid dimensions', () => {
    expect(svgViewBoxSize("<svg viewBox='0,0,800,600'></svg>")).toEqual({ width: 800, height: 600 })
    expect(svgViewBoxSize('<svg viewBox="0 0 0 600"></svg>')).toBeUndefined()
    expect(svgViewBoxSize('<svg></svg>')).toBeUndefined()
  })
})

describe('mermaidDisplayWidth', () => {
  it('keeps tall flowcharts near their natural reading width', () => {
    expect(mermaidDisplayWidth({ width: 480, height: 2160 })).toBe(552)
    expect(mermaidDisplayWidth({ width: 300, height: 900 })).toBe(520)
    expect(mermaidDisplayWidth({ width: 900, height: 1800 })).toBe(680)
  })

  it('leaves ordinary and wide diagrams fluid', () => {
    expect(mermaidDisplayWidth({ width: 800, height: 600 })).toBeUndefined()
    expect(mermaidDisplayWidth({ width: 800, height: 1200 })).toBeUndefined()
  })
})

describe('clampMermaidZoom', () => {
  it('uses 10 percent steps within the 50 to 200 percent range', () => {
    expect(clampMermaidZoom(0.23)).toBe(0.5)
    expect(clampMermaidZoom(1.06)).toBe(1.1)
    expect(clampMermaidZoom(2.7)).toBe(2)
  })
})
