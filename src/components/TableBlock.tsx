import { useEffect, useId, useState, type ReactNode, type TableHTMLAttributes } from 'react'
import { createPortal } from 'react-dom'

type TableBlockProps = TableHTMLAttributes<HTMLTableElement> & {
  children?: ReactNode
}

export function TableBlock({ children, ...props }: TableBlockProps) {
  const [isFullscreen, setIsFullscreen] = useState(false)
  const titleId = useId()

  useEffect(() => {
    if (!isFullscreen) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsFullscreen(false)
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [isFullscreen])

  const table = <table {...props}>{children}</table>

  return (
    <>
      <div className="table-frame">
        <div className="table-toolbar">
          <span>表格</span>
          <button type="button" onClick={() => setIsFullscreen(true)} aria-label="全屏查看表格">
            全屏查看
          </button>
        </div>
        <div className="table-scroller" tabIndex={0} aria-label="可横向滚动的表格">
          {table}
        </div>
      </div>
      {isFullscreen && createPortal(
        <div className="table-fullscreen" role="dialog" aria-modal="true" aria-labelledby={titleId}>
          <div className="table-fullscreen-toolbar">
            <strong id={titleId}>表格全屏查看</strong>
            <span>可横向、纵向滚动 · 按 Esc 退出</span>
            <button type="button" autoFocus onClick={() => setIsFullscreen(false)}>退出全屏</button>
          </div>
          <div className="table-fullscreen-scroller">
            {table}
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}
