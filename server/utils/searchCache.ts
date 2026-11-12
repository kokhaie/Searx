// server/utils/searchCache.ts
// ------------------------------------------------------------------
// Valkey-backed cache for full search responses.
// Valkey is a separate in-memory store (like Redis), reached over the
// internal network. It is NOT in the same memory as this Node process,
// but reads are sub-millisecond locally — far faster than re-fetching
// SearXNG (~1-4s) and re-running the AI filters.
// ------------------------------------------------------------------

import Redis from 'ioredis'

let client: Redis | null = null
let connectPromise: Promise<void> | null = null

function getClient(): Redis | null {
  if (client) return client
  if (connectPromise) return null // still connecting, skip for now

  const url = process.env.VALKEY_URL || 'valkey://valkey:6379'
  client = new Redis(url, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    connectTimeout: 1000,
    commandTimeout: 1500,
    retryStrategy: () => null, // don't retry; cache failures are non-fatal
  })

  connectPromise = client.connect().catch(() => {})
  connectPromise.finally(() => {
    connectPromise = null
  })

  return client
}

const CACHE_TTL_SECONDS = 5 * 60 // 5 minutes

export function searchCacheKey(query: string, timeRange: string): string {
  return `search:${Buffer.from(`${query.toLowerCase()}|${timeRange}`).toString('base64url')}`
}

export async function getCachedSearch(query: string, timeRange: string) {
  const redis = getClient()
  if (!redis) return null
  try {
    const raw = await redis.get(searchCacheKey(query, timeRange))
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export async function setCachedSearch(query: string, timeRange: string, value: unknown) {
  const redis = getClient()
  if (!redis) return
  try {
    await redis.setex(searchCacheKey(query, timeRange), CACHE_TTL_SECONDS, JSON.stringify(value))
  } catch {
    // cache write failures are non-fatal
  }
}
