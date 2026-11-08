// server/utils/contentGuard.ts
// ------------------------------------------
// Domain blocklist from three separate sources:
//  1. hagezi social blocklist (CDN)
//  2. hagezi NSFW blocklist (CDN)
//  3. local server/blocked-domains.txt
// All subdomains are blocked automatically (e.g. m.facebook.com blocked by facebook.com).
// ------------------------------------------

import fs from 'node:fs'
import path from 'node:path'

// ============================================================
// CONFIG: CDN blocklists + local domains file
// ============================================================
export const SOCIAL_BLOCKLIST_URL =
  'https://cdn.jsdelivr.net/gh/hagezi/dns-blocklists@latest/adblock/social.txt'

export const NSFW_BLOCKLIST_URL =
  'https://cdn.jsdelivr.net/gh/hagezi/dns-blocklists@latest/adblock/nsfw.txt'

// Local domains file, resolved from several candidate paths
// (dev cwd, Nuxt .output runtime in Docker, current dir fallback)
function findBlockedDomainsFile(): string | null {
  const candidates = [
    path.resolve(process.cwd(), 'server', 'blocked-domains.txt'),
    path.resolve(process.cwd(), '.output', 'server', 'blocked-domains.txt'),
    path.resolve(process.cwd(), 'blocked-domains.txt'),
  ]
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate
  }
  return null
}

// ============================================================
// DOMAIN STORAGE
// ============================================================
const blockedDomains = new Set<string>() // O(1) lookups
let isInitialized = false
let initPromise: Promise<void> | null = null

function parseDomainLine(line: string): string | null {
  let trimmed = line.trim()
  if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('!')) return null

  // Strip AdBlock syntax: ||example.com^
  if (trimmed.startsWith('||')) {
    trimmed = trimmed.slice(2)
  }
  if (trimmed.endsWith('^')) {
    trimmed = trimmed.slice(0, -1)
  }

  // Hosts format: "0.0.0.0 domain.com" or "127.0.0.1 domain.com"
  const hostsMatch = trimmed.match(/^(?:0\.0\.0\.0|127\.0\.0\.1)\s+(\S+)/)
  if (hostsMatch?.[1]) {
    trimmed = hostsMatch[1]
  }

  // Strip protocol if present
  trimmed = trimmed.replace(/^https?:\/\//, '')

  // Extract hostname (strip paths, ports, query params)
  const domainPart = trimmed.split('/')[0]?.split(':')[0]?.split('?')[0]?.trim()
  if (!domainPart || /^\d+\.\d+\.\d+\.\d+$/.test(domainPart) || !domainPart.includes('.')) {
    return null
  }

  return domainPart.toLowerCase().replace(/^www\./, '')
}

async function fetchAndParse(url: string): Promise<string[]> {
  const res = await fetch(url, { headers: { 'Cache-Control': 'max-age: 86400' } })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const text = await res.text()
  const found: string[] = []
  for (const line of text.split('\n')) {
    const domain = parseDomainLine(line)
    if (domain) found.push(domain)
  }
  return found
}

// ============================================================
// INIT: load all three blocklists
// ============================================================
export async function initBlocklists(): Promise<void> {
  if (isInitialized && blockedDomains.size > 0) return
  if (initPromise) return initPromise

  initPromise = (async () => {
    let totalLoaded = 0

    // Source 1: CDN social blocklist
    try {
      const social = await fetchAndParse(SOCIAL_BLOCKLIST_URL)
      for (const d of social) blockedDomains.add(d)
      totalLoaded += social.length
      console.log(`[Guard] Loaded ${social.length} social domains from CDN`)
    } catch (e) {
      console.warn('[Guard] Error fetching social blocklist:', e)
    }

    // Source 2: CDN NSFW blocklist
    try {
      const nsfw = await fetchAndParse(NSFW_BLOCKLIST_URL)
      for (const d of nsfw) blockedDomains.add(d)
      totalLoaded += nsfw.length
      console.log(`[Guard] Loaded ${nsfw.length} NSFW domains from CDN`)
    } catch (e) {
      console.warn('[Guard] Error fetching NSFW blocklist:', e)
    }

    // Source 3: local blocked-domains.txt
    try {
      const domainsFile = findBlockedDomainsFile()
      if (!domainsFile) {
        console.warn('[Guard] blocked-domains.txt not found in any expected location; local list skipped')
      } else {
        const text = fs.readFileSync(domainsFile, 'utf-8')
        const local = text.split('\n').map(parseDomainLine).filter((d): d is string => !!d)
        for (const d of local) blockedDomains.add(d)
        totalLoaded += local.length
        console.log(`[Guard] Loaded ${local.length} domains from ${domainsFile}`)
      }
    } catch (e) {
      console.warn('[Guard] Error loading blocked-domains.txt:', e)
    }

    isInitialized = true
    console.log(`[Guard] ${blockedDomains.size} total unique blocked domains in memory (${totalLoaded} raw entries).`)
  })()

  return initPromise
}

// ============================================================
// IS BLOCKED: check if a URL's hostname or any parent domain is blocked
// e.g. m.facebook.com -> facebook.com (blocked)
// ============================================================
export function isBlocked(url: string): boolean {
  try {
    let hostname = new URL(url).hostname.toLowerCase().replace(/^www\./, '')
    if (!hostname) return false

    // Check exact hostname and parent domain suffixes
    while (hostname.includes('.')) {
      if (blockedDomains.has(hostname)) {
        return true
      }
      const nextDot = hostname.indexOf('.')
      if (nextDot === -1) break
      hostname = hostname.slice(nextDot + 1)
    }
    return false
  } catch {
    return false
  }
}

// ============================================================
// FILTER RESULTS: remove results from blocked domains
// ============================================================
export function filterResults<T extends { url: string }>(results: T[]): T[] {
  return results.filter((r) => !isBlocked(r.url))
}
