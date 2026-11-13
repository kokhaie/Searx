<script setup lang="ts">
import type { SearchResultItem, TextSegment, TimeRange } from '#shared/types/search'
import { search, suggest } from '~/utils/searchClient'

const TIME_RANGES = [
  { label: 'ALL', value: '' },
  { label: '24H', value: 'day' },
  { label: '7D', value: 'week' },
  { label: '30D', value: 'month' },
  { label: '1Y', value: 'year' },
] as const

const RESULTS_LIMITS = [3, 5, 10] as const
type ResultsLimit = (typeof RESULTS_LIMITS)[number]

const DEFAULT_RESULTS_LIMIT: ResultsLimit = 5

const ROUTE_RANGE: Record<Exclude<TimeRange, ''>, string> = {
  day: '24h',
  week: '7d',
  month: '30d',
  year: '1y',
}

const RANGE_FROM_ROUTE: Record<string, TimeRange> = {
  '24h': 'day',
  '7d': 'week',
  '30d': 'month',
  '1y': 'year',
}

function queryParam(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0]
  return ''
}

const route = useRoute()
const router = useRouter()
const { toggleTheme } = useTheme()

const initialQuery = queryParam(route.query.q) || ''
const initialRange = RANGE_FROM_ROUTE[queryParam(route.query.range)] ?? ''
const initialMaxResults = queryParam(route.query.maxResults)

const query = ref(initialQuery)
const timeRange = ref<TimeRange>(initialRange)
const submittedQuery = ref('')
const maxResults = ref<ResultsLimit>(
  (RESULTS_LIMITS as readonly number[]).includes(Number(initialMaxResults))
    ? (Number(initialMaxResults) as ResultsLimit)
    : DEFAULT_RESULTS_LIMIT,
)

const inputEl = ref<HTMLInputElement | null>(null)
const inputFocused = ref(false)

const results = ref<SearchResultItem[]>([])
const segments = ref<TextSegment[][]>([])
const suggestions = ref<string[]>([])
const history = ref<string[]>([])
// Cap the in-browser suggest cache so it doesn't grow unbounded during a long session.
const SUGGEST_CACHE_MAX = 100
const suggestCache = new Map<string, string[]>()
function setSuggestCache(key: string, value: string[]) {
  if (suggestCache.size >= SUGGEST_CACHE_MAX) {
    // Evict the oldest entry (first inserted key)
    const oldest = suggestCache.keys().next().value
    if (oldest !== undefined) suggestCache.delete(oldest)
  }
  suggestCache.set(key, value)
}

const activeIndex = ref(-1)
const activeSuggestion = ref(-1)
const suggestionsDismissed = ref(false)

const isLoading = ref(Boolean(initialQuery.trim()))
const hasSearched = ref(false)
const error = ref('')

const filteredCount = ref(0)
const searxMs = ref(0)
const aiMs = ref(0)

let searchAbort: AbortController | null = null
let suggestAbort: AbortController | null = null
let suggestTimer: ReturnType<typeof setTimeout> | undefined
let suggestDebounceStart: number | null = null

const SUGGEST_DEBOUNCE_MS = 300
const SUGGEST_MAX_WAIT_MS = 1000

const suggestionsOpen = computed(
  () => inputFocused.value && !suggestionsDismissed.value && suggestions.value.length > 0,
)

const rangeLabel = computed(
  () => TIME_RANGES.find(item => item.value === timeRange.value)?.label ?? 'ALL',
)

/** Platform-aware modifier key label. */
const modKey = computed(() => {
  if (!import.meta.client) return '⌘'
  return /mac|iphone|ipad|ipod/i.test(navigator.platform || '') ? '⌘' : 'Ctrl+'
})

useHead(() => ({
  title: submittedQuery.value ? `${submittedQuery.value} · Search` : 'Search',
}))

function historyMatches(value: string): string[] {
  const needle = value.trim().toLowerCase()
  if (!needle) return history.value.slice(0, 3)

  return history.value
    .filter(item => item.toLowerCase().includes(needle) && item.toLowerCase() !== needle)
    .slice(0, 3)
}

function mergeSuggestionLists(value: string, remote: string[]): string[] {
  const needle = value.trim().toLowerCase()
  const seen = new Set<string>()
  const merged: string[] = []

  for (const candidate of [...historyMatches(value), ...remote]) {
    const text = candidate.trim()
    if (!text) continue

    const key = text.toLowerCase()
    if (key === needle || seen.has(key)) continue

    seen.add(key)
    merged.push(text)

    if (merged.length >= 6) break
  }

  return merged
}

function remember(value: string) {
  const next = [value, ...history.value.filter(item => item.toLowerCase() !== value.toLowerCase())].slice(
    0,
    12,
  )
  history.value = next

  try {
    localStorage.setItem('search-history', JSON.stringify(next))
  } catch {
    /* storage can be unavailable (private mode) */
  }
}

function loadHistory() {
  try {
    const stored = localStorage.getItem('search-history')
    if (!stored) return

    const parsed: unknown = JSON.parse(stored)
    if (!Array.isArray(parsed)) return

    history.value = parsed.filter((item): item is string => typeof item === 'string').slice(0, 12)
  } catch {
    /* ignore malformed history */
  }
}

function errorMessage(value: unknown): string {
  const fallback = 'The search backend did not respond. Check the connection and try again.'
  if (!value || typeof value !== 'object') return fallback

  const data = (value as { data?: { message?: unknown } }).data
  if (typeof data?.message === 'string' && data.message.trim()) return data.message

  const message = value instanceof Error ? value.message : ''
  if (message && !/fetch|network|failed to fetch/i.test(message)) return message

  return fallback
}

async function syncUrl(value: string) {
  if (!import.meta.client) return

  const next: Record<string, string> = {}
  if (value) next.q = value
  if (timeRange.value) next.range = ROUTE_RANGE[timeRange.value]
  if (maxResults.value) next.maxResults = String(maxResults.value)

  try {
    await router.replace({ query: next })
  } catch {
    /* URL syncing is best-effort */
  }
}

async function runSearch(rawQuery = query.value) {
  const value = rawQuery.trim()

  if (!value) {
    searchAbort?.abort()
    query.value = ''
    submittedQuery.value = ''
    results.value = []
    segments.value = []
    filteredCount.value = 0
    searxMs.value = 0
    aiMs.value = 0
    activeIndex.value = -1
    error.value = ''
    hasSearched.value = false
    isLoading.value = false
    await syncUrl('')
    return
  }

  query.value = value
  submittedQuery.value = value
  suggestionsDismissed.value = true
  activeSuggestion.value = -1
  clearTimeout(suggestTimer)
  suggestAbort?.abort()

  searchAbort?.abort()
  const controller = new AbortController()
  searchAbort = controller

  isLoading.value = true
  hasSearched.value = true
  error.value = ''
  results.value = []
  segments.value = []
  filteredCount.value = 0
  searxMs.value = 0
  aiMs.value = 0
  activeIndex.value = -1

  void syncUrl(value)

  try {
    const response = await search(value, timeRange.value || undefined, maxResults.value, {
      signal: controller.signal,
    })

    if (controller.signal.aborted) return

    const started = performance.now()
    const terms = extractTerms(value)
    const nextSegments = response.results.map(result => highlightSegments(result.snippet, terms))

    segments.value = nextSegments

    results.value = response.results
    filteredCount.value = response.filteredCount
    searxMs.value = response.timings.searx
    aiMs.value = response.timings.ai || 0
    submittedQuery.value = response.query || value
    activeIndex.value = -1

    remember(value)

    if (window.scrollY > 0) {
      window.scrollTo({ top: 0, behavior: 'smooth' })
    }
  } catch (value) {
    if (controller.signal.aborted || (value as Error)?.name === 'AbortError') return

    results.value = []
    segments.value = []
    filteredCount.value = 0
    searxMs.value = 0
    aiMs.value = 0
    error.value = errorMessage(value)
  } finally {
    if (!controller.signal.aborted) isLoading.value = false
  }
}

function submit() {
  if (suggestionsOpen.value && activeSuggestion.value >= 0) {
    const chosen = suggestions.value[activeSuggestion.value]
    if (chosen) query.value = chosen
  }

  suggestionsDismissed.value = true
  activeSuggestion.value = -1
  inputEl.value?.blur()
  void runSearch()
}

function setRange(value: TimeRange) {
  if (timeRange.value === value) return

  timeRange.value = value

  if (submittedQuery.value) {
    void runSearch(submittedQuery.value)
  } else {
    void syncUrl(query.value)
  }
}

function setMaxResults(limit: ResultsLimit) {
  if (maxResults.value === limit) return

  maxResults.value = limit

  if (submittedQuery.value) {
    void runSearch(submittedQuery.value)
  } else {
    void syncUrl(query.value)
  }
}

function focusSearch() {
  suggestionsDismissed.value = false
  nextTick(() => {
    const input = inputEl.value
    if (!input) return

    input.focus({ preventScroll: true })
    input.select()
    refreshSuggestions()
  })
}

function onInputFocus() {
  inputFocused.value = true
  suggestionsDismissed.value = false
  activeSuggestion.value = -1
  refreshSuggestions()
}

function onInputBlur() {
  inputFocused.value = false
  activeSuggestion.value = -1
}

function refreshSuggestions() {
  const value = query.value.trim()
  const cached = suggestCache.get(value.toLowerCase()) ?? []

  suggestions.value = mergeSuggestionLists(value, cached)

  if (value.length >= 2) scheduleSuggestions(value)
}

function scheduleSuggestions(value: string) {
  clearTimeout(suggestTimer)
  suggestAbort?.abort()

  const now = Date.now()
  if (suggestDebounceStart === null) {
    suggestDebounceStart = now
  }

  const maxWaitDeadline = suggestDebounceStart + SUGGEST_MAX_WAIT_MS
  const timeUntilMaxWait = maxWaitDeadline - now

  if (timeUntilMaxWait <= 0) {
    suggestDebounceStart = null
    void loadSuggestions(value)
    return
  }

  const delay = Math.min(SUGGEST_DEBOUNCE_MS, timeUntilMaxWait)

  suggestTimer = setTimeout(() => {
    suggestDebounceStart = null
    void loadSuggestions(value)
  }, delay)
}

async function loadSuggestions(value: string) {
  suggestAbort?.abort()
  const controller = new AbortController()
  suggestAbort = controller

  try {
    const nextSuggestions = await suggest(value, {
      signal: controller.signal,
    })

    if (controller.signal.aborted) return

    setSuggestCache(value.toLowerCase(), nextSuggestions)

    if (query.value.trim() !== value) return

    suggestions.value = mergeSuggestionLists(value, nextSuggestions)
    activeSuggestion.value = -1
  } catch {
    /* autocomplete is best-effort */
  }
}

function moveSuggestion(direction: number) {
  const total = suggestions.value.length
  if (!total) return

  const current = activeSuggestion.value
  activeSuggestion.value =
    current < 0 ? (direction > 0 ? 0 : total - 1) : (current + direction + total) % total
}

function pickSuggestion(value: string) {
  query.value = value
  submittedQuery.value = value
  suggestions.value = []
  suggestionsDismissed.value = true
  activeSuggestion.value = -1
  void runSearch(value)
}

function moveActive(direction: number) {
  const total = results.value.length
  if (!total) return

  const current = activeIndex.value
  const next = current < 0 ? (direction > 0 ? 0 : total - 1) : (current + direction + total) % total
  activeIndex.value = next

  nextTick(() => {
    document
      .getElementById(`result-${next + 1}`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  })
}

function openResult(index: number, newTab = false) {
  const result = results.value[index]
  if (!result) return

  if (newTab) {
    const opened = window.open(result.url, '_blank', 'noopener,noreferrer')
    if (opened) opened.opener = null
    return
  }

  window.location.assign(result.url)
}

function onInputKeydown(event: KeyboardEvent) {
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    const direction = event.key === 'ArrowDown' ? 1 : -1

    if (suggestionsOpen.value) {
      event.preventDefault()
      moveSuggestion(direction)
      return
    }

    if (results.value.length) {
      event.preventDefault()
      inputEl.value?.blur()
      moveActive(direction)
    }

    return
  }

  if (event.key === 'Escape') {
    if (suggestionsOpen.value) {
      event.preventDefault()
      suggestionsDismissed.value = true
      activeSuggestion.value = -1
    } else {
      inputEl.value?.blur()
    }
  }
}

watch(query, value => {
  activeSuggestion.value = -1
  suggestionsDismissed.value = false

  if (!inputFocused.value) return

  const trimmed = value.trim()
  const cached = suggestCache.get(trimmed.toLowerCase()) ?? []
  suggestions.value = mergeSuggestionLists(trimmed, cached)

  if (trimmed.length < 2) {
    clearTimeout(suggestTimer)
    suggestAbort?.abort()
    return
  }

  scheduleSuggestions(trimmed)
})

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false

  return Boolean(
    target.closest('input, textarea, select, [contenteditable="true"], [contenteditable=""]'),
  )
}

function isInteractive(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false

  return Boolean(target.closest('a, button, [role="button"], [role="option"], summary'))
}

function onGlobalKeydown(event: KeyboardEvent) {
  const mod = event.metaKey || event.ctrlKey

  if (mod && event.key.toLowerCase() === 'k') {
    event.preventDefault()
    focusSearch()
    return
  }

  if (event.defaultPrevented || event.isComposing) return
  if (isEditable(event.target)) return

  const key = event.key

  if (isInteractive(event.target) && (key === 'Enter' || key === ' ')) return

  if (key === '/') {
    event.preventDefault()
    focusSearch()
    return
  }

  if (key === 'ArrowDown' || key === 'ArrowUp') {
    event.preventDefault()
    moveActive(key === 'ArrowDown' ? 1 : -1)
    return
  }

  if ((key === 'j' || key === 'J') && !mod && !event.altKey) {
    event.preventDefault()
    moveActive(1)
    return
  }

  if ((key === 'k' || key === 'K') && !mod && !event.altKey) {
    event.preventDefault()
    moveActive(-1)
    return
  }

  if (key === 'Enter' && activeIndex.value >= 0) {
    event.preventDefault()
    openResult(activeIndex.value, mod)
    return
  }

  if (/^[1-9]$/.test(key) && !mod && !event.altKey) {
    const index = Number(key) - 1
    if (index < results.value.length) {
      event.preventDefault()
      openResult(index)
    }
    return
  }

  if ((key === 't' || key === 'T') && !mod && !event.altKey) {
    event.preventDefault()
    toggleTheme()
    return
  }

  if (key === 'Escape') {
    activeIndex.value = -1
  }
}

onMounted(() => {
  loadHistory()
  window.addEventListener('keydown', onGlobalKeydown)

  if (query.value.trim()) {
    void runSearch(query.value)
  }
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onGlobalKeydown)
  clearTimeout(suggestTimer)
  searchAbort?.abort()
  suggestAbort?.abort()
})
</script>

<template>
  <main class="mx-auto w-full max-w-2xl px-4 py-10">
    <header
      class="sticky top-0 z-30 -mx-4 bg-canvas/90 px-4 pb-3 pt-1 backdrop-blur-md"
    >
      <form
        role="search"
        class="flex items-center gap-1.5 border border-line bg-panel/90 px-3 py-2.5 backdrop-blur transition-colors duration-150 focus-within:border-faint sm:gap-2"
        @submit.prevent="submit"
      >
        <span class="shrink-0 select-none font-mono text-sm leading-none text-faint" aria-hidden="true">
          >
        </span>

        <input
          ref="inputEl"
          v-model="query"
          type="text"
          inputmode="search"
          autocomplete="off"
          autocapitalize="off"
          spellcheck="false"
          role="combobox"
          aria-label="Search query"
          aria-autocomplete="list"
          aria-controls="search-suggestions"
          :aria-expanded="suggestionsOpen"
          :aria-activedescendant="activeSuggestion >= 0 ? `suggestion-${activeSuggestion}` : undefined"
          placeholder="Search the web…"
          class="min-w-0 flex-1 bg-transparent font-sans text-[15px] text-fg outline-none placeholder:text-faint"
          @focus="onInputFocus"
          @blur="onInputBlur"
          @keydown="onInputKeydown"
        />

        <!-- Hidden submit button for mobile & accessible screen readers -->
        <button type="submit" class="sr-only" aria-label="Submit search">Search</button>

        <div
          role="group"
          aria-label="Results limit"
          class="flex shrink-0 items-center rounded-full border border-line/80 bg-canvas/50 p-0.5 font-mono text-[9px] uppercase tracking-wider sm:text-[10px] mx-1 sm:mx-2"
        >
          <button
            v-for="limit in RESULTS_LIMITS"
            :key="limit"
            type="button"
            :aria-pressed="maxResults === limit"
            :aria-label="`Limit to ${limit} results${maxResults === limit ? ' (selected)' : ''}`"
            :class="[
              'rounded-full px-2 py-1 leading-none transition-colors duration-100 sm:px-1.5 sm:py-0.5',
              maxResults === limit ? 'bg-elevated text-fg font-medium' : 'text-faint hover:text-muted',
            ]"
            @click="setMaxResults(limit)"
          >
            {{ limit }}
          </button>
        </div>

        <div
          role="group"
          aria-label="Time range"
          class="flex shrink-0 items-center rounded-full border border-line/80 bg-canvas/50 p-0.5 font-mono text-[9px] uppercase tracking-wider sm:text-[10px]"
        >
          <button
            v-for="range in TIME_RANGES"
            :key="range.label"
            type="button"
            :aria-pressed="timeRange === range.value"
            :aria-label="`Time range: ${range.label}${timeRange === range.value ? ' (selected)' : ''}`"
            :class="[
              'rounded-full px-1.5 py-1 leading-none transition-colors duration-100 sm:px-1.5 sm:py-1',
              timeRange === range.value
                ? 'bg-elevated text-fg font-medium'
                : 'text-faint hover:text-muted',
            ]"
            @click="setRange(range.value)"
          >
            {{ range.label }}
          </button>
        </div>

        <button
          type="button"
          title="Focus search ( / or ⌘K )"
          aria-label="Focus search"
          class="hidden h-6 shrink-0 items-center border border-line bg-canvas px-1.5 font-mono text-[10px] leading-none text-faint transition-colors duration-100 hover:text-fg min-[360px]:inline-flex"
          @click="focusSearch"
        >
          [ / ]
        </button>
      </form>

      <AutocompletePanel
        v-if="suggestionsOpen"
        :suggestions="suggestions"
        :active-index="activeSuggestion"
        @select="pickSuggestion"
        @hover="activeSuggestion = $event"
      />
    </header>

    <TelemetryLine
      :result-count="results.length"
      :filtered-count="filteredCount"
      :searx-ms="searxMs"
      :ai-ms="aiMs"
      :range-label="rangeLabel"
      :loading="isLoading"
      @toggle-theme="toggleTheme"
    />

    <section
      class="min-h-[40vh]"
      aria-live="polite"
      :aria-busy="isLoading ? 'true' : 'false'"
    >
      <!-- Screen-reader announcement when results arrive -->
      <span
        v-if="!isLoading && hasSearched"
        class="sr-only"
        role="status"
      >
        {{ results.length ? `${results.length} results for ${submittedQuery}` : `No results for ${submittedQuery}` }}
      </span>
      <ResultSkeleton v-if="isLoading" />

      <div
        v-else-if="error"
        class="border border-line bg-panel/40 px-4 py-4 font-mono text-xs"
      >
        <p class="uppercase tracking-wider text-fg">Search backend unreachable</p>
        <p class="mt-2 text-muted leading-relaxed">
          Unable to complete the search request. Please check your connection and try again.
        </p>
        <details class="mt-2 text-faint">
          <summary class="cursor-pointer text-[11px] hover:text-fg select-none">Technical details</summary>
          <p class="mt-1 font-mono text-[11px] leading-relaxed text-dim">{{ error }}</p>
        </details>
        <button
          type="button"
          class="mt-3 border border-line px-2.5 py-1 text-[10px] uppercase tracking-wider text-muted transition-colors hover:text-fg"
          @click="runSearch()"
        >
          Retry
        </button>
      </div>

      <div v-else-if="!query.trim()" class="py-16 text-center">
        <p class="font-mono text-[11px] uppercase tracking-wider text-faint">Ready</p>
        <p class="mt-2 text-sm text-muted">
          Type a query and press
          <kbd class="rounded border border-line px-1.5 py-0.5 font-mono text-[10px] text-faint">↵</kbd>
        </p>
        <div class="mt-6 flex flex-wrap items-center justify-center gap-2 font-mono text-xs text-faint">
          <span class="text-[10px] uppercase tracking-wider text-dim">Try:</span>
          <button
            v-for="sample in ['Nuxt 4', 'TypeScript', 'Tailwind CSS', 'SearXNG']"
            :key="sample"
            type="button"
            class="rounded border border-line bg-panel/60 px-2 py-0.5 text-xs text-muted transition-colors hover:border-faint hover:text-fg"
            @click="query = sample; void runSearch(sample)"
          >
            {{ sample }}
          </button>
        </div>
      </div>

      <div v-else-if="hasSearched && !results.length" class="py-16 text-center">
        <p class="font-mono text-[11px] uppercase tracking-wider text-faint">No results</p>
        <p class="mt-2 font-mono text-xs leading-relaxed text-dim">
          Nothing matched "{{ submittedQuery }}".<br>
          Try a broader query or set the filter to ALL.
        </p>
        <p v-if="filteredCount > 0" class="mt-3 font-mono text-[11px] text-faint">
          {{ filteredCount }} result{{ filteredCount === 1 ? '' : 's' }} were filtered by safety rules.
        </p>
      </div>

      <ol v-else class="space-y-0">
        <ResultItem
          v-for="(result, index) in results"
          :key="result.url"
          :result="result"
          :index="index"
          :active="activeIndex === index"
          :segments="segments[index] ?? []"
          @activate="activeIndex = $event"
        />
      </ol>
    </section>

    <footer
      class="mt-10 flex flex-wrap items-center justify-between gap-2 border-t border-line-soft pt-4 font-mono text-[10px] uppercase tracking-wider text-dim pb-[max(1rem,env(safe-area-inset-bottom))]"
    >
      <p class="flex flex-wrap items-center gap-1.5">
        <kbd class="rounded border border-line px-1 py-0.5 text-[9px] text-faint">J</kbd>/<kbd class="rounded border border-line px-1 py-0.5 text-[9px] text-faint">K</kbd> navigate ·
        <kbd class="rounded border border-line px-1 py-0.5 text-[9px] text-faint">↵</kbd> open ·
        <kbd class="rounded border border-line px-1 py-0.5 text-[9px] text-faint">1–9</kbd> jump ·
        <span class="hidden sm:inline"><kbd class="rounded border border-line px-1 py-0.5 text-[9px] text-faint">{{ modKey }}</kbd><kbd class="rounded border border-line px-1 py-0.5 text-[9px] text-faint">↵</kbd> new tab · </span>
        <kbd class="rounded border border-line px-1 py-0.5 text-[9px] text-faint">T</kbd> theme ·
        <kbd class="rounded border border-line px-1 py-0.5 text-[9px] text-faint">/</kbd> focus
      </p>
      <p class="hidden sm:block">
        <kbd class="rounded border border-line px-1 py-0.5 text-[9px] text-faint">{{ modKey }}</kbd><kbd class="rounded border border-line px-1 py-0.5 text-[9px] text-faint">K</kbd> focus search
      </p>
    </footer>
  </main>
</template>