import tailwindcss from '@tailwindcss/vite'

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: false },

  css: [
    '@fontsource-variable/geist',
    '@fontsource-variable/geist-mono',
    '~/assets/css/main.css',
  ],

  vite: {
    plugins: [tailwindcss()],
  },

  runtimeConfig: {
    // Server-only. Point this at any SearXNG instance with the JSON format
    // enabled. The browser never talks to SearXNG — every search flows through
    // the Nuxt server proxy (/api/search, /api/suggest), so the SearXNG
    // instance needs no CORS configuration. NUXT_SEARX_URL overrides this at
    // runtime; SEARX_URL is handy in local dev.
    searxUrl:
      process.env.NUXT_SEARX_URL ||
      process.env.SEARX_URL ||
      'http://127.0.0.1:8080',
  },

  app: {
    head: {
      htmlAttrs: { lang: 'en' },
      title: 'Search',
      meta: [
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
        { name: 'color-scheme', content: 'dark light' },
        { name: 'theme-color', content: '#09090b' },
        {
          name: 'description',
          content: 'A fast, keyboard-first front end for SearXNG.',
        },
        { name: 'robots', content: 'noindex, nofollow' },
      ],
      script: [
        {
          innerHTML:
            "(function(){var t='dark';try{var s=localStorage.getItem('theme');if(s==='light'||s==='dark')t=s;}catch(e){}var r=document.documentElement;r.classList.toggle('dark',t==='dark');r.classList.toggle('light',t==='light');r.style.colorScheme=t;var m=document.querySelector('meta[name=\"theme-color\"]');if(m)m.setAttribute('content',t==='dark'?'#09090b':'#fafaf9');})();",
        },
      ],
    },
  },
})
