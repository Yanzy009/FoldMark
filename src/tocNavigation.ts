type VerticalBounds = {
  top: number
  bottom: number
}

export function centeredTocScrollTarget(
  currentScrollTop: number,
  viewport: VerticalBounds,
  item: VerticalBounds,
  maxScrollTop: number,
): number | null {
  const viewportCenter = (viewport.top + viewport.bottom) / 2
  const itemCenter = (item.top + item.bottom) / 2
  const target = Math.round(Math.min(maxScrollTop, Math.max(0, currentScrollTop + itemCenter - viewportCenter)))
  return Math.abs(target - currentScrollTop) < 1 ? null : target
}
