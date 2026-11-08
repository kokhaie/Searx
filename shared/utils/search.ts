import type { SearchApiResponse, SearchResultItem } from '../types/search'

type RawRecord = Record<string, unknown>

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  hellip: '…',
  mdash: '—',
  ndash: '–',
  rsquo: '’',
  lsquo: '‘',
  ldquo: '“',
  rdquo: '”',
  middot: '·',
}

function decodeEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, code: string) => {
    if (code.startsWith('#')) {
      const base = code[1]?.toLowerCase() === 'x' ? 16 : 10
      const digits = base === 16 ? code.slice(2) : code.slice(1)
      const point = Number.parseInt(digits, base)
      return Number.isFinite(point) && point > 0 && point <= 0x10ffff
        ? String.fromCodePoint(point)
        : match
    }

    return ENTITIES[code.toLowerCase()] ?? match
  })
}

/** Decode entities, remove markup, and collapse whitespace. */
export function cleanText(value: unknown): string {
  if (typeof value !== 'string') return ''

  return decodeEntities(value)
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function cleanUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null

  const candidate = decodeEntities(value).trim()
  const absolute = candidate.startsWith('//') ? `https:${candidate}` : candidate

  try {
    const url = new URL(absolute)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return url.toString()
  } catch {
    return null
  }
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function normalizeResult(value: unknown): SearchResultItem | null {
  if (!value || typeof value !== 'object') return null

  const raw = value as RawRecord
  const url = cleanUrl(raw.url)
  const title = cleanText(raw.title)

  if (!url || !title) return null

  const publishedDate = asString(raw.publishedDate) || asString(raw.pubdate) || undefined

  return {
    title,
    url,
    snippet: cleanText(raw.content) || cleanText(raw.snippet),
    ...(publishedDate ? { publishedDate } : {}),
    ...(asString(raw.engine) ? { engine: cleanText(raw.engine) } : {}),
  }
}

function urlKey(url: string): string {
  try {
    const parsed = new URL(url)
    parsed.hash = ''
    return parsed.toString().replace(/\/$/, '')
  } catch {
    return url
  }
}

function extractSuggestionText(item: unknown): string {
  if (typeof item === 'string') return cleanText(item)
  if (item && typeof item === 'object') {
    const rec = item as Record<string, unknown>
    const candidate = rec.phrase ?? rec.text ?? rec.word ?? rec.title ?? rec.name
    if (typeof candidate === 'string') return cleanText(candidate)
  }
  return ''
}

export function normalizeSuggestions(value: unknown, limit = 8): string[] {
  const output: string[] = []
  const seen = new Set<string>()

  for (const item of asArray(value)) {
    const text = extractSuggestionText(item)
    if (!text || text.length > 120) continue

    const key = text.toLowerCase()
    if (seen.has(key)) continue

    seen.add(key)
    output.push(text)

    if (output.length >= limit) break
  }

  return output
}

/**
 * Read suggestions from:
 *  - OpenSearch format: ["query", ["sug1", "sug2", ...], ...]  ← /autocompleter
 *  - Flat array:        ["sug1", "sug2", ...]
 *  - Object:            { suggestions: [...] }
 */
export function extractSuggestions(payload: unknown): string[] {
  // OpenSearch Suggestion Extension: index 0 = query, index 1 = suggestions array
  if (Array.isArray(payload) && Array.isArray(payload[1])) {
    return normalizeSuggestions(payload[1])
  }
  if (Array.isArray(payload)) return normalizeSuggestions(payload)
  if (payload && typeof payload === 'object') {
    return normalizeSuggestions((payload as RawRecord).suggestions)
  }
  return []
}

/** Sanitise, filter, and deduplicate a raw SearXNG JSON response. */
export function buildSearchResponse(
  payload: unknown,
  query: string,
  searxMs: number,
  aiMs: number = 0,
): SearchApiResponse {
  const raw = (payload && typeof payload === 'object' ? payload : {}) as RawRecord
  const rawResults = asArray(raw.results)
  const seen = new Set<string>()
  const results: SearchResultItem[] = []

  for (const item of rawResults) {
    const result = normalizeResult(item)
    if (!result) continue

    const key = urlKey(result.url)
    if (seen.has(key)) continue

    seen.add(key)
    results.push(result)
  }

  return {
    query,
    results,
    suggestions: normalizeSuggestions(raw.suggestions),
    rawCount: rawResults.length,
    filteredCount: rawResults.length - results.length,
    timings: { searx: searxMs, ai: aiMs, semantic: 0 },
  }
}
