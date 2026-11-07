import { createError, defineEventHandler, getQuery } from 'h3'
import type { TimeRange } from '../../shared/types/search'
import { buildSearchResponse } from '../../shared/utils/search'
import { fetchSearxSearch } from '../utils/searx'
import {
  initBlocklists,
  filterResults,
} from '../utils/contentGuard'
import { classifyResultNsfw } from '../utils/nsfwClassifier'
const TIME_RANGES = new Set<TimeRange>(['', 'day', 'week', 'month', 'year'])
const MAX_RESULTS = 5

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

    // Step 1: Block social media domains
    const cleanResults = filterResults(response.results)

    // Step 2: Block NSFW/adult content via AI embeddings classifier
    // Runs BEFORE result limit slicing so NSFW results never reach the browser
    const aiStarted = Date.now()
    const nsfwFiltered = await filterNsfwResults(cleanResults)
    const aiMs = Date.now() - aiStarted

    response.filteredCount += countBeforeGuard - nsfwFiltered.length
    response.results = nsfwFiltered.slice(0, MAX_RESULTS)
    response.timings.ai = aiMs

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

/**
 * Filter search results using the NSFW zero-shot AI classifier.
 * Classifies each result's title + snippet and removes those classified as
 * "sexual or revealing adult content" above the threshold.
 * Fails open (returns original results) if the classifier fails to load.
 */
async function filterNsfwResults(results: Array<{ title: string; url: string; snippet?: string }>) {
  if (results.length === 0) return results

  try {
    // Classify all results in parallel
    const classifications = await Promise.all(
      results.map((r) => classifyResultNsfw(r)),
    )

    const filtered = results.filter((_, i) => !classifications[i]?.isLikelyNsfw)

    console.log(
      `[NSFW] Filtered ${results.length - filtered.length} of ${results.length} results as NSFW`,
    )
    return filtered
  } catch (err) {
    // Classifier failed (model download, network, etc.) — fail open
    console.warn('[NSFW] Classifier failed, returning unfiltered results:', err)
    return results
  }
}
