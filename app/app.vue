<script setup lang="ts">
const { isDark } = useTheme()

useHead(() => ({
  meta: [
    {
      name: 'theme-color',
      content: isDark.value ? '#09090b' : '#fafaf9',
    },
  ],
}))
</script>

<template>
  <div class="min-h-dvh bg-canvas font-sans text-fg antialiased selection:bg-selection">
    <NuxtRouteAnnouncer />
    <NuxtPage />
  </div>
</template>
