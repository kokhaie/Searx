import type { TextSegment } from '#shared/types/search'

const STOP_WORDS = new Set(['and', 'or', 'not', 'the', 'a', 'an', 'of', 'to', 'in', 'on', 'for'])

/** Strip search operators and punctuation, returning clean, unique query terms. */
export function extractTerms(query: string, limit = 16): string[] {
  const terms = query
    .toLowerCase()
    .replace(/["'“”‘’]/g, ' ')
    .replace(/\b(?:site|inurl|intitle|filetype|lang|before|after):\S+/gi, ' ')
    .split(/\s+/)
    .map(term => term.replace(/^[-+]+|[-+]+$/g, '').replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}+#]+$/gu, ''))
    .filter(term => term.length >= 2 && !STOP_WORDS.has(term))

  return Array.from(new Set(terms)).slice(0, limit)
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Split a snippet into plain and matched segments for bold rendering. */
export function highlightSegments(text: string, terms: string[]): TextSegment[] {
  if (!text) return []
  if (!terms.length) return [{ text, match: false }]

  const pattern = terms
    .filter(Boolean)
    .map(escapeRegExp)
    .sort((a, b) => b.length - a.length)
    .join('|')

  if (!pattern) return [{ text, match: false }]

  const termSet = new Set(terms.map(term => term.toLowerCase()))
  const matcher = new RegExp(`((?<![\\p{L}\\p{N}_])(?:${pattern})(?![\\p{L}\\p{N}_]))`, 'giu')

  return text
    .split(matcher)
    .filter(Boolean)
    .map(part => ({ text: part, match: termSet.has(part.toLowerCase()) }))
}

export function padIndex(index: number): string {
  return String(index).padStart(2, '0')
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

/** `https://www.example.com/blog/post?x=1` -> `example.com › blog › post` */
export function formatBreadcrumb(rawUrl: string): string {
  try {
    const url = new URL(rawUrl)
    const host = url.hostname.replace(/^www\./, '')

    const path = url.pathname
      .split('/')
      .filter(Boolean)
      .map(segment => safeDecode(segment))
      .filter(segment => !/^index\.(?:html?|php|aspx?)$/i.test(segment))
      .map(segment => segment.replace(/\.(?:html?|php|aspx?)$/i, ''))
      .filter(Boolean)
      .slice(0, 3)

    return [host, ...path].join(' › ')
  } catch {
    return rawUrl.replace(/^https?:\/\//, '').replace(/^www\./, '')
  }
}

/** Compact relative date: now, 24m ago, 6h ago, 2d ago, 3mo ago, 1y ago. */
export function relativeAge(input?: string): string {
  if (!input) return ''

  const timestamp = Date.parse(input)
  if (Number.isNaN(timestamp)) return ''

  const seconds = Math.round((Date.now() - timestamp) / 1000)
  const future = seconds < 0
  const value = Math.abs(seconds)

  let label: string
  if (value < 60) label = 'now'
  else if (value < 3600) label = `${Math.floor(value / 60)}m ago`
  else if (value < 86400) label = `${Math.floor(value / 3600)}h ago`
  else if (value < 604800) label = `${Math.floor(value / 86400)}d ago`
  else if (value < 2592000) label = `${Math.floor(value / 604800)}w ago`
  else if (value < 31536000) label = `${Math.floor(value / 2592000)}mo ago`
  else label = `${Math.floor(value / 31536000)}y ago`

  return future ? label.replace(' ago', ' from now') : label
}
