import type { TimeRange } from '../../shared/types/search'
import { extractSuggestions } from '../../shared/utils/search'

type RawRecord = Record<string, unknown>

const DEFAULT_SEARX_BASE = 'http://127.0.0.1:8080'

// Safe search level sent with every /search request (0=off 1=moderate 2=strict)
const SAFE_SEARCH = '2'

function resolveBase(baseUrl?: string): string {
  return String(baseUrl || DEFAULT_SEARX_BASE).replace(/\/+$/, '')
}

const UPSTREAM_HEADERS: Record<string, string> = {
  accept: 'application/json',
  'accept-language': 'en-US,en;q=0.9',
  'user-agent': 'search-ui/1.0 (SearXNG front end)',
}

/**
 * SearXNG's botdetection wants X-Forwarded-For / X-Real-IP so it knows which
 * client made the request (otherwise it logs "X-Forwarded-For nor X-Real-IP
 * header is set" for every search). This is internal only — upstream engines
 * never see these headers; SearXNG connects to them with its own IP.
 */
function upstreamHeaders(clientIp?: string): Record<string, string> {
  if (!clientIp) return { ...UPSTREAM_HEADERS }

  return {
    ...UPSTREAM_HEADERS,
    'x-forwarded-for': clientIp,
    'x-real-ip': clientIp,
  }
}

async function requestJson(
  url: string,
  timeoutMs: number,
  headers: Record<string, string> = UPSTREAM_HEADERS,
): Promise<unknown> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(url, {
      headers: UPSTREAM_HEADERS,
      signal: controller.signal,
      redirect: 'follow',
      cache: 'no-store',
    })

    if (!response.ok) {
      throw new Error(`Search backend returned HTTP ${response.status}`)
    }

    const body = await response.text()

    try {
      return JSON.parse(body)
    } catch {
      throw new Error('Search backend did not return JSON. Is the JSON format enabled?')
    }
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`Search backend timed out after ${timeoutMs}ms`)
    }
    throw error
  } finally {
    clearTimeout(timer)
  }
}

export interface FetchSearchOptions {
  query: string
  timeRange?: TimeRange
  timeoutMs?: number
  /** Resolved SearXNG base URL — pass from the event handler via useRuntimeConfig(event). */
  baseUrl?: string
  /** Real client IP, forwarded internally as X-Forwarded-For. */
  clientIp?: string
}

export async function fetchSearxSearch(options: FetchSearchOptions): Promise<unknown> {
  const base = resolveBase(options.baseUrl)
  const params = new URLSearchParams({
    q: options.query,
    format: 'json',
    safesearch: SAFE_SEARCH,
  })

  if (options.timeRange) params.set('time_range', options.timeRange)

  return requestJson(
    `${base}/search?${params.toString()}`,
    options.timeoutMs ?? 9000,
    upstreamHeaders(options.clientIp),
  )
}

export async function fetchSearxSuggestions(
  query: string,
  baseUrl?: string,
  clientIp?: string,
): Promise<string[]> {
  const base = resolveBase(baseUrl)
  const params = new URLSearchParams({ q: query })
  const payload = await requestJson(
    `${base}/autocompleter?${params.toString()}`,
    2500,
    upstreamHeaders(clientIp),
  )

  return extractSuggestions(payload)
}
