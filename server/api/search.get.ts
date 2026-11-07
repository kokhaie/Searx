import { createError, defineEventHandler, getQuery } from 'h3'
import type { TimeRange } from '../../shared/types/search'
import { buildSearchResponse } from '../../shared/utils/search'
import { fetchSearxSearch } from '../utils/searx'
import { initBlocklists, filterResults } from '../utils/contentGuard'

const TIME_RANGES = new Set<TimeRange>(['', 'day', 'week', 'month', 'year'])

function parseTimeRange(value: unknown): TimeRange {
  const range = String(value ?? '').toLowerCase() as TimeRange
  return TIME_RANGES.has(range) ? range : ''
}

export default defineEventHandler(async (event) => {
  const params = getQuery(event)
  const query = String(params.q ?? '').trim().slice(0, 256)
  const { searxUrl } = useRuntimeConfig(event)
  // SearXNG records which client asked (X-Forwarded-For); behind a reverse
  // proxy this resolves through its chain.
  const clientIp =
    getRequestIP(event, { xForwardedFor: true }) || getRequestIP(event) || undefined

  if (!query) {
    throw createError({
      statusCode: 400,
      statusMessage: 'A search query is required.',
      data: { code: 'MISSING_QUERY', message: 'A search query is required.' },
    })
  }

  const started = Date.now()

  try {
    const payload = await fetchSearxSearch({
      query,
      timeRange: parseTimeRange(params.time_range),
      baseUrl: searxUrl,
      clientIp,
    })

    // --- Social media guard: ensure blocklist is loaded ---
    await initBlocklists()

    const response = buildSearchResponse(payload, query, Math.max(1, Date.now() - started))
    const countBeforeGuard = response.results.length
    response.results = filterResults(response.results)
    response.filteredCount += countBeforeGuard - response.results.length

    return response
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'The search backend is unavailable.'

    throw createError({
      statusCode: 502,
      statusMessage: 'Search backend unavailable',
      data: {
        code: 'UPSTREAM_ERROR',
        message,
      },
    })
  }
})
