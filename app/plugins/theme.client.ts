export default defineNuxtPlugin(() => {
  const { theme, paint } = useTheme()

  try {
    const stored = localStorage.getItem('theme')
    if (stored === 'dark' || stored === 'light') {
      // Explicit user preference takes priority
      theme.value = stored
    } else {
      // No stored preference — respect the OS/browser colour scheme
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
      theme.value = prefersDark ? 'dark' : 'light'
    }
  } catch {
    /* storage can be unavailable (private mode) */
  }

  paint(theme.value)
})
