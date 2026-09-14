import { describe, expect, it } from 'vitest'
import { centeredTocScrollTarget } from './tocNavigation'

describe('centeredTocScrollTarget', () => {
  const viewport = { top: 100, bottom: 400 }

  it('does not scroll when the active chapter is already centered', () => {
    expect(centeredTocScrollTarget(240, viewport, { top: 235, bottom: 265 }, 900)).toBeNull()
  })

  it('centers a chapter above the middle of the directory', () => {
    expect(centeredTocScrollTarget(240, viewport, { top: 90, bottom: 120 }, 900)).toBe(95)
  })

  it('centers a chapter below the middle of the directory', () => {
    expect(centeredTocScrollTarget(240, viewport, { top: 385, bottom: 420 }, 900)).toBe(393)
  })

  it('clamps centering to both directory boundaries', () => {
    expect(centeredTocScrollTarget(4, viewport, { top: 0, bottom: 30 }, 900)).toBe(0)
    expect(centeredTocScrollTarget(880, viewport, { top: 500, bottom: 530 }, 900)).toBe(900)
  })
})
