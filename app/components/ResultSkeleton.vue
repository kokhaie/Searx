<template>
  <div>
    <p class="sr-only" role="status">Loading search results…</p>
    <div class="space-y-0 py-1" aria-hidden="true">
      <div
        v-for="index in 4"
        :key="index"
        class="-ml-3 border-l-2 border-transparent py-3 pl-3"
      >
        <div class="flex items-center gap-2">
          <div class="h-3 w-5 animate-pulse bg-line" />
          <div class="h-3 w-44 animate-pulse bg-line" />
          <div class="ml-auto h-2.5 w-10 animate-pulse bg-line-soft" />
        </div>
        <div class="mt-3 h-4 w-3/4 animate-pulse bg-elevated" />
        <div class="mt-2.5 h-3 w-full animate-pulse bg-line" />
        <div class="mt-1.5 h-3 w-5/6 animate-pulse bg-line" />
      </div>
    </div>
  </div>
</template>
