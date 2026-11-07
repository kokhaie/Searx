export type Theme = 'dark' | 'light'

export function useTheme() {
  const theme = useState<Theme>('theme', () => 'dark')
  const isDark = computed(() => theme.value === 'dark')

  function paint(value: Theme) {
    if (!import.meta.client) return

    const root = document.documentElement
    root.classList.toggle('dark', value === 'dark')
    root.classList.toggle('light', value === 'light')
    root.style.colorScheme = value

    const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
    if (meta) meta.content = value === 'dark' ? '#09090b' : '#fafaf9'
  }

  function setTheme(value: Theme) {
    theme.value = value
    paint(value)

    if (import.meta.client) {
      try {
        localStorage.setItem('theme', value)
      } catch {
        /* storage can be unavailable (private mode) */
      }
    }
  }

  function toggleTheme() {
    setTheme(isDark.value ? 'light' : 'dark')
  }

  return { theme, isDark, setTheme, toggleTheme, paint }
}
