import { defineEventHandler, getQuery } from 'h3'
import { normalizeSuggestions } from '../../shared/utils/search'
import { fetchSearxSearch, fetchSearxSuggestions } from '../utils/searx'
import { initBlocklists } from '../utils/contentGuard'

interface CacheEntry {
  at: number
  suggestions: string[]
}

const CACHE_TTL = 60_000
const CACHE_LIMIT = 250
const cache = new Map<string, CacheEntry>()

function pruneCache() {
  const now = Date.now()
  for (const [key, entry] of cache) {
    if (now - entry.at > CACHE_TTL) cache.delete(key)
  }
  // Hard-cap after TTL pruning as a last resort
  if (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value
    if (oldest) cache.delete(oldest)
  }
}

export default defineEventHandler(async (event) => {
  const params = getQuery(event)
  const query = String(params.q ?? '').trim().slice(0, 120)
  const { searxUrl } = useRuntimeConfig(event)
  const clientIp =
    getRequestIP(event, { xForwardedFor: true }) || getRequestIP(event) || undefined

  if (query.length < 2) {
    return { suggestions: [] }
  }

  const key = query.toLowerCase()
  const cached = cache.get(key)

  if (cached && Date.now() - cached.at < CACHE_TTL) {
    return { suggestions: cached.suggestions }
  }

  // --- Social media guard: populate blocklist cache ---
  await initBlocklists()

  let suggestions: string[] = []

  try {
    suggestions = await fetchSearxSuggestions(query, searxUrl, clientIp)
  } catch {
    // Some instances do not expose /autocompleter. Fall back to search suggestions.
    try {
      const payload = await fetchSearxSearch({ query, timeoutMs: 3000, baseUrl: searxUrl, clientIp })
      const record = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>
      suggestions = normalizeSuggestions(record.suggestions)
    } catch {
      suggestions = []
    }
  }

  cache.set(key, { at: Date.now(), suggestions })
  pruneCache()

  return { suggestions }
})
