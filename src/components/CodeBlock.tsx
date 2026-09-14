import { useEffect, useState, type HTMLAttributes, type ReactNode } from 'react'

type CodeBlockProps = HTMLAttributes<HTMLElement> & { children?: ReactNode; disableHighlight?: boolean }

export function CodeBlock({ className = '', children, disableHighlight = false, ...props }: CodeBlockProps) {
  const code = String(children ?? '').replace(/\n$/, '')
  const language = /language-([\w-]+)/.exec(className)?.[1]
  const [html, setHtml] = useState('')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!language || language === 'mermaid' || disableHighlight) {
      setHtml('')
      return
    }
    let active = true
    void import('../highlight').then(({ highlightCode }) => highlightCode(code, language))
      .then((result) => active && setHtml(result ?? ''))
      .catch(() => active && setHtml(''))
    return () => {
      active = false
    }
  }, [code, disableHighlight, language])

  if (!language) {
    return <code className="inline-code" {...props}>{children}</code>
  }

  async function copyCode() {
    await navigator.clipboard.writeText(code)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1200)
  }

  return (
    <div className="code-frame">
      <div className="code-toolbar">
        <span>{language}</span>
        <button type="button" onClick={() => void copyCode()}>{copied ? '已复制' : '复制'}</button>
      </div>
      {html ? (
        <div className="shiki-host" dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <pre><code className={className}>{code}</code></pre>
      )}
    </div>
  )
}
