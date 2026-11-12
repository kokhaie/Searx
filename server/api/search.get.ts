import { createError, defineEventHandler, getQuery } from 'h3'
import type { SearchResultItem, TimeRange } from '../../shared/types/search'
import { buildSearchResponse } from '../../shared/utils/search'
import { fetchSearxSearch } from '../utils/searx'
import { filterResults } from '../utils/contentGuard'
import { classifyResultNsfw } from '../utils/nsfwClassifier'
import { filterSearchResults } from '../utils/semanticFilter'
import { getCachedSearch, setCachedSearch } from '../utils/searchCache'
const TIME_RANGES = new Set<TimeRange>(['', 'day', 'week', 'month', 'year'])
const MAX_RESULTS = 5
// Only run the expensive AI safety filters on the top N results after
// blocklist filtering. Results beyond this are still deduped/cleaned but
// never reach the NSFW or semantic classifiers, saving latency on queries
// that return many raw results.
const AI_FILTER_TOP_N = 10

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

  const timeRange = parseTimeRange(params.time_range)

  // --- Valkey cache: return instantly on a repeat search (~1ms vs 1-4s) ---
  const cached = await getCachedSearch(query, timeRange)
  if (cached) {
    return { ...cached, fromCache: true }
  }

  const started = Date.now()

  try {
    const payload = await fetchSearxSearch({
      query,
      timeRange,
      baseUrl: searxUrl,
      clientIp,
    })

    const response = buildSearchResponse(payload, query, Math.max(1, Date.now() - started))
    const countBeforeGuard = response.results.length

    // Step 1: Block all blocked domains (social, lingerie, dating, etc. from blocked-domains.txt)
    // Subdomains are blocked automatically (e.g. m.facebook.com blocked by facebook.com).
    const cleanResults = filterResults(response.results)
    response.filteredCount += response.results.length - cleanResults.length

    // Only run the expensive AI classifiers on the top N blocklist-clean results.
    const aiCandidates = cleanResults.slice(0, AI_FILTER_TOP_N)

    // Step 2: Block NSFW/adult content via AI embeddings classifier
    // Runs BEFORE result limit slicing so NSFW results never reach the browser
    const aiStarted = Date.now()
    const nsfwFiltered = await filterNsfwResults(aiCandidates)
    const aiMs = Date.now() - aiStarted

    response.filteredCount += aiCandidates.length - nsfwFiltered.length

    // Step 3: Semantic safety filter via Python microservice (thongs, bikinis, lingerie, etc.)
    const semanticStarted = Date.now()
    const { allowed, blocked } = await filterSearchResults(nsfwFiltered, 0.50)
    response.results = allowed.slice(0, MAX_RESULTS)
    response.filteredCount += nsfwFiltered.length - allowed.length
    response.timings.ai = aiMs
    response.timings.semantic = Date.now() - semanticStarted

    if (blocked.length > 0) {
      console.log(`[SemanticFilter] Blocked ${blocked.length} results as distracting/adult`)
    }

    // Populate Valkey cache so the next identical query is instant
    await setCachedSearch(query, timeRange, response)

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
async function filterNsfwResults(results: SearchResultItem[]): Promise<SearchResultItem[]> {
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
