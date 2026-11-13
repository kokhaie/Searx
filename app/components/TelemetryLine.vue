<script setup lang="ts">
const props = defineProps<{
  resultCount: number
  filteredCount: number
  searxMs: number
  aiMs: number
  rangeLabel: string
  loading: boolean
}>()

defineEmits<{
  toggleTheme: []
}>()

const showTimings = ref(false)
</script>

<template>
  <div
    class="mb-6 flex items-center justify-between gap-1.5 border-b border-line-soft pb-2 font-mono text-[10px] uppercase tracking-normal text-faint sm:gap-3 sm:text-[11px] sm:tracking-wider"
    aria-live="polite"
  >
    <div class="min-w-0 truncate tabular-nums flex items-center gap-1.5">
      <template v-if="props.loading">
        <span>LOADING RESULTS…</span>
      </template>
      <template v-else>
        <span class="font-medium text-muted">{{ props.resultCount }} RESULTS</span>
        <span v-if="props.filteredCount > 0">
          <span class="text-dim"> · </span>
          <span>{{ props.filteredCount }} FILTERED</span>
        </span>

        <span class="text-dim"> · </span>
        <button
          type="button"
          class="transition-colors hover:text-fg text-faint inline-flex items-center gap-1 cursor-pointer"
          :title="`SearXNG: ${props.searxMs || '—'}ms · AI Guard: ${props.aiMs || '—'}ms (click to toggle)`"
          @click="showTimings = !showTimings"
        >
          <span v-if="showTimings" class="text-muted">
            SEARX {{ props.searxMs || '—' }}MS · AI {{ props.aiMs || '—' }}MS
          </span>
          <span v-else class="underline decoration-dotted decoration-line hover:text-fg">
            TIMINGS [{{ (props.searxMs || 0) + (props.aiMs || 0) }}MS]
          </span>
        </button>
      </template>
    </div>

    <div class="flex shrink-0 items-center gap-2 tabular-nums">
      <button
        type="button"
        title="Toggle color theme (T)"
        aria-label="Toggle color theme"
        class="text-faint transition-colors duration-100 hover:text-fg font-medium cursor-pointer"
        @click="$emit('toggleTheme')"
      >
        <span class="theme-label-dark">[→ LIGHT]</span>
        <span class="theme-label-light">[→ DARK]</span>
      </button>

      <span class="hidden text-dim sm:inline">·</span>

      <p class="hidden items-center gap-1 sm:flex">
        <span class="text-dim">FILTER:</span>
        <span class="text-muted">{{ props.rangeLabel }}</span>
      </p>
    </div>
  </div>
</template>
