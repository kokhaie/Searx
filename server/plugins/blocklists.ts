import { initBlocklists } from '../utils/contentGuard'
import { getExtractor } from '../utils/nsfwClassifier'

// Load blocklists and warm the NSFW model once at server startup instead of
// on every request. This moves the cold-start cost off the critical path of
// the first real search.
export default defineNitroPlugin(() => {
  // Blocklist init
  initBlocklists()
    .then(() => console.log('[Guard] Blocklists preloaded at startup'))
    .catch((e: unknown) => console.warn('[Guard] Failed to preload blocklists at startup:', e))

  // NSFW model warm-up — runs in background, non-blocking
  getExtractor()
    .then(() => console.log('[NSFW] Model warmed up at startup'))
    .catch((e: unknown) => console.warn('[NSFW] Model warm-up failed:', e))
})
