import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { MarkdownView } from './components/MarkdownView'
import { clampFontSize, DEFAULT_READING_PREFERENCES, parseReadingPreferences, READER_WIDTHS, type ReaderWidth, type ReadingPreferences } from './readingPreferences'
import { makeToc, type TocItem } from './toc'
import { centeredTocScrollTarget } from './tocNavigation'
import appIconUrl from '../src-tauri/icons/128x128@2x.png'

type Theme = 'light' | 'dark'

type DocumentPayload = {
  token: string
  name: string
  displayPath: string
  markdown: string
  size: number
  modifiedMillis: number
}

type DocumentChanged = {
  token: string
  kind: string
}

type RecentDocument = {
  id: string
  name: string
  displayPath: string
}

type LibraryDocument = {
  id: string
  name: string
  relativePath: string
}

type LibraryPayload = {
  token: string
  name: string
  documents: LibraryDocument[]
  truncated: boolean
}

type ReadingPosition = {
  headingId: string | null
  headingOffset: number
  scrollTop: number
}

type ReaderTab = {
  id: string
  documentKey: string
  markdown: string
  fileName: string
  fileSize: number
  token: string | null
  displayPath: string | null
}

const THEME_STORAGE_KEY = 'markdown-reader.theme'
const READING_PREFERENCES_STORAGE_KEY = 'markdown-reader.reading-preferences'
const LARGE_DOCUMENT_BYTES = 2 * 1024 * 1024
function initialTheme(): Theme {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY)
    if (stored === 'light' || stored === 'dark') return stored
  } catch {
    // localStorage may be unavailable in hardened WebViews; the default still works.
  }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function positionStorageKey(documentKey: string): string {
  return `markdown-reader.position:${documentKey}`
}

function initialReadingPreferences(): ReadingPreferences {
  try {
    return parseReadingPreferences(localStorage.getItem(READING_PREFERENCES_STORAGE_KEY))
  } catch {
    return DEFAULT_READING_PREFERENCES
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function isMarkdownPath(path: string): boolean {
  return /\.(?:md|markdown)$/i.test(path)
}

export default function App() {
  const [tabs, setTabs] = useState<ReaderTab[]>([])
  const [activeTabId, setActiveTabId] = useState<string | null>(null)
  const [theme, setTheme] = useState<Theme>(initialTheme)
  const [readingPreferences, setReadingPreferences] = useState<ReadingPreferences>(initialReadingPreferences)
  const [readingSettingsOpen, setReadingSettingsOpen] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(() => window.innerWidth > 820)
  const [notice, setNotice] = useState('')
  const [isChoosingDocument, setIsChoosingDocument] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchIndex, setSearchIndex] = useState(0)
  const [searchCount, setSearchCount] = useState(0)
  const [recentDocuments, setRecentDocuments] = useState<RecentDocument[]>([])
  const [library, setLibrary] = useState<LibraryPayload | null>(null)
  const [libraryQuery, setLibraryQuery] = useState('')
  const [isChoosingLibrary, setIsChoosingLibrary] = useState(false)
  const [isDraggingDocument, setIsDraggingDocument] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const searchInput = useRef<HTMLInputElement>(null)
  const readerScroll = useRef<HTMLElement>(null)
  const article = useRef<HTMLElement>(null)
  const tocNavigation = useRef<HTMLElement>(null)
  const activeTocIndex = useRef<number | null>(null)
  const tocAutoFollow = useRef(true)
  const tocNeedsCentering = useRef(true)
  const tocHighlightBubble = useRef<HTMLDivElement>(null)
  const tocScrollFrame = useRef<number | null>(null)
  const readingSettings = useRef<HTMLDivElement>(null)
  const openDroppedDocumentsRef = useRef<(paths: string[]) => Promise<void>>(async () => undefined)
  const openPendingDocumentsRef = useRef<() => Promise<void>>(async () => undefined)
  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0] ?? null
  const markdown = activeTab?.markdown ?? ''
  const fileName = activeTab?.fileName ?? ''
  const fileSize = activeTab?.fileSize ?? 0
  const activeToken = activeTab?.token ?? null
  const documentKey = activeTab?.documentKey ?? null
  const performanceMode = fileSize >= LARGE_DOCUMENT_BYTES
  const toc = useMemo(() => makeToc(markdown), [markdown])
  const visibleLibraryDocuments = useMemo(() => {
    const query = libraryQuery.trim().toLocaleLowerCase()
    const matching = query
      ? library?.documents.filter((document) => document.relativePath.toLocaleLowerCase().includes(query)) ?? []
      : library?.documents ?? []
    return matching.slice(0, 200)
  }, [library, libraryQuery])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme)
    } catch {
      // Keep theme changes functional even if persistence is unavailable.
    }
  }, [theme])

  useEffect(() => {
    void refreshRecentDocuments()
  }, [])

  useEffect(() => {
    if (!('__TAURI_INTERNALS__' in window)) return
    let cancelled = false
    let stopListening: (() => void) | undefined
    void import('@tauri-apps/api/event').then(async ({ listen }) => {
      const unlisten = await listen('pending-open-documents', () => {
        if (!cancelled) void openPendingDocumentsRef.current()
      })
      if (cancelled) unlisten()
      else {
        stopListening = unlisten
        void openPendingDocumentsRef.current()
      }
    }).catch((error: unknown) => {
      if (!cancelled) setNotice(`系统文件打开功能初始化失败：${error instanceof Error ? error.message : String(error)}`)
    })
    return () => {
      cancelled = true
      stopListening?.()
    }
  }, [])

  useEffect(() => {
    if (!('__TAURI_INTERNALS__' in window)) return
    let cancelled = false
    let stopListening: (() => void) | undefined

    void import('@tauri-apps/api/window').then(async ({ getCurrentWindow }) => {
      const unlisten = await getCurrentWindow().onDragDropEvent(({ payload }) => {
        if (cancelled) return
        if (payload.type === 'enter' || payload.type === 'over') {
          setIsDraggingDocument(true)
        } else if (payload.type === 'leave') {
          setIsDraggingDocument(false)
        } else if (payload.type === 'drop') {
          setIsDraggingDocument(false)
          void openDroppedDocumentsRef.current(payload.paths)
        }
      })
      if (cancelled) unlisten()
      else stopListening = unlisten
    }).catch((error: unknown) => {
      if (!cancelled) setNotice(`拖放功能初始化失败：${error instanceof Error ? error.message : String(error)}`)
    })

    return () => {
      cancelled = true
      stopListening?.()
    }
  }, [])

  useEffect(() => {
    try {
      localStorage.setItem(READING_PREFERENCES_STORAGE_KEY, JSON.stringify(readingPreferences))
    } catch {
      // Reading controls remain available when persistence is unavailable.
    }
  }, [readingPreferences])

  useEffect(() => {
    if (!readingSettingsOpen) return
    function closeSettings(event: PointerEvent) {
      if (!readingSettings.current?.contains(event.target as Node)) setReadingSettingsOpen(false)
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setReadingSettingsOpen(false)
    }
    document.addEventListener('pointerdown', closeSettings)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeSettings)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [readingSettingsOpen])

  useEffect(() => {
    function focusSearch(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === 'b') {
        event.preventDefault()
        setSidebarOpen((open) => !open)
        return
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === 'f') {
        event.preventDefault()
        searchInput.current?.focus()
        searchInput.current?.select()
      }
    }
    window.addEventListener('keydown', focusSearch)
    return () => window.removeEventListener('keydown', focusSearch)
  }, [])

  useLayoutEffect(() => {
    if (!readerScroll.current) return
    readerScroll.current.scrollTop = 0
    readerScroll.current.scrollLeft = 0
  }, [documentKey])

  function stopTocMotion() {
    if (tocScrollFrame.current !== null) {
      window.cancelAnimationFrame(tocScrollFrame.current)
      tocScrollFrame.current = null
    }
    tocHighlightBubble.current?.querySelector<HTMLElement>('span')?.getAnimations().forEach((animation) => animation.cancel())
  }

  function animateTocScroll(navigation: HTMLElement, target: number) {
    if (tocScrollFrame.current !== null) window.cancelAnimationFrame(tocScrollFrame.current)
    const start = navigation.scrollTop
    const distance = target - start
    if (Math.abs(distance) < 1 || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      navigation.scrollTop = target
      tocScrollFrame.current = null
      return
    }

    const startedAt = performance.now()
    const duration = Math.min(460, Math.max(240, 210 + Math.abs(distance) * 0.32))
    const step = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / duration)
      const eased = 1 - Math.pow(1 - progress, 4)
      navigation.scrollTop = start + distance * eased
      if (progress < 1) tocScrollFrame.current = window.requestAnimationFrame(step)
      else tocScrollFrame.current = null
    }
    tocScrollFrame.current = window.requestAnimationFrame(step)
  }

  function moveTocBubble(activeItem: HTMLElement, changed: boolean) {
    const bubble = tocHighlightBubble.current
    if (!bubble) return
    const previousTop = Number.parseFloat(bubble.dataset.top ?? `${activeItem.offsetTop}`)
    const nextTop = activeItem.offsetTop
    const direction = Math.sign(nextTop - previousTop)
    const wasReady = bubble.classList.contains('is-ready')

    bubble.style.height = `${activeItem.offsetHeight}px`
    bubble.style.transform = `translate3d(0, ${nextTop}px, 0)`
    bubble.style.opacity = '1'
    bubble.dataset.top = `${nextTop}`
    if (!wasReady) {
      bubble.getBoundingClientRect()
      bubble.classList.add('is-ready')
    }

    const droplet = bubble.querySelector<HTMLElement>('span')
    if (!changed || !wasReady || !droplet || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    droplet.getAnimations().forEach((animation) => animation.cancel())
    droplet.style.transformOrigin = direction >= 0 ? '50% 20%' : '50% 80%'
    const stretch = 1 + Math.min(.26, .1 + Math.abs(nextTop - previousTop) / 620)
    const travel = direction * Math.min(3, 1.5 + Math.abs(nextTop - previousTop) / 180)
    droplet.animate([
      { transform: 'translateY(0) scaleX(1) scaleY(1)', filter: 'brightness(1) saturate(1)' },
      { transform: `translateY(${travel}px) scaleX(.93) scaleY(${stretch})`, filter: 'brightness(1.09) saturate(1.12)', offset: .42 },
      { transform: `translateY(${-travel * .28}px) scaleX(1.045) scaleY(.94)`, filter: 'brightness(1.045) saturate(1.06)', offset: .72 },
      { transform: `translateY(${travel * .1}px) scaleX(.99) scaleY(1.025)`, filter: 'brightness(1.015) saturate(1.02)', offset: .88 },
      { transform: 'scaleX(1) scaleY(1)', filter: 'brightness(1)' },
    ], { duration: 480, easing: 'cubic-bezier(.2,.82,.2,1)' })
  }

  function highlightTocItem(index: number | null) {
    const navigation = tocNavigation.current
    if (!navigation) return
    const changed = activeTocIndex.current !== index

    if (changed) {
      navigation.querySelectorAll<HTMLElement>('.is-active').forEach((item) => {
        item.classList.remove('is-active')
        item.removeAttribute('aria-current')
      })
      activeTocIndex.current = index
    }
    if (index === null) return

    const activeItem = navigation.querySelector<HTMLElement>(`[data-toc-index="${index}"]`)
    if (!activeItem) return
    if (changed) {
      activeItem.classList.add('is-active')
      activeItem.setAttribute('aria-current', 'location')
    }
    moveTocBubble(activeItem, changed)
    if (!tocAutoFollow.current || (!changed && !tocNeedsCentering.current)) return

    const target = centeredTocScrollTarget(
      navigation.scrollTop,
      navigation.getBoundingClientRect(),
      activeItem.getBoundingClientRect(),
      Math.max(0, navigation.scrollHeight - navigation.clientHeight),
    )
    tocNeedsCentering.current = false
    if (target !== null) animateTocScroll(navigation, target)
  }

  function pauseTocAutoFollow() {
    tocAutoFollow.current = false
    tocNeedsCentering.current = false
    stopTocMotion()
  }

  useEffect(() => {
    const scroller = readerScroll.current
    const content = article.current
    if (!scroller || !content || !documentKey) {
      highlightTocItem(null)
      return
    }
    activeTocIndex.current = null
    tocAutoFollow.current = true
    tocNeedsCentering.current = true
    stopTocMotion()
    const bubble = tocHighlightBubble.current
    if (bubble) {
      bubble.classList.remove('is-ready')
      bubble.style.opacity = '0'
      delete bubble.dataset.top
    }
    let frame: number | undefined

    function updateActiveHeading() {
      if (!scroller || !content) return
      const headings = Array.from(content.querySelectorAll<HTMLElement>('h1[id], h2[id], h3[id], h4[id], h5[id], h6[id]'))
      if (headings.length === 0) {
        highlightTocItem(null)
        return
      }
      const readingLine = scroller.getBoundingClientRect().top + 72
      let activeIndex = 0
      for (let index = 0; index < headings.length; index += 1) {
        if (headings[index].getBoundingClientRect().top > readingLine) break
        activeIndex = index
      }
      highlightTocItem(activeIndex)
    }

    function handleScroll() {
      if (!tocAutoFollow.current) {
        tocAutoFollow.current = true
        tocNeedsCentering.current = true
      }
      if (frame) return
      frame = window.requestAnimationFrame(() => {
        frame = undefined
        updateActiveHeading()
      })
    }

    const initialFrame = window.requestAnimationFrame(updateActiveHeading)
    scroller.addEventListener('scroll', handleScroll, { passive: true })
    window.addEventListener('resize', handleScroll)
    return () => {
      window.cancelAnimationFrame(initialFrame)
      if (frame) window.cancelAnimationFrame(frame)
      scroller.removeEventListener('scroll', handleScroll)
      window.removeEventListener('resize', handleScroll)
    }
  }, [documentKey, markdown])

  useEffect(() => {
    const scroller = readerScroll.current
    const content = article.current
    if (!scroller || !content || !documentKey) return
    let timer: number | undefined

    function savePosition() {
      if (!scroller || !content) return
      const viewportTop = scroller.getBoundingClientRect().top
      const headings = Array.from(content.querySelectorAll<HTMLElement>('h1[id], h2[id], h3[id], h4[id], h5[id], h6[id]'))
      const current = headings.filter((heading) => heading.getBoundingClientRect().top <= viewportTop + 28).at(-1)
      const position: ReadingPosition = {
        headingId: current?.id ?? null,
        headingOffset: current ? viewportTop - current.getBoundingClientRect().top : 0,
        scrollTop: scroller.scrollTop,
      }
      try {
        localStorage.setItem(positionStorageKey(documentKey), JSON.stringify(position))
      } catch {
        // Reading continues normally when persistence is unavailable.
      }
    }

    function handleScroll() {
      if (timer) window.clearTimeout(timer)
      timer = window.setTimeout(savePosition, 160)
    }

    scroller.addEventListener('scroll', handleScroll, { passive: true })
    return () => {
      if (timer) window.clearTimeout(timer)
      scroller.removeEventListener('scroll', handleScroll)
    }
  }, [documentKey])

  useEffect(() => {
    const scroller = readerScroll.current
    if (!scroller || !documentKey) return
    let position: ReadingPosition | undefined
    try {
      const saved = localStorage.getItem(positionStorageKey(documentKey))
      position = saved ? JSON.parse(saved) as ReadingPosition : undefined
    } catch {
      position = undefined
    }
    if (!position) return

    const frame = window.requestAnimationFrame(() => {
      const heading = position?.headingId ? document.getElementById(position.headingId) : null
      if (!heading) {
        scroller.scrollTop = position?.scrollTop ?? 0
        return
      }
      const viewportTop = scroller.getBoundingClientRect().top
      scroller.scrollTop += heading.getBoundingClientRect().top - viewportTop + position.headingOffset
    })
    return () => window.cancelAnimationFrame(frame)
  }, [documentKey, markdown])

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const hits = Array.from(article.current?.querySelectorAll<HTMLElement>('mark.search-hit') ?? [])
      setSearchCount(hits.length)
      hits.forEach((hit) => hit.classList.remove('search-hit-active'))
      if (!searchQuery.trim() || hits.length === 0) return
      const normalizedIndex = ((searchIndex % hits.length) + hits.length) % hits.length
      if (normalizedIndex !== searchIndex) setSearchIndex(normalizedIndex)
      const active = hits[normalizedIndex]
      active.classList.add('search-hit-active')
      active.scrollIntoView({ behavior: 'smooth', block: 'center' })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [markdown, searchIndex, searchQuery])

  useEffect(() => {
    if (!activeToken || !('__TAURI_INTERNALS__' in window)) return
    let cancelled = false
    let stopListening: (() => void) | undefined
    let refreshTimer: number | undefined

    void import('@tauri-apps/api/event').then(async ({ listen }) => {
      stopListening = await listen<DocumentChanged>('document-changed', (event) => {
        if (event.payload.token !== activeToken) return
        if (refreshTimer) window.clearTimeout(refreshTimer)
        refreshTimer = window.setTimeout(() => {
          void import('@tauri-apps/api/core')
            .then(({ invoke }) => invoke<DocumentPayload>('read_markdown_document', { token: activeToken }))
            .then((document) => {
              if (cancelled) return
              setTabs((current) => current.map((tab) => tab.id === activeTabId
                ? { ...tab, markdown: document.markdown, fileSize: document.size }
                : tab))
              setNotice(`已自动刷新 · ${new Date().toLocaleTimeString()}`)
            })
            .catch((error: unknown) => {
              if (!cancelled) setNotice(`自动刷新失败：${error instanceof Error ? error.message : String(error)}`)
            })
        }, 220)
      })
    })

    return () => {
      cancelled = true
      if (refreshTimer) window.clearTimeout(refreshTimer)
      stopListening?.()
    }
  }, [activeTabId, activeToken])

  function releaseDocumentToken(token: string | null) {
    if (!token || !('__TAURI_INTERNALS__' in window)) return
    void import('@tauri-apps/api/core')
      .then(({ invoke }) => invoke('close_document', { token }))
      .catch(() => undefined)
  }

  function activateTab(id: string, message?: string) {
    setActiveTabId(id)
    setSearchQuery('')
    setSearchIndex(0)
    if (message) setNotice(message)
  }

  function addOrReplaceTab(nextTab: ReaderTab, message: string) {
    const existing = tabs.find((tab) => tab.documentKey === nextTab.documentKey)
    if (existing) {
      if (existing.token !== nextTab.token) releaseDocumentToken(existing.token)
      setTabs((current) => current.map((tab) => tab.id === existing.id ? { ...nextTab, id: existing.id } : tab))
      activateTab(existing.id, message)
      return
    }
    setTabs((current) => [...current, nextTab])
    activateTab(nextTab.id, message)
  }

  async function openFile(file?: File) {
    if (!file) return
    if (!isMarkdownPath(file.name)) {
      setNotice('请选择 .md 或 .markdown 文件')
      return
    }
    if (file.size > 10 * 1024 * 1024) {
      setNotice('文档超过 10 MB，首次显示可能需要较长时间')
    } else {
      setNotice('文档已在本地读取，不会上传')
    }
    const text = await file.text()
    const key = `browser:${file.name}:${file.size}:${file.lastModified}`
    addOrReplaceTab({
      id: key,
      documentKey: key,
      markdown: text,
      fileName: file.name,
      fileSize: file.size,
      token: null,
      displayPath: null,
    }, '文档已在本地读取，不会上传')
  }

  function applyDesktopDocument(document: DocumentPayload) {
    addOrReplaceTab({
      id: document.token,
      documentKey: document.displayPath,
      markdown: document.markdown,
      fileName: document.name,
      fileSize: document.size,
      token: document.token,
      displayPath: document.displayPath,
    }, `已通过桌面安全文件层打开 · ${document.displayPath}`)
    void refreshRecentDocuments()
  }

  async function openDroppedDocuments(paths: string[]) {
    const markdownPaths = paths.filter(isMarkdownPath)
    if (markdownPaths.length === 0) {
      setNotice('未检测到 .md 或 .markdown 文件')
      return
    }
    try {
      const { invoke } = await import('@tauri-apps/api/core')
      let opened = 0
      for (const path of markdownPaths) {
        const document = await invoke<DocumentPayload>('open_dropped_document', { path })
        applyDesktopDocument(document)
        opened += 1
      }
      const ignored = paths.length - markdownPaths.length
      setNotice(`已拖入打开 ${opened} 个 Markdown 文件${ignored ? `，已忽略 ${ignored} 个其他项` : ''}`)
    } catch (error) {
      setNotice(`拖入打开失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  openDroppedDocumentsRef.current = openDroppedDocuments

  async function openPendingDocuments() {
    try {
      const { invoke } = await import('@tauri-apps/api/core')
      const documents = await invoke<DocumentPayload[]>('open_pending_documents')
      documents.forEach(applyDesktopDocument)
      if (documents.length) setNotice(`已从系统打开 ${documents.length} 个 Markdown 文件`)
    } catch (error) {
      setNotice(`系统文件打开失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  openPendingDocumentsRef.current = openPendingDocuments

  async function openLinkedDocument(relativePath: string) {
    if (!activeToken) {
      setNotice('浏览器预览模式不能访问相邻文件，请使用桌面版打开当前文档')
      return
    }
    try {
      const { invoke } = await import('@tauri-apps/api/core')
      const document = await invoke<DocumentPayload>('open_linked_document', {
        token: activeToken,
        relativePath,
      })
      applyDesktopDocument(document)
    } catch (error) {
      setNotice(`无法打开文档链接：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  function closeTab(id: string) {
    const index = tabs.findIndex((tab) => tab.id === id)
    if (index < 0) return
    const closing = tabs[index]
    releaseDocumentToken(closing.token)
    if (tabs.length === 1) {
      setTabs([])
      setActiveTabId(null)
      activeTocIndex.current = null
      tocAutoFollow.current = true
      tocNeedsCentering.current = true
      setSearchQuery('')
      setSearchIndex(0)
      setNotice('')
      return
    }
    const remaining = tabs.filter((tab) => tab.id !== id)
    setTabs(remaining)
    if (id === activeTabId) {
      const next = remaining[Math.min(index, remaining.length - 1)]
      activateTab(next.id, `已切换至 ${next.fileName}`)
    }
  }

  async function refreshRecentDocuments() {
    if (!('__TAURI_INTERNALS__' in window)) return
    try {
      const { invoke } = await import('@tauri-apps/api/core')
      setRecentDocuments(await invoke<RecentDocument[]>('list_recent_documents'))
    } catch {
      setRecentDocuments([])
    }
  }

  async function reopenRecentDocument(id: string) {
    setNotice('正在安全地重新打开最近文件…')
    try {
      const { invoke } = await import('@tauri-apps/api/core')
      applyDesktopDocument(await invoke<DocumentPayload>('open_recent_document', { id }))
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error))
    }
  }

  async function chooseLibrary() {
    if (isChoosingLibrary || !('__TAURI_INTERNALS__' in window)) return
    setIsChoosingLibrary(true)
    setNotice('正在等待选择 Markdown 文档库文件夹…')
    try {
      const { invoke } = await import('@tauri-apps/api/core')
      const selected = await invoke<LibraryPayload | null>('choose_document_library')
      if (!selected) {
        setNotice('已取消选择文档库')
        return
      }
      setLibrary(selected)
      setLibraryQuery('')
      setNotice(`文档库“${selected.name}”已载入 · ${selected.documents.length} 个 Markdown 文件${selected.truncated ? '（已达到 2000 项安全上限）' : ''}`)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error))
    } finally {
      setIsChoosingLibrary(false)
    }
  }

  async function openLibraryDocument(documentId: string) {
    if (!library) return
    setNotice('正在从文档库安全打开文件…')
    try {
      const { invoke } = await import('@tauri-apps/api/core')
      applyDesktopDocument(await invoke<DocumentPayload>('open_library_document', {
        libraryToken: library.token,
        documentId,
      }))
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error))
    }
  }

  function moveSearch(direction: 1 | -1) {
    if (searchCount === 0) return
    setSearchIndex((current) => (current + direction + searchCount) % searchCount)
  }

  async function chooseDocument() {
    if (isChoosingDocument) return
    if (!('__TAURI_INTERNALS__' in window)) {
      fileInput.current?.click()
      return
    }
    setIsChoosingDocument(true)
    setNotice('正在等待选择 Markdown 文件…')
    try {
      const { invoke } = await import('@tauri-apps/api/core')
      const document = await invoke<DocumentPayload | null>('choose_markdown_document')
      if (document) applyDesktopDocument(document)
      else setNotice('已取消选择，当前文档保持不变')
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error))
    } finally {
      setIsChoosingDocument(false)
    }
  }

  function jumpTo(id: string, index: number) {
    tocAutoFollow.current = true
    tocNeedsCentering.current = true
    highlightTocItem(index)
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  function setReaderWidth(readerWidth: ReaderWidth) {
    setReadingPreferences((current) => ({ ...current, readerWidth }))
  }

  const readerStyle = {
    '--reader-font-size': `${readingPreferences.fontSize}px`,
    '--reader-width': `${READER_WIDTHS[readingPreferences.readerWidth]}px`,
  } as CSSProperties

  return (
    <div
      className="app-shell"
      style={readerStyle}
      onDragOver={(event) => event.preventDefault()}
      onDragEnter={() => setIsDraggingDocument(true)}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setIsDraggingDocument(false)
      }}
      onDrop={(event) => {
        event.preventDefault()
        setIsDraggingDocument(false)
        void openFile(event.dataTransfer.files[0])
      }}
    >
      <header className="topbar">
        <div className="brand">
          <button
            className="brand-icon-button"
            type="button"
            onClick={() => setSidebarOpen(!sidebarOpen)}
            aria-label={sidebarOpen ? '收起侧边栏' : '展开侧边栏'}
            aria-expanded={sidebarOpen}
            title={`${sidebarOpen ? '收起' : '展开'}侧边栏（⌘/Ctrl + B）`}
          >
            <img src={appIconUrl} alt="" />
          </button>
          <div>
            <strong>轻量 Markdown 阅读器</strong>
          </div>
        </div>
        <div className="toolbar">
          <input
            ref={fileInput}
            type="file"
            accept=".md,text/markdown,text/plain"
            hidden
            onChange={(event) => void openFile(event.target.files?.[0])}
          />
          <div className="search-control" role="search">
            <span aria-hidden="true">⌕</span>
            <input
              ref={searchInput}
              type="search"
              disabled={!activeTab}
              value={searchQuery}
              placeholder="搜索文档"
              aria-label="搜索文档"
              onChange={(event) => {
                setSearchQuery(event.target.value)
                setSearchIndex(0)
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') moveSearch(event.shiftKey ? -1 : 1)
                if (event.key === 'Escape') setSearchQuery('')
              }}
            />
            <small aria-live="polite">{searchQuery ? `${searchCount ? searchIndex + 1 : 0}/${searchCount}` : ''}</small>
            <button type="button" disabled={!searchCount} onClick={() => moveSearch(-1)} aria-label="上一个搜索结果">↑</button>
            <button type="button" disabled={!searchCount} onClick={() => moveSearch(1)} aria-label="下一个搜索结果">↓</button>
          </div>
          <button
            className="secondary-button"
            type="button"
            disabled={isChoosingDocument}
            onClick={() => void chooseDocument()}
          >
            {isChoosingDocument ? '等待选择…' : '打开 Markdown'}
          </button>
          <div ref={readingSettings} className="reading-settings">
            <button
              className="icon-button reading-settings-trigger"
              type="button"
              aria-label="阅读设置"
              aria-expanded={readingSettingsOpen}
              onClick={() => setReadingSettingsOpen((open) => !open)}
            >
              Aa
            </button>
            {readingSettingsOpen && (
              <div className="reading-settings-popover" role="dialog" aria-label="阅读设置面板">
                <div className="setting-row">
                  <div><strong>正文字号</strong><span>13–20 px</span></div>
                  <div className="font-size-control">
                    <button type="button" disabled={readingPreferences.fontSize <= 13} onClick={() => setReadingPreferences((current) => ({ ...current, fontSize: clampFontSize(current.fontSize - 1) }))} aria-label="减小正文字号">−</button>
                    <output aria-label="当前正文字号">{readingPreferences.fontSize}px</output>
                    <button type="button" disabled={readingPreferences.fontSize >= 20} onClick={() => setReadingPreferences((current) => ({ ...current, fontSize: clampFontSize(current.fontSize + 1) }))} aria-label="增大正文字号">＋</button>
                  </div>
                </div>
                <div className="setting-group">
                  <strong>正文行宽</strong>
                  <div className="width-options">
                    <button type="button" className={readingPreferences.readerWidth === 'focused' ? 'is-active' : ''} onClick={() => setReaderWidth('focused')}>专注</button>
                    <button type="button" className={readingPreferences.readerWidth === 'standard' ? 'is-active' : ''} onClick={() => setReaderWidth('standard')}>标准</button>
                    <button type="button" className={readingPreferences.readerWidth === 'wide' ? 'is-active' : ''} onClick={() => setReaderWidth('wide')}>宽屏</button>
                  </div>
                </div>
                <button type="button" className="reset-reading-settings" onClick={() => setReadingPreferences(DEFAULT_READING_PREFERENCES)}>恢复默认阅读设置</button>
              </div>
            )}
          </div>
          <button className="icon-button" type="button" onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')} aria-label="切换深浅主题">
            {theme === 'light' ? '☾' : '☀'}
          </button>
        </div>
      </header>

      {tabs.length > 0 && (
        <div className="document-tabs" role="tablist" aria-label="已打开的文档">
          {tabs.map((tab) => (
            <div key={tab.id} className={`document-tab ${tab.id === activeTabId ? 'is-active' : ''}`}>
              <button
                type="button"
                role="tab"
                aria-selected={tab.id === activeTabId}
                title={tab.displayPath ?? tab.fileName}
                onClick={() => activateTab(tab.id, `已切换至 ${tab.fileName}`)}
              >
                <span>MD</span>
                <strong>{tab.fileName}</strong>
              </button>
              <button type="button" className="close-tab" aria-label={`关闭 ${tab.fileName}`} onClick={() => closeTab(tab.id)}>×</button>
            </div>
          ))}
        </div>
      )}

      <div className={`workspace ${sidebarOpen ? '' : 'sidebar-collapsed'} ${tabs.length === 0 ? 'without-tabs' : ''}`}>
        <aside className="sidebar">
          <section className="document-library" aria-label="文档库">
            <div className="library-header">
              <strong>{library?.name ?? 'Markdown 文档库'}</strong>
              <button type="button" disabled={isChoosingLibrary} onClick={() => void chooseLibrary()}>
                {isChoosingLibrary ? '等待…' : library ? '更换' : '选择文件夹'}
              </button>
            </div>
            {library && (
              <>
                <input
                  type="search"
                  value={libraryQuery}
                  placeholder={`筛选 ${library.documents.length} 个文档`}
                  aria-label="筛选文档库"
                  onChange={(event) => setLibraryQuery(event.target.value)}
                />
                <div className="library-list">
                  {visibleLibraryDocuments.map((document) => (
                    <button type="button" key={document.id} title={document.relativePath} onClick={() => void openLibraryDocument(document.id)}>
                      <strong>{document.name}</strong>
                      <span>{document.relativePath}</span>
                    </button>
                  ))}
                  {visibleLibraryDocuments.length === 0 && <span className="library-empty">没有匹配的 Markdown 文件</span>}
                </div>
                {library.documents.length > visibleLibraryDocuments.length && !libraryQuery && (
                  <small className="library-limit">先显示前 200 项，可输入关键词筛选</small>
                )}
              </>
            )}
          </section>
          {recentDocuments.length > 0 && (
            <section className="recent-documents" aria-label="最近文件">
              <div className="sidebar-heading">
                <span>最近文件</span>
                <small>{recentDocuments.length} 项</small>
              </div>
              <div className="recent-list">
                {recentDocuments.map((document) => (
                  <button type="button" key={document.id} title={document.displayPath} onClick={() => void reopenRecentDocument(document.id)}>
                    <strong>{document.name}</strong>
                    <span>{document.displayPath.slice(0, -(document.name.length + 1))}</span>
                  </button>
                ))}
              </div>
            </section>
          )}
          <div className="sidebar-heading">
            <span>文档目录</span>
            <small>{toc.length} 项</small>
          </div>
          <nav
            ref={tocNavigation}
            className="toc"
            aria-label="文档目录"
            onWheel={pauseTocAutoFollow}
            onPointerDown={(event) => {
              if (!(event.target as Element).closest('button')) pauseTocAutoFollow()
            }}
            onTouchStart={(event) => {
              if (!(event.target as Element).closest('button')) pauseTocAutoFollow()
            }}
          >
            <div ref={tocHighlightBubble} className="toc-highlight-bubble" aria-hidden="true"><span /></div>
            {toc.map((item, index) => (
              <button
                type="button"
                key={`${item.id}-${index}`}
                className={`toc-level-${item.level}`}
                data-toc-index={index}
                onClick={() => jumpTo(item.id, index)}
              >
                {item.text}
              </button>
            ))}
          </nav>
          <div className="privacy-note"><span>●</span> 文件只在当前设备解析</div>
        </aside>

        <main ref={readerScroll} className="reader-scroll">
          {activeTab ? (
            <>
              <div className="notice-bar">
                <span>{notice}</span>
                <span>{formatSize(fileSize)} · {activeToken ? '已授权只读' : '本地只读'}</span>
              </div>
              <article ref={article} className={`markdown-body${performanceMode ? ' performance-mode' : ''}`}>
                {performanceMode && <div className="performance-notice">大文件阅读模式 · 已暂停代码高亮，并按需绘制流程图</div>}
                <MarkdownView
                  markdown={markdown}
                  assetToken={activeToken}
                  searchQuery={searchQuery}
                  performanceMode={performanceMode}
                  onOpenLocalDocument={(path) => void openLinkedDocument(path)}
                />
              </article>
              <footer className="document-footer">文档结束 · {fileName}</footer>
            </>
          ) : (
            <section className="empty-reader" aria-label="尚未打开文档">
              <img src={appIconUrl} alt="" />
              <strong>打开一份 Markdown，开始安静阅读</strong>
              <span>可选择文件、从左侧文档库打开，或直接拖入窗口</span>
              <button type="button" disabled={isChoosingDocument} onClick={() => void chooseDocument()}>
                {isChoosingDocument ? '等待选择…' : '打开 Markdown'}
              </button>
            </section>
          )}
        </main>
      </div>
      {isDraggingDocument && (
        <div className="drop-overlay" role="status" aria-live="polite">
          <div>
            <strong>松开即可打开</strong>
            <span>支持 .md 和 .markdown，可一次拖入多个文件</span>
          </div>
        </div>
      )}
    </div>
  )
}
