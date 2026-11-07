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
// DOMAIN PARSING
// ============================================================
let blockedDomains = new Set<string>(); // O(1) lookups
const cacheFile = '/var/searxng/content-guard-social.txt';

function parseSocialListLine(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('!')) return null;

  // Hosts format: "0.0.0.0 domain.com" or "127.0.0.1 domain.com"
  const hostsMatch = trimmed.match(/^(0\.0\.0\.0|127\.0\.0\.1)\s+(.+)$/);
  let domain: string | null = null;
  if (hostsMatch && hostsMatch.length >= 3) {
    const afterPrefix = hostsMatch[2];
    if (afterPrefix) {
      domain = afterPrefix.split('/')[0].split('?')[0].trim();
    }
  }
  if (domain && domain.includes('.')) return domain.toLowerCase();

  // Plain domain — extract hostname
  try {
    let d = trimmed;
    if (d.startsWith('http://') || d.startsWith('https://')) {
      d = d.replace(/^https?:\/\//, '');
    }
    d = d.split('/')[0].split('?')[0].trim();
    if (d && !/^\d+\.\d+\.\d+\.\d+$/.test(d) && d.includes('.')) {
      domain = d;
    }
  } catch {
    // ignored
  }
  if (domain && domain.includes('.')) return domain.toLowerCase();
  return null;
}

// ============================================================
// INIT: download social list + compile to RAM
// Uses global fetch. On first run downloads; subsequent runs use RAM.
// ============================================================
export async function initBlocklists(): Promise<void> {
  let fetchedCount = 0;
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
        fetchedCount++;
      }
    }
    console.log('[Guard] Fetched ' + fetchedCount + ' social domains from hagezi list.');
  } catch (e) {
    console.warn('[Guard] Error fetching social blocklist:', e);
  }
}

// ============================================================
// IS BLOCKED: O(1) check if a URL's hostname is a social domain
// ============================================================
export function isBlocked(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    return blockedDomains.has(hostname);
  } catch {
    return false;
  }
}

// ============================================================
// FILTER RESULTS: remove results from blocked social domains
// ============================================================
export function filterResults(results): any {
  return results.filter(function (r): any {
    return !isBlocked(r.url);
  });
}