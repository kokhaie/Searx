import { initBlocklists } from '../utils/contentGuard'

// Load blocklists once at server startup instead of on every request.
// contentGuard.ts already guards with `initPromise` so concurrent callers
// share the same load; this just moves the cost off the critical path of
// the first search.
export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('ready', async () => {
    try {
      await initBlocklists()
      console.log('[Guard] Blocklists preloaded at startup')
    } catch (e) {
      console.warn('[Guard] Failed to preload blocklists at startup:', e)
    }
  })
})
