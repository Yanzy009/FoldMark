import DOMPurify from 'dompurify'

const blockedElements = new Set(['script', 'iframe', 'object', 'embed', 'image', 'use', 'audio', 'video'])
const dangerousCss = /@import|expression\s*\(|javascript:|data:|https?:|file:|-moz-binding|behavior\s*:/i

function sanitizeStyle(value: string): string {
  return value
    .split(';')
    .filter((declaration) => declaration.trim() && !dangerousCss.test(declaration) && !/url\s*\((?!\s*['"]?#)/i.test(declaration))
    .join(';')
}

export function sanitizeMermaidSvg(svg: string): string {
  const documentNode = new DOMParser().parseFromString(svg, 'text/html')
  const svgRoot = documentNode.querySelector('svg')
  if (!svgRoot) {
    throw new Error('Mermaid 返回了无效的 SVG')
  }

  for (const foreignObject of documentNode.querySelectorAll('foreignObject')) {
    foreignObject.innerHTML = DOMPurify.sanitize(foreignObject.innerHTML, {
      ALLOWED_TAGS: ['div', 'span', 'p', 'br'],
      ALLOWED_ATTR: ['class', 'style', 'xmlns'],
    })
  }

  for (const element of Array.from(documentNode.querySelectorAll('*'))) {
    const tag = element.localName.toLocaleLowerCase()
    if (tag === 'a') {
      element.replaceWith(...Array.from(element.childNodes))
      continue
    }
    if (blockedElements.has(tag)) {
      element.remove()
      continue
    }
    if (tag === 'style' && dangerousCss.test(element.textContent ?? '')) {
      element.remove()
      continue
    }

    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLocaleLowerCase()
      const value = attribute.value.trim()
      if (name.startsWith('on') || name === 'href' || name === 'xlink:href' || name === 'src') {
        element.removeAttribute(attribute.name)
      } else if (name === 'style') {
        const cleanStyle = sanitizeStyle(value)
        if (cleanStyle) element.setAttribute('style', cleanStyle)
        else element.removeAttribute('style')
      } else if (/^(?:javascript|data:text\/html|https?|file):/i.test(value)) {
        element.removeAttribute(attribute.name)
      }
    }
  }

  return new XMLSerializer().serializeToString(svgRoot)
}
