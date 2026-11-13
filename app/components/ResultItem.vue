<script setup lang="ts">
import type { SearchResultItem, TextSegment } from '#shared/types/search'

const props = defineProps<{
  result: SearchResultItem
  index: number
  active: boolean
  segments: TextSegment[]
}>()

const emit = defineEmits<{
  activate: [index: number]
}>()

const breadcrumb = computed(() => formatBreadcrumb(props.result.url))
const age = computed(() => relativeAge(props.result.publishedDate))
const displaySegments = computed<TextSegment[]>(() => {
  if (props.segments.length) return props.segments
  return props.result.snippet ? [{ text: props.result.snippet, match: false }] : []
})
</script>

<template>
  <li
    :id="`result-${index + 1}`"
    :class="[
      'row-in group -ml-3 scroll-mt-32 border-l-2 py-3 pl-3 transition-colors duration-100',
      active
        ? 'border-active-border bg-active'
        : 'border-transparent hover:border-line hover:bg-active focus-within:border-active-border focus-within:bg-active',
    ]"
    :style="{ animationDelay: `${Math.min(index, 10) * 16}ms` }"
    @mouseenter="emit('activate', index)"
  >
    <div class="flex min-w-0 items-baseline gap-2 font-mono text-xs tabular-nums">
      <span
        class="shrink-0 text-dim transition-colors group-hover:text-faint"
        :title="`Press ${index + 1} to open`"
      >
        {{ padIndex(index + 1) }}
      </span>

      <a
        :href="result.url"
        :title="result.url"
        tabindex="-1"
        rel="noopener noreferrer"
        class="min-w-0 truncate text-faint transition-colors hover:text-muted"
      >
        {{ breadcrumb }}
      </a>

      <span v-if="age" class="ml-auto shrink-0 pl-2 text-[11px] text-dim">
        {{ age }}
      </span>
    </div>

    <h2 class="mt-1.5 text-base font-medium leading-snug">
      <a
        :href="result.url"
        rel="noopener noreferrer"
        class="text-fg decoration-1 underline-offset-2 visited:text-faint hover:underline"
      >
        {{ result.title }}
      </a>
    </h2>

    <p v-if="displaySegments.length" class="mt-1 line-clamp-2 text-sm leading-relaxed text-muted">
      <template v-for="(segment, segmentIndex) in displaySegments" :key="segmentIndex">
        <strong v-if="segment.match" class="font-semibold text-fg">{{ segment.text }}</strong>
        <template v-else>{{ segment.text }}</template>
      </template>
    </p>
  </li>
</template>
