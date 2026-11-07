export default defineNuxtPlugin(() => {
  const { theme, paint } = useTheme()

  try {
    const stored = localStorage.getItem('theme')
    if (stored === 'dark' || stored === 'light') {
      theme.value = stored
    }
  } catch {
    /* storage can be unavailable (private mode) */
  }

  paint(theme.value)
})
