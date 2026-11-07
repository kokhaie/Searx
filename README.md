# Search

A keyboard-first, monochrome front end for a [SearXNG](https://docs.searxng.org/) instance. Built with Nuxt 4, Vue 3, and Tailwind CSS v4.

The UI is intentionally dense and quiet: Geist / Geist Mono, sharp edges, no images, favicons, avatars, shadows, or gradients. Dark by default, with a clean light mode.

## Setup

```bash
pnpm install
pnpm dev
```

The app's server talks to `http://127.0.0.1:8080` by default (a local SearXNG). Point it at another instance with `SEARX_URL` in development:

```bash
SEARX_URL=http://localhost:8888 pnpm dev
```

For production, use the runtime override:

```bash
NUXT_SEARX_URL=https://search.example.com \
node .output/server/index.mjs
```

## Docker

`docker-compose.yml` is a single self-contained stack — just run it:

```bash
docker compose up --build
```

Nothing else to prepare: no `.env` needed, no SearXNG settings to edit, no rate limiter. It runs the Nuxt frontend together with a private SearXNG (`core`) and Valkey, following the official SearXNG compose template. Only the frontend is published to the host (port `3000`); SearXNG is not exposed and is reached by the app container over the internal `searxnet` network through its server proxy.

Then open http://localhost:3000 (or `APP_PORT` if changed).

Notes:
- Everything is baked: `searxng/core-config/settings.yml` is mounted into the `core` container (JSON format on for the app, `html` kept for the SearXNG web UI, `autocomplete: "google"` powering `/autocompleter`, limiter off). The SearXNG secret falls back to a dev value; create a `.env` (see `.env.example`) with `SEARXNG_SECRET=$(openssl rand -hex 32)` for anything non-local.
- The browser never talks to SearXNG at all: all searches flow through the app's `/api/*` server proxy, so no CORS configuration is needed on the SearXNG instance.
- Container names are prefixed `search-` so the stack can run alongside the production `searxng` compose project.

## Container image CI

`.github/workflows/docker.yml` builds the app image and pushes it to GHCR on pushes to `main`/`master` (tagged `latest`) and on version tags (`v*`, e.g. `v1.2.3` → `1.2.3`, `1.2`). Pull requests only build. Pull it elsewhere with `docker pull ghcr.io/<owner>/<repo>:latest`.

The SearXNG instance must expose the JSON format (`search.formats` includes `json`). Autocomplete uses `/autocompleter` when available and falls back to search suggestions.

## Transport

All SearXNG requests are proxied by the Nuxt server — the browser only talks to the app itself:

| Route | Behaviour |
| --- | --- |
| `GET /` | Static UI, no SearXNG calls in the browser |
| `GET /api/search?q=&time_range=` | Server fetches SearXNG JSON (`runtimeConfig.searxUrl`) |
| `GET /api/suggest?q=` | Cached server-side autocomplete proxy |

Because SearXNG is only a server-side dependency, it can stay private (not exposed to the internet, and in Docker not even exposed to the host). No CORS headers are needed anywhere.

| Variable | Scope | Default |
| --- | --- | --- |
| `NUXT_SEARX_URL` | Server (runtime) | `http://127.0.0.1:8080` |
| `SEARX_URL` | Dev convenience, sets the same value | — |

## Routes

| Route | Purpose |
| --- | --- |
| `GET /` | Search UI. `?q=test&range=24h` is shareable. |
| `GET /api/search?q=test&time_range=day` | Server proxy to SearXNG JSON, with URL sanitising, HTML cleanup, deduplication, and filtering telemetry. |
| `GET /api/suggest?q=te` | Cached autocomplete proxy. |

`range` accepts `24h`, `7d`, `30d`, or `1y`. Internally these map to SearXNG's `day`, `week`, `month`, and `year`.

## Keyboard

| Key | Action |
| --- | --- |
| `/` or `Cmd/Ctrl + K` | Focus the search input (selects the current query) |
| `ArrowDown` / `ArrowUp` | Move through autocomplete, then results |
| `j` / `k` | Move through results when the input is blurred |
| `Enter` | Search, or open the active result |
| `Cmd/Ctrl + Enter` | Open the active result in a new tab |
| `1`–`9` | Open result 01–09 directly |
| `Escape` | Close autocomplete, then blur the input |
| `T` | Toggle light / dark mode |

Results highlight on hover and keyboard focus. Matching query terms are bolded in snippets, and the active result scrolls smoothly into view.

## Project layout

```text
app/
  components/        Command bar, autocomplete, telemetry, result rows
  composables/       Theme state
  pages/index.vue    Search state and keyboard handling
  utils/format.ts    Breadcrumbs, relative dates, query highlighting
  utils/searchClient.ts  Thin client for the /api/* server proxy
server/
  api/search.get.ts  SearXNG search proxy
  api/suggest.get.ts SearXNG autocomplete proxy
  utils/searx.ts     Upstream fetching
shared/
  types/             API contracts shared by app and server
  utils/search.ts    Sanitising, filtering, dedupe (client + server)
```
