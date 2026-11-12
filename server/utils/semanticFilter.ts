// server/utils/semanticFilter.ts
// Calls the separate Python FastAPI microservice for semantic safety filtering.
// Fail-open: if the AI service is down, we allow everything and log the error.

import type { SearchResultItem } from '../../shared/types/search'

const AI_FILTER_URL = process.env.AI_FILTER_URL || "http://localhost:8000"

export interface BlockedItem {
  id: string
  risk_pct: number // percentage 0-100
  text: string
}

export interface FilterResponse {
  allowed_ids: string[]
  blocked: BlockedItem[]
  processing_time_ms: number
  model: string
  threshold: number
}

async function callFilterService(
  items: Array<{ id: string; title: string; snippet: string }>,
  threshold: number
): Promise<FilterResponse> {
  const res = await fetch(`${AI_FILTER_URL}/filter`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items, threshold }),
  })

  if (!res.ok) {
    // Read the body so FastAPI's 422 validation detail is visible in logs
    let detail = ""
    try {
      const body = await res.json()
      detail = JSON.stringify(body)
    } catch {
      detail = await res.text().catch(() => "")
    }
    throw new Error(`AI filter service returned ${res.status}: ${detail}`)
  }

  return (await res.json()) as FilterResponse
}

/**
 * Filter search results via the Python microservice.
 * URL is used as the item id (results are deduplicated by URL already).
 * Returns { allowed, blocked } so you can render/log separately.
 * On service failure, fails open (allows all).
 */
export async function filterSearchResults(
  results: SearchResultItem[],
  threshold: number = 0.50
): Promise<{ allowed: SearchResultItem[]; blocked: SearchResultItem[] }> {
  if (!results.length) {
    return { allowed: [], blocked: [] }
  }

  const items = results.map((r) => ({
    id: r.url,
    title: r.title || "",
    snippet: r.snippet || "",
  }))

  try {
    const { allowed_ids, blocked } = await callFilterService(items, threshold)

    const allowedSet = new Set(allowed_ids)
    const blockedSet = new Set(blocked.map((b) => b.id))

    const allowed = results.filter((r) => allowedSet.has(r.url))
    const blockedResults = results.filter((r) => blockedSet.has(r.url))

    return { allowed, blocked: blockedResults }
  } catch (err) {
    console.error("[SemanticFilter] AI service unavailable, failing open:", err)
    return { allowed: results, blocked: [] }
  }
}
