<script setup lang="ts">
const props = defineProps<{
  suggestions: string[]
  activeIndex: number
}>()

const emit = defineEmits<{
  select: [value: string]
  hover: [index: number]
}>()
</script>

<template>
  <div
    id="search-suggestions"
    role="listbox"
    aria-label="Search suggestions"
    class="drop-in -mt-px border-x border-b border-line bg-canvas"
  >
    <button
      v-for="(suggestion, index) in props.suggestions"
      :id="`suggestion-${index}`"
      :key="suggestion"
      type="button"
      role="option"
      :aria-selected="index === props.activeIndex"
      :class="[
        'flex w-full items-center gap-2 px-3 py-2 text-left font-mono text-xs transition-colors duration-75',
        index === props.activeIndex
          ? 'bg-active text-fg'
          : 'text-muted hover:bg-active hover:text-fg',
      ]"
      @mousedown.prevent="emit('select', suggestion)"
      @mouseenter="emit('hover', index)"
    >
      <span class="shrink-0 text-faint" aria-hidden="true">↳</span>
      <span class="truncate">{{ suggestion }}</span>
      <span
        v-if="index === props.activeIndex"
        class="ml-auto shrink-0 text-[10px] text-faint"
        aria-hidden="true"
      >↵</span>
    </button>

    <div
      class="flex items-center justify-between gap-3 border-t border-line-soft px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-dim"
      aria-hidden="true"
    >
      <span>↑↓ navigate</span>
      <span>↵ select · esc close</span>
    </div>
  </div>
</template>
