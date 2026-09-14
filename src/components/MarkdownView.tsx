import {
  Children,
  isValidElement,
  type AnchorHTMLAttributes,
  type HTMLAttributes,
  type ImgHTMLAttributes,
  type ReactNode,
} from 'react'
import { memo, useEffect, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { CodeBlock } from './CodeBlock'
import { MermaidBlock } from './MermaidBlock'
import { TableBlock } from './TableBlock'
import { classifyLink, createUniqueSlugger, safeHref } from '../security'
import { createSearchHighlightPlugin } from '../search'

function nodeText(node: ReactNode): string {
  return Children.toArray(node).map((child) => {
    if (typeof child === 'string' || typeof child === 'number') return String(child)
    return isValidElement<{ children?: ReactNode }>(child) ? nodeText(child.props.children) : ''
  }).join('')
}

function createHeading(level: 1 | 2 | 3 | 4 | 5 | 6, uniqueSlug: (text: string) => string) {
  return function Heading({ children, ...props }: HTMLAttributes<HTMLHeadingElement>) {
    const Tag = `h${level}` as const
    const id = uniqueSlug(nodeText(children))
    return <Tag id={id} {...props}>{children}</Tag>
  }
}

function SafeLink({ href, children, onOpenLocalDocument, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & {
  onOpenLocalDocument?: (path: string) => void
}) {
  const kind = href ? classifyLink(href) : 'blocked'
  const safe = safeHref(href)

  function handleClick(event: React.MouseEvent<HTMLAnchorElement>) {
    if (kind === 'blocked') event.preventDefault()
    if (kind === 'anchor' && safe) {
      event.preventDefault()
      let id = safe.slice(1)
      try { id = decodeURIComponent(id) } catch { /* Keep the literal fragment. */ }
      document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
    if (kind === 'local' && safe) {
      event.preventDefault()
      onOpenLocalDocument?.(safe)
    }
    if (kind === 'external' && safe) {
      event.preventDefault()
      void import('@tauri-apps/plugin-opener').then(({ openUrl }) => openUrl(safe))
    }
  }

  return (
    <a
      {...props}
      href={safe}
      onClick={handleClick}
      aria-disabled={kind === 'blocked'}
      title={kind === 'local' ? '在 FoldMark 中打开本地 Markdown 文档' : props.title}
    >
      {children}
    </a>
  )
}

type AssetPayload = { mimeType: string; base64: string }

function SafeImage({ assetToken, src, alt, ...props }: ImgHTMLAttributes<HTMLImageElement> & { assetToken?: string | null }) {
  const directSource = !!src && (src.startsWith('data:image/') || src.startsWith('blob:')) ? src : ''
  const [resolvedSource, setResolvedSource] = useState(directSource)
  const [error, setError] = useState('')

  useEffect(() => {
    setResolvedSource(directSource)
    setError('')
    if (directSource || !src || !assetToken) return
    let active = true
    void import('@tauri-apps/api/core')
      .then(({ invoke }) => invoke<AssetPayload>('read_document_asset', {
        token: assetToken,
        relativePath: src,
      }))
      .then((asset) => {
        if (active) setResolvedSource(`data:${asset.mimeType};base64,${asset.base64}`)
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : String(reason))
      })
    return () => {
      active = false
    }
  }, [assetToken, directSource, src])

  if (!resolvedSource) {
    return <span className="image-placeholder" title={error}>图片已阻止或不可用：{alt || src || '无描述'}</span>
  }
  return <img {...props} src={resolvedSource} alt={alt ?? ''} loading="lazy" />
}

export const MarkdownView = memo(function MarkdownView({
  markdown,
  assetToken,
  searchQuery = '',
  performanceMode = false,
  onOpenLocalDocument,
}: {
  markdown: string
  assetToken?: string | null
  searchQuery?: string
  performanceMode?: boolean
  onOpenLocalDocument?: (path: string) => void
}) {
  const uniqueSlug = createUniqueSlugger()
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={searchQuery.trim() ? [createSearchHighlightPlugin(searchQuery)] : []}
      urlTransform={(url) => safeHref(url) ?? ''}
      components={{
        h1: createHeading(1, uniqueSlug),
        h2: createHeading(2, uniqueSlug),
        h3: createHeading(3, uniqueSlug),
        h4: createHeading(4, uniqueSlug),
        h5: createHeading(5, uniqueSlug),
        h6: createHeading(6, uniqueSlug),
        a: (props) => <SafeLink {...props} onOpenLocalDocument={onOpenLocalDocument} />,
        img: (props) => <SafeImage {...props} assetToken={assetToken} />,
        table: ({ children, ...props }) => <TableBlock {...props}>{children}</TableBlock>,
        code: ({ className, children, ...props }) => {
          const language = /language-([\w-]+)/.exec(className ?? '')?.[1]
          if (language === 'mermaid') {
            return <MermaidBlock source={String(children ?? '').replace(/\n$/, '')} defer={performanceMode} />
          }
          return <CodeBlock className={className} disableHighlight={performanceMode} {...props}>{children}</CodeBlock>
        },
      }}
    >
      {markdown}
    </ReactMarkdown>
  )
})
