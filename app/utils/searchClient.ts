import type { SearchApiResponse, SuggestApiResponse, TimeRange } from '#shared/types/search'

export interface SearchSignalOptions {
  signal?: AbortSignal
}

/**
 * Fetch results through the Nuxt server proxy (/api/search).
 *
 * SearXNG is never contacted by the browser: the server is the only client,
 * so no CORS configuration is needed on the SearXNG instance.
 */
export async function search(
  query: string,
  timeRange: TimeRange | undefined,
  maxResults?: number,
  options?: SearchSignalOptions,
): Promise<SearchApiResponse> {
  return await $fetch<SearchApiResponse>('/api/search', {
    query: {
      q: query,
      ...(timeRange ? { time_range: timeRange } : {}),
      ...(maxResults ? { max_results: maxResults } : {}),
    },
    signal: options?.signal,
  })
}

/** Fetch autocomplete suggestions through the server proxy (/api/suggest). */
export async function suggest(
  query: string,
  options?: SearchSignalOptions,
): Promise<string[]> {
  const response = await $fetch<SuggestApiResponse>('/api/suggest', {
    query: { q: query },
    signal: options?.signal,
  })

  return response.suggestions
}
