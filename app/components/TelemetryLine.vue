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
</script>

<template>
  <div
    class="mb-6 flex items-center justify-between gap-1.5 border-b border-line-soft pb-2 font-mono text-[10px] uppercase tracking-normal text-faint sm:gap-3 sm:text-[11px] sm:tracking-wider"
    aria-live="polite"
  >
    <p class="min-w-0 truncate tabular-nums">
      <template v-if="props.loading">
        — RESULTS · — FILTERED · SEARX —MS · AI —MS
      </template>
      <template v-else>
        <span>{{ props.resultCount }} RESULTS</span>
        <span class="text-dim"> · </span>
        <span>{{ props.filteredCount }} FILTERED</span>
        <span class="text-dim"> · </span>
        <span>SEARX {{ props.searxMs || '—' }}MS</span>
        <span class="text-dim"> · </span>
        <span title="AI NSFW inference pass">AI {{ props.aiMs || '—' }}MS</span>
      </template>
    </p>

    <div class="flex shrink-0 items-center gap-2 tabular-nums">
      <button
        type="button"
        title="Toggle theme (T)"
        class="text-faint transition-colors duration-100 hover:text-fg"
        @click="$emit('toggleTheme')"
      >
        <span class="theme-label-dark">[DARK]</span>
        <span class="theme-label-light">[LIGHT]</span>
      </button>

      <span class="hidden text-dim sm:inline">·</span>

      <p class="hidden items-center gap-1 sm:flex">
        <span class="text-dim">FILTER:</span>
        <span class="text-muted">{{ props.rangeLabel }}</span>
      </p>
    </div>
  </div>
</template>
