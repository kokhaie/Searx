// server/utils/nsfwClassifier.ts
// ------------------------------------------
// NSFW text classifier using embeddings similarity
// Uses Xenova/all-MiniLM-L6-v2 via @xenova/transformers
// Runs server-side in Node.js (Nuxt server)
// ------------------------------------------

import { pipeline } from '@xenova/transformers'

// ============================================================
// CONFIG
// ============================================================
const MODEL_NAME = 'Xenova/all-MiniLM-L6-v2'

// Margin threshold: NSFW score must exceed safe score by this amount to block
// 0.00 = block whenever NSFW similarity >= safe similarity (catches stores/educational too)
export const NSFW_MARGIN_THRESHOLD = 0.00

// ============================================================
// UNSAFE vs SAFE LABELS
// Labels that capture commercial/revealing content (stores, galleries, etc.)
// ============================================================
const UNSAFE_LABELS = [
  'sexual or revealing adult content',
  'bikini store product catalog',
  'thong lingerie shop',
  'swimsuit models gallery',
  'revealing clothing photos',
  'adult content website',
] as const

const SAFE_LABELS = [
  'safe general content',
  'educational article',
  'news website',
  'technical documentation',
] as const

type UnsafeLabel = (typeof UNSAFE_LABELS)[number]
type SafeLabel = (typeof SAFE_LABELS)[number]

// ============================================================
// MODEL LOADING (cached in server memory)
// ============================================================
let extractor: ReturnType<typeof pipeline> | null = null
let extractorPromise: Promise<ReturnType<typeof pipeline>> | null = null

let unsafeEmbeddings: number[][] | null = null
let safeEmbeddings: number[][] | null = null

// URL cache: once a result URL is classified NSFW, block it instantly
// without re-running the model
const nsfwUrlCache = new Set<string>()

async function loadExtractor() {
  if (extractor) return extractor
  if (extractorPromise) return extractorPromise

  extractorPromise = (async () => {
    const started = Date.now()
    console.log('[NSFW] Loading embeddings model:', MODEL_NAME)
    const ext = await pipeline('feature-extraction', MODEL_NAME)
    const loadMs = Date.now() - started
    console.log(`[NSFW] Embeddings model loaded successfully in ${loadMs}ms`)
    return ext
  })()

  extractor = await extractorPromise
  return extractor
}

async function getLabelEmbeddings() {
  if (unsafeEmbeddings && safeEmbeddings) return { unsafeEmbeddings, safeEmbeddings }

  const ext = await loadExtractor()

  const [unsafeResult, safeResult] = await Promise.all([
    ext(UNSAFE_LABELS, { pooling: 'mean', normalize: true }),
    ext(SAFE_LABELS, { pooling: 'mean', normalize: true }),
  ])

  const toArray = (t: any) => (t.tolist ? t.tolist() : Array.from(t))

  unsafeEmbeddings = unsafeResult.map(toArray)
  safeEmbeddings = safeResult.map(toArray)

  return { unsafeEmbeddings, safeEmbeddings }
}

// ============================================================
// CLASSIFICATION RESULT
// ============================================================
export interface NsfwClassification {
  isLikelyNsfw: boolean
  confidence: number
  nsfwScore: number
  safeScore: number
  margin: number
  inferenceMs: number
  cached: boolean
  reason: string
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  normA = Math.sqrt(normA)
  normB = Math.sqrt(normB)
  if (normA === 0 || normB === 0) return 0
  return dot / (normA * normB)
}

/**
 * Classify a text string as NSFW or safe using embeddings similarity.
 * @param text Combined title + snippet text to analyze
 * @param url Optional URL for cache lookup/storage
 * @returns Classification result
 */
export async function classifyTextNsfw(text: string, url?: string): Promise<NsfwClassification> {
  // Check URL cache first — instant block for previously classified NSFW URLs
  if (url && nsfwUrlCache.has(url)) {
    return {
      isLikelyNsfw: true,
      confidence: 1,
      nsfwScore: 1,
      safeScore: 0,
      margin: 1,
      inferenceMs: 0,
      cached: true,
      reason: 'Cached NSFW URL',
    }
  }

  if (!text || !text.trim()) {
    return {
      isLikelyNsfw: false,
      confidence: 0,
      nsfwScore: 0,
      safeScore: 1,
      margin: -1,
      inferenceMs: 0,
      cached: false,
      reason: 'Empty text',
    }
  }

  const ext = await loadExtractor()
  const started = Date.now()
  const result = await ext([text], {
    pooling: 'mean',
    normalize: true,
  })
  const inferenceMs = Date.now() - started

  const toArray = (t: any) => (t.tolist ? t.tolist() : Array.from(t))
  const emb = toArray(result[0])

  const { unsafeEmbeddings, safeEmbeddings } = await getLabelEmbeddings()

  // Max similarity to any unsafe label
  let maxUnsafeScore = 0
  for (const unsafeEmb of unsafeEmbeddings) {
    const sim = cosineSimilarity(emb, unsafeEmb)
    if (sim > maxUnsafeScore) maxUnsafeScore = sim
  }

  // Max similarity to any safe label
  let maxSafeScore = 0
  for (const safeEmb of safeEmbeddings) {
    const sim = cosineSimilarity(emb, safeEmb)
    if (sim > maxSafeScore) maxSafeScore = sim
  }

  const margin = maxUnsafeScore - maxSafeScore
  const isLikelyNsfw = margin > NSFW_MARGIN_THRESHOLD

  // Cache NSFW URLs for instant blocking on repeat
  if (isLikelyNsfw && url) {
    nsfwUrlCache.add(url)
    console.log(`[NSFW] Cached URL as NSFW: ${url}`)
  }

  return {
    isLikelyNsfw,
    confidence: Math.abs(margin),
    nsfwScore: maxUnsafeScore,
    safeScore: maxSafeScore,
    margin,
    inferenceMs,
    cached: false,
    reason: isLikelyNsfw
      ? `NSFW margin ${margin.toFixed(3)} > threshold ${NSFW_MARGIN_THRESHOLD}`
      : `Safe margin ${(-margin).toFixed(3)}`,
  }
}

/**
 * Check if a search result likely contains NSFW/adult content.
 * @param result Search result with title, url and optionally snippet
 * @returns Classification result
 */
export async function classifyResultNsfw(result: {
  title: string
  url: string
  snippet?: string
}): Promise<NsfwClassification> {
  const combined = (result.title + ' ' + (result.snippet || '')).trim()
  return classifyTextNsfw(combined, result.url)
}

/**
 * Get the loaded extractor (for advanced use).
 */
export async function getExtractor() {
  return loadExtractor()
}

/**
 * Get the number of cached NSFW URLs (for debugging/monitoring).
 */
export function getCachedNsfwUrlCount(): number {
  return nsfwUrlCache.size
}
