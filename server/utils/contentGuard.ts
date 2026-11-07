// server/utils/contentGuard.ts
// ------------------------------------------
// Social media domain blocklist using hagezi dns-blocklists
// ------------------------------------------

// ============================================================
// CONFIG: hagezi social blocklist via jsDelivr CDN
// ============================================================
export const SOCIAL_BLOCKLIST_URL =
  'https://cdn.jsdelivr.net/gh/hagezi/dns-blocklists@latest/adblock/social.txt';

// ============================================================
// DOMAIN PARSING & STORAGE
// ============================================================
const blockedDomains = new Set<string>(); // O(1) lookups
let isInitialized = false;
let initPromise: Promise<void> | null = null;

function parseSocialListLine(line: string): string | null {
  let trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('!')) return null;

  // Strip AdBlock syntax: ||example.com^
  if (trimmed.startsWith('||')) {
    trimmed = trimmed.slice(2);
  }
  if (trimmed.endsWith('^')) {
    trimmed = trimmed.slice(0, -1);
  }

  // Hosts format: "0.0.0.0 domain.com" or "127.0.0.1 domain.com"
  const hostsMatch = trimmed.match(/^(?:0\.0\.0\.0|127\.0\.0\.1)\s+(\S+)/);
  if (hostsMatch?.[1]) {
    trimmed = hostsMatch[1];
  }

  // Strip protocol if present
  trimmed = trimmed.replace(/^https?:\/\//, '');

  // Extract hostname (strip paths, ports, query params)
  const domainPart = trimmed.split('/')[0]?.split(':')[0]?.split('?')[0]?.trim();
  if (!domainPart || /^\d+\.\d+\.\d+\.\d+$/.test(domainPart) || !domainPart.includes('.')) {
    return null;
  }

  return domainPart.toLowerCase().replace(/^www\./, '');
}

// ============================================================
// INIT: download social list + compile to RAM
// Uses global fetch. Caches in RAM once loaded.
// ============================================================
export async function initBlocklists(): Promise<void> {
  if (isInitialized && blockedDomains.size > 0) return;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      const res = await fetch(SOCIAL_BLOCKLIST_URL, {
        headers: { 'Cache-Control': 'max-age: 86400' },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      const lines = text.split('\n');
      for (const line of lines) {
        const domain = parseSocialListLine(line);
        if (domain) {
          blockedDomains.add(domain);
        }
      }
      isInitialized = true;
      console.log(`[Guard] Loaded ${blockedDomains.size} social domains into memory.`);
    } catch (e) {
      console.warn('[Guard] Error fetching social blocklist:', e);
    } finally {
      initPromise = null;
    }
  })();

  return initPromise;
}

// ============================================================
// IS BLOCKED: check if a URL's hostname or any parent domain is blocked
// ============================================================
export function isBlocked(url: string): boolean {
  try {
    let hostname = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    if (!hostname) return false;

    // Check exact hostname and parent domain suffixes (e.g. m.facebook.com -> facebook.com)
    while (hostname.includes('.')) {
      if (blockedDomains.has(hostname)) {
        return true;
      }
      const nextDot = hostname.indexOf('.');
      if (nextDot === -1) break;
      hostname = hostname.slice(nextDot + 1);
    }
    return false;
  } catch {
    return false;
  }
}

// ============================================================
// FILTER RESULTS: remove results from blocked social domains
// ============================================================
export function filterResults<T extends { url: string }>(results: T[]): T[] {
  return results.filter((r) => !isBlocked(r.url));
}
