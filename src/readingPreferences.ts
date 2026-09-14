export type ReaderWidth = 'focused' | 'standard' | 'wide'

export type ReadingPreferences = {
  fontSize: number
  readerWidth: ReaderWidth
}

export const DEFAULT_READING_PREFERENCES: ReadingPreferences = {
  fontSize: 15,
  readerWidth: 'standard',
}

export const READER_WIDTHS: Record<ReaderWidth, number> = {
  focused: 800,
  standard: 950,
  wide: 1120,
}

export function clampFontSize(value: number): number {
  return Math.min(20, Math.max(13, Math.round(value)))
}

export function parseReadingPreferences(value: string | null): ReadingPreferences {
  if (!value) return DEFAULT_READING_PREFERENCES
  try {
    const parsed = JSON.parse(value) as Partial<ReadingPreferences>
    const readerWidth = parsed.readerWidth
    return {
      fontSize: clampFontSize(typeof parsed.fontSize === 'number' ? parsed.fontSize : 15),
      readerWidth: readerWidth === 'focused' || readerWidth === 'standard' || readerWidth === 'wide'
        ? readerWidth
        : 'standard',
    }
  } catch {
    return DEFAULT_READING_PREFERENCES
  }
}
