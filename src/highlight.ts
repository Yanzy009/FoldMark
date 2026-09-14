import { createHighlighterCore } from '@shikijs/core'
import { createJavaScriptRegexEngine } from '@shikijs/engine-javascript'
import githubDark from '@shikijs/themes/github-dark'
import githubLight from '@shikijs/themes/github-light'
import css from '@shikijs/langs/css'
import html from '@shikijs/langs/html'
import javascript from '@shikijs/langs/javascript'
import json from '@shikijs/langs/json'
import markdown from '@shikijs/langs/markdown'
import python from '@shikijs/langs/python'
import rust from '@shikijs/langs/rust'
import shellscript from '@shikijs/langs/shellscript'
import sql from '@shikijs/langs/sql'
import tsx from '@shikijs/langs/tsx'
import typescript from '@shikijs/langs/typescript'
import yaml from '@shikijs/langs/yaml'

const supported = new Set([
  'css', 'html', 'javascript', 'json', 'markdown', 'python',
  'rust', 'shellscript', 'sql', 'tsx', 'typescript', 'yaml',
])

const aliases: Record<string, string> = {
  bash: 'shellscript',
  html5: 'html',
  js: 'javascript',
  md: 'markdown',
  py: 'python',
  rs: 'rust',
  shell: 'shellscript',
  sh: 'shellscript',
  ts: 'typescript',
  yml: 'yaml',
}

const highlighter = createHighlighterCore({
  themes: [githubLight, githubDark],
  langs: [css, html, javascript, json, markdown, python, rust, shellscript, sql, tsx, typescript, yaml],
  engine: createJavaScriptRegexEngine(),
})

export async function highlightCode(code: string, requestedLanguage: string): Promise<string | null> {
  const language = aliases[requestedLanguage] ?? requestedLanguage
  if (!supported.has(language)) return null
  const instance = await highlighter
  return instance.codeToHtml(code, {
    lang: language,
    themes: { light: 'github-light', dark: 'github-dark' },
  })
}
