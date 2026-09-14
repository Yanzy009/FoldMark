import { describe, expect, it } from 'vitest'
import { clampFontSize, DEFAULT_READING_PREFERENCES, parseReadingPreferences } from './readingPreferences'

describe('reading preferences', () => {
  it('clamps font size to the supported range', () => {
    expect(clampFontSize(8)).toBe(13)
    expect(clampFontSize(16.6)).toBe(17)
    expect(clampFontSize(40)).toBe(20)
  })

  it('restores valid preferences and safely falls back', () => {
    expect(parseReadingPreferences('{"fontSize":18,"readerWidth":"wide"}')).toEqual({ fontSize: 18, readerWidth: 'wide' })
    expect(parseReadingPreferences('{broken')).toEqual(DEFAULT_READING_PREFERENCES)
    expect(parseReadingPreferences('{"fontSize":1,"readerWidth":"unknown"}')).toEqual({ fontSize: 13, readerWidth: 'standard' })
  })
})
