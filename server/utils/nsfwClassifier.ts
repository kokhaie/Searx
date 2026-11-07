// server/utils/nsfwClassifier.ts
// ------------------------------------------
// Zero-shot text classifier for NSFW/adult content
// Uses facebook/bart-large-mnli via @xenova/transformers
// Runs server-side in Node.js (Nuxt server)
// ------------------------------------------

import { pipeline } from '@xenova/transformers'

// ============================================================
// CONFIG
// ============================================================
const MODEL_NAME = 'facebook/bart-large-mnli'

// Confidence threshold: if "sexual/revealing" score >= this, filter the result
// Lower = more aggressive filtering, Higher = more permissive
export const NSFW_THRESHOLD = 0.6

// Zero-shot candidate labels
const CANDIDATE_LABELS = [
  'sexual or revealing adult content',
  'safe general content',
] as const

type NsfwLabel = (typeof CANDIDATE_LABELS)[number]

// ============================================================
// MODEL LOADING (cached in server memory)
// ============================================================
let classifier: ReturnType<typeof pipeline> | null = null
let classifierPromise: Promise<ReturnType<typeof pipeline>> | null = null

async function loadClassifier() {
  if (classifier) return classifier
  if (classifierPromise) return classifierPromise

  classifierPromise = (async () => {
    console.log('[NSFW] Loading zero-shot classifier:', MODEL_NAME)
    const clf = await pipeline('zero-shot-classification', MODEL_NAME)
    console.log('[NSFW] Classifier loaded successfully')
    return clf
  })()

  classifier = await classifierPromise
  return classifier
}

// ============================================================
// CLASSIFICATION RESULT
// ============================================================
export interface NsfwClassification {
  isLikelyNsfw: boolean
  confidence: number
  nsfwScore: number
  safeScore: number
  reason: string
}

/**
 * Classify a text string as NSFW or safe using zero-shot classification.
 * @param text Combined title + snippet text to analyze
 * @returns Classification result
 */
export async function classifyTextNsfw(text: string): Promise<NsfwClassification> {
  if (!text || !text.trim()) {
    return {
      isLikelyNsfw: false,
      confidence: 0,
      nsfwScore: 0,
      safeScore: 1,
      reason: 'Empty text',
    }
  }

  const clf = await loadClassifier()

  const result = await clf(text, {
    candidate_labels: CANDIDATE_LABELS,
  })

  // result.labels is ordered by score descending
  const nsfwIdx = result.labels.indexOf('sexual or revealing adult content')
  const safeIdx = result.labels.indexOf('safe general content')

  const nsfwScore = nsfwIdx >= 0 ? result.scores[nsfwIdx] : 0
  const safeScore = safeIdx >= 0 ? result.scores[safeIdx] : 0

  const isLikelyNsfw = nsfwScore >= NSFW_THRESHOLD
  const confidence = Math.max(nsfwScore, safeScore)

  return {
    isLikelyNsfw,
    confidence,
    nsfwScore,
    safeScore,
    reason: isLikelyNsfw
      ? `NSFW score ${nsfwScore.toFixed(2)} >= threshold ${NSFW_THRESHOLD}`
      : `Safe score ${safeScore.toFixed(2)}`,
  }
}

/**
 * Check if a search result likely contains NSFW/adult content.
 * @param result Search result with title and optionally snippet
 * @returns Classification result
 */
export async function classifyResultNsfw(result: {
  title: string
  snippet?: string
}): Promise<NsfwClassification> {
  const combined = (result.title + ' ' + (result.snippet || '')).trim()
  return classifyTextNsfw(combined)
}

/**
 * Get the loaded classifier (for advanced use).
 */
export async function getClassifier() {
  return loadClassifier()
}
