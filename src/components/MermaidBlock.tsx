import { useEffect, useId, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from 'react'
import { sanitizeMermaidSvg } from '../sanitizeMermaid'

const MERMAID_VIEW_STORAGE_KEY = 'markdown-reader.mermaid-view'
const MIN_ZOOM = 0.5
const MAX_ZOOM = 2
const ZOOM_STEP = 0.1

type MermaidView = { zoom: number; fitWidth: boolean }

const mermaidPromise = import('mermaid').then(({ default: mermaid }) => {
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    suppressErrorRendering: true,
    deterministicIds: true,
    theme: 'base',
    themeVariables: {
      primaryColor: '#eaf1ff',
      primaryTextColor: '#1e2b46',
      primaryBorderColor: '#8faee8',
      lineColor: '#637494',
      secondaryColor: '#eef8f2',
      tertiaryColor: '#fff7df',
      fontFamily: 'Inter, PingFang SC, Microsoft YaHei, sans-serif',
    },
  })
  return mermaid
})

export function svgViewBoxSize(svg: string): { width: number; height: number } | undefined {
  const viewBox = /\bviewBox\s*=\s*["']\s*([^"']+)["']/i.exec(svg)?.[1]
    .trim()
    .split(/[\s,]+/)
    .map(Number)
  if (!viewBox || viewBox.length !== 4) return undefined
  const width = viewBox[2]
  const height = viewBox[3]
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return undefined
  return { width, height }
}

export function mermaidDisplayWidth(size: { width: number; height: number }): number | undefined {
  const isTallFlowchart = size.height / size.width >= 1.8
  if (!isTallFlowchart) return undefined

  // Tall top-to-bottom diagrams become exhausting to read when stretched to the
  // full article width. Keep them near Mermaid's natural size, with a modest
  // enlargement for legibility, while still allowing responsive shrinking.
  return Math.min(680, Math.max(520, Math.round(size.width * 1.15)))
}

export function clampMermaidZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(zoom * 10) / 10))
}

function initialMermaidView(): MermaidView {
  try {
    const stored = JSON.parse(localStorage.getItem(MERMAID_VIEW_STORAGE_KEY) ?? '') as Partial<MermaidView>
    return {
      zoom: clampMermaidZoom(typeof stored.zoom === 'number' ? stored.zoom : 1),
      fitWidth: stored.fitWidth === true,
    }
  } catch {
    return { zoom: 1, fitWidth: false }
  }
}

export function MermaidBlock({ source, defer = false }: { source: string; defer?: boolean }) {
  const reactId = useId().replace(/[^a-zA-Z0-9]/g, '')
  const renderId = useMemo(() => `mermaid-${reactId}`, [reactId])
  const [documentHtml, setDocumentHtml] = useState('')
  const [viewBoxSize, setViewBoxSize] = useState<{ width: number; height: number }>()
  const [error, setError] = useState('')
  const [view, setView] = useState<MermaidView>(initialMermaidView)
  const [dragging, setDragging] = useState(false)
  const [readyToRender, setReadyToRender] = useState(!defer)
  const deferredRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ x: number; y: number; left: number; top: number } | undefined>(undefined)

  useEffect(() => {
    if (!defer || readyToRender) return
    const target = deferredRef.current
    if (!target || !('IntersectionObserver' in window)) {
      setReadyToRender(true)
      return
    }
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return
      setReadyToRender(true)
      observer.disconnect()
    }, { rootMargin: '700px 0px' })
    observer.observe(target)
    return () => observer.disconnect()
  }, [defer, readyToRender])

  useEffect(() => {
    if (!readyToRender) return
    let active = true
    setError('')
    setDocumentHtml('')
    setViewBoxSize(undefined)

    void mermaidPromise.then((mermaid) => mermaid.render(renderId, source))
      .then(({ svg }) => {
        if (!active) return
        const cleanSvg = sanitizeMermaidSvg(svg)
        setViewBoxSize(svgViewBoxSize(cleanSvg))
        setDocumentHtml(`<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:"><style>html,body{margin:0;background:transparent;overflow:hidden;line-height:0}svg{display:block;width:100%!important;max-width:none!important;height:auto!important;margin:0}</style></head><body>${cleanSvg}</body></html>`)
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : 'Mermaid 图形无法解析')
      })

    return () => {
      active = false
    }
  }, [readyToRender, renderId, source])

  useEffect(() => {
    try {
      localStorage.setItem(MERMAID_VIEW_STORAGE_KEY, JSON.stringify(view))
    } catch {
      // Controls remain usable if storage is unavailable in a hardened WebView.
    }
  }, [view])

  const changeZoom = (direction: -1 | 1) => {
    setView((current) => ({
      fitWidth: false,
      zoom: clampMermaidZoom(current.zoom + direction * ZOOM_STEP),
    }))
  }

  const handleWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    if (!event.metaKey && !event.ctrlKey) return
    event.preventDefault()
    changeZoom(event.deltaY < 0 ? 1 : -1)
  }

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !(view.fitWidth || view.zoom > 1)) return
    const canvas = canvasRef.current
    if (!canvas) return
    dragRef.current = { x: event.clientX, y: event.clientY, left: canvas.scrollLeft, top: canvas.scrollTop }
    canvas.setPointerCapture(event.pointerId)
    setDragging(true)
    event.preventDefault()
  }

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = dragRef.current
    const canvas = canvasRef.current
    if (!start || !canvas) return
    canvas.scrollLeft = start.left - (event.clientX - start.x)
    canvas.scrollTop = start.top - (event.clientY - start.y)
  }

  const finishDragging = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current) event.currentTarget.releasePointerCapture(event.pointerId)
    dragRef.current = undefined
    setDragging(false)
  }

  if (!readyToRender) return <div ref={deferredRef} className="mermaid-loading">流程图将在滚动到附近时绘制…</div>

  if (error) {
    return (
      <div className="mermaid-error" role="alert">
        <strong>流程图渲染失败</strong>
        <span>{error.split('\n')[0]}</span>
        <pre><code>{source}</code></pre>
      </div>
    )
  }

  if (!documentHtml) return <div className="mermaid-loading">正在绘制流程图…</div>

  const preferredWidth = viewBoxSize ? mermaidDisplayWidth(viewBoxSize) : undefined
  const viewported = view.fitWidth || view.zoom > 1
  const iframeWidth = view.fitWidth
    ? '100%'
    : preferredWidth
      ? `${preferredWidth * view.zoom}px`
      : `${view.zoom * 100}%`

  return (
    <div className={`mermaid-frame${preferredWidth ? ' mermaid-frame--tall' : ''}${viewported ? ' mermaid-frame--viewported' : ''}`}>
      <div className="mermaid-toolbar" aria-label="流程图显示控制">
        <span>流程图</span>
        <div className="mermaid-toolbar-actions">
          <button type="button" onClick={() => changeZoom(-1)} disabled={!view.fitWidth && view.zoom <= MIN_ZOOM} aria-label="缩小流程图" title="缩小 10%">−</button>
          <output aria-label="当前缩放比例">{view.fitWidth ? '适宽' : `${Math.round(view.zoom * 100)}%`}</output>
          <button type="button" onClick={() => changeZoom(1)} disabled={!view.fitWidth && view.zoom >= MAX_ZOOM} aria-label="放大流程图" title="放大 10%">＋</button>
          <button type="button" className={view.fitWidth ? 'is-active' : ''} onClick={() => setView((current) => ({ ...current, fitWidth: true }))}>适应宽度</button>
          <button type="button" onClick={() => setView({ zoom: 1, fitWidth: false })}>重置</button>
          <span className="mermaid-toolbar-hint">⌘/Ctrl + 滚轮</span>
        </div>
      </div>
      <div
        ref={canvasRef}
        className={`mermaid-canvas${dragging ? ' is-dragging' : ''}`}
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishDragging}
        onPointerCancel={finishDragging}
      >
        <iframe
          title="Mermaid 流程图"
          sandbox=""
          srcDoc={documentHtml}
          style={viewBoxSize
            ? {
                aspectRatio: `${viewBoxSize.width} / ${viewBoxSize.height}`,
                height: 'auto',
                width: iframeWidth,
                minWidth: view.zoom === 1 && !preferredWidth && !view.fitWidth ? 620 : 0,
                maxWidth: view.zoom <= 1 && !view.fitWidth ? '100%' : 'none',
              }
            : { height: 360 }}
        />
      </div>
    </div>
  )
}
